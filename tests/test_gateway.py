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
    assert set(body) == {"report", "urgency", "vision", "spatial"}
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
    assert response.content.startswith(b"RIFF")


def test_synthesize_rejects_empty_text():
    with _client() as client:
        response = client.post("/api/synthesize", json={"text": ""})

    assert response.status_code == 422


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
