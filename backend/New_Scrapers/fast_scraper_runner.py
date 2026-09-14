"""Run the New_Scrapers JavaScript files and save their final downloads."""
from __future__ import annotations

import asyncio
import logging
import subprocess
from contextlib import suppress
from datetime import datetime, timedelta
from pathlib import Path
import sys

from playwright.async_api import BrowserContext, async_playwright

from processing.platform_paths import BASE_DIR, dated_json_path
from processing.browser_paths import chromium_executable
from processing.process_status import update_site_status
from processing.structured_logging import get_scraper_logger
from processing.platform_paths import log_path

SCRIPTS = {
    "ajio": ("ajio_scraper.js", "https://www.ajio.com/b/columbia"),
    "myntra": ("mynthra_scraper.js", "https://www.myntra.com/columbia"),
    "columbia": ("columbia_scraper.js", "https://www.columbiasportswear.co.in/"),
    # The former Shopify collection route now returns 404.  The scraper uses
    # the store's products.json endpoint directly, so the stable storefront
    # root is the correct page to bootstrap the session.
    "adventure": ("adv_scraper.js", "https://adventuras.in/"),
    "tatacliq": ("tata_scraper.js", "https://www.tatacliq.com/search/?searchCategory=all&text=columbia"),
    "tata_lux": ("tata_lux_scraper.js", "https://luxury.tatacliq.com/search/?searchCategory=all&text=columbia"),
}

# Keep marketplace cookies and logins out of the user's normal Chrome profile.
# Both the interactive "Set scraper profile" action and the scraper use this
# exact directory, so a login completed once is available to every run.
SCRAPER_PROFILE_DIR = BASE_DIR / "data_scraper" / "chrome_scraper_profile"
CHROME_DEBUG_PORT = 9222


def chrome_executable() -> str:
    """Return a locally installed browser executable used for the profile."""
    executable = chromium_executable()
    if executable is None:
        raise FileNotFoundError(
            "No Chrome, Edge, or Chromium executable was found in the standard install locations"
        )
    return str(executable)


def start_chrome() -> subprocess.Popen:
    """Start normal Chrome, separate from Playwright's bundled Chromium."""
    SCRAPER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    return subprocess.Popen([
        chrome_executable(),
        f"--user-data-dir={SCRAPER_PROFILE_DIR}",
        f"--remote-debugging-port={CHROME_DEBUG_PORT}",
        "--profile-directory=Default",
        "--start-maximized",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-web-security",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
    ])


async def connect_to_chrome(pw):
    """Start Chrome and attach to its first context over CDP."""
    process = start_chrome()
    last_error = None
    for _ in range(60):
        if process.poll() is not None:
            raise RuntimeError("Chrome exited before remote debugging became available")
        try:
            browser = await pw.chromium.connect_over_cdp(
                f"http://127.0.0.1:{CHROME_DEBUG_PORT}"
            )
            return process, browser
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(0.25)
    process.terminate()
    raise RuntimeError("Could not connect to Chrome over CDP") from last_error

async def _run_site(context: BrowserContext, site, script_name, url, logger):
    page = await context.new_page()
    with suppress(Exception):
        await page.add_init_script("window.updateScraperProgress = function(p) { window.__SCRAPER_PROGRESS__ = p; };")
    def _handle_console(msg):
        try:
            logger.info("[%s] %s", site.upper(), msg.text)
        except Exception:
            pass

    page.on("console", _handle_console)
    destination = dated_json_path(site, datetime.now().strftime("%Y-%m-%d"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    download_task = None
    try:
        update_site_status(site, {"running": True, "stage": "Opening marketplace", "current": 0, "total": 1, "message": f"Opening {site}"})
        # Do not inject into a page that has not settled. The 30-second guard
        # prevents early navigation/download races; the explicit 3-second
        # pause gives marketplace pages time to finish their bootstrap.
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(3_000)
        script_file = None
        for candidate in (
            BASE_DIR / "New_Scrapers" / script_name,
            BASE_DIR / "_internal" / "New_Scrapers" / script_name,
            Path(getattr(sys, "_MEIPASS", "")) / "New_Scrapers" / script_name,
        ):
            if candidate.is_file():
                script_file = candidate
                break
        if not script_file:
            script_file = BASE_DIR / "New_Scrapers" / script_name
        script = script_file.read_text(encoding="utf-8")
        if site not in ("myntra", "tata_lux", "ajio"):
            download_task = asyncio.create_task(page.wait_for_event("download", timeout=1_800_000))
        # Start the async IIFE without awaiting it. The runner must poll the
        # page's progress state while the scraper is still fetching pages.
        await page.evaluate("script => { eval(script); }", script)
        update_site_status(site, {"stage": "Collecting products", "current": 0, "total": 1, "message": f"{site} scraper running"})
        last_logged_progress = None
        async def sync_progress():
            nonlocal last_logged_progress
            try:
                progress = await page.evaluate("window.__SCRAPER_PROGRESS__ || null")
                if progress:
                    update_site_status(site, progress)
                    marker = (progress.get("stage"), progress.get("current"), progress.get("total"))
                    if marker != last_logged_progress:
                        logger.info("%s progress %s/%s (%s%%) stage=%s", site, progress.get("current", 0), progress.get("total", 0), progress.get("percentage", 0), progress.get("stage", "Working"))
                        last_logged_progress = marker
            except Exception:
                pass
        if site == "myntra":
            # Myntra's blob anchor is intercepted by some Chrome builds and
            # extensions. Read the completed data from the page and write the
            # JSON artifact directly, guaranteeing a real file on disk.
            for _ in range(1800):
                await sync_progress()
                if await page.evaluate("window.__MYNTRA_SCRAPER_DONE__ === true"): break
                await page.wait_for_timeout(1000)
            products = await page.evaluate("window.__MYNTRA_PRODUCTS__")
            import json
            destination.write_text(json.dumps({
                "schema_version": 1, "source": "myntra",
                "scrape_date": datetime.now().strftime("%Y-%m-%d"),
                "scraped_at": datetime.now().isoformat(), "products": products,
            }, indent=2, ensure_ascii=False), encoding="utf-8")
            from processing.platform_paths import latest_json_path
            latest_p = latest_json_path("myntra")
            latest_p.parent.mkdir(parents=True, exist_ok=True)
            latest_p.write_text(destination.read_text(encoding="utf-8"), encoding="utf-8")
            logger.info("myntra saved directly to %s", destination)
            update_site_status(site, {"running": False, "stage": "Completed", "current": 1, "total": 1, "message": f"Saved {destination.name}"})
            return site, str(destination)
        if site == "tata_lux":
            for _ in range(1800):
                await sync_progress()
                if await page.evaluate("window.__TATA_LUX_SCRAPER_DONE__ === true"): break
                await page.wait_for_timeout(1000)
            products = await page.evaluate("window.__TATA_LUX_PRODUCTS__")
            if products:
                import json
                destination.write_text(json.dumps(products, indent=2, ensure_ascii=False), encoding="utf-8")
                from processing.platform_paths import latest_json_path
                latest_p = latest_json_path("tata_lux")
                latest_p.parent.mkdir(parents=True, exist_ok=True)
                latest_p.write_text(destination.read_text(encoding="utf-8"), encoding="utf-8")
                logger.info("tata_lux saved directly to %s", destination)
                update_site_status(site, {"running": False, "stage": "Completed", "current": 1, "total": 1, "message": f"Saved {destination.name}"})
                return site, str(destination)
        if site == "ajio":
            for _ in range(1800):
                await sync_progress()
                if await page.evaluate("window.__AJIO_SCRAPER_DONE__ === true"):
                    break
                await page.wait_for_timeout(1000)
            products = await page.evaluate("window.__AJIO_PRODUCTS__")
            if not products or len(products) == 0:
                error = await page.evaluate("window.__AJIO_SCRAPER_ERROR__")
                raise RuntimeError(f"Ajio scraped 0 products. Error: {error or 'Unknown error'}")
            import json
            destination.write_text(json.dumps({
                "schema_version": 1, "source": "ajio",
                "scrape_date": datetime.now().strftime("%Y-%m-%d"),
                "scraped_at": datetime.now().isoformat(), "products": products,
            }, indent=2, ensure_ascii=False), encoding="utf-8")
            from processing.platform_paths import latest_json_path
            latest_p = latest_json_path("ajio")
            latest_p.parent.mkdir(parents=True, exist_ok=True)
            latest_p.write_text(destination.read_text(encoding="utf-8"), encoding="utf-8")
            logger.info("ajio saved directly to %s (%d products)", destination, len(products))
            update_site_status(site, {"running": False, "stage": "Completed", "current": 1, "total": 1, "message": f"Saved {destination.name} ({len(products)} products)"})
            return site, str(destination)
        while not download_task.done():
            await sync_progress()
            await page.wait_for_timeout(1000)
        download = await download_task
        expected_names = {"adventure": "adventuras", "tata_lux": "tata_lux"}
        expected = expected_names.get(site, site)
        if expected not in download.suggested_filename.lower():
            raise RuntimeError(f"{site} received an unexpected download: {download.suggested_filename}")
        await download.save_as(destination)
        try:
            from processing.platform_paths import latest_json_path
            latest_p = latest_json_path(site)
            latest_p.parent.mkdir(parents=True, exist_ok=True)
            latest_p.write_bytes(destination.read_bytes())
        except Exception:
            pass
        logger.info("%s saved to %s", site, destination)
        if site not in ("tatacliq", "tata_lux"):
            update_site_status(site, {"running": False, "stage": "Completed", "current": 1, "total": 1, "message": f"Saved {destination.name}"})
        else:
            update_site_status(site, {"running": False, "stage": "Completed", "message": f"Saved {destination.name}"})
        return site, str(destination)
    except Exception as exc:
        update_site_status(site, {"running": False, "stage": "Failed", "message": str(exc)})
        raise
    finally:
        if download_task is not None and not download_task.done():
            download_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await download_task
        if not page.is_closed():
            await page.close()

async def _run(headless: bool, logger: logging.Logger, sites: list[str] | None = None) -> dict[str, str]:
    results: dict[str, str] = {}
    SCRAPER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        chrome_process, browser = await connect_to_chrome(pw)
        context = browser.contexts[0]
        try:
            chosen = sites or list(SCRIPTS)
            jobs = [
                _run_site(context, site, *SCRIPTS[site], get_scraper_logger(site, log_path(site)))
                for site in chosen
            ]
            completed = await asyncio.gather(*jobs, return_exceptions=True)
            for scraper_site, item in zip(chosen, completed):
                site_logger = get_scraper_logger(scraper_site, log_path(scraper_site))
                if isinstance(item, Exception):
                    site_logger.exception("Scraper failed", exc_info=item)
                else: results[item[0]] = item[1]
        finally:
            await browser.close()
            if chrome_process.poll() is None:
                chrome_process.terminate()
                try:
                    chrome_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    chrome_process.kill()
                    chrome_process.wait(timeout=5)
    return results

def remove_old_outputs(logger: logging.Logger, days: int = 4) -> None:
    cutoff = datetime.now() - timedelta(days=days)
    for site in SCRIPTS:
        folder = dated_json_path(site, "2000-01-01").parent
        for path in folder.glob("*.json"):
            if path.stat().st_mtime < cutoff.timestamp():
                path.unlink(missing_ok=True)
                logger.info("Removed expired scraper output %s", path)

def run(headless: bool, logger: logging.Logger, sites: list[str] | None = None) -> dict[str, str]:
    sites = sites or list(SCRIPTS)
    unknown = set(sites) - set(SCRIPTS)
    if unknown: raise ValueError(f"Unknown scraper(s): {', '.join(sorted(unknown))}")
    remove_old_outputs(logger)
    return asyncio.run(_run(headless, logger, sites))
