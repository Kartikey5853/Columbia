(async () => {

    // ============================================================
    // TATA CLIQ LUXURY - COLUMBIA SCRAPER
    //
    // Portable:
    //   - No cookies
    //   - No x-client-id
    //   - No x-cli-ubid
    //   - No MCVID
    //   - No session-specific values
    //
    // Pipeline:
    //   Lux Listing API
    //        ↓
    //   Product IDs / metadata
    //        ↓
    //   PDP HTML
    //        ↓
    //   variantOptions / sizeOptions
    //        ↓
    //   Final JSON
    // ============================================================


    // ============================================================
    // CONFIG
    // ============================================================

    const SEARCH_TEXT =
        "Columbia:relevance:list:listId_3b2c31cb7dc142898a1f01694ec87d79";

    const PAGE_SIZE = 24;

    const LISTING_RETRIES = 3;
    const PDP_RETRIES = 3;

    const CONCURRENCY = 5;

    const LISTING_DELAY_MIN = 1200;
    const LISTING_DELAY_MAX = 2500;

    const PDP_DELAY_MIN = 800;
    const PDP_DELAY_MAX = 1800;

    const PDP_RETRY_DELAY = 4000;


    // ============================================================
    // ENDPOINTS
    // ============================================================

    const LISTING_BASE =
        "https://cliqapi.tatacliq.com/cliq-api/v1/lux/search";


    const PDP_BASE =
        "https://luxury.tatacliq.com";


    // ============================================================
    // HELPERS
    // ============================================================

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));


    const randomDelay = (min, max) =>
        min + Math.floor(Math.random() * (max - min + 1));


    const absoluteUrl = value => {

        if (!value)
            return "";

        if (value.startsWith("http://"))
            return value;

        if (value.startsWith("https://"))
            return value;

        if (value.startsWith("//"))
            return "https:" + value;

        if (value.startsWith("/"))
            return PDP_BASE + value;

        return PDP_BASE + "/" + value;

    };


    const safeNumber = value => {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return 0;
        }

        if (typeof value === "number")
            return Number.isFinite(value) ? value : 0;

        const cleaned =
            String(value)
                .replace(/[^0-9.-]/g, "");

        const number =
            Number(cleaned);

        return Number.isFinite(number)
            ? number
            : 0;
    };


    // ============================================================
    // PROGRESS
    // ============================================================

    const progressStartedAt = Date.now();


    window.updateProgress = function (progress) {

        const current =
            Number(progress.current || 0);

        const total =
            Number(progress.total || 0);

        const elapsedSeconds =
            Math.max(
                0,
                (Date.now() - progressStartedAt) / 1000
            );

        const etaSeconds =
            current > 0 && total > current
                ? Math.round(
                    (elapsedSeconds / current) *
                    (total - current)
                )
                : 0;

        const payload = {

            ...progress,

            current,

            total,

            elapsed_seconds:
                Math.round(elapsedSeconds),

            eta_seconds:
                etaSeconds,

            updated_at:
                new Date().toISOString()
        };


        window.__SCRAPER_PROGRESS__ =
            payload;

        if (typeof window.updateScraperProgress === "function") {
            try {
                window.updateScraperProgress(payload);
            } catch (_) {}
        }
    };


    // ============================================================
    // BUILD LISTING URL
    // ============================================================

    function buildListingUrl(page) {

        const params =
            new URLSearchParams({

                pageSize:
                    String(PAGE_SIZE),

                isTextSearch:
                    "false",

                isFilter:
                    "false",

                isPwa:
                    "true",

                channel:
                    "web",

                typeID:
                    "all",

                page:
                    String(page),

                searchText:
                    SEARCH_TEXT,

                isSortFlow:
                    "false",

                isSuggested:
                    "false",

                isMDE:
                    "true",

                test:
                    "es.template.binning.qpsv4",

                qc:
                    "false",

                isKeywordRedirect:
                    "false",

                isKeywordRedirectEnabled:
                    "false",

                isFilterDataRequired:
                    "false",

                ad:
                    "true"

            });


        return `${LISTING_BASE}?${params}`;
    }


    // ============================================================
    // FETCH LISTING PAGE
    // ============================================================

    async function fetchListingPage(page) {

        const url =
            buildListingUrl(page);


        const response =
            await fetch(url, {

                method: "GET",

                credentials: "omit",

                headers: {

                    "appplatform":
                        "web",

                    "appversion":
                        "v1",

                    "x-provider-id":
                        "cliq-search",

                    "Accept":
                        "application/json"

                }

            });


        if (!response.ok) {

            throw new Error(
                `Listing HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        if (
            data?.status &&
            String(data.status).toLowerCase() !== "success"
        ) {

            throw new Error(
                `Listing API status: ${data.status}`
            );

        }


        if (!Array.isArray(data.searchresult)) {

            throw new Error(
                "Listing response contains no searchresult array"
            );

        }


        return data;
    }


    // ============================================================
    // FETCH LISTING PAGE WITH RETRIES
    // ============================================================

    async function fetchListingWithRetry(page) {

        let lastError =
            null;


        for (
            let attempt = 1;
            attempt <= LISTING_RETRIES;
            attempt++
        ) {

            try {

                console.log(
                    `Listing page ${page + 1} | Attempt ${attempt}`
                );


                const data =
                    await fetchListingPage(page);


                return data;

            }
            catch (error) {

                lastError =
                    error;


                console.warn(
                    `Listing page ${page + 1} failed:`,
                    error.message
                );


                if (
                    attempt <
                    LISTING_RETRIES
                ) {

                    await sleep(
                        PDP_RETRY_DELAY
                    );

                }

            }

        }


        throw lastError ||
            new Error(
                `Listing page ${page + 1} failed`
            );

    }


    // ============================================================
    // NORMALIZE LISTING PRODUCT
    // ============================================================

    function normalizeProduct(p) {

        return {

            source:
                "tatacliq",

            product_id:
                String(
                    p?.productId || ""
                ),

            sku:
                "",

            ean:
                "",

            available:
                !!p?.inStockFlag,

            title:
                p?.productname || "",

            brand:
                p?.brandname || "",

            price:
                safeNumber(
                    p?.price?.sellingPrice
                ),

            mrp:
                safeNumber(
                    p?.price?.mrpPrice
                ) ||
                safeNumber(
                    p?.price?.sellingPrice
                ),

            image_url:
                absoluteUrl(
                    p?.imageURL || ""
                ),

            url:
                absoluteUrl(
                    p?.webURL || ""
                ),

            variants:
                [],

            scraped_at:
                new Date().toISOString()

        };

    }


    // ============================================================
    // PDP URL
    // ============================================================

    function buildPdpUrl(product) {

        if (
            product?.url
        ) {

            return product.url;

        }


        if (
            product?.product_id
        ) {

            return `${PDP_BASE}/p-${product.product_id.toLowerCase()}`;

        }


        return "";

    }


    // ============================================================
    // FETCH PDP HTML
    // ============================================================

    async function fetchPdpHtml(product) {

        const url =
            buildPdpUrl(product);


        if (!url) {

            throw new Error(
                "No PDP URL"
            );

        }


        const response =
            await fetch(url, {

                method: "GET",

                credentials: "omit",

                headers: {

                    "Accept":
                        "text/html,application/xhtml+xml"

                }

            });


        if (!response.ok) {

            throw new Error(
                `PDP HTTP ${response.status}`
            );

        }


        const html =
            await response.text();


        if (!html || html.length < 1000) {

            throw new Error(
                `PDP HTML too small: ${html.length}`
            );

        }


        return html;

    }


    // ============================================================
    // EXTRACT JSON OBJECT FROM HTML
    //
    // Tata Lux embeds the product object directly into the PDP
    // HTML. We locate "variantOptions" and walk backwards/
    // forwards through the JSON text rather than depending on
    // a particular script tag or webpack variable name.
    // ============================================================

    function extractJsonContainingVariantOptions(html) {

        const key =
            '"variantOptions"';


        const variantIndex =
            html.indexOf(key);


        if (
            variantIndex === -1
        ) {

            return null;

        }


        /*
         * Find candidate JSON object starts before variantOptions.
         *
         * We try progressively farther backwards because the exact
         * surrounding HTML structure can change.
         */

        const MAX_BACKTRACK =
            200000;


        const startLimit =
            Math.max(
                0,
                variantIndex - MAX_BACKTRACK
            );


        let depth = 0;

        let inString = false;

        let escaped = false;

        let objectStart = -1;


        /*
         * Scan backwards looking for a { that can contain the
         * variantOptions property.
         *
         * This is deliberately conservative. Once a possible {
         * is found, we use the forward balanced parser below.
         */

        for (
            let i = variantIndex;
            i >= startLimit;
            i--
        ) {

            const char =
                html[i];


            if (
                char === "}"
            ) {

                depth++;

                continue;

            }


            if (
                char === "{"
            ) {

                if (
                    depth > 0
                ) {

                    depth--;

                    continue;

                }


                objectStart =
                    i;

                break;

            }

        }


        /*
         * The simple reverse-depth search above can fail when the
         * preceding content contains strings/braces. Therefore we
         * also try several nearby { positions using a balanced
         * forward parser.
         */

        const candidateStarts = [];


        if (
            objectStart !== -1
        ) {

            candidateStarts.push(
                objectStart
            );

        }


        for (
            let i = variantIndex - 1;
            i >= startLimit &&
            candidateStarts.length < 100;
            i--
        ) {

            if (
                html[i] === "{"
            ) {

                candidateStarts.push(i);

            }

        }


        for (
            const start of candidateStarts
        ) {

            let depthCount = 0;

            let stringMode = false;

            let escapeMode = false;


            for (
                let i = start;
                i < html.length;
                i++
            ) {

                const char =
                    html[i];


                if (stringMode) {

                    if (escapeMode) {

                        escapeMode =
                            false;

                        continue;

                    }


                    if (
                        char === "\\"
                    ) {

                        escapeMode =
                            true;

                        continue;

                    }


                    if (
                        char === '"'
                    ) {

                        stringMode =
                            false;

                    }


                    continue;

                }


                if (
                    char === '"'
                ) {

                    stringMode =
                        true;

                    continue;

                }


                if (
                    char === "{"
                ) {

                    depthCount++;

                }
                else if (
                    char === "}"
                ) {

                    depthCount--;


                    if (
                        depthCount === 0
                    ) {

                        const candidate =
                            html.slice(
                                start,
                                i + 1
                            );


                        if (
                            candidate.includes(
                                '"variantOptions"'
                            )
                        ) {

                            try {

                                const parsed =
                                    JSON.parse(
                                        candidate
                                    );


                                if (
                                    parsed?.variantOptions ||
                                    parsed?.variantGroup
                                ) {

                                    return parsed;

                                }

                            }
                            catch (_) {

                                // Keep trying other candidates.

                            }

                        }


                        break;

                    }

                }

            }

        }


        return null;

    }


    // ============================================================
    // GENERIC FALLBACK:
    // FIND VARIANT ARRAYS DIRECTLY
    //
    // This exists because the PDP HTML structure can change while
    // the actual variantOptions structure remains stable.
    // ============================================================

    function extractVariantOptionsFallback(html) {

        const marker =
            '"variantOptions":[';


        const index =
            html.indexOf(marker);


        if (
            index === -1
        ) {

            return [];

        }


        const arrayStart =
            index +
            '"variantOptions":'.length;


        let depth =
            0;

        let inString =
            false;

        let escaped =
            false;


        for (
            let i = arrayStart;
            i < html.length;
            i++
        ) {

            const char =
                html[i];


            if (inString) {

                if (escaped) {

                    escaped =
                        false;

                }
                else if (
                    char === "\\"
                ) {

                    escaped =
                        true;

                }
                else if (
                    char === '"'
                ) {

                    inString =
                        false;

                }

                continue;

            }


            if (
                char === '"'
            ) {

                inString =
                    true;

                continue;

            }


            if (
                char === "["
            ) {

                depth++;

            }
            else if (
                char === "]"
            ) {

                depth--;


                if (
                    depth === 0
                ) {

                    const raw =
                        html.slice(
                            arrayStart,
                            i + 1
                        );


                    try {

                        return JSON.parse(
                            raw
                        );

                    }
                    catch (_) {

                        return [];

                    }

                }

            }

        }


        return [];

    }


    // ============================================================
    // PARSE VARIANTS
    // ============================================================

    function parseVariants(html) {

        /*
         * Preferred:
         * Parse the complete embedded product JSON.
         */

        const productObject =
            extractJsonContainingVariantOptions(
                html
            );


        let rawVariants =
            [];


        if (
            Array.isArray(
                productObject?.variantOptions
            )
        ) {

            rawVariants =
                productObject.variantOptions;

        }


        /*
         * Fallback:
         * Directly extract variantOptions array.
         */

        if (
            rawVariants.length === 0
        ) {

            rawVariants =
                extractVariantOptionsFallback(
                    html
                );

        }


        /*
         * If variantOptions isn't available, use variantGroup.
         */

        if (
            rawVariants.length === 0 &&
            Array.isArray(
                productObject?.variantGroup
            )
        ) {

            const flattened = [];


            for (
                const group
                of productObject.variantGroup
            ) {

                const sizes =
                    Array.isArray(
                        group?.sizeOptions
                    )
                        ? group.sizeOptions
                        : [];


                for (
                    const size
                    of sizes
                ) {

                    flattened.push({

                        colorlink:
                            group.colorLink || {},

                        sizelink:
                            size

                    });

                }

            }


            rawVariants =
                flattened;

        }


        /*
         * Normalize variants.
         */

        const variants = [];


        for (
            const variant
            of rawVariants
        ) {

            const sizeLink =
                variant?.sizelink ||
                variant?.sizeLink ||
                variant ||
                {};


            const colorLink =
                variant?.colorlink ||
                variant?.colorLink ||
                {};


            const sku =
                String(
                    sizeLink?.productCode ||
                    ""
                );


            const size =
                sizeLink?.size ||
                sizeLink?.brandSize ||
                "";


            const url =
                absoluteUrl(
                    sizeLink?.url ||
                    colorLink?.colorurl ||
                    ""
                );


            /*
             * Avoid completely empty garbage entries.
             */

            if (
                !sku &&
                !size &&
                !url
            ) {

                continue;

            }


            variants.push({

                size:
                    String(size),

                sku:

                    sku,

                available:
                    !!sizeLink?.isAvailable,

                stock:
                    safeNumber(
                        sizeLink?.stockCount
                    ),

                url:
                    url

            });

        }


        /*
         * Deduplicate variants by SKU first, then URL/size.
         */

        const seen =
            new Set();


        return variants.filter(
            variant => {

                const key =
                    variant.sku ||
                    `${variant.size}|${variant.url}`;


                if (
                    seen.has(key)
                ) {

                    return false;

                }


                seen.add(key);

                return true;

            }
        );

    }


    // ============================================================
    // FETCH + PARSE ONE PDP
    // ============================================================

    async function scrapePdp(product) {

        let lastError =
            null;


        for (
            let attempt = 1;
            attempt <= PDP_RETRIES;
            attempt++
        ) {

            try {

                const html =
                    await fetchPdpHtml(
                        product
                    );


                const variants =
                    parseVariants(
                        html
                    );


                if (
                    variants.length === 0
                ) {

                    /*
                     * Don't immediately call this a hard failure.
                     *
                     * Some products genuinely have no size variants.
                     * But we check whether the HTML actually contains
                     * variant markers before deciding.
                     */

                    const hasVariantMarkers =
                        html.includes(
                            '"variantOptions"'
                        ) ||
                        html.includes(
                            '"variantGroup"'
                        ) ||
                        html.includes(
                            '"sizeOptions"'
                        );


                    if (
                        hasVariantMarkers
                    ) {

                        throw new Error(
                            "Variant data found but could not be parsed"
                        );

                    }

                }


                return {

                    variants,

                    htmlLength:
                        html.length

                };

            }
            catch (error) {

                lastError =
                    error;


                console.warn(
                    `PDP failed ${product.product_id} | Attempt ${attempt}:`,
                    error.message
                );


                if (
                    attempt <
                    PDP_RETRIES
                ) {

                    await sleep(
                        PDP_RETRY_DELAY
                    );

                }

            }

        }


        throw lastError ||
            new Error(
                "PDP scraping failed"
            );

    }


    // ============================================================
    // STORAGE
    // ============================================================

    const products = [];

    const productIds =
        new Set();


    let listingFailedPages = [];

    let failedPdpProducts = [];

    let totalVariants = 0;


    // ============================================================
    // START
    // ============================================================

    console.clear();

    console.log("");
    console.log("==============================================");
    console.log(" TATA CLIQ LUXURY - COLUMBIA SCRAPER");
    console.log("==============================================");
    console.log("");
    console.log("Listing API : Lux Search");
    console.log("PDP source  : PDP HTML");
    console.log("Concurrency : " + CONCURRENCY);
    console.log("");
    console.log("Starting...");
    console.log("");


    // ============================================================
    // FIRST LISTING PAGE
    // ============================================================

    let first;


    try {

        first =
            await fetchListingWithRetry(
                0
            );

    }
    catch (error) {

        console.error(
            "FATAL: Could not fetch first listing page.",
            error
        );

        return;

    }


    const pagination =
        first.pagination || {};


    const totalPages =
        Number(
            pagination.totalPages || 0
        );


    const totalResults =
        Number(
            pagination.totalResults || 0
        );


    console.log(
        `Found ${totalResults} products across ${totalPages} pages`
    );


    if (
        totalPages <= 0
    ) {

        console.error(
            "FATAL: API returned no pages."
        );

        return;

    }


    // ============================================================
    // PROCESS FIRST PAGE
    // ============================================================

    function addListingProducts(items) {

        if (
            !Array.isArray(items)
        ) {

            return;

        }


        for (
            const rawProduct
            of items
        ) {

            const product =
                normalizeProduct(
                    rawProduct
                );


            if (
                !product.product_id
            ) {

                continue;

            }


            if (
                productIds.has(
                    product.product_id
                )
            ) {

                continue;

            }


            productIds.add(
                product.product_id
            );


            products.push(
                product
            );

        }

    }


    addListingProducts(
        first.searchresult
    );


    updateProgress({

        stage:
            "Collecting Products",

        current:
            1,

        total:
            totalPages,

        products:
            products.length

    });


    console.log(
        `Page 1/${totalPages} | Products: ${products.length}`
    );


    // ============================================================
    // REMAINING LISTING PAGES
    // ============================================================

    for (
        let page = 1;
        page < totalPages;
        page++
    ) {

        try {

            const data =
                await fetchListingWithRetry(
                    page
                );


            addListingProducts(
                data.searchresult
            );


            console.log(
                `Page ${page + 1}/${totalPages} | Products: ${products.length}`
            );


            updateProgress({

                stage:
                    "Collecting Products",

                current:
                    page + 1,

                total:
                    totalPages,

                products:
                    products.length

            });

        }
        catch (error) {

            console.error(
                `SKIPPED LISTING PAGE ${page + 1}:`,
                error.message
            );


            listingFailedPages.push(
                page
            );

        }


        await sleep(
            randomDelay(
                LISTING_DELAY_MIN,
                LISTING_DELAY_MAX
            )
        );

    }


    // ============================================================
    // LISTING COMPLETE
    // ============================================================

    console.log("");
    console.log("----------------------------------------------");
    console.log("LISTING COLLECTION COMPLETE");
    console.log("----------------------------------------------");
    console.log(
        `Expected products : ${totalResults}`
    );
    console.log(
        `Collected products: ${products.length}`
    );
    console.log(
        `Missing products  : ${Math.max(0, totalResults - products.length)}`
    );
    console.log(
        `Failed pages      : ${listingFailedPages.length}`
    );
    console.log("----------------------------------------------");
    console.log("");


    if (
        listingFailedPages.length
    ) {

        console.warn(
            "Failed listing pages:",
            listingFailedPages.map(
                p => p + 1
            )
        );

    }


    // ============================================================
    // PDP WORKERS
    // ============================================================

    let nextIndex = 0;

    let completed =
        0;


    async function worker(workerId) {

        while (true) {

            const index =
                nextIndex++;


            if (
                index >= products.length
            ) {

                break;

            }


            const product =
                products[index];


            try {

                const result =
                    await scrapePdp(
                        product
                    );


                product.variants =
                    result.variants;


                product.pdp_html_length =
                    result.htmlLength;


                totalVariants +=
                    result.variants.length;

            }
            catch (error) {

                product.variants =
                    [];

                product.variant_error =
                    error.message;


                failedPdpProducts.push(
                    product.product_id
                );

            }


            completed++;


            const average =
                totalVariants /
                Math.max(
                    completed,
                    1
                );


            updateProgress({

                stage:
                    "Collecting Variants",

                current:
                    completed,

                total:
                    products.length,

                total_variants:
                    totalVariants,

                failed_products:
                    failedPdpProducts.length

            });


            console.log(
                `[Worker ${workerId}] ` +
                `${completed}/${products.length}` +
                ` | ${product.product_id}` +
                ` | Variants: ${product.variants.length}` +
                ` | Total: ${totalVariants}` +
                ` | Avg: ${average.toFixed(2)}` +
                ` | Failed: ${failedPdpProducts.length}`
            );


            if (
                completed % 100 === 0 ||
                completed === products.length
            ) {

                console.log("");
                console.log("----------------------------------------------");
                console.log(
                    `CHECKPOINT ${completed}/${products.length}`
                );
                console.log(
                    `Variants : ${totalVariants}`
                );
                console.log(
                    `Average  : ${average.toFixed(2)}`
                );
                console.log(
                    `Failed   : ${failedPdpProducts.length}`
                );
                console.log("----------------------------------------------");
                console.log("");

            }


            await sleep(
                randomDelay(
                    PDP_DELAY_MIN,
                    PDP_DELAY_MAX
                )
            );

        }

    }


    // ============================================================
    // START PDP STAGE
    // ============================================================

    console.log("");
    console.log("==============================================");
    console.log(
        `FETCHING PDPs USING ${CONCURRENCY} WORKERS`
    );
    console.log("==============================================");
    console.log("");


    updateProgress({

        stage:
            "Collecting Variants",

        current:
            0,

        total:
            products.length,

        total_variants:
            0,

        failed_products:
            0

    });


    await Promise.all(

        Array.from(
            {
                length:
                    CONCURRENCY
            },
            (_, i) =>
                worker(i + 1)
        )

    );


    // ============================================================
    // FINAL VALIDATION
    // ============================================================

    const productsWithVariants =
        products.filter(
            p =>
                Array.isArray(p.variants) &&
                p.variants.length > 0
        ).length;


    const productsWithoutVariants =
        products.length -
        productsWithVariants;


    const productsWithErrors =
        products.filter(
            p =>
                !!p.variant_error
        ).length;


    const averageVariants =
        totalVariants /
        Math.max(
            products.length,
            1
        );


    // ============================================================
    // OUTPUT
    // ============================================================

    const output = {

        schema_version:
            1,

        source:
            "tatacliq",

        brand:
            "Columbia",

        platform:
            "Tata Cliq Luxury",

        scrape_date:
            new Date()
                .toISOString()
                .slice(0, 10),

        scraped_at:
            new Date()
                .toISOString(),

        expected_products:
            totalResults,

        total_products:
            products.length,

        missing_products:
            Math.max(
                0,
                totalResults -
                products.length
            ),

        total_variants:
            totalVariants,

        average_variants_per_product:
            Number(
                averageVariants.toFixed(2)
            ),

        products_with_variants:
            productsWithVariants,

        products_without_variants:
            productsWithoutVariants,

        failed_pdp_products:
            productsWithErrors,

        failed_listing_pages:
            listingFailedPages.map(
                page =>
                    page + 1
            ),

        failed_product_ids:
            failedPdpProducts,

        products

    };


    // ============================================================
    // DOWNLOAD
    // ============================================================

    function downloadJSON(
        data,
        filename
    ) {

        const blob =
            new Blob(
                [
                    JSON.stringify(
                        data,
                        null,
                        2
                    )
                ],
                {
                    type:
                        "application/json"
                }
            );


        const url =
            URL.createObjectURL(
                blob
            );


        const a =
            document.createElement(
                "a"
            );


        a.href =
            url;

        a.download =
            filename;


        document.body.appendChild(
            a
        );


        a.click();


        document.body.removeChild(
            a
        );


        setTimeout(
            () =>
                URL.revokeObjectURL(
                    url
                ),
            1000
        );

    }


    // ============================================================
    // FINAL PROGRESS
    // ============================================================

    updateProgress({

        stage:
            "Completed",

        current:
            products.length,

        total:
            products.length,

        total_variants:
            totalVariants,

        failed_products:
            failedPdpProducts.length

    });


    // ============================================================
    // FINAL REPORT
    // ============================================================

    console.log("");
    console.log("");
    console.log("==============================================");
    console.log("              SCRAPE COMPLETE");
    console.log("==============================================");
    console.log("");
    console.log(
        `Expected Products       : ${totalResults}`
    );
    console.log(
        `Products Collected      : ${products.length}`
    );
    console.log(
        `Missing Products        : ${Math.max(0, totalResults - products.length)}`
    );
    console.log(
        `Total Variants          : ${totalVariants}`
    );
    console.log(
        `Average Variants/Product: ${averageVariants.toFixed(2)}`
    );
    console.log(
        `Products With Variants  : ${productsWithVariants}`
    );
    console.log(
        `Products Without       : ${productsWithoutVariants}`
    );
    console.log(
        `Failed PDPs             : ${productsWithErrors}`
    );
    console.log(
        `Failed Listing Pages   : ${listingFailedPages.length}`
    );
    console.log("");
    console.log("==============================================");
    console.log("");


    if (
        failedPdpProducts.length
    ) {

        console.warn(
            "Failed PDP product IDs:",
            failedPdpProducts
        );

    }


    if (
        listingFailedPages.length
    ) {

        console.warn(
            "Failed listing pages:",
            listingFailedPages.map(
                p => p + 1
            )
        );

    }


    window.__TATA_LUX_PRODUCTS__ = output;
    window.__TATA_LUX_SCRAPER_DONE__ = true;

    downloadJSON(
        output,
        "tata_lux_columbia_products.json"
    );


    console.log(
        "Downloaded:",
        "tata_lux_columbia_products.json"
    );


})();