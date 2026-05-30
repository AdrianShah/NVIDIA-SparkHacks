"""
Downloads all required Toronto Open Data files into the /backend/data/ directory.
Run this BEFORE the hackathon to avoid reliance on venue Wi-Fi.

Usage:
    python -m backend.data.download_toronto_data
"""
import os
import sys
import requests
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", os.path.dirname(__file__)))
CKAN_BASE = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action"

DATASETS = [
    {
        "id": "fire-hydrants",
        "preferred_format": "GeoJSON",
        "output": "fire-hydrants.geojson",
    },
    {
        "id": "apartment-building-evaluation",
        "preferred_format": "JSON",
        "output": "apartment-building-evaluation.json",
        "alt_format": "CSV",
        "alt_output": "apartment-building-evaluation.csv",
    },
    {
        "id": "toronto-centreline-tcl",
        "preferred_format": "GeoJSON",
        "output": "toronto-centreline.geojson",
    },
    {
        "id": "311-service-requests-customer-initiated",
        "preferred_format": "CSV",
        "output": "311-service-requests.csv",
    },
]


def get_resource_url(package_id: str, preferred_format: str) -> tuple[str | None, str]:
    print(f"  Fetching metadata for '{package_id}'...")
    resp = requests.get(
        f"{CKAN_BASE}/package_show",
        params={"id": package_id},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    if not data.get("success"):
        return None, preferred_format

    resources = data["result"].get("resources", [])

    for resource in resources:
        fmt = resource.get("format", "").upper()
        if fmt == preferred_format.upper():
            return resource["url"], fmt

    # Fallback: return first downloadable resource
    for resource in resources:
        if resource.get("url"):
            return resource["url"], resource.get("format", "unknown")

    return None, preferred_format


def download_file(url: str, output_path: Path) -> None:
    print(f"  -> {url}")
    resp = requests.get(url, stream=True, timeout=300)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    downloaded = 0

    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                mb = downloaded / 1024 / 1024
                print(f"\r  {pct:5.1f}%  {mb:6.1f} MB", end="", flush=True)
    print(f"\r  Done    {downloaded / 1024 / 1024:.1f} MB")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for dataset in DATASETS:
        pkg_id = dataset["id"]
        output_path = DATA_DIR / dataset["output"]

        if output_path.exists():
            print(f"[SKIP] {dataset['output']} already exists ({output_path.stat().st_size // 1024} KB)")
            continue

        print(f"\n[FETCH] {pkg_id}")
        url, fmt = get_resource_url(pkg_id, dataset["preferred_format"])

        if not url and "alt_format" in dataset:
            url, fmt = get_resource_url(pkg_id, dataset["alt_format"])
            output_path = DATA_DIR / dataset["alt_output"]

        if not url:
            print(f"  [WARN] No download URL found for {pkg_id} — skipping")
            continue

        try:
            download_file(url, output_path)
            print(f"  [OK] Saved → {output_path}")
        except Exception as exc:
            print(f"  [ERROR] {exc}")

    print("\n✓ Download complete. Total files in data dir:")
    for f in sorted(DATA_DIR.glob("*")):
        if f.is_file() and not f.name.endswith(".py"):
            print(f"  {f.name:50s}  {f.stat().st_size // 1024:>8} KB")


if __name__ == "__main__":
    main()
