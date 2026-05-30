#!/usr/bin/env python3
"""
Person 1 — smoke-test Faster-Whisper STT.
Generates 2s of 440 Hz tone PCM if no sample file provided.
Target: transcribe ~10s clip in < 300 ms on GB10 (informal benchmark).
"""
from __future__ import annotations

import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.inference.whisper_pipeline import load_whisper, transcribe_audio  # noqa: E402

SAMPLE_RATE = 16000
DURATION_SEC = 2.0


def _generate_tone_pcm(duration_sec: float = DURATION_SEC, freq_hz: float = 440.0) -> bytes:
    n = int(SAMPLE_RATE * duration_sec)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        val = int(16000 * 0.3 * __import__("math").sin(2 * 3.14159265 * freq_hz * t))
        samples.append(struct.pack("<h", max(-32768, min(32767, val))))
    return b"".join(samples)


def main() -> int:
    print("=== CivicVox-Omni Whisper test (Person 1) ===\n")

    if not load_whisper():
        print("FAIL: Whisper could not load (CUDA/drivers required on GB10).")
        print("  pip install faster-whisper")
        return 1

    pcm = _generate_tone_pcm()
    print(f"Input: {len(pcm)} bytes ({DURATION_SEC}s synthetic tone @ {SAMPLE_RATE} Hz)")

    t0 = time.perf_counter()
    text = transcribe_audio(pcm, sample_rate=SAMPLE_RATE)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    print(f"Transcript: {text!r}")
    print(f"Elapsed: {elapsed_ms:.0f} ms")

    # Tone may not produce meaningful words; success = pipeline ran without error
    print("\nOK: Whisper pipeline executed (empty transcript on tone-only audio is expected)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
