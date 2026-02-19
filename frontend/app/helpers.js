import { extractYearSeason } from "../modules/utils.js";

export const stripPdfSuffix = (name) => {
  const s = String(name || "").trim();
  return s.replace(/\.pdf$/i, "");
};

export const formatPaperName = (paper) => {
  const base = paper?.exam_code || paper?.filename || "";
  return stripPdfSuffix(base);
};

export const extractCacheBustToken = (url) => {
  try {
    const u = new URL(String(url || ""), window.location.origin);
    const v = u.searchParams.get("v");
    return v ? String(v) : null;
  } catch {
    return null;
  }
};

export const lastMarkedPageKey = (paperId, token) => {
  if (paperId == null) return null;
  const t = token ? String(token) : "";
  return t ? `lastMarkedPage:${paperId}:${t}` : `lastMarkedPage:${paperId}`;
};

export const getLastMarkedPageNum = (paperId, token) => {
  const key = lastMarkedPageKey(paperId, token);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    const n = raw != null ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

export const setLastMarkedPageNum = (paperId, token, pageNum) => {
  const key = lastMarkedPageKey(paperId, token);
  if (!key) return;
  try {
    localStorage.setItem(key, String(pageNum));
  } catch {}
};

export const answerProgressKey = (kind, qpPaperId, qpToken, msPaperId, msToken) => {
  if (!qpPaperId || !msPaperId) return null;
  const qt = qpToken ? String(qpToken) : "";
  const mt = msToken ? String(msToken) : "";
  return `answerProgress:${kind}:${qpPaperId}:${qt}:${msPaperId}:${mt}`;
};

export const getAnswerProgress = (kind, qpPaperId, qpToken, msPaperId, msToken) => {
  const key = answerProgressKey(kind, qpPaperId, qpToken, msPaperId, msToken);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    const n = raw != null ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

export const setAnswerProgress = (kind, qpPaperId, qpToken, msPaperId, msToken, value) => {
  const key = answerProgressKey(kind, qpPaperId, qpToken, msPaperId, msToken);
  if (!key) return;
  try {
    localStorage.setItem(key, String(value));
  } catch {}
};

export const deriveMsCode = (codeOrFilename) => {
  const s = String(codeOrFilename || "").replace(/\.pdf$/i, "");
  if (/_qp_/i.test(s)) return s.replace(/_qp_/i, "_ms_");
  return null;
};

export const findMatchedMsPaper = (paperDetail, papers) => {
  const list = Array.isArray(papers) ? papers : [];
  const pairedId = paperDetail?.paired_paper_id;
  if (pairedId) return list.find((p) => p.id === pairedId) || { id: pairedId };

  const msCode = deriveMsCode(paperDetail?.exam_code || paperDetail?.filename);
  if (!msCode) return null;
  const byExam = list.find((p) => String(p.exam_code || "") === msCode);
  if (byExam) return byExam;
  const byName = list.find((p) => String(p.filename || "").includes(msCode));
  return byName || null;
};

export const sortQuestionsByNoAsc = (qs) => {
  const arr = Array.from(qs || []);
  arr.sort((a, b) => {
    const an = a.question_no != null && String(a.question_no).trim().match(/^\d+$/)
      ? parseInt(String(a.question_no).trim(), 10)
      : Number.POSITIVE_INFINITY;
    const bn = b.question_no != null && String(b.question_no).trim().match(/^\d+$/)
      ? parseInt(String(b.question_no).trim(), 10)
      : Number.POSITIVE_INFINITY;
    if (an !== bn) return an - bn;
    return (a.id || 0) - (b.id || 0);
  });
  return arr;
};

export const extractYearFromPaperName = (paper) => {
  if (!paper) return null;
  const { year } = extractYearSeason(String(paper.exam_code || "") + " " + String(paper.filename || ""));
  return year || null;
};

export const removeAdText = (text) => {
  if (!text) return text;
  return text.replace(/\s*-\s*🔥.*🔥\s*$/g, "").trim();
};
