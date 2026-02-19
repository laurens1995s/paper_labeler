import { useAppContext } from "./useAppContext.js";
import { api } from "../api.js";
import { removeAdText } from "../helpers.js";
import { clampInt } from "../../modules/utils.js";
import {
  pendingOcrBoxesByPaperId,
  pendingOcrDraftByPaperId,
  pendingOcrWarningByPaperId,
} from "../store.js";

export const useCieImport = () => {
  return useAppContext();
};

export const cieImportMethods = {
  async ensureCieSubjectComboList() {
    if (this.cieSubjectComboList.length > 0) return this.cieSubjectComboList;
    try {
      const data = await api("/cie_import/subject_combo", { method: "GET" });
      if (Array.isArray(data)) this.cieSubjectComboList = data;
      return this.cieSubjectComboList;
    } catch {
      return [];
    }
  },
  async updateCieSubjectName() {
    const subjectCode = String(this.cieSubjectInput || "").trim();
    if (!subjectCode) {
      this.cieSubjectName = "";
      this.cieSubjectNameKind = "";
      return;
    }
    const list = await this.ensureCieSubjectComboList();
    const matched = list.find((item) => String(item?.value || "").trim() === subjectCode);
    if (matched) {
      this.cieSubjectName = removeAdText(matched.text);
      this.cieSubjectNameKind = "ok";
    } else {
      this.cieSubjectName = "未找到匹配科目";
      this.cieSubjectNameKind = "err";
    }
  },
  openCieImportModal() {
    this.cieImportOpen = true;
  },
  closeCieImportModal() {
    this.cieImportOpen = false;
  },
  async fetchCiePapers() {
    const subject = String(this.cieSubjectInput || "").trim();
    const year = String(this.cieYearInput || "").trim();
    const season = this.cieSeason;
    if (!subject) {
      this.cieImportStatus = "请输入科目代码（如 9709）";
      return;
    }
    if (!year || !/^\d{4}$/.test(year)) {
      this.cieImportStatus = "请输入有效的年份（如 2023）";
      return;
    }
    this.cieLoading = true;
    this.cieImportStatus = "正在查询试卷列表...";
    try {
      const payload = { subject, year, season };
      const data = await api("/cie_import/fetch_papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (data.success && data.papers) {
        this.ciePaperListData = data.papers;
        await this.buildCiePaperGroups();
        this.cieSelectedIds = new Set();
        this.cieImportStatus = `查询成功，共 ${data.total} 份试卷`;
      } else {
        this.ciePaperListData = [];
        this.ciePaperGroups = [];
        this.ciePaperUnpaired = [];
        this.cieSelectedIds = new Set();
        this.cieImportStatus = "未找到试卷";
      }
    } catch (e) {
      this.ciePaperListData = [];
      this.ciePaperGroups = [];
      this.ciePaperUnpaired = [];
      this.cieSelectedIds = new Set();
      this.cieImportStatus = `查询失败：${String(e)}`;
    } finally {
      this.cieLoading = false;
    }
  },
  async buildCiePaperGroups() {
    const localFilenames = new Set(this.allPaperFilenames || []);
    const localPapersByFilename = new Map();
    this.papers.forEach((p) => { if (p.filename) localPapersByFilename.set(p.filename, p); });
    try {
      const ansData = await api("/answer_papers");
      if (ansData && ansData.papers) {
        ansData.papers.forEach((p) => { if (p.filename) localPapersByFilename.set(p.filename, p); });
      }
    } catch {}

    const paperGroups = new Map();
    const unpaired = [];
    const paperByFilename = new Map();

    this.ciePaperListData.forEach((paper, idx) => {
      paper.originalIdx = idx;
      paper.existsLocally = localFilenames.has(paper.filename);
      paper.exists = paper.existsLocally;
      paperByFilename.set(paper.filename, paper);

      if (paper.filename.includes("_qp_")) {
        const baseName = paper.filename.replace("_qp_", "_");
        if (!paperGroups.has(baseName)) paperGroups.set(baseName, { baseName, qp: null, ms: null });
        const localPaper = localPapersByFilename.get(paper.filename);
        paper.kind = "qp";
        paper.done = !!localPaper?.done;
        paperGroups.get(baseName).qp = paper;
      } else if (paper.filename.includes("_ms_")) {
        const baseName = paper.filename.replace("_ms_", "_");
        if (!paperGroups.has(baseName)) paperGroups.set(baseName, { baseName, qp: null, ms: null });
        const localPaper = localPapersByFilename.get(paper.filename);
        let done = false;
        if (localPaper) {
          if (localPaper.done) {
            done = true;
          } else if (
            localPaper.answers_marked != null &&
            localPaper.question_count != null &&
            localPaper.answers_marked > 0 &&
            localPaper.answers_marked === localPaper.question_count
          ) {
            done = true;
          }
        }
        paper.kind = "ms";
        paper.done = done;
        paperGroups.get(baseName).ms = paper;
      } else {
        paper.kind = "other";
        paper.done = false;
        unpaired.push(paper);
      }
    });

    const groups = Array.from(paperGroups.values()).sort((a, b) => a.baseName.localeCompare(b.baseName));
    this.ciePaperGroups = groups;
    this.ciePaperUnpaired = unpaired;
    this.ciePaperByFilename = paperByFilename;
    this.ciePaperCountText = `找到 ${this.ciePaperListData.length} 份试卷`;
  },
  toggleCieSelection(paper, selected) {
    if (!paper) return;
    const next = new Set(this.cieSelectedIds);
    const shouldSelect = selected != null ? !!selected : !next.has(paper.originalIdx);
    if (shouldSelect) next.add(paper.originalIdx);
    else next.delete(paper.originalIdx);

    if (paper.filename && paper.filename.includes("_qp_")) {
      const msFilename = paper.filename.replace("_qp_", "_ms_");
      const msPaper = this.ciePaperByFilename?.get(msFilename)
        || (this.ciePaperListData || []).find((p) => p.filename === msFilename);
      if (msPaper && msPaper.originalIdx != null) {
        if (shouldSelect) next.add(msPaper.originalIdx);
        else next.delete(msPaper.originalIdx);
      }
    }

    this.cieSelectedIds = next;
  },
  cieSelectAll() {
    const next = new Set();
    this.ciePaperListData.forEach((p) => next.add(p.originalIdx));
    this.cieSelectedIds = next;
  },
  cieDeselectAll() {
    this.cieSelectedIds = new Set();
  },
  async startCieBatchImportFromList() {
    const selected = Array.from(this.cieSelectedIds).map((idx) => this.ciePaperListData[idx]).filter(Boolean);
    if (!selected.length) {
      alert("请至少选择一份试卷");
      return;
    }
    this.cieLoading = true;
    this.cieImportStatus = `正在导入 ${selected.length} 份试卷...`;
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < selected.length; i++) {
      const paper = selected[i];
      this.cieImportStatus = `导入中 ${i + 1}/${selected.length}: ${paper.filename}`;
      try {
        const payload = {
          url: paper.url,
          ocr_auto: this.ocrAutoEnabled,
          ocr_min_height_px: clampInt(this.ocrMinHeightPx, 0, 2000),
          ocr_y_padding_px: clampInt(this.ocrYPaddingPx, 0, 500),
        };
        const data = await api("/cie_import/from_url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const importedPaper = data.paper;
        const paperId = importedPaper && importedPaper.id;
        if (data.ocr_warning && paperId != null) pendingOcrWarningByPaperId.set(paperId, String(data.ocr_warning));
        if (paperId != null && Array.isArray(data.ocr_questions) && data.ocr_questions.length) {
          pendingOcrDraftByPaperId.set(paperId, data.ocr_questions);
        } else if (paperId != null && Array.isArray(data.ocr_boxes) && data.ocr_boxes.length) {
          pendingOcrBoxesByPaperId.set(paperId, data.ocr_boxes);
        }
        successCount++;
      } catch {
        failCount++;
      }
    }
    this.cieImportStatus = `导入完成：成功 ${successCount}，失败 ${failCount}`;
    this.cieLoading = false;
    await this.refreshPapers();
    if (successCount > 0 && failCount === 0) {
      this.closeCieImportModal();
    }
  },
};
