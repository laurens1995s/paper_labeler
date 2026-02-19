export const $ = (id) => document.getElementById(id);

export const escapeHtml = (text) => {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

export const extractYearSeason = (text) => {
  // examples: 9709_s25_qp_15.pdf -> {season:'s', year:'25'}
  const m = String(text || "").match(/_(m|s|w)(\d{2})_/i);
  if (!m) return { season: null, year: null };
  return { season: m[1].toLowerCase(), year: m[2] };
};

export const clamp01 = (v) => {
  return Math.max(0, Math.min(1, v));
};

export const normalizeBox = (box) => {
  let [x0, y0, x1, y1] = box;
  const nx0 = Math.min(x0, x1);
  const nx1 = Math.max(x0, x1);
  const ny0 = Math.min(y0, y1);
  const ny1 = Math.max(y0, y1);
  return [clamp01(nx0), clamp01(ny0), clamp01(nx1), clamp01(ny1)];
};

export const pointInBox = (x, y, bbox) => {
  const [x0, y0, x1, y1] = bbox;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
};

export const clampInt = (v, min, max) => {
    let i = parseInt(v, 10);
    if (isNaN(i)) return min;
    return Math.max(min, Math.min(max, i));
};
