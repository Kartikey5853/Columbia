(async () => {

    // ============================================================
    // CONFIG
    // ============================================================

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));

    const randomDelay = () =>
        1500 + Math.floor(Math.random() * 2000);

    const PAGE_SIZE = 45;

    const allProducts = [];

    const seenProducts = new Set();

    let lastCompletedPage = 0;
    const progressStartedAt = Date.now();


    // ============================================================
    // INITIALIZE WINDOW STATE
    // ============================================================

    window.__AJIO_PRODUCTS__ = [];

    window.__AJIO_LAST_PAGE__ = 0;

    window.__AJIO_SCRAPER_DONE__ = false;

    window.__AJIO_SCRAPER_ERROR__ = null;
    window.updateProgress = function (progress) {
        const current = Number(progress.current || 0), total = Number(progress.total || 0);
        const elapsedSeconds = Math.max(0, (Date.now() - progressStartedAt) / 1000);
        const payload = { ...progress, current, total, elapsed_seconds: Math.round(elapsedSeconds),
            eta_seconds: current > 0 && total > current ? Math.round((elapsedSeconds / current) * (total - current)) : 0,
            updated_at: new Date().toISOString() };
        window.__SCRAPER_PROGRESS__ = payload;
        if (typeof window.updateScraperProgress === "function") {
            try { window.updateScraperProgress(payload); } catch (_) {}
        }
    };


    // ============================================================
    // FETCH ONE PAGE
    // ============================================================

    async function fetchPage(page) {

        const url =
            `/api/category/columbia` +
            `?fields=SITE` +
            `&currentPage=${page}` +
            `&pageSize=${PAGE_SIZE}` +
            `&format=json` +
            `&query=%3Arelevance` +
            `&classifier=intent`;


        console.log(
            `Fetching AJIO Page ${page + 1} | API currentPage=${page}`
        );


        const response = await fetch(
            url,
            {
                method: "GET",

                credentials: "same-origin",

                headers: {
                    "accept": "application/json, text/plain, */*"
                }
            }
        );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status} on AJIO Page ${page + 1}`
            );

        }


        const contentType =
            response.headers.get("content-type") || "";


        if (!contentType.includes("application/json")) {

            const text =
                await response.text();


            throw new Error(
                `Expected JSON but received ${contentType}. ` +
                `Response starts with: ${text.slice(0, 200)}`
            );

        }


        return await response.json();

    }


    // ============================================================
    // PRICE HELPER
    // ============================================================

    function getPrice(priceObject) {

        if (!priceObject) {
            return "";
        }


        return (

            priceObject.displayformattedValue ||

            priceObject.formattedValue ||

            (
                priceObject.value != null

                    ? String(priceObject.value)

                    : ""
            )

        );

    }


    // ============================================================
    // IMAGE HELPER
    // ============================================================

    function getImage(product) {

        let imageUrl =

            product.images?.[0]?.url ||

            product.fnlColorVariantData?.outfitPictureURL ||

            product.fnlColorVariantData?.images?.[0]?.url ||

            "";


        // Some AJIO image URLs may be protocol-relative

        if (
            imageUrl &&
            imageUrl.startsWith("//")
        ) {

            imageUrl =
                `https:${imageUrl}`;

        }


        return imageUrl;

    }


    // ============================================================
    // URL HELPER
    // ============================================================

    function getProductUrl(product) {

        if (!product.url) {

            return "";

        }


        if (
            product.url.startsWith("http://") ||
            product.url.startsWith("https://")
        ) {

            return product.url;

        }


        return (
            `https://www.ajio.com${
                product.url.startsWith("/")
                    ? product.url
                    : "/" + product.url
            }`
        );

    }


    // ============================================================
    // NORMALIZE PRODUCT
    // ============================================================

    function normalizeProduct(product) {

    let imageUrl =
        product.images?.[0]?.url ||
        product.fnlColorVariantData?.outfitPictureURL ||
        product.fnlColorVariantData?.images?.[0]?.url ||
        "";

    if (imageUrl.startsWith("//")) {
        imageUrl = "https:" + imageUrl;
    }

    return {

        source: "ajio",

        product_id: String(
            product.code ||
            product.productCode ||
            product.id ||
            ""
        ),

        sku:
            product.sellerSku ||
            product.sku ||
            "",

        ean: "",

        title:
            product.name ||
            product.productName ||
            "",

        price:
            Number(
                product.offerPrice?.value ??
                product.price?.value ??
                0
            ),

        mrp:
            Number(
                product.price?.value ??
                product.offerPrice?.value ??
                0
            ),

        image_url: imageUrl,

        url: getProductUrl(product)

    };

}



const output = {

    schema_version: 1,

    source: "ajio",

    scrape_date: new Date().toISOString().slice(0,10),

    scraped_at: new Date().toISOString(),

    products: window.output

};

    // ============================================================
    // PRODUCT DEDUPLICATION KEY
    // ============================================================

    function getProductKey(product) {

        // Product code is preferred.

        if (product.product_id) {

            return `id:${product.product_id}`;

        }


        // Fallback to normalized product name.

        if (product.name) {

            return (
                `name:${
                    product.name
                        .trim()
                        .toLowerCase()
                }`
            );

        }


        return null;

    }


    // ============================================================
    // PROCESS PRODUCTS
    // ============================================================

    function processProducts(products) {

        let added = 0;

        let duplicates = 0;

        let skipped = 0;


        for (const product of products) {

            const normalized =
                normalizeProduct(product);


            const key =
                getProductKey(normalized);


            if (!key) {

                skipped++;

                continue;

            }


            if (
                seenProducts.has(key)
            ) {

                duplicates++;

                continue;

            }


            seenProducts.add(
                key
            );


            allProducts.push(
                normalized
            );


            added++;

        }


        return {

            added,

            duplicates,

            skipped

        };

    }




    


    // ============================================================
    // UPDATE LIVE BACKUP
    // ============================================================

    function updateBackup(page) {

        window.__AJIO_PRODUCTS__ =
            [...allProducts];


        window.__AJIO_LAST_PAGE__ =
            page;


        lastCompletedPage =
            page;

    }


    // ============================================================
    // MAIN SCRAPER
    // ============================================================

    try {

        // ========================================================
        // FETCH FIRST PAGE
        // ========================================================

        console.log(
            "========================================"
        );


        console.log(
            "AJIO SCRAPER STARTED"
        );


        console.log(
            "========================================"
        );


        const firstPage =
            await fetchPage(0);


        // ========================================================
        // DEBUG API STRUCTURE
        // ========================================================

        console.log(
            "AJIO API top-level keys:",
            Object.keys(firstPage)
        );


        // ========================================================
        // FIND PRODUCTS
        // ========================================================

        const firstProducts =

            firstPage.products ||

            firstPage.results?.products ||

            firstPage.data?.products ||

            [];


        // ========================================================
        // PAGINATION
        // ========================================================

        const totalPages =

            firstPage.pagination?.totalPages ??

            firstPage.totalPages ??

            1;


        const totalResults =

            firstPage.pagination?.totalResults ??

            firstPage.pagination?.totalNumberOfResults ??

            firstPage.totalResults ??

            null;


        console.log(
            "========================================"
        );


        console.log(
            `Total Pages: ${totalPages}`
        );


        console.log(
            `Total Results: ${totalResults ?? "Unknown"}`
        );


        console.log(
            `First Page Products: ${firstProducts.length}`
        );


        console.log(
            "========================================"
        );


        // ========================================================
        // PROCESS FIRST PAGE
        // ========================================================

        const firstStats =
            processProducts(
                firstProducts
            );


        updateBackup(1);
        updateProgress({ stage: "Collecting Products", current: 1, total: totalPages });


        console.log(
            `Page 1/${totalPages}`
        );


        console.log(
            `Added: ${firstStats.added}`
        );


        console.log(
            `Duplicates: ${firstStats.duplicates}`
        );


        console.log(
            `Skipped: ${firstStats.skipped}`
        );


        console.log(
            `Total Unique: ${allProducts.length}`
        );


        // ========================================================
        // FETCH REMAINING PAGES
        // ========================================================

        for (
            let page = 1;
            page < totalPages;
            page++
        ) {

            const delay =
                randomDelay();


            console.log(
                `Waiting ${delay}ms before Page ${page + 1}...`
            );


            await sleep(
                delay
            );


            let data;


            try {

                data =
                    await fetchPage(
                        page
                    );

            }

            catch (error) {

                console.error(
                    `FAILED ON PAGE ${page + 1}`,
                    error
                );


                window.__AJIO_SCRAPER_ERROR__ =
                    String(error);


                console.log(
                    "Stopping pagination."
                );


                console.log(
                    `Products safely collected: ${allProducts.length}`
                );


                break;

            }


            // ====================================================
            // FIND PRODUCTS
            // ====================================================

            const products =

                data.products ||

                data.results?.products ||

                data.data?.products ||

                [];


            console.log(
                `Page ${page + 1} returned ${products.length} products`
            );


            // ====================================================
            // EMPTY PAGE SAFETY
            // ====================================================

            if (
                products.length === 0
            ) {

                console.warn(
                    `Page ${page + 1} returned no products.`
                );


                console.warn(
                    "Stopping scraper to avoid unnecessary requests."
                );


                break;

            }


            // ====================================================
            // PROCESS PRODUCTS
            // ====================================================

            const stats =
                processProducts(
                    products
                );


            // ====================================================
            // LIVE BACKUP
            // ====================================================

            updateBackup(
                page + 1
            );
            updateProgress({ stage: "Collecting Products", current: page + 1, total: totalPages });


            // ====================================================
            // PROGRESS
            // ====================================================

            console.log(
                "--------------------------------"
            );


            console.log(
                `Page: ${page + 1}/${totalPages}`
            );


            console.log(
                `Products returned: ${products.length}`
            );


            console.log(
                `Added: ${stats.added}`
            );


            console.log(
                `Duplicates: ${stats.duplicates}`
            );


            console.log(
                `Skipped: ${stats.skipped}`
            );


            console.log(
                `Total unique products: ${allProducts.length}`
            );


            console.log(
                "--------------------------------"
            );

        }

    }

    catch (error) {

        console.error(
            "AJIO SCRAPER FAILED:",
            error
        );


        window.__AJIO_SCRAPER_ERROR__ =
            String(error);

    }


    // ============================================================
    // FINAL BACKUP
    // ============================================================

    window.__AJIO_PRODUCTS__ =
        [...allProducts];


    window.__AJIO_LAST_PAGE__ =
        lastCompletedPage;


    window.__AJIO_SCRAPER_DONE__ =
        true;
    updateProgress({ stage: "Completed", current: lastCompletedPage, total: lastCompletedPage || 1 });


    // ============================================================
    // FINAL STATS
    // ============================================================

    console.log(
        "========================================"
    );


    console.log(
        "AJIO SCRAPING FINISHED"
    );


    console.log(
        `Last Completed Page: ${lastCompletedPage}`
    );


    console.log(
        `Total Unique Products: ${allProducts.length}`
    );


    if (
        window.__AJIO_SCRAPER_ERROR__
    ) {

        console.warn(
            "Scraper finished with an error:"
        );


        console.warn(
            window.__AJIO_SCRAPER_ERROR__
        );

    }


    console.log(
        "Backup:"
    );


    console.log(
        "window.__AJIO_PRODUCTS__"
    );


    console.log(
        "========================================"
    );


    // ============================================================
    // DOWNLOAD FUNCTION
    // ============================================================

    window.downloadAjioJSON =
        function () {


            const products =
                window.__AJIO_PRODUCTS__ ||
                [];


            const output = {

    schema_version: 1,

    source: "ajio",

    scrape_date: new Date().toISOString().slice(0,10),

    scraped_at: new Date().toISOString(),

    products: products

};

const json =
JSON.stringify(output,null,2);

            const blob =
                new Blob(
                    [json],
                    {
                        type:
                            "application/json"
                    }
                );


            const blobUrl =
                URL.createObjectURL(
                    blob
                );


            const a =
                document.createElement(
                    "a"
                );


            a.href =
                blobUrl;


            a.download =
                `ajio_columbia_products_${products.length}.json`;


            a.style.display =
                "none";


            document.body.appendChild(
                a
            );


            a.click();


            a.remove();


            setTimeout(
                () => {

                    URL.revokeObjectURL(
                        blobUrl
                    );

                },

                5000

            );


            console.log(
                `Download triggered: ${products.length} products`
            );

        };


    console.log(
        "To manually download JSON, run:"
    );


    console.log(
        "downloadAjioJSON()"
    );

})();
