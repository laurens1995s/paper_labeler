import { state } from "../store.js";

export const apiFetch = async (path, opts) => {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${t}`);
  }
  return res.json();
};

export const api = apiFetch;

export const setStatus = (text, kind = "") => {
  state.statusText = String(text ?? "");
  state.statusKind = String(kind ?? "");
};

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
