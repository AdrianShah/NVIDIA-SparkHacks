# Person 1 — GPU & Inference · Scratchdown

**Owner:** Person 1 (you)  
**Goal:** Local VLM at `:8000/v1` + Whisper STT + Kokoro TTS, with verification scripts passing on GB10.  
**DRD:** [CivicVox-Omni_DRD_v2.md](CivicVox-Omni_DRD_v2.md) §4, §9.2  
**Repo status:** Code + docs landed; **hardware verification still required on GB10**.

---

## What you own (and do not touch)

| Own | Do not own |
|-----|------------|
| NIM / vLLM / Ollama on port **8000** | `backend/server.py` (Person 2) |
| `backend/inference/whisper_pipeline.py` | `backend/agents/civic_vox_graph.py` (Person 3) |
| `backend/inference/kokoro_pipeline.py` | `backend/data/*` (Person 4) |
| `scripts/check_gpu.py`, `test_*.py` | `frontend/*` (Person 5) |
| Share `LOCAL_LLM_URL` with team | MOCK_MODE, WebSocket, incident API |

---

## Architecture (your box)

```
[Laptop]  scripts + docs + git
     │
     ▼
[GB10]  :8000  NIM/vLLM/Ollama  ──► Person 3 agents (LOCAL_LLM_URL)
        :8080  (Person 2 gateway imports your speech modules)
        CUDA   Whisper large-v3
        CPU    Kokoro ONNX
```

---

## Phase 0 — Laptop (before / parallel to GB10)

- [ ] Clone repo, open `Person1-Scratchdown.md` (this file)
- [ ] Copy env: `cp .env.example .env`
- [ ] Install inference deps: `pip install -r requirements-inference.txt`
- [ ] (Optional) Ollama smoke test on laptop:
  ```bash
  ollama serve
  ollama pull llama3.2-vision
  ```
  Set in `.env`:
  ```
  LOCAL_LLM_URL=http://localhost:11434/v1
  LOCAL_LLM_MODEL=llama3.2-vision
  ```
  ```bash
  python scripts/test_vlm.py
  ```
- [ ] Download Kokoro assets into `backend/inference/models/`:
  - `kokoro-v0_19.onnx`
  - `voices.bin`  
  Source: https://github.com/thewh1teagle/kokoro-onnx
- [ ] Commit **no** `.env`, **no** model weights, **no** `NGC_API_KEY`

**Already in repo (no rebuild needed):**

- `backend/inference/whisper_pipeline.py`
- `backend/inference/kokoro_pipeline.py`
- `backend/server.py` imports your modules (Person 2 handshake done)
- `requirements-inference.txt`, `docker-compose.yml` (`nim` profile)
- README Person 1 section

---

## Phase 1 — GB10 Hour 0–1 · GPU alive

**Done when:** `python scripts/check_gpu.py` exits **0**

```bash
ssh <gb10-user>@<gb10-ip>
cd /path/to/Nvidia-Hackathon   # or civicvox-omni

python scripts/check_gpu.py
nvidia-smi
```

| Check | Expected |
|-------|----------|
| `nvidia-smi` | GB10 visible, driver OK |
| VRAM | Enough for 11B vision (~8 GB+ with quant) |

**If FAIL:** fix drivers before anything else. No agents will work.

---

## Phase 2 — GB10 Hour 1–3 · VLM live (critical path)

**Done when:** `python scripts/test_vlm.py` exits **0** (text + vision)

### 2A — NIM (preferred)

```bash
export NGC_API_KEY=<your-ngc-key>

docker compose --profile inference up nim
# OR one-shot:
docker run --gpus all --rm \
  -e NGC_API_KEY=$NGC_API_KEY \
  -p 8000:8000 \
  nvcr.io/nim/meta/llama-3.2-11b-vision-instruct
```

`.env` on GB10:

```
LOCAL_LLM_URL=http://localhost:8000/v1
LOCAL_LLM_MODEL=meta/llama-3.2-11b-vision-instruct
NGC_API_KEY=<key>
```

```bash
pip install -r requirements-inference.txt
python scripts/test_vlm.py
```

### 2B — vLLM (if NIM fails)

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.2-11B-Vision-Instruct \
  --port 8000
```

Same `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL`, rerun `test_vlm.py`.

### 2C — Handshake Hour 3 (mandatory)

Post in team chat (replace IP):

```
LOCAL_LLM_URL=http://192.168.x.x:8000/v1
LOCAL_LLM_MODEL=meta/llama-3.2-11b-vision-instruct
```

Person 2 and Person 3 update their `.env` on GB10.

| Person | Action |
|--------|--------|
| P2 | Set `LOCAL_LLM_URL`, restart `uvicorn backend.server:app --host 0.0.0.0 --port 8080` |
| P3 | Same env; run one `civic_vox_engine` smoke test |
| P5 | Only needs P2’s `:8080` LAN IP (not :8000) |

- [ ] Hour 3 handshake posted
- [ ] P2/P3 confirm they can hit completions (or full incident)

---

## Phase 3 — GB10 Hour 5–8 · Speech pipelines

**Done when:** `test_whisper.py` and `test_kokoro.py` exit **0**, and P2 health shows both true

```bash
pip install -r requirements-inference.txt
# Kokoro files must exist:
ls backend/inference/models/kokoro-v0_19.onnx
ls backend/inference/models/voices.bin

python scripts/test_whisper.py
python scripts/test_kokoro.py
# Plays: civicvox_kokoro_test.wav in repo root
```

Person 2 verification:

```bash
uvicorn backend.server:app --host 0.0.0.0 --port 8080
curl http://localhost:8080/api/health
```

Expect:

```json
"models_loaded": { "whisper": true, "kokoro": true }
```

| Target (DRD) | How to check |
|--------------|--------------|
| Whisper &lt; 300 ms / 10 s audio | Time `test_whisper.py` with a real 10 s WAV later |
| Kokoro &lt; 100 ms / sentence | `test_kokoro.py` prints elapsed ms |

- [ ] Whisper loaded on CUDA
- [ ] Kokoro WAV generated
- [ ] P2 `/api/health` shows whisper + kokoro true
- [ ] Hour 5 handshake: P2 confirms `transcribe_audio` import works

---

## Phase 4 — GB10 Hour 10–12 · Integration + demo

- [ ] Full chain: P5 camera → P2 `/api/incident` → P3 graph → map + report
- [ ] `python scripts/test_vlm.py` still passes under load
- [ ] Demo script: run `nvidia-smi` on GB10 during pitch (DRD §14)
- [ ] Note GB10 LAN IP on whiteboard: inference `:8000`, gateway `:8080`, frontend `:3000`

**Freeze at Hour 12:** no changes to inference port, model name, or `backend/inference` public API.

---

## Public API contract (do not break)

Person 2 imports only:

```python
from backend.inference.whisper_pipeline import load_whisper, transcribe_audio, is_whisper_loaded
from backend.inference.kokoro_pipeline import load_kokoro, synthesize_speech, is_kokoro_loaded
```

```python
transcribe_audio(pcm_bytes: bytes, *, sample_rate: int = 16000) -> str
synthesize_speech(text: str, *, voice: str = "af_bella") -> bytes  # WAV
```

Person 3 needs only env:

```
LOCAL_LLM_URL=http://<GB10-LAN-IP>:8000/v1
LOCAL_LLM_MODEL=meta/llama-3.2-11b-vision-instruct
```

---

## File checklist

| Path | Status |
|------|--------|
| `backend/inference/whisper_pipeline.py` | Done |
| `backend/inference/kokoro_pipeline.py` | Done |
| `backend/inference/models/kokoro-v0_19.onnx` | **You download** |
| `backend/inference/models/voices.bin` | **You download** |
| `scripts/check_gpu.py` | Done |
| `scripts/test_vlm.py` | Done |
| `scripts/test_whisper.py` | Done |
| `scripts/test_kokoro.py` | Done |
| `requirements-inference.txt` | Done |
| `docker-compose.yml` (`nim` profile) | Done |
| `.env` (local, gitignored) | **You create** |

---

## Success criteria (Person 1 complete)

- [ ] `POST <GB10>:8000/v1/chat/completions` — text OK
- [ ] Same endpoint — image + text OK (`test_vlm.py`)
- [ ] `test_whisper.py` — exit 0 on GB10 CUDA
- [ ] `test_kokoro.py` — playable WAV
- [ ] `GET <GB10>:8080/api/health` → `whisper: true`, `kokoro: true`
- [ ] Team has `LOCAL_LLM_URL` with LAN IP

---

## If something breaks

| Problem | Fix |
|---------|-----|
| NIM won’t start | Switch to vLLM (Phase 2B); keep port 8000 |
| `test_vlm.py` connection refused | Container not up or wrong `LOCAL_LLM_URL` |
| `whisper: false` in health | No CUDA / drivers; run on GB10 not laptop |
| `kokoro: false` in health | Missing ONNX files in `backend/inference/models/` |
| Vision JSON garbage | Person 3 issue (prompts); your VLM is fine if `test_vlm.py` passes |
| Ollama on laptop only | Fine for dev; **demo must use GB10 NIM/vLLM** |

---

## One-page command sheet (GB10 day-of)

```bash
# 1 GPU
python scripts/check_gpu.py

# 2 VLM
export NGC_API_KEY=...
docker compose --profile inference up -d nim
python scripts/test_vlm.py

# 3 Speech
python scripts/test_whisper.py
python scripts/test_kokoro.py

# 4 Tell team
hostname -I   # use this IP in LOCAL_LLM_URL

# 5 With Person 2
curl http://localhost:8080/api/health
```

---

*Last updated: implementation pass complete — run Phases 1–4 on GB10 to close Person 1.*
