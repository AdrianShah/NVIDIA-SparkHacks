CivicVox-Omni  ·  PRD v1.0 **CONFIDENTIAL — SPARK HACK TORONTO** 

## **PRD  ·  SPARK HACK TORONTO** 

## **CivicVox-Omni** 

_Product Requirements Document_ 

**Version:** 1.0 — DRAFT **Date:** May 29, 2026 

© 2026 CivicVox Team  ·  Spark Hack Toronto 

Page 1 

CivicVox-Omni  ·  PRD v1.0 **CONFIDENTIAL — SPARK HACK TORONTO** 

## **1. Executive Summary** 

CivicVox-Omni is a local-first, ultra-low-latency multi-modal emergency intelligence platform built for the City of Toronto. It accepts simultaneous live video and voice streams from frontline responders or citizens, runs vision and language inference entirely on an NVIDIA Grace Blackwell GB10 edge node, cross-references real-time geospatial datasets from the Toronto Open Data Portal, and outputs actionable, military-grade dispatch intelligence in under 100 milliseconds — with zero cloud dependency. 

## **Hackathon Context** 

_CivicVox-Omni is developed for NVIDIA Spark Hack Toronto (Antler & NVIDIA). The system showcases the power of the ASUS GX10 / GB10 Grace Blackwell Superchip for sovereign, privacypreserving edge AI in critical public-service scenarios._ 

## **2. Problem Statement** 

## **2.1 The Gap in Emergency Response** 

During large-scale urban emergencies — flash floods, building collapses, gas main ruptures — first responders and municipal dispatch coordinators face three compounding problems: 

- Cloud-dependent tools fail precisely when networks are overwhelmed or knocked offline. 

- Fragmented municipal datasets (building records, hydrant locations, 311 history) live in silos and cannot be queried quickly enough to aid real-time decisions. 

- Language and accessibility barriers prevent many Torontonians from accurately communicating the nature of an emergency to dispatchers. 

## **2.2 Opportunity** 

Modern edge-compute silicon (the NVIDIA GB10) is capable of running multi-modal large language models — vision, speech, and text — at throughput previously only achievable in hyperscale data centres. Paired with Toronto's extensive Open Data Portal, this creates an opportunity to build a local AI brain for urban emergency response that is faster, more private, and more resilient than any cloudbased alternative. 

## **3. Goals & Success Metrics** 

## **3.1 Goals** 

- Provide end-to-end incident classification and dispatch intelligence in under 100 ms from the moment a video frame or audio utterance is received. 

© 2026 CivicVox Team  ·  Spark Hack Toronto 

Page 2 

CivicVox-Omni  ·  PRD v1.0 **CONFIDENTIAL — SPARK HACK TORONTO** 

- Operate fully offline — no external API calls during a live incident. 

- Ingest multilingual speech and parse live video feeds simultaneously on a single edge node. 

- Surface the three nearest Toronto Open Data infrastructure assets (hydrants, evacuation routes, affected buildings) within the generated dispatch report. 

- Deliver a compelling, real-time visual dashboard that communicates agent activity and spatial intelligence to a non-technical audience. 

## **3.2 Success Metrics** 

||||
|---|---|---|
|**Metric**|**Target**|**Priority**|
||||
||||
|End-to-end latency (voice in → dispatch<br>report out)|< 100 ms|P0|
|Vision frame analysis throughput|≥ 10 FPS on GB10|P0|
||||
|Speech-to-text word error rate (English)|< 8%|P1|
||||
|Open Data spatial query response time|< 20 ms|P0|
|Supported incident types classified|≥ 6 categories|P1|
||||
|Dashboard live refresh rate|≤ 500 ms|P1|
|Uptime during demo (offline mode)|100%|P0|
||||



## **4. Target Users** 

||||
|---|---|---|
|**Persona**|**Role**|**Primary Need**|
||||
|Emergency Dispatcher|Municipal 911 / 311 coordinator|Instant, structured incident intelligence<br>without manual data lookup|
||||
|First Responder|Police, fire, paramedic on scene|Hands-free situational awareness via<br>voice interface|
|Citizen Reporter|Any Toronto resident|Simple video/voice channel to convey<br>emergency conditions accurately|
||||
|City Operations<br>Manager|Toronto Emergency<br>Management|Real-time dashboard view of active<br>incidents and asset utilization|
||||



## **5. Features & Requirements** 

## **5.1 Core Feature Set** 

## **F-01: Live Multi-Modal Ingestion** 

© 2026 CivicVox Team  ·  Spark Hack Toronto 

Page 3 

CivicVox-Omni  ·  PRD v1.0 **CONFIDENTIAL — SPARK HACK TORONTO** 

- Accept a WebRTC or WebSocket stream carrying simultaneous JPEG video frames and PCM audio from a mobile browser or webcam. 

- Buffer the latest 5 frames and the most recent 30-second audio window in memory for agent consumption. 

- Support multilingual speech (English, French, Mandarin, Tagalog, Punjabi — Toronto's top 5 community languages). 

## **F-02: Local Vision Agent** 

- Run a Vision-Language Model (Llama-3.2-Vision or Phi-3.5-Vision, compiled via NVIDIA TensorRT-LLM) entirely on-device. 

- Extract structured metadata from each frame: hazard type, estimated severity scale (1–10), water depth, structural damage indicators, and approximate geolocation cues. 

- Return structured JSON output within a single inference pass. 

## **F-03: Local Speech Processing** 

- Transcribe incoming audio using Faster-Whisper Large-v3 or NVIDIA Riva (on-device). 

- Detect incident keywords and urgency signals in the transcript to trigger the Orchestrator Agent. 

- Support synthesis of the dispatch report back to audio using Kokoro-82M TTS for dispatcher playback. 

## **F-04: Localizer Agent (GIS / Open Data RAG)** 

- Load Toronto Open Data assets into memory at startup: Fire Hydrant locations, RentSafeTO building evaluations, Street Centerlines, and 311 Service Request history. 

- Execute spatial proximity queries (R-tree index via GeoPandas) to surface the 3 closest relevant infrastructure assets to the reported GPS coordinate in < 20 ms. 

- Cross-reference the RentSafeTO database to retrieve building compliance, floor count, and primary contact details for any address. 

## **F-05: Orchestrator Agent (LangGraph State Machine)** 

- Coordinate the Vision Agent and Localizer Agent asynchronously using a LangGraph StateGraph. 

- Classify the incident into one of six categories: Flooding, Fire, Structural Collapse, Gas Leak, Medical Mass Casualty, or Unclassified. 

- Route the compiled context to the Report Compiler node for final synthesis. 

## **F-06: Dispatch Report Generation** 

- Synthesise a priority-coded dispatch action protocol combining visual threat data, transcribed audio, and spatial infrastructure intelligence. 

- Output a structured report containing: threat classification, perimeter radius recommendation, 3 nearest operational infrastructure assets, building blueprint vulnerabilities, and recommended crew dispatch count. 

## **F-07: Live Dashboard** 

© 2026 CivicVox Team  ·  Spark Hack Toronto 

Page 4 

CivicVox-Omni  ·  PRD v1.0 **CONFIDENTIAL — SPARK HACK TORONTO** 

- Next.js dark-mode web application with Tailwind CSS and Framer Motion animations. 

- Mapbox GL JS dark vector tile map of Toronto with real-time incident pin, asset overlays, and animated alert radius. 

- Agent telemetry panel displaying live node-activation states (Orchestrator → Vision → Localizer → Compiler) with pulsing status indicators. 

- Streaming markdown text window rendering the dispatch report as it is generated token-bytoken. 

- Mobile camera capture widget using MediaDevices API for live video feed to the local backend. 

## **5.2 Out of Scope (v1.0)** 

- Integration with live CAD (Computer-Aided Dispatch) production systems. 

- Persistent historical incident database. 

- Real-time pull from TTC GTFS-RT transit feeds. 

- Multi-node federated agent deployment. 

## **6. User Stories** 

|||||
|---|---|---|---|
|**ID**|**As a…**|**I want to…**|**So that…**|
|||||
|US-01|Dispatcher|Receive a structured incident<br>report the moment a citizen<br>starts streaming|I can dispatch the correct crew<br>without waiting for manual lookup|
|||||
|||||
|US-02|First Responder|Speak a situation report hands-<br>free and get the nearest hydrant<br>location spoken back|I can act without looking at a<br>screen|
|US-03|Citizen|Point my phone camera at<br>flooding and have the system<br>understand what it sees|I don't need to describe it<br>accurately under stress|
|US-04|City Manager|Watch a real-time map show<br>incident location and all relevant<br>assets|I have full operational awareness<br>at a glance|
|||||
|US-05|System|Complete full analysis without a<br>cloud connection|The platform remains operational<br>when city networks are saturated|
|||||



## **7. Constraints & Assumptions** 

## **7.1 Constraints** 

- All AI inference must execute on a single ASUS GX10 (NVIDIA GB10 Grace Blackwell Superchip) — no paid external API calls during a live demo. 

© 2026 CivicVox Team  ·  Spark Hack Toronto 

Page 5 

CivicVox-Omni  ·  PRD v1.0 **CONFIDENTIAL — SPARK HACK TORONTO** 

- All Toronto Open Data must be downloaded and loaded locally prior to the demo (no live API dependency). 

- Total hackathon build time: approximately 24–36 hours across a 3-person team. 

- The frontend must be accessible from a separate mobile device on the same local network to demonstrate live video streaming. 

## **7.2 Assumptions** 

- The ASUS GX10 provided by the hackathon organizers will be available for team use throughout the event. 

- A stable local Wi-Fi network exists between the demo device and the GB10 edge node. 

- Toronto Open Data Portal .geojson files are publicly downloadable with no authentication required. 

- NVIDIA NIM or vLLM can be configured on the GB10 within the first 3 hours of the event. 

## **8. Risks & Mitigations** 

|||||
|---|---|---|---|
|**Risk**|**Likelihood**|**Impact**|**Mitigation**|
|||||
|||||
|VLM model does not fit in<br>GB10 VRAM|Medium|High|Pre-quantize model to INT4 using NVIDIA<br>TensorRT-LLM before the event|
|Local inference server<br>setup takes too long|Medium|High|Test vLLM/Ollama setup on a similar GPU<br>the week before; prepare a fallback Ollama<br>config|
|||||
|Geospatial data files are<br>large and slow to<br>download|Low|Medium|Pre-download all .geojson files and commit<br>them to the repo before the hackathon<br>starts|
|||||
|WebRTC video stream<br>has high latency on local<br>network|Low|Medium|Fallback to polling JPEG snapshot every 2 s<br>via HTTP if WebRTC is unstable|
|Frontend–backend<br>integration fails near demo<br>time|High|Medium|Run integration test at Hour 12; freeze APIs<br>early and use mock data stubs in frontend|
|||||



## **9. High-Level Timeline** 

|||||
|---|---|---|---|
|**Phase**|**Hours**|**Owner**|**Deliverable**|
|||||
|Environment Setup|0–3|Person 1|Local inference server live, model endpoint<br>verified|



© 2026 CivicVox Team  ·  Spark Hack Toronto 

Page 6 

CivicVox-Omni  ·  PRD v1.0 **CONFIDENTIAL — SPARK HACK TORONTO** 

|||||
|---|---|---|---|
|**Phase**|**Hours**|**Owner**|**Deliverable**|
|||||
|||||
|Data Ingestion & GIS|0–3|Person 2|Toronto Open Data downloaded, spatial index<br>built|
|UI Scaffold|0–4|Person 3|Next.js shell, Mapbox map, dark theme live|
|||||
|Agent Engine|3–9|Person 2|LangGraph state machine running end-to-end<br>with mocks|
|API Gateway|3–9|Person 1|FastAPI endpoints accepting video frames and<br>GPS|
|Live Camera & Map<br>Overlays|4–10|Person 3|MediaDevices capture, incident pins, asset<br>markers|
|||||
|Integration Test|12|All|Full loop: phone → backend → agents → map<br>update|
|Polish & Pitch Prep|12–24|All|Framer Motion animations, TTS playback, demo<br>script|
|||||



## **Appendix A: Toronto Open Data Sources** 

||||
|---|---|---|
|**Dataset**|**Format**|**Portal URL**|
||||
|Fire Hydrant Physical<br>Locations|GeoJSON|open.toronto.ca/dataset/fire-hydrants|
||||
|Apartment Building<br>Evaluations (RentSafeTO)|CSV / JSON|open.toronto.ca/dataset/apartment-building-evaluation|
|Street Centreline|GeoJSON|open.toronto.ca/dataset/toronto-centreline-tcl|
||||
|311 Service Requests|CSV|open.toronto.ca/dataset/311-service-requests-<br>customer-initiated|
||||



© 2026 CivicVox Team  ·  Spark Hack Toronto 

Page 7 

