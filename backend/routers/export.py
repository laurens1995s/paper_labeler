from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from typing import List, Optional
import time
import os
import shutil
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque
import threading
from pathlib import Path

from backend.config import DATA_DIR

router = APIRouter()

class ExportOptions(BaseModel):
    include_question_no: bool = True
    include_section: bool = True
    include_paper: bool = True
    include_original_qno: bool = False
    include_notes: bool = False
    include_answers: bool = False
    answers_placement: str = "end"  # end, interleaved
    filter_section: Optional[str] = None  # 当前筛选的section，用于优先显示
    filename: Optional[str] = None
    save_dir: Optional[str] = None
    include_filter_summary: bool = False
    filter_summary_lines: Optional[List[str]] = None
    crop_workers: int = 0  # 0=auto

class ExportRequest(BaseModel):
    ids: List[int]
    options: Optional[ExportOptions] = None

class PickSaveDirRequest(BaseModel):
    initial_dir: Optional[str] = None

# In-memory job store (simple for now)
# job_id -> { status: "processing"|"done"|"error", path: str, msg: str }
export_jobs = {}
export_job_queue = deque()  # items: (job_id, ExportRequest)
export_job_queue_lock = threading.Lock()
export_worker_started = False


def _queue_position(job_id: str) -> int:
    with export_job_queue_lock:
        for idx, (jid, _) in enumerate(export_job_queue):
            if jid == job_id:
                return idx
    return 0


def _ensure_export_worker():
    global export_worker_started
    if export_worker_started:
        return
    with export_job_queue_lock:
        if export_worker_started:
            return
        t = threading.Thread(target=_export_worker_loop, daemon=True)
        t.start()
        export_worker_started = True


def _export_worker_loop():
    while True:
        item = None
        with export_job_queue_lock:
            if export_job_queue:
                item = export_job_queue.popleft()
        if not item:
            time.sleep(0.08)
            continue
        job_id, req = item
        job = export_jobs.get(job_id)
        if not job:
            continue
        if job.get("status") == "cancelled":
            continue
        job["status"] = "processing"
        job["phase"] = "processing"
        job["progress"] = {"done": 1, "total": 3, "percent": 33.3}
        process_export_job(job_id, req)

# 启动时清理旧的导出文件
def cleanup_old_export_files():
    """清理所有旧的导出文件，避免积累占用空间"""
    export_dir = DATA_DIR / "_export_jobs"
    if export_dir.exists():
        try:
            # 清理PDF文件和JSON文件
            for pattern in ["*.pdf", "*.json"]:
                for file in export_dir.glob(pattern):
                    try:
                        file.unlink()
                    except Exception as e:
                        print(f"删除旧导出文件失败 {file}: {e}")
            print(f"清理旧导出文件完成: {export_dir}")
        except Exception as e:
            print(f"清理旧导出文件失败: {e}")

# 启动时执行清理
cleanup_old_export_files()

def _pick_directory(initial_dir: Optional[str]) -> Optional[str]:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as e:
        raise RuntimeError(f"系统目录选择器不可用：{e}") from e

    root = None
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update_idletasks()
        kwargs = {"title": "选择导出目录"}
        initial = str(initial_dir or "").strip()
        if initial and Path(initial).exists():
            kwargs["initialdir"] = initial
        selected = filedialog.askdirectory(**kwargs)
        if not selected:
            return None
        return str(Path(selected).resolve())
    finally:
        if root is not None:
            try:
                root.destroy()
            except Exception:
                pass

@router.post("/pick_save_dir")
async def pick_save_dir(req: PickSaveDirRequest):
    try:
        selected = _pick_directory(req.initial_dir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not selected:
        return {"cancelled": True}
    return {"cancelled": False, "selected": selected}

@router.post("/questions_pdf_job")
def create_export_job(req: ExportRequest, background_tasks: BackgroundTasks):
    try:
        _ensure_export_worker()
        job_id = f"job_{int(time.time()*1000)}"
        export_jobs[job_id] = {
            "status": "queued",
            "path": None,
            "filename": None,
            "saved_copy_path": None,
            "msg": "queued",
            "phase": "queued",
            "progress": {"done": 0, "total": 3, "percent": 0.0},
            "created_at": int(time.time() * 1000),
        }
        with export_job_queue_lock:
            export_job_queue.append((job_id, req))
        return {
            "job_id": job_id,
            "status": "queued",
            "queue_position": _queue_position(job_id),
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/questions_pdf_job/{job_id}")
def check_export_status(job_id: str):
    job = export_jobs.get(job_id)
    if not job:
        # Fallback: multi-worker may not share memory; check file on disk.
        fallback_path = DATA_DIR / "_export_jobs" / f"{job_id}.pdf"
        if fallback_path.exists():
            return {
                "status": "done",
                "download_url": f"/export/download/{job_id}",
                "progress": {"done": 1, "total": 1, "percent": 100.0},
            }
        raise HTTPException(status_code=404, detail="Job not found")

    st = job.get("status")
    if st == "queued":
        return {
            "status": "queued",
            "queue_position": _queue_position(job_id),
            "phase": job.get("phase") or "queued",
            "progress": job.get("progress") or {"done": 0, "total": 3, "percent": 0.0},
        }
    if st == "processing":
        return {
            "status": "processing",
            "phase": job.get("phase") or "processing",
            "progress": job.get("progress") or {"done": 1, "total": 3, "percent": 33.3},
        }
    if st == "done":
        return {
            "status": "done",
            "download_url": f"/export/download/{job_id}",
            "saved_copy_path": job.get("saved_copy_path"),
            "phase": "done",
            "progress": job.get("progress") or {"done": 3, "total": 3, "percent": 100.0},
        }
    if st == "cancelled":
        return {
            "status": "cancelled",
            "message": job.get("msg") or "cancelled",
            "phase": "cancelled",
            "progress": job.get("progress") or {"done": 0, "total": 3, "percent": 0.0},
        }
    if st == "error":
        return {
            "status": "error",
            "message": job.get("msg") or "error",
            "phase": "error",
            "progress": job.get("progress") or {"done": 0, "total": 3, "percent": 0.0},
        }

    return {"status": "processing"}


@router.post("/questions_pdf_job/{job_id}/cancel")
def cancel_export_job(job_id: str):
    job = export_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    st = job.get("status")
    if st in {"done", "error", "cancelled"}:
        return {"status": st}
    if st == "processing":
        return {"status": "processing", "message": "processing job cannot be cancelled yet"}

    # queued
    with export_job_queue_lock:
        kept = deque()
        while export_job_queue:
            jid, req = export_job_queue.popleft()
            if jid != job_id:
                kept.append((jid, req))
        export_job_queue.extend(kept)
    job["status"] = "cancelled"
    job["msg"] = "cancelled"
    job["phase"] = "cancelled"
    job["progress"] = {"done": 0, "total": 3, "percent": 0.0}
    return {"status": "cancelled"}


@router.get("/download/{job_id}")
def download_export_file(job_id: str):
    job = export_jobs.get(job_id)
    path = None
    filename = None
    if job and job.get("status") == "done" and job.get("path"):
        path = job["path"]
        filename = job.get("filename")
    else:
        # Fallback: multi-worker may not share memory; check file on disk.
        fallback_path = DATA_DIR / "_export_jobs" / f"{job_id}.pdf"
        if fallback_path.exists():
            path = str(fallback_path)
            filename = _read_download_filename_from_meta(job_id)
    if not path:
        raise HTTPException(status_code=404, detail="File not ready")
    if not filename:
        filename = f"export_{job_id}.pdf"

    return FileResponse(
        path,
        filename=filename,
        media_type="application/pdf"
    )

from sqlalchemy.orm import Session
from fpdf import FPDF
from PIL import Image
from backend.database import SessionLocal, Question, QuestionBox, Answer, AnswerBox, Paper, QuestionSection, SectionGroup, SectionGroupMember
from backend.config import DATA_DIR, PAGE_DIR
import traceback

# Custom PDF class with page numbers
class PDFWithPageNumbers(FPDF):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # When a summary cover is inserted, keep question pages starting from 1.
        self.page_number_offset = 0
        self.page_number_enabled = True

    def footer(self):
        """Add centered page numbers at the bottom of each page."""
        if not getattr(self, "page_number_enabled", True):
            return
        display_no = self.page_no() - int(getattr(self, "page_number_offset", 0) or 0)
        if display_no <= 0:
            return
        self.set_y(-15)
        self.set_font('Arial', 'I', 8)
        self.set_text_color(128, 128, 128)
        # Page number centered
        self.cell(0, 10, f'{display_no}', 0, 0, 'C')

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _crop_image_with_bbox(img: Image.Image, bbox: list) -> Image.Image:
    """Crop image according to normalized bbox [x0, y0, x1, y1]."""
    w, h = img.size
    x0, y0, x1, y1 = bbox
    # Convert normalized to pixel coordinates
    px0 = int(x0 * w)
    py0 = int(y0 * h)
    px1 = int(x1 * w)
    py1 = int(y1 * h)
    # Ensure valid crop box
    px0 = max(0, min(w, px0))
    py0 = max(0, min(h, py0))
    px1 = max(px0, min(w, px1))
    py1 = max(py0, min(h, py1))
    return img.crop((px0, py0, px1, py1))


def _sanitize_download_filename(raw: str | None, default_name: str) -> str:
    name = str(raw or "").strip()
    if not name:
        name = default_name
    name = re.sub(r"[\\/:*?\"<>|]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip().strip(".")
    if not name:
        name = default_name
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    if len(name) > 160:
        stem, ext = os.path.splitext(name)
        name = f"{stem[:150]}{ext or '.pdf'}"
    return name


def _read_download_filename_from_meta(job_id: str) -> str | None:
    meta_path = DATA_DIR / "_export_jobs" / f"{job_id}.json"
    if not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    filename = meta.get("filename") if isinstance(meta, dict) else None
    if not filename:
        return None
    return _sanitize_download_filename(filename, f"export_{job_id}")


def _normalize_filter_summary_lines(lines: list[str] | None) -> list[str]:
    raw = [str(x).strip() for x in (lines or []) if str(x).strip()]
    if not raw:
        return []
    labels = ["Section", "Paper", "Year", "Season", "Favorites", "Count"]
    out: list[str] = []
    for i, line in enumerate(raw):
        if i >= len(labels):
            out.append(line)
            continue
        if "：" in line:
            _, rhs = line.split("：", 1)
            out.append(f"{labels[i]}: {rhs.strip()}")
            continue
        if ":" in line:
            _, rhs = line.split(":", 1)
            out.append(f"{labels[i]}: {rhs.strip()}")
            continue
        out.append(line)
    return out


def _make_pdf(job_id, ids, options, progress_cb=None):
    db: Session = SessionLocal()
    out_dir = DATA_DIR / "_export_jobs"
    out_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = out_dir / f"_tmp_{job_id}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_files = []
    try:
        # Load all questions with their paper info
        questions = []
        for qid in ids:
            q = db.query(Question).filter(Question.id == qid).first()
            if q:
                questions.append(q)
        
        if not questions:
            raise Exception("未找到可导出的题目")
        
        # Extract options
        include_qno = options.include_question_no if options else True
        include_section = options.include_section if options else True
        include_paper = options.include_paper if options else True
        include_original_qno = options.include_original_qno if options else False
        include_notes = options.include_notes if options else False
        include_answers = options.include_answers if options else False
        answers_placement = options.answers_placement if options else "end"
        include_filter_summary = options.include_filter_summary if options else False
        filter_summary_lines = _normalize_filter_summary_lines(list(options.filter_summary_lines or [])) if options else []
        crop_workers_opt = int(getattr(options, "crop_workers", 0) or 0) if options else 0
        crop_workers_opt = max(0, min(32, crop_workers_opt))
        save_dir = str(options.save_dir or "").strip() if options else ""
        download_filename = _sanitize_download_filename(
            options.filename if options else None,
            f"export_{job_id}",
        )
            
        pdf = PDFWithPageNumbers()  # Use custom PDF class with page numbers
        pdf.page_number_offset = 1 if include_filter_summary else 0
        pdf.set_auto_page_break(auto=False, margin=15)
        pdf.set_font("Arial", size=10)

        def load_section_label_map():
            label_map = {}
            rows = (
                db.query(SectionGroupMember, SectionGroup)
                .join(SectionGroup, SectionGroupMember.group_id == SectionGroup.id)
                .all()
            )
            for m, g in rows:
                if not m or not g:
                    continue
                if m.section_name and g.name:
                    label_map[m.section_name] = f"{g.name}_{m.section_name}"
            return label_map

        section_label_map = load_section_label_map()

        def _pdf_text(value: str) -> str:
            text = str(value or "")
            try:
                return text.encode("latin-1", "replace").decode("latin-1")
            except Exception:
                return text

        total_units = len(questions) + (len(questions) if include_answers else 0) + 1
        done_units = 0

        def report_progress(phase: str):
            nonlocal done_units
            done_units += 1
            if callable(progress_cb):
                progress_cb(done_units, total_units, phase)

        def build_cropped_image_items(boxes):
            if not boxes:
                return []

            def resolve_image_path(b):
                img_path = b.image_path
                final_path = Path(img_path)
                if not final_path.exists():
                    final_path = DATA_DIR / img_path
                if not final_path.exists():
                    pid = getattr(b, "paper_id", None)
                    if pid is None:
                        pid = getattr(b, "ms_paper_id", None)
                    page_no = getattr(b, "page", None)
                    if pid is not None and page_no is not None:
                        fallback = PAGE_DIR / f"paper_{int(pid)}" / f"page_{int(page_no)}.png"
                        if fallback.exists():
                            final_path = fallback
                return final_path

            def crop_one(idx, b):
                final_path = resolve_image_path(b)
                if not final_path.exists():
                    return None
                try:
                    with Image.open(final_path) as full_img:
                        cropped_img = _crop_image_with_bbox(full_img, b.bbox)
                        w_px, h_px = cropped_img.size
                        if w_px <= 0 or h_px <= 0:
                            return None
                        aspect = h_px / w_px
                        max_w = 180
                        render_w = min(max_w, w_px * 0.264583)
                        render_h = render_w * aspect
                        tmp_file = temp_dir / f"crop_{job_id}_{idx}_{time.time_ns()}.png"
                        cropped_img.save(tmp_file, format="PNG")
                        return idx, tmp_file, render_w, render_h
                except Exception as e:
                    print(f"处理图片失败 {final_path}: {e}")
                    return None

            results = []
            if len(boxes) == 1:
                one = crop_one(0, boxes[0])
                if one:
                    results.append(one)
            else:
                cpu = os.cpu_count() or 4
                max_workers = crop_workers_opt if crop_workers_opt > 0 else min(12, max(2, cpu))
                with ThreadPoolExecutor(max_workers=max_workers) as ex:
                    futures = [ex.submit(crop_one, idx, b) for idx, b in enumerate(boxes)]
                    for fut in as_completed(futures):
                        one = fut.result()
                        if one:
                            results.append(one)

            if not results:
                return []

            results.sort(key=lambda x: x[0])
            items = []
            for _, tmp_file, render_w, render_h in results:
                temp_files.append(tmp_file)
                items.append((str(tmp_file), render_w, render_h))
            return items

        def render_filter_summary_page(lines):
            pdf.add_page()
            page_h = pdf.h
            # Align with question content outer frame: x = content_x - 2 (15 - 2)
            box_x = 13
            box_y = 12
            # Align width with question content outer frame: 180 + 4
            box_w = 184
            box_h = page_h - 20
            pdf.rect(box_x, box_y, box_w, box_h)

            info_lines = [str(x).strip() for x in (lines or []) if str(x).strip()]
            if not info_lines:
                info_lines = ["(No filters)"]

            line_h = 14
            body_h = len(info_lines) * line_h
            total_h = body_h
            start_y = box_y + max(8, (box_h - total_h) / 2)

            pdf.set_y(start_y)
            pdf.set_font("Arial", size=18)
            for line in info_lines:
                pdf.cell(0, line_h, _pdf_text(line), ln=True, align="C")

        def render_question(q, export_seq_no):
            """Render a single question page."""
            paper = db.query(Paper).filter(Paper.id == q.paper_id).first()
            q_boxes = db.query(QuestionBox).filter(QuestionBox.question_id == q.id).order_by(QuestionBox.page, QuestionBox.id).all()
            
            if not q_boxes:
                return
            
            # One page per question
            pdf.add_page()
            
            # Question Header - show according to options
            header_parts = []
            if include_qno:
                # Use export sequence number instead of original question_no
                header_parts.append(f"Q{export_seq_no}")
            if include_original_qno and q.question_no:
                # Show original question number from database
                header_parts.append(f"[{q.question_no}]")
            if include_section:
                # 查询该题目的所有分类
                question_sections = db.query(QuestionSection).filter(QuestionSection.question_id == q.id).all()
                section_names = [qs.section_name for qs in question_sections]
                
                # 如果没有多分类，回退到旧的section字段
                if not section_names and q.section:
                    section_names = [q.section]
                
                # 如果有filter_section，把它放在最前面
                filter_section = options.filter_section if options else None
                if filter_section and filter_section in section_names:
                    section_names.remove(filter_section)
                    section_names.insert(0, filter_section)
                
                if section_names:
                    display_sections = [section_label_map.get(name, name) for name in section_names]
                    header_parts.append(", ".join(display_sections))
                else:
                    header_parts.append("Uncategorized")
            if include_paper:
                if paper and paper.exam_code:
                    header_parts.append(paper.exam_code)
                elif paper and paper.filename:
                    header_parts.append(paper.filename)
            if include_notes and q.notes:
                header_parts.append(f"Note: {q.notes}")
            
            if header_parts:
                pdf.set_font("Arial", 'B', size=11)
                pdf.cell(0, 8, _pdf_text(" - ".join(header_parts)), ln=True)
                pdf.ln(2)
            
            # Calculate total height needed for all question boxes
            total_images = build_cropped_image_items(q_boxes)
            
            # Draw all images with a border that extends to page bottom
            if total_images:
                start_y = pdf.get_y()
                content_x = 15
                current_y = start_y
                border_w = total_images[-1][1]
                
                # Draw each image
                for img_path, render_w, render_h in total_images:
                    pdf.image(img_path, x=content_x, y=current_y, w=render_w)
                    current_y += render_h + 2
                
                # Draw border from start to page bottom (leave 15mm margin)
                # A4 page height is 297mm, bottom margin at 282mm
                page_bottom = 282
                total_height = page_bottom - start_y
                pdf.rect(content_x - 2, start_y - 2, border_w + 4, total_height + 2)
                
                # Add a light separator line after question content
                separator_y = current_y + 3
                pdf.set_draw_color(200, 200, 200)  # Light gray
                pdf.line(content_x, separator_y, content_x + border_w, separator_y)
                pdf.set_draw_color(0, 0, 0)  # Reset to black
                
                pdf.set_y(current_y)

                # If the question occupies >=70% of available height, add a blank page after it.
                available_height = page_bottom - start_y
                content_height = current_y - start_y
                if available_height > 0 and (content_height / available_height) >= 0.7:
                    pdf.add_page()
                    pdf.set_y(start_y)
                    pdf.rect(content_x - 2, start_y - 2, border_w + 4, total_height + 2)
        
        def render_answer(q, export_seq_no):
            """Render answer pages (auto paginate when answer is too tall)."""
            ans = db.query(Answer).filter(Answer.question_id == q.id).first()
            if not ans:
                return
                
            a_boxes = db.query(AnswerBox).filter(AnswerBox.answer_id == ans.id).order_by(AnswerBox.page, AnswerBox.id).all()
            if not a_boxes:
                return

            paper = db.query(Paper).filter(Paper.id == q.paper_id).first()

            # Calculate and draw answer images
            total_images = build_cropped_image_items(a_boxes)
            
            if not total_images:
                return

            content_x = 15
            page_bottom = 282
            inter_gap = 2
            current_y = None
            start_y = 0
            page_max_w = 0.0
            page_has_content = False
            continued = False

            def start_answer_page():
                nonlocal current_y, start_y, page_max_w, page_has_content
                pdf.add_page()
                header_parts = ["Answer"]
                if include_qno:
                    header_parts.append(f"Q{export_seq_no}")
                if include_original_qno and q.question_no:
                    header_parts.append(f"[{q.question_no}]")
                if include_section:
                    question_sections = db.query(QuestionSection).filter(QuestionSection.question_id == q.id).all()
                    section_names = [qs.section_name for qs in question_sections]
                    if not section_names and q.section:
                        section_names = [q.section]
                    filter_section = options.filter_section if options else None
                    if filter_section and filter_section in section_names:
                        section_names.remove(filter_section)
                        section_names.insert(0, filter_section)
                    if section_names:
                        display_sections = [section_label_map.get(name, name) for name in section_names]
                        header_parts.append(", ".join(display_sections))
                    else:
                        header_parts.append("Uncategorized")
                if include_paper:
                    if paper and paper.exam_code:
                        header_parts.append(paper.exam_code)
                    elif paper and paper.filename:
                        header_parts.append(paper.filename)
                if continued:
                    header_parts.append("continued")

                pdf.set_font("Arial", 'B', size=11)
                pdf.cell(0, 8, _pdf_text(" - ".join(header_parts)), ln=True)
                pdf.ln(2)
                start_y = pdf.get_y()
                current_y = start_y
                page_max_w = 0.0
                page_has_content = False

            def finish_answer_page():
                if not page_has_content:
                    return
                total_h = max(0.0, current_y - start_y - inter_gap)
                pdf.rect(content_x - 2, start_y - 2, page_max_w + 4, total_h + 4)

            start_answer_page()
            for img_path, render_w, render_h in total_images:
                avail_h = page_bottom - current_y
                if page_has_content and render_h > avail_h:
                    finish_answer_page()
                    continued = True
                    start_answer_page()
                    avail_h = page_bottom - current_y

                draw_w = render_w
                draw_h = render_h
                if draw_h > avail_h and avail_h > 5:
                    scale = avail_h / draw_h
                    draw_h = avail_h
                    draw_w = max(10, draw_w * scale)

                pdf.image(img_path, x=content_x, y=current_y, w=draw_w)
                current_y += draw_h + inter_gap
                page_max_w = max(page_max_w, draw_w)
                page_has_content = True

            finish_answer_page()
            pdf.set_y(current_y)
        
        # Render questions and answers according to placement option
        if include_filter_summary:
            render_filter_summary_page(filter_summary_lines)

        if answers_placement == "interleaved" and include_answers:
            # One question, then its answer, repeat
            for idx, q in enumerate(questions, start=1):
                render_question(q, idx)
                report_progress(f"正在渲染题目 {idx}/{len(questions)}")
                render_answer(q, idx)
                report_progress(f"正在渲染答案 {idx}/{len(questions)}")
        else:
            # All questions first
            for idx, q in enumerate(questions, start=1):
                render_question(q, idx)
                report_progress(f"正在渲染题目 {idx}/{len(questions)}")
            # Then all answers at the end
            if include_answers:
                for idx, q in enumerate(questions, start=1):
                    render_answer(q, idx)
                    report_progress(f"正在渲染答案 {idx}/{len(questions)}")

        report_progress("正在写入 PDF 文件")
        out_file = out_dir / f"{job_id}.pdf"
        pdf.output(str(out_file))
        saved_copy_path = None
        save_copy_error = None
        if save_dir:
            try:
                target_dir = Path(save_dir).expanduser()
                target_dir.mkdir(parents=True, exist_ok=True)
                target_file = target_dir / download_filename
                if target_file.exists():
                    stem = target_file.stem
                    suffix = target_file.suffix or ".pdf"
                    n = 2
                    while True:
                        cand = target_dir / f"{stem}({n}){suffix}"
                        if not cand.exists():
                            target_file = cand
                            break
                        n += 1
                shutil.copyfile(out_file, target_file)
                saved_copy_path = str(target_file)
            except Exception as e:
                save_copy_error = str(e)
        if save_dir and not saved_copy_path:
            reason = save_copy_error or "unknown error"
            raise Exception(f"保存到指定目录失败: {reason}")
        meta_file = out_dir / f"{job_id}.json"
        try:
            meta_file.write_text(
                json.dumps(
                    {
                        "filename": download_filename,
                        "saved_copy_path": saved_copy_path,
                        "save_copy_error": save_copy_error,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        except Exception:
            pass
        
        return str(out_file), download_filename, saved_copy_path

    finally:
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass
        db.close()

def process_export_job(job_id: str, req: ExportRequest):
    job = export_jobs.get(job_id)
    if job:
        job["phase"] = "initializing"
        job["progress"] = {"done": 0, "total": 1, "percent": 0.0}

    def _on_progress(done, total, phase):
        j = export_jobs.get(job_id)
        if not j or j.get("status") in {"cancelled", "error", "done"}:
            return
        total_safe = max(1, int(total or 1))
        done_safe = max(0, min(total_safe, int(done or 0)))
        pct = round((done_safe / total_safe) * 100.0, 1)
        j["phase"] = str(phase or "processing")
        j["progress"] = {"done": done_safe, "total": total_safe, "percent": pct}

    try:
        path, download_name, saved_copy_path = _make_pdf(
            job_id, req.ids, req.options, progress_cb=_on_progress
        )
        export_jobs[job_id] = {
            "status": "done",
            "path": path,
            "filename": download_name,
            "saved_copy_path": saved_copy_path,
            "msg": "ok",
            "phase": "done",
            "progress": {"done": 1, "total": 1, "percent": 100.0},
        }
    except Exception as e:
        traceback.print_exc()
        current = export_jobs.get(job_id) or {}
        export_jobs[job_id] = {
            "status": "error",
            "msg": str(e),
            "phase": "error",
            "progress": current.get("progress") or {"done": 0, "total": 1, "percent": 0.0},
        }
