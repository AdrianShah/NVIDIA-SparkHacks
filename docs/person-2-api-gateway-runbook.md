# Person 2 API Gateway Runbook

Person 2 owns `backend/server.py`, the only network-facing process in CivicVox-Omni. The gateway binds to `0.0.0.0:8080`, accepts frontend traffic, builds the AgentState dict for Person 3's LangGraph engine, and exposes TTS/STT adapters for Person 1's local models.

## Start In Mock Mode

Use mock mode first so Person 5 can build against stable contracts without GPU, Whisper, Kokoro, or live LangGraph dependencies.

```bash
pip install -r requirements.txt
MOCK_MODE=true uvicorn backend.server:app --host 0.0.0.0 --port 8080
```

Windows PowerShell:

```powershell
$env:MOCK_MODE = "true"
uvicorn backend.server:app --host 0.0.0.0 --port 8080
```

Expected handoff URLs:

- Health: `http://localhost:8080/api/health`
- Incident: `http://localhost:8080/api/incident`
- Shared feed: `GET http://localhost:8080/api/incidents` (web + mobile poll every 4s)
- Predictive ward risk map: `http://localhost:8080/api/risk-map`
- Environmental risk: `http://localhost:8080/api/environmental-risk?lat=43.6532&lng=-79.3832`
- Telemetry: `ws://localhost:8080/ws/stream`
- TTS: `http://localhost:8080/api/synthesize`

## Public Contracts

`POST /api/incident`

```json
{
  "transcript": "There is flooding in my basement",
  "frame_b64": "<JPEG encoded as base64 string>",
  "gps": { "lat": 43.6629, "lng": -79.3957 }
}
```

Response:

```json
{
  "urgency": "CRITICAL",
  "report": "THREAT: Flash flooding - Category 3...",
  "vision": {
    "hazard_type": "Flooding",
    "severity_scale": 7,
    "water_depth_m": 0.4,
    "structural_risk": false,
    "location_cues": "Brick residential building, north-facing"
  },
  "spatial": {
    "closest_hydrant": { "id": 1042, "distance_meters": 38.5, "status": "Operational" },
    "building_specs": {
      "address": "123 Example St",
      "floors": 12,
      "contact": "Toronto Housing Corp",
      "last_inspection": "2025-11-14"
    },
    "nearest_road": { "road_name": "Spadina Ave", "distance_meters": 12.0 }
  }
}
```

`WS /ws/stream` emits telemetry frames:

```json
{ "node": "vision", "status": "active", "timestamp": "2026-05-29T21:05:33.412Z" }
```

The same WebSocket also accepts live speech audio. Raw stream clients can send mono PCM chunks as binary frames, then send an `audio_commit` JSON control frame:

```json
{ "type": "audio_commit" }
```

PCM format:

- Sample rate: `16000 Hz`
- Channels: `1` (mono)
- Sample width: `16-bit signed little-endian`
- Buffer: latest `30 seconds` per WebSocket connection

The gateway responds with STT telemetry:

```json
{
  "node": "stt",
  "status": "complete",
  "timestamp": "2026-05-30T12:00:00Z",
  "data": {
    "transcript": "There is flooding in my basement",
    "audio_bytes": 64000,
    "used_fallback": false
  }
}
```

Send the usual incident JSON frame after `audio_commit`. If its `transcript` is blank or a generic fallback message, the gateway injects the latest Whisper transcript into Person 3's AgentState. An explicit typed transcript still wins. Existing JSON-only clients continue to work unchanged.

Expo mobile records `.m4a` containers. Before uploading the recording bytes, send:

```json
{ "type": "audio_start", "format": "m4a" }
```

Mobile then sends a base64 chunk followed by the same commit frame:

```json
{ "type": "audio_chunk", "data": "<base64 m4a bytes>" }
{ "type": "audio_commit" }
```

The gateway also supports `caf`, `webm`, and `3gp` containers. Faster-Whisper decodes declared containers before transcription. The default format remains `pcm_s16le` for clients that stream raw PCM.

`POST /api/synthesize` accepts `{ "text": "..." }` and returns `audio/wav`. If Kokoro is unavailable, the gateway returns a short valid WAV tone so frontend playback can still be tested.

`GET /api/environmental-risk?lat=43.6532&lng=-79.3832` returns:

- Regulatory floodplain exposure from TRCA's public `Floodline_TRCA_Polygon` ArcGIS service.
- Official active weather alerts from Environment and Climate Change Canada MSC GeoMet.
- Supplemental current rain, wind, humidity, and temperature conditions from Open-Meteo.

Each upstream feed is cached independently. TRCA point checks refresh hourly by default, while alerts and current conditions refresh every five minutes. If an upstream service is temporarily unreachable, the gateway serves the last successful response with `"stale": true`, or reports `"available": false` if no cached response exists. Environmental lookups never block `/api/incident`.

The refresh intervals are configurable without code changes:

```bash
TRCA_FLOOD_CACHE_TTL_SECONDS=3600
WEATHER_CACHE_TTL_SECONDS=300
ENVIRONMENTAL_RISK_TIMEOUT_SECONDS=4
```

## Delation Additive Contracts

`GET /api/risk-map` and `POST /api/risk-map` return ranked ward risk records:

```json
{
  "wards": [
    {
      "ward_id": "14",
      "ward_name": "Ward 14",
      "score": 82.0,
      "level": "CRITICAL",
      "signals": ["12 flood, drainage, or sewer-related 311 requests"]
    }
  ],
  "scoring_mode": "local-deterministic-fallback"
}
```

The gateway fallback is intentionally deterministic and ward-level. It uses loaded 311 and RentSafeTO records so Person 5 can integrate immediately. Person 4 can replace the adapter with richer polygon scoring without changing the public contract.

`POST /api/incident` preserves the original `report`, `urgency`, `vision`, and `spatial` fields and adds:

```json
{
  "environmental_risk": {},
  "ward_risk": {
    "ward_id": "14",
    "ward_name": "Toronto-Danforth",
    "score": 82.0,
    "level": "CRITICAL",
    "signals": []
  },
  "compound_risk": {
    "score": 91.0,
    "level": "CRITICAL",
    "factors": []
  },
  "escalated": true,
  "escalation_reason": "Citizen flooding report confirms predicted risk in Toronto-Danforth",
  "performance": {
    "environmental_lookup_ms": 14.2,
    "spatial_compute_path": "rapids-cudf",
    "total_incident_ms": 810.4
  }
}
```

Completed WebSocket telemetry events include `latency_ms`. Localizer events expose `compute_path`, compiler events carry the Delation enrichment, and confirmed predictions emit a `gateway` event with `data.type: "prediction_confirmed"`.

## Live Integration

Set `MOCK_MODE=false` once Person 1 and Person 3 are ready. On startup, the gateway attempts to load Toronto Open Data, Faster-Whisper, and Kokoro. Missing STT/TTS dependencies do not crash the server; the gateway logs a warning and continues so the demo can degrade gracefully.

Run tests:

```bash
pytest tests
```

Run pre-demo checks and stable replay scenarios after starting the gateway:

```bash
python scripts/check_demo_ready.py
python scripts/replay_demo.py
```

Container startup:

```bash
docker compose up --build backend
```
