(async () => {

const TOKEN = "23fa3b40e0a46129e1b0cfaff2262c99";

const ENDPOINT =
"https://columbia-sportswear-india.myshopify.com/api/2025-07/graphql.json";

const QUERY = `
query GetProducts($first:Int!, $after:String){

  search(
    query:"tag:*"
    types:PRODUCT
    first:$first
    after:$after
  ){

    edges{

      cursor

      node{

        ... on Product{

          id
          title

            handle
            featuredImage{
            url
            }

          variants(first:100){

            edges{

              node{

                sku
                barcode
                availableForSale
                
                price{
                  amount
                }

                compareAtPrice{
                  amount
                }

              }

            }

          }

        }

      }

    }

    pageInfo{
      hasNextPage
      endCursor
    }

  }

}
`;

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

const page = 1;
console.log(`Fetching Page ${page} (single page fetch)...`);
window.updateProgress({ stage: "Collecting Products", current: 1, total: 1 });

const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": TOKEN
    },
    body: JSON.stringify({
        query: QUERY,
        variables: {
            first: 250,
            after: null
        }
    })
});

const json = await response.json();
if (json.errors) {
    console.error(json.errors);
} else {
    const search = json.data?.search;
    for (const edge of (search?.edges || [])) {
        const product = edge.node;
        for (const { node } of (product.variants?.edges || [])) {
            window.output.push({
                source: "columbia",
                product_id: product.id.split("/").pop(),
                sku: node.sku,
                ean: node.barcode,
                available: node.availableForSale,
                title: product.title,
                price: Number(node.price?.amount || 0),
                mrp: node.compareAtPrice
                    ? Number(node.compareAtPrice.amount)
                    : Number(node.price?.amount || 0),
                image_url: product.featuredImage?.url || "",
                url: "https://www.columbiasportswear.co.in/products/" + product.handle
            });
        }
    }
}

console.log(`Collected ${window.output.length} products`);
console.log("Done!");
console.log(window.output);
console.log("Total SKUs:", window.output.length);
window.updateProgress({ stage: "Completed", current: 1, total: 1 });

// Download JSON

const output = {

    schema_version: 1,

    source: "columbia",

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
a.download = "columbia_products.json";

document.body.appendChild(a);

a.click();

document.body.removeChild(a);

URL.revokeObjectURL(url);

console.log("Download Complete!");
setTimeout(() => { try { window.close(); } catch (_) {} }, 1500);

})();
