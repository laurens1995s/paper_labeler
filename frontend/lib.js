// Shared utilities (loaded before app.js)

window.$ = (id) => document.getElementById(id);

window.escapeHtml = function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

window.extractYearSeason = function extractYearSeason(text) {
  // examples: 9709_s25_qp_15.pdf -> {season:'s', year:'25'}
  const m = String(text || "").match(/_(m|s|w)(\d{2})_/i);
  if (!m) return { season: null, year: null };
  return { season: m[1].toLowerCase(), year: m[2] };
};

window.setStatus = function setStatus(text, kind = "") {
  const el = $("status");
  el.className = `muted ${kind}`.trim();
  el.textContent = text;
};

window.api = async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${t}`);
  }
  return res.json();
};

window.clamp01 = function clamp01(v) {
  return Math.max(0, Math.min(1, v));
};

window.normalizeBox = function normalizeBox(box) {
  let [x0, y0, x1, y1] = box;
  const nx0 = Math.min(x0, x1);
  const nx1 = Math.max(x0, x1);
  const ny0 = Math.min(y0, y1);
  const ny1 = Math.max(y0, y1);
  return [clamp01(nx0), clamp01(ny0), clamp01(nx1), clamp01(ny1)];
};

window.pointInBox = function pointInBox(x, y, bbox) {
  const [x0, y0, x1, y1] = bbox;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
};

window.sleep = function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
};

window.waitForImageReady = async function waitForImageReady(img, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (img && img.complete && (img.naturalWidth || 0) > 0 && img.clientHeight > 0) return true;
    await sleep(50);
  }
  return false;
};
