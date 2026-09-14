import sys
from pathlib import Path
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from processing.unified_products import load_normalized_products, resolve_normalized_product
from streamlit_app.ui_common import apply_theme

apply_theme(); st.title("Search")
st.info("Paste EANs or SKUs, one per line or comma-separated.")
query = st.text_area("EAN / SKU list", height=180, placeholder="8901234567890\nCU0048-464-L/XL")
if st.button("Search uploaded identifiers", type="primary") and query.strip():
    st.session_state["search_identifiers"] = list(dict.fromkeys(x.strip() for x in query.replace(",", "\n").splitlines() if x.strip()))
    st.session_state["search_page"] = 1
identifiers = st.session_state.get("search_identifiers", [])
if not identifiers: st.stop()
if len(identifiers) > 40_000: st.error("Maximum is 40,000 identifiers per search."); st.stop()
payload = load_normalized_products(); found, missing = [], []
for value in identifiers:
    match = resolve_normalized_product(value, payload)
    (found if match else missing).append(match or value)
if missing: st.caption(f"No tuple found for {len(missing):,} identifier(s).")
if not found: st.info("No matching tuples."); st.stop()
page_size = 10; total = (len(found) + page_size - 1) // page_size
page = st.number_input("Results page", 1, total, st.session_state.get("search_page", 1), 1, key="search_page")
start = (page - 1) * page_size
st.caption(f"Showing {start + 1:,}-{min(start + page_size, len(found)):,} of {len(found):,} matched tuples.")
for n, (_key, row) in enumerate(found[start:start + page_size], start + 1):
    with st.expander(f"{n}. {row.get('sku', 'NA')} - {', '.join(row.get('ean_numbers') or [])}", expanded=True):
        cards = [(site, row.get(site)) for site in ("amazon", "ajio", "adventure", "columbia", "myntra", "tatacliq")]
        left, right = st.columns([1, 3])
        with left:
            images = [card.get("image") for _, card in cards if isinstance(card, dict) and card.get("image")]
            if images: st.image(images[0], use_container_width=True)
        with right:
            st.write(f"**EAN:** {', '.join(row.get('ean_numbers') or ['NA'])}")
            st.write(f"**SKU:** {row.get('sku') or 'NA'}")
            for site, card in cards:
                if isinstance(card, dict):
                    price = card.get("price") or card.get("price_value") or card.get("normal_price") or "NA"
                    title = card.get("title") or "NA"
                    product_id = card.get("source_product_id") or card.get("product_id") or "NA"
                    st.write(f"**{site.title()}** - Price: {price} | Title: {title} | Product ID: {product_id}")
                else: st.write(f"**{site.title()}** - NA")
