#!/usr/bin/env python3
"""Person 1 — verify GPU visibility (nvidia-smi + optional CUDA import)."""
from __future__ import annotations

import shutil
import subprocess
import sys


def main() -> int:
    print("=== CivicVox-Omni GPU check (Person 1) ===\n")

    if not shutil.which("nvidia-smi"):
        print("FAIL: nvidia-smi not found. Install NVIDIA drivers on the GB10.")
        return 1

    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print("FAIL: nvidia-smi exited with error")
        print(result.stderr or result.stdout)
        return 1

    print("GPU(s):")
    for line in result.stdout.strip().splitlines():
        print(f"  {line.strip()}")

    try:
        import torch

        if torch.cuda.is_available():
            print(f"\nPyTorch CUDA: available ({torch.cuda.get_device_name(0)})")
        else:
            print("\nPyTorch CUDA: not available (Whisper may still work via faster-whisper)")
    except ImportError:
        print("\nPyTorch: not installed (optional; faster-whisper uses its own CUDA backend)")

    print("\nOK: GPU check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
