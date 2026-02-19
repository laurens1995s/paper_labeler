import { useAppContext } from "./useAppContext.js";
import { api, setStatus, setStatusSink } from "../../modules/api.js";
import { formatPaperName } from "../helpers.js";

export const useCore = () => {
  return useAppContext();
};

export const coreMethods = {
  initAppShell() {
    setStatusSink(({ text, kind }) => {
      this.statusText = text;
      this.statusKind = kind;
    });

    api("/health").then((h) => {
      if (h && h.time) this.setStatus(`后端正常：${h.time}`, "ok");
    }).catch(() => {});

    this.initSettingsFromStorage();
    if (typeof this.loadFilterPresets === "function") {
      this.loadFilterPresets();
    }
    this.showFilterView();
    this.refreshSectionDefsIntoUI().catch(() => {});
    this.refreshPapers().then(() => {
      if (this.view === "filter") this.runFilter().catch(() => {});
    }).catch(() => {});
    this.setupDrawing();

    window.addEventListener("resize", () => {
      if (this.view === "mark") {
        this.setCanvasSize();
        this.drawOverlay();
      }
    });

    document.addEventListener("keydown", (evt) => {
      const t = evt.target;
      const key = String(evt.key || "").toLowerCase();
      const isMeta = evt.ctrlKey || evt.metaKey;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing) {
        const allowOcrNav = this.view === "mark"
          && this.hasOcrDraftMode
          && (key === "j" || key === "k")
          && t.tagName === "SELECT";
        if (!allowOcrNav) return;
      }
      if (isMeta) {
        if (key === "z" && !evt.shiftKey) {
          evt.preventDefault();
          if (this.view === "mark") this.undoMark();
          if (this.view === "answer") this.undoAnswer();
          return;
        }
        if (key === "y" || (key === "z" && evt.shiftKey)) {
          evt.preventDefault();
          if (this.view === "mark") this.redoMark();
          if (this.view === "answer") this.redoAnswer();
          return;
        }
      }
      if (this.view === "mark") {
        if (key === "j") {
          evt.preventDefault();
          this.gotoPageIndex(this.currentPageIndex + 1).catch(() => {});
        }
        if (key === "k") {
          evt.preventDefault();
          this.gotoPageIndex(this.currentPageIndex - 1).catch(() => {});
        }
        if (key === "delete") this.deleteSelectedUnsavedBox();
      }
      if (this.view === "answer") {
        if (key === "j") this.answerNext().catch(() => {});
        if (key === "k") this.answerPrev().catch(() => {});
        if (key === "delete") this.clearAnswerBoxes();
      }
    });
  },
  setStatus(text, kind = "") {
    setStatus(text, kind);
  },
  formatPaperName(paper) {
    return formatPaperName(paper);
  },
  getQuestionSectionList(q) {
    if (!q) return [];
    if (Array.isArray(q.sections) && q.sections.length) return q.sections;
    if (q.section) return [q.section];
    return [];
  },
  formatQuestionSectionLabel(q) {
    const list = this.getQuestionSectionList(q);
    return list.length ? list.join(" / ") : "(未填模块)";
  },
  msImageUrlForPage(pageNum) {
    const p = (this.msPages || []).find((x) => x.page === pageNum);
    return p ? p.image_url : "";
  },
  // -------- view switching --------
  showMarkView() {
    this.view = "mark";
    this.$nextTick(() => {
      this.setupDrawing();
      this.setCanvasSize();
      this.drawOverlay();
    });
  },
  showFilterView() { this.view = "filter"; },
  showSectionView() { this.view = "section"; },
  showAnswerView() { this.view = "answer"; },
  showAnswerAdminView() { this.view = "answerAdmin"; },
  showSettingsView() { this.view = "settings"; },
  backFromAnswerAdmin() { this.showMarkView(); },
  backFromSettings() { this.showFilterView(); },
  async backFromAnswer() {
    const wasReplace = this.answerReplaceMode;
    const replaceQid = this.answerReplaceQuestionId;
    try {
      const q = this.answerQuestions?.[this.answerQIndex];
      if (q) this.recordAnswerScrollProgress(q);
    } catch {}
  
    this.msPaperId = null;
    this.msPages = [];
    this.msCanvasByPage = new Map();
    this.currentMsPaperName = "";
    this.currentMsCacheToken = null;
    this.answerQuestions = [];
    this.answerQIndex = -1;
    this.answerExistingBoxes = [];
    this.answerNewBoxes = [];
    this.answerDrawing = null;
    this.selectedAnswerNew = null;
    this.dragAnswerOp = null;
    this.answerReplaceMode = false;
    this.answerReplaceQuestionId = null;
    this.answerAlignRef = null;
    this.answerJumpMsPageInput = "";
    if (this.resetAnswerHistory) this.resetAnswerHistory();

    if (wasReplace && replaceQid != null) {
      const restored = await this.returnToFilterFromNavStack();
      if (!restored) {
        this.showFilterView();
        await this.$nextTick();
        if (this.scrollToFilterQuestion) this.scrollToFilterQuestion(replaceQid);
      }
    } else {
      this.showMarkView();
    }
  },
  async backToPrev() {
    await this.returnToFilterFromNavStack();
  },
  
  // -------- stats --------
};
