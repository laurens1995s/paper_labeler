import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, func
from sqlalchemy.orm import Session
from backend.database import Question, QuestionBox, Paper, Answer, AnswerBox, QuestionSection
from backend.schemas.schemas import (
    QuestionCreate,
    QuestionUpdate,
    QuestionBoxesReplace,
    AnswerUpsert,
    QuestionSearchRequest,
    QuestionsBatchUpdate,
)
from backend.dependencies import get_db
from backend.config import PAGE_DIR
from backend.utils import _with_cache_bust, _file_mtime_token

router = APIRouter(tags=["questions"])


def _parse_csv_values(raw: str | None) -> list[str]:
    if raw is None:
        return []
    return [x.strip() for x in str(raw).split(",") if str(x).strip()]


def _normalize_year_token(value) -> str | None:
    s = str(value or "").strip()
    if not s:
        return None
    if s.isdigit():
        if len(s) >= 4:
            return s[-2:]
        if len(s) == 2:
            return s
    m = re.search(r"(\d{2})$", s)
    return m.group(1) if m else None


def _extract_year_season(source: str) -> tuple[str | None, str | None]:
    m = re.search(r"_(m|s|w)(\d{2})_", source, flags=re.IGNORECASE)
    if not m:
        return None, None
    return m.group(2), m.group(1).lower()

def _question_to_dict(
    q: Question,
    boxes: list[QuestionBox],
    db: Session = None,
    sections_override: list[str] | None = None,
) -> dict:
    # 获取多个分类
    sections = list(sections_override or [])
    if (not sections) and db:
        section_rows = db.query(QuestionSection).filter(QuestionSection.question_id == q.id).all()
        sections = [s.section_name for s in section_rows]
    
    # 向后兼容：如果没有 sections 但有老的 section 字段，使用老字段
    if not sections and q.section:
        sections = [q.section]
    
    return {
        "id": q.id,
        "paper_id": q.paper_id,
        "question_no": q.question_no,
        "section": sections[0] if sections else None,  # 兼容老字段
        "sections": sections,  # 新：多个分类
        "status": q.status,
        "notes": q.notes,
        "is_favorite": bool(getattr(q, "is_favorite", False)),
        "updated_at": q.updated_at,
        "boxes": [
            {
                "id": b.id,
                "page": b.page,
                "bbox": b.bbox,
                "image_url": _with_cache_bust(
                    f"/data/pages/paper_{q.paper_id}/page_{b.page}.png",
                    _file_mtime_token(PAGE_DIR / f"paper_{q.paper_id}" / f"page_{b.page}.png"),
                ),
            }
            for b in boxes
        ],
    }

def _answer_to_dict(a: Answer, boxes: list[AnswerBox]) -> dict:
    return {
        "id": a.id,
        "question_id": a.question_id,
        "ms_paper_id": a.ms_paper_id,
        "notes": a.notes,
        "updated_at": a.updated_at,
        "boxes": [
            {
                "id": b.id,
                "page": b.page,
                "bbox": b.bbox,
                "image_url": _with_cache_bust(
                    f"/data/pages/paper_{a.ms_paper_id}/page_{b.page}.png",
                    _file_mtime_token(PAGE_DIR / f"paper_{a.ms_paper_id}" / f"page_{b.page}.png"),
                ),
            }
            for b in boxes
        ],
    }

@router.post("/papers/{paper_id}/questions")
def create_question(paper_id: int, payload: QuestionCreate, db: Session = Depends(get_db)):
    if payload.status not in {"draft", "confirmed"}:
        raise HTTPException(status_code=400, detail="invalid status")
    if not payload.boxes:
        raise HTTPException(status_code=400, detail="boxes required")

    pages_path = PAGE_DIR / f"paper_{paper_id}"
    if not pages_path.exists():
        raise HTTPException(status_code=404, detail="pages not found")

    paper = db.query(Paper).filter(Paper.id == paper_id).one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")

    # Auto-assign global numeric question_no
    rows = db.query(Question.question_no).filter(Question.question_no.isnot(None)).all()
    max_no = 0
    for (v,) in rows:
        if not v:
            continue
        s = str(v).strip()
        if s.isdigit():
            max_no = max(max_no, int(s))

    qno = str(max_no + 1)
    # Safety: in case of races/legacy duplicates, skip forward until unique.
    while db.query(Question).filter(Question.question_no == qno).one_or_none() is not None:
        max_no += 1
        qno = str(max_no + 1)

    # 向后兼容：优先使用 sections，回退到 section
    sections_to_save = payload.sections if payload.sections else ([payload.section] if payload.section else [])
    # 过滤空值并去重
    sections_to_save = list(dict.fromkeys([s for s in sections_to_save if s and s.strip()]))

    q = Question(
        paper_id=paper_id,
        question_no=qno,
        section=sections_to_save[0] if sections_to_save else None,  # 兼容老字段
        status=payload.status,
        notes=payload.notes,
    )
    db.add(q)
    db.commit()
    db.refresh(q)

    # 保存多个分类
    for section_name in sections_to_save:
        qs = QuestionSection(question_id=q.id, section_name=section_name)
        db.add(qs)
    db.commit()

    box_rows: list[QuestionBox] = []
    for box in payload.boxes:
        if len(box.bbox) != 4:
            raise HTTPException(status_code=400, detail="bbox must be 4 floats")
        img_path = pages_path / f"page_{box.page}.png"
        if not img_path.exists():
            raise HTTPException(status_code=400, detail=f"page image missing: {box.page}")
        br = QuestionBox(
            question_id=q.id,
            paper_id=paper_id,
            page=box.page,
            bbox=box.bbox,
            image_path=str(img_path),
        )
        db.add(br)
        box_rows.append(br)

    db.commit()
    for br in box_rows:
        db.refresh(br)

    return {"question": _question_to_dict(q, box_rows, db)}

@router.patch("/questions/{question_id}")
def update_question(question_id: int, payload: QuestionUpdate, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="question not found")
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        if data["status"] not in {"draft", "confirmed"}:
            raise HTTPException(status_code=400, detail="invalid status")
        q.status = data["status"]
    if "question_no" in data:
        raise HTTPException(status_code=400, detail="question_no is read-only")
    
    # 处理多分类更新
    if "sections" in data and data["sections"] is not None:
        sections_to_save = list(dict.fromkeys([s for s in data["sections"] if s and s.strip()]))
        # 删除老的关联
        db.query(QuestionSection).filter(QuestionSection.question_id == q.id).delete(synchronize_session=False)
        # 添加新的关联
        for section_name in sections_to_save:
            qs = QuestionSection(question_id=q.id, section_name=section_name)
            db.add(qs)
        # 更新兼容字段
        q.section = sections_to_save[0] if sections_to_save else None
    elif "section" in data:  # 向后兼容：支持老字段
        section_value = data["section"]
        if section_value and section_value.strip():
            # 删除老的关联
            db.query(QuestionSection).filter(QuestionSection.question_id == q.id).delete(synchronize_session=False)
            # 添加新关联
            qs = QuestionSection(question_id=q.id, section_name=section_value)
            db.add(qs)
            q.section = section_value
        else:
            # 清空分类
            db.query(QuestionSection).filter(QuestionSection.question_id == q.id).delete(synchronize_session=False)
            q.section = None
    
    if "notes" in data:
        q.notes = data["notes"]
    if "is_favorite" in data and data["is_favorite"] is not None:
        q.is_favorite = bool(data["is_favorite"])
    db.add(q)
    db.commit()
    db.refresh(q)
    boxes = db.query(QuestionBox).filter(QuestionBox.question_id == q.id).order_by(QuestionBox.page.asc(), QuestionBox.id.asc()).all()
    return {"question": _question_to_dict(q, boxes, db)}


@router.post("/questions/batch_update")
def batch_update_questions(payload: QuestionsBatchUpdate, db: Session = Depends(get_db)):
    ids = [int(x) for x in payload.ids if int(x) > 0]
    if not ids:
        raise HTTPException(status_code=400, detail="ids required")

    rows = db.query(Question).filter(Question.id.in_(ids)).all()
    found_ids = {int(q.id) for q in rows}
    missing = [x for x in ids if x not in found_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"questions not found: {missing[:5]}")

    sections_to_save = None
    if payload.sections is not None:
        sections_to_save = list(dict.fromkeys([s.strip() for s in payload.sections if s and s.strip()]))

    for q in rows:
        if sections_to_save is not None:
            db.query(QuestionSection).filter(QuestionSection.question_id == q.id).delete(synchronize_session=False)
            for section_name in sections_to_save:
                db.add(QuestionSection(question_id=q.id, section_name=section_name))
            q.section = sections_to_save[0] if sections_to_save else None

        if payload.notes is not None:
            q.notes = payload.notes
        if payload.is_favorite is not None:
            q.is_favorite = bool(payload.is_favorite)
        db.add(q)

    db.commit()
    return {"ok": True, "updated": len(rows)}

@router.get("/questions/{question_id}")
def get_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="question not found")
    boxes = db.query(QuestionBox).filter(QuestionBox.question_id == q.id).order_by(QuestionBox.page.asc(), QuestionBox.id.asc()).all()
    return {"question": _question_to_dict(q, boxes, db)}

@router.post("/questions/{question_id}/boxes")
def replace_question_boxes(question_id: int, payload: QuestionBoxesReplace, db: Session = Depends(get_db)):
    if not payload.boxes:
        raise HTTPException(status_code=400, detail="boxes required")

    q = db.query(Question).filter(Question.id == question_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="question not found")

    pages_path = PAGE_DIR / f"paper_{q.paper_id}"
    if not pages_path.exists():
        raise HTTPException(status_code=404, detail="pages not found")

    # replace all boxes
    db.query(QuestionBox).filter(QuestionBox.question_id == q.id).delete(synchronize_session=False)
    db.commit()

    rows: list[QuestionBox] = []
    for box in payload.boxes:
        if len(box.bbox) != 4:
            raise HTTPException(status_code=400, detail="bbox must be 4 floats")
        img_path = pages_path / f"page_{box.page}.png"
        if not img_path.exists():
            raise HTTPException(status_code=400, detail=f"page image missing: {box.page}")
        br = QuestionBox(
            question_id=q.id,
            paper_id=q.paper_id,
            page=box.page,
            bbox=box.bbox,
            image_path=str(img_path),
        )
        db.add(br)
        rows.append(br)

    db.commit()
    for r in rows:
        db.refresh(r)
    return {"question": _question_to_dict(q, rows, db)}

@router.delete("/question_boxes/{box_id}")
def delete_question_box(box_id: int, db: Session = Depends(get_db)):
    b = db.query(QuestionBox).filter(QuestionBox.id == box_id).one_or_none()
    if b is None:
        raise HTTPException(status_code=404, detail="box not found")
    db.delete(b)
    db.commit()
    return {"ok": True}

@router.delete("/questions/{question_id}")
def delete_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="question not found")

    a = db.query(Answer).filter(Answer.question_id == q.id).one_or_none()
    if a is not None:
        db.query(AnswerBox).filter(AnswerBox.answer_id == a.id).delete(synchronize_session=False)
        db.delete(a)

    db.query(QuestionBox).filter(QuestionBox.question_id == q.id).delete(synchronize_session=False)
    db.delete(q)
    db.commit()
    return {"ok": True}

@router.get("/papers/{paper_id}/questions")
def list_questions_for_paper(paper_id: int, section: str | None = None, status: str | None = None, page: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.paper_id == paper_id)
    
    # 处理多分类筛选
    if section is not None and section != "":
        # 查询该分类的所有题目 ID
        section_qids = db.query(QuestionSection.question_id).filter(QuestionSection.section_name == section).all()
        section_qids = [x[0] for x in section_qids]
        if section_qids:
            # 新旧数据同时兼容：优先关联表，同时保留老字段命中
            q = q.filter(or_(Question.id.in_(section_qids), Question.section == section))
        else:
            # 向后兼容：如果 question_sections 表中没有，尝试查询老字段
            q = q.filter(Question.section == section)
    
    if status is not None and status != "":
        q = q.filter(Question.status == status)
    qs = q.order_by(Question.id.desc()).all()

    qids = [int(item.id) for item in qs]
    box_query = db.query(QuestionBox).filter(QuestionBox.question_id.in_(qids)) if qids else None
    if box_query is not None and page is not None:
        box_query = box_query.filter(QuestionBox.page == page)
    box_rows = (
        box_query.order_by(QuestionBox.question_id.asc(), QuestionBox.page.asc(), QuestionBox.id.asc()).all()
        if box_query is not None
        else []
    )
    boxes_by_qid: dict[int, list[QuestionBox]] = {}
    for b in box_rows:
        boxes_by_qid.setdefault(int(b.question_id), []).append(b)

    sections_by_qid: dict[int, list[str]] = {qid: [] for qid in qids}
    if qids:
        for qid, section_name in (
            db.query(QuestionSection.question_id, QuestionSection.section_name)
            .filter(QuestionSection.question_id.in_(qids))
            .all()
        ):
            sections_by_qid.setdefault(int(qid), []).append(section_name)

    results = []
    for item in qs:
        boxes = boxes_by_qid.get(int(item.id), [])
        if page is not None and not boxes:
            continue
        results.append(
            _question_to_dict(
                item,
                boxes,
                db,
                sections_override=sections_by_qid.get(int(item.id), []),
            )
        )

    return {"paper_id": paper_id, "questions": results}

def _search_questions_core(
    db: Session,
    *,
    section: str | None = None,
    status: str | None = None,
    paper_id: int | None = None,
    paper_ids: list[int] | None = None,
    question_no: str | None = None,
    year: str | None = None,
    years: list[str] | None = None,
    season: str | None = None,
    seasons: list[str] | None = None,
    favorite: bool | None = None,
    unsectioned: bool | None = None,
    exclude_multi_section: bool | None = None,
    page: int = 1,
    page_size: int = 10,
    ids_only: bool = False,
):
    page = max(1, int(page or 1))
    max_page_size = 2000 if ids_only else 200
    page_size = max(1, min(max_page_size, int(page_size or 10)))

    q = db.query(Question, Paper).join(Paper, Question.paper_id == Paper.id)
    paper_id_values: set[int] = set()
    if paper_id is not None:
        paper_id_values.add(int(paper_id))
    for pid in (paper_ids or []):
        try:
            paper_id_values.add(int(pid))
        except Exception:
            continue
    if paper_id_values:
        q = q.filter(Question.paper_id.in_(sorted(paper_id_values)))
    if question_no is not None:
        qno = str(question_no).strip()
        if qno:
            q = q.filter(Question.question_no == qno)

    if section is not None and section != "":
        section_qids = [
            x[0]
            for x in db.query(QuestionSection.question_id)
            .filter(QuestionSection.section_name == section)
            .all()
        ]
        if section_qids:
            q = q.filter(or_(Question.id.in_(section_qids), Question.section == section))
        else:
            q = q.filter(Question.section == section)

    if unsectioned is True:
        has_sections_ids = [x[0] for x in db.query(QuestionSection.question_id).distinct().all()]
        if has_sections_ids:
            q = q.filter(~Question.id.in_(has_sections_ids))
        q = q.filter(or_(Question.section.is_(None), Question.section == ""))
        q = q.filter(db.query(QuestionBox.id).filter(QuestionBox.question_id == Question.id).exists())

    if status is not None and status != "":
        q = q.filter(Question.status == status)
    if favorite is True:
        q = q.filter(Question.is_favorite == True)

    year_values: set[str] = set()
    if year:
        norm = _normalize_year_token(year)
        if norm:
            year_values.add(norm)
    for token in (years or []):
        norm = _normalize_year_token(token)
        if norm:
            year_values.add(norm)

    season_values: set[str] = set()
    if season:
        sv = str(season).strip().lower()
        if sv:
            season_values.add(sv)
    for token in (seasons or []):
        sv = str(token).strip().lower()
        if sv:
            season_values.add(sv)

    rows = q.order_by(Question.id.desc()).all()
    entries = []
    for qq, pp in rows:
        if year_values or season_values:
            y = getattr(pp, "year_token", None)
            s = getattr(pp, "season_token", None)
            if not y or not s:
                source = (pp.exam_code or "") + " " + (pp.filename or "")
                py, ps = _extract_year_season(source)
                y = y or py
                s = s or ps
            if year_values and y not in year_values:
                continue
            if season_values and s not in season_values:
                continue

        if exclude_multi_section is True:
            section_count = (
                db.query(QuestionSection)
                .filter(QuestionSection.question_id == qq.id)
                .count()
            )
            if section_count > 1:
                continue

        entries.append((qq, pp))

    def sort_key(pair: tuple[Question, Paper]):
        qrow = pair[0]
        qno = qrow.question_no
        qid = int(qrow.id or 0)
        if qno is not None:
            s = str(qno).strip()
            if s.isdigit():
                return (0, -int(s), -qid)
        return (1, 0, -qid)

    entries.sort(key=sort_key)
    total = len(entries)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, total_pages)
    start = (page - 1) * page_size
    end = start + page_size
    page_entries = entries[start:end]

    if ids_only:
        ids = [int(qq.id) for qq, _ in page_entries]
        return {
            "question_ids": ids,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    page_qids = [int(qq.id) for qq, _ in page_entries]
    box_rows = (
        db.query(QuestionBox)
        .filter(QuestionBox.question_id.in_(page_qids))
        .order_by(QuestionBox.question_id.asc(), QuestionBox.page.asc(), QuestionBox.id.asc())
        .all()
        if page_qids
        else []
    )
    boxes_by_qid: dict[int, list[QuestionBox]] = {}
    for box in box_rows:
        boxes_by_qid.setdefault(int(box.question_id), []).append(box)
    sections_by_qid: dict[int, list[str]] = {qid: [] for qid in page_qids}
    if page_qids:
        for qid, section_name in (
            db.query(QuestionSection.question_id, QuestionSection.section_name)
            .filter(QuestionSection.question_id.in_(page_qids))
            .all()
        ):
            sections_by_qid.setdefault(int(qid), []).append(section_name)

    results = []
    for qq, pp in page_entries:
        boxes = boxes_by_qid.get(int(qq.id), [])
        d = _question_to_dict(qq, boxes, db, sections_override=sections_by_qid.get(int(qq.id), []))
        d["paper"] = {"id": pp.id, "filename": pp.filename, "exam_code": pp.exam_code}
        results.append(d)

    return {
        "questions": results,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/questions")
def search_questions(
    section: str | None = None,
    status: str | None = None,
    paper_id: int | None = None,
    paper_ids: str | None = None,
    question_no: str | None = None,
    year: str | None = None,
    years: str | None = None,
    season: str | None = None,
    seasons: str | None = None,
    favorite: bool | None = None,
    unsectioned: bool | None = None,
    exclude_multi_section: bool | None = None,
    page: int = 1,
    page_size: int = 10,
    ids_only: bool = False,
    db: Session = Depends(get_db),
):
    return _search_questions_core(
        db,
        section=section,
        status=status,
        paper_id=paper_id,
        paper_ids=[int(v) for v in _parse_csv_values(paper_ids) if str(v).isdigit()],
        question_no=question_no,
        year=year,
        years=_parse_csv_values(years),
        season=season,
        seasons=_parse_csv_values(seasons),
        favorite=favorite,
        unsectioned=unsectioned,
        exclude_multi_section=exclude_multi_section,
        page=page,
        page_size=page_size,
        ids_only=ids_only,
    )


@router.post("/questions/search")
def search_questions_post(payload: QuestionSearchRequest, db: Session = Depends(get_db)):
    return _search_questions_core(
        db,
        section=payload.section,
        status=payload.status,
        paper_id=payload.paper_id,
        paper_ids=payload.paper_ids or [],
        question_no=payload.question_no,
        year=payload.year,
        years=payload.years or [],
        season=payload.season,
        seasons=payload.seasons or [],
        favorite=payload.favorite,
        unsectioned=payload.unsectioned,
        exclude_multi_section=payload.exclude_multi_section,
        page=payload.page,
        page_size=payload.page_size,
        ids_only=bool(payload.ids_only),
    )

@router.get("/questions/{question_id}/answer")
def get_answer_for_question(question_id: int, db: Session = Depends(get_db)):
    q = db.query(Question).filter(Question.id == question_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="question not found")

    a = db.query(Answer).filter(Answer.question_id == question_id).one_or_none()
    if a is None:
        return {"answer": None}
    boxes = db.query(AnswerBox).filter(AnswerBox.answer_id == a.id).order_by(AnswerBox.page.asc(), AnswerBox.id.asc()).all()
    return {"answer": _answer_to_dict(a, boxes)}

@router.post("/questions/{question_id}/answer")
def upsert_answer_for_question(question_id: int, payload: AnswerUpsert, db: Session = Depends(get_db)):
    if not payload.boxes:
        raise HTTPException(status_code=400, detail="boxes required")

    ms_pages_path = PAGE_DIR / f"paper_{payload.ms_paper_id}"
    if not ms_pages_path.exists():
        raise HTTPException(status_code=404, detail="ms pages not found")

    q = db.query(Question).filter(Question.id == question_id).one_or_none()
    if q is None:
        raise HTTPException(status_code=404, detail="question not found")

    ms_paper = db.query(Paper).filter(Paper.id == payload.ms_paper_id).one_or_none()
    if ms_paper is None:
        raise HTTPException(status_code=404, detail="ms paper not found")

    a = db.query(Answer).filter(Answer.question_id == question_id).one_or_none()
    if a is None:
        a = Answer(question_id=question_id, ms_paper_id=payload.ms_paper_id, notes=payload.notes)
        db.add(a)
        db.commit()
        db.refresh(a)
    else:
        a.ms_paper_id = payload.ms_paper_id
        a.notes = payload.notes
        db.add(a)
        db.commit()

    # replace all boxes
    db.query(AnswerBox).filter(AnswerBox.answer_id == a.id).delete(synchronize_session=False)
    db.commit()

    rows: list[AnswerBox] = []
    for box in payload.boxes:
        if len(box.bbox) != 4:
            raise HTTPException(status_code=400, detail="bbox must be 4 floats")
        img_path = ms_pages_path / f"page_{box.page}.png"
        if not img_path.exists():
            raise HTTPException(status_code=400, detail=f"ms page image missing: {box.page}")
        br = AnswerBox(
            answer_id=a.id,
            ms_paper_id=payload.ms_paper_id,
            page=box.page,
            bbox=box.bbox,
            image_path=str(img_path),
        )
        db.add(br)
        rows.append(br)

    db.commit()
    for r in rows:
        db.refresh(r)

    return {"answer": _answer_to_dict(a, rows)}

@router.get("/section_stats")
def get_section_stats(favorite_only: bool = False, db: Session = Depends(get_db)):
    """Get count of questions per section.
    
    Args:
        favorite_only: If True, only count favorite questions
    """
    counts: dict[str, int] = {}

    # 1) New relation table counts
    rel_query = (
        db.query(
            QuestionSection.section_name.label("section"),
            func.count(QuestionSection.question_id).label("count"),
        )
        .join(Question, QuestionSection.question_id == Question.id)
    )
    if favorite_only:
        rel_query = rel_query.filter(Question.is_favorite == True)
    for section, count in rel_query.group_by(QuestionSection.section_name).all():
        key = section or ""
        counts[key] = counts.get(key, 0) + int(count or 0)

    # 2) Legacy Question.section counts (only for questions without relation rows)
    legacy_query = db.query(
        func.coalesce(Question.section, "").label("section"),
        func.count(Question.id).label("count"),
    )
    if favorite_only:
        legacy_query = legacy_query.filter(Question.is_favorite == True)
    legacy_query = legacy_query.filter(
        ~db.query(QuestionSection.id)
        .filter(QuestionSection.question_id == Question.id)
        .exists()
    )
    for section, count in legacy_query.group_by(Question.section).all():
        key = section or ""
        counts[key] = counts.get(key, 0) + int(count or 0)

    out = []
    for section, count in counts.items():
        out.append({"section": section if section else None, "count": int(count)})
    return out


@router.get("/maintenance/questions_integrity")
def questions_integrity_check(db: Session = Depends(get_db)):
    total_questions = int(db.query(func.count(Question.id)).scalar() or 0)
    missing_question_no = int(
        db.query(func.count(Question.id))
        .filter(or_(Question.question_no.is_(None), Question.question_no == ""))
        .scalar()
        or 0
    )

    dup_rows = (
        db.query(Question.question_no, func.count(Question.id).label("cnt"))
        .filter(Question.question_no.isnot(None), Question.question_no != "")
        .group_by(Question.question_no)
        .having(func.count(Question.id) > 1)
        .all()
    )
    duplicate_question_no_groups = len(dup_rows)
    duplicate_question_no_total = int(sum(int(r.cnt or 0) for r in dup_rows))

    orphan_qboxes = int(
        db.query(func.count(QuestionBox.id))
        .outerjoin(Question, Question.id == QuestionBox.question_id)
        .filter(Question.id.is_(None))
        .scalar()
        or 0
    )
    orphan_aboxes = int(
        db.query(func.count(AnswerBox.id))
        .outerjoin(Answer, Answer.id == AnswerBox.answer_id)
        .filter(Answer.id.is_(None))
        .scalar()
        or 0
    )

    numeric_nos = []
    for (v,) in (
        db.query(Question.question_no)
        .filter(Question.question_no.isnot(None), Question.question_no != "")
        .all()
    ):
        s = str(v).strip()
        if s.isdigit():
            numeric_nos.append(int(s))
    unique_nums = sorted(set(numeric_nos))
    missing_nums: list[int] = []
    if unique_nums:
        seen = set(unique_nums)
        lo, hi = unique_nums[0], unique_nums[-1]
        missing_nums = [n for n in range(lo, hi + 1) if n not in seen]

    return {
        "total_questions": total_questions,
        "missing_question_no": missing_question_no,
        "duplicate_question_no_groups": duplicate_question_no_groups,
        "duplicate_question_no_total": duplicate_question_no_total,
        "orphan_question_boxes": orphan_qboxes,
        "orphan_answer_boxes": orphan_aboxes,
        "duplicate_question_no_examples": [str(r.question_no) for r in dup_rows[:10]],
        "question_no_gap_count": len(missing_nums),
        "question_no_gap_examples": missing_nums[:10],
    }


@router.post("/maintenance/questions_repair")
def questions_repair(payload: dict, db: Session = Depends(get_db)):
    dry_run = bool(payload.get("dry_run", True))
    remove_orphan_boxes = bool(payload.get("remove_orphan_boxes", False))
    fill_missing_question_no = bool(payload.get("fill_missing_question_no", False))
    renumber_question_no_sequence = bool(payload.get("renumber_question_no_sequence", False))

    report = {
        "dry_run": dry_run,
        "orphan_question_boxes_removed": 0,
        "orphan_answer_boxes_removed": 0,
        "missing_question_no_filled": 0,
        "question_no_resequenced_changed": 0,
    }

    if fill_missing_question_no:
        max_no = 0
        for (v,) in db.query(Question.question_no).filter(Question.question_no.isnot(None), Question.question_no != "").all():
            s = str(v).strip()
            if s.isdigit():
                max_no = max(max_no, int(s))
        missing_rows = db.query(Question).filter(or_(Question.question_no.is_(None), Question.question_no == "")).order_by(Question.id.asc()).all()
        report["missing_question_no_filled"] = len(missing_rows)
        if not dry_run and missing_rows:
            for q in missing_rows:
                max_no += 1
                q.question_no = str(max_no)
                db.add(q)
            db.commit()

    if remove_orphan_boxes:
        orphan_qids = [
            int(x[0])
            for x in db.query(QuestionBox.id)
            .outerjoin(Question, Question.id == QuestionBox.question_id)
            .filter(Question.id.is_(None))
            .all()
        ]
        orphan_aids = [
            int(x[0])
            for x in db.query(AnswerBox.id)
            .outerjoin(Answer, Answer.id == AnswerBox.answer_id)
            .filter(Answer.id.is_(None))
            .all()
        ]
        report["orphan_question_boxes_removed"] = len(orphan_qids)
        report["orphan_answer_boxes_removed"] = len(orphan_aids)
        if not dry_run:
            if orphan_qids:
                db.query(QuestionBox).filter(QuestionBox.id.in_(orphan_qids)).delete(synchronize_session=False)
            if orphan_aids:
                db.query(AnswerBox).filter(AnswerBox.id.in_(orphan_aids)).delete(synchronize_session=False)
            if orphan_qids or orphan_aids:
                db.commit()

    if renumber_question_no_sequence:
        rows = db.query(Question).order_by(Question.id.asc()).all()

        def _q_sort_key(item: Question):
            s = str(item.question_no or "").strip()
            if s.isdigit():
                return (0, int(s), int(item.id))
            return (1, 10**12, int(item.id))

        rows_sorted = sorted(rows, key=_q_sort_key)
        target_map = {int(q.id): str(i + 1) for i, q in enumerate(rows_sorted)}
        changed = sum(1 for q in rows if str(q.question_no or "").strip() != target_map.get(int(q.id), ""))
        report["question_no_resequenced_changed"] = int(changed)

        if (not dry_run) and changed > 0:
            for q in rows:
                q.question_no = f"__tmp__{q.id}"
                db.add(q)
            db.commit()

            for q in rows:
                q.question_no = target_map[int(q.id)]
                db.add(q)
            db.commit()

    return {"ok": True, "report": report}

@router.post("/random_by_sections")
def get_random_questions_by_sections(payload: dict, db: Session = Depends(get_db)):
    """Randomly select questions based on section quotas.
    
    Payload example: {
        "sections": {"Section A": 5, "Section B": 3},
        "favorite_only": false,
        "exclude_years": ["2023", "2022"]
    }
    Returns: {"question_ids": [1, 5, 8, ...]}
    """
    import random
    
    sections_config = payload.get("sections", {})
    favorite_only = payload.get("favorite_only", False)
    exclude_years = payload.get("exclude_years", [])
    
    if not sections_config:
        raise HTTPException(status_code=400, detail="No sections config provided")

    def _random_pick_ids(config, fav_only, exclude_years_list):
        excluded_years = {
            y for y in (_normalize_year_token(v) for v in (exclude_years_list or [])) if y
        }
        all_ids = []
        for section, count in config.items():
            if count <= 0:
                continue
            query = db.query(Question.id, Question.paper_id)
            if section:
                # Prefer many-to-many section mapping; fall back to legacy Question.section.
                section_qids = [
                    qid
                    for (qid,) in db.query(QuestionSection.question_id)
                    .filter(QuestionSection.section_name == section)
                    .all()
                ]
                if section_qids:
                    query = query.filter(or_(Question.id.in_(section_qids), Question.section == section))
                else:
                    query = query.filter(Question.section == section)
            else:
                query = query.filter((Question.section == "") | (Question.section.is_(None)))
            if fav_only:
                query = query.filter(Question.is_favorite == True)
            results = query.all()
            available_ids = []
            if excluded_years:
                paper_years = {}
                for q_id, p_id in results:
                    if p_id not in paper_years:
                        paper = db.query(Paper).filter(Paper.id == p_id).first()
                        source = f"{paper.exam_code if paper else ''} {paper.filename if paper else ''}"
                        py, _ = _extract_year_season(source)
                        paper_years[p_id] = py
                    paper_year = paper_years.get(p_id)
                    if paper_year and str(paper_year) not in excluded_years:
                        available_ids.append(q_id)
                    elif not paper_year:
                        available_ids.append(q_id)
            else:
                available_ids = [q_id for q_id, p_id in results]
            selected_count = min(count, len(available_ids))
            if selected_count > 0:
                selected = random.sample(available_ids, selected_count)
                all_ids.extend(selected)
        random.shuffle(all_ids)
        return all_ids

    ids = _random_pick_ids(sections_config, favorite_only, exclude_years)
    return {"question_ids": ids}

@router.post("/questions/random_pick")
def random_pick_legacy(
    payload: dict,
    favorite_only: bool = False,
    exclude_years: str | None = None,
    db: Session = Depends(get_db)
):
    """Legacy endpoint for older UI versions."""
    config = payload.get("config") or payload.get("sections") or {}
    years = []
    if exclude_years:
        years = [y for y in str(exclude_years).split(",") if y]
    # Reuse logic via the new endpoint payload
    ids = get_random_questions_by_sections(
        {
            "sections": config,
            "favorite_only": favorite_only,
            "exclude_years": years,
        },
        db,
    )["question_ids"]
    return {"ids": ids, "question_ids": ids}
