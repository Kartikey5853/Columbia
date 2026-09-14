"""Run the Flipkart scraper and promote its output into the shared tuples."""
from __future__ import annotations
import os, sys, argparse, asyncio

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from data_scraper import flipkart_scraper
from processing.process_status import mark_started, mark_stopped, update_site_status
from processing.platform_paths import log_path
from processing.structured_logging import get_scraper_logger
from .storage import migrate
from .master_pipeline import build_master_tuples

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true", default=False)
    args = parser.parse_args()

    logger = get_scraper_logger("flipkart", log_path("flipkart"))
    mark_started("flipkart", os.getpid(), "Starting Flipkart scraper")
    try:
        asyncio.run(flipkart_scraper.main(headless=args.headless))
        migrate()
        try:
            result = build_master_tuples()
            update_site_status("flipkart", {"message": f"Completed; {result['summary']['normalized_products']} tuples rebuilt"})
        except Exception as tuple_exc:
            logger.warning("Tuples rebuild deferred: %s", tuple_exc)
    except Exception as exc:
        logger.exception("Flipkart scraper failed")
        update_site_status("flipkart", {"running": False, "stage": "Failed", "message": str(exc)})
        raise
    finally:
        mark_stopped("flipkart", "Flipkart scraper complete")

if __name__ == "__main__":
    main()
