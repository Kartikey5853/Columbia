from __future__ import annotations

import os
import shutil
from pathlib import Path


def _existing_path(candidate: str | None) -> Path | None:
    if not candidate:
        return None
    path = Path(candidate)
    return path if path.exists() else None


def chromium_executable() -> Path | None:
    """Return a locally installed browser executable if one is available."""
    candidates = (
        shutil.which("chrome.exe"),
        shutil.which("msedge.exe"),
        shutil.which("chromium.exe"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        rf"{os.environ.get('LOCALAPPDATA', '')}\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        rf"{os.environ.get('LOCALAPPDATA', '')}\Microsoft\Edge\Application\msedge.exe",
    )

    for candidate in candidates:
        path = _existing_path(candidate)
        if path is not None:
            return path
    return None