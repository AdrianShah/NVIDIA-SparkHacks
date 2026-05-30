"""Person 1 — local STT/TTS inference pipelines (Whisper + Kokoro)."""

from backend.inference.kokoro_pipeline import (
    is_kokoro_loaded,
    load_kokoro,
    synthesize_speech,
)
from backend.inference.whisper_pipeline import (
    is_whisper_loaded,
    load_whisper,
    transcribe_audio,
)

__all__ = [
    "load_whisper",
    "transcribe_audio",
    "is_whisper_loaded",
    "load_kokoro",
    "synthesize_speech",
    "is_kokoro_loaded",
]
