"""Sequential staged scraper runner with fail-safe automatic retry protocol.

Sequence:
  Stage 1: Amazon (alone)
  Stage 2: Myntra + Ajio (concurrently)
  Stage 3: Columbia + Adventuras (concurrently)
  Stage 4: Tata Cliq + Tata Lux (concurrently)
  Stage 5: Flipkart (alone)

Fail-safe protocol:
  If any scraper fails or produces an empty (0 KB) output JSON, it is added
  to the retry queue and re-scraped automatically.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from processing.platform_paths import (
    BASE_DIR,
    latest_json_path,
    dated_json_path,
    log_path,
)
from processing.process_status import (
    get_site_status,
    mark_started,
    mark_stopped,
    update_site_status,
)
from processing.structured_logging import get_scraper_logger
from processing.json_store import load_json, product_list
from .master_pipeline import build_master_tuples
from .storage import migrate

# Staged execution configuration
STAGE_GROUPS = [
    ("Stage 1 - Amazon", ["amazon"]),
    ("Stage 2 - Myntra & Ajio", ["myntra", "ajio"]),
    ("Stage 3 - Columbia & Adventuras", ["columbia", "adventure"]),
    ("Stage 4 - Tata Cliq & Tata Lux", ["tatacliq", "tata_lux"]),
    ("Stage 5 - Flipkart", ["flipkart"]),
]

MAX_RETRIES = 2


def is_output_valid(site: str) -> bool:
    """Check if scraper output exists and contains non-empty valid data (> 0 bytes)."""
    today_str = datetime.now().strftime("%Y-%m-%d")
    candidates = [
        latest_json_path(site),
        dated_json_path(site, today_str),
    ]
    # Also check legacy or root directory paths
    legacy_folder = latest_json_path(site).parent
    if legacy_folder.exists():
        candidates.extend(sorted(legacy_folder.glob("*.json"), reverse=True))

    for path in candidates:
        if path.exists() and path.is_file():
            size = path.stat().st_size
            if size > 50:  # More than empty JSON '{}' or '[]'
                try:
                    payload = load_json(path, None)
                    if payload is not None:
                        items = product_list(payload)
                        if len(items) > 0:
                            return True
                except Exception:
                    pass
    return False


def run_stage_process(stage_name: str, sites: list[str], options: dict, logger: logging.Logger) -> dict[str, bool]:
    """Execute scrapers belonging to a stage and wait for their completion."""
    logger.info("=== Starting %s: %s ===", stage_name, ", ".join(sites))
    results: dict[str, bool] = {}

    if not sites:
        return results

    # Separate standalone Python scrapers from browser scrapers
    if "amazon" in sites:
        workers = options.get("workers", 4)
        sellers = options.get("sellers", [])
        args = ["--workers", str(workers)]
        if sellers:
            args += ["--sellers", json.dumps(sellers)]
        
        log = log_path("amazon").open("a", encoding="utf-8")
        cmd = (
            [sys.executable, "--worker", "pipeline.amazon_v4_runner", *args]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-u", "-m", "pipeline.amazon_v4_runner", *args]
        )
        proc = subprocess.Popen(cmd, cwd=BASE_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        mark_started("amazon", proc.pid, "Amazon running")
        exit_code = proc.wait()
        log.close()
        results["amazon"] = (exit_code == 0)

    elif "flipkart" in sites:
        headless_flag = ["--headless"] if options.get("headless", False) else []
        log = log_path("flipkart").open("a", encoding="utf-8")
        cmd = (
            [sys.executable, "--worker", "pipeline.flipkart_runner", *headless_flag]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-u", "-m", "pipeline.flipkart_runner", *headless_flag]
        )
        proc = subprocess.Popen(cmd, cwd=BASE_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        mark_started("flipkart", proc.pid, "Flipkart running")
        exit_code = proc.wait()
        log.close()
        results["flipkart"] = (exit_code == 0)

    else:
        # Browser scrapers running concurrently in fast_scraper_runner
        log = log_path("fast_scrapers").open("a", encoding="utf-8")
        args = ["--sites", ",".join(sites)]
        if options.get("headless", False):
            args.append("--headless")
        cmd = (
            [sys.executable, "--worker", "pipeline.fast_runner", *args]
            if getattr(sys, "frozen", False)
            else [sys.executable, "-u", "-m", "pipeline.fast_runner", *args]
        )
        proc = subprocess.Popen(cmd, cwd=BASE_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        for s in sites:
            mark_started(s, proc.pid, f"{s} running")
        exit_code = proc.wait()
        log.close()
        for s in sites:
            results[s] = (exit_code == 0)

    return results


def run_pipeline(selected_sites: list[str] | None = None, options: dict | None = None) -> dict[str, str]:
    """Execute the full 5-stage sequential scraper pipeline with fail-safe retries."""
    options = options or {}
    logger = get_scraper_logger("staged_pipeline", log_path("staged_pipeline"))
    logger.info("Initializing Staged Scraper Pipeline")

    all_allowed = ["amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart"]
    sites_to_run = set(selected_sites or all_allowed)

    # Initial marking: Mark active sites as Queued
    for stage_idx, (stage_name, stage_sites) in enumerate(STAGE_GROUPS, 1):
        matching = [s for s in stage_sites if s in sites_to_run]
        for s in matching:
            update_site_status(s, {
                "running": False,
                "stage": "Queued",
                "message": f"Waiting in queue ({stage_name})",
                "current": 0,
                "total": 1,
            })

    retry_counts: dict[str, int] = {s: 0 for s in sites_to_run}
    failed_queue: list[str] = []

    # Execute Initial Stages 1 to 5
    for stage_idx, (stage_name, stage_sites) in enumerate(STAGE_GROUPS, 1):
        active_in_stage = [s for s in stage_sites if s in sites_to_run]
        if not active_in_stage:
            continue

        for s in active_in_stage:
            update_site_status(s, {
                "running": True,
                "stage": "Starting",
                "message": f"Starting {stage_name}",
            })

        stage_results = run_stage_process(stage_name, active_in_stage, options, logger)

        # Validate outputs and check fail-safe criteria
        for s in active_in_stage:
            proc_ok = stage_results.get(s, False)
            output_ok = is_output_valid(s)

            if proc_ok and output_ok:
                logger.info("✓ %s completed successfully with valid output.", s)
                update_site_status(s, {
                    "running": False,
                    "stage": "Completed",
                    "message": "Scrape completed successfully",
                })
            else:
                logger.warning("✗ %s failed or output was empty (proc_ok=%s, output_ok=%s). Queuing for retry.", s, proc_ok, output_ok)
                update_site_status(s, {
                    "running": False,
                    "stage": "Re-queued (Retry)",
                    "message": "Output was 0KB or failed. Waiting for retry...",
                })
                failed_queue.append(s)

    # Fail-Safe Retry Loop
    retry_round = 1
    while failed_queue and retry_round <= MAX_RETRIES:
        current_retries = list(dict.fromkeys(failed_queue))
        failed_queue.clear()
        logger.info("=== Starting Fail-Safe Retry Round %d for %s ===", retry_round, ", ".join(current_retries))

        for stage_idx, (stage_name, stage_sites) in enumerate(STAGE_GROUPS, 1):
            retry_stage_sites = [s for s in stage_sites if s in current_retries]
            if not retry_stage_sites:
                continue

            for s in retry_stage_sites:
                retry_counts[s] = retry_counts.get(s, 0) + 1
                update_site_status(s, {
                    "running": True,
                    "stage": f"Retrying ({retry_counts[s]}/{MAX_RETRIES})",
                    "message": f"Retrying {s} (attempt {retry_counts[s] + 1})",
                })

            stage_results = run_stage_process(f"Retry {stage_name}", retry_stage_sites, options, logger)

            for s in retry_stage_sites:
                proc_ok = stage_results.get(s, False)
                output_ok = is_output_valid(s)
                if proc_ok and output_ok:
                    logger.info("✓ [RETRY SUCCESS] %s completed with valid output.", s)
                    update_site_status(s, {
                        "running": False,
                        "stage": "Completed",
                        "message": "Scrape completed successfully on retry",
                    })
                else:
                    logger.warning("✗ [RETRY FAILED] %s still failed or 0KB (attempt %d).", s, retry_counts[s])
                    if retry_counts[s] < MAX_RETRIES:
                        failed_queue.append(s)
                        update_site_status(s, {
                            "running": False,
                            "stage": "Re-queued (Retry)",
                            "message": f"Retry failed; queued for attempt {retry_counts[s] + 2}",
                        })
                    else:
                        update_site_status(s, {
                            "running": False,
                            "stage": "Failed",
                            "message": f"Failed after {MAX_RETRIES + 1} attempts",
                        })

        retry_round += 1

    # Rebuild price history and catalog tuples
    logger.info("Scraping stages finished. Updating price history and rebuilding tuples...")
    try:
        migrate()
        tuples_res = build_master_tuples()
        logger.info("Catalog tuples rebuilt: %s tuples", tuples_res.get("summary", {}).get("normalized_products", 0))
    except Exception as exc:
        logger.warning("Deferred tuple rebuild: %s", exc)

    logger.info("Staged pipeline execution finished.")
    return {"status": "completed"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sites", default="", help="Comma-separated sites")
    parser.add_argument("--headless", action="store_true", default=False)
    args = parser.parse_args()

    sites = [s.strip() for s in args.sites.split(",") if s.strip()] or None
    run_pipeline(sites, {"headless": args.headless})


if __name__ == "__main__":
    main()
