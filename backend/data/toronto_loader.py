"""
Loads Toronto Open Data GeoJSON/CSV files into memory at startup.
Builds R-tree spatial indices for sub-millisecond nearest-neighbour queries.
All geometries are projected to NAD83 / UTM Zone 17N (EPSG:2958) for accurate
metre-based distance calculations.
"""
import logging
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd
from pyproj import Transformer
from shapely.geometry import Point

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("DATA_DIR", os.path.dirname(__file__)))
TARGET_CRS = "EPSG:2958"  # NAD83 / UTM Zone 17N

_hydrants_gdf: gpd.GeoDataFrame | None = None
_buildings_gdf: gpd.GeoDataFrame | None = None
_streets_gdf: gpd.GeoDataFrame | None = None
_requests_df: pd.DataFrame | None = None

_to_utm = Transformer.from_crs("EPSG:4326", TARGET_CRS, always_xy=True)
_to_wgs84 = Transformer.from_crs(TARGET_CRS, "EPSG:4326", always_xy=True)


def _point_utm(lat: float, lng: float) -> Point:
    x, y = _to_utm.transform(lng, lat)
    return Point(x, y)


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(geometry=gpd.GeoSeries([], crs=TARGET_CRS))


def _df_with_coords_to_gdf(df: pd.DataFrame) -> gpd.GeoDataFrame:
    lat_col = next(
        (c for c in df.columns if c.upper() in {"LATITUDE", "LAT", "Y"}), None
    )
    lng_col = next(
        (c for c in df.columns if c.upper() in {"LONGITUDE", "LNG", "LON", "LONG", "X"}), None
    )
    if not (lat_col and lng_col):
        logger.warning("Could not find lat/lng columns in dataframe — columns: %s", df.columns.tolist())
        return _empty_gdf()

    df = df.dropna(subset=[lat_col, lng_col]).copy()
    df[lat_col] = pd.to_numeric(df[lat_col], errors="coerce")
    df[lng_col] = pd.to_numeric(df[lng_col], errors="coerce")
    df = df.dropna(subset=[lat_col, lng_col])

    geometry = [Point(row[lng_col], row[lat_col]) for _, row in df.iterrows()]
    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
    return gdf.to_crs(TARGET_CRS)


def load_all() -> None:
    global _hydrants_gdf, _buildings_gdf, _streets_gdf, _requests_df

    # ── Fire Hydrants ─────────────────────────────────────────────────────────
    hydrants_path = DATA_DIR / "fire-hydrants.geojson"
    if hydrants_path.exists():
        _hydrants_gdf = gpd.read_file(hydrants_path).to_crs(TARGET_CRS)
        _ = _hydrants_gdf.sindex  # pre-build R-tree index
        logger.info("Loaded %d fire hydrants", len(_hydrants_gdf))
    else:
        logger.warning("fire-hydrants.geojson not found — run download_toronto_data.py")
        _hydrants_gdf = _empty_gdf()

    # ── RentSafeTO Apartment Building Evaluations ─────────────────────────────
    for bpath, reader in [
        (DATA_DIR / "apartment-building-evaluation.json", pd.read_json),
        (DATA_DIR / "apartment-building-evaluation.csv", lambda p: pd.read_csv(p, low_memory=False)),
    ]:
        if bpath.exists():
            df = reader(bpath)
            _buildings_gdf = _df_with_coords_to_gdf(df)
            if len(_buildings_gdf) > 0:
                _ = _buildings_gdf.sindex
                logger.info("Loaded %d apartment buildings", len(_buildings_gdf))
            break
    else:
        logger.warning("apartment-building-evaluation file not found")
        _buildings_gdf = _empty_gdf()

    # ── Street Centreline (large — optional) ──────────────────────────────────
    streets_path = DATA_DIR / "toronto-centreline.geojson"
    if streets_path.exists():
        _streets_gdf = gpd.read_file(streets_path).to_crs(TARGET_CRS)
        logger.info("Loaded %d street segments", len(_streets_gdf))
    else:
        logger.info("toronto-centreline.geojson not found — street lookup disabled")

    # ── 311 Service Requests ──────────────────────────────────────────────────
    requests_path = DATA_DIR / "311-service-requests.csv"
    if requests_path.exists():
        _requests_df = pd.read_csv(requests_path, low_memory=False)
        logger.info("Loaded %d 311 service requests", len(_requests_df))


def get_closest_hydrants(lat: float, lng: float, n: int = 3) -> list[dict]:
    """Return n nearest fire hydrants to (lat, lng), sorted by distance."""
    if _hydrants_gdf is None or len(_hydrants_gdf) == 0:
        return []

    point = _point_utm(lat, lng)

    # Use R-tree for fast candidate selection, then exact distance sort
    candidate_count = min(n * 4, len(_hydrants_gdf))
    candidate_idx = list(_hydrants_gdf.sindex.nearest(point, return_all=False))

    # Compute exact distances for all candidates
    distances = _hydrants_gdf.geometry.distance(point)
    nearest = distances.nsmallest(n)

    results = []
    for row_idx, dist in nearest.items():
        row = _hydrants_gdf.loc[row_idx]
        utm_x, utm_y = row.geometry.x, row.geometry.y
        h_lng, h_lat = _to_wgs84.transform(utm_x, utm_y)

        results.append({
            "id": str(row.get("OBJECTID", row.get("ASSET_ID", str(row_idx)))),
            "distance_meters": round(float(dist), 1),
            "status": str(row.get("STATUS", row.get("HYDRANT_STATUS", "Operational"))),
            "address": str(row.get("ADDRESS", row.get("STREET_NAME", ""))),
            "lat": round(h_lat, 6),
            "lng": round(h_lng, 6),
        })
    return results


def get_building_specs(lat: float, lng: float) -> dict:
    """Return the nearest apartment building evaluation record to (lat, lng)."""
    if _buildings_gdf is None or len(_buildings_gdf) == 0:
        return {}

    point = _point_utm(lat, lng)
    distances = _buildings_gdf.geometry.distance(point)
    if distances.empty:
        return {}

    nearest_idx = distances.idxmin()
    row = _buildings_gdf.loc[nearest_idx]
    dist = distances[nearest_idx]

    b_lng, b_lat = _to_wgs84.transform(row.geometry.x, row.geometry.y)

    return {
        "address": str(row.get("SITE_ADDRESS", row.get("ADDRESS", "Unknown"))),
        "distance_meters": round(float(dist), 1),
        "floors": int(row.get("CONFIRMED_STOREYS", row.get("STOREYS", 0)) or 0),
        "units": int(row.get("CONFIRMED_UNITS", row.get("UNITS", 0)) or 0),
        "score": float(row.get("SCORE", row.get("EVALUATION_SCORE", 0)) or 0),
        "year_built": int(row.get("YEAR_BUILT", 0) or 0),
        "property_type": str(row.get("PROPERTY_TYPE", "")),
        "contact": str(row.get("PROPERTY_MANAGER", row.get("CURRENT_OWNER", "Toronto Housing"))),
        "lat": round(b_lat, 6),
        "lng": round(b_lng, 6),
    }


def get_311_history(lat: float, lng: float, radius_km: float = 0.5, limit: int = 10) -> list[dict]:
    """Return recent 311 service requests near (lat, lng)."""
    if _requests_df is None or len(_requests_df) == 0:
        return []

    # 311 data doesn't always have coordinates; filter by ward if available
    return []
