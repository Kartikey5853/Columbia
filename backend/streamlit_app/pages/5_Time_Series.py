import sys
from pathlib import Path
import streamlit as st
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from processing.json_store import load_json
from processing.platform_paths import PRICE_HISTORY, DATA_DIR
from pipeline.storage import refresh_price_history
from streamlit_app.ui_common import apply_theme

apply_theme(); st.title("Time Series")
st.info("Price history stores every price change, without storing unchanged daily prices.")
if st.button("Refresh price history", type="primary"):
    try:
        result = refresh_price_history()
        st.success(f"Price history refreshed: {result['products_seen']:,} products checked; {result['changes_recorded']:,} changes recorded.")
        st.rerun()
    except Exception as exc:
        st.error(f"Could not refresh price history: {exc}")
store = load_json(PRICE_HISTORY, {"sites": {}})
st.caption(f"Price store last updated: {store.get('updated_at', 'unknown')}")
# The append-only shared ledger is authoritative. The per-site files are old
# exports and can lag behind the dated scraper snapshots.
sites = store.get("sites", {})
if not sites:
    for site in ("amazon", "ajio", "adventure", "columbia", "myntra", "tatacliq"):
        payload = load_json(DATA_DIR / "Price" / f"{site}_prices.json", {})
        if payload.get("products"):
            sites[site] = payload["products"]
site = st.selectbox("Marketplace", list(sites) or ["No price data"])
if site == "No price data": st.stop()
identifier = st.text_input("Product identifier (EAN, SKU, or source product ID)").strip()
if identifier:
    product = sites.get(site, {}).get(identifier)
    if not product: st.warning("No price history found for this identifier."); st.stop()
    if product.get("previous") is not None and product.get("current") != product.get("previous"):
        st.warning(f"Price change detected: {product.get('previous')} → {product.get('current')}")
    history = product.get("history") or []
    if history:
        import pandas as pd
        frame = pd.DataFrame(history)
        time_column = "observed_at" if "observed_at" in frame.columns else "scraped_date"
        st.line_chart(frame, x=time_column, y="price", use_container_width=True)
        st.dataframe(frame, use_container_width=True, hide_index=True)
    else: st.info(f"Current price: {product.get('current', 'NA')}. No change has been recorded yet.")
else:
    changed = []
    for product_id, data in sites.get(site, {}).items():
        history = data.get("history") or []
        if len(history) > 1:
            changed.append({"Product ID": product_id, "Current Price": data.get("current"), "Changes": len(history), "Last Changed": history[-1].get("observed_at", history[-1].get("scraped_date"))})
    st.caption(f"{len(changed):,} products with recorded price changes.")
    st.dataframe(changed, use_container_width=True, hide_index=True)
