import { clampInt, clamp01 } from "../../modules/utils.js";

export const loadAlignLeftSetting = (state) => {
  try {
    const v = localStorage.getItem("setting:alignLeftEnabled");
    if (v == null) return;
    state.alignLeftEnabled = v === "1" || v === "true";
  } catch {}
};

export const loadAlignPaperFirstSetting = (state) => {
  try {
    const v = localStorage.getItem("setting:alignPaperFirstEnabled");
    if (v == null) return;
    state.alignPaperFirstEnabled = v === "1" || v === "true";
  } catch {}
};

export const loadAnswerAlignSetting = (state) => {
  try {
    const v = localStorage.getItem("setting:answerAlignEnabled");
    if (v == null) return;
    state.answerAlignEnabled = v === "1" || v === "true";
  } catch {}
};

export const loadOcrAutoSetting = (state) => {
  try {
    const v = localStorage.getItem("setting:ocrAutoEnabled");
    if (v == null) return;
    state.ocrAutoEnabled = v === "1" || v === "true";
  } catch {}
};

export const loadOcrBoxTuningSettings = (state) => {
  try {
    const mh = localStorage.getItem("setting:ocrMinHeightPx");
    if (mh != null) state.ocrMinHeightPx = clampInt(mh, 0, 2000);
  } catch {}
  try {
    const pad = localStorage.getItem("setting:ocrYPaddingPx");
    if (pad != null) state.ocrYPaddingPx = clampInt(pad, 0, 500);
  } catch {}
};

export const loadPaperAlignRef = (state) => {
  try {
    const raw = localStorage.getItem("setting:paperAlignRef");
    if (raw) state.paperAlignRef = JSON.parse(raw) || {};
  } catch {}
};

export const loadFilterPageSize = (state) => {
  try {
    const s = localStorage.getItem("setting:filterPageSize");
    if (s && /^\d+$/.test(s)) {
      state.filterPageSize = clampInt(s, 5, 200);
    }
  } catch {}
};

const answerAlignRefKey = (qpId, msId) => {
  if (qpId == null || msId == null) return null;
  return `answerAlignRef:${String(qpId)}:${String(msId)}`;
};

export const loadAnswerAlignRef = (state, qpId, msId) => {
  state.answerAlignRef = null;
  const key = answerAlignRefKey(qpId, msId);
  if (!key) return;
  try {
    const raw = localStorage.getItem(`setting:${key}`);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const x0 = parsed?.[0];
    const x1 = parsed?.[1];
    if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) return;
    state.answerAlignRef = [clamp01(Math.min(x0, x1)), clamp01(Math.max(x0, x1))];
  } catch {}
};

export const saveAlignLeftSetting = (state, v) => {
  state.alignLeftEnabled = !!v;
  if (state.alignLeftEnabled) {
    state.alignPaperFirstEnabled = false;
    try {
      localStorage.setItem("setting:alignPaperFirstEnabled", "0");
    } catch {}
  }
  try {
    localStorage.setItem("setting:alignLeftEnabled", state.alignLeftEnabled ? "1" : "0");
  } catch {}
};

export const saveAlignPaperFirstSetting = (state, v) => {
  state.alignPaperFirstEnabled = !!v;
  if (state.alignPaperFirstEnabled) {
    state.alignLeftEnabled = false;
    try {
      localStorage.setItem("setting:alignLeftEnabled", "0");
    } catch {}
  }
  try {
    localStorage.setItem("setting:alignPaperFirstEnabled", state.alignPaperFirstEnabled ? "1" : "0");
  } catch {}
};

export const saveAnswerAlignSetting = (state, v) => {
  state.answerAlignEnabled = !!v;
  try {
    localStorage.setItem("setting:answerAlignEnabled", state.answerAlignEnabled ? "1" : "0");
  } catch {}
};

export const saveOcrAutoSetting = (state, v) => {
  state.ocrAutoEnabled = !!v;
  try {
    localStorage.setItem("setting:ocrAutoEnabled", state.ocrAutoEnabled ? "1" : "0");
  } catch {}
};

export const saveOcrMinHeightPx = (state, v) => {
  state.ocrMinHeightPx = clampInt(v, 0, 2000);
  try {
    localStorage.setItem("setting:ocrMinHeightPx", String(state.ocrMinHeightPx));
  } catch {}
};

export const saveOcrYPaddingPx = (state, v) => {
  state.ocrYPaddingPx = clampInt(v, 0, 500);
  try {
    localStorage.setItem("setting:ocrYPaddingPx", String(state.ocrYPaddingPx));
  } catch {}
};

export const savePaperAlignRef = (state, paperId, bounds) => {
  try {
    const raw = localStorage.getItem("setting:paperAlignRef");
    const dict = raw ? JSON.parse(raw) : {};
    if (!bounds) {
      delete dict[paperId];
    } else {
      dict[paperId] = bounds;
    }
    state.paperAlignRef = dict;
    localStorage.setItem("setting:paperAlignRef", JSON.stringify(dict));
  } catch {}
};

export const saveAnswerAlignRef = (state, qpId, msId, bounds) => {
  const key = answerAlignRefKey(qpId, msId);
  if (!key) return;
  if (!bounds || bounds.length !== 2) return;
  const x0 = bounds?.[0];
  const x1 = bounds?.[1];
  if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) return;
  const val = [clamp01(Math.min(x0, x1)), clamp01(Math.max(x0, x1))];
  state.answerAlignRef = val;
  try {
    localStorage.setItem(`setting:${key}`, JSON.stringify(val));
  } catch {}
};

export const saveFilterPageSize = (state, size) => {
  try {
    localStorage.setItem("setting:filterPageSize", String(size));
  } catch {}
};
