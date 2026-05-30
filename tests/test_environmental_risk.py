import asyncio

from fastapi.testclient import TestClient

from backend import server
from backend.data import environmental_risk as risk


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload
        self.request = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, url, params):
        self.request = {"url": url, "params": params}
        return _FakeResponse(self._payload)


def test_trca_flood_lookup_maps_intersecting_polygon(monkeypatch):
    client = _FakeClient({
        "features": [
            {"attributes": {"FloodPlainSource": "Engineered"}},
            {"attributes": {"FloodPlainSource": "Estimated"}},
        ]
    })
    monkeypatch.setattr(risk.httpx, "AsyncClient", lambda timeout: client)

    result = asyncio.run(risk._fetch_trca_flood_risk(43.6532, -79.3832))

    assert result["in_regulatory_floodplain"] is True
    assert result["floodplain_sources"] == ["Engineered", "Estimated"]
    assert client.request["params"]["geometryType"] == "esriGeometryPoint"
    assert client.request["params"]["spatialRel"] == "esriSpatialRelIntersects"


def test_cached_lookup_reuses_fresh_value():
    cache = {}
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return {"source": "test", "checked_at": "now"}

    async def run():
        first = await risk._cached_lookup(cache, (1.0, 2.0), 300, fetch, "test")
        second = await risk._cached_lookup(cache, (1.0, 2.0), 300, fetch, "test")
        return first, second

    first, second = asyncio.run(run())

    assert calls == 1
    assert first == second
    assert first["available"] is True
    assert first["stale"] is False


def test_cached_lookup_returns_stale_value_when_refresh_fails():
    cache = {}

    async def fetch():
        return {"source": "test", "checked_at": "previous"}

    async def fail():
        raise RuntimeError("offline")

    async def run():
        await risk._cached_lookup(cache, (1.0, 2.0), 0, fetch, "test")
        return await risk._cached_lookup(cache, (1.0, 2.0), 0, fail, "test")

    result = asyncio.run(run())

    assert result["available"] is True
    assert result["stale"] is True
    assert result["checked_at"] == "previous"
    assert result["error"] == "upstream temporarily unavailable"


def test_environmental_risk_composes_independent_feeds(monkeypatch):
    risk.clear_caches()

    async def flood(lat, lng):
        return {"in_regulatory_floodplain": True, "source": "TRCA", "checked_at": "flood"}

    async def alerts(lat, lng):
        return {"alerts": [{"name": "Rainfall warning"}], "source": "ECCC", "checked_at": "alerts"}

    async def conditions(lat, lng):
        return {"current": {"precipitation": 3.2}, "source": "Open-Meteo", "checked_at": "weather"}

    monkeypatch.setattr(risk, "_fetch_trca_flood_risk", flood)
    monkeypatch.setattr(risk, "_fetch_weather_alerts", alerts)
    monkeypatch.setattr(risk, "_fetch_current_conditions", conditions)

    result = asyncio.run(risk.get_environmental_risk(43.6532, -79.3832))

    assert result["flood_risk"]["in_regulatory_floodplain"] is True
    assert result["weather"]["alerts"]["alerts"][0]["name"] == "Rainfall warning"
    assert result["weather"]["conditions"]["current"]["precipitation"] == 3.2


def test_environmental_risk_endpoint(monkeypatch):
    async def result(lat, lng):
        return {
            "query_location": {"lat": lat, "lng": lng},
            "flood_risk": {"available": True, "in_regulatory_floodplain": False},
            "weather": {"alerts": {"available": True}, "conditions": {"available": True}},
        }

    monkeypatch.setattr(server, "get_environmental_risk", result)

    with TestClient(server.app) as client:
        response = client.get("/api/environmental-risk?lat=43.6532&lng=-79.3832")

    assert response.status_code == 200
    assert response.json()["query_location"] == {"lat": 43.6532, "lng": -79.3832}


def test_environmental_risk_endpoint_rejects_invalid_coordinates():
    with TestClient(server.app) as client:
        response = client.get("/api/environmental-risk?lat=143.6532&lng=-79.3832")

    assert response.status_code == 422
