"""In-memory incident feed shared by web and mobile clients."""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, Optional

_MAX_INCIDENTS = 200


def _ward_risk_score(ward_risk: Any) -> float:
    if isinstance(ward_risk, dict):
        return float(ward_risk.get("score", 0) or 0)
    if isinstance(ward_risk, (int, float)):
        return float(ward_risk)
    return 0.0


class IncidentStore:
    def __init__(self) -> None:
        self._incidents: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()

    async def add(
        self,
        *,
        transcript: str,
        gps: dict[str, float],
        urgency: str,
        escalated: bool,
        ward_risk: Any,
        report: str = "",
        legitimate: bool = True,
        source: str = "api",
    ) -> dict[str, Any]:
        record = {
            "id": str(uuid.uuid4()),
            "transcript": transcript,
            "gps": {"lat": gps["lat"], "lng": gps["lng"]},
            "urgency": urgency,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "escalated": escalated,
            "ward_risk": _ward_risk_score(ward_risk),
            "report": (report or "")[:500],
            "legitimate": legitimate,
            "source": source,
        }
        async with self._lock:
            self._incidents.append(record)
            if len(self._incidents) > _MAX_INCIDENTS:
                self._incidents = self._incidents[-_MAX_INCIDENTS :]
        return record

    async def list_incidents(self, limit: int = 100) -> list[dict[str, Any]]:
        async with self._lock:
            return list(reversed(self._incidents[-limit:]))


incident_store = IncidentStore()
