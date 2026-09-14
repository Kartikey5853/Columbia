"""Run the Amazon V4 scraper and promote its output into the shared tuples."""
from __future__ import annotations
import os, argparse, json, asyncio
from amazonV4 import amazon_scraper
from processing.process_status import mark_started, mark_stopped, update_site_status
from processing.platform_paths import log_path
from processing.structured_logging import get_scraper_logger
from .storage import migrate
from .master_pipeline import build_master_tuples

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int)
    parser.add_argument("--sellers", default="")
    args = parser.parse_args()
    if args.workers: amazon_scraper.WORKERS = args.workers
    if args.sellers:
        amazon_scraper.SELLERS = [(item["id"], item.get("name") or item["id"]) for item in json.loads(args.sellers)]
    logger = get_scraper_logger("amazon", log_path("amazon"))
    mark_started("amazon", os.getpid(), "Starting Amazon V4")
    try:
        asyncio.run(amazon_scraper.main())
        migrate()
        result = build_master_tuples()
        update_site_status("amazon", {"message": f"Completed; {result['summary']['normalized_products']} tuples rebuilt"})
    except Exception as exc:
        logger.exception("Amazon V4 failed")
        update_site_status("amazon", {"message": str(exc)})
        raise
    finally:
        mark_stopped("amazon", "Amazon V4 complete")

if __name__ == "__main__":
    main()
