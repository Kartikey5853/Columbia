"""Open the dedicated scraper Chrome profile so marketplace logins can be saved."""
from __future__ import annotations

import asyncio

from playwright.async_api import async_playwright

from .fast_scraper_runner import SCRAPER_PROFILE_DIR, SCRIPTS, connect_to_chrome
from processing.process_status import mark_stopped


async def _open_profile() -> None:
    SCRAPER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        chrome_process, browser = await connect_to_chrome(pw)
        context = browser.contexts[0]
        closed_by_user = False
        try:
            # The pages are tabs in one Chrome window and share the dedicated
            # persistent profile. Log in to any site, then close Chrome.
            for _site, (_script, url) in SCRIPTS.items():
                page = await context.new_page()
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                except Exception as exc:
                    # Keep the profile window usable even if one marketplace
                    # is temporarily unavailable; the user can retry its tab.
                    print(f"Could not open {url}: {exc}")
            print("Scraper profile is open. Log in, then close the Chrome window to save it.")
            await browser.wait_for_event("disconnected")
            closed_by_user = True
        finally:
            if not closed_by_user:
                await browser.close()
            if chrome_process.poll() is None:
                chrome_process.terminate()


def main() -> None:
    try:
        asyncio.run(_open_profile())
    finally:
        mark_stopped("scraper_profile", "Scraper profile closed")


if __name__ == "__main__":
    main()
