"""Deterministic Delation ward and incident risk scoring for the API gateway."""
import math
from typing import Any

import pandas as pd

from backend.data import toronto_loader

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


def _ward_record(ward_id: int | None, floodplain: bool = False) -> dict[str, Any]:
    buildings = _ward_buildings(ward_id)
    scores = (
        pd.to_numeric(buildings.get("CURRENT BUILDING EVAL SCORE"), errors="coerce")
        if not buildings.empty and "CURRENT BUILDING EVAL SCORE" in buildings.columns
        else pd.Series(dtype=float)
    )
    flood_311 = _flood_311_count(ward_id)
    vulnerable_buildings = int((scores < 70).sum())
    # Multipliers calibrated to Toronto 311 data:
    # flood_311 ranges 300-1200 across wards → *0.06 gives 18-72 base spread
    # vulnerable_buildings typically 0-30 → *1.5 adds 0-45
    # floodplain intersection adds 20 points on top
    score = min(100.0, flood_311 * 0.06 + vulnerable_buildings * 1.5 + (20.0 if floodplain else 0.0))
    signals = []
    if floodplain:
        signals.append("TRCA regulatory floodplain overlap")
    if flood_311:
        signals.append(f"{flood_311} flood, drainage, or sewer-related 311 requests")
    if vulnerable_buildings:
        signals.append(f"{vulnerable_buildings} RentSafeTO buildings with evaluation score below 70")
    if not signals:
        signals.append("No elevated local signals in loaded Toronto datasets")
    return {
        "ward_id": str(ward_id) if ward_id is not None else "unknown",
        "ward_name": _ward_name(ward_id),
        "score": round(score, 1),
        "level": _level(score),
        "signals": signals,
        "data_scope": "ward-level fallback derived from loaded Toronto datasets",
    }


def get_ward_risk(lat: float, lng: float, *, floodplain: bool = False) -> dict[str, Any]:
    """Return a deterministic ward fallback until Person 4 provides polygon scoring."""
    ward_id = toronto_loader._ward_from_point(lat, lng)
    return _ward_record(ward_id, floodplain)


def get_risk_map() -> dict[str, Any]:
    """Return ranked ward risks from the currently loaded local datasets."""
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
        "scoring_mode": "local-deterministic-fallback",
        "data_scope": "Ward-level predictions use loaded 311 and RentSafeTO records. Person 4 can replace this adapter with polygon scoring.",
    }


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
