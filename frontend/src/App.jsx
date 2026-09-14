import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  openGoogleProfile,
  scrapeProductsStream,
  startAmazonScrapeWithParams,
  startMyntraScrapeWithParams,
  startTatacliqScrapeWithParams,
  fetchScraperStatus,
  fetchIndexFiles,
  buildIndex,
  fetchProductFromUrl,
  fetchProductFromImagePlatform,
  getIndexFileUrl,
  uploadIndexFile,
  exactSearch,
  uploadMasterExcel,
  fetchMasterJson,
  rebuildTuples,
  startFastScrapers,
  openScraperProfile,
  fetchFastScraperStatus
  ,getTuplesExportUrl, downloadSearchExport, fetchTuples, fetchPriceHistory, fetchRebuildProgress, fetchDataFiles, deleteDataFile, openDataFolder, fetchAmazonSellers, saveAmazonSellers
} from "./api";

// ─── AJIO removed from platform order ───────────────────────────────────────
const PLATFORM_ORDER = ["amazon", "myntra", "tatacliq"];
const DASHBOARD_HISTORY_KEY = "columbia-search-history";

function readSearchHistory() {
  try {
    return JSON.parse(window.localStorage.getItem(DASHBOARD_HISTORY_KEY) || "[]");
  } catch (err) {
    return [];
  }
}

function writeSearchHistory(entry) {
  const next = [entry, ...readSearchHistory()].slice(0, 12);
  window.localStorage.setItem(DASHBOARD_HISTORY_KEY, JSON.stringify(next));
}

function buildHistoryEntry(results, imageCount, googleLens) {
  const clipMatches = results.reduce((sum, group) => sum + Object.keys(group.columbia_matches || {}).length, 0);
  const marketplaceMatches = results.reduce(
    (sum, group) => sum + (group.listings || []).filter((item) => item?.url).length,
    0
  );
  const validated = results.filter((group) => group.status !== "flagged").length;
  const timestamp = new Date().toISOString();

  return {
    id: timestamp,
    title: `${imageCount} image search`,
    images: imageCount,
    results: results.length,
    clipMatches,
    marketplaceMatches,
    validated,
    googleLens,
    timestamp
  };
}

function AppShell({ children }) {
  const [darkMode, setDarkMode] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="app-shell min-h-screen bg-app text-slate-950 transition-colors duration-500 dark:text-white">
      <div className="ambient-grid" />
      <nav className="sticky top-0 z-40 border-b border-slate-950/10 bg-white/75 backdrop-blur-2xl dark:border-white/10 dark:bg-[#070a12]/75">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 xl:px-8">
          <NavLink to="/" className="flex min-w-0 items-center gap-[18px]">
            <img src="/columbia-logo.png" alt="Columbia" className="h-12 w-[170px] shrink-0 object-cover object-center" />
            <span className="min-w-0 leading-none">
              <span className="mt-1 block text-[18px] font-semibold tracking-tight text-slate-900 dark:text-white"></span>
              <span className="mt-2 block text-[10px] uppercase tracking-[0.45em] text-slate-500 dark:text-white/45"></span>
            </span>
          </NavLink>

          <div className="hidden items-center rounded-full border border-slate-950/10 bg-slate-950/[0.03] p-1 text-sm font-medium text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 lg:flex">
            <NavItem to="/">Dashboard</NavItem>
            <NavItem to="/accurate-search">Search</NavItem>
            <NavItem to="/view-data">View Data</NavItem>
            <NavItem to="/scrapers">Scrapers</NavItem>
            <NavItem to="/analysis">Analysis</NavItem>
            <NavItem to="/improve">Improve Dataset</NavItem>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              className="icon-button"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {darkMode ? "☾" : "☼"}
            </button>
            <button type="button" className="icon-button hidden" aria-label="Settings" title="Settings">
              ⚙
            </button>
          </div>
        </div>
      </nav>
      <main key={location.pathname} className="page-transition">
        {children}
      </main>
    </div>
  );
}

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-4 py-2 transition ${
          isActive
            ? "bg-cyan-300 text-slate-950 shadow-sm"
            : "hover:bg-white/70 hover:text-slate-950 dark:hover:bg-white/10 dark:hover:text-white"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function GettingStartedPage() {
  const navigate = useNavigate();
  const steps = [
    { title: "Generate Master Dataset", path: "/improve", icon: "▦", description: "Upload your Excel file, generate the Master JSON, and inspect the generated data.", action: "Improve Dataset", details: ["Upload Excel file", "Generate Master JSON", "View generated JSON"] },
    { title: "Run Marketplace Scrapers", path: "/scrapers", icon: "↯", description: "Open Scrapers, choose your settings, and start all marketplaces from one control center.", action: "Open Scrapers", details: ["Click Start All", "Monitor each live log", "Wait for 100% and browser close"], badges: ["Tata Cliq · ~1 hour", "Amazon · seller dependent", "Ajio · 5–10 min", "Myntra · 5–10 min", "Columbia · 5–10 min", "Adventuras · 5–10 min"] },
    { title: "Run Dataset Pipeline", path: "/improve", icon: "⚙", description: "Return to Improve Dataset and run the processing pipeline after scraper outputs are ready.", action: "Open Pipeline", details: ["Start processing", "Allow time for large datasets", "Do not interrupt until complete"] },
    { title: "Verify Data", path: "/view-data", icon: "✓", description: "Confirm that products, SKU mappings, marketplace data, and images loaded correctly.", action: "View Data", details: ["Products loaded", "SKU mappings exist", "Marketplace data available", "Images accessible"] },
    { title: "Search Products", path: "/accurate-search", icon: "⌕", description: "Upload an image or search by SKU, EAN, or Product ID to review marketplace matches.", action: "Open Search", details: ["Upload an image", "Search SKU, EAN, or Product ID", "Review similarity results"] },
    { title: "Analyze Results", path: "/analysis", icon: "↗", description: "Review historical price changes, marketplace comparisons, differences, and trend graphs.", action: "Open Analysis", details: ["Historical price changes", "Price difference", "Marketplace comparison", "Price trend graphs"] }
  ];
  return <section className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 xl:px-8"><div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-soft sm:p-12"><p className="text-xs font-semibold uppercase tracking-[.32em] text-cyan-700">Columbia Visual Intelligence</p><h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">Getting started with your catalog workspace.</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-slate-500">Follow the workflow below to build a trusted dataset, collect marketplace data, and turn it into product and pricing insight.</p><button className="primary-button mt-8" onClick={() => navigate("/improve")}>Start Here · Improve Dataset</button></div><div className="mt-12"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.28em] text-cyan-700">Onboarding workflow</p><h2 className="mt-2 text-3xl font-semibold">Quick Start Guide</h2></div><span className="status-pill">6 steps</span></div><div className="relative mt-7 space-y-4 before:absolute before:bottom-8 before:left-6 before:top-8 before:w-px before:bg-slate-200 sm:before:left-8">{steps.map((step, index) => <article key={step.title} className="relative rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-lg sm:p-7"><div className="flex gap-4 sm:gap-6"><div className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-lg font-semibold text-white sm:h-16 sm:w-16"><span className="absolute -top-2 -left-2 rounded-full bg-cyan-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{index + 1}</span>{step.icon}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold text-slate-950 sm:text-2xl">{step.title}</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 sm:text-base">{step.description}</p></div><button className="secondary-button" onClick={() => navigate(step.path)}>{step.action} →</button></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{step.details.map(detail => <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600" key={detail}>• {detail}</div>)}</div>{step.badges && <div className="mt-4 flex flex-wrap gap-2">{step.badges.map(badge => <span className="rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-800" key={badge}>{badge}</span>)}</div>}</div></div></article>)}</div></div><div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900"><span className="font-semibold">Pipeline note:</span> processing can take time with large datasets and may appear unresponsive. Leave it running until it reports completion.</div></section>;
}

function EnterpriseDashboardPage() {
  const navigate = useNavigate();
  const steps = [["Configure scrapers", "Choose marketplaces, sellers, and concurrency.", "/scrapers"], ["Run scrapers", "Collect fresh marketplace listings and prices.", "/scrapers"], ["Improve dataset", "Import a master workbook and rebuild tuples.", "/improve"], ["Search products", "Find SKUs and EANs across the catalog.", "/accurate-search"], ["Analyze results", "Review price movement and marketplace changes.", "/analysis"]];
  const features = [["⌕", "Exact catalog search", "Resolve SKU and EAN identifiers across every marketplace."], ["◈", "Independent scrapers", "Monitor each source with live progress and dedicated logs."], ["↗", "Price intelligence", "Understand changes over time with interactive analytics."], ["▦", "Tuple workspace", "Compare normalized marketplace data in one place."]];
  return <section className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 xl:px-8"><div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-soft sm:p-12"><p className="text-xs font-semibold uppercase tracking-[.32em] text-cyan-700">Columbia Visual Intelligence</p><div className="mt-5 max-w-3xl"><h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">A focused workspace for marketplace intelligence.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-slate-500">Configure your sources, build a trusted catalog, and move from product lookup to pricing insight without leaving one calm workspace.</p><div className="mt-8 flex flex-wrap gap-3"><button className="primary-button" onClick={() => navigate("/scrapers")}>Configure workspace</button><button className="secondary-button" onClick={() => navigate("/accurate-search")}>Search catalog</button></div></div></div><div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_.9fr]"><section><div className="flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.24em] text-slate-400">Recommended workflow</p><h2 className="mt-2 text-2xl font-semibold">From source to insight</h2></div><span className="status-pill">5 steps</span></div><div className="mt-5 space-y-3">{steps.map(([title, description, path], index) => <button key={title} onClick={() => navigate(path)} className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-lg"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-950 text-sm font-semibold text-white">{index + 1}</span><span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{title}</span><span className="mt-1 block text-sm text-slate-500">{description}</span></span><span className="text-xl text-slate-300 transition group-hover:translate-x-1 group-hover:text-cyan-600">→</span></button>)}</div></section><section><p className="text-xs font-semibold uppercase tracking-[.24em] text-slate-400">Quick start</p><h2 className="mt-2 text-2xl font-semibold">Everything in one place</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{features.map(([icon, title, description]) => <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={title}><span className="text-2xl text-cyan-600">{icon}</span><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></div>)}</div></section></div><div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600"><span className="font-semibold text-slate-900">Tip:</span> Start with Scrapers, then rebuild tuples after your first marketplace run. Your workspace will keep progress and outputs organized automatically.</div></section>;
}

function GradientText({ children }) {
  return <span className="brand-gradient-text">{children}</span>;
}

function DashboardPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  const [platformStatus, setPlatformStatus] = useState({});

  useEffect(() => {
    let active = true;
    const loadLiveData = async () => {
      setHistory(readSearchHistory());
      try {
        const response = await fetchScraperStatus(40);
        if (active) {
          setPlatformStatus(response?.platforms || {});
        }
      } catch (err) {
        if (active) {
          setPlatformStatus({});
        }
      }
    };
    loadLiveData();
    const timer = window.setInterval(loadLiveData, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const dashboardStats = useMemo(() => {
    const totalSearches = history.length;
    const totalMatches = history.reduce((sum, item) => sum + (item.clipMatches || 0) + (item.marketplaceMatches || 0), 0);
    const totalImages = history.reduce((sum, item) => sum + (item.images || 0), 0);
    const validationTotal = history.reduce((sum, item) => sum + (item.results || 0), 0);
    const validationPassed = history.reduce((sum, item) => sum + (item.validated || 0), 0);
    const validationAccuracy = validationTotal ? `${Math.round((validationPassed / validationTotal) * 100)}%` : "N/A";

    return [
      ["Total Searches", String(totalSearches), "local runs"],
      ["Total Matches", String(totalMatches), "CLIP + marketplace"],
      ["Validation Accuracy", validationAccuracy, validationTotal ? "live result history" : "no runs yet"],
      ["Recent Uploads", String(totalImages), "from completed searches"]
    ];
  }, [history]);

  const livePlatforms = ["amazon", "myntra", "tatacliq"].map((platform) => ({
    platform,
    ...(platformStatus[platform] || {})
  }));
  const activeIndexers = livePlatforms.filter((item) => item.indexer_active).length;
  const activeScrapers = livePlatforms.filter((item) => item.scraper_running).length;
  const indexedTotal = livePlatforms.reduce((sum, item) => sum + (item.indexed_count || 0), 0);
  const productsTotal = livePlatforms.reduce((sum, item) => sum + (item.products_count || 0), 0);
  const liveSignals = [
    ["FashionCLIP vector match", history.length ? `${history[0].clipMatches} latest` : "Ready"],
    ["Marketplace candidates", history.length ? `${history[0].marketplaceMatches} latest` : "Waiting"],
    ["Dataset indexed", productsTotal ? `${indexedTotal}/${productsTotal}` : "Loading"],
    ["Live scrapers", `${activeScrapers} running`]
  ];

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8">
      <div className="dashboard-hero relative overflow-hidden rounded-[2rem] border border-slate-950/10 bg-white/80 p-6 shadow-soft dark:border-white/10 dark:bg-white/[0.045] sm:p-10 xl:p-14">
        <div className="hero-orbit" />
          <div className="relative z-10 grid min-h-[400px] items-center gap-8 lg:grid-cols-[1fr_0.78fr]">
          <div className="max-w-4xl">
            <p className="mb-5 text-xs font-semibold uppercase tracking-[0.34em] text-cyan-600 dark:text-cyan-300">
              Visual commerce intelligence
            </p>
            <h1 className="max-w-5xl text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl xl:text-7xl">
              Marketplace lookups from a{" "}
              <span className="gradient-text">single photo</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-slate-600 dark:text-white/62 sm:text-lg">
              Compare product photos across marketplace listings, CLIP similarity, and Columbia validation with a focused AI search workspace.
            </p>
            <button
              type="button"
              onClick={() => navigate("/accurate-search")}
              className="primary-button mt-9"
            >
              Start Search
            </button>
          </div>
          <div className="hero-panel">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-white/45">Live intelligence</span>
              <span className="status-pill bg-emerald-500/12 text-emerald-500">CLIP Online</span>
            </div>
            <div className="mt-8 space-y-4">
              {liveSignals.map(([label, value], index) => (
                <div key={label} className="mini-signal" style={{ animationDelay: `${index * 90}ms` }}>
                  <span className="signal-dot" />
                  <span>{label}</span>
                  <span className="ml-auto text-slate-400 dark:text-white/35">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map(([label, value, meta]) => (
          <MetricCard key={label} label={label} value={value} meta={meta} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.75fr]">
        <section className="panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Recent Activity</h2>
            <span className="status-pill">Updated now</span>
          </div>
          <div className="mt-5 divide-y divide-slate-950/8 dark:divide-white/8">
            {history.length ? history.slice(0, 5).map((item) => (
              <div key={item.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-slate-500 dark:text-white/45">
                    {item.clipMatches} CLIP matches · {item.marketplaceMatches} marketplace listings · {item.googleLens ? "Google Lens on" : "Google Lens off"}
                  </p>
                </div>
                <span className="text-sm text-slate-500 dark:text-white/45">{item.images} images</span>
                <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-950/10 dark:bg-white/10">
                  <span className="block h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(8, item.results ? (item.validated / item.results) * 100 : 0)}%` }} />
                </span>
              </div>
            )) : (
              <div className="py-10 text-sm text-slate-500 dark:text-white/45">
                Completed searches will appear here automatically after the workflow finishes.
              </div>
            )}
          </div>
        </section>
        <section className="panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Search Health</h2>
          <div className="mt-6 grid grid-cols-2 gap-4">
            <AnalyticsTile label="Indexed" value={`${indexedTotal}/${productsTotal}`} />
            <AnalyticsTile label="Indexers active" value={String(activeIndexers)} />
            <AnalyticsTile label="Scrapers active" value={String(activeScrapers)} />
            <AnalyticsTile label="Platforms" value="3 live" />
          </div>
        </section>
      </div>
    </section>
  );
}

// ─── ACCURATE SEARCH WORKSPACE ───────────────────────────────────────────────

function LegacyVisualSearchWorkspace() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [results, setResults] = useState([]);
  const [progressByImage, setProgressByImage] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [useGoogleLens, setUseGoogleLens] = useState(false);
  const [showGoogleProgress, setShowGoogleProgress] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  // No tab state needed — results always render grouped by image
  const [doneCount, setDoneCount] = useState(0);
  const [overrides, setOverrides] = useState({});
  const [overrideInputs, setOverrideInputs] = useState({});
  const [overrideLoading, setOverrideLoading] = useState({});
  const resultsRef = useRef(null);
  const pendingResultsRef = useRef([]);

  useEffect(() => {
    if (!files.length) {
      setPreviews([]);
      return;
    }
    const nextPreviews = files.map((item) => ({
      name: item.name,
      url: URL.createObjectURL(item)
    }));
    setPreviews(nextPreviews);
    return () => nextPreviews.forEach((item) => URL.revokeObjectURL(item.url));
  }, [files]);

  const previewLookup = useMemo(
    () =>
      previews.reduce((acc, item) => {
        acc[item.name] = item.url;
        return acc;
      }, {}),
    [previews]
  );

  const progressPercent = files.length ? Math.min(100, Math.round((doneCount / files.length) * 100)) : 0;

  const handleFiles = (selectedFiles) => {
    setError("");
    setResults([]);
    setDoneCount(0);
    setProgressByImage({});
    setOverrides({});
    setOverrideInputs({});
    setOverrideLoading({});
    if (!selectedFiles.length) {
      setFiles([]);
      return;
    }
    setFiles(selectedFiles);
  };

  const handleSearch = async () => {
    if (!files.length) {
      setError("Please add at least one product image before starting.");
      return;
    }

    setLoading(true);
    setError("");
    setResults([]);
    pendingResultsRef.current = [];
    setDoneCount(0);
    setProgressByImage(
      files.reduce((acc, file) => {
        acc[file.name] = "Queued";
        return acc;
      }, {})
    );

    try {
      await scrapeProductsStream(
        files,
        {
          showProcess: useGoogleLens && showGoogleProgress,
          disableGoogle: !useGoogleLens
        },
        {
          onResult: (item) => {
            pendingResultsRef.current = [
              ...pendingResultsRef.current.filter((entry) => entry.image !== item.image),
              item
            ];
            setResults([...pendingResultsRef.current]);
            setProgressByImage((prev) => ({
              ...prev,
              [item.image]: "Complete"
            }));
            setDoneCount((prev) => Math.min(files.length, prev + 1));
          },
          onError: (payload) => {
            const message = payload?.error || "Scrape failed.";
            setError(message);
            if (payload?.image) {
              setProgressByImage((prev) => ({
                ...prev,
                [payload.image]: "Failed"
              }));
            }
          },
          onDone: () => {
            const finalResults = pendingResultsRef.current;
            setResults(finalResults);
            setLoading(false);
            setDoneCount(files.length);
            writeSearchHistory(buildHistoryEntry(finalResults, files.length, useGoogleLens));
            window.setTimeout(() => {
              resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 850);
          }
        }
      );
    } catch (err) {
      setError(err.message || "Scrape failed.");
      setLoading(false);
      pendingResultsRef.current = [];
    }
  };

  const overrideKey = (imageName, platform) => `${imageName}::${platform}`;

  const resolveListing = (group, platform) => {
    const key = overrideKey(group.image, platform);
    const override = overrides[key];
    if (override?.status === "rejected") {
      return { status: "rejected" };
    }
    if (override?.status === "manual") {
      return { status: "manual", item: override.item };
    }

    const listing = (group.listings || []).find((item) => item.platform === platform);
    if (listing) {
      const hasData = Boolean(
        listing.url ||
        listing.image_url ||
        listing.price ||
        (listing.product_name && listing.product_name !== "Not Found")
      );
      if (hasData) {
        return { status: "marketplace", item: listing };
      }
    }

    return { status: "empty" };
  };

  const pickDisplayItem = (group, platform, resolved) => {
    if (resolved?.status === "manual") return resolved.item;
    if (resolved?.status === "marketplace") return resolved.item;

    const clip = (group.columbia_matches || {})[platform];
    if (clip && (clip.name || clip.image_url || clip.price || clip.url)) {
      return clip;
    }

    return null;
  };

  const handleReject = (group, platform) => {
    const key = overrideKey(group.image, platform);
    setOverrides((prev) => ({ ...prev, [key]: { status: "rejected" } }));
  };

  const handleOverrideInput = (group, platform, value) => {
    const key = overrideKey(group.image, platform);
    setOverrideInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleOverrideSubmit = async (group, platform) => {
    const key = overrideKey(group.image, platform);
    const url = (overrideInputs[key] || "").trim();
    if (!url) {
      return;
    }

    try {
      setError("");
      setOverrideLoading((prev) => ({ ...prev, [key]: "link" }));
      const product = await fetchProductFromUrl(platform, url);
      setOverrides((prev) => ({
        ...prev,
        [key]: { status: "manual", item: product }
      }));
      setOverrideInputs((prev) => ({ ...prev, [key]: "" }));
    } catch (err) {
      setError("Failed to fetch product from link.");
    } finally {
      setOverrideLoading((prev) => ({ ...prev, [key]: "" }));
    }
  };

  const handleLensOverrideSubmit = async (group, platform) => {
    const key = overrideKey(group.image, platform);
    const file = files.find((item) => item.name === group.image);
    if (!file) {
      setError("Could not find the original image for Google Lens search.");
      return;
    }

    try {
      setError("");
      setOverrideLoading((prev) => ({ ...prev, [key]: "lens" }));
      const response = await fetchProductFromImagePlatform(file, platform, {
        showProcess: true,
        topN: 20
      });
      const product = response?.product;
      if (!product) {
        setError(`No ${platform} product found from Google Lens.`);
        return;
      }
      setOverrides((prev) => ({
        ...prev,
        [key]: { status: "manual", item: product }
      }));
    } catch (err) {
      setError(`Google Lens search failed for ${platform}.`);
    } finally {
      setOverrideLoading((prev) => ({ ...prev, [key]: "" }));
    }
  };

  const handleExport = () => {
    const rows = [
      [
        "Item name",
        "Amazon price",
        "Myntra price",
        "Tata price",
        "",
        "Amazon link",
        "Myntra link",
        "Tata link"
      ]
    ];

    results.forEach((group) => {
      const resolved = PLATFORM_ORDER.map((platform) => resolveListing(group, platform));
      const displayItems = PLATFORM_ORDER.map((platform, idx) => pickDisplayItem(group, platform, resolved[idx]));
      const amazonEntry = resolved[0];
      const amazonItem = displayItems[0];
      const amazonName = amazonEntry.status === "rejected"
        ? "Rejected"
        : amazonItem?.product_name || amazonItem?.name || "Not Found";

      const priceValue = (entry, item) => {
        if (entry.status === "rejected") return "Rejected";
        const raw = item?.price;
        if (!raw) return "Not Found";
        const num = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
        return isNaN(num) ? raw : num;
      };

      const linkValue = (entry, item) => {
        if (entry.status === "rejected") return "";
        return item?.url || "";
      };

      rows.push([
        amazonName,
        priceValue(resolved[0], displayItems[0]),
        priceValue(resolved[1], displayItems[1]),
        priceValue(resolved[2], displayItems[2]),
        "",
        linkValue(resolved[0], displayItems[0]),
        linkValue(resolved[1], displayItems[1]),
        linkValue(resolved[2], displayItems[2])
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Results");
    XLSX.writeFile(workbook, "columbia-visual-search-results.xlsx");
  };

  const handleOpenProfile = async () => {
    setProfileStatus("Opening...");
    try {
      const response = await openGoogleProfile();
      setProfileStatus(response?.status === "already_open" ? "Profile already open" : "Chrome opened for login");
    } catch (err) {
      setProfileStatus("Failed to open profile");
    }
  };

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 xl:px-8">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-600 dark:text-cyan-300">Accurate Search Workspace</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Run bulk product intelligence</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleOpenProfile} className="secondary-button">Load Google Profile</button>
          <button type="button" onClick={handleExport} disabled={!results.length} className="secondary-button disabled:opacity-45">
            Export to Excel
          </button>
        </div>
      </div>

      <div className="space-y-5">
          <div className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Upload queue</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-white/48">Drop product photos here. FashionCLIP matching runs by default.</p>
              </div>
              <span className="status-pill bg-cyan-500/12 text-cyan-600 dark:text-cyan-300">{files.length} images</span>
            </div>

            <label
              className={`upload-zone mt-5 ${isDragging ? "is-dragging" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                handleFiles(event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : []);
              }}
            >
              <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleFiles(event.target.files ? Array.from(event.target.files) : [])} />
              <span className="upload-glyph">↑</span>
              <span className="font-semibold">{previews.length ? "Replace or add a new batch" : "Drop images or click to upload"}</span>
              <span className="text-sm text-slate-500 dark:text-white/45">Bulk image search, validation, and export-ready results</span>
            </label>

            {previews.length > 0 && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {previews.map((item, index) => (
                  <div key={item.url} className="queue-card">
                    <img src={item.url} alt={item.name} className="h-24 w-24 rounded-2xl object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-white/45">
                        {progressByImage[item.name] || (loading ? "Queued" : `Image ${index + 1}`)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel p-5 sm:p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Search controls</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-white/48">CLIP accurate matching is always enabled. Google Lens is optional.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setUseGoogleLens((prev) => {
                      const next = !prev;
                      setShowGoogleProgress(next);
                      return next;
                    });
                  }}
                  className={`lens-toggle ${useGoogleLens ? "is-on" : ""}`}
                  title="Uses external Google image matching"
                  aria-pressed={useGoogleLens}
                >
                  <span className="toggle-track"><span className="toggle-knob" /></span>
                  <span>
                    <span className="block text-sm font-semibold">Use Google Lens</span>
                    <span className="block text-xs opacity-60">Uses external Google image matching</span>
                  </span>
                </button>
                {useGoogleLens && (
                  <button
                    type="button"
                    onClick={() => setShowGoogleProgress((prev) => !prev)}
                    className={`lens-toggle compact ${showGoogleProgress ? "is-on" : ""}`}
                    title="Opens the existing Google browser progress window while Lens runs"
                    aria-pressed={showGoogleProgress}
                  >
                    <span className="toggle-track"><span className="toggle-knob" /></span>
                    <span>
                      <span className="block text-sm font-semibold">Show Google Progress</span>
                      <span className="block text-xs opacity-60">Opens browser progress during Lens</span>
                    </span>
                  </button>
                )}
                <button type="button" onClick={handleSearch} disabled={loading} className="primary-button disabled:cursor-not-allowed disabled:opacity-60">
                  {loading ? "Searching..." : "Start Marketplace Scrape"}
                </button>
                <div className="inline-progress-ring" style={{ "--progress": `${progressPercent}%` }}>
                  <span>{loading ? `${progressPercent}%` : ""}</span>
                </div>
              </div>
            </div>
            {profileStatus && <p className="mt-4 text-xs text-slate-500 dark:text-white/45">{profileStatus}</p>}
            {error && <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</p>}
          </div>
      </div>

      {/* ─── RESULTS SECTION — always grouped by image, no tabs ─────────── */}
      <section ref={resultsRef} className="mt-6 panel p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-2xl font-semibold">Results</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/48">
              Each uploaded image has its own result block with marketplace matches.
            </p>
          </div>
          {results.length > 0 && (
            <span className="status-pill bg-cyan-500/12 text-cyan-600 dark:text-cyan-300">
              {results.length} image{results.length !== 1 ? "s" : ""} analysed
            </span>
          )}
        </div>

        {!results.length ? (
          <div className="mt-6 grid min-h-56 place-items-center rounded-3xl border border-dashed border-slate-950/15 bg-slate-950/[0.025] text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.035] dark:text-white/45">
            Results will appear here after the AI workflow completes.
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {results.map((group, groupIndex) => (
              <ImageResultGroup
                key={group.image}
                group={group}
                preview={previewLookup[group.image]}
                groupIndex={groupIndex}
                totalGroups={results.length}
                resolveListing={resolveListing}
                onReject={handleReject}
                onOverrideInput={handleOverrideInput}
                onOverrideSubmit={handleOverrideSubmit}
                onLensOverrideSubmit={handleLensOverrideSubmit}
                overrideInputs={overrideInputs}
                overrideLoading={overrideLoading}
              />
            ))}
            <UpcomingIntegrations />
          </div>
        )}
      </section>

    </section>
  );
}

// ─── IMAGE RESULT GROUP ───────────────────────────────────────────────────────
// One block per uploaded image: header + marketplace columns + CLIP row

function ImageResultGroup({
  group,
  preview,
  groupIndex,
  totalGroups,
  resolveListing,
  onReject,
  onOverrideInput,
  onOverrideSubmit,
  onLensOverrideSubmit,
  overrideInputs,
  overrideLoading
}) {
  const columbiaMatches = group.columbia_matches || {};
  const listings = group.listings || [];

  // Build a unified per-platform view
  const platformData = PLATFORM_ORDER.map((platform) => {
    const clip = columbiaMatches[platform];
    const marketplace = listings.find((l) => l.platform === platform);
    const resolved = resolveListing(group, platform);
    return { platform, clip, marketplace, resolved };
  });

  // Find best similarity score across all sources for this image
  const allScores = platformData.flatMap(({ clip, marketplace }) => {
    const scores = [];
    if (clip?.score != null) scores.push(clip.score);
    if (marketplace?.similarity_score != null) scores.push(marketplace.similarity_score);
    return scores;
  });
  const bestScore = allScores.length ? Math.max(...allScores) : null;
  const bestPlatform = bestScore != null
    ? platformData.find(({ clip, marketplace }) =>
        clip?.score === bestScore || marketplace?.similarity_score === bestScore
      )?.platform
    : null;

  const totalMatches = platformData.filter(({ clip, marketplace, resolved }) =>
    clip || marketplace?.url || resolved?.status === "manual"
  ).length;
  const validationLabel = formatStatus(group.status);
  const validationColor =
    group.status === "flagged" ? "text-red-500" :
    group.status === "medium" ? "text-amber-500" :
    "text-emerald-500";
  const platformStatusMap = platformData.reduce((acc, item) => {
    acc[item.platform] = item.resolved?.status || "empty";
    return acc;
  }, {});

  return (
    <div
      className="image-result-group"
      style={{ animationDelay: `${groupIndex * 100}ms` }}
    >
      {/* ── Group counter ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5">
        <span className="group-counter">{groupIndex + 1}</span>
        <div className="flex-1 h-px bg-slate-950/8 dark:bg-white/8" />
        <span className="text-xs text-slate-400 dark:text-white/30 uppercase tracking-widest">
          Image {groupIndex + 1} of {totalGroups}
        </span>
      </div>
      <div className="image-group-header">
        {/* Left: reference image */}
        <div className="reference-image-wrap">
          {preview ? (
            <img src={preview} alt={group.image} className="reference-image" />
          ) : (
            <div className="reference-image reference-image-placeholder">No preview</div>
          )}
        </div>

        {/* Right: summary */}
        <div className="image-group-meta">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-white/42">
            Reference Image {groupIndex + 1}
          </p>
          <h3 className="mt-2 truncate text-lg font-semibold">{group.image}</h3>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="group-meta-tile">
              <p className="group-meta-label">Best Match</p>
              <p className="group-meta-value text-cyan-600 dark:text-cyan-300">
                {bestScore != null ? `${(bestScore * 100).toFixed(1)}%` : "N/A"}
              </p>
            </div>
            <div className="group-meta-tile">
              <p className="group-meta-label">Validation</p>
              <p className={`group-meta-value ${validationColor}`}>{validationLabel}</p>
            </div>
            <div className="group-meta-tile">
              <p className="group-meta-label">Platforms</p>
              <p className="group-meta-value">{totalMatches}/{PLATFORM_ORDER.length}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PLATFORM_ORDER.map((platform) => (
              <span
                key={platform}
                className={`platform-status-pill ${platformStatusMap[platform] !== "empty" && platformStatusMap[platform] !== "rejected" ? "is-active" : "is-empty"}`}
              >
                {platform}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Per-platform cards ───────────────────────────────────────────── */}
      <div className="platform-cards-grid">
        {platformData.map(({ platform, clip, marketplace, resolved }, cardIndex) => (
          <PlatformMatchCard
            key={platform}
            platform={platform}
            clip={clip}
            marketplace={marketplace}
            resolved={resolved}
            isBest={platform === bestPlatform}
            groupStatus={group.status}
            cardIndex={cardIndex}
            group={group}
            onReject={onReject}
            onOverrideInput={onOverrideInput}
            onOverrideSubmit={onOverrideSubmit}
            onLensOverrideSubmit={onLensOverrideSubmit}
            overrideInputs={overrideInputs}
            overrideLoading={overrideLoading}
          />
        ))}
      </div>
    </div>
  );
}

// ─── PLATFORM MATCH CARD ─────────────────────────────────────────────────────
// Shows CLIP + marketplace data for one platform within one image group

function PlatformMatchCard({
  platform,
  clip,
  marketplace,
  resolved,
  isBest,
  groupStatus,
  cardIndex,
  group,
  onReject,
  onOverrideInput,
  onOverrideSubmit,
  onLensOverrideSubmit,
  overrideInputs,
  overrideLoading
}) {
  const isRejected = resolved?.status === "rejected";
  const isManual = resolved?.status === "manual";
  const resolvedItem = resolved?.item || null;
  const hasResolved = resolved?.status === "manual" || resolved?.status === "marketplace";

  const hasClip = Boolean(clip);
  const hasMarketplace = Boolean(marketplace?.url);
  
  let displayItem = null;
  if (hasResolved) {
    displayItem = resolvedItem;
  } else if (clip && (clip.name || clip.image_url || clip.price || clip.url)) {
    displayItem = clip;
  }
  
  const isEmpty = isRejected || !displayItem;

  const clipScore = clip?.score;
  const marketplaceScore = marketplace?.similarity_score;
  const displayScore = clipScore ?? marketplaceScore;
  const confidence = getConfidence(displayScore);

  const title = displayItem?.product_name || displayItem?.name || displayItem?.title || null;
  const price = displayItem?.price || displayItem?.offer_price || displayItem?.selling_price || null;
  const imageUrl = displayItem?.image_url || displayItem?.image || displayItem?.thumbnail || null;
  const productUrl = displayItem?.url || displayItem?.link || null;
  const inputKey = `${group.image}::${platform}`;
  const loadingState = overrideLoading[inputKey] || "";

  return (
    <article
      className={`platform-card ${isBest ? "is-best-match" : ""} ${isEmpty ? "is-empty" : ""}`}
      style={{ animationDelay: `${cardIndex * 60}ms` }}
    >
      {isBest && (
        <div className="best-match-badge">
          ★ Best Match
        </div>
      )}

      <div className="platform-card-header">
        <span className="market-pill">{platform}</span>
        {!isEmpty && (
          <span className={`confidence ${confidence.toLowerCase()}`}>{confidence}</span>
        )}
        {!isRejected && (
          <button type="button" className="card-dismiss" onClick={() => onReject(group, platform)} aria-label="Reject item">
            ×
          </button>
        )}
      </div>

      {isEmpty ? (
        <div className="empty-platform-state">
          <p className="text-sm text-slate-400 dark:text-white/30">Slot empty — add a product link</p>
          <div className="replace-link">
            <input
              type="url"
              placeholder="Paste product link"
              value={overrideInputs[inputKey] || ""}
              onChange={(event) => onOverrideInput(group, platform, event.target.value)}
            />
            <button type="button" onClick={() => onOverrideSubmit(group, platform)} disabled={Boolean(loadingState)}>
              {loadingState === "link" ? "Fetching" : "Fetch"}
            </button>
          </div>
          <button
            type="button"
            className="lens-search-button"
            onClick={() => onLensOverrideSubmit(group, platform)}
            disabled={Boolean(loadingState)}
          >
            {loadingState === "lens" ? "Searching Google Lens" : "Google Lens search"}
          </button>
        </div>
      ) : (
        <div className="platform-card-content">
          {imageUrl && (
            <div className="platform-card-image-wrap">
              <img src={imageUrl} alt={title || platform} className="platform-card-image" />
            </div>
          )}

          <div className="platform-card-body">
            {title && <h4 className="line-clamp-2 text-sm font-semibold leading-5">{title}</h4>}
            {price && <p className="mt-2 text-sm font-medium text-cyan-600 dark:text-cyan-300">{price}</p>}

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {hasClip && clipScore != null && (
                <ScoreTile label="CLIP Score" value={`${(clipScore * 100).toFixed(1)}%`} />
              )}
              {hasMarketplace && marketplaceScore != null && (
                <ScoreTile label="Marketplace" value={`${(marketplaceScore * 100).toFixed(1)}%`} />
              )}
              <ScoreTile label="Validation" value={formatStatus(groupStatus)} />
              <ScoreTile
                label="Sources"
                value={[hasClip && "CLIP", hasMarketplace && "Lens", isManual && "Manual"].filter(Boolean).join(" + ")}
              />
            </div>

            {(marketplace?.price_flag || marketplace?.similarity_flag) && (
              <p className="mt-3 text-xs text-amber-500">⚠ Needs review</p>
            )}

            <div className="mt-4">
              {productUrl ? (
                <a href={productUrl} target="_blank" rel="noreferrer" className="link-button w-full text-center block">
                  Open product ↗
                </a>
              ) : (
                <span className="link-button is-disabled w-full text-center block">No link</span>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// ─── VALIDATION CARD ─────────────────────────────────────────────────────────

function ValidationCard({ group, preview, index }) {
  const status = formatStatus(group.status);
  return (
    <article className="result-card" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="flex items-center gap-4">
        {preview && <img src={preview} alt={group.image} className="h-20 w-20 rounded-2xl object-cover" />}
        <div>
          <h3 className="font-semibold">{group.image}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-white/48">Validation summary</p>
        </div>
        <span className="status-pill ml-auto">{status}</span>
      </div>
      <div className="mt-5 space-y-2 text-sm text-slate-500 dark:text-white/48">
        <p>Google Lens: {group.google_disabled ? "Disabled" : "Enabled"}</p>
        <p>Columbia matches: {Object.keys(group.columbia_matches || {}).length}</p>
        <p>Marketplace listings: {(group.listings || []).filter((item) => item?.url).length}</p>
      </div>
    </article>
  );
}

// ─── UPCOMING INTEGRATIONS ────────────────────────────────────────────────────

function UpcomingIntegrations() {
  return (
    <div className="upcoming-integrations-row">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-white/30">
        Upcoming integrations
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="upcoming-platform-pill">AJIO — Coming Soon</span>
       
      </div>
    </div>
  );
}

// ─── IMPROVE DATASET PAGE ──────────────────────────────────────────────────────

function LegacyImproveDatasetPage() {
  const navigate = useNavigate();
  const [indexFiles, setIndexFiles] = useState({});
  const [uploadStatus, setUploadStatus] = useState({});

  useEffect(() => {
    let active = true;
    const loadFiles = async () => {
      try {
        const response = await fetchIndexFiles();
        if (active) {
          setIndexFiles(response?.files || {});
        }
      } catch (err) {
        if (active) {
          setIndexFiles({});
        }
      }
    };
    loadFiles();
    const timer = setInterval(loadFiles, 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const handleUpload = async (platform, file) => {
    if (!file) return;
    setUploadStatus((prev) => ({ ...prev, [platform]: "Uploading..." }));
    try {
      await uploadIndexFile(platform, "index", file);
      setUploadStatus((prev) => ({ ...prev, [platform]: "Uploaded" }));
    } catch (err) {
      setUploadStatus((prev) => ({ ...prev, [platform]: "Upload failed" }));
    }
  };

  const cards = [
    { platform: "amazon", label: "Amazon" },
    { platform: "myntra", label: "Myntra" },
    { platform: "tatacliq", label: "Tata Cliq" }
  ];

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-600 dark:text-cyan-300">Dataset operations</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Improve dataset coverage</h1>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {cards.map((card) => (
          <DatasetCard
            key={card.platform}
            platform={card.platform}
            label={card.label}
            indexFile={indexFiles?.[card.platform]?.index}
            uploadStatus={uploadStatus[card.platform]}
            onStart={() => navigate(`/improve/${card.platform}`)}
            onUpload={handleUpload}
          />
        ))}
      </div>
    </section>
  );
}

function DatasetCard({ platform, label, indexFile, uploadStatus, onStart, onUpload }) {
  return (
    <article className="panel p-5 sm:p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-white/45">{label}</p>
        <h2 className="mt-3 text-2xl font-semibold">{label}</h2>
      </div>
      <button type="button" onClick={onStart} className="primary-button mt-5 w-full">
        Start Scraping
      </button>
      <div className="mt-5">
        <IndexFileBox
          platform={platform}
          indexFile={indexFile}
          uploadStatus={uploadStatus}
          onUpload={onUpload}
        />
      </div>
    </article>
  );
}

function PlatformDatasetPage() {
  const { platform } = useParams();
  const normalized = (platform || "").toLowerCase();
  const labelMap = {
    amazon: "Amazon",
    myntra: "Myntra",
    tatacliq: "Tata Cliq"
  };
  const label = labelMap[normalized] || "Platform";

  if (!labelMap[normalized]) {
    return (
      <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8">
        <div className="panel p-6">
          <h1 className="text-2xl font-semibold">Unknown platform</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-white/45">Select Amazon, Myntra, or Tata Cliq.</p>
        </div>
      </section>
    );
  }

  const [indexFiles, setIndexFiles] = useState({});
  const [status, setStatus] = useState("");
  const [indexStatus, setIndexStatus] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [concurrency, setConcurrency] = useState(normalized === "myntra" ? 4 : 1);

  useEffect(() => {
    let active = true;
    const loadFiles = async () => {
      try {
        const response = await fetchIndexFiles();
        if (active) {
          setIndexFiles(response?.files || {});
        }
      } catch (err) {
        if (active) {
          setIndexFiles({});
        }
      }
    };
    loadFiles();
    const timer = setInterval(loadFiles, 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const handleScrape = async () => {
    const headless = !showBrowser;
    setStatus("Starting...");
    try {
      const params = { headless, concurrency };
      if (normalized === "amazon") {
        const response = await startAmazonScrapeWithParams(params);
        setStatus(response?.status === "already_running" ? `${label} scraper already running` : `${label} scraper started`);
      } else if (normalized === "myntra") {
        const response = await startMyntraScrapeWithParams(params);
        setStatus(response?.status === "already_running" ? `${label} scraper already running` : `${label} scraper started`);
      } else if (normalized === "tatacliq") {
        const response = await startTatacliqScrapeWithParams({ headless });
        setStatus(response?.status === "already_running" ? `${label} scraper already running` : `${label} scraper started`);
      }
    } catch (err) {
      setStatus(`Failed to start ${label} scraper`);
    }
  };

  const handleBuildIndex = async () => {
    setIndexStatus("Building index...");
    try {
      const response = await buildIndex(normalized);
      setIndexStatus(response?.status === "already_running" ? "Indexer already running" : "Index build started");
    } catch (err) {
      setIndexStatus("Failed to start index build");
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setUploadStatus("Uploading...");
    try {
      await uploadIndexFile(normalized, "index", file);
      setUploadStatus("Uploaded");
    } catch (err) {
      setUploadStatus("Upload failed");
    }
  };

  const indexFile = indexFiles?.[normalized]?.index;
  const showConcurrency = normalized === "amazon" || normalized === "myntra";

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-600 dark:text-cyan-300">{label} controls</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{label} dataset operations</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <article className="panel p-5 sm:p-6">
          <h2 className="text-2xl font-semibold">Start scraping</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-white/45">Scrape new products using the platform crawler.</p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowBrowser((prev) => !prev)}
              className={`lens-toggle ${showBrowser ? "is-on" : ""}`}
              aria-pressed={showBrowser}
            >
              <span className="toggle-track"><span className="toggle-knob" /></span>
              <span>
                <span className="block text-sm font-semibold">Show browser progress</span>
                <span className="block text-xs opacity-60">Disable headless mode</span>
              </span>
            </button>

            {showConcurrency && (
              <label className="flex items-center gap-3 rounded-full border border-slate-950/10 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/70">
                Browsers
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value || 1))}
                  className="w-16 rounded-full border border-slate-950/15 bg-white/70 px-2 py-1 text-center text-slate-900"
                />
              </label>
            )}
          </div>

          <button type="button" onClick={handleScrape} className="primary-button mt-5 w-full">
            Start {label} scraping
          </button>
          {status && <p className="mt-3 text-xs text-slate-500 dark:text-white/45">{status}</p>}
        </article>

        <article className="panel p-5 sm:p-6">
          <h2 className="text-2xl font-semibold">Build index</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-white/45">Generate the FAISS index and metadata for this dataset.</p>

          <button type="button" onClick={handleBuildIndex} className="primary-button mt-5 w-full">
            Build index
          </button>
          {indexStatus && <p className="mt-3 text-xs text-slate-500 dark:text-white/45">{indexStatus}</p>}

          <div className="mt-5">
            <IndexFileBox
              platform={normalized}
              indexFile={indexFile}
              uploadStatus={uploadStatus}
              onUpload={(_, file) => handleUpload(file)}
            />
          </div>
        </article>
      </div>
    </section>
  );
}

function IndexFileBox({ platform, indexFile, uploadStatus, onUpload }) {
  const filePath = indexFile?.path || "";
  const fileName = filePath.split(/[/\\]/).pop();
  const exists = Boolean(indexFile?.exists);

  return (
    <div className="index-file-box">
      <p className="text-xs uppercase tracking-[0.26em] text-slate-500 dark:text-white/45">Index file</p>
      <label className="index-file-slot">
        <span>{exists ? fileName : "No index file"}</span>
        <input type="file" className="hidden" onChange={(event) => onUpload(platform, event.target.files?.[0])} />
      </label>
      {uploadStatus && <p className="mt-2 text-xs text-slate-500 dark:text-white/45">{uploadStatus}</p>}
      {exists ? (
        <a className="link-button mt-4 w-full text-center block" href={getIndexFileUrl(platform, "index")}>
          Download index
        </a>
      ) : (
        <span className="link-button is-disabled mt-4 w-full text-center block">Download index</span>
      )}
    </div>
  );
}

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────

function formatSiteName(site) {
  if (!site) return "";
  const s = String(site).toLowerCase();
  if (s === "tatacliq") return "Tata Cliq";
  if (s === "tata_lux") return "Tata Lux";
  if (s === "flipkart") return "Flipkart";
  if (s === "adventure" || s === "adventuras") return "Adventuras";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatSiteHeader(site) {
  if (!site) return "";
  const s = String(site).toLowerCase();
  if (s === "tatacliq") return "TATA CLIQ";
  if (s === "tata_lux") return "TATA LUX";
  if (s === "flipkart") return "FLIPKART";
  if (s === "adventure" || s === "adventuras") return "ADVENTURAS";
  return s.toUpperCase();
}

function AccurateSearchWorkspace() {
  const [query, setQuery] = useState(""); const [data, setData] = useState({ results: [], missing: [] }); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [page, setPage] = useState(1);
  const identifiers = [...new Set(query.replace(/,/g, "\n").split(/\r?\n/).map(x => x.trim()).filter(Boolean))];
  const submit = async () => { if (!identifiers.length) return setError("Paste at least one SKU or EAN."); setBusy(true); setError(""); setPage(1); try { setData(await exactSearch(identifiers)); } catch (e) { setError(e.response?.data?.detail || "Search failed."); } finally { setBusy(false); } };
  const exportExcel = async () => { try { const response = await downloadSearchExport(identifiers); const url = URL.createObjectURL(response.data); const link = document.createElement("a"); link.href = url; link.download = "search-results.xlsx"; link.click(); URL.revokeObjectURL(url); } catch { setError("Could not export search results."); } };
  const sites = ["amazon", "ajio", "adventure", "columbia", "myntra", "tatacliq", "tata_lux", "flipkart"];
  const pages = Math.max(1, Math.ceil((data.results || []).length / 10));
  return <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8"><p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-600 dark:text-cyan-300">Exact catalog lookup</p><div className="mt-3 flex items-center justify-between gap-3"><h1 className="text-4xl font-semibold tracking-tight">Search</h1><button className="secondary-button" onClick={exportExcel} disabled={!identifiers.length}>Export to Excel</button></div><div className="panel mt-6 p-6"><textarea className="min-h-44 w-full rounded-xl p-4 text-slate-900" value={query} onChange={e => setQuery(e.target.value)} placeholder={"EAN or SKU, one per line\n8901234567890"} /><button className="primary-button mt-4" onClick={submit} disabled={busy}>{busy ? "Searching…" : "Search identifiers"}</button>{error && <p className="mt-3 text-rose-500">{error}</p>}</div><p className="mt-4 text-sm text-slate-500">{data.results?.length || 0} matches · {data.missing?.length || 0} not found</p><div className="mt-5 space-y-4">{(data.results || []).slice((page - 1) * 10, page * 10).map((result, index) => { const row = result.tuple; const image = sites.map(site => row[site]?.image).find(Boolean); return <article className="panel p-5" key={result.key + index}><div className="flex gap-5">{image && <img src={image} className="h-32 w-32 rounded-xl object-cover" />}<div className="min-w-0 flex-1"><b>{row.sku || result.query}</b><p className="text-sm text-slate-500">EAN: {(row.ean_numbers || []).join(", ")}</p><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{sites.map(site => { const item = row[site]; return <div className="rounded-lg border p-2 text-sm" key={site}><b className="capitalize">{formatSiteName(site)}</b><p>{item?.price ?? item?.normal_price ?? "No match"}</p>{item?.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-cyan-600 underline">Open listing</a>}</div>; })}</div></div></div></article>; })}</div>{pages > 1 && <div className="mt-5 flex justify-center gap-3"><button className="secondary-button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span className="pt-2">Page {page} of {pages}</span><button className="secondary-button" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button></div>}</section>;
}

function ImproveDatasetPage() {
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState("");
  const [json, setJson] = useState(null);
  const [progress, setProgress] = useState(null);

  const upload = async () => {
    if (!file) return setMessage("Select an Excel file.");
    try {
      const r = await uploadMasterExcel(file);
      setJson(r.json);
      setMessage(`${r.rows} rows imported.`);
    } catch (e) {
      setMessage(e.response?.data?.detail || "Upload failed.");
    }
  };

  const rebuild = async () => {
    try {
      await rebuildTuples();
      setMessage("Rebuild started in background.");
      const timer = setInterval(async () => {
        const state = await fetchRebuildProgress();
        setProgress(state);
        if (!state.running) {
          clearInterval(timer);
          if (state.error) {
            setMessage(state.error);
          } else {
            setMessage(state.message || "Tuples rebuilt successfully.");
            const master = await fetchMasterJson();
            setJson(master);
          }
        }
      }, 1000);
    } catch (e) {
      setMessage(e.response?.data?.detail || "Rebuild failed.");
    }
  };

  const rows = json?.products
    ? Array.isArray(json.products)
      ? json.products
      : Object.values(json.products)
    : [];

  const columns = json?.columns || (rows.length > 0 ? Object.keys(rows[0]) : []);

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-400">Catalog Operations</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Improve dataset</h1>
          <p className="mt-1 text-sm text-slate-500">Upload master catalog spreadsheets and rebuild unified marketplace tuples.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="panel p-6">
          <h2 className="text-xl font-semibold">Upload master Excel</h2>
          <p className="mt-1 text-sm text-slate-500">Import the master spreadsheet containing SKU, EAN, Style, and marketplace mapping codes.</p>
          <input
            className="mt-5 block w-full text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-cyan-50 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-cyan-700 hover:file:bg-cyan-100 dark:file:bg-slate-800 dark:file:text-cyan-300"
            type="file"
            accept=".xlsx,.xlsm"
            onChange={e => setFile(e.target.files?.[0])}
          />
          <div className="mt-5 flex items-center gap-3">
            <button className="primary-button" onClick={upload}>Upload Excel</button>
            <button
              className="secondary-button"
              onClick={async () => {
                const data = await fetchMasterJson();
                setJson(data);
                setMessage(`Loaded ${data.products?.length || 0} master items.`);
              }}
            >
              View table
            </button>
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-xl font-semibold">Rebuild tuple viewer</h2>
          <p className="mt-2 text-sm text-slate-500">Matches exact identifiers across all marketplaces. Runs in the background; the page remains usable.</p>
          <button
            className="primary-button mt-5"
            onClick={rebuild}
            disabled={progress?.running}
          >
            {progress?.running ? "Rebuilding..." : "Rebuild tuples"}
          </button>
          {progress && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{progress.message}</span>
                <span>{progress.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {message}
        </div>
      )}

      {rows.length > 0 && (
        <div className="panel mt-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">Master Catalog Mapping</h3>
              <p className="text-xs text-slate-500">Showing {Math.min(100, rows.length)} of {rows.length.toLocaleString()} items</p>
            </div>
            <button
              className="text-xs font-semibold text-cyan-600 hover:text-cyan-700"
              onClick={() => setJson(null)}
            >
              Close Table
            </button>
          </div>
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300 shadow-sm">
                <tr>
                  {columns.map(key => (
                    <th className="whitespace-nowrap px-4 py-3" key={key}>
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.slice(0, 100).map((row, index) => (
                  <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50" key={index}>
                    {columns.map(key => {
                      const val = row[key];
                      const displayVal = val !== undefined && val !== null && String(val).trim() !== "" ? String(val) : "—";
                      return (
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-slate-600 dark:text-slate-400" key={key}>
                          {displayVal}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ScraperControlPage() {
  const sites = ["amazon", "ajio", "myntra", "columbia", "adventure", "tatacliq", "tata_lux", "flipkart"];
  const [status, setStatus] = useState({});
  const [message, setMessage] = useState("");
  const [workers, setWorkers] = useState(4);
  const [sellers, setSellers] = useState([
    { id: "AUEEW31YCNC4K", name: "Chogori" },
    { id: "A1WYWER0W24N8S", name: "Cocoblu" },
    { id: "A28E8JCZPT1G5K", name: "Columbia India" }
  ]);
  const [newSellerCode, setNewSellerCode] = useState("");
  const [newSellerLabel, setNewSellerLabel] = useState("");
  const [files, setFiles] = useState([]);
  const [fileOpen, setFileOpen] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [openLogs, setOpenLogs] = useState({ amazon: true });

  const refresh = async () => {
    try {
      const res = await fetchFastScraperStatus();
      setStatus(res.processes || {});
    } catch {}
  };

  useEffect(() => {
    refresh();
    fetchAmazonSellers()
      .then(res => {
        if (res?.sellers?.length) {
          setSellers(res.sellers);
        }
      })
      .catch(() => {});
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);

  const start = async sitesToRun => {
    try {
      const options = sitesToRun.includes("amazon") ? { workers, sellers } : {};
      await startFastScrapers(sitesToRun, options);
      setMessage(`Started ${sitesToRun.map(s => formatSiteName(s)).join(", ")}.`);
      refresh();
    } catch (error) {
      setMessage(error.response?.data?.detail || "Could not start scrapers.");
    }
  };

  const handleSaveSellers = async () => {
    try {
      await saveAmazonSellers(sellers);
      setMessage("Amazon seller settings saved.");
    } catch {
      setMessage("Could not save seller settings.");
    }
  };

  const handleAddSeller = () => {
    const code = newSellerCode.trim();
    if (!code) return;
    const label = newSellerLabel.trim() || code;
    if (sellers.some(s => s.id.toLowerCase() === code.toLowerCase())) {
      setMessage(`Seller ${code} is already added.`);
      return;
    }
    const updated = [...sellers, { id: code, name: label }];
    setSellers(updated);
    setNewSellerCode("");
    setNewSellerLabel("");
    saveAmazonSellers(updated).catch(() => {});
  };

  const handleRemoveSeller = index => {
    const updated = sellers.filter((_, i) => i !== index);
    setSellers(updated);
    saveAmazonSellers(updated).catch(() => {});
  };

  const openFiles = async () => {
    setFileOpen(true);
    try {
      setFiles((await fetchDataFiles()).files || []);
    } catch {}
  };

  const toggleLogs = site => {
    setOpenLogs(prev => ({ ...prev, [site]: !prev[site] }));
  };

  const getPercent = state => {
    if (state?.percentage !== undefined) return state.percentage;
    if (state?.total) return Math.min(100, Math.round(((state.current || 0) / state.total) * 100));
    return 0;
  };

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-600 dark:text-cyan-400">Operations</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">Scraper control center</h1>
          <p className="mt-1 text-sm text-slate-500">Each marketplace runs independently with its own progress and activity log.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="secondary-button"
            onClick={async () => {
              try {
                await openScraperProfile();
                setMessage("Browser profile opened for sign-in.");
              } catch {
                setMessage("Could not open profile.");
              }
            }}
          >
            Load Profile
          </button>
          <button className="secondary-button" onClick={openFiles}>
            Data Files
          </button>
          <button
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400 transition"
            onClick={() => start(sites)}
          >
            Start All
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {sites.map(site => {
          const state = status[site] || {};
          const isRunning = Boolean(state.running);
          const percent = getPercent(state);
          const pagesVal = `${state.current || 0}/${state.total || 0}`;
          const etaVal = state.eta_text || (isRunning ? "calculating" : "0s");
          const isLogsOpen = Boolean(openLogs[site]);

          let statusText = "Ready to run";
          if (isRunning) {
            statusText = state.stage || "Scraping in progress...";
          } else if (state.stage === "Completed" || percent === 100) {
            statusText = "✓ Scraping completed";
          } else if (state.stage === "Queued") {
            statusText = state.message || "Waiting in queue...";
          } else if (state.stage === "Re-queued (Retry)") {
            statusText = "⚠ Output 0KB/failed - waiting for retry";
          } else if (state.stage) {
            statusText = state.stage;
          }

          return (
            <article
              className="panel flex flex-col justify-between p-6 transition-shadow hover:shadow-md"
              key={site}
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold tracking-wide text-slate-900 dark:text-white">
                      {formatSiteHeader(site)}
                    </h2>
                    <p className={`mt-1 text-xs font-medium ${state.stage === "Completed" || percent === 100 ? "text-teal-600 dark:text-teal-400" : state.stage === "Queued" ? "text-amber-600 dark:text-amber-400" : state.stage === "Re-queued (Retry)" ? "text-rose-600 dark:text-rose-400" : "text-slate-500"}`}>
                      {statusText}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${
                      isRunning
                        ? "bg-cyan-500/15 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300"
                        : state.stage === "Queued"
                        ? "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                        : state.stage === "Re-queued (Retry)"
                        ? "bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-ping" />}
                    {isRunning ? "Running" : state.stage === "Queued" ? "Queued" : state.stage === "Re-queued (Retry)" ? "Retrying" : "Idle"}
                  </span>
                </div>

                {/* 3-Metrics Bar */}
                <div className="mt-5 grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 text-center dark:divide-slate-700/60 dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="px-1">
                    <p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200 truncate" title={pagesVal}>
                      {pagesVal}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      PAGES
                    </p>
                  </div>
                  <div className="px-1">
                    <p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200 truncate" title={etaVal}>
                      {etaVal}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      ETA
                    </p>
                  </div>
                  <div className="px-1">
                    <p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {percent}%
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      DONE
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>

                {/* Amazon Settings & Sellers */}
                {site === "amazon" && (
                  <div className="mt-4">
                    <button
                      className="flex w-full items-center justify-between py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                      onClick={() => setOpenSettings(prev => !prev)}
                    >
                      <span>Settings &amp; Sellers</span>
                      <span className="font-mono text-[10px] text-slate-400">{openSettings ? "▲ Hide" : "▼ Show"}</span>
                    </button>
                    {openSettings && (
                      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Concurrent tabs
                          <input
                            className="ml-2 w-12 rounded-lg border border-slate-300 bg-white p-1 text-center font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                            type="number"
                            min="1"
                            max="20"
                            value={workers}
                            onChange={e => setWorkers(Number(e.target.value))}
                          />
                        </label>
                      </div>
                      <button
                        className="text-xs font-semibold text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                        onClick={handleSaveSellers}
                      >
                        Save settings
                      </button>
                    </div>

                    <p className="mt-2 text-[11px] text-slate-500">
                      Saved sellers applied to every Amazon run.
                    </p>

                    {/* Seller Bubbles */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {sellers.map((seller, index) => (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300/80 bg-white px-3 py-1 text-xs font-medium text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          key={index}
                        >
                          <span>{seller.name ? `${seller.name} - ` : ""}{seller.id}</span>
                          <button
                            className="text-slate-400 hover:text-rose-500 font-bold ml-0.5 leading-none"
                            onClick={() => handleRemoveSeller(index)}
                            title="Remove seller"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    {/* Add Seller Form */}
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        placeholder="Seller Code"
                        value={newSellerCode}
                        onChange={e => setNewSellerCode(e.target.value)}
                      />
                      <input
                        className="w-28 rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        placeholder="Label"
                        value={newSellerLabel}
                        onChange={e => setNewSellerLabel(e.target.value)}
                      />
                      <button
                        className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400 transition"
                        onClick={handleAddSeller}
                      >
                        Add
                      </button>
                    </div>
                      </div>
                    )}
                  </div>
                )}{/* Raw Logs Accordion */}
                <div className="mt-4">
                  <button
                    className="flex w-full items-center justify-between py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    onClick={() => toggleLogs(site)}
                  >
                    <span>Raw Logs</span>
                    <span className="font-mono text-[10px] text-slate-400">{isLogsOpen ? "▲ Hide" : "▼ Show"}</span>
                  </button>
                  {isLogsOpen && (
                    <div className="mt-2 overflow-hidden rounded-xl border border-slate-800 bg-[#060b13] p-3 shadow-inner">
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800/80 text-[10px] text-slate-500 font-mono">
                        <span>Console output</span>
                        <span>{isRunning ? "Streaming live" : "Idle"}</span>
                      </div>
                      <pre className="max-h-44 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap select-text">
                        {state.logs || "No log entries yet."}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Start Scraper Button */}
              <div className="mt-5">
                <button
                  className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition"
                  onClick={() => start([site])}
                  disabled={isRunning}
                >
                  {isRunning ? `Running ${formatSiteHeader(site)}...` : "Start scraper"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {fileOpen && (
        <DataFilesDialog
          files={files}
          onRefresh={async () => setFiles((await fetchDataFiles()).files || [])}
          onClose={() => setFileOpen(false)}
          onMessage={setMessage}
        />
      )}

      {message && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {message}
        </div>
      )}
    </section>
  );
}

function DataFilesDialog({ files, onRefresh, onClose, onMessage }) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [confirm, setConfirm] = useState(null);

  const groups = files
    .filter(file => file.path.toLowerCase().includes(query.toLowerCase()))
    .reduce((result, file) => {
      const group = file.path.split("/")[0] || "Other";
      (result[group] ||= []).push(file);
      return result;
    }, {});

  const remove = async file => {
    try {
      await deleteDataFile(file.path);
      setConfirm(null);
      onRefresh();
      onMessage(`Deleted ${file.path.split("/").at(-1)}.`);
    } catch {
      onMessage("Could not delete file.");
    }
  };

  const download = async file => {
    try {
      const payload = await readDataFile(file.path);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.path.split("/").at(-1);
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      onMessage("Could not download this file.");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-[28px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-cyan-600 dark:text-cyan-400">Workspace storage</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">Data Files</h2>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 dark:bg-slate-800 text-xl font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex flex-wrap gap-2 p-5">
          <input
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400"
            placeholder="Search files"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <button className="secondary-button" onClick={onRefresh}>
            Refresh
          </button>
          <button
            className="secondary-button"
            onClick={async () => {
              try {
                await openDataFolder();
                onMessage("Data folder opened.");
              } catch {
                onMessage("Could not open data folder.");
              }
            }}
          >
            Open Folder
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5">
          {Object.entries(groups).map(([group, groupFiles]) => (
            <section className="mb-4" key={group}>
              <button
                className="flex w-full items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-left font-semibold text-slate-800 dark:text-slate-200"
                onClick={() => setCollapsed(value => ({ ...value, [group]: !value[group] }))}
              >
                <span className="capitalize">{group}</span>
                <span className="text-sm text-slate-400">{collapsed[group] ? "+ Expand" : "− Collapse"}</span>
              </button>
              {!collapsed[group] && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {groupFiles.map(file => (
                    <div
                      className="group flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 transition hover:border-cyan-300 hover:shadow-md"
                      key={file.path}
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 font-mono">
                        ▤
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{file.path.split("/").at(-1)}</p>
                        <p className="text-xs text-slate-500">
                          {(file.size / 1024).toFixed(1)} KB · {new Date(file.modified).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          title="Download"
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                          onClick={() => download(file)}
                        >
                          ↓
                        </button>
                        <button
                          title="Delete"
                          className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          onClick={() => setConfirm(file)}
                        >
                          ⌫
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
          {!Object.keys(groups).length && (
            <div className="p-10 text-center text-sm text-slate-500">No matching data files.</div>
          )}
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl max-w-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Delete {confirm.path.split("/").at(-1)}?</h3>
            <p className="mt-2 text-sm text-slate-500">This file will be permanently removed.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="secondary-button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="primary-button !bg-rose-600 hover:!bg-rose-700" onClick={() => remove(confirm)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PortalViewDataPage() {
  const [payload, setPayload] = useState({ products: {} }), [query, setQuery] = useState(""), [detail, setDetail] = useState(null);
  useEffect(() => { fetchTuples().then(setPayload).catch(() => {}); }, []);
  const sites = ["amazon", "ajio", "adventure", "columbia", "myntra", "tatacliq", "tata_lux", "flipkart"];
  const rows = Object.entries(payload.products || {}).filter(([key, row]) => `${key} ${row.sku || ""} ${(row.ean_numbers || []).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.24em] text-cyan-600">Catalog workspace</p><h1 className="mt-2 text-4xl font-semibold">Tuple viewer</h1></div><a className="secondary-button" href={getTuplesExportUrl()}>Export to Excel</a></div><input className="mt-6 w-full rounded-2xl border border-slate-200 bg-white p-4" placeholder="Search SKU, EAN, or tuple ID" value={query} onChange={event => setQuery(event.target.value)}/><div className="mt-5 grid gap-3">{rows.map(([key, row]) => <button className="panel flex items-center gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300" key={key} onClick={() => setDetail({ key, row })}><div className="grid h-12 w-12 place-items-center rounded-xl bg-sky-50 text-cyan-700">▦</div><div className="min-w-0 flex-1"><p className="font-semibold">{row.sku || key}</p><p className="mt-1 truncate text-sm text-slate-500">EAN: {(row.ean_numbers || []).join(", ") || "Not available"}</p></div><span className="text-cyan-600">View details →</span></button>)}{!rows.length && <div className="panel p-10 text-center text-slate-500">No datasets available. Import or generate one first.</div>}</div>{detail && <ProductDetailsPortal detail={detail} sites={sites} onClose={() => setDetail(null)}/>}</section>;
}

function ProductDetailsPortal({ detail, sites, onClose }) {
  useEffect(() => { const previous = document.body.style.overflow; const escape = event => event.key === "Escape" && onClose(); document.body.style.overflow = "hidden"; window.addEventListener("keydown", escape); return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", escape); }; }, [onClose]);
  return createPortal(<div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={onClose}><div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between border-b border-slate-200 p-6"><div><p className="text-xs uppercase tracking-[.2em] text-slate-400">Product details</p><h2 className="mt-1 text-2xl font-semibold">{detail.row.sku || detail.key}</h2><p className="mt-1 text-sm text-slate-500">EAN: {(detail.row.ean_numbers || []).join(", ") || "Not available"}</p></div><button className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-xl" onClick={onClose}>×</button></div><div className="overflow-y-auto p-6"><h3 className="text-sm font-semibold uppercase tracking-[.18em] text-slate-400">Marketplace comparison</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{sites.map(site => { const listing = detail.row[site]; return <div className="rounded-2xl border border-slate-200 p-4" key={site}><div className="flex justify-between"><span className="font-semibold capitalize">{formatSiteName(site)}</span><span className="text-cyan-700">{listing?.price ?? listing?.normal_price ?? "—"}</span></div><p className="mt-2 text-sm text-slate-500">{listing?.title || "No listing available"}</p>{listing?.url && <a className="mt-3 inline-flex text-sm font-semibold text-cyan-700" href={listing.url} target="_blank" rel="noreferrer">Open listing →</a>}</div>; })}</div><h3 className="mt-8 text-sm font-semibold uppercase tracking-[.18em] text-slate-400">Metadata</h3><div className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Tuple ID: {detail.key}<br/>SKU: {detail.row.sku || "Not available"}</div></div></div></div>, document.body);
}

function ViewDataPage() {
  const [payload, setPayload] = useState({ products: {} });
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "amazon", asc: false });
  const [detail, setDetail] = useState(null);

  useEffect(() => { fetchTuples().then(setPayload).catch(() => {}); }, []);
  useEffect(() => {
    if (!detail) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = event => { if (event.key === "Escape") setDetail(null); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [detail]);

  const rows = Object.entries(payload.products || {})
    .filter(([key, row]) => (key + " " + (row.sku || "") + " " + (row.ean_numbers || []).join(" ")).toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const av = sort.key === "sku" ? a[1].sku : sort.key === "ean" ? (a[1].ean_numbers || []).join() : (a[1][sort.key]?.price ?? a[1][sort.key]?.normal_price ?? "");
      const bv = sort.key === "sku" ? b[1].sku : sort.key === "ean" ? (b[1].ean_numbers || []).join() : (b[1][sort.key]?.price ?? b[1][sort.key]?.normal_price ?? "");
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * (sort.asc ? 1 : -1);
    });

  const sites = ["amazon", "ajio", "adventure", "columbia", "myntra", "tatacliq", "tata_lux", "flipkart"];
  const toggle = key => { setSort(current => ({ key, asc: current.key === key ? !current.asc : true })); setPage(1); };
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const display = rows.slice((page - 1) * 25, page * 25);

  return (
    <section className="mx-auto flex h-[calc(100vh-80px)] max-w-[1600px] flex-col px-4 py-6 sm:px-6 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.24em] text-cyan-600 dark:text-cyan-400">Catalog Database</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">View data</h1>
        </div>
        <a className="secondary-button" href={getTuplesExportUrl()}>Export to Excel</a>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <input
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-900 placeholder:text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white shadow-sm"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(1); }}
          placeholder="Search SKU, EAN, or tuple ID..."
        />
        <span className="whitespace-nowrap text-xs font-medium text-slate-500">{rows.length.toLocaleString()} tuples</span>
      </div>

      {/* Internal scrollable table container - page does NOT scroll */}
      <div className="panel mt-4 flex-1 overflow-auto rounded-2xl border border-slate-200 shadow-inner dark:border-slate-800">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold shadow-sm">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="p-3">Image</th>
              <th className="cursor-pointer p-3 hover:text-cyan-600" onClick={() => toggle("sku")}>SKU ↕</th>
              <th className="cursor-pointer p-3 hover:text-cyan-600" onClick={() => toggle("ean")}>EAN ↕</th>
              {sites.map(site => (
                <th onClick={() => toggle(site)} key={site} className="cursor-pointer p-3 hover:text-cyan-600">
                  {formatSiteName(site)} ↕
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {display.map(([key, row]) => {
              const image = sites.map(site => row[site]?.image).find(Boolean);
              return (
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors" key={key}>
                  <td className="p-2">
                    {image ? (
                      <img src={image} className="h-10 w-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shadow-sm" alt="Product" />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-800 grid place-items-center text-xs text-slate-400">▦</div>
                    )}
                  </td>
                  <td className="cursor-pointer p-3 font-semibold text-cyan-600 hover:text-cyan-700 underline" onClick={() => setDetail({ key, row, image })}>
                    {row.sku || key}
                  </td>
                  <td className="p-3 text-xs font-mono text-slate-600 dark:text-slate-400">{(row.ean_numbers || []).join(", ") || "—"}</td>
                  {sites.map(site => {
                    const item = row[site];
                    const first = item?.price;
                    const second = item?.normal_price;
                    return (
                      <td className="p-3 text-xs" key={site}>
                        {item?.url ? (
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-cyan-600 hover:underline">
                            <span className="font-semibold text-slate-900 dark:text-white">{first ?? "—"}</span>
                            {second && <span className="block text-[11px] text-slate-400 line-through">{second}</span>}
                          </a>
                        ) : (
                          <>
                            <span className="font-semibold text-slate-900 dark:text-white">{first ?? "—"}</span>
                            {second && <span className="block text-[11px] text-slate-400 line-through">{second}</span>}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-slate-500">Showing page {page} of {pages} ({rows.length.toLocaleString()} items)</span>
        <div className="flex items-center gap-2">
          <button className="secondary-button !py-1.5 !text-xs" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="px-2 text-xs font-medium">Page {page} of {pages}</span>
          <button className="secondary-button !py-1.5 !text-xs" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>

      {/* Portaled modal: attached to document.body, perfectly viewport-centered */}
      {detail && createPortal(
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div className="flex gap-4">
                {detail.image && (
                  <img className="h-20 w-20 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm" src={detail.image} alt="Detail" />
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-600 dark:text-cyan-400">Product Mapping</p>
                  <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{detail.row.sku || detail.key}</h2>
                  <p className="text-xs text-slate-500">EAN: {(detail.row.ean_numbers || []).join(", ") || "Not available"}</p>
                </div>
              </div>
              <button className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-lg font-bold text-slate-500 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white" onClick={() => setDetail(null)}>×</button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              <h3 className="text-xs font-bold uppercase tracking-[.18em] text-slate-400">Marketplace Listings</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {sites.map(site => (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40" key={site}>
                    <div className="flex items-center justify-between">
                      <b className="capitalize text-slate-800 dark:text-slate-200">{formatSiteName(site)}</b>
                      <span className="font-semibold text-cyan-700 dark:text-cyan-400">{detail.row[site]?.price ?? detail.row[site]?.normal_price ?? "—"}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">{detail.row[site]?.title || "No listing found"}</p>
                    {detail.row[site]?.url && (
                      <a className="mt-2 inline-block text-xs font-semibold text-cyan-600 hover:underline" target="_blank" rel="noreferrer" href={detail.row[site].url}>
                        Open listing →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}

function AnalysisPage() {
  const [data, setData] = useState({ changes: [] }); const [selected, setSelected] = useState(null); const [platform, setPlatform] = useState("amazon");
  useEffect(() => { fetchPriceHistory().then(setData).catch(() => {}); }, []);
  const points = selected?.history || []; const prices = points.map(x => Number(x.price)).filter(Number.isFinite); const min = Math.min(...prices, 0), max = Math.max(...prices, 1);
  const path = prices.map((price, i) => (i ? "L" : "M") + (i * (300 / Math.max(1, prices.length - 1))) + " " + (120 - ((price - min) / Math.max(1, max - min)) * 110)).join(" ");
  const changes = (data.changes || []).filter(item => platform === "all" || item.site === platform).sort((a, b) => String(b.last_changed).localeCompare(String(a.last_changed)));
  return (
    <section className="mx-auto flex h-[calc(100vh-80px)] max-w-[1600px] flex-col px-4 py-6 sm:px-6 xl:px-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Analysis</h1>
        <p className="mt-1 text-sm text-slate-500">Products whose prices changed across scraper runs.</p>
        <select className="mt-3 rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-white" value={platform} onChange={e => setPlatform(e.target.value)}>
          <option value="all">All platforms</option>
          {[...new Set((data.changes || []).map(item => item.site))].map(site => <option value={site} key={site}>{formatSiteName(site)}</option>)}
        </select>
      </div>

      <div className="panel mt-4 flex-1 overflow-auto rounded-2xl border border-slate-200 shadow-inner dark:border-slate-800">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold shadow-sm">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="p-3">Site</th><th className="p-3">Product</th><th className="p-3">Previous</th><th className="p-3">Current</th><th className="p-3">Changed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {changes.map(item => (
              <tr className="cursor-pointer transition hover:bg-cyan-500/10" onClick={() => setSelected(item)} key={item.site + item.product_id}>
                <td className="p-3 capitalize font-semibold">{formatSiteName(item.site)}</td>
                <td className="p-3 font-medium text-cyan-600 underline">{item.product_id}</td>
                <td className="p-3 text-slate-500">{item.previous}</td>
                <td className="p-3 font-semibold text-slate-900 dark:text-white">{item.current}</td>
                <td className="p-3 text-xs text-slate-500">{item.last_changed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && createPortal(
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-5 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="panel w-full max-w-2xl p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <button className="float-right text-xl font-bold text-slate-500 hover:text-slate-900" onClick={() => setSelected(null)}>×</button>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{formatSiteName(selected.site)} · {selected.product_id}</h2>
            <svg className="mt-5 w-full" viewBox="0 0 300 130"><path d="M0 120H300" stroke="currentColor" opacity=".2"/><path d={path} fill="none" stroke="#06b6d4" strokeWidth="3"/></svg>
            <div className="mt-4 max-h-48 overflow-y-auto space-y-1 text-xs font-mono text-slate-600 dark:text-slate-400">
              {points.map((point, i) => <p key={i}>{point.observed_at || point.scraped_date}: {point.price}</p>)}
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}

const premiumMoney = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0);
const premiumDate = value => value ? new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "—";

function ChangedPricesAnalysisPage() {
  const [data, setData] = useState({ changes: [], sites: [] });
  const [selectedSites, setSelectedSites] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => { fetchPriceHistory().then(payload => { setData(payload); setSelectedSites(payload.sites || []); }).catch(() => {}); }, []);
  const sites = data.sites || [];
  const changes = (data.changes || []).filter(item => selectedSites.includes(item.site));
  const toggle = site => setSelectedSites(current => current.includes(site) ? current.filter(value => value !== site) : [...current, site]);

  return (
    <section className="mx-auto flex h-[calc(100vh-80px)] max-w-[1600px] flex-col px-4 py-6 sm:px-6 xl:px-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.28em] text-cyan-600 dark:text-cyan-400">Marketplace intelligence</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Changed prices</h1>
        <p className="mt-1 text-sm text-slate-500">Only products with a recorded price movement are shown.</p>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Filter marketplaces</p>
          <button className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 hover:underline" onClick={() => setSelectedSites(selectedSites.length === sites.length ? [] : sites)}>
            {selectedSites.length === sites.length ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {sites.map(site => (
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${selectedSites.includes(site) ? "border-cyan-400 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300" : "border-slate-200 text-slate-500 dark:border-slate-700"}`} key={site}>
              <input type="checkbox" checked={selectedSites.includes(site)} onChange={() => toggle(site)}/>
              <span>{formatSiteName(site)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Internal scrollable table container - page does NOT scroll */}
      <div className="panel mt-4 flex-1 overflow-auto rounded-2xl border border-slate-200 shadow-inner dark:border-slate-800">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold shadow-sm">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="p-4">Marketplace</th>
              <th className="p-4">Product</th>
              <th className="p-4">Previous</th>
              <th className="p-4">Current</th>
              <th className="p-4">Last observed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {changes.map(item => (
              <tr key={`${item.site}-${item.product_id}`} className="cursor-pointer transition hover:bg-sky-50/70 dark:hover:bg-slate-800/50" onClick={() => setSelected(item)}>
                <td className="p-4 font-semibold text-slate-800 dark:text-slate-200">{formatSiteName(item.site)}</td>
                <td className="p-4 font-medium text-cyan-600 underline">{item.product_id}</td>
                <td className="p-4 text-slate-500">{premiumMoney(item.previous)}</td>
                <td className={`p-4 font-bold ${Number(item.current) >= Number(item.previous) ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {premiumMoney(item.current)}
                </td>
                <td className="p-4 text-xs text-slate-500">{premiumDate(item.last_changed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!changes.length && (
        <div className="panel mt-4 p-8 text-center text-sm text-slate-500">
          No price changes for the selected marketplaces yet. Future scraper runs will appear here.
        </div>
      )}

      {selected && <PremiumPriceModal item={selected} onClose={() => setSelected(null)}/>}
    </section>
  );
}

function PremiumAnalysisPage() {
  const [data, setData] = useState({ changes: [] });
  const [selected, setSelected] = useState(null);
  const [platform, setPlatform] = useState("all");
  useEffect(() => { fetchPriceHistory().then(setData).catch(() => {}); }, []);
  const changes = (data.changes || []).filter(item => platform === "all" || item.site === platform);
  const availableSites = data.sites?.length ? data.sites : [...new Set((data.changes || []).map(item => item.site))];
  return <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 xl:px-8"><p className="text-xs font-semibold uppercase tracking-[.28em] text-cyan-600">Marketplace intelligence</p><h1 className="mt-2 text-4xl font-semibold">Price history</h1><p className="mt-2 text-sm text-slate-500">Select a product to open its interactive analytics view.</p><select className="mt-5 rounded-xl border p-3 text-slate-900" value={platform} onChange={e => setPlatform(e.target.value)}><option value="all">All platforms</option>{[...new Set((data.changes || []).map(item => item.site))].map(site => <option key={site}>{site}</option>)}</select><div className="panel mt-6 overflow-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr className="border-b"><th className="p-4">Marketplace</th><th className="p-4">Product</th><th className="p-4">Previous</th><th className="p-4">Current</th><th className="p-4">Last observed</th></tr></thead><tbody>{changes.map(item => <tr key={`${item.site}-${item.product_id}`} className="cursor-pointer border-b border-slate-200 transition hover:bg-sky-50" onClick={() => setSelected(item)}><td className="p-4 capitalize">{item.site}</td><td className="p-4 font-medium">{item.product_id}</td><td className="p-4">{premiumMoney(item.previous)}</td><td className="p-4 font-semibold text-cyan-700">{premiumMoney(item.current)}</td><td className="p-4 text-slate-500">{premiumDate(item.last_changed)}</td></tr>)}</tbody></table></div>{!changes.length && <div className="panel mt-6 p-10 text-center text-slate-500">No price changes have been recorded yet.</div>}{selected && <PremiumPriceModal item={selected} onClose={() => setSelected(null)} />}</section>;
}

function PremiumPriceModal({ item, onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  const raw = (item.history || []).map((point, index) => ({ date: point.observed_at || point.scraped_date, price: Number(point.price), index })).filter(point => Number.isFinite(point.price));
  const points = raw.map((point, index) => ({ ...point, previous: index ? raw[index - 1].price : null, difference: index ? point.price - raw[index - 1].price : 0, percentage: index && raw[index - 1].price ? (point.price - raw[index - 1].price) / raw[index - 1].price * 100 : 0 }));
  const prices = points.map(point => point.price);
  const latestPrice = points.at(-1)?.price ?? Number(item.current);
  const current = latestPrice || 0;
  const previousRecordPrice = Number(item.previous);
  const previous = points.length > 1 ? points.at(-2).price : (previousRecordPrice || current);
  const difference = current - previous;
  const percentage = previous ? difference / previous * 100 : 0;
  const cards = [["Current Price", premiumMoney(current), "text-cyan-700"], ["Previous Price", premiumMoney(previous), ""], ["Difference", `${difference >= 0 ? "+" : "−"}${premiumMoney(Math.abs(difference))}`, difference >= 0 ? "text-emerald-600" : "text-rose-600"], ["Percentage Change", `${percentage >= 0 ? "+" : ""}${percentage.toFixed(1)}%`, percentage >= 0 ? "text-emerald-600" : "text-rose-600"], ["Lowest Price", premiumMoney(Math.min(...prices)), ""], ["Highest Price", premiumMoney(Math.max(...prices)), ""]];
  return createPortal(<div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/70 p-3 sm:p-6 backdrop-blur-sm" onClick={onClose}><div className="my-auto w-full max-w-6xl rounded-[28px] bg-white p-4 shadow-2xl sm:p-7 dark:bg-slate-900 border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.24em] text-slate-400">{item.site}</p><h2 className="mt-1 text-2xl font-semibold text-slate-950">{item.product_id}</h2></div><button className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-xl text-slate-500" onClick={onClose}>×</button></div><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{cards.map(([label, value, tone]) => <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" key={label}><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-slate-400">{label}</p><p className={`mt-2 truncate text-lg font-semibold ${tone}`}>{value}</p></div>)}</div>{points.length < 2 ? <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">Only one historical record available. Price history will appear after future scraper runs.</div> : <><div className="mt-6 rounded-3xl border border-slate-200 bg-gradient-to-b from-sky-50/80 to-white p-3 sm:p-5"><div className="h-[280px] w-full sm:h-[360px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={points} margin={{ top: 18, right: 18, left: 4, bottom: 8 }}><defs><linearGradient id="premiumPriceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35}/><stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid stroke="#0f172a" strokeOpacity={0.08} vertical={false}/><XAxis dataKey="date" tickFormatter={value => premiumDate(value).replace(/, \d{4}/, "")} tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false}/><YAxis domain={[min => Math.max(0, Math.floor(min * .96)), max => Math.ceil(max * 1.04)]} tickFormatter={value => `₹${Math.round(value).toLocaleString("en-IN")}`} tick={{ fill: "#64748b", fontSize: 12 }} axisLine={false} tickLine={false} width={72}/><Tooltip content={<PremiumTooltip />} cursor={{ stroke: "#38bdf8", strokeOpacity: .25 }}/><Area type="monotone" dataKey="price" stroke="none" fill="url(#premiumPriceArea)" isAnimationActive animationDuration={850}/><Line type="monotone" dataKey="price" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 7, fill: "#fff", stroke: "#0ea5e9", strokeWidth: 3 }} activeDot={{ r: 9, fill: "#0ea5e9", stroke: "#fff", strokeWidth: 3 }} isAnimationActive animationDuration={950}/></ComposedChart></ResponsiveContainer></div></div><div className="mt-7"><h3 className="text-sm font-semibold uppercase tracking-[.18em] text-slate-400">Timeline</h3><div className="mt-3 space-y-2">{points.map((point, index) => <div className="flex items-center gap-4 rounded-2xl border border-slate-200 px-4 py-3" key={`${point.date}-${index}`}><div className="w-20 text-xs font-semibold text-slate-500">{premiumDate(point.date).replace(/, \d{4}/, "")}</div><div className="font-semibold text-slate-900">{premiumMoney(point.price)}</div>{index > 0 && <div className={`ml-auto text-sm font-medium ${point.difference >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{point.difference >= 0 ? "↑ Increased by " : "↓ Decreased by "}{premiumMoney(Math.abs(point.difference))}</div>}</div>)}</div></div></>}</div></div>, document.body);
}

function PremiumTooltip({ active, payload }) { if (!active || !payload?.length) return null; const point = payload[0].payload; return <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white shadow-xl"><p className="text-xs text-white/60">{premiumDate(point.date)}</p><p className="mt-1 text-lg font-semibold">{premiumMoney(point.price)}</p>{point.previous !== null && <><p className={`mt-1 text-xs font-medium ${point.difference >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{point.difference >= 0 ? "↑ +" : "↓ −"}{premiumMoney(Math.abs(point.difference))}</p><p className="text-xs text-white/60">{point.percentage >= 0 ? "+" : ""}{point.percentage.toFixed(1)}%</p></>}</div>; }

function MetricCard({ label, value, meta }) {
  return (
    <div className="metric-card">
      <p className="text-xs uppercase tracking-[0.26em] text-slate-500 dark:text-white/42">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        <span className="text-xs text-slate-500 dark:text-white/42">{meta}</span>
      </div>
    </div>
  );
}

function AnalyticsTile({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-950/8 bg-slate-950/[0.025] p-4 dark:border-white/8 dark:bg-white/[0.045]">
      <p className="text-xs text-slate-500 dark:text-white/42">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}

function ScoreTile({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-950/[0.035] p-3 dark:bg-white/[0.055]">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-white/38">{label}</p>
      <p className="mt-1 truncate font-semibold">{value}</p>
    </div>
  );
}

function ResultTab({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`tab-button ${active ? "is-active" : ""}`}>
      {children}
    </button>
  );
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function getConfidence(score) {
  if (score === undefined || score === null) return "Unknown";
  if (score >= 0.88) return "High";
  if (score >= 0.72) return "Medium";
  return "Low";
}

function formatStatus(status) {
  if (status === "flagged") return "Review";
  if (status === "medium") return "Medium";
  return "Accurate";
}

// ─── CSS ADDITIONS (inject into your stylesheet) ──────────────────────────────
// Add these rules to your existing CSS file alongside the current styles.
//
// .image-result-group {
//   animation: fadeUp 0.4s ease both;
//   border: 1px solid rgba(0,0,0,0.07);
//   border-radius: 1.75rem;
//   background: rgba(255,255,255,0.55);
//   padding: 1.5rem;
// }
// .dark .image-result-group {
//   border-color: rgba(255,255,255,0.08);
//   background: rgba(255,255,255,0.035);
// }
// .image-group-header {
//   display: flex;
//   gap: 1.5rem;
//   align-items: flex-start;
//   padding-bottom: 1.5rem;
//   border-bottom: 1px solid rgba(0,0,0,0.07);
//   margin-bottom: 1.5rem;
// }
// .dark .image-group-header { border-color: rgba(255,255,255,0.08); }
// .reference-image-wrap { flex-shrink: 0; }
// .reference-image {
//   width: 130px;
//   height: 130px;
//   border-radius: 1rem;
//   object-fit: cover;
//   border: 1px solid rgba(0,0,0,0.1);
// }
// .dark .reference-image { border-color: rgba(255,255,255,0.1); }
// .reference-image-placeholder {
//   display: grid;
//   place-items: center;
//   background: rgba(0,0,0,0.06);
//   font-size: 0.7rem;
//   color: rgba(0,0,0,0.4);
// }
// .dark .reference-image-placeholder { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.3); }
// .image-group-meta { flex: 1; min-width: 0; }
// .group-meta-tile {
//   background: rgba(0,0,0,0.03);
//   border: 1px solid rgba(0,0,0,0.06);
//   border-radius: 0.75rem;
//   padding: 0.6rem 0.75rem;
// }
// .dark .group-meta-tile { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.07); }
// .group-meta-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.2em; color: rgba(0,0,0,0.45); }
// .dark .group-meta-label { color: rgba(255,255,255,0.38); }
// .group-meta-value { margin-top: 0.2rem; font-size: 0.95rem; font-weight: 600; }
// .platform-status-pill {
//   font-size: 0.65rem;
//   text-transform: uppercase;
//   letter-spacing: 0.2em;
//   padding: 0.25rem 0.65rem;
//   border-radius: 999px;
//   border: 1px solid;
// }
// .platform-status-pill.is-active {
//   border-color: rgba(6,182,212,0.4);
//   background: rgba(6,182,212,0.1);
//   color: #0891b2;
// }
// .dark .platform-status-pill.is-active { color: #67e8f9; }
// .platform-status-pill.is-empty {
//   border-color: rgba(0,0,0,0.1);
//   color: rgba(0,0,0,0.35);
// }
// .dark .platform-status-pill.is-empty { border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.3); }
// .platform-cards-grid {
//   display: grid;
//   gap: 1rem;
//   grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
// }
// .platform-card {
//   position: relative;
//   border: 1px solid rgba(0,0,0,0.08);
//   border-radius: 1.25rem;
//   padding: 1.25rem;
//   background: rgba(255,255,255,0.7);
//   transition: box-shadow 0.2s, border-color 0.2s;
//   animation: fadeUp 0.35s ease both;
// }
// .dark .platform-card { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); }
// .platform-card.is-best-match {
//   border-color: rgba(6,182,212,0.45);
//   box-shadow: 0 0 0 1px rgba(6,182,212,0.2), 0 4px 24px rgba(6,182,212,0.12);
// }
// .platform-card.is-empty { opacity: 0.55; }
// .best-match-badge {
//   position: absolute;
//   top: -0.6rem;
//   left: 1rem;
//   background: linear-gradient(135deg, #0891b2, #06b6d4);
//   color: #fff;
//   font-size: 0.6rem;
//   font-weight: 700;
//   text-transform: uppercase;
//   letter-spacing: 0.18em;
//   padding: 0.2rem 0.6rem;
//   border-radius: 999px;
// }
// .platform-card-image-wrap {
//   width: 100%;
//   height: 120px;
//   border-radius: 0.75rem;
//   overflow: hidden;
//   background: rgba(0,0,0,0.04);
// }
// .dark .platform-card-image-wrap { background: rgba(255,255,255,0.04); }
// .platform-card-image { width: 100%; height: 100%; object-fit: cover; }
// .empty-platform-state {
//   min-height: 80px;
//   display: grid;
//   place-items: center;
// }
// .upcoming-integrations-row {
//   padding: 1rem 1.25rem;
//   border: 1px dashed rgba(0,0,0,0.1);
//   border-radius: 1rem;
//   background: rgba(0,0,0,0.015);
// }
// .dark .upcoming-integrations-row { border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
// .upcoming-platform-pill {
//   font-size: 0.7rem;
//   text-transform: uppercase;
//   letter-spacing: 0.2em;
//   padding: 0.3rem 0.75rem;
//   border-radius: 999px;
//   border: 1px dashed rgba(0,0,0,0.15);
//   color: rgba(0,0,0,0.35);
// }
// .dark .upcoming-platform-pill { border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.3); }
//
// .group-counter {
//   display: grid;
//   place-items: center;
//   width: 1.75rem;
//   height: 1.75rem;
//   border-radius: 50%;
//   background: rgba(6,182,212,0.15);
//   color: #0891b2;
//   font-size: 0.7rem;
//   font-weight: 700;
//   flex-shrink: 0;
// }
// .dark .group-counter { background: rgba(6,182,212,0.18); color: #67e8f9; }

// ─── APP ROOT ──────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<GettingStartedPage />} />
          <Route path="/accurate-search" element={<AccurateSearchWorkspace />} />
          <Route path="/workspace" element={<AccurateSearchWorkspace />} />
          <Route path="/improve" element={<ImproveDatasetPage />} />
          <Route path="/scrapers" element={<ScraperControlPage />} />
          <Route path="/view-data" element={<ViewDataPage />} />
          <Route path="/analysis" element={<ChangedPricesAnalysisPage />} />
          <Route path="/improve/:platform" element={<PlatformDatasetPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
