import { useAppContext } from "./useAppContext.js";
import { api } from "../../modules/api.js";
import * as Settings from "../../modules/settings.js";
import { clamp01, normalizeBox, pointInBox, clampInt } from "../../modules/utils.js";
import {
  formatPaperName,
  extractCacheBustToken,
  getAnswerProgress,
  setAnswerProgress,
  findMatchedMsPaper,
  sortQuestionsByNoAsc,
} from "../helpers.js";
import {
  alignAnswerBoxesPayloadToBoundsX,
  alignAnswerBBoxToBoundsX,
  applyAnswerAlignToAllNewBoxes,
} from "../align.js";

const ANSWER_HISTORY_LIMIT = 50;
const cloneAnswerBoxes = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((b) => ({
    ...b,
    bbox: Array.isArray(b?.bbox) ? Array.from(b.bbox) : [],
  }));
};
const answerBoxesEqual = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    if (x.page !== y.page) return false;
    const xb = Array.isArray(x.bbox) ? x.bbox : [];
    const yb = Array.isArray(y.bbox) ? y.bbox : [];
    if (xb.length !== yb.length) return false;
    for (let j = 0; j < xb.length; j++) {
      if (xb[j] !== yb[j]) return false;
    }
  }
  return true;
};

export const useAnswer = () => {
  return useAppContext();
};

export const answerMethods = {
  // -------- undo / redo --------
  resetAnswerHistory() {
    this.answerUndoStack = [];
    this.answerRedoStack = [];
    this.answerPendingSnapshot = null;
  },
  captureAnswerSnapshot() {
    const selectedIndex = this.selectedAnswerNew ? (this.answerNewBoxes || []).indexOf(this.selectedAnswerNew) : -1;
    return {
      boxes: cloneAnswerBoxes(this.answerNewBoxes),
      selectedIndex,
    };
  },
  restoreAnswerSnapshot(snapshot) {
    if (!snapshot) return;
    this.answerNewBoxes = cloneAnswerBoxes(snapshot.boxes);
    const idx = typeof snapshot.selectedIndex === "number" ? snapshot.selectedIndex : -1;
    this.selectedAnswerNew = idx >= 0 && this.answerNewBoxes[idx] ? this.answerNewBoxes[idx] : null;
    this.answerDrawing = null;
    this.dragAnswerOp = null;
    this.redrawAllAnswerOverlays();
  },
  pushAnswerUndoSnapshot(snapshot) {
    if (!snapshot) return;
    this.answerUndoStack.push(snapshot);
    if (this.answerUndoStack.length > ANSWER_HISTORY_LIMIT) this.answerUndoStack.shift();
    this.answerRedoStack = [];
  },
  commitAnswerHistory(snapshot) {
    if (!snapshot) return;
    if (answerBoxesEqual(snapshot.boxes, this.answerNewBoxes)) return;
    this.pushAnswerUndoSnapshot(snapshot);
  },
  undoAnswer() {
    if (!this.answerUndoStack.length) return;
    const current = this.captureAnswerSnapshot();
    const prev = this.answerUndoStack.pop();
    this.answerRedoStack.push(current);
    this.restoreAnswerSnapshot(prev);
  },
  redoAnswer() {
    if (!this.answerRedoStack.length) return;
    const current = this.captureAnswerSnapshot();
    const next = this.answerRedoStack.pop();
    this.answerUndoStack.push(current);
    this.restoreAnswerSnapshot(next);
  },

  async openAnswerMode(forcedMsId = null, forcedQuestionId = null) {
    if (!this.currentPaperId) return;
    this.resetAnswerHistory();
    const qp = await api(`/papers/${this.currentPaperId}`);
    const msMatch = forcedMsId ? { id: forcedMsId } : findMatchedMsPaper(qp, this.papers);
    const msPaperId = msMatch?.id || null;
    if (!msPaperId) {
      this.setStatus("未找到答案卷，请先上传答案卷（MS）。", "err");
      return;
    }
    this.msPaperId = msPaperId;
    this.answerAlignRef = Settings.loadAnswerAlignRef(this.currentPaperId, msPaperId) || null;
    const msDetail = await api(`/papers/${msPaperId}`);
    this.currentMsPaperName = formatPaperName(msDetail);
    this.currentMsCacheToken = extractCacheBustToken(msDetail?.pdf_url);
    const msPagesData = await api(`/papers/${msPaperId}/pages`);
    this.msPages = msPagesData.pages || [];
    const qData = await api(`/papers/${this.currentPaperId}/questions`);
    const qs = qData.questions || [];
    if (!qs.length) {
      this.setStatus("该试卷还没有题目。", "err");
      return;
    }
    this.answerQuestions = sortQuestionsByNoAsc(qs);
    this.answerQIndex = 0;
    if (forcedQuestionId) {
      const idx = this.answerQuestions.findIndex((q) => q.id === forcedQuestionId);
      if (idx >= 0) this.answerQIndex = idx;
    } else {
      const last = getAnswerProgress("q", this.currentPaperId, this.currentPaperCacheToken, msPaperId, this.currentMsCacheToken);
      if (last != null && last >= 0 && last < this.answerQuestions.length) this.answerQIndex = last;
    }
    await this.ensureAnswerAlignRefFromFirstQuestion();
    this.showAnswerView();
    await this.$nextTick();
    this.syncMsCanvasSizes();
    await this.loadAnswerQuestion(this.answerQIndex);
    this.setStatus(`答案模式：共 ${this.answerQuestions.length} 题`, "ok");
  },
  setCanvasSizeFor(img, canvas) {
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    canvas.style.width = `${img.clientWidth}px`;
    canvas.style.height = `${img.clientHeight}px`;
    canvas.style.pointerEvents = "auto";
    canvas.style.zIndex = "2";
  },
  onMsImageLoad(page, evt) {
    const img = evt.target;
    const canvas = this.msCanvasByPage.get(page);
    if (img && canvas) {
      this.setCanvasSizeFor(img, canvas);
      this.drawAnswerOverlayForPage(page);
    }
  },
  syncMsCanvasSizes() {
    for (const p of this.msPages || []) {
      const canvas = this.msCanvasByPage.get(p.page);
      if (!canvas) continue;
      const img = canvas.parentElement?.querySelector?.("img");
      if (img && img.complete && img.naturalWidth) {
        this.setCanvasSizeFor(img, canvas);
        this.drawAnswerOverlayForPage(p.page);
      }
    }
  },
  setMsCanvasRef(page, el) {
    if (!el) return;
    this.msCanvasByPage.set(page, el);
    el.style.pointerEvents = "auto";
    el.style.zIndex = "2";
    const img = el.parentElement?.querySelector?.("img");
    if (img && img.complete && img.naturalWidth) {
      this.setCanvasSizeFor(img, el);
      this.drawAnswerOverlayForPage(page);
    }
  },
  getAnswerScrollContainer() {
    const right = this.$refs.rightScroll;
    if (right && right.scrollHeight > right.clientHeight + 1) return right;
    const ms = this.$refs.msScroll;
    if (ms && ms.scrollHeight > ms.clientHeight + 1) return ms;
    return document.scrollingElement || document.documentElement;
  },
  scrollAnswerContainerTo(top, behavior = "auto") {
    const container = this.getAnswerScrollContainer();
    if (!container) return;
    const isDoc =
      container === document.body ||
      container === document.documentElement ||
      container === document.scrollingElement;
    if (isDoc) {
      window.scrollTo({ top, behavior });
      return;
    }
    if (container.scrollTo) {
      container.scrollTo({ top, behavior });
    } else {
      container.scrollTop = top;
    }
  },
  getVisibleMsPageNum() {
    const container = this.getAnswerScrollContainer();
    const pagesEls = Array.from(container?.querySelectorAll?.("#msScroll .msPage") || []);
    if (!pagesEls.length || !container) return null;
    const cr = container.getBoundingClientRect();
    const targetY = cr.top + 140;
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const el of pagesEls) {
      const r = el.getBoundingClientRect();
      if (r.bottom < cr.top + 40 || r.top > cr.bottom) continue;
      const d = Math.abs(r.top - targetY);
      if (d < bestDist) {
        bestDist = d;
        best = el;
      }
    }
    const pageStr = best?.dataset?.page;
    const n = pageStr != null ? parseInt(String(pageStr), 10) : NaN;
    return Number.isFinite(n) ? n : null;
  },
  scrollToMsPage(pageNum) {
    const n = parseInt(String(pageNum ?? "").trim(), 10);
    if (!Number.isFinite(n)) return;
    const container = this.getAnswerScrollContainer();
    if (!container) return;
    const el = container.querySelector?.(`#msScroll .msPage[data-page="${n}"]`);
    if (!el) return;
    try {
      const cr = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const top = container.scrollTop + (r.top - cr.top) - 120;
      this.scrollAnswerContainerTo(Math.max(0, top), "auto");
    } catch {
      el.scrollIntoView({ behavior: "auto", block: "start" });
    }
  },
  recordAnswerScrollProgress(q) {
    if (!q || this.currentPaperId == null || this.msPaperId == null) return;
    let curMsPage = this.getVisibleMsPageNum();
    if (curMsPage == null) {
      const all = (this.answerNewBoxes && this.answerNewBoxes.length) ? this.answerNewBoxes : this.answerExistingBoxes;
      if (all && all.length) {
        curMsPage = all.reduce((m, b) => (b?.page != null && b.page > m ? b.page : m), 0) || null;
      }
    }
    if (curMsPage != null) {
      setAnswerProgress(`msPage:${q.id}`, this.currentPaperId, this.currentPaperCacheToken, this.msPaperId, this.currentMsCacheToken, curMsPage);
      setAnswerProgress("lastMsPage", this.currentPaperId, this.currentPaperCacheToken, this.msPaperId, this.currentMsCacheToken, curMsPage);
    }
  },
  async ensureAnswerAlignRefFromFirstQuestion() {
    if (!this.answerAlignEnabled || this.answerAlignRef != null) return;
    const first = this.answerQuestions?.[0];
    if (!first || this.currentPaperId == null || this.msPaperId == null) return;
    try {
      const d = await api(`/questions/${first.id}/answer`);
      const boxes = d?.answer?.boxes || [];
      if (boxes.length) {
        const bb = boxes[0]?.bbox;
        if (Array.isArray(bb) && bb.length === 4) {
          const bounds = [bb[0], bb[2]];
          this.answerAlignRef = [clamp01(Math.min(bounds[0], bounds[1])), clamp01(Math.max(bounds[0], bounds[1]))];
          Settings.saveAnswerAlignRef(this.currentPaperId, this.msPaperId, this.answerAlignRef);
        }
      }
    } catch {}
  },
  async loadAnswerQuestion(index, opts = {}) {
    if (index < 0 || index >= this.answerQuestions.length) return;
    const preserveScroll = !!opts.preserveScroll;
    const scrollContainer = preserveScroll ? this.getAnswerScrollContainer() : null;
    const scrollTop = preserveScroll && scrollContainer ? scrollContainer.scrollTop : null;
    const prev = this.answerQuestions[this.answerQIndex];
    this.answerQIndex = index;
    const q = this.answerQuestions[this.answerQIndex];
    if (prev && prev.id !== q.id) {
      this.recordAnswerScrollProgress(prev);
    }
    this.answerNewBoxes = [];
    this.answerExistingBoxes = [];
    this.resetAnswerHistory();
    try {
      const d = await api(`/questions/${q.id}/answer`);
      if (d && d.answer && d.answer.boxes) {
        this.answerExistingBoxes = d.answer.boxes.map((b) => ({ page: b.page, bbox: b.bbox }));
        if (this.answerAlignEnabled && Array.isArray(this.answerAlignRef) && this.answerAlignRef.length === 2) {
          this.answerExistingBoxes = alignAnswerBoxesPayloadToBoundsX(this.answerExistingBoxes, this.answerAlignRef);
        }
      }
    } catch {}
    const anchor = this.answerExistingBoxes[0] || null;
    if (this.answerAlignEnabled && this.answerAlignRef == null && anchor && this.currentPaperId != null && this.msPaperId != null) {
      const loaded = Settings.loadAnswerAlignRef(this.currentPaperId, this.msPaperId);
      if (Array.isArray(loaded) && loaded.length === 2) {
        this.answerAlignRef = loaded;
      } else if (this.answerQIndex === 0) {
        const bx = anchor?.bbox;
        const x0 = bx?.[0];
        const x1 = bx?.[2];
        if (typeof x0 === "number" && Number.isFinite(x0) && typeof x1 === "number" && Number.isFinite(x1)) {
          const ref = [x0, x1];
          this.answerAlignRef = ref;
          Settings.saveAnswerAlignRef(this.currentPaperId, this.msPaperId, ref);
        }
      }
    }
    if (this.answerReplaceMode && this.answerReplaceQuestionId === q.id) {
      this.answerNewBoxes = (this.answerExistingBoxes || []).map((b) => ({ page: b.page, bbox: Array.from(b.bbox || []) }));
      this.answerExistingBoxes = [];
      if (this.answerAlignEnabled && this.answerNewBoxes.length >= 2) {
        const bounds = this.getAnswerAlignBounds();
        if (bounds) this.answerNewBoxes = alignAnswerBoxesPayloadToBoundsX(this.answerNewBoxes, bounds);
      }
      this.selectedAnswerNew = this.answerNewBoxes[0] || null;
      this.setStatus(`修改答案：题目 #${q.id}`, "ok");
    }
    this.redrawAllAnswerOverlays();
    this.setAnswerProgressIndex();
    await this.$nextTick();
    if (preserveScroll) {
      if (scrollContainer && scrollTop != null) {
        this.scrollAnswerContainerTo(scrollTop, "auto");
      }
      return;
    }
    if (this.answerReplaceMode && this.answerReplaceQuestionId === q.id) {
      // entering from "题库 -> 修改答案": always jump to this question's answer box page
      const list = (this.answerNewBoxes && this.answerNewBoxes.length)
        ? this.answerNewBoxes
        : (this.answerExistingBoxes || []);
      const targetPage = list?.[0]?.page;
      if (targetPage != null) {
        this.scrollToMsPage(targetPage);
        return;
      }
    }
    const saved = getAnswerProgress(`msPage:${q.id}`, this.currentPaperId, this.currentPaperCacheToken, this.msPaperId, this.currentMsCacheToken);
    if (saved != null) {
      this.scrollToMsPage(saved);
      return;
    }
    const all = (this.answerNewBoxes && this.answerNewBoxes.length) ? this.answerNewBoxes : this.answerExistingBoxes;
    if (all && all.length) {
      const page = all.reduce((m, b) => (b?.page != null && b.page > m ? b.page : m), 0);
      if (page) this.scrollToMsPage(page);
      return;
    }
    const lastMs = getAnswerProgress("lastMsPage", this.currentPaperId, this.currentPaperCacheToken, this.msPaperId, this.currentMsCacheToken);
    if (lastMs != null) this.scrollToMsPage(lastMs);
  },
  redrawAllAnswerOverlays() {
    for (const p of this.msPages || []) this.drawAnswerOverlayForPage(p.page);
  },
  drawAnswerOverlayForPage(pageNum, tempBox = null) {
    const canvas = this.msCanvasByPage.get(pageNum);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;

    if (this.answerReplaceMode) {
      // hide existing boxes when replacing
    } else {
      for (const b of this.answerExistingBoxes || []) {
        if (b.page !== pageNum) continue;
        const [x0, y0, x1, y1] = b.bbox;
        ctx.strokeStyle = "#16a34a";
        ctx.strokeRect(x0 * canvas.width, y0 * canvas.height, (x1 - x0) * canvas.width, (y1 - y0) * canvas.height);
      }
    }

    for (const nb of this.answerNewBoxes || []) {
      if (nb.page !== pageNum) continue;
      const [x0, y0, x1, y1] = nb.bbox;
      ctx.strokeStyle = "#ef4444";
      ctx.strokeRect(x0 * canvas.width, y0 * canvas.height, (x1 - x0) * canvas.width, (y1 - y0) * canvas.height);
      if (this.selectedAnswerNew === nb) {
        ctx.fillStyle = "#2563eb";
        const hs = 6;
        const pts = [
          [x0, y0],
          [x1, y0],
          [x0, y1],
          [x1, y1],
          [(x0 + x1) / 2, y0],
          [(x0 + x1) / 2, y1],
          [x0, (y0 + y1) / 2],
          [x1, (y0 + y1) / 2],
        ];
        for (const [px, py] of pts) {
          ctx.fillRect(px * canvas.width - hs, py * canvas.height - hs, hs * 2, hs * 2);
        }
      }
    }

    if (tempBox) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#ef4444";
      const [x0, y0, x1, y1] = tempBox;
      ctx.strokeRect(x0 * canvas.width, y0 * canvas.height, (x1 - x0) * canvas.width, (y1 - y0) * canvas.height);
      ctx.setLineDash([]);
    }
  },
  msCanvasPointToNorm(evt, canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / rect.width;
    const y = (evt.clientY - rect.top) / rect.height;
    return [clamp01(x), clamp01(y)];
  },
  onAnswerPointerDown(pageNum, evt) {
    const canvas = this.msCanvasByPage.get(pageNum);
    if (!canvas) return;
    evt.preventDefault?.();
    const [x, y] = this.msCanvasPointToNorm(evt, canvas);
    const hit = this.hitTestAnswerNewBoxes(pageNum, x, y);
    if (hit) {
      if (!this.answerPendingSnapshot) this.answerPendingSnapshot = this.captureAnswerSnapshot();
      this.selectedAnswerNew = hit.box;
      this.dragAnswerOp = hit;
      this.drawAnswerOverlayForPage(pageNum);
      return;
    }
    this.selectedAnswerNew = null;
    this.dragAnswerOp = null;
    if (!this.answerPendingSnapshot) this.answerPendingSnapshot = this.captureAnswerSnapshot();
    this.answerDrawing = { page: pageNum, startX: x, startY: y };
  },
  onAnswerPointerMove(pageNum, evt) {
    const canvas = this.msCanvasByPage.get(pageNum);
    if (!canvas) return;
    evt.preventDefault?.();
    const [x, y] = this.msCanvasPointToNorm(evt, canvas);
    if (this.dragAnswerOp && this.dragAnswerOp.box) {
      const b = this.dragAnswerOp.box;
      const [x0, y0, x1, y1] = b.bbox;
      if (this.dragAnswerOp.kind === "move") {
        const nx0 = clamp01(x - this.dragAnswerOp.offX);
        const ny0 = clamp01(y - this.dragAnswerOp.offY);
        const w = this.dragAnswerOp.w;
        const h = this.dragAnswerOp.h;
        const fx0 = clamp01(Math.min(nx0, 1 - w));
        const fy0 = clamp01(Math.min(ny0, 1 - h));
        b.bbox = normalizeBox([fx0, fy0, fx0 + w, fy0 + h]);
      } else if (this.dragAnswerOp.kind === "resize") {
        let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
        if (this.dragAnswerOp.corner === "tl") { nx0 = x; ny0 = y; }
        else if (this.dragAnswerOp.corner === "tr") { nx1 = x; ny0 = y; }
        else if (this.dragAnswerOp.corner === "bl") { nx0 = x; ny1 = y; }
        else if (this.dragAnswerOp.corner === "br") { nx1 = x; ny1 = y; }
        else if (this.dragAnswerOp.corner === "tm") { ny0 = y; }
        else if (this.dragAnswerOp.corner === "bm") { ny1 = y; }
        else if (this.dragAnswerOp.corner === "ml") { nx0 = x; }
        else if (this.dragAnswerOp.corner === "mr") { nx1 = x; }
        b.bbox = normalizeBox([nx0, ny0, nx1, ny1]);
      }
      if (this.answerAlignEnabled) {
        const bounds = this.getAnswerAlignBounds();
        const idx = typeof this.dragAnswerOp.idx === "number" ? this.dragAnswerOp.idx : -1;
        if (idx > 0) {
          if (bounds) b.bbox = alignAnswerBBoxToBoundsX(b.bbox, bounds);
        } else if (idx === 0) {
          if (bounds) {
            for (const box of this.answerNewBoxes || []) {
              box.bbox = alignAnswerBBoxToBoundsX(box.bbox, bounds);
            }
          }
        }
      }
      if (this.answerAlignEnabled && this.dragAnswerOp.idx === 0) {
        this.redrawAllAnswerOverlays();
      } else {
        this.drawAnswerOverlayForPage(pageNum);
      }
      return;
    }
    if (this.answerDrawing && this.answerDrawing.page === pageNum) {
      let temp = normalizeBox([this.answerDrawing.startX, this.answerDrawing.startY, x, y]);
      if (this.answerAlignEnabled) {
        const bounds = this.getAnswerAlignBounds();
        if (bounds) temp = alignAnswerBBoxToBoundsX(temp, bounds);
      }
      this.drawAnswerOverlayForPage(pageNum, temp);
    }
  },
  onAnswerPointerUp(pageNum, evt) {
    const canvas = this.msCanvasByPage.get(pageNum);
    if (!canvas) return;
    evt.preventDefault?.();
    const pendingSnapshot = this.answerPendingSnapshot;
    if (this.answerDrawing && this.answerDrawing.page === pageNum) {
      const [x, y] = this.msCanvasPointToNorm(evt, canvas);
      let finalBox = normalizeBox([this.answerDrawing.startX, this.answerDrawing.startY, x, y]);
      const minW = 0.005;
      // Allow thinner single-line answer boxes.
      const minH = 0.0015;
      if (Math.abs(finalBox[2] - finalBox[0]) > minW && Math.abs(finalBox[3] - finalBox[1]) > minH) {
        if (this.answerAlignEnabled) {
          const bounds = this.getAnswerAlignBounds();
          if (bounds) finalBox = alignAnswerBBoxToBoundsX(finalBox, bounds);
        }
        this.answerNewBoxes.push({ page: pageNum, bbox: finalBox });
      }
      this.selectedAnswerNew = this.answerNewBoxes[this.answerNewBoxes.length - 1];
      if (this.answerAlignEnabled) {
        const bounds = this.getAnswerAlignBounds();
        this.answerNewBoxes = applyAnswerAlignToAllNewBoxes(this.answerNewBoxes, bounds);
      }
      this.drawAnswerOverlayForPage(pageNum);
    }
    this.answerDrawing = null;
    this.dragAnswerOp = null;
    this.answerPendingSnapshot = null;
    this.commitAnswerHistory(pendingSnapshot);
  },
  hitTestAnswerNewBoxes(pageNum, normX, normY) {
    const bxs = this.answerNewBoxes || [];
    for (let i = bxs.length - 1; i >= 0; i--) {
      const b = bxs[i];
      if (!b || b.page !== pageNum) continue;
      if (!Array.isArray(b.bbox) || b.bbox.length !== 4) continue;
      const [x0, y0, x1, y1] = b.bbox;
      const pad = 0.01;
      const corners = [
        { kind: "resize", corner: "tl", x: x0, y: y0 },
        { kind: "resize", corner: "tr", x: x1, y: y0 },
        { kind: "resize", corner: "bl", x: x0, y: y1 },
        { kind: "resize", corner: "br", x: x1, y: y1 },
      ];
      const mids = [
        { kind: "resize", corner: "tm", x: (x0 + x1) / 2, y: y0 },
        { kind: "resize", corner: "bm", x: (x0 + x1) / 2, y: y1 },
        { kind: "resize", corner: "ml", x: x0, y: (y0 + y1) / 2 },
        { kind: "resize", corner: "mr", x: x1, y: (y0 + y1) / 2 },
      ];
      for (const c of corners) {
        if (Math.abs(normX - c.x) <= pad && Math.abs(normY - c.y) <= pad) {
          return { kind: "resize", box: b, corner: c.corner, idx: i };
        }
      }
      for (const c of mids) {
        if (Math.abs(normX - c.x) <= pad && Math.abs(normY - c.y) <= pad) {
          return { kind: "resize", box: b, corner: c.corner, idx: i };
        }
      }
      if (pointInBox(normX, normY, b.bbox)) {
        return { kind: "move", box: b, offX: normX - x0, offY: normY - y0, w: x1 - x0, h: y1 - y0, idx: i };
      }
    }
    return null;
  },
  getAnswerAlignBounds() {
    if (this.answerAlignEnabled && Array.isArray(this.answerAlignRef) && this.answerAlignRef.length === 2) {
      const a = this.answerAlignRef?.[0];
      const b = this.answerAlignRef?.[1];
      if (typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b)) {
        return [clamp01(Math.min(a, b)), clamp01(Math.max(a, b))];
      }
    }
    const first = (this.answerNewBoxes && this.answerNewBoxes.length ? this.answerNewBoxes[0] : (this.answerExistingBoxes && this.answerExistingBoxes.length ? this.answerExistingBoxes[0] : null)) || null;
    const bbox = first?.bbox;
    const x0 = bbox?.[0];
    const x1 = bbox?.[2];
    if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) return null;
    const a = clamp01(Math.min(x0, x1));
    const b = clamp01(Math.max(x0, x1));
    return [a, b];
  },
  async saveCurrentAnswerAndNext(opts = {}) {
    const preserveScroll = !!opts.preserveScroll;
    const q = this.answerQuestions[this.answerQIndex];
    if (!q || this.msPaperId == null) return;
    this.recordAnswerScrollProgress(q);
    const isReplace = this.answerReplaceMode && this.answerReplaceQuestionId === q.id;
    const merged = [];
    if (!isReplace) {
      for (const b of this.answerExistingBoxes || []) merged.push({ page: b.page, bbox: b.bbox });
    }
    for (const b of this.answerNewBoxes || []) merged.push({ page: b.page, bbox: b.bbox });

    if (this.answerAlignEnabled && this.currentPaperId != null && this.msPaperId != null && merged.length) {
      const loaded = Settings.loadAnswerAlignRef(this.currentPaperId, this.msPaperId);
      if (Array.isArray(loaded) && loaded.length === 2) {
        if (this.answerAlignRef == null) this.answerAlignRef = loaded;
      } else if (this.answerAlignRef == null && this.answerQIndex === 0) {
        const bb = merged[0]?.bbox;
        const x0 = bb?.[0];
        const x1 = bb?.[2];
        if (typeof x0 === "number" && Number.isFinite(x0) && typeof x1 === "number" && Number.isFinite(x1)) {
          const ref = [x0, x1];
          this.answerAlignRef = ref;
          Settings.saveAnswerAlignRef(this.currentPaperId, this.msPaperId, ref);
        }
      }
    }

    const bounds = this.getAnswerAlignBounds();
    const aligned = this.answerAlignEnabled ? alignAnswerBoxesPayloadToBoundsX(merged, bounds) : merged;
    try {
      this.setStatus(`保存答案中：题目 #${q.id}…`);
      await api(`/questions/${q.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ms_paper_id: this.msPaperId, boxes: aligned }),
      });
      this.setStatus("已保存", "ok");
      this.answerExistingBoxes = aligned.map((b) => ({ page: b.page, bbox: b.bbox }));
      this.answerNewBoxes = [];
      this.resetAnswerHistory();
      this.redrawAllAnswerOverlays();
      this.setAnswerProgressIndex();
      if (isReplace) {
        this.answerReplaceMode = false;
        this.answerReplaceQuestionId = null;
        await this.returnToFilterFromNavStack();
        return;
      }
      if (this.answerQIndex < this.answerQuestions.length - 1) {
        await this.loadAnswerQuestion(this.answerQIndex + 1, { preserveScroll });
      }
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  setAnswerProgressIndex() {
    if (this.currentPaperId && this.msPaperId) {
      setAnswerProgress("q", this.currentPaperId, this.currentPaperCacheToken, this.msPaperId, this.currentMsCacheToken, this.answerQIndex);
    }
  },
  clearAnswerBoxes() {
    if (this.selectedAnswerNew) {
      const snapshot = this.captureAnswerSnapshot();
      const target = this.selectedAnswerNew;
      this.answerNewBoxes = this.answerNewBoxes.filter((b) => b !== target);
      this.selectedAnswerNew = null;
      this.dragAnswerOp = null;
      this.answerDrawing = null;
      if (this.answerReplaceMode && this.answerNewBoxes.length === 0) {
        this.answerReplaceMode = false;
        this.answerReplaceQuestionId = null;
        this.setStatus("已取消修改（已删除所有框）", "info");
      }
      this.redrawAllAnswerOverlays();
      this.commitAnswerHistory(snapshot);
      return;
    }
    if (!this.answerNewBoxes.length) return;
    if (!confirm("确认清空本次新增的答案框？")) return;
    const snapshot = this.captureAnswerSnapshot();
    this.answerNewBoxes = [];
    this.selectedAnswerNew = null;
    this.dragAnswerOp = null;
    this.answerDrawing = null;
    if (this.answerReplaceMode) {
      this.answerReplaceMode = false;
      this.answerReplaceQuestionId = null;
    }
    this.redrawAllAnswerOverlays();
    this.commitAnswerHistory(snapshot);
  },
  async jumpToMsPage() {
    const raw = clampInt(this.answerJumpMsPageInput, 1, 1000000);
    let pageNo = raw;
    const container = this.getAnswerScrollContainer();
    if (!container) return;
    let pageDiv = container.querySelector?.(`.msPage[data-page="${pageNo}"]`);
    if (!pageDiv && raw >= 1 && raw <= this.msPages.length) {
      pageNo = this.msPages[raw - 1].page;
      pageDiv = container.querySelector?.(`.msPage[data-page="${pageNo}"]`);
    }
    if (!pageDiv) return;
    this.scrollToMsPage(pageNo);
  },
  async answerPrev() {
    if (this.answerQIndex <= 0) return;
    try {
      await this.loadAnswerQuestion(this.answerQIndex - 1);
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  isLastAnswer() {
    return this.answerQIndex >= 0 && this.answerQIndex >= this.answerQuestions.length - 1;
  },
  answerNeedsSave() {
    const q = this.answerQuestions[this.answerQIndex];
    if (!q || this.msPaperId == null) return false;
    if (this.answerReplaceMode && this.answerReplaceQuestionId === q.id) return true;
    return (this.answerNewBoxes || []).length > 0;
  },
  answerNextButtonLabel() {
    if (this.answerReplaceMode) return "保存";
    if (this.isLastAnswer()) return "保存";
    return "下一题(自动保存)";
  },
  canAnswerNextAction() {
    if (this.answerReplaceMode) return this.answerNeedsSave();
    if (this.isLastAnswer()) return this.answerNeedsSave();
    return this.canNextAnswer;
  },
  async answerNext() {
    try {
      const hasQ = this.answerQIndex >= 0 && this.answerQIndex < this.answerQuestions.length;
      if (!hasQ) return;
      const needSave = this.answerNeedsSave();
      if (needSave) {
        await this.saveCurrentAnswerAndNext({ preserveScroll: true });
        return;
      }
      await this.loadAnswerQuestion(this.answerQIndex + 1, { preserveScroll: true });
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async refreshAnswerPapers() {
    try {
      this.setStatus("加载答案卷中…");
      const data = await api("/answer_papers");
      const aps = data.papers || [];
      const sortVal = (p) => {
        if (!p) return 0;
        const v = p.display_no != null ? Number(p.display_no) : Number(p.id);
        return Number.isFinite(v) ? v : 0;
      };
      this.answerPaperList = aps.slice().sort((a, b) => sortVal(b) - sortVal(a));
      this.setStatus(`答案卷数量：${aps.length}`, "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
      this.answerPaperList = [];
    }
  },
  async startAnswerMarkFromAdmin(msPaperId, pairedQpId) {
    const qpId = pairedQpId != null ? Number(pairedQpId) : null;
    if (!qpId || !Number.isFinite(qpId)) {
      alert("该答案卷未与题干卷配对，请先在试卷列表中配对。");
      return;
    }
    this.showMarkView();
    await this.openPaper(qpId);
    await this.openAnswerMode(msPaperId);
  },

  // -------- answer admin delete --------
  async deleteAnswerPaper(p) {
    if (!confirm(`确认删除答案卷 #${p.id}？`)) return;
    const confirmText = prompt(`输入 ${p.id} 以确认删除：`, "");
    if (String(confirmText || "").trim() !== String(p.id)) return;
    try {
      this.setStatus(`删除答案卷 #${p.id}…`);
      await api(`/papers/${p.id}`, { method: "DELETE" });
      this.setStatus("已删除", "ok");
      await this.refreshAnswerPapers();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },

  // -------- settings --------
};

