from __future__ import annotations

import sys
from pathlib import Path
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint, create_engine, Column, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker


def _resolve_app_dir() -> Path:
    """Resolve a stable writable app directory.

    Avoid relying on process CWD because uvicorn reload/spawn can change it,
    causing the app to accidentally create/use a different SQLite file.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


APP_DIR = _resolve_app_dir()
DATA_DIR = APP_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = (DATA_DIR / "app.db").resolve()

# SQLAlchemy expects forward slashes in sqlite URLs.
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine
)

Base = declarative_base()


class Paper(Base):
    __tablename__ = "papers"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    exam_code = Column(String, nullable=True)  # 例如：9709_s25_qp_11（可手动补）
    pdf_path = Column(String, nullable=True)   # 服务器侧保存的 PDF 路径
    pages_dir = Column(String, nullable=True)  # 渲染后的页面目录
    page_count = Column(Integer, nullable=True)
    year_token = Column(String, nullable=True, index=True)   # e.g. "25"
    season_token = Column(String, nullable=True, index=True) # m|s|w
    done = Column(Boolean, nullable=False, default=False)  # 标记是否已完成
    paired_paper_id = Column(Integer, nullable=True, index=True)  # 自动匹配的 qp/ms 对应试卷 id
    is_answer = Column(Boolean, nullable=False, default=False, index=True)  # ms(答案)卷：不在试卷列表展示
    created_at = Column(DateTime, default=datetime.utcnow)


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False, index=True)

    question_no = Column(String, nullable=True)
    section = Column(String, nullable=True)
    status = Column(String, nullable=False, default="confirmed")  # draft|confirmed
    notes = Column(String, nullable=True)
    is_favorite = Column(Boolean, nullable=False, default=False, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class QuestionBox(Base):
    __tablename__ = "question_boxes"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False, index=True)

    page = Column(Integer, nullable=False, index=True)
    bbox = Column(JSON, nullable=False)  # normalized [x0,y0,x1,y1]
    image_path = Column(String, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)


class Answer(Base):
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False, index=True)
    ms_paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False, index=True)
    notes = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("question_id", name="uq_answer_question"),
    )


class AnswerBox(Base):
    __tablename__ = "answer_boxes"

    id = Column(Integer, primary_key=True, index=True)
    answer_id = Column(Integer, ForeignKey("answers.id"), nullable=False, index=True)
    ms_paper_id = Column(Integer, ForeignKey("papers.id"), nullable=False, index=True)

    page = Column(Integer, nullable=False, index=True)
    bbox = Column(JSON, nullable=False)  # normalized [x0,y0,x1,y1]
    image_path = Column(String, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)


class SectionDef(Base):
    __tablename__ = "section_defs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    content = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SectionGroup(Base):
    __tablename__ = "section_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    show_in_filter = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SectionGroupMember(Base):
    __tablename__ = "section_group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("section_groups.id"), nullable=False, index=True)
    section_name = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class QuestionSection(Base):
    """多对多关联表：一个题目可以属于多个分类。"""
    __tablename__ = "question_sections"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False, index=True)
    section_name = Column(String, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("question_id", "section_name", name="uq_question_section"),
    )


def init_db():
    Base.metadata.create_all(bind=engine)

    # Keep common query paths indexed (best-effort, mainly for SQLite).
    try:
        with engine.begin() as conn:
            cols = {str(r[1]) for r in conn.exec_driver_sql("PRAGMA table_info(papers)").fetchall()}
            if "year_token" not in cols:
                conn.exec_driver_sql("ALTER TABLE papers ADD COLUMN year_token VARCHAR")
            if "season_token" not in cols:
                conn.exec_driver_sql("ALTER TABLE papers ADD COLUMN season_token VARCHAR")

            conn.exec_driver_sql(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_question_no_global
                ON questions(question_no)
                WHERE question_no IS NOT NULL AND question_no != ''
                """
            )
            conn.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS idx_questions_question_no
                ON questions(question_no)
                """
            )
            conn.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS idx_question_sections_qid_name
                ON question_sections(question_id, section_name)
                """
            )
            conn.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS idx_question_sections_name_qid
                ON question_sections(section_name, question_id)
                """
            )
            conn.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS idx_papers_year_token
                ON papers(year_token)
                """
            )
            conn.exec_driver_sql(
                """
                CREATE INDEX IF NOT EXISTS idx_papers_season_token
                ON papers(season_token)
                """
            )
    except Exception:
        # If index creation fails, keep running.
        pass

    # Legacy data migration: section -> question_sections
    try:
        with SessionLocal() as db:
            from sqlalchemy import text
            result = db.execute(text("""
                SELECT q.id, q.section
                FROM questions q
                WHERE q.section IS NOT NULL AND q.section != ''
                AND NOT EXISTS (
                    SELECT 1 FROM question_sections qs WHERE qs.question_id = q.id
                )
            """))
            to_migrate = result.fetchall()

            if to_migrate:
                for qid, section in to_migrate:
                    db.execute(text("""
                        INSERT OR IGNORE INTO question_sections (question_id, section_name, created_at)
                        VALUES (:qid, :section, :now)
                    """), {"qid": qid, "section": section, "now": datetime.utcnow()})
                db.commit()
    except Exception:
        pass

    # Legacy data migration: backfill paper year/season tokens
    try:
        import re
        with SessionLocal() as db:
            changed = False
            for paper in db.query(Paper).all():
                row_changed = False
                source = f"{paper.exam_code or ''} {paper.filename or ''}"
                m = re.search(r"_(m|s|w)(\d{2})_", source, flags=re.IGNORECASE)
                y = m.group(2) if m else None
                s = m.group(1).lower() if m else None
                if (paper.year_token or None) != y:
                    paper.year_token = y
                    row_changed = True
                if (paper.season_token or None) != s:
                    paper.season_token = s
                    row_changed = True
                if row_changed:
                    changed = True
                    db.add(paper)
            if changed:
                db.commit()
    except Exception:
        pass
