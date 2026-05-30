# CivicVox-Omni

**Local-first, ultra-low-latency multimodal emergency intelligence — NVIDIA Spark Hack Toronto 2026**

> A citizen or first responder points their phone camera at a flooding basement. Within 100 ms, a local GB10 edge node classifies the hazard, surfaces the 3 nearest operational fire hydrants from Toronto Open Data, cross-references the building's RentSafeTO compliance record, and streams a military-grade dispatch protocol to the city coordinator's dashboard — with zero cloud dependency.

---

## Architecture

```
Mobile Browser (video + audio + GPS)
        │  POST /api/incident  (HTTP polling)
        │  WS  /ws/stream      (live telemetry)
        ▼
FastAPI Gateway  ──── Faster-Whisper (STT)
        │              Kokoro-82M    (TTS)
        ▼
LangGraph State Machine
  ┌─ Orchestrator ──► Vision Agent (Llama-3.2-11B-Vision via NIM)
  │                         │
  └──────────────────► Localizer Agent (GeoPandas R-tree · Toronto Open Data)
                                │
                          Report Compiler (Llama-3.2-11B via NIM)
                                │
                          Dispatch Report
        │
        ▼
Next.js Dashboard  ── Mapbox GL JS map + agent telemetry + typewriter report
```

## Tech Stack

| Layer | Technology |
|---|---|
| Local AI Inference | NVIDIA NIM · TensorRT-LLM (INT4/FP8) · Faster-Whisper · Kokoro-82M ONNX |
| Agent Orchestration | LangGraph · LangChain · GeoPandas · R-tree spatial index |
| API Gateway | FastAPI · Uvicorn · WebSocket · Pydantic |
| Frontend | Next.js 14 · TypeScript · Tailwind CSS · Framer Motion · Mapbox GL JS |

## Quick Start

### 1 — Download Toronto Open Data (do this before the event)

```bash
cd civicvox-omni
python -m backend.data.download_toronto_data
```

Downloads ~150–300 MB into `backend/data/`:
- `fire-hydrants.geojson`
- `apartment-building-evaluation.json`
- `toronto-centreline.geojson`
- `311-service-requests.csv`

### 2 — Start the local inference server (GB10)

**Option A — NVIDIA NIM (recommended):**
```bash
docker run --gpus all --rm \
  -e NGC_API_KEY=$NGC_API_KEY \
  -p 8000:8000 \
  nvcr.io/nim/meta/llama-3.2-11b-vision-instruct
```

**Option B — vLLM:**
```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.2-11B-Vision-Instruct \
  --port 8000
```

**Option C — Ollama (dev/testing):**
```bash
ollama serve && ollama pull llama3.2-vision
```

### 3 — Start the backend

```bash
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set LOCAL_LLM_URL to the inference server
source .env
uvicorn backend.server:app --host 0.0.0.0 --port 8080
```

### 4 — Start the frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
# Edit .env.local: set NEXT_PUBLIC_API_URL to GB10's LAN IP, add Mapbox token
npm run dev
# Opens at http://localhost:3000
```

### 5 — Demo

1. Open `http://localhost:3000` on the demo laptop and on a phone (same Wi-Fi)
2. Click **▶ START INCIDENT**
3. Point the phone camera at a staged scene (flooding, fire, structural damage)
4. Watch: Vision Agent fires → Localizer surfaces hydrants → Compiler streams dispatch protocol

---

## Environment Variables

### Backend (`.env`)

| Variable | Default | Description |
|---|---|---|
| `LOCAL_LLM_URL` | `http://localhost:8000/v1` | OpenAI-compatible inference endpoint |
| `LOCAL_LLM_MODEL` | `meta/llama-3.2-11b-vision-instruct` | Model name for chat/completions |
| `DATA_DIR` | `./backend/data` | Path to Toronto Open Data files |
| `TRCA_FLOOD_CACHE_TTL_SECONDS` | `3600` | Refresh interval for TRCA regulatory floodplain checks |
| `WEATHER_CACHE_TTL_SECONDS` | `300` | Refresh interval for live alerts and current conditions |

### Environmental Risk API

`GET /api/environmental-risk?lat=43.6532&lng=-79.3832` combines hourly-refreshed TRCA regulatory floodplain exposure, five-minute Environment Canada GeoMet weather alerts, and five-minute supplemental current conditions from Open-Meteo. Each upstream result includes freshness and stale-cache metadata. These feeds are anonymous and do not require API keys.

`GET /api/risk-map` returns predictive **neighbourhood risk zones** scored from historic City of Toronto open data (311 flood requests, RentSafeTO building evaluations, neighbourhood boundaries, and the local flood susceptibility raster). `POST /api/incident` keeps its original response fields and adds zone baseline risk, compound risk factors, prediction-confirmation escalation, and measured gateway performance metadata.

### Frontend (`.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | GB10 LAN IP — e.g. `http://192.168.1.42:8080` |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL — e.g. `ws://192.168.1.42:8080/ws/stream` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Free Mapbox public token |

---

## Toronto Open Data Sources

| Dataset | Format | Source |
|---|---|---|
| Fire Hydrant Locations | GeoJSON | `open.toronto.ca/dataset/fire-hydrants` |
| Apartment Building Evaluations (RentSafeTO) | JSON/CSV | `open.toronto.ca/dataset/apartment-building-evaluation` |
| Street Centreline | GeoJSON | `open.toronto.ca/dataset/toronto-centreline-tcl` |
| 311 Service Requests | CSV | `open.toronto.ca/dataset/311-service-requests-customer-initiated` |
| Neighbourhood boundaries | GeoJSON | City of Toronto neighbourhood file (`toronto-neighbourhoods.geojson` in `backend/data/`) |
| Flood susceptibility (model layer) | GeoTIFF | `flood-susceptibility-toronto.tif` in `backend/data/` |

---

## Why the GB10 / DGX Spark?

- **128 GB unified memory**: Holds all GeoDataFrames + R-tree index + VLM context simultaneously — no memory pressure between spatial queries and inference.
- **TensorRT-LLM INT4/FP8**: Saturates GB10 tensor cores for < 60 ms/token, achieving real-time multimodal analysis at edge latency impossible on CPU or cloud round-trip.
- **Privacy**: Emergency footage and citizen voice data never leave the physical device. This is a requirement for city deployments.
- **Resilience**: Zero cloud dependency — the system remains operational when city networks are saturated during a real emergency (exactly when cloud tools fail).

---

## Known Limitations & Next Steps

- **Hydrant WGS84 coordinates**: Accuracy depends on Toronto Open Data geometry — map markers use actual dataset coordinates.
- **STT language support**: Whisper Large-v3 supports multilingual input; Web Speech API fallback is English-only.
- **Street-centreline lookup**: Loaded but nearest-road-segment function is a stub — add for routing queries.
- **311 history**: Loaded but spatial join is stubbed — add for historical incident heatmap overlay.
- **Production**: Add JWT auth to the API gateway, persistent incident DB, and CAD system integration.

---

## Team

| Name | Role |
|---|---|
| Person 1 | Infrastructure — Inference server, FastAPI gateway |
| Person 2 | Agent & Data — LangGraph engine, Toronto Open Data |
| Person 3 | Frontend — Next.js dashboard, Mapbox, animations |
