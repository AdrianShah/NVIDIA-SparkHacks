"""Predictive risk zones from City of Toronto historic open data used by Delation agents.

Signals (all loaded locally at gateway startup):
  - Historic 311 service requests (flood / drainage / sewer / basement)
  - RentSafeTO apartment building evaluations (building vulnerability)
  - Official neighbourhood boundaries (map zones)
  - Flood susceptibility raster (model layer shipped with the repo)
"""
from __future__ import annotations

import logging
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import mapping

from backend.data import toronto_loader

logger = logging.getLogger(__name__)

_CONSTRUCTION_PATTERN = r"construction|demolition|excavat|build permit|hoarding|scaffold"

_FLOOD_PATTERN = r"flood|water|drain|sewer|basement|storm"
_RISK_LEVELS = (
    (75, "CRITICAL"),
    (50, "HIGH"),
    (25, "ELEVATED"),
    (0, "LOW"),
)
_FLOOD_SUSCEPTIBILITY_PATHS = (
    Path(toronto_loader.DATA_DIR) / "flood-susceptibility-toronto.tif",
    Path(toronto_loader.DATA_DIR) / "flood-susceptibility-toronto.geojson",
)
_FLOOD_ZONE_THRESHOLD = 60.0

TORONTO_DATA_SOURCES = [
    "City of Toronto 311 Service Requests (historic, customer-initiated)",
    "RentSafeTO Apartment Building Evaluations",
    "City of Toronto Neighbourhood boundaries",
    "Flood susceptibility model raster (Toronto)",
]


def _level(score: float) -> str:
    return next(level for threshold, level in _RISK_LEVELS if score >= threshold)


def _number(value: Any, default: float = 0) -> float:
    try:
        number = float(value)
        return default if math.isnan(number) else number
    except (TypeError, ValueError):
        return default


def _flood_311_count(ward_id: int | None) -> int:
    df = toronto_loader._requests_df
    if df is None or df.empty or "Service Request Type" not in df.columns:
        return 0
    if ward_id is not None and "_ward_num" in df.columns:
        df = df[df["_ward_num"] == ward_id]
    return int(
        df["Service Request Type"].astype(str).str.contains(_FLOOD_PATTERN, case=False, na=False).sum()
    )


def _ward_buildings(ward_id: int | None) -> pd.DataFrame:
    buildings = toronto_loader._buildings_gdf
    if buildings is None or buildings.empty or ward_id is None or "WARD" not in buildings.columns:
        return pd.DataFrame()
    ward_values = pd.to_numeric(buildings["WARD"], errors="coerce")
    return buildings[ward_values == ward_id]


def _active_construction(ward_id: int | None) -> bool:
    """True if there are 311 construction complaints in this ward."""
    df = toronto_loader._requests_df
    if df is None or df.empty or "Service Request Type" not in df.columns:
        return False
    if ward_id is not None and "_ward_num" in df.columns:
        df = df[df["_ward_num"] == ward_id]
    return bool(
        df["Service Request Type"].astype(str)
        .str.contains(_CONSTRUCTION_PATTERN, case=False, na=False)
        .any()
    )


def _ward_name(ward_id: int | None) -> str:
    return f"Ward {ward_id}" if ward_id is not None else "Toronto"


def _geometry_centroid_wgs84(geom) -> dict[str, float]:
    try:
        gdf = gpd.GeoDataFrame(geometry=[geom], crs=toronto_loader.TARGET_CRS)
        point = gdf.to_crs("EPSG:4326").geometry.iloc[0].centroid
        return {"lat": round(float(point.y), 6), "lng": round(float(point.x), 6)}
    except Exception:
        return {"lat": 43.6532, "lng": -79.3832}


@lru_cache(maxsize=1)
def _flood_raster_dataset():
    tif_path = _FLOOD_SUSCEPTIBILITY_PATHS[0]
    if not tif_path.exists():
        return None
    try:
        import rasterio
    except ImportError:
        logger.warning("rasterio not installed ??? flood susceptibility raster disabled")
        return None
    try:
        return rasterio.open(tif_path)
    except Exception as exc:
        logger.warning("Could not open flood susceptibility raster: %s", exc)
        return None


def _sample_flood_susceptibility(lat: float, lng: float) -> float:
    dataset = _flood_raster_dataset()
    if dataset is None:
        return 0.0
    try:
        for value in dataset.sample([(lng, lat)]):
            sampled = float(value[0])
            if math.isfinite(sampled) and sampled > 0:
                return sampled
    except Exception as exc:
        logger.debug("Flood susceptibility sample failed: %s", exc)
    return 0.0


def _zonal_flood_susceptibility(geometry) -> float:
    dataset = _flood_raster_dataset()
    if dataset is None:
        return 0.0
    try:
        import rasterio
        from rasterio.mask import mask

        geom_wgs84 = gpd.GeoDataFrame(geometry=[geometry], crs=toronto_loader.TARGET_CRS).to_crs(
            dataset.crs
        )
        clipped, _ = mask(dataset, [mapping(geom_wgs84.geometry.iloc[0])], crop=True, filled=False)
        values = clipped.compressed() if hasattr(clipped, "compressed") else clipped[~np.isnan(clipped)]
        if values.size == 0:
            centroid = _geometry_centroid_wgs84(geometry)
            return _sample_flood_susceptibility(centroid["lat"], centroid["lng"])
        return float(np.nanmean(values))
    except Exception as exc:
        logger.debug("Zonal flood susceptibility failed: %s", exc)
        centroid = _geometry_centroid_wgs84(geometry)
        return _sample_flood_susceptibility(centroid["lat"], centroid["lng"])


def _buildings_in_neighbourhoods() -> gpd.GeoDataFrame:
    buildings = toronto_loader._buildings_gdf
    neighbourhoods = toronto_loader._neighbourhoods_gdf
    if buildings is None or buildings.empty or neighbourhoods is None or neighbourhoods.empty:
        return gpd.GeoDataFrame()

    try:
        joined = gpd.sjoin(
            buildings,
            neighbourhoods[
                ["AREA_SHORT_CODE", "AREA_NAME", "AREA_ID", "geometry"]
            ],
            how="inner",
            predicate="within",
        )
        return joined
    except Exception as exc:
        logger.warning("Building ??? neighbourhood spatial join failed: %s", exc)
        return gpd.GeoDataFrame()


def _ward_building_counts() -> dict[int, int]:
    buildings = toronto_loader._buildings_gdf
    if buildings is None or buildings.empty or "WARD" not in buildings.columns:
        return {}
    ward_values = pd.to_numeric(buildings["WARD"], errors="coerce")
    counts = buildings.groupby(ward_values).size()
    return {int(ward): int(count) for ward, count in counts.items() if pd.notna(ward)}


@lru_cache(maxsize=1)
def _zone_index() -> list[dict[str, Any]]:
    """Precompute neighbourhood risk zones from historic Toronto datasets."""
    neighbourhoods = toronto_loader._neighbourhoods_gdf
    if neighbourhoods is None or neighbourhoods.empty:
        return []

    joined = _buildings_in_neighbourhoods()
    ward_totals = _ward_building_counts()
    zones: list[dict[str, Any]] = []

    for _, row in neighbourhoods.iterrows():
        zone_id = str(toronto_loader._row_val(row, "AREA_SHORT_CODE", "AREA_LONG_CODE", default=""))
        zone_name = str(toronto_loader._row_val(row, "AREA_NAME", default="Unknown neighbourhood"))
        geometry = row.geometry

        nbhd_buildings = (
            joined[joined["AREA_SHORT_CODE"] == row["AREA_SHORT_CODE"]]
            if not joined.empty and "AREA_SHORT_CODE" in joined.columns
            else pd.DataFrame()
        )

        scores = (
            pd.to_numeric(nbhd_buildings.get("CURRENT BUILDING EVAL SCORE"), errors="coerce")
            if not nbhd_buildings.empty and "CURRENT BUILDING EVAL SCORE" in nbhd_buildings.columns
            else pd.Series(dtype=float)
        )
        vulnerable_buildings = int((scores < 70).sum())

        ward_id = None
        if not nbhd_buildings.empty and "WARD" in nbhd_buildings.columns:
            ward_values = pd.to_numeric(nbhd_buildings["WARD"], errors="coerce").dropna()
            if not ward_values.empty:
                ward_id = int(ward_values.mode().iloc[0])
        if ward_id is None:
            centroid = _geometry_centroid_wgs84(geometry)
            ward_id = toronto_loader._ward_from_point(centroid["lat"], centroid["lng"])

        ward_flood_311 = _flood_311_count(ward_id)
        ward_total = ward_totals.get(ward_id, 0) if ward_id is not None else 0
        nbhd_building_count = len(nbhd_buildings)
        if ward_total > 0 and nbhd_building_count > 0:
            flood_311 = int(round(ward_flood_311 * (nbhd_building_count / ward_total)))
        else:
            flood_311 = ward_flood_311 if nbhd_building_count > 0 else 0

        susceptibility = round(_zonal_flood_susceptibility(geometry), 1)
        score = min(
            100.0,
            flood_311 * 2.0
            + vulnerable_buildings * 1.5
            + susceptibility * 0.35
            + (20.0 if susceptibility >= _FLOOD_ZONE_THRESHOLD else 0.0),
        )

        signals = []
        if flood_311:
            signals.append(
                f"{flood_311} historic flood, drainage, or sewer-related 311 requests (ward-proportional)"
            )
        if vulnerable_buildings:
            signals.append(
                f"{vulnerable_buildings} RentSafeTO buildings with evaluation score below 70"
            )
        if susceptibility >= _FLOOD_ZONE_THRESHOLD:
            signals.append(f"Flood susceptibility model mean {susceptibility:g}/100 in neighbourhood")
        elif susceptibility > 0:
            signals.append(f"Flood susceptibility model mean {susceptibility:g}/100")
        if not signals:
            signals.append("No elevated historic signals in loaded Toronto datasets for this zone")

        centroid = _geometry_centroid_wgs84(geometry)
        level = _level(score)
        zones.append(
            {
                "id": zone_id,
                "name": zone_name,
                "score": round(score, 1),
                "risk_level": level,
                "lat": centroid["lat"],
                "lng": centroid["lng"],
                "in_flood_zone": bool(susceptibility >= _FLOOD_ZONE_THRESHOLD or flood_311 > 0),
                "prior_311": flood_311,
                "flood_susceptibility": susceptibility,
                "vulnerable_buildings": vulnerable_buildings,
                "watermain_age": None,
                "ward_id": str(ward_id) if ward_id is not None else zone_id,
                "ward_name": zone_name,
                "level": level,
                "signals": signals,
                "zone_type": "toronto_neighbourhood",
                "data_scope": "Neighbourhood zones from historic 311, RentSafeTO, and flood susceptibility layers",
            }
        )

    return sorted(zones, key=lambda item: item["score"], reverse=True)


def _zone_by_id(zone_id: str) -> dict[str, Any] | None:
    for zone in _zone_index():
        if zone["id"] == zone_id:
            return zone
    return None


def _zone_at_point(lat: float, lng: float) -> dict[str, Any] | None:
    meta = toronto_loader.neighbourhood_at_point(lat, lng)
    if meta and meta.get("zone_id"):
        zone = _zone_by_id(str(meta["zone_id"]))
        if zone:
            return zone
    return None


def _ward_centroid(ward_id: int | None) -> dict[str, float]:
    buildings = _ward_buildings(ward_id)
    if buildings.empty or "geometry" not in buildings.columns:
        return {"lat": 43.6532, "lng": -79.3832}
    try:
        centroid = buildings.geometry.unary_union.centroid
        return _geometry_centroid_wgs84(centroid)
    except Exception:
        return {"lat": 43.6532, "lng": -79.3832}


def _ward_record(ward_id: int | None, floodplain: bool = False) -> dict[str, Any]:
    """Ward-level fallback when neighbourhood boundaries are not loaded."""
    buildings = _ward_buildings(ward_id)
    scores = (
        pd.to_numeric(buildings.get("CURRENT BUILDING EVAL SCORE"), errors="coerce")
        if not buildings.empty and "CURRENT BUILDING EVAL SCORE" in buildings.columns
        else pd.Series(dtype=float)
    )
    flood_311 = _flood_311_count(ward_id)
    vulnerable_buildings = int((scores < 70).sum())
    construction = _active_construction(ward_id)
    centroid = _ward_centroid(ward_id)
    susceptibility = _sample_flood_susceptibility(centroid["lat"], centroid["lng"])
    score = min(
        100.0,
        flood_311 * 2.0
        + vulnerable_buildings * 1.5
        + susceptibility * 0.35
        + (25.0 if floodplain else 0.0)
        + (20.0 if susceptibility >= _FLOOD_ZONE_THRESHOLD else 0.0)
        + (8.0 if construction else 0.0),
    )
    signals = []
    if floodplain:
        signals.append("TRCA regulatory floodplain overlap (live incident check)")
    if flood_311:
        signals.append(f"{flood_311} historic flood, drainage, or sewer-related 311 requests")
    if vulnerable_buildings:
        signals.append(f"{vulnerable_buildings} RentSafeTO buildings with evaluation score below 70")
    if construction:
        signals.append("Active construction reported via 311")
    if susceptibility >= _FLOOD_ZONE_THRESHOLD:
        signals.append(f"Flood susceptibility model {susceptibility:g}/100 at ward centroid")
    if not signals:
        signals.append("No elevated historic signals in loaded Toronto datasets")

    level = _level(score)
    ward_key = str(ward_id) if ward_id is not None else "unknown"
    name = _ward_name(ward_id)
    return {
        "id": ward_key,
        "name": name,
        "score": round(score, 1),
        "risk_level": level,
        "lat": centroid["lat"],
        "lng": centroid["lng"],
        "in_flood_zone": bool(floodplain or flood_311 > 0 or susceptibility >= _FLOOD_ZONE_THRESHOLD),
        "prior_311": flood_311,
        "flood_susceptibility": susceptibility,
        "watermain_age": None,
        "construction": construction,
        "ward_id": ward_key,
        "ward_name": name,
        "level": level,
        "signals": signals,
        "zone_type": "city_ward_fallback",
        "data_scope": "Ward fallback from historic 311 + RentSafeTO (neighbourhood polygons unavailable)",
    }


def _zone_record_at_point(lat: float, lng: float, *, floodplain: bool = False) -> dict[str, Any]:
    zone = _zone_at_point(lat, lng)
    if zone:
        record = dict(zone)
        if floodplain:
            record["score"] = round(min(100.0, float(record["score"]) + 25.0), 1)
            record["risk_level"] = _level(record["score"])
            record["level"] = record["risk_level"]
            record["signals"] = list(record["signals"]) + [
                "TRCA regulatory floodplain overlap (live incident check)"
            ]
            record["in_flood_zone"] = True
        return record

    ward_id = toronto_loader._ward_from_point(lat, lng)
    return _ward_record(ward_id, floodplain)


def prior_311_for_point(lat: float, lng: float) -> int:
    zone = _zone_at_point(lat, lng)
    if zone:
        return int(zone.get("prior_311", 0))
    ward_id = toronto_loader._ward_from_point(lat, lng)
    return _flood_311_count(ward_id)


def flood_exposure_at_point(lat: float, lng: float) -> bool:
    zone = _zone_at_point(lat, lng)
    if zone and zone.get("in_flood_zone"):
        return True
    susceptibility = _sample_flood_susceptibility(lat, lng)
    if susceptibility >= _FLOOD_ZONE_THRESHOLD:
        return True
    ward_id = toronto_loader._ward_from_point(lat, lng)
    return _flood_311_count(ward_id) > 0


def get_ward_risk(lat: float, lng: float, *, floodplain: bool = False) -> dict[str, Any]:
    """Predictive baseline for the Toronto neighbourhood (or ward fallback) at a point."""
    return _zone_record_at_point(lat, lng, floodplain=floodplain)


def get_risk_map() -> dict[str, Any]:
    """Return ranked risk zones from historic City of Toronto open data."""
    zones = _zone_index()
    if zones:
        return {
            "wards": zones,
            "zone_type": "toronto_neighbourhood",
            "scoring_mode": "toronto-historic-open-data",
            "data_sources": TORONTO_DATA_SOURCES,
            "data_scope": (
                "Neighbourhood polygons scored from historic 311 flood requests, "
                "RentSafeTO building evaluations, and the local flood susceptibility raster."
            ),
        }

    ward_ids: set[int] = set()
    buildings = toronto_loader._buildings_gdf
    requests = toronto_loader._requests_df
    if buildings is not None and not buildings.empty and "WARD" in buildings.columns:
        ward_ids.update(
            int(value) for value in pd.to_numeric(buildings["WARD"], errors="coerce").dropna().unique()
        )
    if requests is not None and not requests.empty and "_ward_num" in requests.columns:
        ward_ids.update(int(value) for value in requests["_ward_num"].dropna().unique())
    wards = sorted((_ward_record(ward_id) for ward_id in ward_ids), key=lambda item: item["score"], reverse=True)
    return {
        "wards": wards,
        "zone_type": "city_ward_fallback",
        "scoring_mode": "toronto-historic-open-data",
        "data_sources": TORONTO_DATA_SOURCES,
        "data_scope": (
            "Ward-level fallback using historic 311 and RentSafeTO until "
            "toronto-neighbourhoods.geojson is present in DATA_DIR."
        ),
    }


def get_at_risk_buildings() -> list[dict[str, Any]]:
    """Return individual RentSafeTO buildings with compliance < 70 for map display."""
    buildings = toronto_loader._buildings_gdf
    if buildings is None or buildings.empty:
        return []
    result = []
    for _, row in buildings.iterrows():
        try:
            lat = float(row.get("LATITUDE") or 0)
            lng = float(row.get("LONGITUDE") or 0)
            if not lat or not lng:
                continue
            score = float(row.get("CURRENT BUILDING EVAL SCORE") or 0)
            if score <= 0 or score >= 70:
                continue
            result.append({
                "address": str(row.get("SITE ADDRESS", "Unknown")),
                "score": round(score, 1),
                "ward": str(row.get("WARD", "")),
                "floors": int(row.get("CONFIRMED STOREYS") or 0),
                "lat": round(lat, 6),
                "lng": round(lng, 6),
            })
        except (TypeError, ValueError):
            continue
    return sorted(result, key=lambda b: b["score"])[:400]


def score_incident(
    transcript: str,
    vision: dict[str, Any],
    spatial: dict[str, Any],
    environmental: dict[str, Any],
    ward_risk: dict[str, Any],
) -> dict[str, Any]:
    """Combine grounded gateway signals into an explainable incident score."""
    zone_name = ward_risk.get("ward_name") or ward_risk.get("name") or "this area"
    score = min(35.0, _number(ward_risk.get("score")) * 0.35)
    factors = [f"Predicted {_level(_number(ward_risk.get('score'))).lower()} baseline risk for {zone_name}"]

    flood_risk = environmental.get("flood_risk", {})
    if flood_risk.get("in_regulatory_floodplain"):
        score += 25
        factors.append("Incident intersects the TRCA regulatory floodplain")

    alerts = environmental.get("weather", {}).get("alerts", {}).get("alerts", [])
    if alerts:
        score += 15
        factors.append(f"{len(alerts)} active Environment Canada weather alert(s)")

    current = environmental.get("weather", {}).get("conditions", {}).get("current", {})
    precipitation = _number(current.get("precipitation"))
    if precipitation > 0:
        score += min(10.0, precipitation * 2)
        factors.append(f"Current precipitation is {precipitation:g} mm")

    severity = _number(vision.get("severity_scale"))
    if severity:
        score += min(20.0, severity * 2)
        factors.append(f"Vision hazard severity is {severity:g}/10")

    units = int(_number(spatial.get("building_specs", {}).get("units")))
    if units:
        score += min(10.0, units / 20)
        factors.append(f"Nearest evaluated building contains {units} units")

    if any(term in transcript.lower() for term in ("flood", "water", "sewer", "basement")):
        score += 5
        factors.append("Citizen transcript contains flooding-related language")

    score = round(min(100.0, score), 1)
    level = _level(score)
    predicted = _number(ward_risk.get("score")) >= 50
    flood_report = any(term in transcript.lower() for term in ("flood", "water", "sewer", "basement"))
    escalated = bool(predicted and flood_report)
    return {
        "score": score,
        "level": level,
        "factors": factors,
        "escalated": escalated,
        "escalation_reason": (
            f"Citizen flooding report confirms predicted risk in {zone_name}"
            if escalated
            else ""
        ),
    }
