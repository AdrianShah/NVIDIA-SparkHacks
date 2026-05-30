"""Exercise Delation gateway dependencies before a live demo."""
import argparse
import asyncio
import json
import sys
import urllib.error
import urllib.request

import websockets


def _json_request(url: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="POST" if body else "GET",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


async def _check_websocket(url: str) -> None:
    async with websockets.connect(url, open_timeout=5) as websocket:
        await websocket.send(json.dumps({"type": "audio_commit"}))
        event = json.loads(await asyncio.wait_for(websocket.recv(), timeout=8))
        if not {"node", "status", "timestamp"} <= event.keys():
            raise RuntimeError("telemetry event contract incomplete")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8080")
    parser.add_argument("--ws", default="ws://localhost:8080/ws/stream")
    args = parser.parse_args()
    checks = [
        ("health", lambda: _json_request(f"{args.api}/api/health")),
        ("risk map", lambda: _json_request(f"{args.api}/api/risk-map")),
        ("environmental risk", lambda: _json_request(
            f"{args.api}/api/environmental-risk?lat=43.6532&lng=-79.3832"
        )),
        ("incident", lambda: _json_request(f"{args.api}/api/incident", {
            "transcript": "Readiness probe: water in basement",
            "gps": {"lat": 43.6629, "lng": -79.3957},
        })),
        ("synthesize", lambda: urllib.request.urlopen(
            urllib.request.Request(
                f"{args.api}/api/synthesize",
                data=b'{"text":"Readiness probe"}',
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=8,
        ).read()),
        ("websocket", lambda: asyncio.run(_check_websocket(args.ws))),
    ]
    failed = False
    for label, check in checks:
        try:
            check()
            print(f"PASS  {label}")
        except (OSError, RuntimeError, urllib.error.URLError) as exc:
            failed = True
            print(f"FAIL  {label}: {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
