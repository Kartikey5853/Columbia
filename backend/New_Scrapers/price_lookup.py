"""Search all marketplace JSON files and export a summary + raw-data workbook.

Examples:
  python price_lookup.py 703526696002 MP000000014592322
  python price_lookup.py --input ids.txt --output prices.xlsx
"""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent
DEFAULT_FILES = {"Ajio": "ajio.json", "Adventuras": "adventuras.json", "Columbia": "columbia.json", "Amazon": "amazon.json", "Tata Cliq": "tatacliq.json", "Myntra": "myntra.json"}
MASTER_FILE = "master.json"

def clean(v):
    return "" if v is None else str(v).strip()

def ajio_group(value):
    """Return AJIO's product/colour group (the first 9 digits), if present."""
    value = clean(value)
    return value[:9] if len(value) == 12 and value.isdigit() else ""

def money(v):
    if isinstance(v, (int, float)): return v
    m = re.sub(r"[^0-9.]", "", clean(v))
    try: return float(m) if m else ""
    except ValueError: return ""

def load_records(path):
    if not path.exists(): return []
    data = json.loads(path.read_text(encoding="utf-8"))
    records = data.get("products", []) if isinstance(data, dict) else data
    if isinstance(records, dict):
        records = list(records.values())
    return records if isinstance(records, list) else []

def normalize(r, source):
    product_id = clean(r.get("product_id") or r.get("source_product_id") or r.get("asin") or r.get("productId") or r.get("id"))
    eans = [clean(r.get(k)) for k in ("ean", "upc", "barcode")]
    eans += [clean(x) for x in (r.get("all_eans") or [])]
    sku = clean(r.get("sku") or r.get("sellerSku") or r.get("productCode") or r.get("code"))
    variant_ids = []
    for variant in r.get("variants") or []:
        if isinstance(variant, dict):
            variant_ids.extend(clean(variant.get(k)) for k in ("sku", "product_id", "productId", "id"))
    variant_ids.extend(clean(r.get(k)) for k in ("variant_id", "orgProductCode", "baseProductId"))
    return {"source": source.lower().replace(" ", ""), "product_id": product_id,
            "sku": sku, "ean": clean(r.get("ean") or r.get("barcode")),
            "title": clean(r.get("title") or r.get("source_title") or r.get("name") or r.get("productName")),
            "price": money(r.get("price_value") if r.get("price_value") is not None else (r.get("price") if r.get("price") is not None else r.get("discountedPrice"))),
            "mrp": money(r.get("mrp") if r.get("mrp") is not None else r.get("compare_at_price")),
            "available": r.get("available", r.get("inStockFlag", "")), "image_url": clean(r.get("image_url") or r.get("imageURL")),
            "url": clean(r.get("url") or r.get("amazon_url") or r.get("landingPageUrl")),
            "_ids": {x for x in [product_id, sku, *eans, *variant_ids] if x},
            "raw_variants": [x for x in variant_ids if x]}

def matches_master(record, master_row, source):
    wanted = {clean(master_row.get(source)), clean(master_row.get("EAN CODE")),
              clean(master_row.get("SKU CODE")), clean(master_row.get("Style Code"))}
    wanted = {x for x in wanted if x}
    if record["_ids"] & wanted:
        return True
    # AJIO supplies one size/color variant. All variants share the first
    # nine digits of the 12-digit product id and the same price.
    if source == "Ajio":
        return any(x[:9] == y[:9] for x in record["_ids"] for y in wanted
                   if len(x) == 12 and len(y) == 12 and x.isdigit() and y.isdigit())
    return False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*", help="SKU/EAN/product IDs to search")
    ap.add_argument("--input", type=Path, help="text/CSV file containing IDs")
    ap.add_argument("--output", type=Path, default=ROOT / "lookup_results.xlsx")
    ap.add_argument("--dir", type=Path, default=ROOT, help="directory containing JSON files")
    ap.add_argument("--master", type=Path, default=ROOT / MASTER_FILE, help="master mapping JSON")
    ap.add_argument("--all-records", action="store_true", help="include unmatched scraped records in marketplace sheets")
    a = ap.parse_args()
    ids = list(a.ids)
    if a.input: ids += re.split(r"[\s,;]+", a.input.read_text(encoding="utf-8"))
    ids = list(dict.fromkeys(x.strip() for x in ids if x.strip()))
    if not ids:
        ids = re.split(r"[\s,;]+", input("Enter SKU/EAN/product IDs: "))
        ids = [x for x in ids if x]
    master = json.loads(a.master.read_text(encoding="utf-8")) if a.master.exists() else {"products": []}
    master_rows = master.get("products", [])
    mapped = {q: [r for r in master_rows if q in {clean(r.get("EAN CODE")), clean(r.get("SKU CODE")), clean(r.get("Style Code"))}] for q in ids}
    records = {name: [normalize(r, name) for r in load_records(a.dir / fn)] for name, fn in DEFAULT_FILES.items()}
    # Tata Cliq returns one priced parent with all size/color SKUs nested in
    # `variants`. Export each sellable variant as its own row so the workbook
    # remains compatible with the master file's Tata Cliq IDs.
    tata_expanded = []
    for parent in records["Tata Cliq"]:
        variants = parent.get("raw_variants") or []
        if not variants:
            tata_expanded.append(parent)
            continue
        for variant_id in variants:
            child = dict(parent)
            child["product_id"] = variant_id
            child["_ids"] = set(child["_ids"]) | {variant_id}
            tata_expanded.append(child)
    records["Tata Cliq"] = tata_expanded
    indexes = {}
    ajio_groups = {}
    for name, rows in records.items():
        index = {}
        for r in rows:
            for identifier in r["_ids"]:
                index.setdefault(identifier, []).append(r)
                if name == "Ajio":
                    group = ajio_group(identifier)
                    if group:
                        ajio_groups.setdefault(group, []).append(r)
        indexes[name] = index
    matches = {}
    for q in ids:
        matches[q] = {}
        for name, rows in records.items():
            found = {}
            for m in mapped[q]:
                wanted = {clean(m.get(name)), clean(m.get("EAN CODE")), clean(m.get("SKU CODE")), clean(m.get("Style Code"))}
                for identifier in filter(None, wanted):
                    for r in indexes[name].get(identifier, []):
                        found[id(r)] = r
                if name == "Ajio":
                    # AJIO stores one sellable size variant at a time.  The
                    # first nine digits identify the same product and colour;
                    # the final three are only the size/variant.  Reuse that
                    # available variant's price for every master variant in
                    # the group when the exact id is absent.
                    group = ajio_group(m.get("Ajio"))
                    for r in ajio_groups.get(group, []):
                        found[id(r)] = r
            matches[q][name] = list(found.values())

    wb = Workbook(); summary = wb.active; summary.title = "Summary"
    platforms = list(DEFAULT_FILES)
    headers = ["EAN", "SKU"] + sum(([f"{p} Price", f"{p} MRP"] for p in platforms), [])
    summary.append(headers)
    for q in ids:
        m = mapped[q][0] if mapped[q] else {}
        row = [m.get("EAN CODE", q if q.isdigit() else ""), m.get("SKU CODE", q if not q.isdigit() else "")]
        for p in platforms:
            r = matches[q][p][0] if matches[q][p] else {}
            row += [r.get("price", ""), r.get("mrp", "")]
        summary.append(row)
    for name, rows in records.items():
        if a.all_records:
            sheet_rows = [("", "", r) for r in rows]
        else:
            # Keep the worksheet aligned with the master/input rows. A single
            # marketplace product can match many input variants, so exporting
            # unique marketplace records here incorrectly shrinks 2k+ matches
            # down to a few hundred rows.
            sheet_rows = []
            for q in ids:
                matched = matches[q][name]
                if not matched:
                    continue
                master_row = mapped[q][0] if mapped[q] else {}
                sheet_rows.append((clean(master_row.get("EAN CODE")) or q,
                                   clean(master_row.get("SKU CODE")), matched[0]))
        ws = wb.create_sheet(name[:31]); cols = ["input_ean","input_sku","source","product_id","sku","ean","title","price","mrp","available","image_url","url"]
        ws.append(cols)
        for input_ean, input_sku, r in sheet_rows:
            ws.append([input_ean, input_sku] + [r.get(c, "") for c in cols[2:]])
        ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
    for ws in wb.worksheets:
        ws.freeze_panes = ws.freeze_panes or "A2"
        for cell in ws[1]: cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="1F4E78"); cell.alignment = Alignment(wrap_text=True)
        for col in range(1, ws.max_column + 1):
            longest = max((len(clean(ws.cell(row, col).value)) for row in range(1, min(ws.max_row, 100) + 1)), default=10)
            width = min(55, max(12, longest + 2))
            ws.column_dimensions[get_column_letter(col)].width = width
    a.output.parent.mkdir(parents=True, exist_ok=True); wb.save(a.output)
    print(f"Wrote {a.output} | {len(ids)} queried IDs | {sum(bool(x) for x in matches.values())} IDs with matches")

if __name__ == "__main__": main()
