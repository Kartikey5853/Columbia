from __future__ import annotations
import sys
from pathlib import Path

BASE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
# Kept as an alias for the operational UI; no data/json directory is created.
JSON_DIR = DATA_DIR
LOG_DIR = BASE_DIR / "logs"
CACHE_DIR = DATA_DIR / "cache"
NORMALIZED_PRODUCTS = DATA_DIR / "master_tuples.json"
PRICE_HISTORY = DATA_DIR / "Price" / "prices.json"
PROCESS_STATUS = CACHE_DIR / "process_status.json"
SCRAPE_PROGRESS = CACHE_DIR / "scrape_progress.json"

# These names are shared by the operational status code and the scraper
# runners.  Keep the mapping here so callers do not need to know the on-disk
# marketplace folder/file conventions.
SITES = ("amazon", "ajio", "adventure", "columbia", "myntra", "tatacliq", "tata_lux", "flipkart")
_JSON_NAMES = {
    "amazon": ("Amazon", "amazon.json"),
    "ajio": ("Ajio", "ajio.json"),
    "adventure": ("Adventrous", "adventuras.json"),
    "columbia": ("Columbia", "columbia.json"),
    "myntra": ("Myntra", "myntra.json"),
    "tatacliq": ("Tata", "tatacliq.json"),
    "tata_lux": ("Tata_Lux", "tata_lux.json"),
    "flipkart": ("Flipkart", "flipkart.json"),
}

def ensure_directories() -> None:
    for path in (DATA_DIR, DATA_DIR / "Master", DATA_DIR / "Price", CACHE_DIR, LOG_DIR):
        path.mkdir(parents=True, exist_ok=True)

def log_path(site: str) -> Path:
    folder = LOG_DIR / site; folder.mkdir(parents=True, exist_ok=True)
    return folder / f"latest_{site}.log"

def dated_log_path(site: str, date_string: str) -> Path:
    folder = LOG_DIR / site; folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{site}_{date_string}.log"

def latest_json_path(site: str) -> Path:
    folder, filename = _JSON_NAMES[site]
    return DATA_DIR / folder / filename

def dated_json_path(site: str, date_string: str) -> Path:
    folder, filename = _JSON_NAMES[site]
    path = Path(filename)
    return DATA_DIR / folder / f"{path.stem}_{date_string}{path.suffix}"

ensure_directories()
