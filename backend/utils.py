from pathlib import Path

def _file_mtime_token(path: Path) -> str | None:
    """Best-effort cache bust token based on file mtime."""
    try:
        return str(int(path.stat().st_mtime))
    except Exception:
        return None

def _with_cache_bust(url: str, token: str | None) -> str:
    if not token:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}v={token}"
