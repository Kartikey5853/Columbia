import asyncio
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

from processing.process_status import update_site_status
from processing.platform_paths import dated_json_path, latest_json_path
from processing.json_store import save_json_atomic


SEARCH_URL = (
    "https://www.flipkart.com/search"
    "?q=columbia"
    "&otracker=search"
    "&otracker1=search"
    "&marketplace=FLIPKART"
    "&as-show=on"
    "&as=off"
)

OUTPUT_FILE = "flipkart_columbia_products.json"

MAX_SEARCH_PAGES = 100
PDP_CONCURRENCY = 5


# ------------------------------------------------------------
# SEARCH PAGE EXTRACTION
# ------------------------------------------------------------

SEARCH_EXTRACT_JS = """
() => {
    const products = [...document.querySelectorAll('div[data-tkid]')]
        .filter(p => p.querySelector('a[href*="/p/"]'));

    return products.map(p => {
        const link = p.querySelector('a[href*="/p/"]');
        const img = p.querySelector('img[src*="flixcart"]');

        let pid = null;

        try {
            pid = new URL(link.href).searchParams.get("pid");
        } catch (_) {}

        const priceText =
            [...p.querySelectorAll("div,span")]
                .map(x => x.innerText?.trim())
                .find(x => x && /^₹[\\d,]+$/.test(x));

        return {
            pid,
            title: link?.getAttribute("title") || link?.innerText?.trim() || "",
            url: link?.href?.split("?")[0] || "",
            image_url: img?.src || null,
            card_text: p.innerText?.trim() || "",
            price_from_card: priceText || null
        };
    });
}
"""


# ------------------------------------------------------------
# PDP EXTRACTION
# ------------------------------------------------------------

PDP_EXTRACT_JS = """
() => {

    function parseJSONScript(selector) {
        const script = document.querySelector(selector);
        if (!script) return null;

        try {
            return JSON.parse(script.textContent);
        } catch (_) {
            return null;
        }
    }

    function findInitialState() {
        const scripts = [...document.scripts];

        for (const script of scripts) {
            const text = script.textContent || "";

            if (
                text.includes('"ppd"') &&
                text.includes('"mrp"')
            ) {
                return text;
            }
        }

        return null;
    }

    function findMRP() {
        const text = findInitialState();

        if (!text) return null;

        /*
         * Flipkart's current PDP state contains:
         *
         * "ppd":{
         *     "fsp":11999,
         *     "finalPrice":11999,
         *     "mrp":11999,
         *     ...
         * }
         *
         * Keep this deliberately targeted rather than trying
         * to parse the entire enormous initial state object.
         */

        const match = text.match(
            /"ppd"\\s*:\\s*\\{[\\s\\S]{0,2000}?"mrp"\\s*:\\s*([\\d.]+)/
        );

        if (match) {
            return Number(match[1]);
        }

        return null;
    }

    function getJSONLD() {
        const script = document.querySelector(
            'script[type="application/ld+json"]'
        );

        if (!script) return null;

        try {
            const data = JSON.parse(script.textContent);

            if (Array.isArray(data)) {
                return data.find(
                    x => x && x["@type"] === "Product"
                ) || data[0];
            }

            return data;
        } catch (_) {
            return null;
        }
    }

    const product = getJSONLD() || {};

    const variantLinks = [
        ...document.querySelectorAll(
            'a[href*="swatchAttr=size"]'
        )
    ];

    const variants = [];

    const seen = new Set();

    for (const a of variantLinks) {

        try {
            const u = new URL(a.href);

            const pid = u.searchParams.get("pid");
            const size = a.innerText.trim();

            if (!pid || seen.has(pid))
                continue;

            seen.add(pid);

            variants.push({
                size: size || null,
                sku: pid,
                url: a.href.split("&otracker")[0]
            });

        } catch (_) {}
    }

    return {
        title: product.name || null,
        sku: product.sku || null,
        price: product.offers?.price ?? null,
        mrp: findMRP(),
        image_url: Array.isArray(product.image)
            ? product.image[0] || null
            : product.image || null,
        variants
    };
}
"""


# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

async def safe_text(page, selector):
    try:
        return await page.locator(selector).first.inner_text(timeout=3000)
    except Exception:
        return None


async def wait_for_products(page):
    try:
        await page.wait_for_selector(
            'div[data-tkid] a[href*="/p/"]',
            timeout=30000
        )
    except PlaywrightTimeoutError:
        return False

    # Give Flipkart a little time to finish rendering cards.
    await page.wait_for_timeout(1500)

    return True


async def extract_search_products(page):
    return await page.evaluate(SEARCH_EXTRACT_JS)


async def get_next_url(page, current_page_number=1):
    url = await page.evaluate("""
    () => {
        const links = [...document.querySelectorAll("a[href]")];
        const next = links.find(a => {
            const text = (a.innerText || "").trim().toUpperCase();
            const aria = (a.getAttribute("aria-label") || "").trim().toUpperCase();
            return text === "NEXT" || aria === "NEXT" || text.includes("NEXT");
        });
        return next ? next.href : null;
    }
    """)
    if not url:
        target_page_str = str(current_page_number + 1)
        url = await page.evaluate("""
        (target) => {
            const links = [...document.querySelectorAll("a[href]")];
            const pageLink = links.find(a => (a.innerText || "").trim() === target);
            return pageLink ? pageLink.href : null;
        }
        """, target_page_str)
    return url


# ------------------------------------------------------------
# SCRAPE ALL SEARCH PAGES
# ------------------------------------------------------------

async def scrape_search_pages(context):

    page = await context.new_page()

    products = {}
    visited_pages = set()

    await page.goto(
        SEARCH_URL,
        wait_until="domcontentloaded",
        timeout=60000
    )

    total_pages_detected = None

    for page_number in range(1, MAX_SEARCH_PAGES + 1):

        current_url = page.url

        print()
        print("=" * 70)
        print(f"[SEARCH] PAGE {page_number}")
        print(current_url)

        if current_url in visited_pages:
            print("[SEARCH] Already visited. Stopping.")
            break

        visited_pages.add(current_url)

        loaded = await wait_for_products(page)

        if not loaded:
            print("[SEARCH] ❌ No product cards found.")
            break

        if total_pages_detected is None:
            try:
                total_pages_detected = await page.evaluate("""
                () => {
                    const spans = [...document.querySelectorAll("span")];
                    const matchSpan = spans.find(s => /Page \\d+ of \\d+/i.test(s.innerText || ""));
                    if (matchSpan) {
                        const m = matchSpan.innerText.match(/Page \\d+ of (\\d+)/i);
                        if (m) return parseInt(m[1], 10);
                    }
                    return null;
                }
                """)
            except Exception:
                pass

        page_products = await extract_search_products(page)

        print(
            f"[SEARCH] Rendered products: "
            f"{len(page_products)}"
        )

        new_count = 0

        for product in page_products:

            pid = product.get("pid")

            if not pid:
                continue

            if pid not in products:
                products[pid] = product
                new_count += 1

        print(
            f"[SEARCH] New products: "
            f"{new_count}"
        )

        print(
            f"[SEARCH] Total unique products: "
            f"{len(products)}"
        )

        display_total = total_pages_detected or max(page_number, 10)
        update_site_status("flipkart", {
            "running": True,
            "stage": "Search Pages",
            "current": page_number,
            "total": display_total,
            "percentage": min(95, int((page_number / display_total) * 50)),
            "message": f"Search Page {page_number}/{display_total} ({len(products)} products)"
        })

        next_url = await get_next_url(page, page_number)

        if not next_url:
            print("[SEARCH] No NEXT button. Finished.")
            break

        print("[SEARCH] NEXT:")
        print(next_url)

        old_url = page.url

        try:
            await page.goto(
                next_url,
                wait_until="domcontentloaded",
                timeout=60000
            )
        except PlaywrightTimeoutError:
            print("[SEARCH] Navigation timeout.")
            print("[SEARCH] Checking whether page loaded anyway...")

        await page.wait_for_timeout(2000)

        if page.url == old_url:
            print("[SEARCH] URL did not change. Stopping.")
            break

    await page.close()

    return list(products.values())


# ------------------------------------------------------------
# PDP SCRAPER
# ------------------------------------------------------------

async def scrape_one_pdp(context, product, index, total):

    pid = product["pid"]
    url = product["url"]

    page = await context.new_page()

    try:

        print(
            f"[PDP {index}/{total}] "
            f"{pid} | {product['title']}"
        )

        # Add PID explicitly because Flipkart's search URL
        # itself may not contain the variant PID.
        pdp_url = url + "?pid=" + pid

        try:
            await page.goto(
                pdp_url,
                wait_until="domcontentloaded",
                timeout=60000
            )
        except PlaywrightTimeoutError:
            print(f"[PDP {index}/{total}] Navigation timeout.")

        try:
            await page.wait_for_load_state(
                "domcontentloaded",
                timeout=15000
            )
        except Exception:
            pass

        await page.wait_for_timeout(1200)

        data = await page.evaluate(PDP_EXTRACT_JS)

        result = {
            "source": "flipkart",
            "product_id": pid,
            "sku": data.get("sku") or pid,
            "title": data.get("title") or product.get("title"),
            "price": data.get("price"),
            "mrp": data.get("mrp"),
            "image_url": (
                data.get("image_url")
                or product.get("image_url")
            ),
            "url": pdp_url,
            "variants": data.get("variants", []),
            "scraped_at": datetime.now(
                timezone.utc
            ).isoformat()
        }

        print(
            f"[PDP {index}/{total}] "
            f"MRP={result['mrp']} "
            f"VARIANTS={len(result['variants'])}"
        )

        return result

    except Exception as e:

        print(
            f"[PDP {index}/{total}] ❌ ERROR: {e}"
        )

        return {
            "source": "flipkart",
            "product_id": pid,
            "sku": pid,
            "title": product.get("title"),
            "price": None,
            "mrp": None,
            "image_url": product.get("image_url"),
            "url": url,
            "variants": [],
            "scraped_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "error": str(e)
        }

    finally:
        await page.close()


# ------------------------------------------------------------
# PDP WORKER POOL
# ------------------------------------------------------------

async def scrape_pdps(context, products):

    total = len(products)

    semaphore = asyncio.Semaphore(PDP_CONCURRENCY)

    results = [None] * total
    completed = 0
    lock = asyncio.Lock()

    async def worker(index, product):
        nonlocal completed
        async with semaphore:
            res = await scrape_one_pdp(
                context,
                product,
                index + 1,
                total
            )
            results[index] = res
            async with lock:
                completed += 1
                if completed % 3 == 0 or completed == total:
                    pct = 50 + int((completed / total) * 50) if total else 100
                    update_site_status("flipkart", {
                        "running": True,
                        "stage": "Scraping PDPs",
                        "current": completed,
                        "total": total,
                        "percentage": min(99, pct),
                        "message": f"PDP {completed}/{total} scraped"
                    })

    tasks = [
        asyncio.create_task(
            worker(i, product)
        )
        for i, product in enumerate(products)
    ]

    await asyncio.gather(*tasks)

    return results


# ------------------------------------------------------------
# MAIN
# ------------------------------------------------------------

async def main(headless=False):

    print()
    print("=" * 70)
    print("FLIPKART COLUMBIA SCRAPER")
    print("=" * 70)

    update_site_status("flipkart", {
        "running": True,
        "stage": "Starting",
        "current": 0,
        "total": 1,
        "message": "Launching browser"
    })

    async with async_playwright() as p:

        browser = await p.chromium.launch(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled"
            ]
        )

        context = await browser.new_context(
            viewport={
                "width": 1366,
                "height": 900
            }
        )

        try:
            # ----------------------------------------------------
            # SEARCH
            # ----------------------------------------------------

            products = await scrape_search_pages(context)

            print()
            print("=" * 70)
            print(f"SEARCH COMPLETE: {len(products)} UNIQUE PRODUCTS")
            print("=" * 70)

            if not products:
                print("❌ No products found.")
                update_site_status("flipkart", {
                    "running": False,
                    "stage": "Failed",
                    "message": "No products found on search"
                })
                await browser.close()
                return

            # Save checkpoint before PDP scraping.
            checkpoint = {
                "source": "flipkart",
                "query": "columbia",
                "search_products": products,
                "scraped_at": datetime.now(
                    timezone.utc
                ).isoformat()
            }

            with open(
                "flipkart_search_checkpoint.json",
                "w",
                encoding="utf-8"
            ) as f:
                json.dump(
                    checkpoint,
                    f,
                    ensure_ascii=False,
                    indent=2
                )

            # ----------------------------------------------------
            # PDP
            # ----------------------------------------------------

            results = await scrape_pdps(
                context,
                products
            )

            # ----------------------------------------------------
            # FINAL OUTPUT
            # ----------------------------------------------------

            today_str = datetime.now().strftime("%Y-%m-%d")
            dest_dated = dated_json_path("flipkart", today_str)
            dest_latest = latest_json_path("flipkart")

            payload = {
                "schema_version": 1,
                "source": "flipkart",
                "scrape_date": today_str,
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "products": results
            }

            save_json_atomic(dest_dated, payload)
            save_json_atomic(dest_latest, payload)

            with open(
                OUTPUT_FILE,
                "w",
                encoding="utf-8"
            ) as f:
                json.dump(
                    payload,
                    f,
                    ensure_ascii=False,
                    indent=2
                )

            successful = sum(
                1
                for x in results
                if not x.get("error")
            )

            failed = len(results) - successful

            print()
            print("=" * 70)
            print("SCRAPING COMPLETE")
            print("=" * 70)
            print(f"Products found : {len(products)}")
            print(f"PDP successful : {successful}")
            print(f"PDP failed     : {failed}")
            print(f"Output         : {dest_dated}")
            print("=" * 70)

            update_site_status("flipkart", {
                "running": False,
                "stage": "Completed",
                "current": len(results),
                "total": len(results),
                "percentage": 100,
                "message": f"Saved {successful} products to {dest_dated.name}"
            })

        except Exception as exc:
            update_site_status("flipkart", {
                "running": False,
                "stage": "Failed",
                "message": str(exc)
            })
            raise
        finally:
            await browser.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--headless", action="store_true", default=False)
    args = parser.parse_args()
    asyncio.run(main(headless=args.headless))