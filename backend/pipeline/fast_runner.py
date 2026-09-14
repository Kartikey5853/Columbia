"""Only supported scraper entrypoint: browser scrapers, snapshots, prices, tuples."""
from __future__ import annotations
import argparse, logging, os
from New_Scrapers.fast_scraper_runner import run
from processing.process_status import get_site_status, mark_started, mark_stopped, update_site_status
from processing.platform_paths import log_path
from processing.structured_logging import get_scraper_logger, log_event
from .master_pipeline import build_master_tuples
from .storage import migrate

def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--headless", action="store_true"); parser.add_argument("--headed", dest="headless", action="store_false"); parser.add_argument("--sites", default=""); parser.set_defaults(headless=False); args = parser.parse_args()
    chosen_sites = [site for site in args.sites.split(",") if site] or None
    # A single worker owns the shared Chrome profile and opens one tab per
    # marketplace. Each marketplace still receives its own status and log.
    sites = chosen_sites or ["ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux"]
    site = sites[0] if len(sites) == 1 else "fast_scrapers"
    logger = get_scraper_logger(site, log_path(site))
    for scraper_site in sites:
        mark_started(scraper_site, os.getpid(), f"Starting {scraper_site.title()} scraper")
    try:
        result = run(args.headless, logger, chosen_sites)
        if not result:
            raise RuntimeError("No selected marketplace scraper completed successfully. Check the individual scraper logs.")
        # Promote every dated snapshot, including Tata Cliq, into the shared
        # price store before rebuilding tuples for the UI/export consumers.
        migrate()
        try:
            tuples = build_master_tuples()
            update_site_status(site, {"success_count": len(result), "message": f"Completed; {tuples['summary']['normalized_products']} tuples rebuilt"})
        except RuntimeError as exc:
            # Scraping is useful even before the user uploads the master
            # workbook.  Do not turn that valid first-run state into an
            # unhandled worker exception; the UI can show the actionable
            # message and the user can rebuild after uploading the workbook.
            logger.warning("Scrape completed; tuple rebuild deferred: %s", exc)
            update_site_status(site, {"success_count": len(result), "stage": "Completed", "message": str(exc)})
        log_event(logger, logging.INFO, site.upper(), f"Completed sites={result}")
    except Exception as exc:
        logger.exception("Browser scraper worker failed")
        for scraper_site in sites:
            update_site_status(scraper_site, {"running": False, "stage": "Failed", "message": str(exc)})
        log_event(logger, logging.ERROR, site.upper(), f"Scraper worker failed: {exc}")
    finally:
        for scraper_site in sites:
            failed = get_site_status(scraper_site).get("stage") == "Failed"
            mark_stopped(scraper_site, f"{scraper_site.title()} scraper {'failed' if failed else 'complete'}")
if __name__ == "__main__": main()
