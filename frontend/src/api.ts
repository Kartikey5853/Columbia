import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:8000"
});

export async function scrapeProductsStream(files, options, handlers) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  formData.append("show_process", String(Boolean(options?.showProcess)));
  formData.append("disable_google", String(Boolean(options?.disableGoogle)));

  const response = await fetch("http://localhost:8000/scrape-products-stream", {
    method: "POST",
    body: formData
  });

  if (!response.ok || !response.body) {
    throw new Error("Scrape request failed. Try again.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      if (!rawEvent) {
        continue;
      }

      let eventName = "message";
      const dataLines = [];
      rawEvent.split(/\r?\n/).forEach((line) => {
        if (line.startsWith("event:")) {
          eventName = line.replace("event:", "").trim();
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.replace("data:", "").trim());
        }
      });

      if (!dataLines.length) {
        continue;
      }

      try {
        const payload = JSON.parse(dataLines.join("\n"));
        if (eventName === "result") {
          handlers?.onResult?.(payload);
        }
        if (eventName === "error") {
          handlers?.onError?.(payload);
        }
        if (eventName === "done") {
          handlers?.onDone?.(payload);
        }
      } catch (err) {
        handlers?.onError?.({ error: "Failed to parse stream." });
      }
    }
  }
}

export async function openGoogleProfile() {
  const response = await api.post("/open-profile");
  return response.data;
}

export async function startAmazonScrape() {
  const response = await api.post("/start-amazon-scrape");
  return response.data;
}

export async function startAmazonScrapeWithParams(params) {
  const response = await api.post("/start-amazon-scrape", null, { params });
  return response.data;
}

export async function startMyntraScrape() {
  const response = await api.post("/start-myntra-scrape");
  return response.data;
}

export async function startMyntraScrapeWithParams(params) {
  const response = await api.post("/start-myntra-scrape", null, { params });
  return response.data;
}

export async function startAjioScrape() {
  const response = await api.post("/start-ajio-scrape");
  return response.data;
}

export async function startTatacliqScrape() {
  const response = await api.post("/start-tatacliq-scrape");
  return response.data;
}

export async function startTatacliqScrapeWithParams(params) {
  const response = await api.post("/start-tatacliq-scrape", null, { params });
  return response.data;
}

export async function fetchScraperStatus(lines = 120) {
  const response = await api.get(`/scraper-status?lines=${lines}`);
  return response.data;
}

export async function fetchIndexFiles() {
  const response = await api.get("/index-files");
  return response.data;
}

export async function buildIndex(platform) {
  const response = await api.post(`/build-index/${platform}`);
  return response.data;
}

export function getIndexFileUrl(platform, fileType) {
  return `http://localhost:8000/index-file/${platform}?file_type=${fileType}`;
}

export async function uploadIndexFile(platform, fileType, file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(
    `/index-file/${platform}?file_type=${fileType}`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return response.data;
}

export async function fetchProductFromUrl(platform, url) {
  const response = await api.post("/product-from-url", { platform, url });
  return response.data;
}

export async function fetchProductFromImagePlatform(file, platform, options = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("platform", platform);
  formData.append("show_process", String(Boolean(options.showProcess)));
  formData.append("top_n", String(options.topN || 20));

  const response = await api.post("/product-from-image-platform", formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return response.data;
}

export async function exactSearch(identifiers) {
  const response = await api.post("/exact-search", { identifiers });
  return response.data;
}

export async function uploadMasterExcel(file) {
  const form = new FormData(); form.append("file", file);
  const response = await api.post("/master-upload", form);
  return response.data;
}
export async function fetchMasterJson() { return (await api.get("/master-json")).data; }
export async function rebuildTuples() { return (await api.post("/rebuild-tuples")).data; }
export async function fetchRebuildProgress() { return (await api.get("/rebuild-progress")).data; }
export async function startFastScrapers(sites, options = {}) { return (await api.post("/scrapers/start", { sites, ...options })).data; }
export async function openScraperProfile() { return (await api.post("/scrapers/profile")).data; }
export async function fetchFastScraperStatus() { return (await api.get("/scrapers/status")).data; }
export function getTuplesExportUrl() { return "http://localhost:8000/tuples-export"; }
export async function downloadSearchExport(identifiers) {
  return api.post("/search-export", { identifiers }, { responseType: "blob" });
}
export async function fetchTuples() { return (await api.get("/tuples")).data; }
export async function fetchPriceHistory() { return (await api.get("/price-history")).data; }
export async function fetchDataFiles() { return (await api.get("/data-files")).data; }
export async function readDataFile(path) { return (await api.get("/data-files/" + path)).data; }
export async function deleteDataFile(path) { return (await api.delete("/data-files/" + path)).data; }
export async function openDataFolder() { return (await api.post("/data-folder/open")).data; }
export async function fetchAmazonSellers() { return (await api.get("/settings/amazon-sellers")).data; }
export async function saveAmazonSellers(sellers) { return (await api.put("/settings/amazon-sellers", { sellers })).data; }
