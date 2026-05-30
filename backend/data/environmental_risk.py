"""Live environmental risk lookups with resilient per-location caching."""
import asyncio
import copy
import datetime
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import httpx

logger = logging.getLogger(__name__)

TRCA_FLOOD_QUERY_URL = os.environ.get(
    "TRCA_FLOOD_QUERY_URL",
    "https://services1.arcgis.com/d0ZCwU7eGKVeNiEE/arcgis/rest/services/"
    "Floodline_TRCA_Polygon/FeatureServer/1/query",
)
GEOMET_ALERTS_URL = os.environ.get(
    "GEOMET_ALERTS_URL",
    "https://api.weather.gc.ca/collections/weather-alerts/items",
)
OPEN_METEO_URL = os.environ.get(
    "OPEN_METEO_URL",
    "https://api.open-meteo.com/v1/forecast",
)
TRCA_FLOOD_CACHE_TTL_SECONDS = int(os.environ.get("TRCA_FLOOD_CACHE_TTL_SECONDS", "3600"))
WEATHER_CACHE_TTL_SECONDS = int(os.environ.get("WEATHER_CACHE_TTL_SECONDS", "300"))
UPSTREAM_TIMEOUT_SECONDS = float(os.environ.get("ENVIRONMENTAL_RISK_TIMEOUT_SECONDS", "4"))


@dataclass
class _CacheEntry:
    value: dict[str, Any]
    stored_at: float


_flood_cache: dict[tuple[float, float], _CacheEntry] = {}
_alerts_cache: dict[tuple[float, float], _CacheEntry] = {}
_conditions_cache: dict[tuple[float, float], _CacheEntry] = {}
_cache_lock = asyncio.Lock()


def _timestamp() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _cache_key(lat: float, lng: float) -> tuple[float, float]:
    # Roughly 10 metre buckets avoid duplicate upstream calls for the same incident.
    return round(lat, 4), round(lng, 4)


def clear_caches() -> None:
    """Clear process caches. Intended for tests and manual refreshes."""
    _flood_cache.clear()
    _alerts_cache.clear()
    _conditions_cache.clear()


async def _cached_lookup(
    cache: dict[tuple[float, float], _CacheEntry],
    key: tuple[float, float],
    ttl_seconds: int,
    fetcher: Callable[[], Awaitable[dict[str, Any]]],
    source: str,
) -> dict[str, Any]:
    entry = cache.get(key)
    if entry and time.monotonic() - entry.stored_at < ttl_seconds:
        return copy.deepcopy(entry.value)

    try:
        value = await fetcher()
    except Exception as exc:
        logger.warning("%s lookup failed: %s", source, exc)
        if entry:
            stale_value = copy.deepcopy(entry.value)
            stale_value["stale"] = True
            stale_value["error"] = "upstream temporarily unavailable"
            return stale_value
        return {
            "available": False,
            "source": source,
            "checked_at": _timestamp(),
            "stale": False,
            "error": "upstream temporarily unavailable",
        }

    value = {**value, "available": True, "stale": False}
    async with _cache_lock:
        cache[key] = _CacheEntry(copy.deepcopy(value), time.monotonic())
    return value


async def _fetch_trca_flood_risk(lat: float, lng: float) -> dict[str, Any]:
    geometry = json.dumps({"x": lng, "y": lat, "spatialReference": {"wkid": 4326}})
    params = {
        "f": "json",
        "geometry": geometry,
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FloodPlainSource",
        "returnGeometry": "false",
    }
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT_SECONDS) as client:
        response = await client.get(TRCA_FLOOD_QUERY_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    if payload.get("error"):
        raise RuntimeError(payload["error"].get("message", "TRCA ArcGIS query failed"))

    features = payload.get("features", [])
    sources = sorted({
        str(feature.get("attributes", {}).get("FloodPlainSource", "TRCA regulatory floodplain"))
        for feature in features
    })
    return {
        "in_regulatory_floodplain": bool(features),
        "floodplain_sources": sources,
        "source": "TRCA Floodline_TRCA_Polygon",
        "checked_at": _timestamp(),
        "refresh_interval_seconds": TRCA_FLOOD_CACHE_TTL_SECONDS,
    }


async def _fetch_weather_alerts(lat: float, lng: float) -> dict[str, Any]:
    radius = 0.08
    params = {
        "f": "json",
        "lang": "en",
        "limit": "50",
        "bbox": f"{lng - radius},{lat - radius},{lng + radius},{lat + radius}",
    }
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT_SECONDS) as client:
        response = await client.get(GEOMET_ALERTS_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    alerts = []
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        alerts.append({
            "id": props.get("id") or props.get("feature_id"),
            "name": props.get("alert_name_en") or props.get("alert_short_name_en"),
            "type": props.get("alert_type"),
            "status": props.get("status_en"),
            "impact": props.get("impact_en"),
            "valid_from": props.get("validity_datetime"),
            "expires_at": props.get("expiration_datetime") or props.get("event_end_datetime"),
        })
    return {
        "alerts": alerts,
        "source": "Environment and Climate Change Canada MSC GeoMet",
        "checked_at": _timestamp(),
        "refresh_interval_seconds": WEATHER_CACHE_TTL_SECONDS,
    }


async def _fetch_current_conditions(lat: float, lng: float) -> dict[str, Any]:
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": (
            "temperature_2m,relative_humidity_2m,precipitation,rain,"
            "wind_speed_10m,wind_gusts_10m,weather_code"
        ),
        "timezone": "America/Toronto",
    }
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT_SECONDS) as client:
        response = await client.get(OPEN_METEO_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    return {
        "current": payload.get("current", {}),
        "current_units": payload.get("current_units", {}),
        "source": "Open-Meteo supplemental current conditions",
        "checked_at": _timestamp(),
        "refresh_interval_seconds": WEATHER_CACHE_TTL_SECONDS,
    }


async def get_environmental_risk(lat: float, lng: float) -> dict[str, Any]:
    """Return flood exposure, official alerts, and current weather independently."""
    key = _cache_key(lat, lng)
    flood_risk, alerts, conditions = await asyncio.gather(
        _cached_lookup(
            _flood_cache,
            key,
            TRCA_FLOOD_CACHE_TTL_SECONDS,
            lambda: _fetch_trca_flood_risk(lat, lng),
            "TRCA Floodline_TRCA_Polygon",
        ),
        _cached_lookup(
            _alerts_cache,
            key,
            WEATHER_CACHE_TTL_SECONDS,
            lambda: _fetch_weather_alerts(lat, lng),
            "Environment and Climate Change Canada MSC GeoMet",
        ),
        _cached_lookup(
            _conditions_cache,
            key,
            WEATHER_CACHE_TTL_SECONDS,
            lambda: _fetch_current_conditions(lat, lng),
            "Open-Meteo supplemental current conditions",
        ),
    )
    return {
        "query_location": {"lat": lat, "lng": lng},
        "flood_risk": flood_risk,
        "weather": {
            "alerts": alerts,
            "conditions": conditions,
        },
    }
