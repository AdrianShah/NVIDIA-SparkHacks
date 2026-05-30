CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

## **SYSTEM ARCHITECTURE DOCUMENT** 

## **CivicVox-Omni** 

_Edge-compute emergency intelligence — full system design reference_ 

**Version:** 1.0 — DRAFT **Date:** May 29, 2026 

© 2026 CivicVox Team 

Page 1 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

## **1. System Overview** 

CivicVox-Omni is a four-layer, local-first edge application. Every computation — speech transcription, vision inference, geospatial query, and report generation — runs on a single ASUS GX10 node (NVIDIA GB10 Grace Blackwell Superchip) with zero cloud API dependency during live operation. The four layers are: 

|||||
|---|---|---|---|
|**#**|**Layer**|**Responsibility**|**Primary Tech**|
|||||
|||||
|1|Input Stream|Capture live video/audio/GPS from<br>browser or device|HTML5 MediaDevices API, WebRTC /<br>WebSocket|
|||||
|2|API Gateway|Validate payloads, run STT, route<br>to agent engine, return results|FastAPI, Uvicorn, Faster-Whisper,<br>Kokoro TTS|
|3|Agent<br>Orchestration|Multi-agent state machine:<br>orchestrate, analyse, locate,<br>compile|LangGraph, LangChain, GeoPandas,<br>ChromaDB|
|4|AI Inference +<br>Data|Serve VLM on GB10; spatial<br>queries over Toronto Open Data|NVIDIA NIM / vLLM, TensorRT-LLM,<br>GeoPandas R-tree|
|||||



## **2. Layer 1 — Input Stream** 

## **2.1 Browser capture** 

The frontend (Next.js, running on the user's laptop or phone browser) handles all media capture using standard Web APIs: 

- Video: navigator.mediaDevices.getUserMedia({ video: true }) → canvas.drawImage() → JPEG base64 snapshot every 2 000 ms 

- Audio: MediaRecorder API → PCM blob → sent alongside each video frame 

- GPS: navigator.geolocation.getCurrentPosition() → { lat, lng } JSON payload 

## **2.2 Transport to gateway** 

Two transport modes are supported — the frontend switches automatically based on session type: 

||||
|---|---|---|
|**Mode**|**Endpoint**|**When used**|
||||
||||
|HTTP polling|POST /api/incident (every 2 s)|Default; simple, reliable on local Wi-Fi|
|WebSocket<br>stream|WS /ws/stream (continuous)|Demo mode: enables live agent telemetry events<br>to dashboard|



## **3. Layer 2 — API Gateway** 

© 2026 CivicVox Team 

Page 2 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

The gateway (backend/server.py) is a FastAPI application bound to 0.0.0.0:8080. It is the only networkaccessible process; all other components communicate locally through Python function calls. 

## **3.1 Endpoint specifications** 

|||||
|---|---|---|---|
|**Method**|**Endpoint**|**Input schema**|**Output schema**|
|||||
|POST|/api/incident|{ transcript, frame_b64, gps:<br>{lat, lng} }|{ report, vision, spatial,<br>urgency }|
|||||
|WebSocket|/ws/stream|Binary audio + JSON<br>metadata frames|Server-sent JSON: { node,<br>status, timestamp }|
|POST|/api/synthesize|{ text: string }|WAV audio bytes|
|||||
|GET|/api/health|—|{ status, models_loaded }|
|||||



## **3.2 Speech pipeline (Faster-Whisper)** 

- Model: large-v3, loaded in float16 on CUDA at server startup 

- Function: transcribe_audio(pcm_bytes: bytes) -> str 

- Target latency: < 300 ms for a 10-second audio clip on GB10 

- Output transcript is injected into the AgentState.messages field before invoking the LangGraph engine 

## **3.3 TTS pipeline (Kokoro-82M)** 

- Model: Kokoro-82M ONNX, loaded at startup, runs on CPU (frees GPU for VLM inference) 

- Function: synthesize_speech(text: str) -> bytes — returns WAV buffer 

- Endpoint: POST /api/synthesize — streamed back to the dispatcher audio widget 

- Target: < 100 ms per sentence for real-time playback 

## **4. Layer 3 — Agent Orchestration** 

The agent engine (backend/agents/civic_vox_graph.py) implements a LangGraph StateGraph. All agent nodes share an immutable snapshot of AgentState and write only to their designated output fields. 

## **4.1 AgentState schema** 

## **TypedDict fields** 

_messages: list[BaseMessage]  ·  video_frames_base64: list[str]  ·  gps_coordinates: dict  · vision_analysis: dict  ·  spatial_data_results: dict  ·  next_step: str  ·  final_dispatch_report: str_ 

© 2026 CivicVox Team 

Page 3 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

## **4.2 Node specifications** 

|||||
|---|---|---|---|
|**Node**|**Input fields consumed**|**Output fields written**|**LLM calls**|
|||||
|||||
|Orchestrator|messages[-1] (transcript)|next_step, urgency_level|1 — text-only routing<br>prompt|
|Vision Agent|video_frames_base64[-<br>1], messages|vision_analysis,<br>next_step|1 — multimodal (text +<br>image_url)|
|Localizer Agent|gps_coordinates,<br>vision_analysis|spatial_data_results,<br>next_step|0 — pure GeoPandas<br>spatial query|
|||||
|||||
|Report Compiler|messages,<br>vision_analysis,<br>spatial_data_results|final_dispatch_report,<br>next_step|1 — synthesis prompt|
|||||



## **4.3 Routing logic** 

Conditional edges are resolved by a route_decision(state) function reading state.next_step: 

||||
|---|---|---|
|**From**|**Condition**|**To**|
||||
|Orchestrator|next_step == 'vision'|Vision Agent|
|Orchestrator|next_step == 'localizer' (no camera)|Localizer Agent|
||||
|Vision Agent|always|Localizer Agent|
|Localizer Agent|always|Report Compiler|
||||
|Report Compiler|always|END|
||||



## **4.4 System prompts** 

## **Orchestrator prompt** 

```
Analyse the citizen report: "{transcript}"
```

```
Output ONLY valid JSON: { "requires_vision": bool, "urgency_level":
"LOW"|"HIGH"|"CRITICAL" }
```

## **Vision Agent prompt** 

```
Analyse this emergency video frame. Output ONLY valid JSON:
```

```
{ "hazard_type": str, "severity_scale": int 1-10, "water_depth_m": float|null,
```

```
  "structural_risk": bool, "location_cues": str }
```

## **Report Compiler prompt** 

```
You are Toronto Emergency Command. Given the following inputs, generate a
```

```
priority-coded dispatch protocol covering:
```

`1. Threat classification and perimeter radius` 

`2. Infrastructure access nodes (exact distances)` 

`3. Building blueprint vulnerabilities` 

`4. Recommended crew type and count` 

© 2026 CivicVox Team 

Page 4 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

## **JSON safety note** 

_Open-weight VLMs frequently wrap JSON output in ```json ... ``` markdown fences. All agent nodes must strip these before calling json.loads(). Use: import re; clean = re.sub(r'```[\w]*\n?|```', '', raw).strip()_ 

## **5. Layer 4 — AI Inference & Data Infrastructure** 

## **5.1 Inference server** 

||||
|---|---|---|
|**Option**|**Command**|**Notes**|
||||
||||
|NVIDIA NIM<br>(preferred)|docker run --gpus all nvcr.io/nim/meta/llama-3.2-<br>11b-vision-instruct|Best GB10 tensor core<br>utilisation|
||||
|vLLM (fallback)|python -m vllm.entrypoints.openai.api_server --<br>model meta-llama/Llama-3.2-11B-Vision-Instruct|Pip-installable, no Docker<br>required|
|Ollama<br>(dev/testing)|ollama serve && ollama pull llama3.2-vision|Easiest setup, lower<br>throughput|



All three options expose an OpenAI-compatible REST API at http://localhost:8000/v1. No agent code changes are required when switching between them — only the LOCAL_LLM_URL environment variable must be set. 

## **5.2 Model inventory** 

||||||
|---|---|---|---|---|
|**Model**|**Task**|**Quant**|**VRAM**|**Latency target**|
||||||
|Llama-3.2-11B-Vision-<br>Instruct|Vision analysis + text<br>generation|INT4 /<br>FP8|~8 GB|< 60 ms/token|
||||||
|Whisper Large-v3|Speech-to-text|FP16|~3 GB|< 300 ms / 10 s|
||||||
|Kokoro-82M|Text-to-speech<br>(ONNX)|FP32|< 1 GB<br>(CPU)|< 100 ms / sentence|
||||||



## **5.3 Toronto Open Data spatial module** 

All geospatial data is pre-loaded into memory once at server startup via backend/data/toronto_loader.py: 

|||||
|---|---|---|---|
|**Dataset**|**Format**|**In-memory object**|**Query function**|
|||||
|||||
|Fire Hydrant<br>locations|GeoJSON|GeoDataFrame<br>(EPSG:2958)|get_closest_hydrants(lat,<br>lng, n=3)|
|||||
|RentSafeTO<br>(apartments)|CSV →<br>GeoDataFrame|GeoDataFrame<br>(EPSG:2958)|get_building_specs(lat, lng)|
|||||
|Street Centrelines|GeoJSON|GeoDataFrame<br>(EPSG:2958)|Nearest road segment<br>lookup|
|||||



© 2026 CivicVox Team 

Page 5 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

|||||
|---|---|---|---|
|**Dataset**|**Format**|**In-memory object**|**Query function**|
|||||
|||||
|311 Service<br>Requests|CSV|Pandas DataFrame|Filter by address / date|



- All layers are projected to NAD83 / UTM Zone 17N (EPSG:2958) for accurate metre-based distance calculations. 

- An R-tree spatial index is built on the hydrants GeoDataFrame at startup for sub-millisecond nearest-neighbour lookup. 

- Total estimated memory footprint of all datasets in-process: < 500 MB. 

## **6. End-to-End Data Flow** 

The following table traces a single incident through every system component, from citizen camera stream to final dispatch report: 

|||||
|---|---|---|---|
|**Step**|**Component**|**Action**|**Output**|
|||||
|1|Mobile browser|Captures video frame, records<br>audio, reads GPS|JPEG (base64), PCM blob, { lat,<br>lng }|
|||||
|2|Frontend JS|Assembles payload, POSTs to<br>/api/incident|HTTP request to FastAPI|
|3|FastAPI gateway|Validates payload via Pydantic; calls<br>transcribe_audio(pcm)|Transcript string|
|||||
|4|LangGraph<br>engine|Initialises AgentState; invokes<br>civic_vox_engine.invoke(state)|Begins graph traversal|
|5|Orchestrator node|Sends transcript to VLM; parses<br>routing JSON|next_step = 'vision'|
|6|Vision node|Sends frame_b64 + prompt to VLM<br>via multimodal API call|vision_analysis dict|
|||||
|7|Localizer node|Calls get_closest_hydrants() +<br>get_building_specs() via GeoPandas|spatial_data_results dict|
|8|Compiler node|Sends combined context to VLM;<br>generates dispatch protocol text|final_dispatch_report string|
|9|FastAPI gateway|Serialises completed AgentState to<br>JSON response|HTTP 200 + JSON payload|
|||||
|10|Frontend|Updates map markers, agent<br>telemetry panel, report text window|Live dashboard update|
|||||
|11|Optional TTS|POST /api/synthesize with report<br>text → Kokoro synthesizes WAV|Audio playback to dispatcher|
|||||



© 2026 CivicVox Team 

Page 6 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

## **7. Component Interface Contracts** 

These JSON schemas are the source of truth for cross-layer communication. All three engineers must agree on these before Hour 3 of the hackathon. 

## **7.1 Frontend → Gateway** 

```
POST /api/incident
{
  "transcript": "There is flooding in the basement",
  "frame_b64":  "<base64-encoded JPEG string>",
  "gps": { "lat": 43.6629, "lng": -79.3957 }
}
```

## **7.2 Gateway → Frontend (response)** 

```
{
  "report":   "<dispatch protocol text>",
  "urgency":  "CRITICAL",
  "vision":   { "hazard_type": "Flooding", "severity_scale": 7, ... },
  "spatial":  { "closest_hydrant": { "id": 1042, "distance_meters": 38.5, "status":
"Operational" },
               "building_specs": { "floors": 12, "contact": "Toronto Housing Corp" } }
}
```

## **7.3 WebSocket telemetry event (per node completion)** 

```
{
  "node":      "vision",
  "status":    "complete",
  "timestamp": "2026-05-29T21:05:33.412Z"
}
```

## **8. Environment Variables** 

||||
|---|---|---|
|**Variable**|**Default**|**Description**|
||||
|LOCAL_LLM_URL|http://localhost:8000/v1|OpenAI-compat endpoint<br>for the local inference<br>server|
||||
|LOCAL_LLM_MODEL|meta/llama-3.2-11b-vision-<br>instruct|Model name passed in<br>each chat/completions<br>request|
||||



© 2026 CivicVox Team 

Page 7 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

||||
|---|---|---|
|**Variable**|**Default**|**Description**|
||||
||||
|NEXT_PUBLIC_API_URL|http://192.168.x.x:8080|FastAPI URL — must be<br>set to GB10 LAN IP for<br>mobile demo|
||||
|NEXT_PUBLIC_WS_URL|ws://192.168.x.x:8080/ws/stream|WebSocket URL for live<br>telemetry|
||||
|NEXT_PUBLIC_MAPBOX_TOKEN|pk.eyJ1Ijoi...|Free Mapbox public token<br>for vector tile map|
|DATA_DIR|./backend/data|Path to Toronto Open Data<br>GeoJSON / CSV files|
||||



## **9. Non-Functional Requirements** 

||||
|---|---|---|
|**Requirement**|**Target**|**How achieved**|
||||
|End-to-end latency|< 100 ms (vision) / <<br>60 ms (text-only)|TensorRT-LLM INT4 on GB10; R-tree spatial index;<br>in-memory data|
||||
|Offline operation|100% during demo|All models and data pre-loaded; no external API<br>calls|
|Vision throughput|≥ 10 FPS sustained|Single-pass INT4 VLM inference on GB10 tensor<br>cores|
|STT accuracy<br>(English)|< 8% WER|Whisper Large-v3 on-device|
||||
|Spatial query speed|< 20 ms|GeoPandas R-tree index, EPSG:2958 projection<br>pre-applied|
|Dashboard refresh|≤ 500 ms|WebSocket events pushed immediately after each<br>agent node completes|
||||



## **10. GB10 Optimisation Notes** 

These optimisations should be demonstrated explicitly during the pitch to show hardware awareness: 

- Pre-load all GeoDataFrames and the R-tree index into a global dict at FastAPI startup — not inside the request handler. Eliminates disk I/O from the critical path. 

- Use TensorRT-LLM with FP8 or INT4 quantisation on the GB10 to saturate tensor cores. Show tokens-per-second counter in the dashboard. 

- Pin the Whisper Large-v3 CUDA process to a dedicated CUDA stream to avoid competing with the VLM for memory bandwidth. 

- Run Kokoro-82M TTS on CPU (ONNX runtime) — frees all 20 GB of GB10 VRAM for VLM inference while TTS completes in parallel. 

© 2026 CivicVox Team 

Page 8 

CivicVox-Omni  ·  System Architecture v1.0 **SPARK HACK TORONTO** 

- Use Python asyncio + FastAPI async endpoints for non-blocking I/O; the LangGraph ainvoke() call runs the agent graph as a coroutine, keeping the event loop free for WebSocket events. 

© 2026 CivicVox Team 

Page 9 

