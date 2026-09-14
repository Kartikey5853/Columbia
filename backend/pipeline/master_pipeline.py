"""The complete exact-ID pipeline: Excel -> master.json -> product tuples."""
from __future__ import annotations
import argparse
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Any
import openpyxl
import json

from processing.json_store import load_json, product_list, save_json_atomic
from processing.platform_paths import BASE_DIR, NORMALIZED_PRODUCTS

MASTER_DIR = BASE_DIR / "data" / "Master"; MASTER_JSON = MASTER_DIR / "master.json"; MASTER_EXCEL = MASTER_DIR / "master.xlsx"
SOURCES = {
 "ajio": ("Ajio", "ajio.json", "Ajio"), "adventure": ("Adventrous", "adventuras.json", "Adventuras"),
 "columbia": ("Columbia", "columbia.json", "Columbia"), "myntra": ("Myntra", "myntra.json", "Myntra"),
 "tatacliq": ("Tata", "tatacliq.json", "Tata Cliq"), "amazon": ("Amazon", "amazon.json", "Amazon"),
 "tata_lux": ("Tata_Lux", "tata_lux.json", "Tata Lux"), "flipkart": ("Flipkart", "flipkart.json", "Flipkart"), }

def text(v: Any) -> str:
    return "" if v is None else (str(int(v)) if isinstance(v, float) and v.is_integer() else str(v).strip())

def import_master_excel(source: Path) -> dict:
    MASTER_DIR.mkdir(parents=True, exist_ok=True); MASTER_EXCEL.write_bytes(source.read_bytes())
    wb = openpyxl.load_workbook(MASTER_EXCEL, read_only=True, data_only=True); ws = wb.active
    headers = [text(c.value) for c in next(ws.iter_rows())]
    if not {"EAN CODE", "SKU CODE"} & set(headers): raise ValueError("Master Excel must contain EAN CODE and/or SKU CODE.")
    rows = [{headers[i]: text(v) for i, v in enumerate(values)} for values in ws.iter_rows(min_row=2, values_only=True)]
    rows = [r for r in rows if r.get("EAN CODE") or r.get("SKU CODE")]
    result = {"schema_version": 1, "source": source.name, "imported_at": datetime.now().isoformat(timespec="seconds"), "columns": headers, "products": rows}
    save_json_atomic(MASTER_JSON, result); return result

def ids(p: dict) -> set[str]:
    values = [p.get(k) for k in ("product_id","source_product_id","productId","id","sku","ean","barcode","asin","variant_id","orgProductCode","baseProductId")]
    values += p.get("all_eans") or []
    # Amazon returns a parent ASIN plus related colour/size ASINs in its
    # `family` field. Every family ASIN must be eligible for the same master
    # row match.
    values += p.get("family") or []
    return {text(v) for v in values if text(v)}

def ajio_group_id(value: Any) -> str:
    digits = text(value)
    return digits[:9] if len(digits) >= 12 and digits.isdigit() else ""

def card(p: dict) -> dict:
    raw_price = p.get("price") if p.get("price") not in (None, "") else p.get("price_value")
    href = p.get("href")
    if href and str(href).startswith("/"):
        href = "https://www.amazon.in" + str(href)
    return {"source_product_id": text(p.get("source_product_id") or p.get("product_id") or p.get("productId") or p.get("id") or p.get("asin")), "product_id": text(p.get("product_id") or p.get("productId") or p.get("id") or p.get("asin")), "sku": text(p.get("sku") or p.get("productCode")), "ean": text(p.get("ean") or p.get("barcode") or p.get("upc")), "title": text(p.get("title") or p.get("name") or p.get("productName") or p.get("source_title")), "image": text(p.get("image") or p.get("image_url") or p.get("imageURL")), "url": text(p.get("url") or p.get("amazon_url") or href or p.get("landingPageUrl") or p.get("link")), "price": raw_price, "normal_price": p.get("mrp") if p.get("mrp") is not None else p.get("compare_at_price", raw_price), "availability": p.get("available", p.get("availability")), "scraped_at": text(p.get("scraped_at"))}

def indexes() -> dict[str, dict[str, dict]]:
    result = {}
    for site, (folder, filename, _column) in SOURCES.items():
        # Fresh JavaScript output is written to its established marketplace folder.
        folder_path = BASE_DIR / "data" / folder
        dated = sorted(folder_path.glob("*.json"), reverse=True)
        path = next((candidate for candidate in dated if candidate.name != filename), folder_path / filename)
        index = {}
        try:
            payload = load_json(path, {})
        except (json.JSONDecodeError, OSError):
            payload = {}
        for p in product_list(payload):
            if isinstance(p, dict):
                for key in ids(p): index.setdefault(key, p)
        result[site] = index
        if site == "ajio":
            for product in product_list(payload):
                group = ajio_group_id(product.get("product_id") or product.get("id")) if isinstance(product, dict) else ""
                if group: result[site].setdefault(group, product)
    return result

def build_master_tuples() -> dict:
    master = load_json(MASTER_JSON, {}); rows = master.get("products", [])
    if not rows: raise RuntimeError("Upload a master Excel before running the pipeline.")
    source_indexes = indexes(); products = {}; linked = {site: 0 for site in SOURCES}
    for n, row in enumerate(rows, 1):
        if not isinstance(row, dict): continue
        ean, sku = text(row.get("EAN CODE")), text(row.get("SKU CODE")); key = ean or sku or f"row-{n}"
        if key in products: key = f"{key}#{n}"
        record = {"sku": sku or key, "ean_numbers": [ean] if ean else [], "master": row}
        common = {x for x in (ean, sku, text(row.get("Style Code"))) if x}
        for site, (_folder, _filename, column) in SOURCES.items():
            wanted = common | ({text(row.get(column))} if text(row.get(column)) else set())
            match = next((source_indexes[site][x] for x in wanted if x in source_indexes[site]), None)
            if match is None and site == "ajio":
                for candidate in wanted:
                    group = ajio_group_id(candidate)
                    if group and group in source_indexes[site]: match = source_indexes[site][group]; break
            record[site] = card(match) if match else None; linked[site] += bool(match)
        products[key] = record
    result = {"schema_version": 1, "primary_key": "master_row", "created_at": datetime.now().isoformat(timespec="seconds"), "rules": {"matching": "exact master identifiers only; no visual/vector matching"}, "summary": {"master_rows": len(rows), "normalized_products": len(products), "linked": linked}, "products": products}
    save_json_atomic(NORMALIZED_PRODUCTS, result); return result

def main():
    p = argparse.ArgumentParser(); p.add_argument("--master", type=Path); a = p.parse_args()
    if a.master: import_master_excel(a.master)
    print(f"Built {build_master_tuples()['summary']['normalized_products']} master tuples")
if __name__ == "__main__": main()
