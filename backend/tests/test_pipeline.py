"""
test_pipeline.py

Functional tests for Columbia 3.0 backend.
Tests cover:
  - Excel master file parsing
  - Pipeline/tuple building
  - Excel export (bytes output)
  - Price comparison / exact-search logic
  - API endpoint responses (via FastAPI TestClient)
"""
import json
import sys
from io import BytesIO
from pathlib import Path

import pytest

# ── Ensure backend is on path ─────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ─────────────────────────────────────────────────────────────────────────────
# HELPER — build a minimal in-memory Excel file for tests
# ─────────────────────────────────────────────────────────────────────────────
def _make_master_xlsx(tmp_path: Path) -> Path:
    """Create a minimal master Excel with EAN CODE + SKU CODE columns."""
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["EAN CODE", "SKU CODE", "Style Code"])
    ws.append(["1234567890123", "SKU-001", "STYLE-A"])
    ws.append(["9876543210987", "SKU-002", "STYLE-B"])
    ws.append(["",             "SKU-003", "STYLE-C"])   # EAN missing — SKU only
    path = tmp_path / "master_test.xlsx"
    wb.save(path)
    return path


# ─────────────────────────────────────────────────────────────────────────────
# 1. EXCEL MASTER PARSE
# ─────────────────────────────────────────────────────────────────────────────
class TestMasterExcelParse:

    def test_import_returns_products(self, tmp_path):
        """import_master_excel must return a list of product dicts."""
        from pipeline.master_pipeline import import_master_excel
        xlsx = _make_master_xlsx(tmp_path)
        result = import_master_excel(xlsx)
        assert "products" in result, "Result must contain 'products' key"
        assert len(result["products"]) == 3, "Should parse 3 data rows"

    def test_import_contains_ean(self, tmp_path):
        """Each parsed row must retain EAN CODE and SKU CODE."""
        from pipeline.master_pipeline import import_master_excel
        xlsx = _make_master_xlsx(tmp_path)
        result = import_master_excel(xlsx)
        first = result["products"][0]
        assert first["EAN CODE"] == "1234567890123"
        assert first["SKU CODE"] == "SKU-001"

    def test_import_filters_empty_rows(self, tmp_path):
        """Rows with no EAN and no SKU must be skipped."""
        from openpyxl import Workbook
        from pipeline.master_pipeline import import_master_excel
        wb = Workbook(); ws = wb.active
        ws.append(["EAN CODE", "SKU CODE"])
        ws.append(["", ""])          # empty — should be filtered
        ws.append(["111", "SKU-A"])  # valid
        p = tmp_path / "sparse.xlsx"; wb.save(p)
        result = import_master_excel(p)
        assert len(result["products"]) == 1

    def test_invalid_excel_raises(self, tmp_path):
        """Excel without EAN CODE or SKU CODE columns must raise ValueError."""
        from openpyxl import Workbook
        from pipeline.master_pipeline import import_master_excel
        wb = Workbook(); ws = wb.active
        ws.append(["Product", "Price"])
        ws.append(["Widget", "100"])
        p = tmp_path / "bad.xlsx"; wb.save(p)
        with pytest.raises(ValueError, match="EAN CODE"):
            import_master_excel(p)


# ─────────────────────────────────────────────────────────────────────────────
# 2. PIPELINE TUPLE BUILD
# ─────────────────────────────────────────────────────────────────────────────
class TestPipelineTupleBuild:

    def test_build_raises_without_master(self):
        """build_master_tuples must raise if master.json has no products."""
        import pipeline.master_pipeline as mp
        from processing.json_store import save_json_atomic
        import processing.platform_paths as pp

        # Write an empty master and patch module-level MASTER_JSON for isolation
        master_json = pp.DATA_DIR / "Master" / "master_empty.json"
        master_json.parent.mkdir(parents=True, exist_ok=True)
        save_json_atomic(master_json, {"products": []})

        original = mp.MASTER_JSON
        mp.MASTER_JSON = master_json
        try:
            with pytest.raises(RuntimeError, match="Upload a master Excel"):
                mp.build_master_tuples()
        finally:
            mp.MASTER_JSON = original

    def test_build_produces_summary(self, tmp_path):
        """With a valid master.json, build_master_tuples returns a summary dict."""
        import pipeline.master_pipeline as mp
        from processing.json_store import save_json_atomic
        import processing.platform_paths as pp

        master_json = pp.DATA_DIR / "Master" / "master_ci_test.json"
        master_json.parent.mkdir(parents=True, exist_ok=True)
        save_json_atomic(master_json, {
            "products": [
                {"EAN CODE": "1234567890123", "SKU CODE": "SKU-001"},
                {"EAN CODE": "9876543210987", "SKU CODE": "SKU-002"},
            ]
        })

        original = mp.MASTER_JSON
        mp.MASTER_JSON = master_json
        try:
            result = mp.build_master_tuples()
        finally:
            mp.MASTER_JSON = original

        assert "summary" in result
        assert result["summary"]["master_rows"] == 2
        assert result["summary"]["normalized_products"] == 2

    def test_products_have_site_keys(self, tmp_path):
        """Each product record must contain all 8 marketplace keys."""
        from pipeline.master_pipeline import build_master_tuples
        from processing.json_store import save_json_atomic
        import processing.platform_paths as pp

        master_json = pp.DATA_DIR / "Master" / "master.json"
        master_json.parent.mkdir(parents=True, exist_ok=True)
        save_json_atomic(master_json, {
            "products": [{"EAN CODE": "111", "SKU CODE": "SKU-X"}]
        })
        result = build_master_tuples()
        product = list(result["products"].values())[0]
        for site in ("amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart"):
            assert site in product, f"Missing site key: {site}"


# ─────────────────────────────────────────────────────────────────────────────
# 3. EXCEL EXPORT
# ─────────────────────────────────────────────────────────────────────────────
class TestExcelExport:

    def test_excel_bytes_returns_bytes(self):
        """excel_bytes must return non-empty bytes that openpyxl can open."""
        from processing.excel_export import excel_bytes
        from openpyxl import load_workbook
        rows = [{"SKU": "SKU-001", "Amazon Price": 1299, "Flipkart Price": 1199}]
        output = excel_bytes(rows, "test")
        assert isinstance(output, bytes)
        assert len(output) > 0
        wb = load_workbook(BytesIO(output))
        assert "test" in wb.sheetnames

    def test_excel_bytes_has_correct_headers(self):
        """Exported Excel must have column headers matching input keys."""
        from processing.excel_export import excel_bytes
        from openpyxl import load_workbook
        rows = [{"SKU": "A", "Amazon Price": 100, "Myntra Price": 90}]
        wb = load_workbook(BytesIO(excel_bytes(rows)))
        ws = wb.active
        headers = [cell.value for cell in ws[1]]
        assert "SKU" in headers
        assert "Amazon Price" in headers
        assert "Myntra Price" in headers

    def test_excel_export_empty_rows(self):
        """excel_bytes with empty rows must still produce a valid .xlsx."""
        from processing.excel_export import excel_bytes
        from openpyxl import load_workbook
        output = excel_bytes([], "empty")
        wb = load_workbook(BytesIO(output))
        assert wb is not None

    def test_excel_by_site_creates_sheets(self):
        """excel_bytes_by_site must produce one worksheet per marketplace."""
        from processing.excel_export import excel_bytes_by_site
        from openpyxl import load_workbook

        # Build a minimal row that matches the expected header format
        rows = [{
            "Columbia SKU": "SKU-001",
            "EAN(s)": "111",
            "Product Image": "",
            "Amazon Product ID": "B001",
            "Amazon Price": 1299,
            "Flipkart Product ID": "FK001",
            "Flipkart Price": 1199,
        }]
        output = excel_bytes_by_site(rows)
        wb = load_workbook(BytesIO(output))
        # Must have at least Amazon and Flipkart sheets
        assert "Amazon" in wb.sheetnames
        assert "Flipkart" in wb.sheetnames


# ─────────────────────────────────────────────────────────────────────────────
# 4. PRICE COMPARISON / PRODUCT SCHEMA
# ─────────────────────────────────────────────────────────────────────────────
class TestPriceComparison:

    def test_price_value_numeric_string(self):
        """price_value must parse numeric strings like '1,299' correctly."""
        from processing.product_schema import price_value
        assert price_value("1,299") == 1299.0
        assert price_value("999.50") == 999.50

    def test_price_value_none(self):
        """price_value must return None for missing/empty inputs."""
        from processing.product_schema import price_value
        assert price_value(None) is None
        assert price_value("") is None
        assert price_value("N/A") is None

    def test_price_value_raw_number(self):
        """price_value must handle plain int/float inputs."""
        from processing.product_schema import price_value
        assert price_value(1500) == 1500.0
        assert price_value(1499.99) == 1499.99

    def test_resolve_product_found(self):
        """resolve_normalized_product must find a product by EAN."""
        from processing.unified_products import resolve_normalized_product
        payload = {
            "products": {
                "1234567890123": {
                    "sku": "SKU-001",
                    "ean_numbers": ["1234567890123"],
                    "amazon": {"price": 1299},
                    "flipkart": {"price": 1199},
                }
            }
        }
        result = resolve_normalized_product("1234567890123", payload)
        assert result is not None
        key, product = result
        assert key == "1234567890123"
        assert product["amazon"]["price"] == 1299

    def test_resolve_product_missing(self):
        """resolve_normalized_product must return None for unknown identifiers."""
        from processing.unified_products import resolve_normalized_product
        payload = {"products": {}}
        assert resolve_normalized_product("UNKNOWN-EAN", payload) is None


# ─────────────────────────────────────────────────────────────────────────────
# 5. API ENDPOINTS (FastAPI TestClient)
# ─────────────────────────────────────────────────────────────────────────────
class TestAPIEndpoints:

    @pytest.fixture(scope="class")
    def client(self):
        """Spin up the FastAPI app in test mode (no real browser/scraper)."""
        from fastapi.testclient import TestClient
        from api_server import app
        with TestClient(app) as c:
            yield c

    def test_health_endpoint(self, client):
        """GET /health must return 200 with {ok: true}."""
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_exact_search_empty(self, client):
        """POST /exact-search with valid identifiers must return results + missing keys."""
        resp = client.post("/exact-search", json={"identifiers": ["NONEXISTENT-SKU"]})
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data
        assert "missing" in data
        assert "NONEXISTENT-SKU" in data["missing"]

    def test_exact_search_too_many(self, client):
        """POST /exact-search with >40,000 unique identifiers must return 400."""
        # The API deduplicates before counting, so we need 40,001 *unique* values
        resp = client.post("/exact-search", json={"identifiers": [f"SKU-{i}" for i in range(40_001)]})
        assert resp.status_code == 400

    def test_scraper_status_endpoint(self, client):
        """GET /scraper-status must return a platforms dict for all 8 sites."""
        resp = client.get("/scraper-status")
        assert resp.status_code == 200
        data = resp.json()
        assert "platforms" in data
        for site in ("amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart"):
            assert site in data["platforms"], f"Missing platform: {site}"

    def test_master_json_empty(self, client):
        """GET /master-json must return {products: []} when no master has been uploaded."""
        resp = client.get("/master-json")
        assert resp.status_code == 200
        data = resp.json()
        assert "products" in data

    def test_master_upload_wrong_extension(self, client):
        """POST /master-upload with a .csv file must return 400."""
        resp = client.post(
            "/master-upload",
            files={"file": ("data.csv", b"EAN,SKU\n123,ABC", "text/csv")},
        )
        assert resp.status_code == 400

    def test_master_upload_valid_excel(self, client, tmp_path):
        """POST /master-upload with a valid .xlsx must parse rows successfully."""
        from openpyxl import Workbook
        wb = Workbook(); ws = wb.active
        ws.append(["EAN CODE", "SKU CODE"])
        ws.append(["1234567890123", "SKU-001"])
        buf = BytesIO(); wb.save(buf); buf.seek(0)
        resp = client.post(
            "/master-upload",
            files={"file": ("master.xlsx", buf.read(),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["rows"] == 1

    def test_tuples_endpoint(self, client):
        """GET /tuples must respond 200 and contain products key."""
        resp = client.get("/tuples")
        assert resp.status_code == 200
        assert "products" in resp.json()

    def test_rebuild_progress_endpoint(self, client):
        """GET /rebuild-progress must return a status dict."""
        resp = client.get("/rebuild-progress")
        assert resp.status_code == 200
        data = resp.json()
        assert "running" in data

    def test_price_history_endpoint(self, client):
        """GET /price-history must return a well-formed response."""
        resp = client.get("/price-history")
        assert resp.status_code == 200
        data = resp.json()
        assert "changes" in data
        assert "sites" in data
