# Person 1 verification scripts

Run from the repo root after `pip install -r requirements-inference.txt` and copying `.env.example` to `.env`.

| Script | Where | Purpose |
|--------|-------|---------|
| `check_gpu.py` | GB10 | `nvidia-smi` + optional PyTorch CUDA |
| `test_vlm.py` | GB10 (or laptop + Ollama) | Text + vision `chat/completions` |
| `test_whisper.py` | GB10 + CUDA | Faster-Whisper pipeline |
| `test_kokoro.py` | Any CPU | Kokoro WAV output |

## GB10 checklist (Person 1)

1. `python scripts/check_gpu.py` → exit 0
2. Start NIM: `docker compose --profile inference up nim`
3. `python scripts/test_vlm.py` → exit 0
4. Place Kokoro files in `backend/inference/models/`
5. `python scripts/test_whisper.py` and `python scripts/test_kokoro.py`
6. Share `LOCAL_LLM_URL=http://<LAN-IP>:8000/v1` with the team
