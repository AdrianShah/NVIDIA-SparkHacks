"""Replay stable Delation incident scenarios through the HTTP gateway."""
import argparse
import json
import urllib.request


SCENARIOS = [
    {
        "name": "Flood prediction confirmation",
        "payload": {
            "transcript": "Water is rising quickly in the basement near the electrical panels.",
            "gps": {"lat": 43.6629, "lng": -79.3957},
        },
    },
    {
        "name": "Fire alternate incident",
        "payload": {
            "transcript": "Smoke is visible from the second floor and residents are evacuating.",
            "gps": {"lat": 43.6532, "lng": -79.3832},
        },
    },
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8080")
    args = parser.parse_args()
    for scenario in SCENARIOS:
        request = urllib.request.Request(
            f"{args.api}/api/incident",
            data=json.dumps(scenario["payload"]).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.load(response)
        print(f"\n=== {scenario['name']} ===")
        print(json.dumps({
            "urgency": result["urgency"],
            "ward_risk": result["ward_risk"],
            "compound_risk": result["compound_risk"],
            "escalated": result["escalated"],
            "performance": result["performance"],
        }, indent=2))


if __name__ == "__main__":
    main()
