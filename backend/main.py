from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# When packaged with PyInstaller, this file is executed as a script (no package context),
# so relative imports like ".database" would fail. Ensure the project root is on sys.path
# and use absolute imports.
if __package__ is None or __package__ == "":
    _ROOT = Path(__file__).resolve().parents[1]
    if str(_ROOT) not in sys.path:
        sys.path.insert(0, str(_ROOT))

from backend.database import init_db
from backend.config import DATA_DIR, UI_DIR
from backend.routers import admin, papers, questions, sections, stats, export, cie_import


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"


app = FastAPI(
    title="Question Labeling System",
    lifespan=lifespan,
    default_response_class=UTF8JSONResponse,
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")


@app.middleware("http")
async def _no_store_static_assets(request: Request, call_next):
    resp = await call_next(request)
    try:
        p = request.url.path
        if p.startswith("/data/pages/") or p.startswith("/data/pdfs/"):
            # Avoid stale browser cache when paper IDs are reused or users purge data.
            resp.headers["Cache-Control"] = "no-store"
    except Exception:
        pass
    return resp


if UI_DIR.exists():
    app.mount("/ui", StaticFiles(directory=str(UI_DIR), html=True), name="ui")


@app.get("/")
def root():
    return {"message": "Backend is running"}


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# Include API Routers
app.include_router(papers.router)
app.include_router(questions.router)
app.include_router(sections.router)
app.include_router(stats.router)
app.include_router(admin.router)
app.include_router(export.router, prefix="/export")
app.include_router(cie_import.router)


def _run_uvicorn() -> None:
    import uvicorn

    host = os.getenv("PAPER_LABELER_HOST", "127.0.0.1").strip() or "127.0.0.1"
    try:
        port = int(os.getenv("PAPER_LABELER_PORT", "8000"))
    except Exception:
        port = 8000

    print(f"\nPaper Labeler running: http://{host}:{port}/ui/\n")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    _run_uvicorn()



