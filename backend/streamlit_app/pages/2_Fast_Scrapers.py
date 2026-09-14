import sys
from pathlib import Path
import streamlit as st

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from processing.platform_paths import JSON_DIR
from processing.process_status import get_site_status
from streamlit_app.ui_common import apply_theme, fast_scraper_command, render_operational_console, scraper_profile_command, start_process, stop_process

apply_theme()
st.title("Fast Scrapers")
st.info("Runs the JavaScript scrapers in New_Scrapers. A dedicated Playwright Chrome profile opens AJIO, Myntra, Columbia, Adventuras, and Tata Cliq together as tabs, saves their JSON, and rebuilds tuples using the master Excel mapping.")
headless = st.toggle("Run in Headless Mode", value=False)
left, middle, right = st.columns(3)
with left:
    if st.button("Start fast scrapers", type="primary", use_container_width=True):
        if get_site_status("scraper_profile").get("running"):
            st.warning("Close the scraper-profile Chrome window before starting the scrapers.")
        else:
            start_process("fast_scrapers", fast_scraper_command(headless))
with middle:
    if st.button("Stop fast scrapers", use_container_width=True):
        stop_process("fast_scrapers")
with right:
    if st.button("Set scraper profile", use_container_width=True):
        if get_site_status("fast_scrapers").get("running"):
            st.warning("Stop the fast scrapers before opening the scraper profile.")
        else:
            start_process("scraper_profile", scraper_profile_command())
st.caption("Set scraper profile opens the dedicated Chrome profile in one window. Log in on any marketplace tab, then close Chrome; the login is saved for future scraper runs.")
render_operational_console("fast_scrapers", JSON_DIR)
