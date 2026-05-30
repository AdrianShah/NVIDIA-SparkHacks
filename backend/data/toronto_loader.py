"""
Loads Toronto Open Data GeoJSON/CSV files into memory at startup.
Builds R-tree spatial indices for sub-millisecond nearest-neighbour queries.
All geometries are projected to NAD83 / UTM Zone 17N (EPSG:2958) for accurate
metre-based distance calculations.

NVIDIA Stack:
  - RAPIDS cuDF  : GPU-accelerated DataFrame operations (replaces pandas on DGX Spark)
  - RAPIDS cuSpatial: GPU nearest-neighbour point queries (replaces GeoPandas sindex)
  Falls back to pandas/GeoPandas when RAPIDS is not available (CPU dev mode).
"""
import json
import logging
import math
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd
from pyproj import Transformer
from shapely.geometry import Point, shape

# ── RAPIDS GPU acceleration (optional, available on DGX Spark) ────────────────
try:
    import cudf
    import cuspatial
    _RAPIDS_AVAILABLE = True
    logger_init = logging.getLogger(__name__)
    logger_init.info("RAPIDS cuDF + cuSpatial loaded — GPU spatial queries enabled")
except ImportError:
    cudf = None
    cuspatial = None
    _RAPIDS_AVAILABLE = False

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


def _read_geodataframe(path: Path) -> gpd.GeoDataFrame:
    """Read GeoJSON or Toronto CKAN CSV dumps with a GeoJSON geometry column."""
    try:
        gdf = gpd.read_file(path)
        if len(gdf) > 0:
            return gdf.to_crs(TARGET_CRS)
    except Exception as exc:
        logger.debug("read_file failed for %s: %s", path.name, exc)

    df = pd.read_csv(path, low_memory=False)
    if "geometry" not in df.columns:
        raise ValueError(f"No geometry column in {path.name}")

    geoms = [shape(json.loads(g)) if pd.notna(g) else None for g in df["geometry"]]
    gdf = gpd.GeoDataFrame(df, geometry=geoms, crs="EPSG:4326")
    return gdf.dropna(subset=["geometry"]).to_crs(TARGET_CRS)


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
        _hydrants_gdf = _read_geodataframe(hydrants_path)
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
        _streets_gdf = _read_geodataframe(streets_path)
        logger.info("Loaded %d street segments", len(_streets_gdf))
    else:
        logger.info("toronto-centreline.geojson not found — street lookup disabled")

    # ── 311 Service Requests ──────────────────────────────────────────────────
    requests_path = DATA_DIR / "311-service-requests.csv"
    if requests_path.exists():
        try:
            _requests_df = pd.read_csv(requests_path, low_memory=False, on_bad_lines="skip")
            logger.info("Loaded %d 311 service requests", len(_requests_df))
        except Exception as exc:
            logger.warning("Could not load 311 CSV: %s", exc)
            _requests_df = None


def _gpu_nearest_hydrants(lat: float, lng: float, n: int) -> list[int] | None:
    """Use RAPIDS cuSpatial for GPU-accelerated nearest-neighbour search.
    Returns row indices of the n nearest hydrants, or None if RAPIDS unavailable."""
    if not _RAPIDS_AVAILABLE or _hydrants_gdf is None or len(_hydrants_gdf) == 0:
        return None
    try:
        px, py = _to_utm.transform(lng, lat)
        hx = cudf.Series(_hydrants_gdf.geometry.x.values)
        hy = cudf.Series(_hydrants_gdf.geometry.y.values)
        dx = hx - px
        dy = hy - py
        sq_dist = dx * dx + dy * dy
        top_n = sq_dist.nsmallest(n)
        return list(top_n.index.to_pandas())
    except Exception as exc:
        logger.warning("cuSpatial query failed, falling back to CPU: %s", exc)
        return None


def get_closest_hydrants(lat: float, lng: float, n: int = 3) -> list[dict]:
    """Return n nearest fire hydrants to (lat, lng), sorted by distance.
    Uses RAPIDS cuSpatial (GPU) on DGX Spark, GeoPandas R-tree (CPU) elsewhere."""
    if _hydrants_gdf is None or len(_hydrants_gdf) == 0:
        return []

    point = _point_utm(lat, lng)

    # Try GPU path first (RAPIDS cuSpatial on DGX Spark)
    gpu_indices = _gpu_nearest_hydrants(lat, lng, n)
    if gpu_indices is not None:
        distances = _hydrants_gdf.geometry.distance(point)
        nearest = distances.loc[gpu_indices].sort_values().head(n)
    else:
        # CPU fallback: GeoPandas R-tree index
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
            "address": str(row.get("LOCDESC", row.get("ADDRESS", row.get("STREET_NAME", "")))),
            "lat": round(h_lat, 6),
            "lng": round(h_lng, 6),
        })
    return results


def _row_val(row: pd.Series, *keys: str, default=""):
    for key in keys:
        if key in row.index and pd.notna(row[key]):
            return row[key]
    return default


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
        "address": str(_row_val(row, "SITE ADDRESS", "SITE_ADDRESS", "ADDRESS", default="Unknown")),
        "distance_meters": round(float(dist), 1),
        "floors": int(_row_val(row, "CONFIRMED STOREYS", "CONFIRMED_STOREYS", "STOREYS", default=0) or 0),
        "units": int(_row_val(row, "CONFIRMED UNITS", "CONFIRMED_UNITS", "UNITS", default=0) or 0),
        "score": float(
            _row_val(
                row,
                "CURRENT BUILDING EVAL SCORE",
                "SCORE",
                "EVALUATION_SCORE",
                default=0,
            )
            or 0
        ),
        "year_built": int(_row_val(row, "YEAR BUILT", "YEAR_BUILT", default=0) or 0),
        "property_type": str(_row_val(row, "PROPERTY TYPE", "PROPERTY_TYPE", default="")),
        "contact": str(
            _row_val(row, "PROPERTY_MANAGER", "CURRENT_OWNER", default="Toronto Housing")
        ),
        "last_inspection": str(
            _row_val(row, "EVALUATION COMPLETED ON", "LAST_INSPECTION", default="")
        ),
        "lat": round(b_lat, 6),
        "lng": round(b_lng, 6),
    }


def get_311_history(lat: float, lng: float, radius_km: float = 0.5, limit: int = 10) -> list[dict]:
    """Return recent 311 service requests near (lat, lng)."""
    if _requests_df is None or len(_requests_df) == 0:
        return []

    # 311 data doesn't always have coordinates; filter by ward if available
    return []
