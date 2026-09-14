"""Production entrypoint for the Columbia React + FastAPI application.

The same executable is also used for scraper workers in frozen builds via
``--worker module.name``. This keeps subprocess launches compatible with a
Windows machine that has no Python or Node installation.
"""
from __future__ import annotations

import multiprocessing
import os
from pathlib import Path
import runpy
import sys
import threading
import time
import webbrowser


def _base_dir() -> Path:
    return Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent


def _configure_playwright() -> None:
    """Point Playwright at browsers bundled by the onedir distribution."""
    if not getattr(sys, "frozen", False):
        return
    base = _base_dir()
    meipass = Path(getattr(sys, "_MEIPASS", base))
    for candidate in (
        meipass / "ms-playwright",
        base / "_internal" / "ms-playwright",
        base / "ms-playwright",
    ):
        if candidate.is_dir():
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(candidate)
            break


def _run_worker() -> None:
    index = sys.argv.index("--worker")
    module = sys.argv[index + 1] if index + 1 < len(sys.argv) else ""
    if not module:
        raise SystemExit("--worker requires a module name")
    sys.argv = [module, *sys.argv[index + 2:]]
    runpy.run_module(module, run_name="__main__", alter_sys=True)


def main() -> None:
    multiprocessing.freeze_support()
    _configure_playwright()

    base = _base_dir()
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    if not getattr(sys, "frozen", False):
        if str(base.parent) not in sys.path:
            sys.path.insert(0, str(base.parent))

    if "--worker" in sys.argv:
        _run_worker()
        return

    import uvicorn
    from api_server import app

    host = "127.0.0.1"
    port = 8000

    def open_app() -> None:
        import urllib.request
        target_url = f"http://{host}:{port}/"
        for _ in range(30):
            time.sleep(0.5)
            try:
                with urllib.request.urlopen(f"{target_url}health", timeout=1) as resp:
                    if resp.status == 200:
                        break
            except Exception:
                pass
        webbrowser.open(target_url)

    threading.Thread(target=open_app, daemon=True).start()
    uvicorn.run(app, host=host, port=port, log_level="info", reload=False, workers=1)


if __name__ == "__main__":
    main()
