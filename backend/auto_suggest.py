from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterable
import unicodedata

import fitz


BOX_X0 = 0.113
BOX_X1 = 0.891


_CTRL_CHAR_RE = re.compile(r"[\x00-\x08\x0B-\x1F\x7F-\x9F\u200B\u200C\u200D\uFEFF]")


# Question markers
# - 大题：裸数字（可能独占一行，或数字后跟空格再接题干）
# - 小题：(a)
# - 更小：(i) / (ii) / ... (x)
_Q_COMBINED_ALPHA_RE = re.compile(r"^\s*(\d{1,3})\s*[\(（]\s*([a-z])\s*[\)）]", flags=re.IGNORECASE)
_Q_COMBINED_ROMAN_RE = re.compile(r"^\s*(\d{1,3})\s*[\(（]\s*((?:ix|iv|v?i{0,3}|x))\s*[\)）]", flags=re.IGNORECASE)
# Avoid matching decimals like "14.4" (should not become question 14).
_Q_PUNCT_RE = re.compile(r"^\s*(\d{1,3})\s*(?:[\)）:：、]|[\.．](?!\d))\s*", flags=re.IGNORECASE)
_Q_SPACE_RE = re.compile(r"^\s*(\d{1,3})\s+", flags=re.IGNORECASE)
_Q_STANDALONE_RE = re.compile(r"^\s*(\d{1,3})\s*$")
_SUBPART_ALPHA_RE = re.compile(
    r"^\s*[\(（]\s*([a-z])\s*[\)）](?:\s+|[\.．:：、]|$)",
    flags=re.IGNORECASE,
)
_SUBPART_ROMAN_RE = re.compile(
    r"^\s*[\(（]\s*((?:ix|iv|v?i{0,3}|x))\s*[\)）](?:\s+|[\.．:：、]|$)",
    flags=re.IGNORECASE,
)


@dataclass(frozen=True)
class TextLine:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str


@dataclass(frozen=True)
class Marker:
    page: int
    y: float
    kind: str  # 'Q' or 'S'
    val: str | None


def _norm_params(*, min_height_px: int, y_padding_px: int) -> tuple[float, float, float]:
    # Use a stable baseline height to convert px-ish settings into normalized space.
    base_h = 3508
    mh_px = int(min_height_px) if int(min_height_px or 0) >= 0 else 70
    pad_px = int(y_padding_px) if int(y_padding_px or 0) >= 0 else 12
    mh_px = max(0, min(mh_px, base_h))
    pad_px = max(0, min(pad_px, base_h // 2))
    pad = float(pad_px) / float(base_h)
    mh = float(mh_px) / float(base_h)
    return pad, pad, mh


def _extract_text_lines(page: fitz.Page, *, left_limit_ratio: float = 0.28) -> list[TextLine]:
    """Extract visible text lines (type=0 blocks) with their bboxes."""

    lines: list[TextLine] = []
    pw = float(page.rect.width or 0)
    ph = float(page.rect.height or 0)
    if pw <= 0 or ph <= 0:
        return lines

    left_limit = pw * float(left_limit_ratio)
    data = page.get_text("dict") or {}
    for b in (data.get("blocks") or []):
        try:
            if int(b.get("type", -1)) != 0:
                continue
            for ln in (b.get("lines") or []):
                lb = ln.get("bbox") or None
                if not lb or len(lb) < 4:
                    continue
                x0, y0, x1, y1 = map(float, lb[:4])
                if x0 > left_limit:
                    continue
                spans = ln.get("spans") or []
                if not spans:
                    continue
                txt = "".join((str(s.get("text") or "") for s in spans))
                if not txt or not txt.strip():
                    continue
                # Skip extreme header/footer.
                # Note: some papers place the question stem very close to the top.
                # Keep very-top lines if they look like question markers.
                yn = max(0.0, min(0.999, y0 / ph))
                if yn < 0.02 or yn > 0.97:
                    continue
                if yn < 0.05:
                    head = _CTRL_CHAR_RE.sub("", str(txt)).lstrip()[:16]
                    looks_like_marker = bool(re.match(r"^\d{1,3}(?:\s+|[\)）:：、]|[\.．](?!\d)|$)", head)) or bool(
                        re.match(r"^[\(（]\s*[a-zivx]{1,4}", head, flags=re.IGNORECASE)
                    )
                    if not looks_like_marker:
                        continue
                lines.append(TextLine(x0=x0, y0=y0, x1=x1, y1=y1, text=str(txt)))
        except Exception:
            continue

    return lines


def detect_problematic_control_chars(lines: Iterable[TextLine]) -> str | None:
    """Return a short escaped snippet if we see control chars in *marker-relevant* lines.

    We intentionally do NOT scan the whole page. Some PDFs embed odd glyph mapping
    artifacts in non-marker regions which would cause false positives.
    """

    try:
        for ln in lines:
            t = ln.text
            if not t:
                continue
            m = _CTRL_CHAR_RE.search(t)
            if not m:
                continue

            # Only treat as problematic if this line looks like it could contain a marker.
            # This keeps the original safety guarantee while avoiding false positives.
            cleaned = _CTRL_CHAR_RE.sub("", t)
            head = cleaned.lstrip()[:16]
            looks_like_marker = bool(re.match(r"^[\(（]?\s*\d{1,3}\b", head)) or bool(
                re.match(r"^[\(（]\s*[a-zivx]{1,4}", head, flags=re.IGNORECASE)
            )
            if not looks_like_marker:
                continue

            i0 = max(0, int(m.start()) - 8)
            i1 = min(len(t), int(m.start()) + 24)
            snippet = t[i0:i1]
            return snippet.encode("unicode_escape", errors="backslashreplace").decode("ascii")
    except Exception:
        return None

    return None


def _extract_markers_from_lines(lines: Iterable[TextLine], *, page_num: int, page_h: float, page_w: float) -> list[Marker]:
    out: list[Marker] = []
    for ln in lines:
        try:
            txt = (ln.text or "").strip()
            # Some PDFs embed invisible control characters inside editable text.
            # Remove them for marker matching to avoid false negatives.
            txt = _CTRL_CHAR_RE.sub("", txt)
            if not txt:
                continue

            # Use top of line for stable marker y.
            y = max(0.0, min(0.999, float(ln.y0) / float(page_h)))

            m_c1 = _Q_COMBINED_ALPHA_RE.match(txt)
            if m_c1:
                out.append(Marker(page=page_num, y=y, kind="Q", val=str(m_c1.group(1))))
                continue
            m_c2 = _Q_COMBINED_ROMAN_RE.match(txt)
            if m_c2:
                out.append(Marker(page=page_num, y=y, kind="Q", val=str(m_c2.group(1))))
                continue

            m_q = _Q_PUNCT_RE.match(txt)
            if m_q:
                out.append(Marker(page=page_num, y=y, kind="Q", val=str(m_q.group(1))))
                continue

            # "1 <题干>" (no punctuation). Restrict to extreme-left markers.
            if float(ln.x0) <= float(page_w) * 0.14:
                m_qs = _Q_SPACE_RE.match(txt)
                if m_qs:
                    out.append(Marker(page=page_num, y=y, kind="Q", val=str(m_qs.group(1))))
                    continue

            m_sa = _SUBPART_ALPHA_RE.match(txt)
            if m_sa:
                out.append(Marker(page=page_num, y=y, kind="S", val=str(m_sa.group(1)).lower()))
                continue

            m_sr = _SUBPART_ROMAN_RE.match(txt)
            if m_sr:
                out.append(Marker(page=page_num, y=y, kind="S", val=str(m_sr.group(1)).lower()))
                continue

            if float(ln.x0) <= float(page_w) * 0.16:
                m_q2 = _Q_STANDALONE_RE.match(txt)
                if m_q2:
                    out.append(Marker(page=page_num, y=y, kind="Q", val=str(m_q2.group(1))))
                    continue
        except Exception:
            continue

    return out


def _page_footer_y(page: fitz.Page) -> float | None:
    """Find the start Y of footer content (page number, copyright, 'Turn over')."""
    try:
        ph = float(page.rect.height or 0)
        if ph <= 0: return None
        blocks = page.get_text("blocks")
        if not blocks: return None
        
        candidates = []
        for b in blocks:
            # b: (x0, y0, x1, y1, text, ...)
            if len(b) < 5: continue
            y0 = float(b[1]) / ph
            if y0 < 0.92: continue # Scan bottom 8%

            txt = str(b[4]).strip()
            if not txt: continue
            
            # Filter answer lines (mostly dots/underscores)
            if len(txt) > 5:
                # Count dot-like chars
                dots = sum(1 for c in txt if c in "._-—")
                if dots / len(txt) > 0.6:
                    continue
            
            candidates.append(y0)
            
        if candidates:
            return min(candidates)
    except Exception:
        pass
    return None


def _page_top_content_min_y(page: fitz.Page, *, y_max: float = 0.25) -> float | None:
    """Find the top-most meaningful text line y (normalized) within the top band.

    Purpose: some pages start with a centered stem line above the first subpart marker,
    while the subpart marker itself is on the left. We want to include that stem text.
    """

    try:
        pw = float(page.rect.width or 0)
        ph = float(page.rect.height or 0)
        if pw <= 0 or ph <= 0:
            return None

        data = page.get_text("dict") or {}
        best: float | None = None
        for b in (data.get("blocks") or []):
            if int(b.get("type", -1)) != 0:
                continue
            for ln in (b.get("lines") or []):
                lb = ln.get("bbox") or None
                if not lb or len(lb) < 4:
                    continue
                x0, y0, x1, y1 = map(float, lb[:4])
                yn = max(0.0, min(0.999, y0 / ph))
                if yn < 0.035:
                    # Likely page number/header noise.
                    continue
                if yn > float(y_max):
                    continue

                spans = ln.get("spans") or []
                if not spans:
                    continue
                txt = "".join((str(s.get("text") or "") for s in spans))
                txt = _CTRL_CHAR_RE.sub("", str(txt)).strip()
                if not txt:
                    continue
                
                # Skip dotted/underscore writing lines that are encoded as text.
                if len(txt) >= 4:
                    dot_like = sum((1 for ch in txt if ch in ".·•_‐-–—"))
                    if dot_like / max(1, len(txt)) >= 0.60:
                        continue

                # Skip lone page numbers or very short punctuation.
                if re.fullmatch(r"\d{1,3}", txt):
                    continue
                if len(txt) < 6:
                    continue

                if best is None or yn < float(best):
                    best = float(yn)
        return best
    except Exception:
        return None


def _page_text_lines_for_stem(page: fitz.Page) -> list[tuple[float, float, str]]:
    """Extract text lines across the page for stem-expansion heuristics.

    Returns a list of (y0_norm, x0_ratio, cleaned_text).
    """

    out: list[tuple[float, float, str]] = []
    try:
        pw = float(page.rect.width or 0)
        ph = float(page.rect.height or 0)
        if pw <= 0 or ph <= 0:
            return out

        data = page.get_text("dict") or {}
        for b in (data.get("blocks") or []):
            if int(b.get("type", -1)) != 0:
                continue
            for ln in (b.get("lines") or []):
                lb = ln.get("bbox") or None
                if not lb or len(lb) < 4:
                    continue
                x0, y0, x1, y1 = map(float, lb[:4])
                yn = max(0.0, min(0.999, y0 / ph))
                if yn < 0.03 or yn > 0.97:
                    continue

                spans = ln.get("spans") or []
                if not spans:
                    continue
                txt = "".join((str(s.get("text") or "") for s in spans))
                txt = _CTRL_CHAR_RE.sub("", str(txt)).strip()
                if not txt:
                    continue

                # Skip dotted/underscore writing lines that are encoded as text.
                # These often appear as long sequences of '.' and would incorrectly be treated as stem text.
                if len(txt) >= 4:
                    dot_like = sum((1 for ch in txt if ch in ".·•_‐-–—"))
                    if dot_like / max(1, len(txt)) >= 0.60:
                        continue

                # Skip marker-only lines; we only want surrounding stem text.
                if _SUBPART_ALPHA_RE.match(txt) or _SUBPART_ROMAN_RE.match(txt):
                    continue
                if _Q_STANDALONE_RE.match(txt) or _Q_SPACE_RE.match(txt) or _Q_PUNCT_RE.match(txt):
                    continue
                if re.fullmatch(r"\d{1,3}", txt):
                    continue

                xr = max(0.0, min(1.0, x0 / pw))
                out.append((float(yn), float(xr), txt))
    except Exception:
        return out

    out.sort(key=lambda t: (float(t[0]), float(t[1])))
    return out


def _assess_pdf_text_quality(pdf_path: Path, *, sample_pages: int = 4, max_chars: int = 4000) -> tuple[str, str | None]:
    """Assess whether PDF has a usable editable text layer.

    Returns (status, warning):
      - status: 'ok' | 'no_text' | 'garbled'
      - warning: optional, short user-facing message

    Heuristic goal: approximate "正文可复制且复制出来不是乱码".
    """

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        return "garbled", f"PDF读取失败：{type(e).__name__}"

    try:
        pages_to_scan = []
        # Prefer starting from page 2 (skip cover/instructions), but include page 1 if short PDF.
        start = 2 if int(doc.page_count or 0) >= 2 else 1
        for i in range(start, min(int(doc.page_count or 0), start + int(sample_pages)) + 1):
            pages_to_scan.append(int(i))

        buf: list[str] = []
        for page_num in pages_to_scan:
            try:
                p = doc[int(page_num) - 1]
                t = p.get_text("text") or ""
                if t:
                    buf.append(t)
            except Exception:
                continue
        text = "\n".join(buf)
    finally:
        try:
            doc.close()
        except Exception:
            pass

    if not text:
        return "no_text", "PDF 几乎没有可复制文本层，题号自动识别可能失败。"

    if len(text) > int(max_chars):
        text = text[: int(max_chars)]

    # Normalize: remove common whitespace, keep visible content.
    # (Don't strip all punctuation; we want to detect replacement/private-use/control chars.)
    total = len(text)
    if total <= 0:
        return "no_text", "PDF 可复制文本过少，题号自动识别可能失败。"

    non_ws = 0
    weird = 0
    repl = 0
    private_use = 0
    letters_digits = 0

    for ch in text:
        if ch.isspace():
            continue
        non_ws += 1
        if ch == "\ufffd":
            repl += 1
            weird += 1
            continue
        cat = unicodedata.category(ch)
        # Control/format/surrogate/unassigned are typically not user-visible.
        if cat in {"Cc", "Cf", "Cs", "Cn"}:
            weird += 1
            continue
        # Private-use characters often indicate font-encoded glyphs (looks like gibberish when copied).
        if cat == "Co":
            private_use += 1
            weird += 1
            continue
        if ch.isalpha() or ch.isdigit():
            letters_digits += 1

    if non_ws < 80:
        # Not enough evidence; treat as no_text-like (still allow attempting marker parsing).
        return "no_text", "PDF 可复制文本较少，题号自动识别可能不稳定。"

    weird_ratio = float(weird) / float(max(1, non_ws))
    pu_ratio = float(private_use) / float(max(1, non_ws))
    ld_ratio = float(letters_digits) / float(max(1, non_ws))

    # Conservative "garbled"判定：
    # - 有明显替换字符；或
    # - 私用区比例偏高；或
    # - 控制/不可见字符比例偏高且字母数字比例很低
    if repl > 0 or pu_ratio > 0.01 or (weird_ratio > 0.03 and ld_ratio < 0.08):
        return (
            "garbled",
            "检测到 PDF 可复制文本疑似乱码/不可用（包含大量不可见或私用字符）。已跳过题号自动识别，改为按页生成建议框。",
        )

    return "ok", None


def _page_horizontal_rules(page: fitz.Page) -> list[float]:
    """Collect y positions (normalized) of strong horizontal rules from vector drawings.

    Handles both solid lines (one long segment) and dotted/dashed rules that are
    represented as many short horizontal segments at nearly the same y.

    Note: this function is intentionally conservative; it's mainly used to:
      - clip boxes above writing lines
      - split boxes only when there are very few rules in the region
    """

    try:
        pw = float(page.rect.width or 0)
        ph = float(page.rect.height or 0)
        if pw <= 0 or ph <= 0:
            return []

        y_bin = 0.003
        gap_bridge = pw * 0.030

        buckets: dict[int, dict] = {}
        drawings = page.get_drawings() or []
        for d in drawings:
            items = d.get("items") or []
            for it in items:
                try:
                    if not it:
                        continue
                    op = it[0]

                    x0 = y0 = x1 = y1 = None
                    if op == "l":
                        p1 = it[1]
                        p2 = it[2]
                        x0, y0 = float(p1.x), float(p1.y)
                        x1, y1 = float(p2.x), float(p2.y)
                    elif op == "re":
                        r = it[1]
                        x0, y0 = float(r.x0), float(r.y0)
                        x1, y1 = float(r.x1), float(r.y1)
                    else:
                        continue

                    if abs(float(y1) - float(y0)) > 2.2:
                        continue

                    seg_len = abs(float(x1) - float(x0))
                    if seg_len <= 0:
                        continue

                    yn = max(0.0, min(0.999, ((float(y0) + float(y1)) / 2.0) / ph))
                    if yn < 0.06 or yn > 0.98:
                        continue

                    b = int(round(float(yn) / float(y_bin)))
                    ent = buckets.get(b)
                    if ent is None:
                        ent = {"y_sum": 0.0, "count": 0, "intervals": [], "max_seg": 0.0}
                        buckets[b] = ent
                    ent["y_sum"] += float(yn)
                    ent["count"] += 1
                    ent["max_seg"] = max(float(ent["max_seg"]), float(seg_len))
                    ent["intervals"].append((min(float(x0), float(x1)), max(float(x0), float(x1))))
                except Exception:
                    continue

        rules: list[float] = []

        # Text-based dotted rules ("........")
        try:
            data = page.get_text("dict") or {}
            dot_re = re.compile(r"^[\s\.·•‧⋅∙…_\-–—－=]{16,}$")
            for b in (data.get("blocks") or []):
                if int(b.get("type", -1)) != 0:
                    continue
                for ln in (b.get("lines") or []):
                    try:
                        lb = ln.get("bbox") or None
                        if not lb or len(lb) < 4:
                            continue
                        x0, y0, x1, y1 = map(float, lb[:4])
                        if (x1 - x0) < pw * 0.55:
                            continue
                        spans = ln.get("spans") or []
                        if not spans:
                            continue
                        txt = "".join((str(s.get("text") or "") for s in spans)).strip()
                        if not txt:
                            continue
                        if not dot_re.match(txt):
                            continue
                        yn = max(0.0, min(0.999, ((y0 + y1) / 2.0) / ph))
                        if yn < 0.06 or yn > 0.98:
                            continue
                        rules.append(float(yn))
                    except Exception:
                        continue
        except Exception:
            pass

        for ent in buckets.values():
            try:
                intervals = ent.get("intervals") or []
                if not intervals:
                    continue
                intervals.sort(key=lambda t: float(t[0]))
                merged_len = 0.0
                cur_s, cur_e = intervals[0]
                for s, e in intervals[1:]:
                    if float(s) <= float(cur_e) + float(gap_bridge):
                        cur_e = max(float(cur_e), float(e))
                    else:
                        merged_len += max(0.0, float(cur_e) - float(cur_s))
                        cur_s, cur_e = float(s), float(e)
                merged_len += max(0.0, float(cur_e) - float(cur_s))

                seg_count = int(ent.get("count") or 0)
                max_seg = float(ent.get("max_seg") or 0.0)

                is_solid = max_seg >= pw * 0.45
                is_dashed = (seg_count >= 6) and (merged_len >= pw * 0.55)
                if not (is_solid or is_dashed):
                    continue

                y_avg = float(ent.get("y_sum") or 0.0) / max(1.0, float(seg_count))
                rules.append(max(0.0, min(0.999, float(y_avg))))
            except Exception:
                continue

        rules.sort()
        out: list[float] = []
        last = None
        for r in rules:
            if last is not None and abs(float(r) - float(last)) < 0.002:
                continue
            out.append(float(r))
            last = r
        return out
    except Exception:
        return []


def _is_writing_lines_region(rules_in: list[float], *, y0: float, y1: float) -> tuple[bool, float | None]:
    """Decide whether `rules_in` represent answer writing lines.

    Returns (is_writing_lines, first_rule_y).
    """

    try:
        if not rules_in:
            return False, None

        rr = [float(r) for r in rules_in if float(y0) + 0.030 <= float(r) <= float(y1) - 0.02]
        rr.sort()
        if len(rr) >= 6:
            return True, float(rr[0])
        if len(rr) >= 3:
            gaps = [float(rr[i + 1]) - float(rr[i]) for i in range(len(rr) - 1)]
            good = sum((1 for g in gaps if 0.02 <= float(g) <= 0.12))
            if (len(rr) == 3 and good >= 2) or (len(rr) >= 4 and good >= 3):
                return True, float(rr[0])
    except Exception:
        return False, None

    return False, None


def suggest_question_boxes_from_pdf(
    pdf_path: Path,
    page_count: int,
    *,
    min_height_px: int = 70,
    y_padding_px: int = 12,
) -> tuple[list[dict], str | None]:
    """Public entry: suggest question boxes from PDF by parsing text markers."""

    if int(page_count or 0) < 2:
        return [], None

    # Decide whether marker-based extraction is worth attempting.
    # If the editable text layer is likely garbled, skip marker parsing to avoid random matches.
    quality, quality_warn = _assess_pdf_text_quality(pdf_path)
    if quality == "garbled":
        fallback_g: list[dict] = []
        for page_num in range(2, int(page_count or 0) + 1):
            fallback_g.append({"label": None, "boxes": [{"page": int(page_num), "bbox": [float(BOX_X0), 0.16, float(BOX_X1), 0.98]}]})
        return fallback_g, quality_warn

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        return [], f"PDF读取失败：{type(e).__name__}"

    markers: list[Marker] = []
    rules_by_page: dict[int, list[float]] = {}
    top_content_by_page: dict[int, float] = {}
    footer_y_by_page: dict[int, float] = {}
    bottom_content_by_page: dict[int, float] = {}
    stem_lines_by_page: dict[int, list[tuple[float, float, str]]] = {}

    try:
        max_pages = min(int(page_count or 0), int(doc.page_count or 0))
        for page_num in range(2, int(max_pages) + 1):
            try:
                p = doc[int(page_num) - 1]
                pw = float(p.rect.width or 0)
                ph = float(p.rect.height or 0)
                if pw <= 0 or ph <= 0:
                    continue

                lines = _extract_text_lines(p, left_limit_ratio=0.28)
                
                try:
                    stem_lines_by_page[int(page_num)] = _page_text_lines_for_stem(p)
                except Exception:
                    stem_lines_by_page[int(page_num)] = []

                try:
                    topy = _page_top_content_min_y(p, y_max=0.25)
                    if topy is not None:
                        top_content_by_page[int(page_num)] = float(topy)
                except Exception:
                    pass
                
                try:
                    footy = _page_footer_y(p)
                    if footy is not None:
                        footer_y_by_page[int(page_num)] = float(footy)
                except Exception:
                    pass
                
                try:
                    # Find bottom-most content (including dotted lines) to avoid large whitespace
                    foot_lim = footer_y_by_page.get(int(page_num))
                    max_cy = 0.0
                    for ln in lines:
                        # ln.y1 is absolute
                        y_bn = min(0.999, float(ln.y1) / ph)
                        if foot_lim is not None and y_bn > float(foot_lim):
                            continue
                        if y_bn > max_cy:
                            max_cy = y_bn
                    if max_cy > 0.1:
                        bottom_content_by_page[int(page_num)] = max_cy
                except Exception:
                    pass


                rules = _page_horizontal_rules(p)
                
                # Also treat "dotted text lines" as horizontal rules (writing lines).
                # This ensures the box clipping logic handles text-based writing lines (..................)
                # just like vector lines.
                for ln in lines:
                   txt = ln.text.strip()
                   # Use the same loose filter: len >= 4 and >60% dots
                   if len(txt) >= 4:
                       dots = sum((1 for c in txt if c in ".·•_‐-–—"))
                       if dots / len(txt) > 0.6:
                           # Normalize y to page height ratio
                           # We use y1 (bottom) or mid-y? Rules are usually "lines".
                           # If we want to clip "above" them, we should probably record TOP y?
                           # _is_writing_lines logic: clip_y = max(..., first_rule - 0.003).
                           # So if we want to exclude the line, we need 'first_rule' to be the top of the dotted line.
                           # So use y0/ph.
                           rules.append(max(0.0, min(0.999, float(ln.y0) / ph)))
                
                rules.sort()
                rules_by_page[int(page_num)] = rules

                markers.extend(_extract_markers_from_lines(lines, page_num=int(page_num), page_h=ph, page_w=pw))
            except Exception:
                continue
    finally:
        try:
            doc.close()
        except Exception:
            pass

    warn: str | None = quality_warn

    if not markers:
        fallback: list[dict] = []
        for page_num in range(2, int(page_count or 0) + 1):
            fallback.append({"label": None, "boxes": [{"page": int(page_num), "bbox": [float(BOX_X0), 0.16, float(BOX_X1), 0.98]}]})
        return fallback, (warn or "未识别到题号，已按每页一题生成建议框")

    # Sort and de-dup near duplicates.
    markers.sort(key=lambda m: (int(m.page), float(m.y)))
    deduped: list[Marker] = []
    last: Marker | None = None
    for m in markers:
        if last is not None and m.page == last.page and m.kind == last.kind:
            if abs(float(m.y) - float(last.y)) < 0.006:
                continue
        deduped.append(m)
        last = m
    markers = deduped

    # Collapse patterns like "4" followed by "(a)" at almost the same y.
    collapsed: list[Marker] = []
    i = 0
    while i < len(markers):
        m = markers[i]
        if m.kind == "Q" and (i + 1) < len(markers):
            n = markers[i + 1]
            if n.page == m.page and n.kind == "S" and abs(float(n.y) - float(m.y)) < 0.004:
                collapsed.append(m)
                i += 2
                continue
        collapsed.append(m)
        i += 1
    markers = collapsed

    # Per-page noise: if many Q markers exist on a page, keep only the topmost one.
    try:
        q_by_page: dict[int, list[Marker]] = {}
        for m in markers:
            if m.kind == "Q":
                q_by_page.setdefault(int(m.page), []).append(m)
        if any(len(arr) >= 3 for arr in q_by_page.values() if arr):
            chosen: dict[int, Marker] = {}
            for p, arr in q_by_page.items():
                arr = sorted(arr, key=lambda mm: float(mm.y))
                chosen[int(p)] = arr[0]
            markers2: list[Marker] = []
            for m in markers:
                if m.kind == "Q":
                    if chosen.get(int(m.page)) is m:
                        markers2.append(m)
                    continue
                cq = chosen.get(int(m.page))
                if cq is not None and float(m.y) < float(cq.y):
                    continue
                markers2.append(m)
            markers = sorted(markers2, key=lambda mm: (int(mm.page), float(mm.y)))
    except Exception:
        pass

    pad_top, pad_bottom, min_h = _norm_params(min_height_px=min_height_px, y_padding_px=y_padding_px)

    questions: list[dict] = []
    current_q_idx: int | None = None
    pending_stem: tuple[int, float, int] | None = None  # (page, y, q_idx)

    def _ensure_question(label: str | None) -> int:
        questions.append({"label": label, "boxes": []})
        return len(questions) - 1

    for idx, m in enumerate(markers):
        page_num = int(m.page)
        y = float(m.y)

        # Drop pending stem if we moved away from its page.
        if pending_stem is not None and int(pending_stem[0]) != int(page_num):
            pending_stem = None

        if m.kind == "Q":
            label = None
            try:
                vi = int(str(m.val))
                if 1 <= vi <= 200:
                    label = str(vi)
            except Exception:
                label = str(m.val) if m.val is not None else None
            # Repeated same-number markers often indicate subparts / continuation.
            # Keep them within the same question instead of creating duplicates.
            if current_q_idx is None:
                current_q_idx = _ensure_question(label)
            else:
                cur_label = questions[current_q_idx].get("label")
                if label != cur_label:
                    current_q_idx = _ensure_question(label)

            # If this looks like a short stem-only marker (same question continues very soon),
            # skip generating a standalone stem box and merge it into the next marker's box.
            next_m0 = markers[idx + 1] if (idx + 1) < len(markers) else None
            if next_m0 is not None and int(next_m0.page) == int(page_num):
                dy = float(next_m0.y) - float(y)
                if 0.010 <= dy <= 0.20:
                    same_q_val = (next_m0.kind == "Q" and str(next_m0.val) == str(m.val))
                    next_is_subpart = next_m0.kind == "S"
                    if (same_q_val or next_is_subpart) and current_q_idx is not None:
                        pending_stem = (int(page_num), float(y), int(current_q_idx))
                        continue

        if current_q_idx is None:
            continue

        next_m = markers[idx + 1] if (idx + 1) < len(markers) else None
        
        # Determine bottom limit of current box
        if next_m is not None and int(next_m.page) == page_num:
            next_y = float(next_m.y)
        else:
            # End of page box
            footy = footer_y_by_page.get(int(page_num))
            if footy is not None:
                next_y = float(footy)
            else:
                next_y = 0.98
            
            # Snap to last content if there is a big gap
            # This avoids including huge whitespace at the bottom of the page
            try:
                content_bot = bottom_content_by_page.get(int(page_num))
                if content_bot is not None and content_bot > float(y):
                    # If the standard box (to next_y) includes a large empty gap below content, snap it.
                    # We add some padding (0.04 ~ 30px) to cover descenders/dots margin.
                    candidate_y = float(content_bot) + 0.04
                    
                    if candidate_y < next_y:
                        next_y = candidate_y
            except Exception:
                pass


        y0 = max(0.0, y - pad_top)
        # If this page starts with a centered stem line above the first subpart marker,
        # extend the first segment upward to include that stem.
        try:
            prev_m = markers[idx - 1] if idx > 0 else None
            is_first_on_page = prev_m is None or int(prev_m.page) != int(page_num)
            if is_first_on_page and m.kind == "S":
                topy = top_content_by_page.get(int(page_num))
                if topy is not None and float(topy) + 0.004 < float(y0):
                    y0 = max(0.0, float(topy) - pad_top)
        except Exception:
            pass

        # General case: for subparts, include nearby stem paragraph immediately above.
        # This helps when the question number is on a previous page (so only (c) exists here).
        try:
            if m.kind == "S":
                cand = stem_lines_by_page.get(int(page_num)) or []
                if cand:
                    # Look for meaningful lines within a window above the marker.
                    # We iterate backwards (from marker upwards) and stop at the first large gap.
                    # This ensures we grab the contiguous block belonging to *this* marker,
                    # rather than jumping gap to the previous question's text.
                    
                    limit_y = 0.0
                    if idx > 0:
                        prev_m_chk = markers[idx - 1]
                        if int(prev_m_chk.page) == int(page_num):
                            limit_y = float(prev_m_chk.y)

                    valid_cand = []
                    for (yn, xr, txt) in cand:
                         yn_f = float(yn)
                         if yn_f >= float(y) - 0.001:
                             break
                         if yn_f <= limit_y + 0.002:
                             continue
                         # Skip far-right artifacts
                         if float(xr) > 0.75:
                             continue
                         # Require content
                         if len(str(txt).strip()) < 5:
                             continue
                         valid_cand.append(yn_f)
                    
                    if valid_cand:
                        valid_cand.sort(reverse=True) # Closest to marker first
                        curr_top = float(y)
                        best_y = None
                        max_gap = 0.06 # Max vertical gap to consider part of same block
                        
                        for vc in valid_cand:
                            gap = curr_top - vc
                            if gap > max_gap:
                                break
                            best_y = vc
                            curr_top = vc
                        
                        if best_y is not None and best_y + 0.004 < float(y0):
                            y0 = max(0.0, best_y - pad_top)
        except Exception:
            pass
        if pending_stem is not None:
            ps_page, ps_y, ps_qi = pending_stem
            if int(ps_page) == int(page_num) and int(ps_qi) == int(current_q_idx) and float(ps_y) < float(y):
                y0 = max(0.0, float(ps_y) - pad_top)
                pending_stem = None
        y1 = max(0.0, min(1.0, next_y - pad_bottom)) if next_y <= 0.98 else 0.98
        if y1 - y0 < min_h:
            y1 = min(0.99, y0 + max(min_h, 0.06))
        if y1 <= y0 + 0.004:
            continue

        segs: list[tuple[float, float]] = [(y0, y1)]
        try:
            rules = rules_by_page.get(page_num) or []
            rules_in = [float(r) for r in rules if (y0 + 0.010) < float(r) < (y1 - 0.010)]
            rules_in.sort()

            is_writing, first_rule = _is_writing_lines_region(rules_in, y0=y0, y1=y1)
            if is_writing and first_rule is not None:
                clip_y = max(y0 + 0.020, float(first_rule) - 0.003)
                segs = [(y0, min(y1, clip_y))]
            else:
                # Only split when there are very few rules; otherwise dotted lines/grids will fragment boxes.
                if len(rules_in) <= 2:
                    gap = 0.002
                    for rr in rules_in:
                        new: list[tuple[float, float]] = []
                        for a, b in segs:
                            if rr <= a + 0.001 or rr >= b - 0.001:
                                new.append((a, b))
                            else:
                                new.append((a, max(a, rr - gap)))
                                new.append((min(b, rr + gap), b))
                        segs = new
                    segs = [(a, b) for (a, b) in segs if (b - a) >= max(0.010, min_h * 0.5)]
                else:
                    segs = [(y0, y1)]
        except Exception:
            segs = [(y0, y1)]

        if not segs:
            segs = [(y0, y1)]

        for a, b in segs:
            if b <= a + 0.003:
                continue
            questions[current_q_idx]["boxes"].append(
                {"page": int(page_num), "bbox": [float(BOX_X0), float(a), float(BOX_X1), float(b)]}
            )

    questions = _normalize_and_dedupe_questions([q for q in questions if q.get("boxes")])
    if not questions:
        fallback2: list[dict] = []
        for page_num in range(2, int(page_count or 0) + 1):
            fallback2.append({"label": None, "boxes": [{"page": int(page_num), "bbox": [float(BOX_X0), 0.16, float(BOX_X1), 0.98]}]})
        return fallback2, "题号识别不足，已按每页一题生成建议框"

    return questions, warn


def _normalize_and_dedupe_questions(questions: list[dict]) -> list[dict]:
    """De-duplicate near-identical boxes within each question.

    Keeps behavior close to the previous inlined implementation in backend/main.py.
    """

    try:
        for q in questions:
            boxes = list(q.get("boxes") or [])
            if not boxes:
                continue
            boxes.sort(
                key=lambda bb: (
                    int(bb.get("page", 0)),
                    float((bb.get("bbox") or [0, 0, 0, 0])[1]),
                    float((bb.get("bbox") or [0, 0, 0, 0])[3]),
                )
            )
            ded: list[dict] = []
            last_key = None
            for bb in boxes:
                try:
                    p = int(bb.get("page", 0))
                    bx = bb.get("bbox") or []
                    if not (isinstance(bx, (list, tuple)) and len(bx) == 4):
                        continue
                    x0, y0, x1, y1 = map(float, bx)
                    key = (p, round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4))
                    if last_key is not None and key == last_key:
                        continue
                    ded.append({"page": p, "bbox": [x0, y0, x1, y1]})
                    last_key = key
                except Exception:
                    continue

            # Merge overlapping / almost-touching duplicates (same page).
            try:
                by_page: dict[int, list[list[float]]] = {}
                for bb in ded:
                    by_page.setdefault(int(bb.get("page", 0)), []).append(list(map(float, bb.get("bbox") or [0, 0, 0, 0])))

                merged_all: list[dict] = []
                for p, arr in by_page.items():
                    arr = [a for a in arr if isinstance(a, list) and len(a) == 4]
                    if not arr:
                        continue
                    arr.sort(key=lambda t: (float(t[1]), float(t[0]), float(t[3]), float(t[2])))
                    merged: list[list[float]] = []
                    eps_touch = 0.0008
                    for bx in arr:
                        x0, y0, x1, y1 = map(float, bx)
                        if not merged:
                            merged.append([x0, y0, x1, y1])
                            continue
                        px0, py0, px1, py1 = merged[-1]
                        # Only consider merging if horizontal span is essentially the same.
                        if abs(x0 - px0) < 0.02 and abs(x1 - px1) < 0.02:
                            overlap = min(y1, py1) - max(y0, py0)
                            # Only merge if there is significant overlap.
                            # We intentionally do NOT merge touching boxes (gap~0) because
                            # they likely represent distinct subparts (e.g. (a) and (b))
                            # that stack vertically.
                            if overlap > 0.002:
                                merged[-1] = [min(px0, x0), min(py0, y0), max(px1, x1), max(py1, y1)]
                                continue
                        merged.append([x0, y0, x1, y1])

                    for bx2 in merged:
                        merged_all.append({"page": int(p), "bbox": [float(bx2[0]), float(bx2[1]), float(bx2[2]), float(bx2[3])]})
                q["boxes"] = merged_all
            except Exception:
                q["boxes"] = ded

    except Exception:
        return questions

    return [q for q in questions if q.get("boxes")]
