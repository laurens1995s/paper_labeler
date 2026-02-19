from typing import List, Optional
from pathlib import Path
from datetime import datetime
import shutil

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.database import Paper, Question, Answer, QuestionBox, AnswerBox, SectionDef
from backend.dependencies import get_db
from backend.schemas.schemas import AutoSuggestRequest, PaperUpdate
from backend.config import PDF_DIR, PAGE_DIR, MAX_UPLOAD_BYTES
from backend.utils import _with_cache_bust, _file_mtime_token
from backend.services.paper_utils import (
    save_upload_with_limit,
    render_pdf_to_images,
    stem_no_ext,
    is_answer_filename,
    detect_is_answer_by_pdf_text,
    normalize_exam_code_for_type,
    try_pair_papers,
    auto_suggest_allowed_by_filename,
    extract_year_from_filename
)
from backend.auto_suggest import suggest_question_boxes_from_pdf

router = APIRouter()


def _extract_year_season_tokens(source: str) -> tuple[str | None, str | None]:
    import re
    m = re.search(r"_(m|s|w)(\d{2})_", str(source or ""), flags=re.IGNORECASE)
    if not m:
        return None, None
    return m.group(2), m.group(1).lower()


def _set_paper_tokens(paper: Paper) -> None:
    source = f"{paper.exam_code or ''} {paper.filename or ''}"
    y, s = _extract_year_season_tokens(source)
    paper.year_token = y
    paper.season_token = s


@router.get("/papers/filenames")
def list_paper_filenames(db: Session = Depends(get_db)):
    """Return all paper filenames (including answer papers) for duplicate checking."""
    papers = db.query(Paper).all()
    return {
        "filenames": [p.filename for p in papers if p.filename]
    }

@router.post("/upload_pdf")
def upload_pdf(
    file: UploadFile = File(...),
    ocr_auto: bool = Form(False),
    ocr_min_height_px: int = Form(70),
    ocr_y_padding_px: int = Form(12),
    db: Session = Depends(get_db)
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # 检查是否已导入过相同文件
    existing = db.query(Paper).filter(Paper.filename == file.filename).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"文件 '{file.filename}' 已导入过 (Paper ID: {existing.id})，请勿重复导入"
        )

    # 1️⃣ 创建试卷记录
    exam_code = stem_no_ext(str(file.filename))
    paper = Paper(
        filename=file.filename,
        exam_code=exam_code,
        is_answer=is_answer_filename(str(file.filename))
    )
    _set_paper_tokens(paper)
    db.add(paper)
    db.commit()
    db.refresh(paper)

    # 2️⃣ 保存 PDF
    pdf_path = PDF_DIR / f"paper_{paper.id}.pdf"
    save_upload_with_limit(file, pdf_path, MAX_UPLOAD_BYTES)

    # 3️⃣ 渲染页面
    pdf_name = f"paper_{paper.id}"
    page_output_dir = PAGE_DIR / pdf_name
    rendered_pages = render_pdf_to_images(pdf_path, page_output_dir)

    # 回写元信息
    paper.pdf_path = str(pdf_path)
    paper.pages_dir = str(page_output_dir)
    paper.page_count = int(rendered_pages)

    # Heuristic correction
    detected = detect_is_answer_by_pdf_text(pdf_path)
    if detected is not None and bool(paper.is_answer) != bool(detected):
        paper.is_answer = bool(detected)
        paper.exam_code = normalize_exam_code_for_type(paper.exam_code, bool(detected))
        _set_paper_tokens(paper)
    db.add(paper)
    db.commit()

    try_pair_papers(db, paper)

    ocr_questions: list[dict] = []
    ocr_boxes: list[dict] = []
    ocr_warn: Optional[str] = None
    if ocr_auto and (not bool(paper.is_answer)):
        allowed, reason = auto_suggest_allowed_by_filename(str(file.filename or ""))
        if not allowed:
            ocr_warn = reason
        else:
            ocr_questions, ocr_warn = suggest_question_boxes_from_pdf(
                Path(pdf_path),
                int(paper.page_count or 0),
                min_height_px=int(ocr_min_height_px or 0),
                y_padding_px=int(ocr_y_padding_px or 0),
            )
        # Flatten for backward compatibility
        try:
            for q in ocr_questions:
                label = q.get("label")
                for b in q.get("boxes") or []:
                    d = {"page": b.get("page"), "bbox": b.get("bbox")}
                    if label is not None:
                        d["label"] = label
                    ocr_boxes.append(d)
        except Exception:
            pass

    return {
        "paper_id": int(paper.id),
        "filename": str(file.filename),
        "pages_dir": str(page_output_dir),
        "page_count": int(paper.page_count or 0),
        "paired_paper_id": paper.paired_paper_id,
        "ocr_questions": ocr_questions,
        "ocr_boxes": ocr_boxes,
        "ocr_warning": ocr_warn,
    }


@router.post("/upload_pdfs")
def upload_pdfs(
    files: List[UploadFile] = File(...),
    ocr_auto: bool = Form(False),
    ocr_min_height_px: int = Form(70),
    ocr_y_padding_px: int = Form(12),
    db: Session = Depends(get_db)
):
    """批量上传 PDF（UI 用）。"""
    if not files:
        raise HTTPException(status_code=400, detail="no files")

    results: list[dict] = []
    for file in files:
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"Only PDF files are allowed: {file.filename}")

        # 检查是否已导入过相同文件
        existing = db.query(Paper).filter(Paper.filename == file.filename).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"文件 '{file.filename}' 已导入过 (Paper ID: {existing.id})，请勿重复导入"
            )

        exam_code = stem_no_ext(str(file.filename))
        paper = Paper(
            filename=file.filename,
            exam_code=exam_code,
            is_answer=is_answer_filename(str(file.filename))
        )
        _set_paper_tokens(paper)
        db.add(paper)
        db.commit()
        db.refresh(paper)

        pdf_path = PDF_DIR / f"paper_{paper.id}.pdf"
        save_upload_with_limit(file, pdf_path, MAX_UPLOAD_BYTES)

        page_output_dir = PAGE_DIR / f"paper_{paper.id}"
        rendered_pages = render_pdf_to_images(pdf_path, page_output_dir)

        paper.pdf_path = str(pdf_path)
        paper.pages_dir = str(page_output_dir)
        paper.page_count = int(rendered_pages)

        detected = detect_is_answer_by_pdf_text(pdf_path)
        if detected is not None and bool(paper.is_answer) != bool(detected):
            paper.is_answer = bool(detected)
            paper.exam_code = normalize_exam_code_for_type(paper.exam_code, bool(detected))
            _set_paper_tokens(paper)
        db.add(paper)
        db.commit()

        try_pair_papers(db, paper)

        ocr_questions: list[dict] = []
        ocr_boxes: list[dict] = []
        ocr_warn: Optional[str] = None
        if ocr_auto and (not bool(paper.is_answer)):
            allowed, reason = auto_suggest_allowed_by_filename(str(file.filename or ""))
            if not allowed:
                ocr_warn = reason
            else:
                ocr_questions, ocr_warn = suggest_question_boxes_from_pdf(
                    Path(pdf_path),
                    int(paper.page_count or 0),
                    min_height_px=int(ocr_min_height_px or 0),
                    y_padding_px=int(ocr_y_padding_px or 0),
                )
            try:
                for q in ocr_questions:
                    label = q.get("label")
                    for b in q.get("boxes") or []:
                        d = {"page": b.get("page"), "bbox": b.get("bbox")}
                        if label is not None:
                            d["label"] = label
                        ocr_boxes.append(d)
            except Exception:
                pass

        results.append(
            {
                "paper_id": int(paper.id),
                "filename": str(file.filename),
                "pages_dir": str(page_output_dir),
                "page_count": int(paper.page_count or 0),
                "paired_paper_id": paper.paired_paper_id,
                "ocr_questions": ocr_questions,
                "ocr_boxes": ocr_boxes,
                "ocr_warning": ocr_warn,
            }
        )
    return {"papers": results}


@router.get("/papers")
def list_papers(db: Session = Depends(get_db)):
    qp_all = (
        db.query(Paper)
        .filter((Paper.is_answer == False) | (Paper.is_answer.is_(None)))
        .order_by(Paper.id.asc())
        .all()
    )
    # Stable numbering independent of "done" sorting
    display_map = {p.id: i + 1 for i, p in enumerate(qp_all)}

    # 未完成的排前面，完成的放最后
    papers = (
        db.query(Paper)
        .filter((Paper.is_answer == False) | (Paper.is_answer.is_(None)))
        .order_by(Paper.done.asc(), Paper.id.desc())
        .all()
    )

    qp_ids = [p.id for p in papers]
    q_count_map: dict[int, int] = {}
    ans_marked_map: dict[int, int] = {}
    if qp_ids:
        q_count_map = {
            int(pid): int(cnt)
            for (pid, cnt) in db.query(Question.paper_id, func.count(Question.id))
            .filter(Question.paper_id.in_(qp_ids))
            .group_by(Question.paper_id)
            .all()
        }
        ans_marked_map = {
            int(pid): int(cnt)
            for (pid, cnt) in db.query(Question.paper_id, func.count(Answer.id))
            .join(Answer, Answer.question_id == Question.id)
            .filter(Question.paper_id.in_(qp_ids))
            .group_by(Question.paper_id)
            .all()
        }
    return {
        "papers": [
            {
                "id": p.id,
                "display_no": display_map.get(p.id),
                "filename": p.filename,
                "exam_code": p.exam_code,
                "page_count": p.page_count,
                "question_count": q_count_map.get(int(p.id), 0),
                "answers_marked": ans_marked_map.get(int(p.id), 0),
                "done": bool(p.done),
                "paired_paper_id": p.paired_paper_id,
                "is_answer": bool(p.is_answer),
                "created_at": p.created_at,
            }
            for p in papers
        ]
    }


@router.post("/papers/{paper_id}/auto_suggest")
def manual_auto_suggest(paper_id: int, req: AutoSuggestRequest, db: Session = Depends(get_db)):
    """Manually trigger auto-suggest for an existing QP paper."""

    paper = db.query(Paper).filter(Paper.id == int(paper_id)).one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    if bool(paper.is_answer):
        raise HTTPException(status_code=400, detail="answer paper auto_suggest not supported here")

    allowed, reason = auto_suggest_allowed_by_filename(str(paper.filename or ""))
    if not allowed:
        return {
            "paper_id": int(paper_id),
            "ocr_questions": [],
            "ocr_boxes": [],
            "ocr_warning": reason,
            "skipped_pages": [],
        }

    pdf_path = Path(str(paper.pdf_path or "")).resolve() if paper.pdf_path else None
    pages_dir = Path(str(paper.pages_dir or "")).resolve() if paper.pages_dir else None
    page_count = int(paper.page_count or 0)
    if pdf_path is None or (not pdf_path.exists()):
        raise HTTPException(status_code=400, detail="paper has no readable pdf_path")
    if pages_dir is None or (not pages_dir.exists()):
        raise HTTPException(status_code=400, detail="paper has no pages_dir")

    # pages that already have any saved question boxes
    marked_pages: set[int] = set(
        int(r[0])
        for r in db.query(QuestionBox.page)
        .filter(QuestionBox.paper_id == int(paper_id))
        .distinct()
        .all()
    )

    ocr_questions, ocr_warn = suggest_question_boxes_from_pdf(
        Path(pdf_path),
        int(paper.page_count or 0),
        min_height_px=int(req.min_height_px or 0),
        y_padding_px=int(req.y_padding_px or 0),
    )

    # filter out boxes on pages already marked
    filtered_questions: list[dict] = []
    ocr_boxes: list[dict] = []
    for q in (ocr_questions or []):
        try:
            boxes = [
                b
                for b in (q.get("boxes") or [])
                if int(b.get("page", 0)) not in marked_pages
            ]
            if not boxes:
                continue
            nq = {"label": q.get("label"), "boxes": boxes}
            filtered_questions.append(nq)
            for b in boxes:
                ocr_boxes.append({"page": int(b.get("page", 0)), "bbox": b.get("bbox"), "label": q.get("label")})
        except Exception:
            continue

    return {
        "paper_id": int(paper_id),
        "ocr_questions": filtered_questions,
        "ocr_boxes": ocr_boxes,
        "ocr_warning": ocr_warn,
        "skipped_pages": sorted(list(marked_pages)),
    }


@router.get("/answer_papers")
def list_answer_papers(db: Session = Depends(get_db)):
    papers = db.query(Paper).filter(Paper.is_answer == True).order_by(Paper.id.desc()).all()

    qp_all = (
        db.query(Paper)
        .filter((Paper.is_answer == False) | (Paper.is_answer.is_(None)))
        .order_by(Paper.id.asc())
        .all()
    )
    qp_display_map = {p.id: i + 1 for i, p in enumerate(qp_all)}
    
    # Get question_count and answers_marked for answer papers (based on paired QP)
    ms_ids = [p.id for p in papers]
    paired_qp_ids = [p.paired_paper_id for p in papers if p.paired_paper_id]
    
    q_count_map: dict[int, int] = {}
    ans_marked_map: dict[int, int] = {}
    if paired_qp_ids:
        q_count_map = {
            int(pid): int(cnt)
            for (pid, cnt) in db.query(Question.paper_id, func.count(Question.id))
            .filter(Question.paper_id.in_(paired_qp_ids))
            .group_by(Question.paper_id)
            .all()
        }
        ans_marked_map = {
            int(pid): int(cnt)
            for (pid, cnt) in db.query(Question.paper_id, func.count(Answer.id))
            .join(Answer, Answer.question_id == Question.id)
            .filter(Question.paper_id.in_(paired_qp_ids))
            .group_by(Question.paper_id)
            .all()
        }
    
    return {
        "papers": [
            {
                "id": p.id,
                # For MS: display_no tries to match the paired QP's display_no
                "display_no": qp_display_map.get(p.paired_paper_id) if p.paired_paper_id else None,
                "filename": p.filename,
                "exam_code": p.exam_code,
                "page_count": p.page_count,
                "paired_paper_id": p.paired_paper_id,
                "done": bool(p.done),
                "question_count": q_count_map.get(int(p.paired_paper_id), 0) if p.paired_paper_id else 0,
                "answers_marked": ans_marked_map.get(int(p.paired_paper_id), 0) if p.paired_paper_id else 0,
                "created_at": p.created_at,
            }
            for p in papers
        ]
    }


@router.get("/answer_papers/lookup")
def lookup_answer_paper(code: str, db: Session = Depends(get_db)):
    code = (code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="code required")
    p = db.query(Paper).filter(Paper.is_answer == True, Paper.exam_code == code).one_or_none()
    if p is None:
        return {"paper": None}
    return {
        "paper": {
            "id": p.id,
            "filename": p.filename,
            "exam_code": p.exam_code,
            "page_count": p.page_count,
            "paired_paper_id": p.paired_paper_id,
        }
    }


@router.get("/papers/{paper_id}")
def get_paper(paper_id: int, db: Session = Depends(get_db)):
    paper = db.query(Paper).filter(Paper.id == paper_id).one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")

    pdf_path = PDF_DIR / f"paper_{paper.id}.pdf"
    pdf_url = f"/data/pdfs/paper_{paper.id}.pdf"
    return {
        "id": paper.id,
        "filename": paper.filename,
        "exam_code": paper.exam_code,
        "done": bool(paper.done),
        "paired_paper_id": paper.paired_paper_id,
        "is_answer": bool(paper.is_answer),
        "pdf_url": _with_cache_bust(pdf_url, _file_mtime_token(pdf_path)),
        "pages_dir": paper.pages_dir,
        "page_count": paper.page_count,
        "created_at": paper.created_at,
    }


@router.patch("/papers/{paper_id}")
def update_paper(paper_id: int, payload: PaperUpdate, db: Session = Depends(get_db)):
    paper = db.query(Paper).filter(Paper.id == paper_id).one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")

    data = payload.model_dump(exclude_unset=True)
    if "exam_code" in data:
        paper.exam_code = data["exam_code"]
        _set_paper_tokens(paper)
    if "done" in data and data["done"] is not None:
        paper.done = bool(data["done"])

    db.add(paper)
    db.commit()
    db.refresh(paper)
    return {
        "paper": {
            "id": paper.id,
            "filename": paper.filename,
            "exam_code": paper.exam_code,
            "page_count": paper.page_count,
            "done": bool(paper.done),
            "created_at": paper.created_at,
        }
    }


@router.delete("/papers/{paper_id}")
def delete_paper(paper_id: int, db: Session = Depends(get_db)):
    """删除整卷：Paper + PDF + 渲染图片 + 题目/框选/草稿。"""
    
    def delete_one(pid: int) -> None:
        paper = db.query(Paper).filter(Paper.id == pid).one_or_none()
        if paper is None:
            return

        # answers linked to this paper (as ms)
        ans_ms = db.query(Answer).filter(Answer.ms_paper_id == pid).all()
        if ans_ms:
            ans_ids = [a.id for a in ans_ms]
            db.query(AnswerBox).filter(AnswerBox.answer_id.in_(ans_ids)).delete(synchronize_session=False)
            db.query(Answer).filter(Answer.id.in_(ans_ids)).delete(synchronize_session=False)

        # answers linked to questions in this paper (as qp)
        q_ids = [qid for (qid,) in db.query(Question.id).filter(Question.paper_id == pid).all()]
        if q_ids:
            ans_q = db.query(Answer).filter(Answer.question_id.in_(q_ids)).all()
            if ans_q:
                aq_ids = [a.id for a in ans_q]
                db.query(AnswerBox).filter(AnswerBox.answer_id.in_(aq_ids)).delete(synchronize_session=False)
                db.query(Answer).filter(Answer.id.in_(aq_ids)).delete(synchronize_session=False)

        db.query(QuestionBox).filter(QuestionBox.paper_id == pid).delete(synchronize_session=False)
        db.query(Question).filter(Question.paper_id == pid).delete(synchronize_session=False)
        db.delete(paper)
        db.commit()

        pdf_path = PDF_DIR / f"paper_{pid}.pdf"
        pages_dir = PAGE_DIR / f"paper_{pid}"
        try:
            if pdf_path.exists():
                pdf_path.unlink()
        except Exception:
            pass
        try:
            if pages_dir.exists() and pages_dir.is_dir():
                shutil.rmtree(pages_dir, ignore_errors=True)
        except Exception:
            pass

    paper = db.query(Paper).filter(Paper.id == paper_id).one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")

    # 删除 QP 时，如存在配对 MS（答案卷），一并删除
    paired_id = paper.paired_paper_id
    paired_should_delete = False
    if paired_id and not bool(paper.is_answer):
        paired = db.query(Paper).filter(Paper.id == paired_id).one_or_none()
        if paired is not None and bool(paired.is_answer):
            paired_should_delete = True

    delete_one(paper_id)
    if paired_should_delete and paired_id:
        delete_one(int(paired_id))

    return {"ok": True}


@router.get("/papers/{paper_id}/pages")
def list_pages(paper_id: int):
    pages_path = PAGE_DIR / f"paper_{paper_id}"
    if not pages_path.exists():
        raise HTTPException(status_code=404, detail="pages not found")

    pngs = list(pages_path.glob("page_*.png"))
    pages: list[dict] = []
    for p in pngs:
        try:
            page_num = int(p.stem.split("_")[-1])
        except Exception:
            continue
        url = f"/data/pages/paper_{paper_id}/{p.name}"
        pages.append({"page": page_num, "image_url": _with_cache_bust(url, _file_mtime_token(p))})
    pages.sort(key=lambda x: x["page"])
    return {"paper_id": paper_id, "pages": pages}
