"""Deterministic Delation ward and incident risk scoring for the API gateway."""
import math
from typing import Any

import pandas as pd

from backend.data import toronto_loader

_CONSTRUCTION_PATTERN = r"construction|demolition|excavat|build permit|hoarding|scaffold"

_FLOOD_PATTERN = r"flood|water|drain|sewer|basement|storm"
_RISK_LEVELS = (
    (75, "CRITICAL"),
    (50, "HIGH"),
    (25, "ELEVATED"),
    (0, "LOW"),
)


def _level(score: float) -> str:
    return next(level for threshold, level in _RISK_LEVELS if score >= threshold)


def _number(value: Any, default: float = 0) -> float:
    try:
        number = float(value)
        return default if math.isnan(number) else number
    except (TypeError, ValueError):
        return default


def _ward_name(ward_id: int | None) -> str:
    return f"Ward {ward_id}" if ward_id is not None else "Toronto"


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


def _ward_centroid(ward_id: int) -> tuple[float, float]:
    """Compute centroid of a ward from mean building coordinates."""
    buildings = toronto_loader._buildings_gdf
    if buildings is None or buildings.empty:
        return 43.6532, -79.3832
    ward_rows = buildings[pd.to_numeric(buildings.get("WARD", pd.Series()), errors="coerce") == ward_id]
    if ward_rows.empty:
        return 43.6532, -79.3832
    lats = pd.to_numeric(ward_rows.get("LATITUDE", pd.Series()), errors="coerce").dropna()
    lngs = pd.to_numeric(ward_rows.get("LONGITUDE", pd.Series()), errors="coerce").dropna()
    if lats.empty or lngs.empty:
        return 43.6532, -79.3832
    return float(lats.mean()), float(lngs.mean())


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


def _ward_record(ward_id: int | None, floodplain: bool = False) -> dict[str, Any]:
    buildings = _ward_buildings(ward_id)
    scores = (
        pd.to_numeric(buildings.get("CURRENT BUILDING EVAL SCORE"), errors="coerce")
        if not buildings.empty and "CURRENT BUILDING EVAL SCORE" in buildings.columns
        else pd.Series(dtype=float)
    )
    flood_311    = _flood_311_count(ward_id)
    vuln_count   = int((scores < 70).sum())
    construction = _active_construction(ward_id)
    score = min(100.0,
        flood_311 * 3.0
        + vuln_count * 1.5
        + (25.0 if floodplain else 0.0)
        + (8.0 if construction else 0.0)
    )
    risk_level = _level(score)

    signals = []
    if floodplain:
        signals.append("TRCA regulatory floodplain overlap")
    if flood_311:
        signals.append(f"{flood_311} flood/drainage 311 requests")
    if vuln_count:
        signals.append(f"{vuln_count} buildings with RentSafeTO score < 70")
    if construction:
        signals.append("Active construction reported via 311")
    if not signals:
        signals.append("No elevated risk signals in loaded datasets")

    # Ward name from buildings WARDNAME column
    ward_name = _ward_name(ward_id)
    if not buildings.empty and "WARDNAME" in buildings.columns:
        name_val = buildings["WARDNAME"].dropna().iloc[0] if not buildings.empty else None
        if name_val:
            ward_name = str(name_val)

    lat, lng = _ward_centroid(ward_id) if ward_id is not None else (43.6532, -79.3832)

    return {
        "id":           str(ward_id) if ward_id is not None else "unknown",
        "name":         ward_name,
        "score":        round(score, 1),
        "risk_level":   risk_level,
        "lat":          round(lat, 6),
        "lng":          round(lng, 6),
        "in_flood_zone": floodplain,
        "prior_311":    flood_311,
        "watermain_age": 0,
        "construction": construction,
        "signals":      signals,
    }


def get_ward_risk(lat: float, lng: float, *, floodplain: bool = False) -> dict[str, Any]:
    ward_id = toronto_loader._ward_from_point(lat, lng)
    return _ward_record(ward_id, floodplain)


def get_risk_map() -> dict[str, Any]:
    """Return ranked ward risks with coordinates from real building data."""
    ward_ids: set[int] = set()
    buildings = toronto_loader._buildings_gdf
    requests  = toronto_loader._requests_df
    if buildings is not None and not buildings.empty and "WARD" in buildings.columns:
        ward_ids.update(
            int(v) for v in pd.to_numeric(buildings["WARD"], errors="coerce").dropna().unique()
        )
    if requests is not None and not requests.empty and "_ward_num" in requests.columns:
        ward_ids.update(int(v) for v in requests["_ward_num"].dropna().unique())
    wards = sorted(
        (_ward_record(wid) for wid in ward_ids),
        key=lambda w: w["score"], reverse=True
    )
    return {"wards": wards}


def get_at_risk_buildings() -> list[dict[str, Any]]:
    """Return individual RentSafeTO buildings with compliance < 70 for map display."""
    buildings = toronto_loader._buildings_gdf
    if buildings is None or buildings.empty:
        return []
    result = []
    for _, row in buildings.iterrows():
        try:
            lat  = float(row.get("LATITUDE")  or 0)
            lng  = float(row.get("LONGITUDE") or 0)
            if not lat or not lng:
                continue
            score = float(row.get("CURRENT BUILDING EVAL SCORE") or 0)
            if score <= 0 or score >= 70:
                continue
            result.append({
                "address": str(row.get("SITE ADDRESS", "Unknown")),
                "score":   round(score, 1),
                "ward":    str(row.get("WARD", "")),
                "floors":  int(row.get("CONFIRMED STOREYS") or 0),
                "lat":     round(lat, 6),
                "lng":     round(lng, 6),
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
    score = min(35.0, _number(ward_risk.get("score")) * 0.35)
    factors = [f"Predicted {_level(_number(ward_risk.get('score'))).lower()} baseline risk for {ward_risk['ward_name']}"]

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
            f"Citizen flooding report confirms predicted risk in {ward_risk['ward_name']}"
            if escalated
            else ""
        ),
    }
