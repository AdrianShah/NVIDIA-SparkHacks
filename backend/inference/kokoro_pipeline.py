"""
Kokoro-82M ONNX TTS pipeline (Person 1).
Model files: kokoro-v0_19.onnx + voices.bin in KOKORO_MODEL_DIR.
"""
import io
import logging
import os
import wave
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

_kokoro_model: Any = None

_MODULE_DIR = Path(__file__).resolve().parent
_DEFAULT_MODEL_DIR = _MODULE_DIR / "models"
KOKORO_MODEL_DIR = Path(os.environ.get("KOKORO_MODEL_DIR", _DEFAULT_MODEL_DIR))
KOKORO_ONNX = KOKORO_MODEL_DIR / "kokoro-v0_19.onnx"
KOKORO_VOICES = KOKORO_MODEL_DIR / "voices.bin"


def is_kokoro_loaded() -> bool:
    return _kokoro_model is not None


def model_paths() -> tuple[Path, Path]:
    return KOKORO_ONNX, KOKORO_VOICES


def load_kokoro() -> bool:
    """Load Kokoro ONNX on CPU. Returns True if loaded successfully."""
    global _kokoro_model
    if _kokoro_model is not None:
        return True
    if not KOKORO_ONNX.exists() or not KOKORO_VOICES.exists():
        logger.warning(
            "Kokoro model files missing. Expected:\n  %s\n  %s\n"
            "Download from https://github.com/thewh1teagle/kokoro-onnx "
            "or set KOKORO_MODEL_DIR.",
            KOKORO_ONNX,
            KOKORO_VOICES,
        )
        return False
    try:
        from kokoro_onnx import Kokoro

        _kokoro_model = Kokoro(str(KOKORO_ONNX), str(KOKORO_VOICES))
        logger.info("Kokoro-82M TTS loaded from %s", KOKORO_MODEL_DIR)
        return True
    except Exception as exc:
        logger.warning("Kokoro unavailable (%s) — TTS disabled", exc)
        _kokoro_model = None
        return False


def synthesize_speech(text: str, *, voice: str = "af_bella") -> bytes:
    """Synthesize text to WAV bytes. Returns empty bytes if unavailable."""
    if not text.strip():
        return b""
    if _kokoro_model is None and not load_kokoro():
        return b""
    try:
        samples, sample_rate = _kokoro_model.create(
            text, voice=voice, speed=1.0, lang="en-us"
        )
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
