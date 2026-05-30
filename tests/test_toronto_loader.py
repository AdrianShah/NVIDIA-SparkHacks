"""Person 4 — spatial query smoke tests (require backend/data datasets)."""
from pathlib import Path

import pytest

from backend.data import toronto_loader as tl

DATA_DIR = Path(__file__).resolve().parents[1] / "backend" / "data"
HAS_DATA = (DATA_DIR / "fire-hydrants.geojson").exists()

# Five Toronto test coordinates (DRD integration checklist)
TEST_COORDS = [
    (43.6629, -79.3957),  # downtown / U of T
    (43.66, -79.39),
    (43.6532, -79.3832),  # City Hall area
    (43.70, -79.40),  # midtown north
    (43.64, -79.38),  # harbourfront south
]


@pytest.fixture(scope="module")
def loaded():
    if not HAS_DATA:
        pytest.skip("Toronto Open Data files not present in backend/data/")
    tl.load_all()
    return tl


@pytest.mark.parametrize("lat,lng", TEST_COORDS)
def test_get_closest_hydrants(loaded, lat, lng):
    hydrants = loaded.get_closest_hydrants(lat, lng, n=3)
    assert len(hydrants) == 3
    for h in hydrants:
        assert h["distance_meters"] >= 0
        assert h["status"]
        assert "lat" in h and "lng" in h


@pytest.mark.parametrize("lat,lng", TEST_COORDS)
def test_get_building_specs(loaded, lat, lng):
    building = loaded.get_building_specs(lat, lng)
    assert building
    assert building["address"] != "Unknown"
    assert building["distance_meters"] >= 0


@pytest.mark.parametrize("lat,lng", TEST_COORDS)
def test_get_nearest_road(loaded, lat, lng):
    road = loaded.get_nearest_road(lat, lng)
    assert road
    assert road["road_name"] != "Unknown"
    assert road["distance_meters"] >= 0


@pytest.mark.parametrize("lat,lng", TEST_COORDS)
def test_get_311_history(loaded, lat, lng):
    history = loaded.get_311_history(lat, lng, limit=5)
    assert isinstance(history, list)
    if history:
        row = history[0]
        assert "type" in row and "status" in row
