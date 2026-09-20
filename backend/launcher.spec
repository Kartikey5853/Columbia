from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, collect_data_files


# ---------------------------------------------------------
# Paths
# ---------------------------------------------------------

BACKEND_DIR = Path.cwd()
ROOT_DIR = BACKEND_DIR.parent
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"


# ---------------------------------------------------------
# Helper for including directories
# ---------------------------------------------------------

datas = []


def add_directory(directory: Path, destination: str):
    if directory.exists():
        datas.append((str(directory), destination))


# Frontend build
add_directory(FRONTEND_DIST, "frontend/dist")


# Backend runtime data
for folder in [
    "data",
    "data_scraper",
    "logs",
    "New_Scrapers",
    "pipeline",
    "processing",
    "amazonV4",
    "streamlit_app",
]:
    add_directory(BACKEND_DIR / folder, folder)


# ---------------------------------------------------------
# Playwright browsers
# ---------------------------------------------------------

playwright_locations = [
    Path.home() / "AppData" / "Local" / "ms-playwright",
    BACKEND_DIR / "ms-playwright",
    ROOT_DIR / "ms-playwright",
]

for playwright_dir in playwright_locations:
    if playwright_dir.exists():
        datas.append(
            (
                str(playwright_dir),
                "ms-playwright",
            )
        )
        break


hiddenimports = [
    # FastAPI / Uvicorn
    "fastapi",
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",

    # Scraping
    "playwright",
    "playwright.sync_api",
    "playwright.async_api",
    "selenium",
    "undetected_chromedriver",
    "selectolax",
    "selectolax.parser",

    # Common backend libraries
    "requests",
    "httpx",
    "bs4",
    "lxml",
    "PIL",
    "numpy",
    "pandas",

    # ML / matching
    "faiss",
    "faiss.swigfaiss",
    "torch",
    "torchvision",
    "open_clip",
]


# ---------------------------------------------------------
# Automatically collect submodules
# ---------------------------------------------------------

for package in [
    "uvicorn",
    "playwright",
    "selenium",
    "fastapi",
]:
    try:
        hiddenimports += collect_submodules(package)
    except Exception:
        pass


# ---------------------------------------------------------
# Automatically collect package data
# ---------------------------------------------------------

for package in [
    "playwright",
    "uvicorn",
    "fastapi",
]:
    try:
        datas += collect_data_files(package)
    except Exception:
        pass


# Remove duplicate entries
hiddenimports = list(dict.fromkeys(hiddenimports))


# ---------------------------------------------------------
# PyInstaller Analysis
# ---------------------------------------------------------

a = Analysis(
    [str(BACKEND_DIR / "launcher.py")],
    pathex=[
        str(BACKEND_DIR),
        str(ROOT_DIR),
    ],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)


pyz = PYZ(a.pure)


exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="columbia",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)


coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="columbia",
)