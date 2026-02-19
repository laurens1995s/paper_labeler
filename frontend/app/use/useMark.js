import { useAppContext } from "./useAppContext.js";
import { api } from "../../modules/api.js";
import * as Settings from "../../modules/settings.js";
import { clamp01, normalizeBox, pointInBox, clampInt } from "../../modules/utils.js";
import { setLastMarkedPageNum } from "../helpers.js";
import {
  pendingOcrBoxesByPaperId,
  pendingOcrDraftByPaperId,
  pendingOcrWarningByPaperId,
  pendingOcrDraftSelectedIdxByPaperId,
} from "../store.js";
import {
  computeUnionAlignBoundsFromBoxesPayload,
  alignBoxesPayloadToBoundsX,
  getPaperAlignBounds,
  ensurePaperAlignRefFromBoxes,
  getActivePaperAlignBounds,
} from "../align.js";

const MARK_HISTORY_LIMIT = 50;
const MARK_SAVED_HISTORY_LIMIT = 30;
const cloneMarkBoxes = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((b) => ({
    ...b,
    bbox: Array.isArray(b?.bbox) ? Array.from(b.bbox) : [],
  }));
};
const cloneOcrDrafts = (list) => {
  if (!Array.isArray(list)) return [];
  try {
    return JSON.parse(JSON.stringify(list));
  } catch {
    return list.map((q) => ({
      ...q,
      sections: Array.isArray(q?.sections) ? [...q.sections] : [],
    }));
  }
};
const markBoxesEqual = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) return false;
    if (x.page !== y.page) return false;
    if (x.source !== y.source) return false;
    if (x.draftIdx !== y.draftIdx) return false;
    if (x.label !== y.label) return false;
    const xb = Array.isArray(x.bbox) ? x.bbox : [];
    const yb = Array.isArray(y.bbox) ? y.bbox : [];
    if (xb.length !== yb.length) return false;
    for (let j = 0; j < xb.length; j++) {
      if (xb[j] !== yb[j]) return false;
    }
  }
  return true;
};

const clonePersistedBoxPayload = (boxes) => {
  if (!Array.isArray(boxes)) return [];
  return boxes
    .map((b) => ({
      page: Number(b?.page),
      bbox: Array.isArray(b?.bbox) ? Array.from(b.bbox) : [],
    }))
    .filter((b) => Number.isFinite(b.page) && Array.isArray(b.bbox) && b.bbox.length === 4);
};

const clonePersistedQuestionPayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    return { sections: [], notes: null, boxes: [] };
  }
  const sections = Array.isArray(payload.sections)
    ? payload.sections.filter((s) => s != null && String(s).trim()).map((s) => String(s))
    : [];
  const notes = payload.notes == null ? null : String(payload.notes);
  const boxes = clonePersistedBoxPayload(payload.boxes);
  return { sections, notes, boxes };
};

export const useMark = () => {
  return useAppContext();
};

export const markMethods = {
  // -------- undo / redo --------
  resetMarkHistory() {
    this.markUndoStack = [];
    this.markRedoStack = [];
    this.markPendingSnapshot = null;
  },
  captureMarkSnapshot() {
    const selectedIndex = this.selectedNewBox ? (this.newBoxes || []).indexOf(this.selectedNewBox) : -1;
    return {
      boxes: cloneMarkBoxes(this.newBoxes),
      selectedIndex,
      ocrDraftQuestions: cloneOcrDrafts(this.ocrDraftQuestions),
      selectedOcrDraftIdx: this.selectedOcrDraftIdx,
    };
  },
  restoreMarkSnapshot(snapshot) {
    if (!snapshot) return;
    this.newBoxes = cloneMarkBoxes(snapshot.boxes);
    const idx = typeof snapshot.selectedIndex === "number" ? snapshot.selectedIndex : -1;
    this.selectedNewBox = idx >= 0 && this.newBoxes[idx] ? this.newBoxes[idx] : null;
    if (Array.isArray(snapshot.ocrDraftQuestions)) {
      this.ocrDraftQuestions = cloneOcrDrafts(snapshot.ocrDraftQuestions);
    }
    if (snapshot.selectedOcrDraftIdx != null) {
      const maxIdx = Math.max(0, (this.ocrDraftQuestions?.length || 1) - 1);
      this.selectedOcrDraftIdx = clampInt(snapshot.selectedOcrDraftIdx, 0, maxIdx);
    }
    this.drawing = false;
    this.startPt = null;
    this.dragNewBoxOp = null;
    this.updateBoxControls();
    this.drawOverlay();
  },
  pushMarkUndoSnapshot(snapshot) {
    if (!snapshot) return;
    this.markUndoStack.push(snapshot);
    if (this.markUndoStack.length > MARK_HISTORY_LIMIT) this.markUndoStack.shift();
    this.markRedoStack = [];
  },
  commitMarkHistory(snapshot) {
    if (!snapshot) return;
    if (markBoxesEqual(snapshot.boxes, this.newBoxes)) return;
    this.pushMarkUndoSnapshot(snapshot);
  },
  pushSavedMarkUndo(entry) {
    if (!entry) return;
    this.markSavedUndoStack.push(entry);
    if (this.markSavedUndoStack.length > MARK_SAVED_HISTORY_LIMIT) this.markSavedUndoStack.shift();
    this.markSavedRedoStack = [];
  },
  async applySavedQuestionPayload(questionId, payload) {
    const safeId = Number(questionId);
    if (!Number.isFinite(safeId)) throw new Error("题目 ID 无效");
    const nextPayload = clonePersistedQuestionPayload(payload);
    await api(`/questions/${safeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: nextPayload.sections, notes: nextPayload.notes }),
    });
    await api(`/questions/${safeId}/boxes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxes: nextPayload.boxes }),
    });
  },
  async refreshAfterSavedHistoryChange(paperId, focusPage = null) {
    if (this.currentPaperId !== paperId) return;
    if (typeof this.refreshPapers === "function") {
      await this.refreshPapers();
    }
    if (typeof this.invalidateExportFilterCache === "function") {
      this.invalidateExportFilterCache();
    }
    if (Number.isFinite(Number(focusPage))) {
      const idx = this.pages.findIndex((p) => p.page === Number(focusPage));
      if (idx >= 0 && idx !== this.currentPageIndex) {
        await this.gotoPageIndex(idx);
      }
    }
    await this.refreshPageQuestions();
    this.drawOverlay();
  },
  async undoSavedMark() {
    if (this.markPersistBusy) return;
    if (!this.markSavedUndoStack.length) return;
    const entry = this.markSavedUndoStack[this.markSavedUndoStack.length - 1];
    if (!entry) return;
    if (this.currentPaperId !== entry.paperId) {
      this.setStatus("请先打开对应试卷再撤销已保存操作", "info");
      return;
    }
    this.markPersistBusy = true;
    try {
      this.setStatus("撤销已保存操作中…");
      if (entry.type === "create") {
        await api(`/questions/${entry.questionId}`, { method: "DELETE" });
      } else if (entry.type === "update") {
        await this.applySavedQuestionPayload(entry.questionId, entry.before);
      } else {
        return;
      }
      this.markSavedUndoStack.pop();
      this.markSavedRedoStack.push(entry);
      const focusPage = entry?.before?.boxes?.[0]?.page ?? entry?.after?.boxes?.[0]?.page ?? null;
      await this.refreshAfterSavedHistoryChange(entry.paperId, focusPage);
      this.setStatus("已撤销", "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    } finally {
      this.markPersistBusy = false;
    }
  },
  async redoSavedMark() {
    if (this.markPersistBusy) return;
    if (!this.markSavedRedoStack.length) return;
    const entry = this.markSavedRedoStack[this.markSavedRedoStack.length - 1];
    if (!entry) return;
    if (this.currentPaperId !== entry.paperId) {
      this.setStatus("请先打开对应试卷再重做已保存操作", "info");
      return;
    }
    this.markPersistBusy = true;
    try {
      this.setStatus("重做已保存操作中…");
      if (entry.type === "create") {
        const payload = clonePersistedQuestionPayload(entry.after);
        const created = await api(`/papers/${entry.paperId}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sections: payload.sections,
            status: "confirmed",
            notes: payload.notes,
            boxes: payload.boxes,
          }),
        });
        const nextQuestionId = created?.question?.id;
        if (nextQuestionId != null) entry.questionId = Number(nextQuestionId);
      } else if (entry.type === "update") {
        await this.applySavedQuestionPayload(entry.questionId, entry.after);
      } else {
        return;
      }
      this.markSavedRedoStack.pop();
      this.markSavedUndoStack.push(entry);
      const focusPage = entry?.after?.boxes?.[0]?.page ?? entry?.before?.boxes?.[0]?.page ?? null;
      await this.refreshAfterSavedHistoryChange(entry.paperId, focusPage);
      this.setStatus("已重做", "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    } finally {
      this.markPersistBusy = false;
    }
  },
  async undoMark() {
    if (this.markUndoStack.length) {
      const current = this.captureMarkSnapshot();
      const prev = this.markUndoStack.pop();
      this.markRedoStack.push(current);
      this.restoreMarkSnapshot(prev);
      return;
    }
    await this.undoSavedMark();
  },
  async redoMark() {
    if (this.markRedoStack.length) {
      const current = this.captureMarkSnapshot();
      const next = this.markRedoStack.pop();
      this.markUndoStack.push(current);
      this.restoreMarkSnapshot(next);
      return;
    }
    await this.redoSavedMark();
  },

  stashCurrentOcrDraftStateForPaper(paperId) {
    if (paperId == null) return;
    if (!this.hasOcrDraftMode) {
      pendingOcrDraftByPaperId.delete(paperId);
      pendingOcrDraftSelectedIdxByPaperId.delete(paperId);
      return;
    }
    const drafts = [];
    for (let i = 0; i < this.ocrDraftQuestions.length; i++) {
      const q = this.ocrDraftQuestions[i];
      if (!q) continue;
      const label = String(q.label ?? "?").trim() || "?";
      const sections = Array.isArray(q.sections) ? q.sections : (q.section ? [q.section] : []);
      const boxes = (this.newBoxes || [])
        .filter((b) => b && b.source === "ocr" && Number(b.draftIdx) === i)
        .filter((b) => Number.isFinite(b.page) && Array.isArray(b.bbox) && b.bbox.length === 4)
        .map((b) => ({ page: b.page, bbox: b.bbox }));
      drafts.push({ label, sections, boxes });
    }
    pendingOcrDraftByPaperId.set(paperId, drafts);
    pendingOcrDraftSelectedIdxByPaperId.set(
      paperId,
      clampInt(this.selectedOcrDraftIdx, 0, Math.max(0, this.ocrDraftQuestions.length - 1))
    );
  },
  async manualAutoRecognize() {
    if (!this.currentPaperId) return;
    if (this.hasOcrDraftMode || (this.newBoxes && this.newBoxes.length)) {
      if (!confirm("重新生成当前试卷的 OCR 草稿框？未保存的草稿将丢失。")) return;
    }
    try {
      this.setStatus("自动识别中…");
      const data = await api(`/papers/${this.currentPaperId}/auto_suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_height_px: clampInt(this.ocrMinHeightPx, 0, 2000),
          y_padding_px: clampInt(this.ocrYPaddingPx, 0, 500),
        }),
      });

      this.ocrDraftQuestions = [];
      this.selectedOcrDraftIdx = 0;
      this.newBoxes = [];
      this.selectedNewBox = null;
      this.resetMarkHistory();

      const drafts = data?.ocr_questions || [];
      const flatBoxes = data?.ocr_boxes || [];
      const skipped = Array.isArray(data?.skipped_pages) ? data.skipped_pages : [];
      const warn = data?.ocr_warning;

      if (Array.isArray(drafts) && drafts.length) {
        this.ocrDraftQuestions = drafts
          .map((q) => ({ label: String(q?.label ?? "?").trim() || "?", sections: [] }))
          .filter((q) => q && q.label);

        const flat = [];
        this.ocrDraftQuestions.forEach((q, draftIdx) => {
          if (!q || !drafts[draftIdx]) return;
          const boxes = (drafts[draftIdx]?.boxes || []).map((b) => ({
            page: Number(b?.page),
            bbox: Array.from(b?.bbox || []),
            source: "ocr",
            label: q.label,
            draftIdx,
          }));
          for (const b of boxes) {
            if (Number.isFinite(b.page) && Array.isArray(b.bbox) && b.bbox.length === 4) flat.push(b);
          }
        });
        this.newBoxes = flat;
      } else if (Array.isArray(flatBoxes) && flatBoxes.length) {
        this.newBoxes = flatBoxes
          .map((b) => ({ page: Number(b.page), bbox: Array.from(b.bbox || []), source: "ocr", label: b?.label ?? null }))
          .filter((b) => Number.isFinite(b.page) && Array.isArray(b.bbox) && b.bbox.length === 4);
      }

      this.selectedNewBox = this.newBoxes.length ? this.newBoxes[0] : null;
      if (this.selectedNewBox && this.pages.length) {
        const idx = this.pages.findIndex((p) => p.page === this.selectedNewBox.page);
        if (idx >= 0) this.currentPageIndex = idx;
      }

      if (this.currentPageIndex >= 0) await this.loadCurrentPage();
      this.updateBoxControls();
      this.drawOverlay();
      this.resetMarkHistory();
      await this.refreshSuggestedNextNo();

      if (warn) {
        this.setStatus(String(warn), "err");
      } else {
        const msg = skipped.length
          ? `自动识别完成：${this.ocrDraftQuestions.length || "?"} 题 / ${this.newBoxes.length} 框（跳过 ${skipped.length} 页）`
          : `自动识别完成：${this.ocrDraftQuestions.length || "?"} 题 / ${this.newBoxes.length} 框`;
        this.setStatus(msg + "（未保存）", "ok");
      }
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  addOcrDraftQuestion() {
    const newIdx = this.ocrDraftQuestions.length;
    this.ocrDraftQuestions.push({ label: String(newIdx + 1), sections: [], source: "manual" });
    this.selectedOcrDraftIdx = newIdx;
    if (this.currentPaperId != null) pendingOcrDraftSelectedIdxByPaperId.set(this.currentPaperId, newIdx);
    this.drawOverlay();
  },
  selectOcrDraft(idx) {
    this.selectedOcrDraftIdx = idx;
    if (this.currentPaperId != null) pendingOcrDraftSelectedIdxByPaperId.set(this.currentPaperId, idx);
    const first = (this.newBoxes || []).find((b) => b && b.source === "ocr" && Number(b.draftIdx) === idx);
    if (first && this.pages.length) {
      this.selectedNewBox = first;
      const targetIdx = this.pages.findIndex((p) => p.page === first.page);
      if (targetIdx >= 0) {
        this.gotoPageIndex(targetIdx).then(() => this.drawOverlay()).catch(() => this.drawOverlay());
        return;
      }
    }
    this.drawOverlay();
  },
  async saveOcrDraftQuestionsBatch() {
    if (!this.currentPaperId) return;
    if (!this.hasOcrDraftMode) return;

    const byIdx = new Map();
    for (const b of this.newBoxes) {
      if (!b || b.source !== "ocr") continue;
      const di = Number(b.draftIdx);
      if (!Number.isFinite(di)) continue;
      if (!byIdx.has(di)) byIdx.set(di, []);
      byIdx.get(di).push(b);
    }

    const total = this.ocrDraftQuestions.length;
    if (!confirm(`确认保存 ${total} 题 OCR 草稿（跨页合并框）？`)) return;

    let paperBounds = this.alignPaperFirstEnabled ? getPaperAlignBounds(this.paperAlignRef, this.currentPaperId) : null;
    if (this.alignPaperFirstEnabled && !paperBounds) {
      const firstBoxes = (byIdx.get(0) || []).map((b) => ({ bbox: b?.bbox }));
      const union = computeUnionAlignBoundsFromBoxesPayload(firstBoxes);
      if (union) {
        this.paperAlignRef = ensurePaperAlignRefFromBoxes(this.paperAlignRef, this.currentPaperId, firstBoxes);
        Settings.savePaperAlignRef(this.currentPaperId, union);
        paperBounds = union;
      }
    }

    try {
      this.setStatus(`保存中…（${total} 题）`);
      for (let i = 0; i < this.ocrDraftQuestions.length; i++) {
        const q = this.ocrDraftQuestions[i];
        if (!q) continue;
        const boxes = (byIdx.get(i) || [])
          .filter((b) => b && Number.isFinite(b.page) && Array.isArray(b.bbox) && b.bbox.length === 4)
          .sort((a, b) => (a.page - b.page) || (a.bbox[1] - b.bbox[1]));
        if (!boxes.length) continue;

        const aligned = this.alignPaperFirstEnabled && paperBounds
          ? boxes.map((b) => ({ ...b, bbox: normalizeBox([paperBounds[0], b.bbox[1], paperBounds[1], b.bbox[3]]) }))
          : boxes;

        this.setStatus(`保存第 ${i + 1}/${total} 题（题号 ${q.label || "?"}）…`);
        const sectionsToSave = q.sections && Array.isArray(q.sections) && q.sections.length > 0
          ? q.sections
          : (String(q.section || "").trim() ? [q.section] : this.selectedSectionsForNewQuestion);

        await api(`/papers/${this.currentPaperId}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sections: sectionsToSave,
            status: "confirmed",
            notes: null,
            boxes: aligned.map((b) => ({ page: b.page, bbox: b.bbox })),
          }),
        });
      }

      this.ocrDraftQuestions = [];
      this.selectedOcrDraftIdx = 0;
      this.newBoxes = [];
      this.selectedNewBox = null;
      this.selectedSectionsForNewQuestion = [];
      this.resetMarkHistory();
      pendingOcrDraftByPaperId.delete(this.currentPaperId);
      pendingOcrDraftSelectedIdxByPaperId.delete(this.currentPaperId);
      this.updateBoxControls();
      if (typeof this.refreshPapers === "function") {
        await this.refreshPapers();
      }
      if (typeof this.invalidateExportFilterCache === "function") {
        this.invalidateExportFilterCache();
      }
      await this.refreshPageQuestions();
      this.drawOverlay();
      await this.refreshSuggestedNextNo();
      this.setStatus("已保存", "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },

  // -------- drawing --------
  getMarkRefs() {
    const mark = this.$refs.markView;
    const refs = mark && mark.$refs ? mark.$refs : {};
    return {
      img: refs.pageImg || this.$refs.pageImg || null,
      canvas: refs.overlay || this.$refs.overlay || null,
    };
  },
  setCanvasSize() {
    const { img, canvas } = this.getMarkRefs();
    if (!img || !canvas) return;
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    canvas.style.width = `${img.clientWidth}px`;
    canvas.style.height = `${img.clientHeight}px`;
    canvas.style.pointerEvents = "auto";
  },
  onPageImgLoad() {
    this.setCanvasSize();
    this.drawOverlay();
  },
  canvasPointToNorm(evt) {
    const { canvas } = this.getMarkRefs();
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / rect.width;
    const y = (evt.clientY - rect.top) / rect.height;
    return [clamp01(x), clamp01(y)];
  },
  getMarkAlignBoundsForBox(targetBox = null, isNew = false) {
    const allBoxes = (this.newBoxes || []).filter((b) => b && Array.isArray(b.bbox) && b.bbox.length === 4);
    const scopeBoxes = this.hasOcrDraftMode
      ? allBoxes.filter((b) => b.source === "ocr" && Number(b.draftIdx) === Number(this.selectedOcrDraftIdx))
      : allBoxes;
    if (this.alignPaperFirstEnabled && this.currentPaperId != null) {
      // paper-level alignment: same left/right bounds across the whole paper
      return getActivePaperAlignBounds(this.paperAlignRef, this.currentPaperId, allBoxes);
    }
    if (this.alignLeftEnabled) {
      // multi-box alignment: in OCR draft mode align within current draft question only
      const first = scopeBoxes[0] || null;
      if (!first) return null;
      if (isNew) {
        if (scopeBoxes.length === 0) return null;
      } else if (targetBox && targetBox === first) {
        return null;
      }
      return [first.bbox[0], first.bbox[2]];
    }
    return null;
  },
  alignMarkBBoxToBoundsX(bbox, bounds) {
    if (!bounds || !Array.isArray(bbox) || bbox.length !== 4) return bbox;
    const x0 = clamp01(bounds[0]);
    const x1 = clamp01(bounds[1]);
    const minW = 0.01;
    const nx1 = Math.max(x1, x0 + minW);
    return normalizeBox([x0, bbox[1], nx1, bbox[3]]);
  },
  async ensurePaperAlignRefFromFirstQuestion(paperId) {
    if (!this.alignPaperFirstEnabled || paperId == null) return;
    const existing = getPaperAlignBounds(this.paperAlignRef, paperId);
    if (existing) return;
    try {
      const data = await api(`/papers/${paperId}/questions`);
      const list = data?.questions || [];
      if (!list.length) return;
      let first = null;
      for (const q of list) {
        if (!q || q.id == null) continue;
        if (!first || q.id < first.id) first = q;
      }
      const boxes = first?.boxes || [];
      if (!boxes.length) return;
      const bounds = computeUnionAlignBoundsFromBoxesPayload(boxes);
      if (!bounds) return;
      this.paperAlignRef = ensurePaperAlignRefFromBoxes(this.paperAlignRef, paperId, boxes);
      const saved = getPaperAlignBounds(this.paperAlignRef, paperId);
      if (saved) Settings.savePaperAlignRef(paperId, saved);
    } catch {}
  },
  hitTestNewBoxes(normX, normY) {
    const bxs = this.newBoxes || [];
    const pageNum = this.pages[this.currentPageIndex]?.page;
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
          return { kind: "resize", box: b, corner: c.corner };
        }
      }
      for (const c of mids) {
        if (Math.abs(normX - c.x) <= pad && Math.abs(normY - c.y) <= pad) {
          return { kind: "resize", box: b, corner: c.corner };
        }
      }
      if (pointInBox(normX, normY, b.bbox)) {
        return { kind: "move", box: b, offX: normX - x0, offY: normY - y0, w: x1 - x0, h: y1 - y0 };
      }
    }
    return null;
  },
  drawOverlay(tempBox = null) {
    const { canvas, img } = this.getMarkRefs();
    if (!canvas) return;
    if (img && (canvas.width !== img.clientWidth || canvas.height !== img.clientHeight)) {
      this.setCanvasSize();
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;

    if (!this.hasOcrDraftMode && this.editingQuestionId == null) {
      for (const q of this.pageQuestions) {
        for (const b of q.boxes || []) {
          if (b.page !== this.pages[this.currentPageIndex]?.page) continue;
          const [x0, y0, x1, y1] = b.bbox;
          ctx.strokeStyle = q.status === "confirmed" ? "#16a34a" : "#f59e0b";
          ctx.strokeRect(
            x0 * canvas.width,
            y0 * canvas.height,
            (x1 - x0) * canvas.width,
            (y1 - y0) * canvas.height
          );
        }
      }
    }

    for (const nb of this.newBoxes) {
      if (nb.page !== this.pages[this.currentPageIndex]?.page) continue;
      if (this.hasOcrDraftMode && nb.source !== "ocr") continue;
      if (this.hasOcrDraftMode && Number(nb.draftIdx) !== Number(this.selectedOcrDraftIdx)) {
        ctx.strokeStyle = "rgba(239,68,68,0.35)";
      } else {
        ctx.strokeStyle = "#ef4444";
      }
      const [x0, y0, x1, y1] = nb.bbox;
      ctx.strokeRect(
        x0 * canvas.width,
        y0 * canvas.height,
        (x1 - x0) * canvas.width,
        (y1 - y0) * canvas.height
      );
      if (nb && nb.label != null && String(nb.label).trim()) {
        const text = String(nb.label).trim();
        ctx.save();
        ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
        const pad = 4;
        const tx = x0 * canvas.width + 2;
        const ty = y1 * canvas.height - 2;
        const m = ctx.measureText(text);
        const tw = Math.ceil(m.width);
        const th = 14;
        ctx.fillStyle = "rgba(239,68,68,0.92)";
        ctx.fillRect(tx, ty - th, tw + pad * 2, th);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, tx + pad, ty - 3);
        ctx.restore();
      }
      if (this.selectedNewBox === nb) {
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
      ctx.strokeRect(
        x0 * canvas.width,
        y0 * canvas.height,
        (x1 - x0) * canvas.width,
        (y1 - y0) * canvas.height
      );
      ctx.setLineDash([]);
    }
  },
  setupDrawing() {
    const { canvas } = this.getMarkRefs();
    if (!canvas || canvas.__bound) return;
    canvas.__bound = true;
    const onDown = (evt) => {
      if (this.currentPageIndex < 0) return;
      evt.preventDefault?.();
      const [x, y] = this.canvasPointToNorm(evt);
      const hit = this.hitTestNewBoxes(x, y);
      if (hit) {
        if (!this.markPendingSnapshot) this.markPendingSnapshot = this.captureMarkSnapshot();
        if (this.hasOcrDraftMode && hit.box && hit.box.source === "ocr") {
          const di = clampInt(hit.box.draftIdx, 0, Math.max(0, (this.ocrDraftQuestions?.length || 1) - 1));
          if (Number(di) !== Number(this.selectedOcrDraftIdx)) {
            this.selectedOcrDraftIdx = di;
            if (this.currentPaperId != null) pendingOcrDraftSelectedIdxByPaperId.set(this.currentPaperId, di);
          }
        }
        this.selectedNewBox = hit.box;
        this.dragNewBoxOp = hit;
        this.drawOverlay();
        return;
      }
      this.selectedNewBox = null;
      this.dragNewBoxOp = null;
      if (!this.markPendingSnapshot) this.markPendingSnapshot = this.captureMarkSnapshot();
      this.drawing = true;
      this.startPt = [x, y];
    };

    const onMove = (evt) => {
      evt.preventDefault?.();
      const [x, y] = this.canvasPointToNorm(evt);
      if (this.dragNewBoxOp && this.dragNewBoxOp.box) {
        const b = this.dragNewBoxOp.box;
        const [x0, y0, x1, y1] = b.bbox;
        if (this.dragNewBoxOp.kind === "move") {
          const nx0 = clamp01(x - this.dragNewBoxOp.offX);
          const ny0 = clamp01(y - this.dragNewBoxOp.offY);
          const w = this.dragNewBoxOp.w;
          const h = this.dragNewBoxOp.h;
          const fx0 = clamp01(Math.min(nx0, 1 - w));
          const fy0 = clamp01(Math.min(ny0, 1 - h));
          b.bbox = normalizeBox([fx0, fy0, fx0 + w, fy0 + h]);
        } else if (this.dragNewBoxOp.kind === "resize") {
          let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
          if (this.dragNewBoxOp.corner === "tl") { nx0 = x; ny0 = y; }
          else if (this.dragNewBoxOp.corner === "tr") { nx1 = x; ny0 = y; }
          else if (this.dragNewBoxOp.corner === "bl") { nx0 = x; ny1 = y; }
          else if (this.dragNewBoxOp.corner === "br") { nx1 = x; ny1 = y; }
          else if (this.dragNewBoxOp.corner === "tm") { ny0 = y; }
          else if (this.dragNewBoxOp.corner === "bm") { ny1 = y; }
          else if (this.dragNewBoxOp.corner === "ml") { nx0 = x; }
          else if (this.dragNewBoxOp.corner === "mr") { nx1 = x; }
          b.bbox = normalizeBox([nx0, ny0, nx1, ny1]);
        }
        const bounds = this.getMarkAlignBoundsForBox(b, false);
        if (bounds && this.dragNewBoxOp.kind !== "resize") {
          b.bbox = this.alignMarkBBoxToBoundsX(b.bbox, bounds);
        }
        this.drawOverlay();
        return;
      }
      if (this.drawing && this.startPt) {
        const [sx, sy] = this.startPt;
        let temp = normalizeBox([sx, sy, x, y]);
        const bounds = this.getMarkAlignBoundsForBox(null, true);
        if (bounds) temp = this.alignMarkBBoxToBoundsX(temp, bounds);
        this.drawOverlay(temp);
      }
    };

    const onEnd = (evt) => {
      evt.preventDefault?.();
      const pendingSnapshot = this.markPendingSnapshot;
      if (this.drawing && this.startPt) {
        const [x, y] = this.canvasPointToNorm(evt);
        const [sx, sy] = this.startPt;
        let finalBox = normalizeBox([sx, sy, x, y]);
        const minW = 0.005;
        // Allow thinner single-line question boxes.
        const minH = 0.0015;
        if (Math.abs(finalBox[2] - finalBox[0]) > minW && Math.abs(finalBox[3] - finalBox[1]) > minH) {
          const pageNum = this.pages[this.currentPageIndex]?.page;
          const bounds = this.getMarkAlignBoundsForBox(null, true);
          if (bounds) finalBox = this.alignMarkBBoxToBoundsX(finalBox, bounds);
          let payload = { page: pageNum, bbox: finalBox };
          if (this.hasOcrDraftMode) {
            const maxIdx = Math.max(0, (this.ocrDraftQuestions?.length || 1) - 1);
            const di = clampInt(this.selectedOcrDraftIdx, 0, maxIdx);
            const label = this.ocrDraftQuestions?.[di]?.label ?? null;
            payload = { ...payload, source: "ocr", draftIdx: di, label };
          }
          this.newBoxes.push(payload);
        }
        this.selectedNewBox = this.newBoxes[this.newBoxes.length - 1];
        if (this.currentPaperId != null) setLastMarkedPageNum(this.currentPaperId, this.currentPaperCacheToken, this.pages[this.currentPageIndex]?.page);
        this.updateBoxControls();
        this.drawOverlay();
      }
      this.drawing = false;
      this.startPt = null;
      this.dragNewBoxOp = null;
      this.markPendingSnapshot = null;
      this.commitMarkHistory(pendingSnapshot);
    };

    const onCancel = () => {
      if (this.drawing) {
        this.drawing = false;
        this.startPt = null;
        this.drawOverlay();
      }
      if (this.dragNewBoxOp) {
        this.dragNewBoxOp = null;
        this.updateBoxControls();
        this.drawOverlay();
      }
      this.markPendingSnapshot = null;
    };

    if (window.PointerEvent) {
      canvas.addEventListener("pointerdown", (evt) => {
        canvas.setPointerCapture?.(evt.pointerId);
        onDown(evt);
      });
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onEnd);
      canvas.addEventListener("pointercancel", onCancel);
      canvas.addEventListener("lostpointercapture", onCancel);
    } else {
      canvas.addEventListener("mousedown", onDown);
      canvas.addEventListener("mousemove", onMove);
      canvas.addEventListener("mouseup", onEnd);
      canvas.addEventListener("mouseleave", onCancel);
    }
  },
  updateBoxControls() {
    // triggers computed updates
  },

  // -------- edit question --------
  enterEditQuestionMode(questionId, original = null, isLocal = false) {
    this.editingQuestionId = questionId;
    this.editingQuestionOriginal = original || null;
    this.isLocalEdit = !!isLocal;
  },
  exitEditQuestionMode() {
    this.editingQuestionId = null;
    this.editingQuestionOriginal = null;
    this.isLocalEdit = false;
    this.answerReplaceMode = false;
    this.answerReplaceQuestionId = null;
  },
  cancelEditQuestion() {
    this.exitEditQuestionMode();
    this.clearBoxes();
    this.setStatus("已取消修改", "ok");
  },
  async editQuestion(q) {
    if (this.hasOcrDraftMode) {
      this.setStatus("OCR 草稿模式下无法修改", "err");
      return;
    }
    try {
      this.setStatus(`加载题目 #${q.id} 中…`);
      const resp = await api(`/questions/${q.id}`);
      const full = resp?.question || q;
      const boxes = Array.isArray(full?.boxes) ? full.boxes : (Array.isArray(q?.boxes) ? q.boxes : []);
      if (!boxes.length) {
        this.setStatus("题目没有框", "err");
        return;
      }
      this.newBoxes = boxes.map((b) => ({ page: b.page, bbox: b.bbox }));
      this.selectedNewBox = this.newBoxes[0] || null;
      const sec = (full?.section ?? null) || "";
      const notes = (full?.notes ?? null) || "";
      this.qSectionSelectValue = sec;
      this.qNotes = notes;
      this.selectedSectionsForNewQuestion = full?.sections && Array.isArray(full.sections) ? [...full.sections] : [];
      this.resetMarkHistory();

      this.enterEditQuestionMode(
        q.id,
        {
          question_no: full?.question_no ?? null,
          section: full?.section ?? null,
          sections: full?.sections ?? [],
          notes: full?.notes ?? null,
          boxes: clonePersistedBoxPayload(boxes),
        },
        true
      );
      this.updateBoxControls();

      const firstPage = this.newBoxes?.[0]?.page;
      if (firstPage != null) {
        const targetIdx = this.pages.findIndex((p) => p.page === firstPage);
        if (targetIdx >= 0 && targetIdx !== this.currentPageIndex) {
          await this.gotoPageIndex(targetIdx);
        } else {
          this.drawOverlay();
        }
      } else {
        this.drawOverlay();
      }
      this.setStatus("已进入修改模式：调整框后保存", "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async deleteQuestion(q) {
    if (!confirm(`确认删除题目？(id=${q.id})`)) return;
    try {
      this.setStatus(`删除题目 #${q.id} 中…`);
      await api(`/questions/${q.id}`, { method: "DELETE" });
      if (typeof this.invalidateExportFilterCache === "function") {
        this.invalidateExportFilterCache();
      }
      this.setStatus("已删除", "ok");
      if (typeof this.refreshPapers === "function") {
        await this.refreshPapers();
      }
      await this.refreshPageQuestions();
      this.drawOverlay();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },

  // -------- box list actions --------
  deleteBox(box) {
    const snapshot = this.captureMarkSnapshot();
    this.newBoxes = this.newBoxes.filter((x) => x !== box);
    this.updateBoxControls();
    this.drawOverlay();
    this.commitMarkHistory(snapshot);
  },
  highlightQuestion(q) {
    const { canvas, img } = this.getMarkRefs();
    if (!canvas) return;
    const pageNum = this.pages[this.currentPageIndex]?.page;
    if (!pageNum || !q || !Array.isArray(q.boxes)) return;
    if (img && (canvas.width !== img.clientWidth || canvas.height !== img.clientHeight)) {
      this.setCanvasSize();
      this.drawOverlay();
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(37,99,235,0.9)";
    ctx.setLineDash([6, 4]);
    for (const b of q.boxes) {
      if (!b || b.page !== pageNum || !Array.isArray(b.bbox) || b.bbox.length !== 4) continue;
      const [x0, y0, x1, y1] = b.bbox;
      ctx.strokeRect(
        x0 * canvas.width,
        y0 * canvas.height,
        (x1 - x0) * canvas.width,
        (y1 - y0) * canvas.height
      );
    }
    ctx.restore();
  },
  async jumpToBoxPage(pageNum) {
    const targetIdx = this.pages.findIndex((p) => p.page === pageNum);
    if (targetIdx >= 0) await this.gotoPageIndex(targetIdx);
  },

  // -------- save question --------
  async saveQuestion() {
    if (!this.newBoxes.length) return;
    let section = this.qSectionSelectValue || null;
    let notes = this.qNotes || null;
    let boxesPayload = this.newBoxes.map((b) => ({ page: b.page, bbox: b.bbox }));

    if (this.alignLeftEnabled && Array.isArray(boxesPayload) && boxesPayload.length > 1) {
      const first = boxesPayload[0];
      if (first && Array.isArray(first.bbox) && first.bbox.length === 4) {
        boxesPayload = alignBoxesPayloadToBoundsX(boxesPayload, [first.bbox[0], first.bbox[2]]);
      }
    }

    if (this.alignPaperFirstEnabled && this.currentPaperId != null && Array.isArray(boxesPayload) && boxesPayload.length) {
      const ref = getPaperAlignBounds(this.paperAlignRef, this.currentPaperId);
      const bounds = ref || computeUnionAlignBoundsFromBoxesPayload(boxesPayload);
      if (bounds) boxesPayload = alignBoxesPayloadToBoundsX(boxesPayload, bounds);
    }

    if (this.editingQuestionId != null) {
      const qid = this.editingQuestionId;
      const original = this.editingQuestionOriginal || {};
      const beforePayload = clonePersistedQuestionPayload({
        sections: Array.isArray(original.sections)
          ? original.sections
          : (original.section ? [original.section] : []),
        notes: original.notes ?? null,
        boxes: Array.isArray(original.boxes) ? original.boxes : [],
      });
      let sectionsToSave = this.selectedSectionsForNewQuestion.length > 0
        ? this.selectedSectionsForNewQuestion
        : (section ? [section] : []);
      if (sectionsToSave.length === 0 && this.editingQuestionOriginal) {
        const origSections = this.editingQuestionOriginal.sections || (this.editingQuestionOriginal.section ? [this.editingQuestionOriginal.section] : []);
        sectionsToSave = origSections;
      }
      if (this.editingQuestionOriginal && notes == null) {
        notes = this.editingQuestionOriginal.notes ?? null;
      }
      this.setStatus(`保存题目 #${qid} 中…`);
      await api(`/questions/${qid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: sectionsToSave, notes }),
      });
      await api(`/questions/${qid}/boxes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxes: boxesPayload }),
      });
      this.pushSavedMarkUndo({
        type: "update",
        paperId: this.currentPaperId,
        questionId: Number(qid),
        before: beforePayload,
        after: clonePersistedQuestionPayload({
          sections: sectionsToSave,
          notes,
          boxes: boxesPayload,
        }),
      });

      this.newBoxes = [];
      this.updateBoxControls();
      this.resetMarkHistory();
      await this.refreshSectionDefsIntoUI();
      await this.refreshPageQuestions();
      if (typeof this.refreshPapers === "function") {
        await this.refreshPapers();
      }
      if (typeof this.invalidateExportFilterCache === "function") {
        this.invalidateExportFilterCache();
      }
      this.exitEditQuestionMode();
      this.drawOverlay();
      this.setStatus("已保存", "ok");

      const firstPage = boxesPayload?.[0]?.page ?? this.pages[this.currentPageIndex]?.page;
      if (this.currentPaperId != null && firstPage) setLastMarkedPageNum(this.currentPaperId, this.currentPaperCacheToken, firstPage);
      if (this.filterReturnQid != null) {
        await this.returnToFilterFromNavStack();
      }
      return;
    }

    const payload = {
      sections: this.selectedSectionsForNewQuestion.length > 0 ? this.selectedSectionsForNewQuestion : (section ? [section] : []),
      status: "confirmed",
      notes,
      boxes: boxesPayload,
    };

    this.setStatus("保存题目中…");
    const created = await api(`/papers/${this.currentPaperId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const createdId = Number(created?.question?.id);
    if (Number.isFinite(createdId)) {
      this.pushSavedMarkUndo({
        type: "create",
        paperId: this.currentPaperId,
        questionId: createdId,
        before: null,
        after: clonePersistedQuestionPayload(payload),
      });
    }

    if (this.alignPaperFirstEnabled && this.currentPaperId != null && boxesPayload?.length) {
      this.paperAlignRef = ensurePaperAlignRefFromBoxes(this.paperAlignRef, this.currentPaperId, boxesPayload);
      Settings.savePaperAlignRef(this.currentPaperId, getPaperAlignBounds(this.paperAlignRef, this.currentPaperId));
    }

    this.newBoxes = [];
    this.qNotes = "";
    this.qSectionSelectValue = "";
    this.selectedSectionsForNewQuestion = [];

    this.updateBoxControls();
    this.resetMarkHistory();
    await this.refreshSectionDefsIntoUI();
    await this.refreshPageQuestions();
    if (typeof this.refreshPapers === "function") {
      await this.refreshPapers();
    }
    if (typeof this.invalidateExportFilterCache === "function") {
      this.invalidateExportFilterCache();
    }
    this.drawOverlay();
    this.setStatus("已保存", "ok");

    const firstPage = boxesPayload?.[0]?.page ?? this.pages[this.currentPageIndex]?.page;
    if (this.currentPaperId != null && firstPage) setLastMarkedPageNum(this.currentPaperId, this.currentPaperCacheToken, firstPage);
  },
  clearBoxes() {
    if (this.selectedNewBox) {
      this.deleteSelectedUnsavedBox();
      return;
    }
    if (this.newBoxes.length === 0) {
      this.setStatus("没有可清空的框", "info");
      return;
    }
    const confirmMsg = this.hasOcrDraftMode
      ? `Clear all boxes? This will remove ${this.ocrDraftQuestions.length} questions and ${this.newBoxes.length} boxes.`
      : `Clear all ${this.newBoxes.length} boxes?`;
    if (!confirm(confirmMsg)) {
      this.setStatus("已取消", "info");
      return;
    }
    const snapshot = this.captureMarkSnapshot();
    this.newBoxes = [];
    if (this.hasOcrDraftMode) {
      this.ocrDraftQuestions = [];
      this.selectedOcrDraftIdx = 0;
      if (this.currentPaperId != null) {
        pendingOcrDraftByPaperId.delete(this.currentPaperId);
        pendingOcrDraftSelectedIdxByPaperId.delete(this.currentPaperId);
      }
    }
    this.updateBoxControls();
    this.drawOverlay();
    this.commitMarkHistory(snapshot);
    this.setStatus("已清空", "ok");
  },
  deleteSelectedUnsavedBox() {
    if (!this.selectedNewBox) return;
    const snapshot = this.captureMarkSnapshot();
    const deletedBoxDraftIdx = this.hasOcrDraftMode && this.selectedNewBox.source === "ocr"
      ? Number(this.selectedNewBox.draftIdx)
      : null;

    this.newBoxes = this.newBoxes.filter((x) => x !== this.selectedNewBox);
    this.selectedNewBox = null;
    this.dragNewBoxOp = null;
    this.drawing = false;
    this.startPt = null;

    if (this.editingQuestionId != null && this.newBoxes.length === 0) {
      this.exitEditQuestionMode();
      this.setStatus("已取消修改（已删除所有框）", "info");
    }

    if (this.hasOcrDraftMode && deletedBoxDraftIdx != null && Number.isFinite(deletedBoxDraftIdx)) {
      const remainingBoxCount = this.newBoxes.filter(
        (b) => b && b.source === "ocr" && Number(b.draftIdx) === deletedBoxDraftIdx
      ).length;
      if (remainingBoxCount === 0 && this.ocrDraftQuestions[deletedBoxDraftIdx]) {
        this.ocrDraftQuestions.splice(deletedBoxDraftIdx, 1);
        this.newBoxes = this.newBoxes.filter((b) => b && Number(b.draftIdx) !== deletedBoxDraftIdx);
        this.newBoxes.forEach((b) => {
          if (b && b.source === "ocr" && Number.isFinite(b.draftIdx) && Number(b.draftIdx) > deletedBoxDraftIdx) {
            b.draftIdx -= 1;
          }
        });
        if (this.selectedOcrDraftIdx >= deletedBoxDraftIdx) {
          this.selectedOcrDraftIdx = Math.max(0, this.selectedOcrDraftIdx - 1);
        }
      }
    }
    this.updateBoxControls();
    this.drawOverlay();
    this.commitMarkHistory(snapshot);
  },

  // -------- select section for new question --------
  addSectionFromSelect() {
    const value = this.qSectionSelectValue;
    if (value && !this.selectedSectionsForNewQuestion.includes(value)) {
      this.selectedSectionsForNewQuestion.push(value);
    }
    this.qSectionSelectValue = "";
  },
  removeSelectedSection(section) {
    this.selectedSectionsForNewQuestion = this.selectedSectionsForNewQuestion.filter((s) => s !== section);
  },

  // -------- filter --------
};


