"""
CIE Paper Import from https://cie.fraft.cn/
"""
import re
import shutil
import json
from pathlib import Path
from datetime import datetime
from typing import Optional, List
import tempfile
import urllib.request
import urllib.parse
import urllib.error

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.database import Paper
from backend.dependencies import get_db
from backend.config import PDF_DIR, PAGE_DIR, MAX_UPLOAD_BYTES
from backend.services.paper_utils import (
    render_pdf_to_images,
    stem_no_ext,
    is_answer_filename,
    detect_is_answer_by_pdf_text,
    normalize_exam_code_for_type,
    try_pair_papers,
)

router = APIRouter(prefix="/cie_import", tags=["cie_import"])


class ImportRequest(BaseModel):
    url: str
    ocr_auto: bool = False
    ocr_min_height_px: int = 70
    ocr_y_padding_px: int = 12


class BatchImportRequest(BaseModel):
    urls: List[str]
    ocr_auto: bool = False
    ocr_min_height_px: int = 70
    ocr_y_padding_px: int = 12


class FetchPapersRequest(BaseModel):
    subject: str
    year: str
    season: str  # Mar, Jun, Nov


@router.get("/subject_combo")
def get_subject_combo():
    """
    Get subject combo list from cie.fraft.cn (proxy to avoid CORS)
    """
    try:
        # Make request to CIE website
        req = urllib.request.Request(
            'https://cie.fraft.cn/obj/Common/Subject/combo',
            method='POST',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            }
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))
            
        # Filter out advertisement text
        if isinstance(result, list):
            for item in result:
                if 'text' in item and isinstance(item['text'], str):
                    # Remove emoji and advertisement like "🔥3天视频速通🔥"
                    item['text'] = item['text'].split(' - 🔥')[0].strip()
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch subject combo: {str(e)}")


@router.post("/fetch_papers")
def fetch_papers(request: FetchPapersRequest):
    """
    Fetch paper list from cie.fraft.cn
    """
    try:
        # Prepare POST data
        data = urllib.parse.urlencode({
            'subject': request.subject,
            'year': request.year,
            'season': request.season
        }).encode('utf-8')
        
        # Make request to CIE website
        req = urllib.request.Request(
            'https://cie.fraft.cn/obj/Common/Fetch/renum',
            data=data,
            headers={
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            }
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode('utf-8'))
            
        # Extract file list
        papers = []
        if 'rows' in result:
            for row in result['rows']:
                filename = row.get('file', '')
                if filename.endswith('.pdf'):
                    papers.append({
                        'filename': filename,
                        'url': f'https://cie.fraft.cn/obj/Common/Fetch/redir/{filename}'
                    })
        
        return {
            'success': True,
            'total': len(papers),
            'papers': papers
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch papers: {str(e)}")


def extract_filename_from_url(url: str) -> str:
    """Extract filename from CIE URL"""
    # Example: https://cie.fraft.cn/pdf/9709_s25_qp_12.pdf
    match = re.search(r'/([^/]+\.pdf)$', url, re.IGNORECASE)
    if match:
        return match.group(1)
    # Fallback: use timestamp
    return f"imported_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"


@router.post("/from_url")
async def import_from_url(request: ImportRequest, db: Session = Depends(get_db)):
    """Import paper from CIE website URL"""
    url = request.url.strip()
    
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")
    
    # Validate URL (basic check)
    if not url.startswith(('http://', 'https://')):
        raise HTTPException(status_code=400, detail="Invalid URL format")
    
    # Extract filename
    filename = extract_filename_from_url(url)
    
    if not filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="URL must point to a PDF file")
    
    # 检查是否已导入过相同文件
    existing = db.query(Paper).filter(Paper.filename == filename).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"文件 '{filename}' 已导入过 (Paper ID: {existing.id})，请勿重复导入"
        )
    
    try:
        # Download PDF to temporary location
        # Create request with timeout
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        # Download with size limit check
        with urllib.request.urlopen(req, timeout=60) as response:
            # Check content type
            content_type = response.headers.get('Content-Type', '')
            if 'pdf' not in content_type.lower() and not url.lower().endswith('.pdf'):
                raise HTTPException(status_code=400, detail="URL does not point to a PDF file")
            
            # Check file size from headers
            content_length = response.headers.get('Content-Length')
            if content_length and int(content_length) > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024}MB)"
                )
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
                total_size = 0
                chunk_size = 8192
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    total_size += len(chunk)
                    if total_size > MAX_UPLOAD_BYTES:
                        tmp_file.close()
                        Path(tmp_file.name).unlink(missing_ok=True)
                        raise HTTPException(
                            status_code=400,
                            detail=f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024}MB)"
                        )
                    tmp_file.write(chunk)
                tmp_path = Path(tmp_file.name)
        
        # Create paper record
        exam_code = stem_no_ext(filename)
        paper = Paper(
            filename=filename,
            exam_code=exam_code,
            is_answer=is_answer_filename(filename)
        )
        db.add(paper)
        db.commit()
        db.refresh(paper)
        
        # Move to final location (use shutil.move for cross-drive compatibility)
        pdf_path = PDF_DIR / f"paper_{paper.id}.pdf"
        shutil.move(str(tmp_path), str(pdf_path))
        
        # Render pages
        pdf_name = f"paper_{paper.id}"
        page_output_dir = PAGE_DIR / pdf_name
        rendered_pages = render_pdf_to_images(pdf_path, page_output_dir)
        
        # Update paper metadata
        paper.pdf_path = str(pdf_path)
        paper.pages_dir = str(page_output_dir)
        paper.page_count = int(rendered_pages)
        
        # Detect if it's answer paper
        detected = detect_is_answer_by_pdf_text(pdf_path)
        if detected is not None and bool(paper.is_answer) != bool(detected):
            paper.is_answer = bool(detected)
            paper.exam_code = normalize_exam_code_for_type(paper.exam_code, bool(detected))
        
        db.add(paper)
        db.commit()
        
        # Try to pair with existing papers
        try_pair_papers(db, paper)
        
        # OCR processing (if requested and not answer paper)
        ocr_questions = []
        ocr_boxes = []
        ocr_warn = None
        
        if request.ocr_auto and not bool(paper.is_answer):
            from backend.auto_suggest import suggest_question_boxes_from_pdf
            from backend.services.paper_utils import auto_suggest_allowed_by_filename
            
            allowed, reason = auto_suggest_allowed_by_filename(filename)
            if not allowed:
                ocr_warn = reason
            else:
                ocr_questions, ocr_warn = suggest_question_boxes_from_pdf(
                    pdf_path,
                    int(paper.page_count or 0),
                    min_height_px=int(request.ocr_min_height_px or 0),
                    y_padding_px=int(request.ocr_y_padding_px or 0),
                )
            
            # Flatten for compatibility
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
            "paper": {
                "id": paper.id,
                "filename": paper.filename,
                "exam_code": paper.exam_code,
                "is_answer": paper.is_answer,
                "page_count": paper.page_count,
                "paired_paper_id": paper.paired_paper_id,
            },
            "ocr_questions": ocr_questions,
            "ocr_boxes": ocr_boxes,
            "ocr_warn": ocr_warn,
        }
        
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to download PDF: {str(e)}"
        )
    except Exception as e:
        # Clean up on error
        if 'paper' in locals() and paper.id:
            pdf_path = PDF_DIR / f"paper_{paper.id}.pdf"
            page_dir = PAGE_DIR / f"paper_{paper.id}"
            pdf_path.unlink(missing_ok=True)
            if page_dir.exists():
                shutil.rmtree(page_dir, ignore_errors=True)
            try:
                db.delete(paper)
                db.commit()
            except:
                pass
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@router.post("/batch_from_urls")
async def batch_import_from_urls(request: BatchImportRequest, db: Session = Depends(get_db)):
    """Batch import papers from multiple URLs"""
    if not request.urls:
        raise HTTPException(status_code=400, detail="URLs list cannot be empty")
    
    results = []
    errors = []
    
    for idx, url in enumerate(request.urls):
        try:
            # Create individual request
            single_request = ImportRequest(
                url=url,
                ocr_auto=request.ocr_auto,
                ocr_min_height_px=request.ocr_min_height_px,
                ocr_y_padding_px=request.ocr_y_padding_px
            )
            
            # Import single paper
            result = await import_from_url(single_request, db)
            results.append({
                "url": url,
                "success": True,
                "paper": result["paper"],
                "ocr_questions": result.get("ocr_questions", []),
                "ocr_boxes": result.get("ocr_boxes", []),
                "ocr_warn": result.get("ocr_warn")
            })
        except Exception as e:
            errors.append({
                "url": url,
                "success": False,
                "error": str(e)
            })
    
    return {
        "total": len(request.urls),
        "successful": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors
    }
