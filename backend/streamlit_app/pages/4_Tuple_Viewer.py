import sys
from pathlib import Path
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from processing.excel_export import excel_bytes
from processing.unified_products import flattened_rows, load_normalized_products
from streamlit_app.ui_common import apply_theme

apply_theme(); st.title("Tuple Viewer")
st.info("All master EAN/SKU rows and matched marketplace prices. Use the filter to narrow the table; the full tuple set remains exportable.")
rows = flattened_rows(load_normalized_products())
if not rows: st.info("Upload the master Excel and run the Pipeline first."); st.stop()
query = st.text_input("Filter by EAN, SKU, product ID, title, or price").strip().lower()
display_rows = [r for r in rows if not query or query in " ".join(str(v) for v in r.values()).lower()]
st.caption(f"Showing {len(display_rows):,} of {len(rows):,} master tuples.")
st.download_button("Download tuples.xlsx", excel_bytes(display_rows), "unified_tuples.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
try:
    import pandas as pd
    config = {"Product Image": st.column_config.ImageColumn("Product Image")}
    for column in display_rows[0]:
        if column.endswith("Product URL"): config[column] = st.column_config.LinkColumn(column)
    st.dataframe(pd.DataFrame(display_rows), use_container_width=True, height=680, hide_index=True, column_config=config)
except Exception: st.write(display_rows)
