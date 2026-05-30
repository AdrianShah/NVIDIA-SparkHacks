"""
CivicVox-Omni API Gateway.

Person 2 owns this FastAPI boundary. It is the only network-facing process:
frontend requests enter here, STT/TTS adapters are called here, and the
LangGraph engine is treated as an importable black box.
"""
import datetime
import io
import logging
import math
import os
import struct
from contextlib import asynccontextmanager
from enum import Enum
from typing import Any, Optional

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field, field_validator

from backend.agents.civic_vox_graph import AgentState, civic_vox_engine
from backend.data import toronto_loader

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger(__name__)

MOCK_MODE = os.environ.get("MOCK_MODE", "false").lower() in {"1", "true", "yes", "on"}

_whisper_model = None
_kokoro_model = None


class TelemetryStatus(str, Enum):
    active = "active"
    complete = "complete"
    error = "error"


class GpsPayload(BaseModel):
    lat: float = Field(default=43.6532, ge=-90, le=90)
    lng: float = Field(default=-79.3832, ge=-180, le=180)


class IncidentRequest(BaseModel):
    transcript: str = Field(..., min_length=1)
    frame_b64: Optional[str] = None
    gps: GpsPayload = Field(default_factory=GpsPayload)

    @field_validator("transcript")
    @classmethod
    def transcript_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("transcript must not be blank")
        return value


class IncidentResponse(BaseModel):
    report: str
    urgency: str
    vision: dict[str, Any]
    spatial: dict[str, Any]


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1)

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


class HealthResponse(BaseModel):
    status: str
    mock_mode: bool
    models_loaded: dict[str, bool]
    spatial_data: dict[str, int]


class TelemetryEvent(BaseModel):
    node: str
    status: TelemetryStatus
    timestamp: str
    data: Optional[dict[str, Any]] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _whisper_model, _kokoro_model

    logger.info("Loading Toronto Open Data into memory...")
    try:
        toronto_loader.load_all()
    except Exception as exc:
        logger.warning("Spatial loader unavailable (%s) - gateway will continue", exc)
    logger.info("Spatial data ready")

    if MOCK_MODE:
        logger.info("MOCK_MODE enabled - skipping STT/TTS model loading")
    else:
        try:
            from faster_whisper import WhisperModel

            _whisper_model = WhisperModel("large-v3", device="cuda", compute_type="float16")
            logger.info("Whisper large-v3 loaded on CUDA")
        except Exception as exc:
            logger.warning("Whisper unavailable (%s) - STT passthrough mode", exc)

        try:
            from kokoro_onnx import Kokoro

            _kokoro_model = Kokoro("kokoro-v0_19.onnx", "voices.bin")
            logger.info("Kokoro-82M TTS loaded")
        except Exception as exc:
            logger.warning("Kokoro unavailable (%s) - using fallback WAV tone", exc)

    yield
    logger.info("Shutting down")


app = FastAPI(title="CivicVox-Omni", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def transcribe_audio(pcm_bytes: bytes) -> str:
    if _whisper_model is None or not pcm_bytes:
        return ""
    try:
        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = _whisper_model.transcribe(audio, beam_size=5, language="en")
        return " ".join(seg.text.strip() for seg in segments)
    except Exception as exc:
        logger.warning("Transcription error: %s", exc)
        return ""


def _fallback_wav(text: str) -> bytes:
    sample_rate = 16000
    duration_seconds = min(1.2, max(0.25, len(text) / 220))
    frame_count = int(sample_rate * duration_seconds)
    amplitude = 4500
    frequency = 440

    buf = io.BytesIO()
    import wave

    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(frame_count):
            sample = int(amplitude * math.sin(2 * math.pi * frequency * i / sample_rate))
            frames.extend(struct.pack("<h", sample))
        wf.writeframes(bytes(frames))
    return buf.getvalue()


def synthesize_speech(text: str) -> bytes:
    if _kokoro_model is None:
        return _fallback_wav(text)
    try:
        import wave

        samples, sample_rate = _kokoro_model.create(text, voice="af_bella", speed=1.0, lang="en-us")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes((samples * 32767).astype(np.int16).tobytes())
        return buf.getvalue()
    except Exception as exc:
        logger.warning("TTS error: %s", exc)
        return _fallback_wav(text)


def _build_initial_state(req: IncidentRequest) -> AgentState:
    return AgentState(
        messages=[HumanMessage(content=req.transcript)],
        video_frames_base64=[req.frame_b64] if req.frame_b64 else [],
        gps_coordinates={"lat": req.gps.lat, "lng": req.gps.lng},
        vision_analysis={},
        spatial_data_results={},
        next_step="orchestrator",
        urgency_level="HIGH",
        final_dispatch_report="",
    )


def _mock_incident_response() -> IncidentResponse:
    return IncidentResponse(
        urgency="CRITICAL",
        report=(
            "THREAT: Flash flooding - Category 3. Dispatch fire rescue and utilities. "
            "Keep civilians away from basement electrical panels and route crews via Spadina Ave."
        ),
        vision={
            "hazard_type": "Flooding",
            "severity_scale": 7,
            "water_depth_m": 0.4,
            "structural_risk": False,
            "location_cues": "Brick residential building, north-facing",
        },
        spatial={
            "closest_hydrant": {
                "id": 1042,
                "distance_meters": 38.5,
                "status": "Operational",
            },
            "closest_hydrants": [
                {"id": 1042, "distance_meters": 38.5, "status": "Operational"},
                {"id": 1088, "distance_meters": 74.2, "status": "Operational"},
                {"id": 1170, "distance_meters": 96.7, "status": "Maintenance due"},
            ],
            "building_specs": {
                "address": "123 Example St",
                "floors": 12,
                "contact": "Toronto Housing Corp",
                "last_inspection": "2025-11-14",
            },
            "nearest_road": {"road_name": "Spadina Ave", "distance_meters": 12.0},
        },
    )


def _mock_agent_update() -> dict[str, Any]:
    response = _mock_incident_response()
    return {
        "urgency_level": response.urgency,
        "vision_analysis": response.vision,
        "spatial_data_results": response.spatial,
        "final_dispatch_report": response.report,
        "next_step": "END",
    }


def _timestamp() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _event(node: str, status: TelemetryStatus, data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    return TelemetryEvent(node=node, status=status, timestamp=_timestamp(), data=data).model_dump(exclude_none=True)


def _result_to_response(result: dict[str, Any]) -> IncidentResponse:
    return IncidentResponse(
        report=result.get("final_dispatch_report", ""),
        urgency=result.get("urgency_level", "HIGH"),
        vision=result.get("vision_analysis") or {},
        spatial=result.get("spatial_data_results") or {},
    )


@app.get("/api/health", response_model=HealthResponse)
async def health():
    return {
        "status": "ok",
        "mock_mode": MOCK_MODE,
        "models_loaded": {
            "whisper": _whisper_model is not None,
            "kokoro": _kokoro_model is not None,
        },
        "spatial_data": {
            "hydrants": len(toronto_loader._hydrants_gdf) if toronto_loader._hydrants_gdf is not None else 0,
            "buildings": len(toronto_loader._buildings_gdf) if toronto_loader._buildings_gdf is not None else 0,
        },
    }


@app.post("/api/incident", response_model=IncidentResponse)
async def process_incident(req: IncidentRequest):
    if MOCK_MODE:
        return _mock_incident_response()

    initial_state = _build_initial_state(req)
    try:
        result = await civic_vox_engine.ainvoke(initial_state)
    except Exception as exc:
        logger.exception("Agent engine failed")
        raise HTTPException(status_code=503, detail="agent engine unavailable") from exc

    return _result_to_response(result)


@app.post("/api/synthesize")
async def synthesize(req: SynthesizeRequest):
    wav_bytes = synthesize_speech(req.text)
    return Response(content=wav_bytes, media_type="audio/wav")


@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected")

    try:
        while True:
            data = await websocket.receive_json()
            req = IncidentRequest(
                transcript=data.get("transcript") or "Emergency incident reported",
                frame_b64=data.get("frame_b64"),
                gps=GpsPayload(
                    lat=data.get("gps", {}).get("lat", 43.6532),
                    lng=data.get("gps", {}).get("lng", -79.3832),
                ),
            )

            if MOCK_MODE:
                for node in ("orchestrator", "vision", "localizer", "compiler"):
                    await websocket.send_json(_event(node, TelemetryStatus.active))
                    await websocket.send_json(_event(node, TelemetryStatus.complete))
                await websocket.send_json(_event("compiler", TelemetryStatus.complete, _mock_agent_update()))
                continue

            initial_state = _build_initial_state(req)
            async for event in civic_vox_engine.astream(initial_state, stream_mode="updates"):
                for node_name, node_output in event.items():
                    await websocket.send_json(_event(node_name, TelemetryStatus.active))
                    await websocket.send_json(
                        _event(
                            node_name,
                            TelemetryStatus.complete,
                            {
                                k: v for k, v in node_output.items()
                                if k not in ("messages", "video_frames_base64")
                            },
                        )
                    )

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as exc:
        logger.error("WebSocket error: %s", exc)
        try:
            await websocket.send_json(_event("gateway", TelemetryStatus.error, {"detail": str(exc)}))
        except Exception:
            pass
        await websocket.close(code=1011)


if __name__ == "__main__":
    uvicorn.run(
        "backend.server:app",
        host="0.0.0.0",
        port=8080,
        reload=False,
        log_level="info",
    )
