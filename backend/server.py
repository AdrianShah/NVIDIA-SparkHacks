"""
CivicVox-Omni API Gateway — FastAPI entry point.
Runs on 0.0.0.0:8080. All other components communicate via local Python calls.
"""
import datetime
import io
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from backend.agents.civic_vox_graph import AgentState, civic_vox_engine
from backend.data import toronto_loader

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger(__name__)

_whisper_model = None
_kokoro_model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _whisper_model, _kokoro_model

    logger.info("Loading Toronto Open Data into memory...")
    toronto_loader.load_all()
    logger.info("Spatial data ready")

    try:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel("large-v3", device="cuda", compute_type="float16")
        logger.info("Whisper large-v3 loaded on CUDA")
    except Exception as exc:
        logger.warning("Whisper unavailable (%s) — STT passthrough mode", exc)

    try:
        from kokoro_onnx import Kokoro
        _kokoro_model = Kokoro("kokoro-v0_19.onnx", "voices.bin")
        logger.info("Kokoro-82M TTS loaded")
    except Exception as exc:
        logger.warning("Kokoro unavailable (%s) — TTS disabled", exc)

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


# ── Pydantic models ───────────────────────────────────────────────────────────

class GpsPayload(BaseModel):
    lat: float = 43.6532
    lng: float = -79.3832


class IncidentRequest(BaseModel):
    transcript: str = ""
    frame_b64: Optional[str] = None
    gps: GpsPayload = GpsPayload()


class SynthesizeRequest(BaseModel):
    text: str


# ── Speech helpers ────────────────────────────────────────────────────────────

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


def synthesize_speech(text: str) -> bytes:
    if _kokoro_model is None:
        return b""
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
        return b""


def _build_initial_state(req: IncidentRequest) -> AgentState:
    return AgentState(
        messages=[HumanMessage(content=req.transcript or "Emergency incident reported")],
        video_frames_base64=[req.frame_b64] if req.frame_b64 else [],
        gps_coordinates={"lat": req.gps.lat, "lng": req.gps.lng},
        vision_analysis={},
        spatial_data_results={},
        next_step="orchestrator",
        urgency_level="HIGH",
        final_dispatch_report="",
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": {
            "whisper": _whisper_model is not None,
            "kokoro": _kokoro_model is not None,
        },
        "spatial_data": {
            "hydrants": len(toronto_loader._hydrants_gdf) if toronto_loader._hydrants_gdf is not None else 0,
            "buildings": len(toronto_loader._buildings_gdf) if toronto_loader._buildings_gdf is not None else 0,
        },
    }


@app.post("/api/incident")
async def process_incident(req: IncidentRequest):
    initial_state = _build_initial_state(req)
    result = await civic_vox_engine.ainvoke(initial_state)

    return {
        "report": result["final_dispatch_report"],
        "urgency": result["urgency_level"],
        "vision": result["vision_analysis"],
        "spatial": result["spatial_data_results"],
    }


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
                transcript=data.get("transcript", ""),
                frame_b64=data.get("frame_b64"),
                gps=GpsPayload(
                    lat=data.get("gps", {}).get("lat", 43.6532),
                    lng=data.get("gps", {}).get("lng", -79.3832),
                ),
            )
            initial_state = _build_initial_state(req)

            # Stream node-completion events to the frontend
            async for event in civic_vox_engine.astream(initial_state, stream_mode="updates"):
                for node_name, node_output in event.items():
                    msg = {
                        "node": node_name,
                        "status": "complete",
                        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                        "data": {
                            k: v for k, v in node_output.items()
                            if k not in ("messages", "video_frames_base64")
                        },
                    }
                    await websocket.send_json(msg)

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as exc:
        logger.error("WebSocket error: %s", exc)
        await websocket.close(code=1011)


if __name__ == "__main__":
    uvicorn.run(
        "backend.server:app",
        host="0.0.0.0",
        port=8080,
        reload=False,
        log_level="info",
    )
