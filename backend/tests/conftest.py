"""
conftest.py - Shared pytest fixtures for Columbia backend tests.

Sets up a minimal data environment so tests can run without real scraped data.
"""
import json
import os
import sys
from pathlib import Path
import pytest

# ── Make sure 'backend/' is on sys.path so all imports resolve ───────────────
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(scope="session", autouse=True)
def ci_data_dirs(tmp_path_factory):
    """
    Create a minimal on-disk data layout so platform_paths.ensure_directories()
    and the pipeline modules do not crash in CI where no real data exists.
    """
    data_root = tmp_path_factory.mktemp("columbia_data")

    # Patch BASE_DIR before any module imports it
    import processing.platform_paths as pp
    pp.BASE_DIR = BACKEND_DIR
    pp.DATA_DIR = data_root
    pp.JSON_DIR = data_root
    pp.LOG_DIR = data_root / "logs"
    pp.CACHE_DIR = data_root / "cache"
    pp.NORMALIZED_PRODUCTS = data_root / "master_tuples.json"
    pp.PRICE_HISTORY = data_root / "Price" / "prices.json"
    pp.PROCESS_STATUS = data_root / "cache" / "process_status.json"
    pp.SCRAPE_PROGRESS = data_root / "cache" / "scrape_progress.json"

    # Create required directories
    for d in [data_root / "Master", data_root / "Price", data_root / "cache", data_root / "logs"]:
        d.mkdir(parents=True, exist_ok=True)

    yield data_root
