#!/usr/bin/env python3
"""
Person 1 — smoke-test local VLM at OPENAI-compatible /v1/chat/completions.
Usage:
  set LOCAL_LLM_URL=http://localhost:8000/v1
  set LOCAL_LLM_MODEL=meta/llama-3.2-11b-vision-instruct   # NIM
  python scripts/test_vlm.py
"""
from __future__ import annotations

import base64
import io
import os
import sys
import time

import httpx

LOCAL_LLM_URL = os.environ.get("LOCAL_LLM_URL", "http://localhost:8000/v1").rstrip("/")
LOCAL_LLM_MODEL = os.environ.get("LOCAL_LLM_MODEL", "meta/llama-3.2-11b-vision-instruct")
CHAT_URL = f"{LOCAL_LLM_URL}/chat/completions"

VISION_PROMPT = """Analyse this emergency frame. Output ONLY valid JSON:
{"hazard_type": "test", "severity_scale": 1, "water_depth_m": null, "structural_risk": false, "location_cues": "smoke test"}"""


def _tiny_jpeg_b64() -> str:
    try:
        from PIL import Image

        img = Image.new("RGB", (64, 64), color=(180, 40, 40))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except ImportError:
        # Minimal valid JPEG header + padding (may not decode everywhere)
        minimal = (
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
            "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh"
            "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR"
            "CAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAA"
            "AAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMB"
            "AAIRAxEAPwCwAA8A/9k="
        )
        return minimal


def _post(payload: dict) -> dict:
    with httpx.Client(timeout=120.0) as client:
        r = client.post(CHAT_URL, json=payload)
        r.raise_for_status()
        return r.json()


def test_text() -> bool:
    print(f"\n[1/2] Text completion → {CHAT_URL}")
    t0 = time.perf_counter()
    data = _post(
        {
            "model": LOCAL_LLM_MODEL,
            "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
            "max_tokens": 16,
            "temperature": 0,
        }
    )
    elapsed = time.perf_counter() - t0
    content = data["choices"][0]["message"]["content"]
    print(f"  Response: {content[:200]!r}")
    print(f"  Elapsed: {elapsed:.2f}s")
    return bool(content.strip())


def test_vision() -> bool:
    print(f"\n[2/2] Multimodal completion → {CHAT_URL}")
    b64 = _tiny_jpeg_b64()
    t0 = time.perf_counter()
    data = _post(
        {
            "model": LOCAL_LLM_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                    ],
                }
            ],
            "max_tokens": 256,
            "temperature": 0,
        }
    )
    elapsed = time.perf_counter() - t0
    content = data["choices"][0]["message"]["content"]
    print(f"  Response: {content[:300]!r}")
    print(f"  Elapsed: {elapsed:.2f}s")
    return bool(content.strip())


def main() -> int:
    print("=== CivicVox-Omni VLM test (Person 1) ===")
    print(f"  URL:   {LOCAL_LLM_URL}")
    print(f"  Model: {LOCAL_LLM_MODEL}")

    try:
        ok_text = test_text()
        ok_vision = test_vision()
    except httpx.ConnectError:
        print(f"\nFAIL: Cannot connect to {CHAT_URL}")
        print("Start NIM/vLLM/Ollama first (see README Person 1 section).")
        return 1
    except httpx.HTTPStatusError as exc:
        print(f"\nFAIL: HTTP {exc.response.status_code}: {exc.response.text[:500]}")
        return 1
    except Exception as exc:
        print(f"\nFAIL: {exc}")
        return 1

    if ok_text and ok_vision:
        print("\nOK: VLM text + vision tests passed")
        return 0
    print("\nFAIL: Empty model response")
    return 1


if __name__ == "__main__":
    sys.exit(main())
