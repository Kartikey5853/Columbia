"""HTTP API used by the React workspace.

This intentionally wraps the existing exact-ID pipeline rather than duplicating
its matching or scraper logic in the frontend.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
from datetime import datetime
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pipeline.master_pipeline import import_master_excel, build_master_tuples
from processing.platform_paths import BASE_DIR, log_path
from processing.process_status import get_site_status, mark_started, update_site_status
from processing.unified_products import load_normalized_products, resolve_normalized_product
from processing.unified_products import flattened_rows
from processing.excel_export import excel_bytes, excel_bytes_by_site
from processing.json_store import load_json
from processing.platform_paths import PRICE_HISTORY

app = FastAPI(title="Columbia Catalog API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def add_cors_headers(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

class IdentifierSearch(BaseModel):
    identifiers: list[str]

class ScraperRequest(BaseModel):
    sites: list[str] | None = None
    workers: int | None = None
    sellers: list[dict[str, str]] | None = None

class SellerSettings(BaseModel):
    sellers: list[dict[str, str]]

class ProgressUpdate(BaseModel):
    stage: str = "Working"
    current: int = 0
    total: int = 0
    elapsed_seconds: int = 0
    eta_seconds: int = 0
    updated_at: str | None = None

_rebuild = {"running": False, "progress": 0, "message": "Idle", "started_at": None, "completed_at": None, "error": None}

def _tail(path: Path, lines: int) -> str:
    if not path.exists(): return ""
    return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])

def _start(site: str, module: str, *args: str) -> dict:
    status = get_site_status(site)
    if status.get("running"): return {"status": "already_running"}
    log = log_path(site).open("a", encoding="utf-8")
    command = ([sys.executable, "--worker", module, *args] if getattr(sys, "frozen", False)
               else [sys.executable, "-u", "-m", module, *args])
    process = subprocess.Popen(command, cwd=BASE_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
    log.close()
    mark_started(site, process.pid, "Starting")
    return {"status": "started", "pid": process.pid}


def _start_fast_scrapers(sites: list[str]) -> dict:
    """Run browser marketplaces in one Chrome/CDP session.

    The marketplace scripts share a persistent Chrome profile.  Starting one
    process per site made them all compete for port 9222 and close each
    other's browser.  One worker can open an isolated tab per marketplace
    while preserving independent UI statuses and log files.
    """
    if any(get_site_status(site).get("running") for site in sites):
        return {"status": "already_running"}
    log = log_path("fast_scrapers").open("a", encoding="utf-8")
    args = ("--sites", ",".join(sites))
    command = ([sys.executable, "--worker", "pipeline.fast_runner", *args] if getattr(sys, "frozen", False)
               else [sys.executable, "-u", "-m", "pipeline.fast_runner", *args])
    process = subprocess.Popen(command, cwd=BASE_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
    log.close()
    for site in sites:
        mark_started(site, process.pid, "Starting browser")
    return {"status": "started", "pid": process.pid, "sites": sites}

CONFIG_PATH = BASE_DIR / "config.json"

def _load_config() -> dict:
    cfg = load_json(CONFIG_PATH, {})
    if not cfg:
        for fallback in (
            BASE_DIR / "_internal" / "config.json",
            Path(getattr(sys, "_MEIPASS", "")) / "config.json",
        ):
            if fallback.is_file():
                cfg = load_json(fallback, {})
                if cfg:
                    try:
                        CONFIG_PATH.write_text(fallback.read_text(encoding="utf-8"), encoding="utf-8")
                    except Exception:
                        pass
                    break
    return cfg

def _save_config(config: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")

@app.get("/health")
def health(): return {"ok": True}

@app.post("/exact-search")
def exact_search(query: IdentifierSearch):
    identifiers = list(dict.fromkeys(value.strip() for value in query.identifiers if value and value.strip()))
    if len(identifiers) > 40_000: raise HTTPException(400, "Maximum is 40,000 identifiers per search.")
    payload = load_normalized_products(); results = []; missing = []
    for identifier in identifiers:
        found = resolve_normalized_product(identifier, payload)
        if found: results.append({"query": identifier, "key": found[0], "tuple": found[1]})
        else: missing.append(identifier)
    return {"results": results, "missing": missing, "summary": payload.get("summary", {})}

@app.post("/master-upload")
async def master_upload(file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".xlsx", ".xlsm")): raise HTTPException(400, "Upload an .xlsx or .xlsm file.")
    with tempfile.NamedTemporaryFile(suffix=Path(file.filename).suffix, delete=False) as temp:
        temp.write(await file.read()); path = Path(temp.name)
    try:
        result = import_master_excel(path)
        return {"rows": len(result["products"]), "columns": result["columns"], "json": result}
    finally: path.unlink(missing_ok=True)

@app.get("/master-json")
def master_json():
    path = BASE_DIR / "data" / "Master" / "master.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"products": []}

@app.get("/tuples")
def tuples(): return load_normalized_products()

@app.get("/tuples-export")
def tuples_export():
    output = excel_bytes_by_site(flattened_rows())
    return StreamingResponse(BytesIO(output), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="tuples.xlsx"'})

@app.post("/search-export")
def search_export(query: IdentifierSearch):
    from processing.product_schema import price_value
    payload = load_normalized_products()
    rows = []
    export_sites = ("amazon", "ajio", "adventure", "columbia", "myntra", "tatacliq", "tata_lux", "flipkart")
    site_names = {
        "amazon": "Amazon", "ajio": "AJIO", "adventure": "Adventuras", "columbia": "Columbia",
        "myntra": "Myntra", "tatacliq": "Tata Cliq", "tata_lux": "Tata Lux", "flipkart": "Flipkart"
    }
    for value in query.identifiers:
        found = resolve_normalized_product(value, payload)
        if found:
            row = found[1]
            site_prices = {}
            for site in export_sites:
                site_card = row.get(site) or {}
                raw_p = site_card.get("price") or site_card.get("normal_price") or site_card.get("price_value")
                site_prices[f"{site_names.get(site, site.title())} Price"] = price_value(raw_p)
            rows.append({
                "Search": value,
                "SKU": row.get("sku"),
                "EAN": ", ".join(row.get("ean_numbers") or []),
                **site_prices
            })
    output = excel_bytes(rows, "search")
    return StreamingResponse(BytesIO(output), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="search-results.xlsx"'})

@app.post("/rebuild-tuples")
def rebuild_tuples():
    if _rebuild["running"]: return {"status": "already_running"}
    def work():
        _rebuild.update(running=True, progress=10, message="Loading master and marketplace files", error=None, started_at=datetime.now().isoformat(), completed_at=None)
        try:
            _rebuild.update(progress=45, message="Matching exact identifiers")
            result = build_master_tuples()
            _rebuild.update(progress=100, message=f"Completed: {result['summary']['normalized_products']} tuples", result=result, completed_at=datetime.now().isoformat())
        except Exception as exc:
            _rebuild.update(progress=100, message="Failed", error=str(exc), completed_at=datetime.now().isoformat())
        finally: _rebuild["running"] = False
    threading.Thread(target=work, daemon=True).start()
    return {"status": "started"}

@app.get("/rebuild-progress")
def rebuild_progress(): return _rebuild

@app.post("/scrapers/start")
def start_scrapers(request: ScraperRequest):
    allowed = {"amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart"}
    sites = request.sites or sorted(allowed)
    if not set(sites) <= allowed: raise HTTPException(400, "Unknown scraper selected.")
    started = {}
    if len(sites) > 1:
        staged_args = ["--sites", ",".join(sites)]
        worker = _start("staged_pipeline", "pipeline.staged_runner", *staged_args)
        started["staged_pipeline"] = worker
        for s in sites:
            started[s] = worker
    else:
        site = sites[0]
        if site == "amazon":
            args = ["--workers", str(max(1, min(20, request.workers or 4)))]
            sellers = request.sellers if request.sellers is not None else _load_config().get("amazon_sellers", [])
            if sellers: args += ["--sellers", json.dumps(sellers)]
            started["amazon"] = _start("amazon", "pipeline.amazon_v4_runner", *args)
        elif site == "flipkart":
            started["flipkart"] = _start("flipkart", "pipeline.flipkart_runner")
        else:
            worker = _start_fast_scrapers([site])
            started[site] = worker
    return {"status": "started", "processes": started}

@app.get("/settings/amazon-sellers")
def amazon_seller_settings():
    return {"sellers": _load_config().get("amazon_sellers", [])}

@app.put("/settings/amazon-sellers")
def save_amazon_seller_settings(settings: SellerSettings):
    sellers = [{"id": item["id"].strip(), "name": (item.get("name") or item["id"]).strip()} for item in settings.sellers if item.get("id", "").strip()]
    config = _load_config(); config["amazon_sellers"] = sellers; _save_config(config)
    return {"sellers": sellers}

@app.post("/scrapers/profile")
def open_profile(): return _start("scraper_profile", "New_Scrapers.open_chrome_profile")

@app.get("/scrapers/status")
def scraper_status(lines: int = 120):
    sites = ["amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart", "scraper_profile"]
    processes = {}
    for site in sites:
        state = get_site_status(site)
        current, total = state.get("current") or 0, state.get("total") or 0
        percent = int((current / total) * 100) if total else 0
        blocks = max(0, min(13, round(percent / 100 * 13)))
        eta = state.get("eta_seconds")
        state["eta_text"] = (f"{int(eta) // 60} min {int(eta) % 60:02d} sec" if eta else "calculating")
        state["current_page"] = current
        state["total_pages"] = total
        state["percentage"] = state.get("percentage", percent)
        state["logs"] = f"{'🟢' if state.get('running') else '⚪'} {state.get('stage') or 'Idle'}\\n{'█' * blocks}{'░' * (13 - blocks)} {percent}%\\n{current} / {total or '—'} pages"
        state["logs"] = _tail(log_path(site), lines) or state["logs"]
        processes[site] = state
    return {"processes": processes}

@app.get("/scraper-status")
def dashboard_scraper_status(lines: int = 120):
    sites = ["amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart"]
    return {"platforms": {site: {**get_site_status(site), "scraper_running": get_site_status(site).get("running"), "stage": get_site_status(site).get("stage", "Idle")} for site in sites}}

@app.post("/scraper-progress/{site}")
def scraper_progress(site: str, progress: ProgressUpdate):
    if site not in {"amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart"}:
        raise HTTPException(400, "Unknown scraper.")
    return update_site_status(site, {
        "running": progress.stage != "Completed",
        "stage": progress.stage,
        "current": progress.current,
        "total": progress.total,
        "elapsed_seconds": progress.elapsed_seconds,
        "eta_seconds": progress.eta_seconds,
        "message": f"{progress.current} / {progress.total} pages"
    })

@app.get("/price-history")
def price_history():
    store = load_json(PRICE_HISTORY, {"sites": {}})
    changed = []
    for site, products in (store.get("sites") or {}).items():
        for product_id, item in (products or {}).items():
            history = item.get("history") or []
            prices = [entry.get("price") for entry in history if entry.get("price") is not None]
            if len(history) > 1 and len(set(prices)) > 1:
                changed.append({"site": site, "product_id": product_id, "current": item.get("current"), "previous": item.get("previous"), "changes": len(history), "last_changed": history[-1].get("observed_at") or history[-1].get("scraped_date"), "history": history})
    # Keep the analytics payload bounded so a full scraper run cannot freeze
    # the browser while still exposing every marketplace as a filter option.
    bounded = []
    for site in sorted({row["site"] for row in changed}):
        site_rows = [row for row in changed if row["site"] == site]
        bounded.extend(site_rows[-500:])
    changed = bounded
    # Expose configured marketplaces independently of price-change rows so a
    # newly scraped marketplace remains selectable even before a second run.
    return {"updated_at": store.get("updated_at"), "sites": sorted((store.get("sites") or {}).keys()), "changes": changed}

@app.get("/data-files")
def data_files():
    root = BASE_DIR / "data"
    return {"files": [{"path": str(path.relative_to(root)).replace("\\", "/"), "size": path.stat().st_size, "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat()} for path in sorted(root.rglob("*.json"))]}

def _data_file(relative: str) -> Path:
    root = (BASE_DIR / "data").resolve(); path = (root / relative).resolve()
    if root not in path.parents or path.suffix.lower() != ".json": raise HTTPException(400, "Invalid data file.")
    return path

@app.get("/data-files/{relative:path}")
def read_data_file(relative: str):
    path = _data_file(relative)
    if not path.exists(): raise HTTPException(404, "File not found.")
    return json.loads(path.read_text(encoding="utf-8"))

@app.delete("/data-files/{relative:path}")
def delete_data_file(relative: str):
    path = _data_file(relative)
    if not path.exists(): raise HTTPException(404, "File not found.")
    path.unlink()
    return {"status": "deleted", "path": relative}

@app.post("/data-folder/open")
def open_data_folder():
    root = BASE_DIR / "data"
    try:
        if sys.platform.startswith("win"):
            subprocess.Popen(["explorer", str(root)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(root)])
        else:
            subprocess.Popen(["xdg-open", str(root)])
    except OSError as exc:
        raise HTTPException(500, f"Could not open data folder: {exc}")
    return {"status": "opened"}


# Frontend serving is deliberately registered last.  FastAPI matches routes in
# declaration order, so placing the SPA catch-all after every API endpoint
# prevents it from intercepting POST/GET API requests (including
# /data-folder/open).
def _frontend_dist_path() -> Path | None:
    """Locate the Vite build in both source and PyInstaller onedir layouts."""
    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        # PyInstaller extracts bundled data under _MEIPASS.  The executable
        # directory is also checked because onedir builds may place frontend/
        # beside the executable via the spec's datas entries.
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(Path(meipass) / "frontend" / "dist")
        candidates.append(Path(sys.executable).resolve().parent / "frontend" / "dist")
    else:
        # In this repository backend/ and frontend/ are sibling directories.
        candidates.extend((BASE_DIR.parent / "frontend" / "dist", BASE_DIR / "frontend" / "dist"))

    for candidate in candidates:
        if (candidate / "index.html").is_file():
            return candidate.resolve()
    return None


FRONTEND_DIST = _frontend_dist_path()
if FRONTEND_DIST is not None:
    # Mount assets explicitly so hashed Vite files are served with normal
    # static-file semantics, while browser routes are handled by the SPA
    # fallback below.
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def frontend_index() -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{frontend_path:path}", include_in_schema=False)
    def frontend_route(frontend_path: str) -> FileResponse:
        # Serve a public root file when it exists (for example favicon.svg),
        # otherwise let the React router handle the URL from index.html.
        requested = (FRONTEND_DIST / frontend_path).resolve()
        is_inside_dist = requested == FRONTEND_DIST or FRONTEND_DIST in requested.parents
        if is_inside_dist and requested.is_file():
            return FileResponse(requested)
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    # Keep the failure actionable instead of silently returning a misleading
    # 404 when a deployment omitted the frontend build.
    print("Frontend build not found. Expected frontend/dist/index.html in one of the runtime bundle locations.")
