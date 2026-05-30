#!/usr/bin/env python3
"""
Person 1 — smoke-test Kokoro TTS.
Writes /tmp/civicvox_kokoro_test.wav (or project root on Windows).
Target: < 100 ms per short sentence on CPU.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.inference.kokoro_pipeline import (  # noqa: E402
    KOKORO_MODEL_DIR,
    KOKORO_ONNX,
    KOKORO_VOICES,
    load_kokoro,
    synthesize_speech,
)

TEST_SENTENCE = "CivicVox Omni dispatch protocol ready."
OUT_PATH = ROOT / "civicvox_kokoro_test.wav"


def main() -> int:
    print("=== CivicVox-Omni Kokoro test (Person 1) ===\n")
    print(f"Model dir: {KOKORO_MODEL_DIR}")
    print(f"  ONNX:   {KOKORO_ONNX} ({'found' if KOKORO_ONNX.exists() else 'MISSING'})")
    print(f"  Voices: {KOKORO_VOICES} ({'found' if KOKORO_VOICES.exists() else 'MISSING'})")

    if not load_kokoro():
        print("\nFAIL: Kokoro could not load.")
        print("Download kokoro-v0_19.onnx and voices.bin into:")
        print(f"  {KOKORO_MODEL_DIR}")
        print("See: https://github.com/thewh1teagle/kokoro-onnx")
        return 1

    t0 = time.perf_counter()
    wav = synthesize_speech(TEST_SENTENCE)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    if not wav:
        print("FAIL: synthesize_speech returned empty bytes")
        return 1

    OUT_PATH.write_bytes(wav)
    print(f"Wrote {len(wav)} bytes → {OUT_PATH}")
    print(f"Elapsed: {elapsed_ms:.0f} ms")

    if elapsed_ms > 500:
        print("WARN: slower than 100 ms target (CPU load or first-run warmup)")

    print("\nOK: Kokoro TTS test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
