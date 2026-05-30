import pandas as pd
from fastapi.testclient import TestClient

from backend import server
from backend.data import delation_risk


def _client() -> TestClient:
    server.MOCK_MODE = True
    return TestClient(server.app)


def test_risk_map_mock_contract():
    with _client() as client:
        response = client.get("/api/risk-map")

    assert response.status_code == 200
    body = response.json()
    assert "wards" in body
    ward = body["wards"][0]
    assert {"ward_id", "ward_name", "score", "level", "signals"} <= set(ward)
    assert {"id", "name", "risk_level", "lat", "lng", "prior_311"} <= set(ward)


def test_risk_map_supports_pdf_post_contract():
    with _client() as client:
        response = client.post("/api/risk-map")

    assert response.status_code == 200


def test_mock_incident_includes_delation_enrichment():
    with _client() as client:
        response = client.post("/api/incident", json={
            "transcript": "Water is rising in the basement",
            "gps": {"lat": 43.6629, "lng": -79.3957},
        })

    assert response.status_code == 200
    body = response.json()
    assert body["escalated"] is True
    assert body["ward_risk"]["score"] == 82.0
    assert body["compound_risk"]["level"] == "CRITICAL"
    assert body["environmental_risk"]["flood_risk"]["in_regulatory_floodplain"] is True
    assert body["performance"]["spatial_compute_path"] in {"rapids-cudf", "geopandas-cpu"}


def test_ward_risk_fallback_uses_loaded_311_and_buildings(monkeypatch):
    delation_risk._zone_index.cache_clear()
    monkeypatch.setattr(delation_risk.toronto_loader, "_neighbourhoods_gdf", delation_risk.toronto_loader._empty_gdf())
    monkeypatch.setattr(delation_risk.toronto_loader, "_ward_from_point", lambda lat, lng: 14)
    monkeypatch.setattr(delation_risk, "_sample_flood_susceptibility", lambda lat, lng: 0.0)
    monkeypatch.setattr(delation_risk.toronto_loader, "_buildings_gdf", pd.DataFrame({
        "WARD": [14, 14],
        "CURRENT BUILDING EVAL SCORE": [60, 85],
    }))
    monkeypatch.setattr(delation_risk.toronto_loader, "_requests_df", pd.DataFrame({
        "_ward_num": [14, 14, 14],
        "Service Request Type": ["Basement Flooding", "Drain issue", "Noise"],
    }))

    result = delation_risk.get_ward_risk(43.67, -79.35, floodplain=True)

    assert result["ward_id"] == "14"
    assert result["score"] == 30.5
    assert "TRCA regulatory floodplain overlap" in result["signals"][0]


def test_websocket_compiler_event_includes_latency_and_escalation():
    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json({
                "transcript": "Water is rising in the basement",
                "gps": {"lat": 43.6629, "lng": -79.3957},
            })
            events = [websocket.receive_json() for _ in range(8)]

    compiler = events[-1]
    assert compiler["node"] == "compiler"
    assert compiler["latency_ms"] >= 0
    assert compiler["escalated"] is True
    assert compiler["data"]["compound_risk"]["level"] == "CRITICAL"
