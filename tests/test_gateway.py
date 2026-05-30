import base64

from fastapi.testclient import TestClient

from backend import server


def _client() -> TestClient:
    server.MOCK_MODE = True
    return TestClient(server.app)


def test_health_reports_contract_shape():
    with _client() as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["mock_mode"] is True
    assert set(body["models_loaded"]) == {"whisper", "kokoro"}
    assert set(body["data_loaded"]) == {"hydrants", "buildings", "streets", "311_requests"}
    assert set(body["external_feeds"]) == {
        "trca_floodplain",
        "environment_canada_alerts",
        "open_meteo_conditions",
    }


def test_mock_incident_preserves_section_10_shape():
    payload = {
        "transcript": "There is flooding in my basement",
        "frame_b64": "abc123",
        "gps": {"lat": 43.6629, "lng": -79.3957},
    }

    with _client() as client:
        response = client.post("/api/incident", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert {"report", "urgency", "vision", "spatial"} <= set(body)
    assert body["urgency"] == "CRITICAL"
    assert body["vision"]["hazard_type"] == "Flooding"
    assert body["spatial"]["closest_hydrant"]["id"] == 1042
    hydrant = body["spatial"]["closest_hydrants"][0]
    assert "lat" in hydrant and "lng" in hydrant


def test_incident_uses_default_transcript_when_blank():
    payload = {
        "transcript": "",
        "frame_b64": "abc123",
        "gps": {"lat": 43.6629, "lng": -79.3957},
    }

    with _client() as client:
        response = client.post("/api/incident", json=payload)

    assert response.status_code == 200


def test_incident_uses_default_transcript_when_missing():
    payload = {
        "frame_b64": "abc123",
        "gps": {"lat": 43.6629, "lng": -79.3957},
    }

    with _client() as client:
        response = client.post("/api/incident", json=payload)

    assert response.status_code == 200


def test_incident_rejects_invalid_gps():
    payload = {
        "transcript": "Flooding",
        "frame_b64": "abc123",
        "gps": {"lat": 143.6629, "lng": -79.3957},
    }

    with _client() as client:
        response = client.post("/api/incident", json=payload)

    assert response.status_code == 422


def test_synthesize_returns_wav_even_without_kokoro():
    server._kokoro_model = None

    with _client() as client:
        response = client.post("/api/synthesize", json={"text": "Dispatch rescue team"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/wav")
    assert "x-latency-ms" in response.headers
    assert response.content.startswith(b"RIFF")


def test_synthesize_rejects_empty_text():
    with _client() as client:
        response = client.post("/api/synthesize", json={"text": ""})

    assert response.status_code == 422


def test_audio_buffer_keeps_latest_30_seconds():
    audio_buffer = bytearray()

    server._append_audio_chunk(audio_buffer, b"a" * (server.PCM_MAX_BYTES + 10))

    assert len(audio_buffer) == server.PCM_MAX_BYTES
    assert audio_buffer == b"a" * server.PCM_MAX_BYTES


def test_audio_transcript_replaces_default_but_not_explicit_transcript():
    assert server._select_transcript("", "Basement flooding") == "Basement flooding"
    assert server._select_transcript("Emergency incident reported", "Basement flooding") == "Basement flooding"
    assert server._select_transcript("Kitchen fire", "Basement flooding") == "Kitchen fire"


def test_websocket_audio_commit_emits_stt_transcript(monkeypatch):
    monkeypatch.setattr(server, "transcribe_audio", lambda audio_bytes, audio_format: "Basement flooding")

    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_bytes(b"\x00\x00" * 160)
            websocket.send_json({"type": "audio_commit"})
            active = websocket.receive_json()
            complete = websocket.receive_json()

    assert active["node"] == "stt"
    assert active["status"] == "active"
    assert complete["node"] == "stt"
    assert complete["status"] == "complete"
    assert complete["data"]["transcript"] == "Basement flooding"
    assert complete["data"]["audio_format"] == "pcm_s16le"
    assert complete["data"]["used_fallback"] is False


def test_websocket_audio_commit_without_audio_emits_error():
    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json({"type": "audio_commit"})
            event = websocket.receive_json()

    assert event["node"] == "stt"
    assert event["status"] == "error"
    assert event["data"]["detail"] == "no buffered PCM audio"


def test_websocket_audio_commit_without_whisper_uses_transcript_fallback(monkeypatch):
    monkeypatch.setattr(server, "transcribe_audio", lambda audio_bytes, audio_format: "")

    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_bytes(b"\x00\x00" * 160)
            websocket.send_json({"type": "audio_commit"})
            websocket.receive_json()
            complete = websocket.receive_json()

    assert complete["node"] == "stt"
    assert complete["status"] == "complete"
    assert complete["data"]["transcript"] == ""
    assert complete["data"]["used_fallback"] is True


def test_websocket_m4a_audio_commit_preserves_declared_format(monkeypatch):
    received = {}

    def transcribe(audio_bytes, audio_format):
        received["audio_bytes"] = audio_bytes
        received["audio_format"] = audio_format
        return "Smoke on the second floor"

    monkeypatch.setattr(server, "transcribe_audio", transcribe)

    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json({"type": "audio_start", "format": "m4a"})
            websocket.send_bytes(b"mock-m4a-container")
            websocket.send_json({"type": "audio_commit"})
            websocket.receive_json()
            complete = websocket.receive_json()

    assert received == {
        "audio_bytes": b"mock-m4a-container",
        "audio_format": "m4a",
    }
    assert complete["data"]["audio_format"] == "m4a"
    assert complete["data"]["transcript"] == "Smoke on the second floor"


def test_websocket_base64_audio_chunk_reaches_transcriber(monkeypatch):
    received = {}

    def transcribe(audio_bytes, audio_format):
        received["audio_bytes"] = audio_bytes
        received["audio_format"] = audio_format
        return "Gas leak reported"

    monkeypatch.setattr(server, "transcribe_audio", transcribe)

    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json({"type": "audio_start", "format": "m4a"})
            websocket.send_json({
                "type": "audio_chunk",
                "data": base64.b64encode(b"mock-m4a-container").decode("ascii"),
            })
            websocket.send_json({"type": "audio_commit"})
            websocket.receive_json()
            complete = websocket.receive_json()

    assert received == {
        "audio_bytes": b"mock-m4a-container",
        "audio_format": "m4a",
    }
    assert complete["data"]["transcript"] == "Gas leak reported"


def test_websocket_rejects_invalid_base64_audio_chunk():
    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json({"type": "audio_chunk", "data": "%not-base64%"})
            event = websocket.receive_json()

    assert event["node"] == "stt"
    assert event["status"] == "error"
    assert event["data"]["detail"] == "invalid base64 audio chunk"


def test_websocket_rejects_unsupported_audio_format():
    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json({"type": "audio_start", "format": "mp3"})
            event = websocket.receive_json()

    assert event["node"] == "stt"
    assert event["status"] == "error"
    assert event["data"]["detail"] == "unsupported audio format: mp3"


def test_websocket_mock_mode_emits_telemetry_events():
    payload = {
        "transcript": "There is flooding in my basement",
        "frame_b64": "abc123",
        "gps": {"lat": 43.6629, "lng": -79.3957},
    }

    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json(payload)
            first = websocket.receive_json()
            second = websocket.receive_json()

    assert first["node"] == "orchestrator"
    assert first["status"] == "active"
    assert second["node"] == "orchestrator"
    assert second["status"] == "complete"
    assert "timestamp" in first


def test_websocket_mock_mode_streams_all_nodes():
    payload = {
        "transcript": "Fire on the second floor",
        "frame_b64": "abc123",
        "gps": {"lat": 43.6629, "lng": -79.3957},
    }

    with _client() as client:
        with client.websocket_connect("/ws/stream") as websocket:
            websocket.send_json(payload)
            events = []
            for _ in range(8):  # 4 nodes x 2 events (active + complete)
                events.append(websocket.receive_json())

    nodes_seen = [e["node"] for e in events if e["status"] == "complete"]
    assert nodes_seen == ["orchestrator", "vision", "localizer", "compiler"]

    compiler_event = events[-1]
    assert "final_dispatch_report" in compiler_event.get("data", {})
    assert "urgency_level" in compiler_event.get("data", {})
