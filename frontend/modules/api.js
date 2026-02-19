export const api = async (path, opts) => {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${t}`);
  }
  return res.json();
};

let statusSink = null;

export const setStatusSink = (fn) => {
  statusSink = typeof fn === "function" ? fn : null;
};

export const setStatus = (text, kind = "") => {
  if (statusSink) {
    statusSink({ text: String(text ?? ""), kind: String(kind ?? "") });
  }
};
