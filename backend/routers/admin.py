import shutil
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.database import SessionLocal, Paper, Question, QuestionBox, Answer, AnswerBox, SectionDef
from backend.schemas.schemas import PurgeAllRequest
from backend.config import PDF_DIR, PAGE_DIR
from backend.dependencies import get_db

router = APIRouter(tags=["admin"])

@router.post("/admin/purge_all")
def admin_purge_all(payload: PurgeAllRequest, db: Session = Depends(get_db)):
    """极其危险：一键清空所有试卷/题目/答案/文件。需要双重确认。"""
    if payload.confirm1 != "DELETE_ALL" or payload.confirm2 != "I_UNDERSTAND":
        raise HTTPException(status_code=400, detail="confirmation mismatch")

    # DB: delete children first
    db.query(AnswerBox).delete(synchronize_session=False)
    db.query(Answer).delete(synchronize_session=False)
    db.query(QuestionBox).delete(synchronize_session=False)
    db.query(Question).delete(synchronize_session=False)
    if payload.wipe_sections:
        db.query(SectionDef).delete(synchronize_session=False)
    db.query(Paper).delete(synchronize_session=False)
    db.commit()

    # Files: wipe pdfs/pages
    try:
        if PDF_DIR.exists():
            for p in PDF_DIR.glob("paper_*.pdf"):
                try:
                    p.unlink()
                except Exception:
                    pass
    except Exception:
        pass

    try:
        if PAGE_DIR.exists():
            for d in PAGE_DIR.glob("paper_*"):
                try:
                    if d.is_dir():
                        shutil.rmtree(d, ignore_errors=True)
                except Exception:
                    pass
    except Exception:
        pass

    return {"ok": True}
