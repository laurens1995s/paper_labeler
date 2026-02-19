import { useAppContext } from "./useAppContext.js";
import { api } from "../../modules/api.js";
import { clampInt } from "../../modules/utils.js";
import {
  extractCacheBustToken,
  getLastMarkedPageNum,
  setLastMarkedPageNum,
  formatPaperName,
} from "../helpers.js";
import {
  pendingOcrBoxesByPaperId,
  pendingOcrDraftByPaperId,
  pendingOcrWarningByPaperId,
  pendingOcrDraftSelectedIdxByPaperId,
} from "../store.js";

export const usePapers = () => {
  return useAppContext();
};

export const paperMethods = {
  async refreshStats() {
    try {
      const d = await api("/stats");
      const maxNum =
        typeof d.max_question_no_numeric === "number" && Number.isFinite(d.max_question_no_numeric)
          ? d.max_question_no_numeric
          : 0;
      this.globalSuggestedNextNo = Math.max(1, Math.floor(maxNum) + 1);
      this.statsText = `试题卷：${d.qp_papers ?? 0} · 答案卷：${d.answer_papers ?? 0} · 已分类题目：${d.classified_questions ?? 0}`;
    } catch {
      this.statsText = "";
    }
  },
  
  // -------- paper list --------
  async refreshPapers() {
    this.setStatus("加载试卷列表…");
    try {
      const data = await api("/papers");
      this.papers = Array.isArray(data.papers) ? data.papers : [];
      try {
        const filenameData = await api("/papers/filenames");
        this.allPaperFilenames = filenameData.filenames || [];
      } catch {
        this.allPaperFilenames = [];
      }
      this.setStatus(`试卷数：${this.papers.length}`, "ok");
      await this.refreshStats();
    } catch (e) {
      this.setStatus("列表加载失败: " + String(e), "err");
      this.papers = [];
      this.allPaperFilenames = [];
    }
  },
  toggleShowDonePapers() {
    this.showDonePapers = !this.showDonePapers;
  },
  async togglePaperDone(p, evt) {
    evt?.stopPropagation?.();
    const checked = !p.done;
    try {
      this.setStatus(`更新试卷 #${p.id}…`);
      await api(`/papers/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: checked }),
      });
      p.done = checked;
      this.setStatus("已更新", "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async deletePaper(p, evt) {
    evt?.stopPropagation?.();
    if (!confirm(`确认删除整卷 #${p.id}？`)) return;
    const confirmText = prompt(
      `危险操作：将删除该试卷的 PDF、渲染图片、所有题目框选/草稿。\n请输入 ${p.id} 以确认：`,
      ""
    );
    if (String(confirmText || "").trim() !== String(p.id)) return;
    try {
      this.setStatus(`删除整卷 #${p.id}…`);
      await api(`/papers/${p.id}`, { method: "DELETE" });
      this.setStatus("已删除", "ok");
      if (this.currentPaperId === p.id) this.resetPaperState();
      await this.refreshPapers();
      if (this.view === "filter") this.runFilter().catch(() => {});
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  
  // -------- paper open --------
  resetPaperState() {
    this.exitEditQuestionMode();
    this.currentPaperId = null;
    this.currentQpPaperName = "";
    this.currentMsPaperName = "";
    this.currentPaperCacheToken = null;
    this.currentMsCacheToken = null;
    this.pages = [];
    this.currentPageIndex = -1;
    this.pageQuestions = [];
    this.newBoxes = [];
    this.selectedNewBox = null;
    this.suggestedNextNo = null;
    this.qNotes = "";
    if (this.resetMarkHistory) this.resetMarkHistory();
  },
  async openPaper(paperId) {
    this.showMarkView();
  
    if (this.currentPaperId != null && this.currentPaperId !== paperId) {
      this.stashCurrentOcrDraftStateForPaper(this.currentPaperId);
      await this.refreshPapers();
    }
  
    this.currentPaperId = paperId;
    this.exitEditQuestionMode();
    const paper = await api(`/papers/${paperId}`);
    this.currentPaperCacheToken = extractCacheBustToken(paper?.pdf_url);
    this.currentQpPaperName = formatPaperName(paper);
  
    const pagesData = await api(`/papers/${paperId}/pages`);
    this.pages = pagesData.pages || [];
  
    this.ocrDraftQuestions = [];
    this.selectedOcrDraftIdx = 0;
    this.newBoxes = [];
    this.selectedNewBox = null;
    if (this.resetMarkHistory) this.resetMarkHistory();
  
    if (pendingOcrDraftByPaperId.has(paperId)) {
      const drafts = pendingOcrDraftByPaperId.get(paperId) || [];
      if (Array.isArray(drafts) && drafts.length) {
        const validDrafts = drafts.filter((d) => d != null);
        this.ocrDraftQuestions = validDrafts
          .map((q) => ({
            label: String(q?.label ?? "?").trim() || "?",
            sections: Array.isArray(q?.sections) ? q.sections : (q?.section ? [q.section] : []),
          }))
          .filter((q) => q && q.label);
  
        if (pendingOcrDraftSelectedIdxByPaperId.has(paperId)) {
          this.selectedOcrDraftIdx = clampInt(
            pendingOcrDraftSelectedIdxByPaperId.get(paperId),
            0,
            Math.max(0, this.ocrDraftQuestions.length - 1)
          );
        }
  
        const flat = [];
        this.ocrDraftQuestions.forEach((q, draftIdx) => {
          if (!q || !validDrafts[draftIdx]) return;
          const boxes = (validDrafts[draftIdx]?.boxes || []).map((b) => ({
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
        this.selectedNewBox = this.newBoxes.length ? this.newBoxes[0] : null;
        const preferred = this.newBoxes.find((b) => b && b.source === "ocr" && Number(b.draftIdx) === Number(this.selectedOcrDraftIdx));
        if (preferred) this.selectedNewBox = preferred;
  
        const firstPage = this.selectedNewBox ? this.selectedNewBox.page : null;
        if (firstPage != null && this.pages.length) {
          const idx = this.pages.findIndex((p) => p.page === firstPage);
          if (idx >= 0) this.currentPageIndex = idx;
        }
        this.setStatus(`已自动识别 ${this.ocrDraftQuestions.length} 题 / ${this.newBoxes.length} 框（未保存，请检查后再保存）`, "ok");
      }
    } else if (pendingOcrBoxesByPaperId.has(paperId)) {
      const ocrBoxes = pendingOcrBoxesByPaperId.get(paperId) || [];
      pendingOcrBoxesByPaperId.delete(paperId);
      if (Array.isArray(ocrBoxes) && ocrBoxes.length) {
        this.newBoxes = ocrBoxes
          .map((b) => ({ page: Number(b.page), bbox: Array.from(b.bbox || []), source: "ocr", label: b?.label ?? null }))
          .filter((b) => Number.isFinite(b.page) && Array.isArray(b.bbox) && b.bbox.length === 4);
        this.selectedNewBox = this.newBoxes.length ? this.newBoxes[0] : null;
        const firstPage = this.selectedNewBox ? this.selectedNewBox.page : null;
        if (firstPage != null && this.pages.length) {
          const idx = this.pages.findIndex((p) => p.page === firstPage);
          if (idx >= 0) this.currentPageIndex = idx;
        }
        this.setStatus(`已生成 ${this.newBoxes.length} 个建议框（未保存，请检查后再保存）`, "ok");
      }
    }
  
    if (pendingOcrWarningByPaperId.has(paperId)) {
      const w = pendingOcrWarningByPaperId.get(paperId);
      pendingOcrWarningByPaperId.delete(paperId);
      if (w) this.setStatus(String(w), "err");
    }
  
    const lastPageNum = getLastMarkedPageNum(paperId, this.currentPaperCacheToken);
    if (this.pages.length && lastPageNum != null) {
      const idx = this.pages.findIndex((p) => p.page === lastPageNum);
      this.currentPageIndex = idx >= 0 ? idx : 0;
    } else {
      this.currentPageIndex = this.pages.length ? 0 : -1;
    }
  
    if (this.currentPageIndex >= 0) await this.loadCurrentPage();
    await this.refreshSuggestedNextNo();
    await this.refreshSectionDefsIntoUI();
    await this.ensurePaperAlignRefFromFirstQuestion(paperId);
    if (this.resetMarkHistory) this.resetMarkHistory();
  },
  
  // -------- page navigation --------
  async gotoPageIndex(idx) {
    if (idx < 0 || idx >= this.pages.length) return;
    this.currentPageIndex = idx;
    await this.loadCurrentPage();
    this.updateBoxControls();
    this.drawOverlay();
    if (this.currentPaperId != null) setLastMarkedPageNum(this.currentPaperId, this.currentPaperCacheToken, this.pages[idx].page);
  },
  async jumpToMarkPageFromUI() {
    if (!this.pages.length) return;
    const n = clampInt(this.markJumpPageInput, 1, this.pages.length);
    await this.gotoPageIndex(n - 1);
  },
  async loadCurrentPage() {
    if (this.currentPageIndex < 0) return;
    await this.refreshPageQuestions();
    this.$nextTick(() => this.drawOverlay());
  },
  
  // -------- question list --------
  async refreshPageQuestions() {
    if (!this.currentPaperId || this.currentPageIndex < 0) return;
    const pageNum = this.pages[this.currentPageIndex].page;
    const data = await api(`/papers/${this.currentPaperId}/questions?page=${pageNum}`);
    this.pageQuestions = data.questions || [];
  },
  async manualRefreshPageQuestions() {
    await this.refreshPageQuestions();
    this.drawOverlay();
  },
  async refreshSuggestedNextNo() {
    if (!this.currentPaperId) return;
    try {
      const data = await api(`/papers/${this.currentPaperId}/questions`);
      const qs = data.questions || [];
      let maxNo = 0;
      for (const q of qs) {
        if (q.question_no == null) continue;
        const s = String(q.question_no).trim();
        if (!/^\d+$/.test(s)) continue;
        const n = parseInt(s, 10);
        if (!Number.isNaN(n)) maxNo = Math.max(maxNo, n);
      }
      const paperNext = maxNo + 1;
      const globalNext = this.globalSuggestedNextNo != null ? this.globalSuggestedNextNo : 1;
      this.suggestedNextNo = Math.max(paperNext, globalNext);
    } catch {
      // ignore
    }
  },
  
  // -------- section defs --------
  async uploadSelectedFiles(evt) {
    const files = evt?.target?.files || this.$refs.uploadInput?.files || [];
    if (!files.length) return;
    const maxSize = 100 * 1024 * 1024;
    for (const f of files) {
      if (f.size > maxSize) {
        this.setStatus("存在超过 100MB 的文件", "err");
        this.uploadStatus = "存在超过 100MB 的文件";
        return;
      }
    }
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    this.uploading = true;
    this.setStatus("上传中…");
    this.uploadStatus = "上传中…";
    try {
      const data = await api("/upload_pdfs", { method: "POST", body: fd });
      const warnings = data?.warnings || [];
      if (warnings.length) {
        if (warnings[0]?.warning) this.setStatus(String(warnings[0].warning), "err");
        else this.setStatus(`上传完成，但有 ${warnings.length} 个文件自动识别被跳过/有提示（打开对应试卷可查看原因）`, "err");
        this.uploadStatus = warnings[0]?.warning || `上传完成，但有 ${warnings.length} 个文件自动识别被跳过/有提示`;
      } else {
        this.setStatus("上传完成", "ok");
        this.uploadStatus = "上传完成";
      }
      await this.refreshPapers();
      if (data?.papers?.length) {
        const last = data.papers[data.papers.length - 1];
        if (last?.id) await this.openPaper(last.id);
      }
    } catch (e) {
      this.setStatus(String(e), "err");
      this.uploadStatus = String(e);
    } finally {
      this.uploading = false;
      if (evt?.target) evt.target.value = "";
    }
  },
  // -------- misc --------
};
