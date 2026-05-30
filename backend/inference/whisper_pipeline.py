"""
Faster-Whisper Large-v3 STT pipeline (Person 1).
Expects 16-bit PCM mono audio; default sample rate 16000 Hz.
"""
import logging
import os
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

_whisper_model: Any = None

WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "large-v3")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "float16")


def is_whisper_loaded() -> bool:
    return _whisper_model is not None


def load_whisper() -> bool:
    """Load Whisper on CUDA. Returns True if loaded successfully."""
    global _whisper_model
    if _whisper_model is not None:
        return True
    try:
        from faster_whisper import WhisperModel

        _whisper_model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
        logger.info("Whisper %s loaded on %s", WHISPER_MODEL_SIZE, WHISPER_DEVICE)
        return True
    except Exception as exc:
        logger.warning("Whisper unavailable (%s) — STT disabled", exc)
        _whisper_model = None
        return False


def transcribe_audio(pcm_bytes: bytes, *, sample_rate: int = 16000) -> str:
    """
    Transcribe raw PCM int16 mono bytes to text.
    Returns empty string if model unavailable or input empty.
    """
    if not pcm_bytes:
        return ""
    if _whisper_model is None and not load_whisper():
        return ""
    try:
        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = _whisper_model.transcribe(
            audio,
            beam_size=5,
            language="en",
        )
        return " ".join(seg.text.strip() for seg in segments)
    except Exception as exc:
        logger.warning("Transcription error: %s", exc)
        return ""
