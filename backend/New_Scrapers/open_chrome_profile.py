"""Open the dedicated scraper Chrome profile and leave it open indefinitely."""
from __future__ import annotations

import asyncio

from playwright.async_api import async_playwright

from .fast_scraper_runner import SCRAPER_PROFILE_DIR, chrome_executable


async def open_profile() -> None:
    SCRAPER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    process = await asyncio.create_subprocess_exec(
        chrome_executable(),
        f"--user-data-dir={SCRAPER_PROFILE_DIR}",
        "--profile-directory=Default",
        "--start-maximized",
        "--no-first-run",
        "--no-default-browser-check",
    )
    print("Dedicated scraper Chrome is open. Close the Chrome window when finished.")
    await process.wait()


def main() -> None:
    asyncio.run(open_profile())


if __name__ == "__main__":
    main()
