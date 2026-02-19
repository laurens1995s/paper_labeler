import sys
from pathlib import Path

if getattr(sys, "frozen", False):
    # PyInstaller one-dir: keep writable data next to the exe, but read bundled
    # assets (like frontend/) from sys._MEIPASS which points at the bundle dir.
    APP_DIR = Path(sys.executable).resolve().parent
    BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR)).resolve()
else:
    # Assuming this file is at backend/config.py, parents[1] is backend/, parents[2] is root paper_labeler
    # Wait, main.py was in backend/main.py and used parents[1].
    # backend/config.py is at same depth as main.py.
    APP_DIR = Path(__file__).resolve().parents[1]
    BUNDLE_DIR = APP_DIR

DATA_DIR = APP_DIR / "data"
PDF_DIR = DATA_DIR / "pdfs"
PAGE_DIR = DATA_DIR / "pages"
EXPORT_DIR = DATA_DIR / "_export_jobs"

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100MB per file

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
PDF_DIR.mkdir(parents=True, exist_ok=True)
PAGE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

UI_DIR = BUNDLE_DIR / "frontend"
