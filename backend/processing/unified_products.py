"""Read-only helpers for the master Excel tuple output."""
from __future__ import annotations
from pathlib import Path
from .json_store import load_json
from .platform_paths import NORMALIZED_PRODUCTS
from .product_schema import availability_display, price_value

def load_normalized_products(path: Path = NORMALIZED_PRODUCTS) -> dict:
    return load_json(path, {"products": {}})

def resolve_normalized_product(query: str, payload: dict | None = None):
    payload = payload or load_normalized_products(); needle = str(query).strip().lower()
    for key, row in (payload.get("products") or {}).items():
        values = [key, row.get("sku"), *(row.get("ean_numbers") or [])]
        if any(needle == str(value).strip().lower() for value in values if value): return str(key), row
    return None

def flattened_rows(payload: dict | None = None) -> list[dict]:
    payload = payload or load_normalized_products(); rows = []
    sites_list = (
        ("amazon", "Amazon"), ("ajio", "AJIO"), ("adventure", "Adventuras"),
        ("columbia", "Columbia"), ("myntra", "Myntra"), ("tatacliq", "TataCliq"),
        ("tata_lux", "Tata Lux"), ("flipkart", "Flipkart")
    )
    for key, row in (payload.get("products") or {}).items():
        cards = {site: row.get(site) for site, _ in sites_list}
        image = next((card.get("image") for card in cards.values() if isinstance(card, dict) and card.get("image")), "NA")
        result = {"Product Image": image, "EAN(s)": ", ".join(row.get("ean_numbers") or []) or "NA", "Columbia SKU": row.get("sku") or key}
        for site, label in sites_list:
            card = cards[site] if isinstance(cards[site], dict) else None
            value = price_value((card or {}).get("price") or (card or {}).get("price_value") or (card or {}).get("normal_price"))
            if value is not None:
                result[f"{label} Price"] = float(value)
            else:
                result[f"{label} Price"] = availability_display(site, card, None)
        for site, label in sites_list:
            card = cards[site] if isinstance(cards[site], dict) else None
            result[f"{label} Title"] = card.get("title") if card else "NA"
            result[f"{label} Product ID"] = card.get("source_product_id") if card else "NA"
            result[f"{label} Product URL"] = card.get("url") if card else "NA"
        rows.append(result)
    return sorted(rows, key=lambda item: str(item["Columbia SKU"]))
