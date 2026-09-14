(async () => {

    const BASE_URL = "https://adventuras.in";
    const LIMIT = 250;

    window.output = [];

    const progressStartedAt = Date.now();
    window.updateProgress = function (progress) {
        const current = Number(progress.current || 0), total = Number(progress.total || 0);
        const elapsedSeconds = Math.max(0, (Date.now() - progressStartedAt) / 1000);
        const payload = {
            ...progress,
            current,
            total,
            elapsed_seconds: Math.round(elapsedSeconds),
            eta_seconds: current > 0 && total > current ? Math.round((elapsedSeconds / current) * (total - current)) : 0,
            updated_at: new Date().toISOString()
        };
        window.__SCRAPER_PROGRESS__ = payload;
        if (typeof window.updateScraperProgress === "function") {
            try { window.updateScraperProgress(payload); } catch (_) {}
        }
    };

    let page = 1;

    while (true) {
        console.log(`Fetching Page ${page}...`);
        window.updateProgress({ stage: "Collecting Products", current: page, total: page + 1 });

        let response;
        try {
            response = await fetch(
                `${BASE_URL}/products.json?limit=${LIMIT}&page=${page}`
            );
        } catch (fetchErr) {
            console.error(`Network error on Page ${page}:`, fetchErr);
            break;
        }

        if (!response.ok) {
            console.error(`HTTP ${response.status} on Page ${page}`);
            break;
        }

        const data = await response.json();

        if (!data.products || data.products.length === 0) {
            console.log(`Page ${page} returned no products. Finished pagination.`);
            break;
        }

        let pageColumbiaCount = 0;
        for (const product of data.products) {
            if (
                !product.vendor ||
                product.vendor.trim().toLowerCase() !== "columbia"
            ) {
                continue;
            }

            pageColumbiaCount++;
            for (const variant of (product.variants || [])) {
                window.output.push({
                    source: "adventuras",
                    product_id: String(product.id),
                    sku: variant.sku || "",
                    ean: variant.barcode || "",
                    title: product.title,
                    price: Number(variant.price),
                    mrp:
                        variant.compare_at_price
                            ? Number(variant.compare_at_price)
                            : Number(variant.price),
                    image_url:
                        product.images?.[0]?.src || "",
                    url:
                        `${BASE_URL}/products/${product.handle}`
                });
            }
        }

        console.log(
            `Page ${page}: ${data.products.length} products (${pageColumbiaCount} Columbia). Total SKUs so far: ${window.output.length}`
        );

        if (data.products.length < LIMIT) {
            console.log(`Page ${page} returned less than ${LIMIT} products. Finished pagination.`);
            break;
        }

        page++;
        await new Promise(r => setTimeout(r, 400));
    }

    const totalPages = Math.max(1, page);
    console.log(
        `Collected ${window.output.length} products across ${totalPages} pages`
    );

    console.log("--------------------------------");
    console.log("SCRAPING COMPLETE");
    console.log("--------------------------------");
   
    console.log("Total SKUs :", window.output.length);
  
    console.log("--------------------------------");
    window.updateProgress({ stage: "Completed", current: totalPages, total: totalPages });

    // Download JSON

    const output = {

        schema_version: 1,

        source: "adventuras",

        scrape_date: new Date().toISOString().slice(0,10),

        scraped_at: new Date().toISOString(),

        products: window.output

    };

    const blob = new Blob(
        [
             JSON.stringify(output, null, 2)
        ],
        {
            type: "application/json"
        }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = "adventuras_products.json";

    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    console.log("Download Complete!");
    setTimeout(() => { try { window.close(); } catch (_) {} }, 1500);

})();
