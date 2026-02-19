from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.database import SessionLocal, Paper, Question
from backend.dependencies import get_db

router = APIRouter(tags=["stats"])

@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    qp_papers = db.query(Paper).filter((Paper.is_answer == False) | (Paper.is_answer.is_(None))).count()
    ans_papers = db.query(Paper).filter(Paper.is_answer == True).count()
    classified_questions = (
        db.query(Question)
        .filter(Question.section.isnot(None))
        .filter(Question.section != "")
        .count()
    )

    # Global max numeric question_no (pure digits). Used for next-number suggestion on UI startup.
    max_qno = 0
    for (v,) in db.query(Question.question_no).filter(Question.question_no.isnot(None)).all():
        if not v:
            continue
        s = str(v).strip()
        if s.isdigit():
            max_qno = max(max_qno, int(s))
    return {
        "qp_papers": int(qp_papers),
        "answer_papers": int(ans_papers),
        "classified_questions": int(classified_questions),
        "max_question_no_numeric": int(max_qno),
    }
