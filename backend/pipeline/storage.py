"""Append-only, durable price history built from scraper snapshots."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from processing.json_store import load_json, product_list, save_json_atomic
from processing.product_schema import price_value
from .master_pipeline import BASE_DIR, SOURCES, text

PRICE_PATH = BASE_DIR / "data" / "Price" / "prices.json"
IDENTIFIER_FIELDS = ("ean", "barcode", "sku", "product_id", "productId", "id", "asin", "variant_id")


def _latest_snapshot(folder: Path, filename: str) -> Path | None:
    snapshots = sorted(folder.glob(f"{Path(filename).stem}_*.json"), reverse=True)
    if snapshots:
        return snapshots[0]
    legacy = folder / filename
    return legacy if legacy.exists() else None


def _identifier(product: dict[str, Any]) -> str | None:
    return next((text(product.get(field)) for field in IDENTIFIER_FIELDS if text(product.get(field))), None)


def _observed_at(payload: dict[str, Any], snapshot: Path) -> str:
    value = payload.get("scraped_at")
    if value:
        return str(value)
    date_part = snapshot.stem.rsplit("_", 1)[-1]
    try:
        return datetime.fromisoformat(date_part).isoformat()
    except ValueError:
        return datetime.now().isoformat(timespec="seconds")


def refresh_price_history() -> dict[str, int]:
    """Read current scraper data and append only genuine price changes.

    This ledger is intentionally never rebuilt from, or deleted with, the
    short-retention scraper snapshots. Once a price event is written here it
    stays available even after its source JSON file has been removed.
    """
    store = load_json(PRICE_PATH, {"schema_version": 2, "sites": {}})
    if not isinstance(store, dict):
        store = {"schema_version": 2, "sites": {}}
    store["schema_version"] = 2
    sites = store.setdefault("sites", {})
    summary = {"products_seen": 0, "changes_recorded": 0}

    for site, (folder_name, filename, _column) in SOURCES.items():
        snapshot = _latest_snapshot(BASE_DIR / "data" / folder_name, filename)
        if not snapshot:
            continue
        try:
            payload = load_json(snapshot, {})
        except (OSError, ValueError):
            continue
        if not isinstance(payload, dict):
            continue
        observed_at = _observed_at(payload, snapshot)
        site_history = sites.setdefault(site, {})
        for product in product_list(payload):
            identifier = _identifier(product)
            raw_price = product.get("price")
            if raw_price in (None, ""):
                raw_price = product.get("price_value") or product.get("discountedPrice")
            price = price_value(raw_price)
            if not identifier or price is None:
                continue
            summary["products_seen"] += 1
            record = site_history.get(identifier)
            if not isinstance(record, dict):
                record = {"history": []}
            history = record.get("history")
            if not isinstance(history, list):
                history = []
            current = price_value(record.get("current"))
            # The first observation establishes a baseline. Every later
            # distinct value is appended permanently as a price event.
            if current is None or current != price:
                if not history or price_value(history[-1].get("price")) != price:
                    history.append({"price": price, "observed_at": observed_at})
                    if current is not None:
                        summary["changes_recorded"] += 1
            record.update({
                "current": price,
                # Keep the last value before the current value. Do not set
                # this to `current` on every refresh or the UI can never
                # display a change warning.
                "previous": price_value(history[-2].get("price")) if len(history) > 1 else None,
                "history": history,
                "title": text(product.get("title") or product.get("name") or product.get("productName")),
                "url": text(product.get("url") or product.get("landingPageUrl")),
                "last_seen_at": observed_at,
            })
            site_history[identifier] = record

    store["updated_at"] = datetime.now().isoformat(timespec="seconds")
    save_json_atomic(PRICE_PATH, store)
    return summary


# Keep the existing runner import stable.
def migrate() -> dict[str, int]:
    return refresh_price_history()


if __name__ == "__main__":
    print(refresh_price_history())
