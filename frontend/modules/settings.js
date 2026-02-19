import { clampInt, clamp01 } from './utils.js';

// Settings state (initialized with defaults)
export let alignLeftEnabled = true; // default: on
export let alignPaperFirstEnabled = false; // default: off
export let answerAlignEnabled = true; // default: on
export let ocrAutoEnabled = false; // default: off
export let ocrMinHeightPx = 70;
export let ocrYPaddingPx = 12;
export let filterVirtualThreshold = 24;
export let filterVirtualOverscanPx = 900;
export let exportDefaultSaveDir = "";
export const DEFAULT_EXPORT_NAME_TEMPLATE = "{mode}_{section}_{paper}_{year}_{season}_{count}";
export let exportNameTemplate = DEFAULT_EXPORT_NAME_TEMPLATE;
export let exportNamePrefix = "";
export let exportNameSuffix = "";
export let exportNameCustom = "";
export let exportNameAutoTimestamp = true;
export let exportNameSectionStyle = "display"; // display | raw
export let exportSeqDate = "";
export let exportSeqNum = 0;
export let exportCropWorkers = 0; // 0 = auto
export let exportWizardOptions = {
  includeQno: true,
  includeSection: true,
  includePaper: true,
  includeOriginalQno: false,
  includeNotes: false,
  includeAnswers: false,
  ansPlacement: "end",
  includeFilterSummary: false,
  summaryFieldSection: true,
  summaryFieldPaper: true,
  summaryFieldYear: true,
  summaryFieldSeason: true,
  summaryFieldFavorites: true,
  summaryFieldCount: true,
};

// --- Loaders ---

export function loadAlignLeftSetting() {
  try {
    const v = localStorage.getItem("setting:alignLeftEnabled");
    if (v == null) return;
    alignLeftEnabled = v === "1" || v === "true";
  } catch {}
  return alignLeftEnabled;
}

export function loadAlignPaperFirstSetting() {
  try {
    const v = localStorage.getItem("setting:alignPaperFirstEnabled");
    if (v == null) return;
    alignPaperFirstEnabled = v === "1" || v === "true";
  } catch {}
  return alignPaperFirstEnabled;
}

export function loadAnswerAlignSetting() {
  try {
    const v = localStorage.getItem("setting:answerAlignEnabled");
    if (v == null) return;
    answerAlignEnabled = v === "1" || v === "true";
  } catch {}
  return answerAlignEnabled;
}

export function loadOcrAutoSetting() {
  try {
    const v = localStorage.getItem("setting:ocrAutoEnabled");
    if (v == null) return;
    ocrAutoEnabled = v === "1" || v === "true";
  } catch {}
  return ocrAutoEnabled;
}

export function loadOcrBoxTuningSettings() {
  try {
    const mh = localStorage.getItem("setting:ocrMinHeightPx");
    if (mh != null) ocrMinHeightPx = clampInt(mh, 0, 2000);
  } catch {}
  try {
    const pad = localStorage.getItem("setting:ocrYPaddingPx");
    if (pad != null) ocrYPaddingPx = clampInt(pad, 0, 500);
  } catch {}
  return { ocrMinHeightPx, ocrYPaddingPx };
}

export function loadPaperAlignRef() {
  try {
    const raw = localStorage.getItem("setting:paperAlignRef");
    if (raw) {
      return JSON.parse(raw) || {};
    }
  } catch {}
  return {};
}

export function loadFilterPageSize() {
  try {
    const s = localStorage.getItem("setting:filterPageSize");
    if (s && /^\d+$/.test(s)) {
        return clampInt(s, 5, 200);
    }
  } catch {}
  return null;
}

export function loadFilterVirtualSettings() {
  try {
    const t = localStorage.getItem("setting:filterVirtualThreshold");
    if (t != null) filterVirtualThreshold = clampInt(t, 1, 200);
  } catch {}
  try {
    const o = localStorage.getItem("setting:filterVirtualOverscanPx");
    if (o != null) filterVirtualOverscanPx = clampInt(o, 0, 5000);
  } catch {}
  return { filterVirtualThreshold, filterVirtualOverscanPx };
}

export function loadExportDefaultSaveDir() {
  try {
    const v = localStorage.getItem("setting:exportDefaultSaveDir");
    exportDefaultSaveDir = String(v || "").trim();
  } catch {
    exportDefaultSaveDir = "";
  }
  return exportDefaultSaveDir;
}

function _normalizeExportNameSectionStyle(v) {
  const style = String(v || "").trim().toLowerCase();
  return style === "raw" ? "raw" : "display";
}

export function loadExportNameSettings() {
  try {
    const v = localStorage.getItem("setting:exportNameTemplate");
    exportNameTemplate = String(v || "").trim() || DEFAULT_EXPORT_NAME_TEMPLATE;
  } catch {
    exportNameTemplate = DEFAULT_EXPORT_NAME_TEMPLATE;
  }
  try {
    const v = localStorage.getItem("setting:exportNamePrefix");
    exportNamePrefix = String(v || "").trim();
  } catch {
    exportNamePrefix = "";
  }
  try {
    const v = localStorage.getItem("setting:exportNameSuffix");
    exportNameSuffix = String(v || "").trim();
  } catch {
    exportNameSuffix = "";
  }
  try {
    const v = localStorage.getItem("setting:exportNameCustom");
    exportNameCustom = String(v || "").trim();
  } catch {
    exportNameCustom = "";
  }
  try {
    const v = localStorage.getItem("setting:exportNameAutoTimestamp");
    exportNameAutoTimestamp = v == null ? true : (v === "1" || v === "true");
  } catch {
    exportNameAutoTimestamp = true;
  }
  try {
    const v = localStorage.getItem("setting:exportNameSectionStyle");
    exportNameSectionStyle = _normalizeExportNameSectionStyle(v);
  } catch {
    exportNameSectionStyle = "display";
  }
  try {
    const v = localStorage.getItem("setting:exportCropWorkers");
    exportCropWorkers = clampInt(v == null ? "0" : v, 0, 32);
  } catch {
    exportCropWorkers = 0;
  }
  return {
    exportNameTemplate,
    exportNamePrefix,
    exportNameSuffix,
    exportNameCustom,
    exportNameAutoTimestamp,
    exportNameSectionStyle,
    exportCropWorkers,
  };
}

export function loadExportWizardOptions() {
  const next = { ...exportWizardOptions };
  try {
    const raw = localStorage.getItem("setting:exportWizardOptions");
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      next.includeQno = parsed.includeQno !== false;
      next.includeSection = parsed.includeSection !== false;
      next.includePaper = parsed.includePaper !== false;
      next.includeOriginalQno = !!parsed.includeOriginalQno;
      next.includeNotes = !!parsed.includeNotes;
      next.includeAnswers = !!parsed.includeAnswers;
      next.ansPlacement = parsed.ansPlacement === "interleaved" ? "interleaved" : "end";
      next.includeFilterSummary = !!parsed.includeFilterSummary;
      next.summaryFieldSection = parsed.summaryFieldSection !== false;
      next.summaryFieldPaper = parsed.summaryFieldPaper !== false;
      next.summaryFieldYear = parsed.summaryFieldYear !== false;
      next.summaryFieldSeason = parsed.summaryFieldSeason !== false;
      next.summaryFieldFavorites = parsed.summaryFieldFavorites !== false;
      next.summaryFieldCount = parsed.summaryFieldCount !== false;
    }
  } catch {}
  exportWizardOptions = next;
  return { ...exportWizardOptions };
}

export function loadExportSeqState() {
  try {
    exportSeqDate = String(localStorage.getItem("setting:exportSeqDate") || "").trim();
  } catch {
    exportSeqDate = "";
  }
  try {
    exportSeqNum = clampInt(localStorage.getItem("setting:exportSeqNum") || "0", 0, 999999);
  } catch {
    exportSeqNum = 0;
  }
  return { exportSeqDate, exportSeqNum };
}

function _answerAlignRefKey(qpId, msId) {
  if (qpId == null || msId == null) return null;
  return `answerAlignRef:${String(qpId)}:${String(msId)}`;
}

export function loadAnswerAlignRef(qpId, msId) {
  const key = _answerAlignRefKey(qpId, msId);
  if (!key) return;
  try {
    const raw = localStorage.getItem(`setting:${key}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const x0 = parsed?.[0];
    const x1 = parsed?.[1];
    if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) return;
    return [clamp01(Math.min(x0, x1)), clamp01(Math.max(x0, x1))];
  } catch {}
  return null;
}

// --- Savers ---

export function saveAlignLeftSetting(v) {
  alignLeftEnabled = !!v;
  // mutual exclusion: enabling this disables per-paper alignment
  if (alignLeftEnabled) {
    alignPaperFirstEnabled = false;
    try {
      localStorage.setItem("setting:alignPaperFirstEnabled", "0");
    } catch {}
  }
  try {
    localStorage.setItem("setting:alignLeftEnabled", alignLeftEnabled ? "1" : "0");
  } catch {}
  return alignLeftEnabled;
}

export function saveAlignPaperFirstSetting(v) {
  alignPaperFirstEnabled = !!v;
  // mutual exclusion: enabling this disables per-question multi-box alignment (alignLeft)
  if (alignPaperFirstEnabled) {
    alignLeftEnabled = false;
    try {
      localStorage.setItem("setting:alignLeftEnabled", "0");
    } catch {}
  }
  try {
    localStorage.setItem("setting:alignPaperFirstEnabled", alignPaperFirstEnabled ? "1" : "0");
  } catch {}
  return alignPaperFirstEnabled;
}

export function saveAnswerAlignSetting(v) {
  answerAlignEnabled = !!v;
  try {
    localStorage.setItem("setting:answerAlignEnabled", answerAlignEnabled ? "1" : "0");
  } catch {}
  return answerAlignEnabled;
}

export function saveOcrAutoSetting(v) {
  ocrAutoEnabled = !!v;
  try {
    localStorage.setItem("setting:ocrAutoEnabled", ocrAutoEnabled ? "1" : "0");
  } catch {}
  return ocrAutoEnabled;
}

export function saveOcrMinHeightPx(v) {
  ocrMinHeightPx = clampInt(v, 0, 2000);
  try {
    localStorage.setItem("setting:ocrMinHeightPx", String(ocrMinHeightPx));
  } catch {}
  return ocrMinHeightPx;
}

export function saveOcrYPaddingPx(v) {
  ocrYPaddingPx = clampInt(v, 0, 500);
  try {
    localStorage.setItem("setting:ocrYPaddingPx", String(ocrYPaddingPx));
  } catch {}
  return ocrYPaddingPx;
}

export function savePaperAlignRef(paperId, bounds) {
  let dict = {};
  try {
    const raw = localStorage.getItem("setting:paperAlignRef");
    dict = raw ? JSON.parse(raw) : {};
    if (!bounds) {
      delete dict[paperId];
    } else {
      dict[paperId] = bounds;
    }
    localStorage.setItem("setting:paperAlignRef", JSON.stringify(dict));
  } catch {}
  return dict;
}

export function saveAnswerAlignRef(qpId, msId, bounds) {
  const key = _answerAlignRefKey(qpId, msId);
  if (!key) return;
  if (!bounds || bounds.length !== 2) return;
  const x0 = bounds?.[0];
  const x1 = bounds?.[1];
  if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) return;
  
  const val = [clamp01(Math.min(x0, x1)), clamp01(Math.max(x0, x1))];
  try {
    localStorage.setItem(`setting:${key}`, JSON.stringify(val));
  } catch {}
  return val;
}

export function saveFilterPageSize(size) {
    try {
        localStorage.setItem("setting:filterPageSize", String(size));
    } catch {}
}

export function saveFilterVirtualThreshold(v) {
  filterVirtualThreshold = clampInt(v, 1, 200);
  try {
    localStorage.setItem("setting:filterVirtualThreshold", String(filterVirtualThreshold));
  } catch {}
  return filterVirtualThreshold;
}

export function saveFilterVirtualOverscanPx(v) {
  filterVirtualOverscanPx = clampInt(v, 0, 5000);
  try {
    localStorage.setItem("setting:filterVirtualOverscanPx", String(filterVirtualOverscanPx));
  } catch {}
  return filterVirtualOverscanPx;
}

export function saveExportDefaultSaveDir(v) {
  exportDefaultSaveDir = String(v || "").trim();
  try {
    if (exportDefaultSaveDir) localStorage.setItem("setting:exportDefaultSaveDir", exportDefaultSaveDir);
    else localStorage.removeItem("setting:exportDefaultSaveDir");
  } catch {}
  return exportDefaultSaveDir;
}

export function saveExportNameTemplate(v) {
  exportNameTemplate = String(v || "").trim() || DEFAULT_EXPORT_NAME_TEMPLATE;
  try {
    localStorage.setItem("setting:exportNameTemplate", exportNameTemplate);
  } catch {}
  return exportNameTemplate;
}

export function saveExportNamePrefix(v) {
  exportNamePrefix = String(v || "").trim();
  try {
    if (exportNamePrefix) localStorage.setItem("setting:exportNamePrefix", exportNamePrefix);
    else localStorage.removeItem("setting:exportNamePrefix");
  } catch {}
  return exportNamePrefix;
}

export function saveExportNameSuffix(v) {
  exportNameSuffix = String(v || "").trim();
  try {
    if (exportNameSuffix) localStorage.setItem("setting:exportNameSuffix", exportNameSuffix);
    else localStorage.removeItem("setting:exportNameSuffix");
  } catch {}
  return exportNameSuffix;
}

export function saveExportNameCustom(v) {
  exportNameCustom = String(v || "").trim();
  try {
    if (exportNameCustom) localStorage.setItem("setting:exportNameCustom", exportNameCustom);
    else localStorage.removeItem("setting:exportNameCustom");
  } catch {}
  return exportNameCustom;
}

export function saveExportNameAutoTimestamp(v) {
  exportNameAutoTimestamp = !!v;
  try {
    localStorage.setItem("setting:exportNameAutoTimestamp", exportNameAutoTimestamp ? "1" : "0");
  } catch {}
  return exportNameAutoTimestamp;
}

export function saveExportNameSectionStyle(v) {
  exportNameSectionStyle = _normalizeExportNameSectionStyle(v);
  try {
    localStorage.setItem("setting:exportNameSectionStyle", exportNameSectionStyle);
  } catch {}
  return exportNameSectionStyle;
}

export function saveExportCropWorkers(v) {
  exportCropWorkers = clampInt(v, 0, 32);
  try {
    localStorage.setItem("setting:exportCropWorkers", String(exportCropWorkers));
  } catch {}
  return exportCropWorkers;
}

export function saveExportWizardOptions(v) {
  const next = {
    includeQno: v?.includeQno !== false,
    includeSection: v?.includeSection !== false,
    includePaper: v?.includePaper !== false,
    includeOriginalQno: !!v?.includeOriginalQno,
    includeNotes: !!v?.includeNotes,
    includeAnswers: !!v?.includeAnswers,
    ansPlacement: v?.ansPlacement === "interleaved" ? "interleaved" : "end",
    includeFilterSummary: !!v?.includeFilterSummary,
    summaryFieldSection: v?.summaryFieldSection !== false,
    summaryFieldPaper: v?.summaryFieldPaper !== false,
    summaryFieldYear: v?.summaryFieldYear !== false,
    summaryFieldSeason: v?.summaryFieldSeason !== false,
    summaryFieldFavorites: v?.summaryFieldFavorites !== false,
    summaryFieldCount: v?.summaryFieldCount !== false,
  };
  exportWizardOptions = next;
  try {
    localStorage.setItem("setting:exportWizardOptions", JSON.stringify(next));
  } catch {}
  return { ...next };
}

export function saveExportSeqState(date, num) {
  exportSeqDate = String(date || "").trim();
  exportSeqNum = clampInt(num, 0, 999999);
  try {
    if (exportSeqDate) localStorage.setItem("setting:exportSeqDate", exportSeqDate);
    else localStorage.removeItem("setting:exportSeqDate");
  } catch {}
  try {
    localStorage.setItem("setting:exportSeqNum", String(exportSeqNum));
  } catch {}
  return { exportSeqDate, exportSeqNum };
}
