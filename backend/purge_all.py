from __future__ import annotations

import argparse
import sys
import shutil
from pathlib import Path

# When executed as a script, ensure project root is on sys.path so `backend.*` imports work.
if __package__ is None or __package__ == "":
    _ROOT = Path(__file__).resolve().parents[1]
    if str(_ROOT) not in sys.path:
        sys.path.insert(0, str(_ROOT))

from backend.database import Answer, AnswerBox, Paper, Question, QuestionBox, SectionDef, SessionLocal


def _safe_unlink(p: Path) -> None:
    try:
        if p.exists() and p.is_file():
            p.unlink()
    except Exception:
        pass


def _safe_rmtree(p: Path) -> None:
    try:
        if p.exists() and p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
    except Exception:
        pass


def purge_all(*, wipe_sections: bool, wipe_files: bool) -> None:
    """极其危险：清空所有试卷/题目/答案（可选清空模块/清空文件）。"""
    base_dir = Path(__file__).resolve().parents[1]
    data_dir = base_dir / "data"
    pdf_dir = data_dir / "pdfs"
    page_dir = data_dir / "pages"

    db = SessionLocal()
    try:
        # DB: delete children first
        db.query(AnswerBox).delete(synchronize_session=False)
        db.query(Answer).delete(synchronize_session=False)
        db.query(QuestionBox).delete(synchronize_session=False)
        db.query(Question).delete(synchronize_session=False)
        if wipe_sections:
            db.query(SectionDef).delete(synchronize_session=False)
        db.query(Paper).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    if wipe_files:
        try:
            if pdf_dir.exists():
                for p in pdf_dir.glob("paper_*.pdf"):
                    _safe_unlink(p)
        except Exception:
            pass

        try:
            if page_dir.exists():
                for d in page_dir.glob("paper_*"):
                    _safe_rmtree(d)
        except Exception:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DANGEROUS: purge all data (DB + files)")
    parser.add_argument("--wipe-sections", action="store_true", help="also delete section_defs")
    parser.add_argument(
        "--keep-files",
        action="store_true",
        help="do not delete data/pdfs and data/pages (DB only)",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="skip interactive confirmation (not recommended)",
    )
    args = parser.parse_args(argv)

    print("\n=== 极其危险：一键清空 ===")
    print("将删除：所有试卷、题目、框选、答案")
    print(f"模块预设 section_defs：{'也会删除' if args.wipe_sections else '保留'}")
    print(f"PDF/图片文件：{'保留' if args.keep_files else '也会删除'}")

    if not args.yes:
        c1 = input("\n请输入 DELETE_ALL 以继续：").strip()
        if c1 != "DELETE_ALL":
            print("已取消。")
            return 1
        c2 = input("请输入 I_UNDERSTAND 以继续：").strip()
        if c2 != "I_UNDERSTAND":
            print("已取消。")
            return 1

    purge_all(wipe_sections=bool(args.wipe_sections), wipe_files=not bool(args.keep_files))
    print("\n完成：已清空。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
