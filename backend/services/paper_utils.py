import os
import re
import shutil
from pathlib import Path
from typing import Tuple, Union, Optional
from datetime import datetime, timezone

import fitz
from fastapi import UploadFile, HTTPException

from backend.config import MAX_UPLOAD_BYTES
from backend.database import SessionLocal, Paper


def extract_year_from_filename(name: str) -> Optional[int]:
    """Extract 2-digit year from filenames like '9709_s23_qp_23.pdf' -> 23.

    We treat the first occurrence of _[m|s|w]\\d{2}_ as the exam session year.
    """
    try:
        m = re.search(r"_(m|s|w)(\d{2})_", str(name or ""), flags=re.IGNORECASE)
        if not m:
            return None
        return int(m.group(2))
    except Exception:
        return None


def auto_suggest_allowed_by_filename(name: str) -> Tuple[bool, Optional[str]]:
    """Business rule: years > 23 do NOT auto-suggest."""
    y = extract_year_from_filename(name)
    if y is None:
        return True, None
    if int(y) > 23:
        return False, f"根据文件名年份规则（>{23} 不自动识别），该试卷（{y}）已禁用自动框选。"
    return True, None


def save_upload_with_limit(upload: UploadFile, dest_path: Path, max_bytes: int = MAX_UPLOAD_BYTES) -> int:
    """Stream-save an UploadFile to disk with a hard size limit.

    Returns the written byte count. Raises HTTPException(413) if exceeded.
    """
    written = 0
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(dest_path, "wb") as buffer:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise HTTPException(status_code=413, detail=f"file too large (> {max_bytes // 1024 // 1024}MB): {upload.filename}")
            buffer.write(chunk)
    return written


def render_pdf_to_images(pdf_path: Path, output_dir: Path) -> int:
    """Render PDF pages to PNG images.

    Important: always clears output_dir first to avoid mixed/stale pages when
    a paper id is reused or old images remain on disk.

    Returns the rendered page count.
    """
    try:
        if output_dir.exists() and output_dir.is_dir():
            shutil.rmtree(output_dir, ignore_errors=True)
    except Exception:
        pass
    output_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(str(pdf_path))
    try:
        for page_index in range(len(doc)):
            page = doc[page_index]
            matrix = fitz.Matrix(4, 4)
            pix = page.get_pixmap(matrix=matrix)

            image_path = output_dir / f"page_{page_index + 1}.png"
            pix.save(str(image_path))
        return len(doc)
    finally:
        doc.close()


def stem_no_ext(filename: str) -> str:
    return Path(filename or "").name.rsplit(".", 1)[0]


def derive_pair_code(code_or_filename: str) -> Optional[str]:
    s = stem_no_ext(code_or_filename).strip()
    if not s:
        return None

    if re.search(r"_qp_", s, flags=re.IGNORECASE):
        return re.sub(r"_qp_", "_ms_", s, flags=re.IGNORECASE)
    if re.search(r"_ms_", s, flags=re.IGNORECASE):
        return re.sub(r"_ms_", "_qp_", s, flags=re.IGNORECASE)
    return None


def try_pair_papers(db, paper: Paper) -> None:
    """尝试自动匹配 qp<->ms 并写入 paired_paper_id（双向）。"""
    if paper.paired_paper_id:
        return
    base = paper.exam_code or paper.filename or ""
    pair_code = derive_pair_code(base)
    if not pair_code:
        return

    # match by exam_code first; fallback to filename contains
    other = db.query(Paper).filter(Paper.id != paper.id, Paper.exam_code == pair_code).one_or_none()
    if other is None:
        other = db.query(Paper).filter(Paper.id != paper.id, Paper.filename.ilike(f"%{pair_code}%")).one_or_none()
    if other is None:
        return

    paper.paired_paper_id = other.id
    other.paired_paper_id = paper.id
    db.add(paper)
    db.add(other)
    db.commit()


def is_answer_filename(name: str) -> bool:
    s = stem_no_ext(name)
    return bool(re.search(r"_ms_", s, flags=re.IGNORECASE))


def detect_is_answer_by_pdf_text(pdf_path: Path) -> Optional[bool]:
    """Heuristic detection of MS(QP) from PDF text.

    Returns:
      - True  => likely Mark Scheme / Answer
      - False => likely Question Paper
      - None  => unsure / mixed / unreadable
    """
    try:
        doc = fitz.open(str(pdf_path))
    except Exception:
        return None

    try:
        pages = min(2, len(doc))
        text = ""
        for i in range(pages):
            try:
                text += "\n" + (doc[i].get_text("text") or "")
            except Exception:
                continue
        t = text.lower()
        if not t.strip():
            return None

        # Strong signals
        ans_hits = 0
        qp_hits = 0

        # Cambridge-style headers
        if "mark scheme" in t or "markscheme" in t:
            ans_hits += 3
        if "question paper" in t:
            qp_hits += 3

        # Common words (English/Chinese)
        for kw in ["answers", "answer", "scheme", "评分", "答案", "评分标准"]:
            if kw in t:
                ans_hits += 1
        for kw in ["candidates", "candidate", "instructions", "answer all questions", "试题", "答题"]:
            if kw in t:
                qp_hits += 1

        # If both appear strongly, likely mixed or ambiguous
        if ans_hits >= 3 and qp_hits >= 3:
            return None
        if ans_hits >= 3 and ans_hits >= qp_hits + 2:
            return True
        if qp_hits >= 3 and qp_hits >= ans_hits + 2:
            return False
        return None
    finally:
        try:
            doc.close()
        except Exception:
            pass


def normalize_exam_code_for_type(exam_code: Optional[str], is_answer: bool) -> Optional[str]:
    s = (exam_code or "").strip()
    if not s:
        return exam_code
    if is_answer and re.search(r"_qp_", s, flags=re.IGNORECASE):
        return re.sub(r"_qp_", "_ms_", s, flags=re.IGNORECASE)
    if (not is_answer) and re.search(r"_ms_", s, flags=re.IGNORECASE):
        return re.sub(r"_ms_", "_qp_", s, flags=re.IGNORECASE)
    return exam_code
