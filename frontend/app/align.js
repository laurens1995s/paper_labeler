import { clamp01, normalizeBox } from "../modules/utils.js";

export const computeUnionAlignBoundsFromBoxesPayload = (boxesPayload) => {
  const arr = Array.isArray(boxesPayload) ? boxesPayload : [];
  let minX0 = null;
  let maxX1 = null;
  for (const b of arr) {
    const bb = b?.bbox || b;
    const x0 = bb?.[0];
    const x1 = bb?.[2];
    if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) continue;
    minX0 = minX0 == null ? x0 : Math.min(minX0, x0);
    maxX1 = maxX1 == null ? x1 : Math.max(maxX1, x1);
  }
  if (minX0 == null || maxX1 == null) return null;
  const nx0 = clamp01(minX0);
  const nx1 = clamp01(maxX1);
  const minW = 0.01;
  if (nx1 - nx0 < minW) return [nx0, clamp01(nx0 + minW)];
  return [nx0, nx1];
};

export const alignBoxesPayloadToBoundsX = (boxesPayload, bounds) => {
  if (!bounds) return boxesPayload;
  const nx0 = clamp01(bounds[0]);
  const nx1 = clamp01(bounds[1]);
  const minW = 0.01;
  const x0 = nx0;
  const x1 = Math.max(nx1, nx0 + minW);
  return (boxesPayload || []).map((b) => {
    const bb = b?.bbox;
    if (!Array.isArray(bb) || bb.length !== 4) return b;
    return { ...b, bbox: normalizeBox([x0, bb[1], x1, bb[3]]) };
  });
};

export const getPaperAlignBounds = (paperAlignRef, paperId) => {
  if (paperId == null) return null;
  const key = String(paperId);
  const v = paperAlignRef?.[key];
  const x0 = v?.[0];
  const x1 = v?.[1];
  if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) return null;
  return [clamp01(x0), clamp01(x1)];
};

export const ensurePaperAlignRefFromBox = (paperAlignRef, paperId, bbox) => {
  if (paperId == null) return paperAlignRef;
  const key = String(paperId);
  const next = paperAlignRef && typeof paperAlignRef === "object" ? { ...paperAlignRef } : {};
  if (next[key]) return next;
  const x0 = bbox?.[0];
  const x1 = bbox?.[2];
  if (typeof x0 !== "number" || !Number.isFinite(x0) || typeof x1 !== "number" || !Number.isFinite(x1)) return next;
  next[key] = [clamp01(x0), clamp01(x1)];
  return next;
};

export const ensurePaperAlignRefFromBoxes = (paperAlignRef, paperId, boxesPayload) => {
  if (paperId == null) return paperAlignRef;
  const key = String(paperId);
  const next = paperAlignRef && typeof paperAlignRef === "object" ? { ...paperAlignRef } : {};
  if (next[key]) return next;
  const bounds = computeUnionAlignBoundsFromBoxesPayload(boxesPayload);
  if (!bounds) return next;
  next[key] = [bounds[0], bounds[1]];
  return next;
};

export const getTempAlignBoundsFromFirstNewBox = (newBoxes) => {
  const first = (newBoxes || []).find((b) => b && Array.isArray(b.bbox) && b.bbox.length === 4);
  if (!first) return null;
  return [clamp01(first.bbox[0]), clamp01(first.bbox[2])];
};

export const getActivePaperAlignBounds = (paperAlignRef, paperId, newBoxes) => {
  return getPaperAlignBounds(paperAlignRef, paperId) || getTempAlignBoundsFromFirstNewBox(newBoxes);
};

export const alignAnswerBoxesPayloadToBoundsX = (boxes, bounds) => {
  if (!bounds) return boxes;
  const x0 = clamp01(bounds[0]);
  const x1 = clamp01(bounds[1]);
  const minW = 0.01;
  return (boxes || []).map((b) => {
    const bb = b?.bbox;
    if (!Array.isArray(bb) || bb.length !== 4) return b;
    return { ...b, bbox: normalizeBox([x0, bb[1], Math.max(x1, x0 + minW), bb[3]]) };
  });
};

export const alignAnswerBBoxToBoundsX = (bbox, bounds) => {
  if (!bounds || !Array.isArray(bbox) || bbox.length !== 4) return bbox;
  const x0 = clamp01(bounds[0]);
  const x1 = clamp01(bounds[1]);
  const minW = 0.01;
  return normalizeBox([x0, bbox[1], Math.max(x1, x0 + minW), bbox[3]]);
};

export const applyAnswerAlignToAllNewBoxes = (answerNewBoxes, bounds) => {
  if (!bounds) return answerNewBoxes;
  return (answerNewBoxes || []).map((b) => ({ ...b, bbox: alignAnswerBBoxToBoundsX(b.bbox, bounds) }));
};
