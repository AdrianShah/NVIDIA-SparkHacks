CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

**DRD  ·  SPARK HACK TORONTO  ·  v2.0** 

## **CivicVox-Omni** 

_Design & Architecture Reference Document — 5-Person Team Edition_ 

**Version:** 2.0 — DRAFT **Date:** May 29, 2026 **Supersedes:** DRD v1.0 (3-person) 

© 2026 CivicVox Team  ·  Confidential 

Page 1 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

## **1. What Changed in v2.0** 

DRD v1.0 assumed a 3-person team split across Infrastructure, Agent/Data, and Frontend. With 5 people the workload can be divided more finely, eliminating the bottlenecks that caused the most risk in the original plan — specifically, the single person responsible for both the FastAPI gateway and the local AI inference setup, and the single person responsible for both LangGraph orchestration and all geospatial data work. 

||||
|---|---|---|
|**Area**|**v1.0 (3 people)**|**v2.0 (5 people)**|
||||
||||
|Inference & GPU setup|Person 1 (alongside API<br>gateway)|Person 1 — dedicated|
||||
||||
|API gateway + STT/TTS|Person 1 (alongside GPU)|Person 2 — dedicated|
||||
||||
|Agent orchestration (LangGraph)|Person 2 (alongside GIS data)|Person 3 — dedicated|
||||
||||
|GIS data + Open Data RAG|Person 2 (alongside agents)|Person 4 — dedicated|
||||
||||
|Frontend dashboard|Person 3 — sole owner|Person 5 — dedicated|
||||
||||
|Integration test|Hour 12|Hour 10 (earlier — more<br>buffer)|
||||



## **2. Team Roles & Ownership** 

Each person owns one layer end-to-end. No shared files within a layer; cross-layer communication is via the JSON contracts in Section 7. 

|||||
|---|---|---|---|
|**Person**|**Title**|**Primary deliverable**|**Interface output**|
|||||
|||||
|**Person 1**|**GPU & Inference**<br>**Engineer**|NVIDIA NIM / vLLM running on<br>GB10; Whisper + Kokoro<br>loaded|http://localhost:8000/v1<br>(OpenAI-compat endpoint)|
|||||
|||||
|**Person 2**|**API Gateway**<br>**Engineer**|FastAPI server; STT/TTS<br>pipelines; WebSocket<br>telemetry|http://0.0.0.0:8080 endpoints<br>(see Section 4)|
|||||
|||||
|**Person 3**|**Agent**<br>**Orchestration**<br>**Engineer**|LangGraph StateGraph; all 4<br>agent nodes; system prompts|civic_vox_engine.invoke()<br>importable by Person 2|
|||||
|||||
|**Person 4**|**Data & GIS**<br>**Engineer**|Toronto Open Data download;<br>GeoPandas loader; spatial<br>query fns|toronto_loader.py importable<br>by Person 3|
|||||
|||||
|**Person 5**|**Frontend**<br>**Engineer**|Next.js dashboard; Mapbox<br>map; agent telemetry panel;<br>camera capture|Runs at http://localhost:3000|
|||||



© 2026 CivicVox Team  ·  Confidential 

Page 2 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

## **3. System Architecture Overview** 

CivicVox-Omni is composed of five independently buildable modules mapped 1-to-1 to the five team members. All modules run on the ASUS GX10 (NVIDIA GB10 Grace Blackwell Superchip) local network — zero external API calls during operation. 

||||
|---|---|---|
|**Module**|**Tech stack**|**Owner**|
||||
||||
|Local AI inference server|NVIDIA NIM / vLLM / Ollama, TensorRT-<br>LLM, CUDA drivers|Person 1|
||||
||||
|API gateway + speech<br>pipelines|FastAPI, Uvicorn, Faster-Whisper,<br>Kokoro-82M ONNX|Person 2|
||||
||||
|Agent orchestration engine|LangGraph, LangChain, LangChain-<br>OpenAI, Python 3.11|Person 3|
||||
||||
|GIS data module|GeoPandas, Shapely, PyProj, SciPy R-<br>tree, Toronto Open Data|Person 4|
||||
||||
|Frontend dashboard|Next.js 14, TypeScript, Tailwind CSS,<br>Framer Motion, Mapbox GL JS|Person 5|
||||



## **4. Person 1 — GPU & Inference Engineer** 

Person 1's sole responsibility is getting open-weight models running on the GB10 and exposing a stable local inference endpoint. Everything else depends on this being done in the first 3 hours. 

## **4.1 Hour-by-hour plan** 

||||
|---|---|---|
|**Time**|**Task**|**Done when…**|
||||
||||
|0 – 1 h|SSH into GX10; verify CUDA drivers and GPU<br>visibility (nvidia-smi)|nvidia-smi shows the GB10 with<br>correct VRAM|
||||
||||
|1 – 2 h|Pull NVIDIA NIM container for Llama-3.2-11B-<br>Vision-Instruct OR install vLLM via pip|Container starts without errors|
||||
||||
|2 – 3 h|Run a test curl to POST /v1/chat/completions<br>with a text-only prompt; verify JSON response|curl returns a valid completion<br>JSON|
||||
||||
|3 – 5 h|Test a multimodal (image + text) request with a<br>base64 JPEG; confirm vision inference works|Model returns structured JSON<br>from an image prompt|
||||
||||
|5 – 8 h|Load Faster-Whisper Large-v3 on CUDA; write<br>transcribe_audio(pcm_bytes) test script|10-second PCM clip transcribed in<br>< 300 ms|
||||



© 2026 CivicVox Team  ·  Confidential 

Page 3 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

||||
|---|---|---|
|**Time**|**Task**|**Done when…**|
||||
||||
|8 – 12 h|Load Kokoro-82M ONNX on CPU; write<br>synthesize_speech(text) test script; share both<br>with Person 2|WAV bytes returned for a test<br>sentence in < 100 ms|
||||



## **4.2 Model configuration** 

|||||||
|---|---|---|---|---|---|
|**Model**|**Task**|**Backend**|**Quant**|**VRAM**|**Latency**<br>**target**|
|||||||
|||||||
|Llama-3.2-11B-Vision-<br>Instruct|VLM — vision +<br>text|NIM / vLLM|INT4 /<br>FP8|~8 GB|< 60<br>ms/token|
|||||||
|||||||
|Whisper Large-v3|Speech-to-text|faster-<br>whisper<br>(CUDA)|FP16|~3 GB|< 300 ms /<br>10 s|
|||||||
|||||||
|Kokoro-82M|Text-to-speech|kokoro-onnx<br>(CPU)|FP32<br>ONNX|< 1 GB<br>(CPU)|< 100 ms /<br>sentence|
|||||||



## **4.3 Inference server options** 

||||
|---|---|---|
|**Option**|**Setup command**|**Notes**|
||||
||||
|NVIDIA NIM<br>(preferred)|docker run --gpus all nvcr.io/nim/meta/llama-3.2-<br>11b-vision-instruct|Best GB10 utilisation;<br>requires Docker + NGC<br>credentials|
||||
||||
|vLLM (fallback)|pip install vllm && python -m<br>vllm.entrypoints.openai.api_server --model meta-<br>llama/Llama-3.2-11B-Vision-Instruct|No Docker; easiest install|
||||
||||
|Ollama (dev<br>testing)|ollama serve && ollama pull llama3.2-vision|Lowest throughput; use only<br>for initial smoke test|
||||



## **Environment variable** 

_Set LOCAL_LLM_URL=http://localhost:8000/v1 — this is the only config Person 2 and Person 3 need from Person 1._ 

## **5. Person 2 — API Gateway Engineer** 

Person 2 builds the FastAPI server that acts as the sole network entry point. It receives media payloads from the frontend, runs speech processing, delegates to the agent engine, and streams results back. Person 2 does not write any agent logic — they call Person 3's engine as a black box. 

## **5.1 Hour-by-hour plan** 

© 2026 CivicVox Team  ·  Confidential 

Page 4 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

||||
|---|---|---|
|**Time**|**Task**|**Done when…**|
||||
||||
|0 – 2 h|Scaffold FastAPI app; define Pydantic<br>request/response models for all 4 endpoints; add<br>health check|GET /api/health returns { status: ok<br>}|
||||
||||
|2 – 4 h|Integrate Person 1's transcribe_audio() into<br>POST /api/incident handler using stub agent call|STT result printed to console for a<br>test PCM upload|
||||
||||
|4 – 7 h|Integrate Person 3's civic_vox_engine.invoke()<br>into the route handler; wire AgentState<br>construction|Full mock state flows through<br>engine, JSON response returned|
||||
||||
|7 – 9 h|Build WebSocket /ws/stream endpoint; emit<br>agent node completion events as SSE-style<br>JSON frames|Dashboard receives { node, status,<br>timestamp } events live|
||||
||||
|9 – 12 h|Integrate Person 1's synthesize_speech(); wire<br>POST /api/synthesize; handle WAV streaming<br>response|Browser plays back synthesized<br>audio from a test sentence|
||||



## **5.2 Endpoint specifications** 

|||||
|---|---|---|---|
|**Method**|**Endpoint**|**Request body**|**Response**|
|||||
|||||
|POST|/api/incident|{ transcript: str, frame_b64: str,<br>gps: {lat, lng} }|{ report, vision, spatial, urgency<br>}|
|||||
|||||
|WS|/ws/stream|Binary audio + JSON metadata<br>frames|{ node, status, timestamp }<br>events|
|||||
|||||
|POST|/api/synthesize|{ text: str }|WAV bytes (audio/wav)|
|||||
|||||
|GET|/api/health|—|{ status, models_loaded }|
|||||



## **5.3 Key implementation notes** 

- Bind to 0.0.0.0:8080 — the GB10's LAN IP must be reachable from Person 5's frontend and from mobile demo devices. 

- Set CORS origins to ["*"] for hackathon (all devices on the same local Wi-Fi). 

- Use asyncio + FastAPI async def endpoints; call civic_vox_engine.ainvoke() for non-blocking agent execution. 

- Import toronto_loader.py at server startup so GeoDataFrames are warm before the first request. 

- AgentState construction lives in server.py — Person 2 assembles the dict and passes it to Person 3's engine. 

## **Mock stub pattern** 

_Person 2 should implement a MOCK_MODE env flag. When set, the /api/incident endpoint returns hardcoded JSON instead of calling the agent engine. This lets Person 5 build the entire frontend against a stable response before the agents are ready._ 

© 2026 CivicVox Team  ·  Confidential 

Page 5 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

## **6. Person 3 — Agent Orchestration Engineer** 

Person 3 owns the LangGraph state machine — the cognitive core of CivicVox-Omni. Their module (backend/agents/civic_vox_graph.py) is imported by Person 2 and calls Person 4's spatial query functions. Person 3 does not write any HTTP server code or frontend code. 

## **6.1 Hour-by-hour plan** 

||||
|---|---|---|
|**Time**|**Task**|**Done when…**|
||||
||||
|0 – 2 h|Define AgentState TypedDict; scaffold 4 node<br>function stubs returning mock dicts; compile<br>graph|civic_vox_engine.invoke(mock_state)<br>runs without error|
||||
||||
|2 – 5 h|Implement Orchestrator node: send transcript to<br>VLM; parse routing JSON safely|Routing JSON parsed; next_step set<br>correctly|
||||
||||
|5 – 8 h|Implement Vision node: multimodal VLM call<br>with base64 frame; parse hazard JSON output|vision_analysis dict populated from a<br>real image prompt|
||||
||||
|8 – 10 h|Implement Localizer node: wire Person 4's<br>get_closest_hydrants() and<br>get_building_specs()|spatial_data_results dict populated<br>with real GIS data|
||||
||||
|10 – 12 h|Implement Compiler node: synthesis prompt →<br>dispatch report text; run end-to-end test|final_dispatch_report string non-<br>empty for a real incident payload|
||||



## **6.2 AgentState schema** 

**TypedDict fields** _messages: list[BaseMessage]  ·  video_frames_base64: list[str]  ·  gps_coordinates: dict  · vision_analysis: dict  ·  spatial_data_results: dict  ·  next_step: str  ·  final_dispatch_report: str_ 

## **6.3 Node specifications** 

|||||
|---|---|---|---|
|**Node**|**Reads from state**|**Writes to state**|**LLM calls**|
|||||
|||||
|Orchestrator|messages[-1] (transcript)|next_step, urgency_level|1 — text routing<br>prompt|
|||||
|||||
|Vision Agent|video_frames_base64[-<br>1], messages|vision_analysis,<br>next_step|1 — multimodal (text<br>+ image_url)|
|||||
|||||
|Localizer Agent|gps_coordinates,<br>vision_analysis|spatial_data_results,<br>next_step|0 — GeoPandas<br>only (Person 4's<br>functions)|
|||||
|||||
|Report Compiler|messages,<br>vision_analysis,<br>spatial_data_results|final_dispatch_report,<br>next_step|1 — synthesis<br>prompt|
|||||



© 2026 CivicVox Team  ·  Confidential 

Page 6 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

## **6.4 Graph routing table** 

||||
|---|---|---|
|**From node**|**Condition**|**To node**|
||||
||||
|orchestrator|next_step == 'vision'|vision|
||||
||||
|orchestrator|next_step == 'localizer' (no camera /<br>audio-only incident)|localizer|
||||
||||
|vision|always|localizer|
||||
||||
|localizer|always|compiler|
||||
||||
|compiler|always|END|
||||



## **6.5 System prompts** 

## **Orchestrator prompt** 

```
You are the emergency coordinator for CivicVox-Omni, Toronto.
Analyse this citizen report: "{transcript}"
Output ONLY valid JSON (no markdown fences):
```

```
{ "requires_vision": bool, "urgency_level": "LOW"|"HIGH"|"CRITICAL" }
```

## **Vision Agent prompt** 

```
Analyse this emergency video frame. Output ONLY valid JSON (no markdown fences):
{ "hazard_type": string, "severity_scale": integer 1-10,
  "water_depth_m": float or null, "structural_risk": boolean,
  "location_cues": string }
```

## **Report Compiler prompt** 

```
You are Toronto Emergency Command. Given the inputs below, produce a
```

```
concise priority-coded dispatch protocol covering:
```

`1. Threat classification and recommended perimeter radius` 

`2. Infrastructure access nodes with exact distances` 

`3. Building vulnerabilities` 

`4. Recommended crew type and count` 

## **JSON safety** 

_Open-weight VLMs often wrap JSON in ```json ... ``` fences. Always strip these before calling json.loads(). Use: import re; clean = re.sub(r'```[\w]*\n?|```', '', raw).strip()_ 

## **6.6 Pip dependencies (Person 3)** 

```
pip install langgraph langchain-core langchain-openai
```

## **7. Person 4 — Data & GIS Engineer** 

© 2026 CivicVox Team  ·  Confidential 

Page 7 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

Person 4 downloads all Toronto Open Data, builds the in-memory spatial index, and exposes two clean query functions imported by Person 3. This module has zero LLM dependency — it is pure Python geospatial work. 

## **7.1 Hour-by-hour plan** 

||||
|---|---|---|
|**Time**|**Task**|**Done when…**|
||||
||||
|0 – 2 h|Download all 4 Open Data files to /backend/data/<br>using the CKAN API or direct download links|All GeoJSON/CSV files present on<br>disk|
||||
||||
|2 – 4 h|Write toronto_loader.py: load all<br>GeoDataFrames; project to EPSG:2958; build R-<br>tree index on hydrants|Loader runs without error; hydrants<br>GDF has 'distance' column method<br>ready|
||||
||||
|4 – 6 h|Implement get_closest_hydrants(lat, lng, n=3) -><br>list[dict]|Returns 3 nearest hydrants with id,<br>distance_meters, status in < 20 ms|
||||
||||
|6 – 8 h|Implement get_building_specs(lat, lng) -> dict:<br>reverse-geocode to nearest RentSafeTO record|Returns floors, contact,<br>last_inspection_date for a test<br>coordinate|
||||
||||
|8 – 10 h|Implement get_nearest_road(lat, lng) -> dict<br>using Street Centrelines GDF|Returns road name and distance<br>for a test coordinate|
||||
||||
|10 – 12 h|Write unit tests for all 3 functions; share module<br>with Person 3 for integration|All 3 functions return expected<br>dicts; no errors on 5 test<br>coordinates|
||||



## **7.2 Toronto Open Data sources** 

|||||
|---|---|---|---|
|**Dataset**|**Format**|**Portal path**|**In-memory object**|
|||||
|||||
|Fire Hydrant<br>locations|GeoJSON|open.toronto.ca/dataset/fire-<br>hydrants|GeoDataFrame<br>(EPSG:2958) + R-tree index|
|||||
|||||
|RentSafeTO<br>apartment<br>evaluations|CSV|open.toronto.ca/dataset/apartment-<br>building-evaluation|GeoDataFrame (geocoded,<br>EPSG:2958)|
|||||
|||||
|Street Centrelines|GeoJSON|open.toronto.ca/dataset/toronto-<br>centreline-tcl|GeoDataFrame<br>(EPSG:2958)|
|||||
|||||
|311 Service<br>Requests|CSV|open.toronto.ca/dataset/311-<br>service-requests-customer-initiated|Pandas DataFrame (filtered<br>by incident type)|
|||||



## **7.3 Public interface contract** 

```
# backend/data/toronto_loader.py
```

```
def get_closest_hydrants(lat: float, lng: float, n: int = 3) -> list[dict]:
    # Returns: [{ 'id': int, 'distance_meters': float, 'status': str }, ...]
```

```
def get_building_specs(lat: float, lng: float) -> dict:
```

© 2026 CivicVox Team  ·  Confidential 

Page 8 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

```
    # Returns: { 'address': str, 'floors': int, 'contact': str, 'last_inspection': str }
```

```
def get_nearest_road(lat: float, lng: float) -> dict:
    # Returns: { 'road_name': str, 'distance_meters': float }
```

**Performance note** 

_Pre-load all GeoDataFrames and the R-tree index into module-level globals at import time — not inside each function call. This eliminates disk I/O from the critical path and keeps spatial queries under 20 ms._ 

## **7.4 Pip dependencies (Person 4)** 

```
pip install geopandas shapely pyproj scipy pandas requests
```

## **8. Person 5 — Frontend Engineer** 

Person 5 owns the Next.js dashboard — the visual interface judges will watch during the demo. They work entirely in the /frontend directory and never touch Python. From Hour 0 they build against Person 2's mock JSON stubs; they switch to the live backend at Hour 10 integration. 

## **8.1 Hour-by-hour plan** 

||||
|---|---|---|
|**Time**|**Task**|**Done when…**|
||||
||||
|0 – 2 h|Scaffold Next.js 14 app with Tailwind; set up<br>.env.local with API_URL and Mapbox token;<br>create 3-column grid layout|npx next dev runs; dark<br>background visible|
||||
||||
|2 – 5 h|Build <MapView /> with Mapbox GL dark-matter<br>tiles; add static incident pin and hydrant markers<br>from mock JSON|Map renders with 3 coloured<br>markers|
||||
||||
|5 – 7 h|Build <AgentPipeline /> with 4 <AgentCard /><br>nodes showing idle/active/complete states with<br>Framer Motion animations|Cards animate through states<br>when a button is clicked|
||||
||||
|7 – 9 h|Build <CameraCapture /> using MediaDevices<br>API: capture JPEG every 2 s, POST to Person<br>2's /api/incident (mock mode)|Console logs show base64 frames<br>being captured|
||||
||||
|9 – 10 h|Build <DispatchReport /> with token-by-token<br>typewriter render of the report string; add TTS<br>audio playback widget|Mock report text streams<br>character-by-character|
||||
||||
|10 – 12 h|Switch API_URL to live GB10 LAN IP; wire<br>WebSocket /ws/stream for live agent telemetry;<br>demo rehearsal|Full end-to-end loop works on real<br>video input|
||||



© 2026 CivicVox Team  ·  Confidential 

Page 9 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

## **8.2 Component inventory** 

||||
|---|---|---|
|**Component**|**File**|**Responsibility**|
||||
||||
|MapView|components/MapView.tsx|Mapbox GL JS dark map; incident pin;<br>hydrant/building asset overlays; alert radius<br>circle|
||||
||||
|AgentPipeline|components/AgentPipeline.tsx|4-node pipeline visualisation; pulsing Framer<br>Motion ring on active node; green check on<br>complete|
||||
||||
|AgentCard|components/AgentCard.tsx|Individual node card: label, status badge,<br>timestamp|
||||
||||
|CameraCapture|components/CameraCapture.tsx|MediaDevices getUserMedia; canvas<br>snapshot loop every 2 s; audio<br>MediaRecorder; sends to API|
||||
||||
|DispatchReport|components/DispatchReport.tsx|Typewriter text render; copy-to-clipboard;<br>audio playback via /api/synthesize|
||||
||||
|IncidentBadge|components/IncidentBadge.tsx|Colour-coded urgency badge<br>(LOW/HIGH/CRITICAL) shown top-right of<br>map|
||||



## **8.3 Environment variables** 

||||
|---|---|---|
|**Variable**|**Default**|**Set by**|
||||
||||
|NEXT_PUBLIC_API_URL|http://localhost:8080|Person 5 — update to<br>GB10 LAN IP before demo|
||||
||||
|NEXT_PUBLIC_WS_URL|ws://localhost:8080/ws/stream|Person 5 — update to<br>GB10 LAN IP before demo|
||||
||||
|NEXT_PUBLIC_MAPBOX_TOKEN|pk.eyJ1Ijoi...|Person 5 — free public<br>token from mapbox.com|
||||



## **8.4 Npm dependencies** 

```
npm install mapbox-gl react-map-gl framer-motion @tailwindcss/typography
```

## **9. Integration Protocol** 

With 5 people, integration risk increases. The following handshake protocol keeps everyone unblocked and surfaces problems early. 

## **9.1 Interface freeze — Hour 3** 

© 2026 CivicVox Team  ·  Confidential 

Page 10 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

By Hour 3, all five people must agree on the JSON contracts defined in Section 10. No interface may change after this point without a verbal team check-in. Person 2 publishes the MOCK_MODE stub immediately after the freeze so Person 5 can start building against real response shapes. 

## **9.2 Component handshake milestones** 

|||||
|---|---|---|---|
|**Hour**|**Handshake**|**Parties**|**How to verify**|
|||||
|||||
|3|Inference endpoint<br>live|P1 → P2,<br>P3|curl POST to localhost:8000/v1/chat/completions<br>returns completion JSON|
|||||
|||||
|5|STT pipeline live|P1 → P2|Person 2 calls transcribe_audio() on a test WAV file;<br>transcript printed|
|||||
|||||
|7|GIS functions live|P4 → P3|Person 3 imports toronto_loader; calls<br>get_closest_hydrants(43.66, -79.39, 3); dict returned|
|||||
|||||
|9|Agent engine live|P3 → P2|Person 2 calls civic_vox_engine.invoke(mock_state);<br>final_dispatch_report non-empty|
|||||
|||||
|10|Full integration test|All|Person 5 submits a real camera frame; map updates<br>with live data; agent cards animate|
|||||
|||||
|12|Demo freeze|All|No code changes to core paths; only UI polish and<br>demo script refinement allowed|
|||||



## **9.3 Parallel work rules** 

- No shared Python files between people. Each person writes to their own module; imports are one-directional (P2 imports P3; P3 imports P4; no cycles). 

- All cross-team data is passed as plain Python dicts matching the contracts in Section 10 — no shared class instances. 

- If a dependency is not ready, use the mock stub pattern: return the hardcoded example JSON from Section 10 until the real implementation arrives. 

- Person 5 never calls Person 3 or Person 4 directly — all frontend requests go through Person 2's API. 

## **10. Interface Contracts (Source of Truth)** 

All five team members must agree on these schemas at Hour 3. They are the immutable API between all modules. 

## **10.1 Frontend → Gateway (POST /api/incident)** 

```
{
  "transcript": "There is flooding in my basement",
  "frame_b64":  "<JPEG encoded as base64 string>",
  "gps": { "lat": 43.6629, "lng": -79.3957 }
```

© 2026 CivicVox Team  ·  Confidential 

Page 11 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

```
}
```

## **10.2 Gateway → Frontend (response)** 

```
{
  "urgency":  "CRITICAL",
  "report":   "THREAT: Flash flooding — Category 3 …",
  "vision":   { "hazard_type": "Flooding", "severity_scale": 7,
               "water_depth_m": 0.4, "structural_risk": false,
               "location_cues": "Brick residential building, north-facing" },
  "spatial":  {
    "closest_hydrant": { "id": 1042, "distance_meters": 38.5, "status": "Operational" },
    "building_specs":  { "address": "123 Example St", "floors": 12,
                         "contact": "Toronto Housing Corp", "last_inspection": "2025-11-
14" },
    "nearest_road":    { "road_name": "Spadina Ave", "distance_meters": 12.0 }
  }
}
```

## **10.3 WebSocket telemetry event** 

```
{ "node": "vision", "status": "active",   "timestamp": "2026-05-29T21:05:33.412Z" }
{ "node": "vision", "status": "complete", "timestamp": "2026-05-29T21:05:33.890Z" }
```

## **10.4 Gateway → Agent engine (AgentState dict)** 

```
{
  "messages":             [HumanMessage(content=transcript)],
  "video_frames_base64":  [frame_b64],
  "gps_coordinates":      { "lat": 43.6629, "lng": -79.3957 },
  "vision_analysis":      {},
  "spatial_data_results": {},
  "next_step":            "orchestrator",
  "final_dispatch_report": ""
}
```

## **10.5 GIS module functions (Person 4 → Person 3)** 

```
get_closest_hydrants(43.6629, -79.3957, n=3)
# Returns: [{ 'id': 1042, 'distance_meters': 38.5, 'status': 'Operational' }, ...]
get_building_specs(43.6629, -79.3957)
# Returns: { 'address': '123 Example St', 'floors': 12,
#            'contact': 'Toronto Housing Corp', 'last_inspection': '2025-11-14' }
```

## **11. Hackathon Timeline** 

© 2026 CivicVox Team  ·  Confidential 

Page 12 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

All five tracks run in parallel. The critical path is: Person 1 inference live (Hour 3) → Person 4 GIS ready (Hour 7) → Person 3 agents integrated (Hour 9) → full integration test (Hour 10) → polish (Hour 12+). 

|||||||
|---|---|---|---|---|---|
|**Hour**|**P1 —**<br>**Inference**|**P2 —**<br>**Gateway**|**P3 —**<br>**Agents**|**P4 — GIS Data**|**P5 — Frontend**|
|||||||
|||||||
|0–2|CUDA<br>verify; pull<br>NIM image|Scaffold<br>FastAPI;<br>health<br>endpoint|AgentState +<br>stub nodes;<br>graph<br>compiles|Download all 4 Open<br>Data files|Next.js scaffold;<br>layout grid; Mapbox<br>token|
|||||||
|||||||
|2–4|Test text<br>inference<br>via curl|Wire STT<br>pipeline (P1<br>dep)|Orchestrator<br>node +<br>routing|Build GeoDataFrame<br>loader; EPSG:2958|MapView with static<br>markers|
|||||||
|||||||
|4–6|Test<br>multimodal<br>(image)<br>inference|Stub agent<br>call in route<br>handler|Vision node<br>+ multimodal<br>call|get_closest_hydrants()<br>function|AgentPipeline +<br>AgentCard<br>animations|
|||||||
|||||||
|6–8|Load<br>Whisper;<br>latency test|WebSocket<br>telemetry<br>endpoint|Localizer<br>node (P4<br>dep)|get_building_specs() +<br>get_nearest_road()|CameraCapture<br>component|
|||||||
|||||||
|8–10|Load<br>Kokoro<br>TTS; share<br>fns with P2|TTS<br>endpoint;<br>end-to-end<br>gateway test|Compiler<br>node; full<br>graph end-<br>to-end test|Unit tests for all 3 GIS<br>functions|DispatchReport<br>typewriter + audio<br>widget|
|||||||
|||||||
|10–<br>12|GPU perf<br>tuning;<br>TensorRT<br>flags|Live<br>integration;<br>fix edge<br>cases|Prompt<br>tuning;<br>JSON safety<br>hardening|Performance profiling;<br>R-tree verification|Switch to live<br>backend;<br>WebSocket<br>telemetry live|
|||||||
|||||||
|12+|Monitor<br>inference<br>speed for<br>pitch|API stability;<br>demo script|System<br>prompt<br>polish|Extra: 311 data filter<br>for context|UI animations;<br>demo rehearsal|
|||||||



## **12. Risk Register (5-Person Edition)** 

||||||
|---|---|---|---|---|
|**Risk**|**Likely.**|**Impact**|**Owner**|**Mitigation**|
||||||
||||||
|NIM container fails to<br>start on GB10|Med|Critical|P1|Pre-test vLLM as fallback the week before;<br>have Ollama as last resort|
||||||
||||||
|VLM VRAM overflow with<br>INT8|Med|High|P1|Pre-quantise to INT4 with TensorRT-LLM;<br>drop to Llama-3.2-3B if needed|
||||||
||||||
|GIS files too large to<br>download on venue Wi-Fi|High|High|P4|Download all datasets before the event;<br>commit to repo or USB drive|
||||||



© 2026 CivicVox Team  ·  Confidential 

Page 13 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

||||||
|---|---|---|---|---|
|**Risk**|**Likely.**|**Impact**|**Owner**|**Mitigation**|
||||||
||||||
|Interface contract breaks<br>mid-event|Med|High|P2|Freeze contracts at Hour 3; use<br>MOCK_MODE so P5 never blocks on<br>backend|
||||||
||||||
|Frontend can't reach<br>GB10 on venue network|Med|High|P5|Test local Wi-Fi hotspot fallback; confirm<br>GB10 LAN IP before demo|
||||||
||||||
|Open-weight VLM<br>produces non-JSON<br>output|High|Med|P3|Regex strip + try/except in every agent<br>node; fallback to raw text if parse fails|
||||||
||||||
|WebSocket drops during<br>demo|Low|Med|P2|Fallback to HTTP polling mode (2 s<br>interval) — same UX, no real-time<br>telemetry|
||||||
||||||
|Team integration test<br>fails at Hour 10|Med|High|All|Each person has a mock stub ready; can<br>demo individual layers if full chain fails|
||||||



## **13. Repository Structure** 

## **Monorepo layout** 

_/civicvox-omni   /backend     server.py                 # Person 2 — FastAPI entry point     /agents civic_vox_graph.py      # Person 3 — LangGraph state machine     /data       toronto_loader.py       # Person 4 — GeoDataFrame loader + spatial fns       download_data.py        # Person 4 — one-shot Open Data downloader       *.geojson / *.csv       # Person 4 — pre-downloaded Open Data files inference/       whisper_pipeline.py     # Person 1 — STT utility       kokoro_pipeline.py      # Person 1 — TTS utility   /frontend     app/       page.tsx                # Person 5 — main dashboard page components/         MapView.tsx           # Person 5         AgentPipeline.tsx     # Person 5 AgentCard.tsx         # Person 5         CameraCapture.tsx     # Person 5         DispatchReport.tsx    # Person 5         IncidentBadge.tsx     # Person 5     .env.local                # Person 5 — env vars (never commit)   README.md   .env.example               # shared env var template_ 

## **14. Demo Script & Pitch Talking Points** 

|||||
|---|---|---|---|
|**Moment**|**Who**<br>**drives**|**What to show**|**What to say**|
|||||
|||||
|Open with the<br>problem|P5|Static slide: city<br>emergency, cloud fails|"During a major emergency, cloud<br>latency is a liability. We eliminate it<br>entirely."|
|||||
|||||
|Live camera<br>demo|P5 on<br>phone|Phone camera pointed at<br>staged flooding|"Any citizen. No app install. Just a<br>browser on the local network."|
|||||
|||||
|Vision fires|P5<br>watches<br>dashboard|Vision Agent card pulses<br>→ completes; map pin<br>drops|"The GB10 just analysed that frame<br>locally. No data left this room."|
|||||



© 2026 CivicVox Team  ·  Confidential 

Page 14 

CivicVox-Omni  ·  DRD v2.0  ·  5-Person Edition **SPARK HACK TORONTO** 

|||||
|---|---|---|---|
|**Moment**|**Who**<br>**drives**|**What to show**|**What to say**|
|||||
|||||
|Spatial query|P5 + P4<br>narrates|Hydrant markers appear<br>on map|"Three nearest operational hydrants<br>from Toronto Open Data — returned<br>in under 20 ms."|
|||||
|||||
|Dispatch report|P5 reads<br>panel|Typewriter text streams in<br>report panel|"Military-grade dispatch protocol, at<br>edge speed."|
|||||
|||||
|Hardware close|P1<br>narrates|Show nvidia-smi / GPU<br>utilisation dashboard|"This is the NVIDIA GB10 doing what<br>no cloud can: real-time multi-modal AI,<br>fully sovereign."|
|||||



© 2026 CivicVox Team  ·  Confidential 

Page 15 

