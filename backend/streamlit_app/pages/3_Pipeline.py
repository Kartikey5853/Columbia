import sys
from pathlib import Path
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.master_pipeline import import_master_excel
from processing.platform_paths import NORMALIZED_PRODUCTS
from streamlit_app.ui_common import apply_theme, enable_auto_refresh, module_command, read_json, render_live_panel, start_process, stop_process

apply_theme()
st.title("Pipeline")
enable_auto_refresh()
st.info("Upload the master Excel first. Products are mapped only by its EAN, SKU, style, and marketplace IDs—there is no CLIP, DINO, FAISS, or image matching.")

master_upload = st.file_uploader("Master Excel", type=["xlsx", "xlsm"], help="The sheet requires EAN CODE and/or SKU CODE.")
if master_upload is not None and st.button("Save master Excel", use_container_width=True):
    staging = ROOT / "data" / "Master" / f"upload_{master_upload.name}"
    staging.parent.mkdir(parents=True, exist_ok=True)
    staging.write_bytes(master_upload.getvalue())
    try:
        result = import_master_excel(staging)
        staging.unlink(missing_ok=True)
        st.success(f"Saved master mapping with {len(result['products']):,} rows.")
    except Exception as exc:
        st.error(f"Could not import master Excel: {exc}")

left, right = st.columns(2)
with left:
    if st.button("Build master tuples", type="primary", use_container_width=True):
        start_process("matcher", module_command("pipeline.master_pipeline"))
with right:
    if st.button("Stop pipeline", use_container_width=True):
        stop_process("matcher")

payload = read_json(NORMALIZED_PRODUCTS, {"summary": {}})
summary = payload.get("summary", {})
cols = st.columns(3)
cols[0].metric("Master rows", summary.get("master_rows", summary.get("normalized_products", 0)))
cols[1].metric("Mapped tuples", summary.get("normalized_products", 0))
cols[2].metric("Last build", payload.get("created_at", "-"))
render_live_panel("matcher")
