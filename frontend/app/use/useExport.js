import { useAppContext } from "./useAppContext.js";
import { api } from "../../modules/api.js";
import { clampInt } from "../../modules/utils.js";
import { extractYearFromPaperName } from "../helpers.js";
import * as Settings from "../../modules/settings.js";

export const useExport = () => {
  return useAppContext();
};

export const exportMethods = {
  hydrateExportWizardOptions() {
    const opts = Settings.loadExportWizardOptions ? Settings.loadExportWizardOptions() : null;
    if (!opts) return;
    this.exportIncludeQno = opts.includeQno ?? this.exportIncludeQno;
    this.exportIncludeSection = opts.includeSection ?? this.exportIncludeSection;
    this.exportIncludePaper = opts.includePaper ?? this.exportIncludePaper;
    this.exportIncludeOriginalQno = opts.includeOriginalQno ?? this.exportIncludeOriginalQno;
    this.exportIncludeNotes = opts.includeNotes ?? this.exportIncludeNotes;
    this.exportIncludeAnswers = opts.includeAnswers ?? this.exportIncludeAnswers;
    this.exportAnsPlacement = opts.ansPlacement ?? this.exportAnsPlacement;
    this.exportIncludeFilterSummary = opts.includeFilterSummary ?? this.exportIncludeFilterSummary;
    this.exportSummaryFieldSection = opts.summaryFieldSection ?? this.exportSummaryFieldSection;
    this.exportSummaryFieldPaper = opts.summaryFieldPaper ?? this.exportSummaryFieldPaper;
    this.exportSummaryFieldYear = opts.summaryFieldYear ?? this.exportSummaryFieldYear;
    this.exportSummaryFieldSeason = opts.summaryFieldSeason ?? this.exportSummaryFieldSeason;
    this.exportSummaryFieldFavorites = opts.summaryFieldFavorites ?? this.exportSummaryFieldFavorites;
    this.exportSummaryFieldCount = opts.summaryFieldCount ?? this.exportSummaryFieldCount;
  },
  persistExportWizardOptions() {
    if (!Settings.saveExportWizardOptions) return;
    Settings.saveExportWizardOptions({
      includeQno: this.exportIncludeQno,
      includeSection: this.exportIncludeSection,
      includePaper: this.exportIncludePaper,
      includeOriginalQno: this.exportIncludeOriginalQno,
      includeNotes: this.exportIncludeNotes,
      includeAnswers: this.exportIncludeAnswers,
      ansPlacement: this.exportAnsPlacement,
      includeFilterSummary: this.exportIncludeFilterSummary,
      summaryFieldSection: this.exportSummaryFieldSection,
      summaryFieldPaper: this.exportSummaryFieldPaper,
      summaryFieldYear: this.exportSummaryFieldYear,
      summaryFieldSeason: this.exportSummaryFieldSeason,
      summaryFieldFavorites: this.exportSummaryFieldFavorites,
      summaryFieldCount: this.exportSummaryFieldCount,
    });
  },
  resetExportJobState() {
    this.exportJobId = "";
    this.exportJobStatus = "";
    this.exportJobPhase = "";
    this.exportJobQueuePos = 0;
    this.exportJobProgressDone = 0;
    this.exportJobProgressTotal = 0;
    this.exportJobProgressPercent = 0;
  },
  clearExportPolling() {
    if (this.exportPollingTimer) {
      clearTimeout(this.exportPollingTimer);
      this.exportPollingTimer = null;
    }
  },
  closeExportWizard() {
    this.exportWizardOpen = false;
    if (!this.exportBusy) this.clearExportPolling();
  },
  updateExportJobProgress(statusData = {}) {
    const p = statusData.progress || {};
    this.exportJobStatus = String(statusData.status || "");
    this.exportJobPhase = String(statusData.phase || "");
    this.exportJobQueuePos = Math.max(0, Number(statusData.queue_position || 0));
    this.exportJobProgressDone = Math.max(0, Number(p.done || 0));
    this.exportJobProgressTotal = Math.max(0, Number(p.total || 0));
    const pct = Number(p.percent);
    this.exportJobProgressPercent = Number.isFinite(pct)
      ? Math.max(0, Math.min(100, pct))
      : (this.exportJobProgressTotal > 0
        ? Math.max(0, Math.min(100, (this.exportJobProgressDone / this.exportJobProgressTotal) * 100))
        : 0);
  },
  wait(ms) {
    return new Promise((resolve) => {
      this.exportPollingTimer = setTimeout(() => {
        this.exportPollingTimer = null;
        resolve();
      }, Math.max(0, Number(ms) || 0));
    });
  },
  async pollExportJobUntilDone(jobId) {
    while (true) {
      if (!jobId || this.exportJobId !== jobId) {
        throw new Error("\u5bfc\u51fa\u4efb\u52a1\u5df2\u88ab\u4e2d\u65ad");
      }
      const statusData = await api(`/export/questions_pdf_job/${jobId}`);
      this.updateExportJobProgress(statusData || {});
      const st = String(statusData?.status || "");
      if (st === "queued") {
        this.setStatus(
          this.exportJobQueuePos > 0
            ? `\u5bfc\u51fa\u6392\u961f\u4e2d\uff08\u524d\u65b9 ${this.exportJobQueuePos} \u4e2a\uff09`
            : "\u5bfc\u51fa\u6392\u961f\u4e2d",
          "info",
        );
      } else if (st === "processing") {
        const pctText = `${Math.round(this.exportJobProgressPercent || 0)}%`;
        this.setStatus(`\u5bfc\u51fa\u5904\u7406\u4e2d ${pctText}`, "info");
      } else if (st === "done") {
        return statusData;
      } else if (st === "cancelled") {
        throw new Error(String(statusData?.message || "\u5bfc\u51fa\u5df2\u53d6\u6d88"));
      } else if (st === "error") {
        throw new Error(String(statusData?.message || "\u5bfc\u51fa\u5931\u8d25"));
      }
      await this.wait(500);
    }
  },
  async cancelExportJob() {
    const jobId = String(this.exportJobId || "");
    if (!jobId) return;
    try {
      await api(`/export/questions_pdf_job/${jobId}/cancel`, { method: "POST" });
      this.setStatus("\u5df2\u53d6\u6d88\u5bfc\u51fa\u4efb\u52a1", "info");
    } catch (e) {
      this.setStatus(`\u53d6\u6d88\u5931\u8d25\uff1a${String(e)}`, "err");
    } finally {
      this.clearExportPolling();
      this.exportBusy = false;
      this.exportJobStatus = "cancelled";
    }
  },
  triggerDownload(url) {
    // Prefer a normal navigation so IDM can fully take over.
    try {
      window.location.assign(url);
    } catch {
      try {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_self";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        window.location.href = url;
      }
    }
  },
  getSelectedFilterValues() {
    const years = Array.isArray(this.filterYearMulti) && this.filterYearMulti.length
      ? this.filterYearMulti.map((v) => String(v))
      : (this.filterYear ? [String(this.filterYear)] : []);
    const seasons = Array.isArray(this.filterSeasonMulti) && this.filterSeasonMulti.length
      ? this.filterSeasonMulti.map((v) => String(v).toLowerCase())
      : (this.filterSeason ? [String(this.filterSeason).toLowerCase()] : []);
    const paperIds = Array.isArray(this.filterPaperMulti) && this.filterPaperMulti.length
      ? this.filterPaperMulti.map((v) => String(v))
      : (this.filterPaper ? [String(this.filterPaper)] : []);
    return { years, seasons, paperIds };
  },
  normalizeUniqueValues(values) {
    const out = [];
    const seen = new Set();
    for (const v of values || []) {
      const k = String(v || "").trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  },
  isAllSelected(selectedValues, allValues) {
    const selected = this.normalizeUniqueValues(selectedValues);
    const all = this.normalizeUniqueValues(allValues);
    if (!selected.length) return true;
    if (!all.length) return false;
    if (selected.length !== all.length) return false;
    const allSet = new Set(all);
    return selected.every((x) => allSet.has(x));
  },
  sanitizeExportTokenValue(value) {
    return String(value || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/_+/g, "_")
      .replace(/^[-_\.]+|[-_\.]+$/g, "");
  },
  sanitizeExportFileNameCore(value) {
    const raw = String(value || "");
    const normalized = raw
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_");
    const parts = normalized
      .split("_")
      .map((p) => p.trim().replace(/^[-\.]+|[-\.]+$/g, ""))
      .filter(Boolean);
    return parts.join("_");
  },
  formatDateYmd(now = new Date()) {
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  },
  formatTimeHm(now = new Date()) {
    return `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  },
  getNextExportSeq(now = new Date()) {
    const today = this.formatDateYmd(now);
    const seqState = Settings.loadExportSeqState() || {};
    const date = String(seqState.exportSeqDate || "");
    const num = Number(seqState.exportSeqNum || 0);
    if (date === today) return Math.max(0, num) + 1;
    return 1;
  },
  commitExportSeq(now = new Date()) {
    const today = this.formatDateYmd(now);
    const next = this.getNextExportSeq(now);
    Settings.saveExportSeqState(today, next);
    return next;
  },
  getYearSelectionInfo() {
    const selectedRaw = Array.isArray(this.filterYearMulti) && this.filterYearMulti.length
      ? this.filterYearMulti
      : (this.filterYear ? [this.filterYear] : []);
    const selected = this.normalizeUniqueValues(selectedRaw.map((v) => String(v)));
    const all = this.normalizeUniqueValues((this.filterYearOptions || []).map((v) => String(v)));
    const allSelected = this.isAllSelected(selected, all);
    const values = allSelected ? [] : (all.length ? all.filter((v) => selected.includes(v)) : selected);
    return { allSelected, values };
  },
  getSeasonSelectionInfo() {
    const selectedRaw = Array.isArray(this.filterSeasonMulti) && this.filterSeasonMulti.length
      ? this.filterSeasonMulti
      : (this.filterSeason ? [this.filterSeason] : []);
    const selected = this.normalizeUniqueValues(selectedRaw.map((v) => String(v).toLowerCase()));
    const all = ["m", "s", "w"];
    const allSelected = this.isAllSelected(selected, all);
    const values = allSelected ? [] : all.filter((v) => selected.includes(v));
    return { allSelected, values };
  },
  getPaperSelectionInfo() {
    const selectedRaw = Array.isArray(this.filterPaperMulti) && this.filterPaperMulti.length
      ? this.filterPaperMulti
      : (this.filterPaper ? [this.filterPaper] : []);
    const selected = this.normalizeUniqueValues(selectedRaw.map((v) => String(v)));
    const all = this.normalizeUniqueValues((this.filterPaperOptions || []).map((o) => String(o?.value || "")));
    const allSelected = this.isAllSelected(selected, all);
    if (allSelected) return { allSelected: true, values: [], labels: [] };
    const selectedSet = new Set(selected);
    const labels = (this.filterPaperOptions || [])
      .filter((o) => selectedSet.has(String(o?.value || "")))
      .map((o) => this.sanitizeExportTokenValue(o?.label ?? o?.value ?? ""))
      .filter(Boolean);
    return { allSelected: false, values: selected, labels };
  },
  getSectionToken() {
    const section = String(this.filterSection || "").trim();
    if (!section) return "";
    if (section === "__UNSET__") return "unmarked";
    if (this.exportNameSectionStyle === "raw") return this.sanitizeExportTokenValue(section);
    const display = this.sectionDisplayName ? this.sectionDisplayName(section) : section;
    return this.sanitizeExportTokenValue(display);
  },
  validateExportNameTemplate(template) {
    const effective = String(template || "").trim() || Settings.DEFAULT_EXPORT_NAME_TEMPLATE;
    const allowed = new Set([
      "mode", "section", "paper", "year", "season", "fav", "exclude", "count",
      "ts", "date", "time", "seq", "custom",
    ]);
    const unknown = [];
    const seen = new Set();
    const tokenRe = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    let m;
    while ((m = tokenRe.exec(effective)) !== null) {
      const key = String(m[1] || "").toLowerCase();
      if (!allowed.has(key) && !seen.has(key)) {
        seen.add(key);
        unknown.push(`{${key}}`);
      }
    }
    if (unknown.length) return `导出文件名模板包含未知占位符：${unknown.join("、")}`;
    return "";
  },
  templateUsesSeq(template) {
    const effective = String(template || "").trim() || Settings.DEFAULT_EXPORT_NAME_TEMPLATE;
    return /\{seq\}/i.test(effective);
  },
  buildExportNameContext({ idsCount = 0, fromRandom = false, now = new Date() } = {}) {
    const seasonMap = { m: "spring", s: "summer", w: "winter" };
    const yearInfo = this.getYearSelectionInfo();
    const seasonInfo = this.getSeasonSelectionInfo();
    const paperInfo = this.getPaperSelectionInfo();
    const section = this.getSectionToken();
    const mode = fromRandom ? "Random" : "Filter";
    const date = this.formatDateYmd(now);
    const time = this.formatTimeHm(now);
    const ts = `${date}_${time}`;
    const seq = String(this.getNextExportSeq(now));
    const paper = !paperInfo.labels.length
      ? ""
      : (paperInfo.labels.length <= 2 ? paperInfo.labels.join("-") : `p${paperInfo.labels.length}`);
    return {
      mode,
      section,
      paper,
      year: (() => {
        const ys = yearInfo.values
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .map((v) => this.sanitizeExportTokenValue(v))
          .filter(Boolean);
        if (!ys.length) return "";
        return this.sanitizeExportTokenValue(`y${ys.join("-")}`);
      })(),
      season: seasonInfo.values.map((v) => seasonMap[v] || v).map((v) => this.sanitizeExportTokenValue(v)).filter(Boolean).join("-"),
      fav: (fromRandom ? this.randomExportFavoriteOnly : this.filterFavOnly) ? "fav" : "",
      exclude: fromRandom ? "" : (this.filterExcludeMultiSection ? "exclude-multi" : ""),
      count: idsCount > 0 ? `${idsCount}q` : "",
      ts,
      date,
      time,
      seq,
      custom: this.sanitizeExportTokenValue(this.exportNameCustom || ""),
    };
  },
  renderExportNameTemplate({ template, context } = {}) {
    const effectiveTemplate = String(template || "").trim() || Settings.DEFAULT_EXPORT_NAME_TEMPLATE;
    const templateError = this.validateExportNameTemplate(effectiveTemplate);
    const usedTemplate = templateError ? Settings.DEFAULT_EXPORT_NAME_TEMPLATE : effectiveTemplate;
    const tokenRe = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    const rendered = usedTemplate.replace(tokenRe, (_m, rawKey) => {
      const key = String(rawKey || "").toLowerCase();
      return String(context?.[key] ?? "");
    });
    const cleaned = this.sanitizeExportFileNameCore(rendered).slice(0, 150);
    return {
      name: cleaned || `export_${context?.ts || `${this.formatDateYmd()}_${this.formatTimeHm()}`}`,
      usedFallback: !!templateError,
      templateError,
      templateUsed: usedTemplate,
    };
  },
  buildRecommendedExportFileNamePreview({ idsCount = 0, fromRandom = false } = {}) {
    let template = String(this.exportNameTemplate || "").trim() || Settings.DEFAULT_EXPORT_NAME_TEMPLATE;
    const hasTimeToken = /\{(?:ts|date|time)\}/i.test(template);
    if (this.exportNameAutoTimestamp && !hasTimeToken) template = `${template}_{ts}`;
    const context = this.buildExportNameContext({ idsCount, fromRandom, now: new Date() });
    return this.renderExportNameTemplate({ template, context });
  },
  buildRecommendedExportFileName({ idsCount = 0, fromRandom = false } = {}) {
    const result = this.buildRecommendedExportFileNamePreview({ idsCount, fromRandom });
    this.exportNameTemplateError = result.templateError || "";
    this._exportNameTemplateFallbackUsed = !!result.usedFallback;
    return result.name;
  },
  getExportCacheTtlMs() {
    return 6 * 60 * 60 * 1000;
  },
  loadExportCacheStatsFromStorage() {
    try {
      const raw = localStorage.getItem("cache:exportFilterIdsStats");
      if (!raw) return { hit: 0, miss: 0, expired: 0, write: 0, lastHitAt: 0, lastMissAt: 0, lastWriteAt: 0 };
      const p = JSON.parse(raw) || {};
      return {
        hit: Math.max(0, Number(p.hit) || 0),
        miss: Math.max(0, Number(p.miss) || 0),
        expired: Math.max(0, Number(p.expired) || 0),
        write: Math.max(0, Number(p.write) || 0),
        lastHitAt: Math.max(0, Number(p.lastHitAt) || 0),
        lastMissAt: Math.max(0, Number(p.lastMissAt) || 0),
        lastWriteAt: Math.max(0, Number(p.lastWriteAt) || 0),
      };
    } catch {
      return { hit: 0, miss: 0, expired: 0, write: 0, lastHitAt: 0, lastMissAt: 0, lastWriteAt: 0 };
    }
  },
  saveExportCacheStatsToStorage(stats) {
    const next = {
      hit: Math.max(0, Number(stats?.hit) || 0),
      miss: Math.max(0, Number(stats?.miss) || 0),
      expired: Math.max(0, Number(stats?.expired) || 0),
      write: Math.max(0, Number(stats?.write) || 0),
      lastHitAt: Math.max(0, Number(stats?.lastHitAt) || 0),
      lastMissAt: Math.max(0, Number(stats?.lastMissAt) || 0),
      lastWriteAt: Math.max(0, Number(stats?.lastWriteAt) || 0),
    };
    this.exportCacheStats = next;
    try {
      localStorage.setItem("cache:exportFilterIdsStats", JSON.stringify(next));
    } catch {}
    return next;
  },
  bumpExportCacheStat(kind) {
    const now = Date.now();
    const s = this.loadExportCacheStatsFromStorage();
    if (kind === "hit") {
      s.hit += 1;
      s.lastHitAt = now;
    } else if (kind === "miss") {
      s.miss += 1;
      s.lastMissAt = now;
    } else if (kind === "expired") {
      s.expired += 1;
    } else if (kind === "write") {
      s.write += 1;
      s.lastWriteAt = now;
    }
    this.saveExportCacheStatsToStorage(s);
  },
  refreshExportCacheOverview() {
    const ttlMs = this.getExportCacheTtlMs();
    let entryCount = 0;
    let newestAgeMs = null;
    let oldestAgeMs = null;
    try {
      const raw = localStorage.getItem("cache:exportFilterIdsByKey");
      const parsed = raw ? (JSON.parse(raw) || {}) : {};
      const now = Date.now();
      const ages = [];
      let changed = false;
      for (const [, item] of Object.entries(parsed)) {
        if (!item || !Array.isArray(item.ids)) continue;
        const ts = Number(item.ts || 0);
        if (!ts) continue;
        const age = Math.max(0, now - ts);
        if (age > ttlMs) {
          changed = true;
          continue;
        }
        entryCount += 1;
        ages.push(age);
      }
      if (changed) {
        const next = {};
        for (const [k, item] of Object.entries(parsed)) {
          if (!item || !Array.isArray(item.ids)) continue;
          const ts = Number(item.ts || 0);
          if (!ts || (now - ts) > ttlMs) continue;
          next[k] = item;
        }
        localStorage.setItem("cache:exportFilterIdsByKey", JSON.stringify(next));
      }
      if (ages.length) {
        newestAgeMs = Math.min(...ages);
        oldestAgeMs = Math.max(...ages);
      }
    } catch {}
    this.exportCacheOverview = { entryCount, newestAgeMs, oldestAgeMs, ttlMs };
    this.exportCacheStats = this.loadExportCacheStatsFromStorage();
    return this.exportCacheOverview;
  },
  getExportFilterCacheVersion() {
    let version = Number(this.exportFilterCacheVersion || 0);
    if (!Number.isFinite(version) || version < 0) version = 0;
    try {
      const raw = localStorage.getItem("cache:exportFilterCacheVersion");
      if (raw != null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) {
          version = Math.floor(parsed);
          this.exportFilterCacheVersion = version;
        }
      }
    } catch {}
    return version;
  },
  saveExportFilterCacheVersion(version) {
    const v = Math.max(0, Math.floor(Number(version) || 0));
    this.exportFilterCacheVersion = v;
    try {
      localStorage.setItem("cache:exportFilterCacheVersion", String(v));
    } catch {}
    return v;
  },
  buildFilterExportCacheKey() {
    if (typeof this.buildFilterSearchParams !== "function") return "";
    const params = this.buildFilterSearchParams({ page: 1, pageSize: 200 });
    if (!params) return "";
    try {
      params.delete("page");
      params.delete("page_size");
    } catch {}
    const version = this.getExportFilterCacheVersion();
    return `${params.toString()}|v=${version}`;
  },
  loadPersistedFilterExportIds(cacheKey) {
    if (!cacheKey) return null;
    try {
      const raw = localStorage.getItem("cache:exportFilterIdsByKey");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const item = parsed?.[cacheKey];
      if (!item || !Array.isArray(item.ids)) return null;
      const ts = Number(item.ts || 0);
      const age = ts > 0 ? (Date.now() - ts) : Number.MAX_SAFE_INTEGER;
      if (!Number.isFinite(age) || age > this.getExportCacheTtlMs()) {
        try {
          delete parsed[cacheKey];
          localStorage.setItem("cache:exportFilterIdsByKey", JSON.stringify(parsed));
        } catch {}
        this.bumpExportCacheStat("expired");
        this.refreshExportCacheOverview();
        return null;
      }
      return item.ids.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    } catch {
      return null;
    }
  },
  savePersistedFilterExportIds(cacheKey, ids) {
    if (!cacheKey || !Array.isArray(ids)) return;
    try {
      const raw = localStorage.getItem("cache:exportFilterIdsByKey");
      const dict = raw ? (JSON.parse(raw) || {}) : {};
      dict[cacheKey] = {
        ids: ids.map((x) => Number(x)).filter((x) => Number.isFinite(x)),
        ts: Date.now(),
      };
      const entries = Object.entries(dict).sort((a, b) => Number(b?.[1]?.ts || 0) - Number(a?.[1]?.ts || 0));
      const pruned = Object.fromEntries(entries.slice(0, 12));
      localStorage.setItem("cache:exportFilterIdsByKey", JSON.stringify(pruned));
      this.bumpExportCacheStat("write");
      this.refreshExportCacheOverview();
    } catch {}
  },
  invalidateExportFilterCache() {
    this.exportFilterIdsCacheKey = "";
    this.exportFilterIdsCacheIds = [];
    this.exportFilterIdsCacheAt = 0;
    const nextVersion = this.getExportFilterCacheVersion() + 1;
    this.saveExportFilterCacheVersion(nextVersion);
    try {
      localStorage.removeItem("cache:exportFilterIdsByKey");
      localStorage.removeItem("cache:exportFilterIdsLatest");
    } catch {}
    this.refreshExportCacheOverview();
  },
  buildExportFilterSummaryLines(idsCount = 0) {
    const lines = [];
    const yearInfo = this.getYearSelectionInfo();
    const seasonInfo = this.getSeasonSelectionInfo();
    const paperInfo = this.getPaperSelectionInfo();
    const seasonNameMap = { m: "Spring", s: "Summer", w: "Winter" };
    const expandedYears = yearInfo.values.length
      ? yearInfo.values
      : this.normalizeUniqueValues((this.filterYearOptions || []).map((v) => String(v)));
    const expandedSeasonsRaw = seasonInfo.values.length ? seasonInfo.values : ["m", "s", "w"];
    const expandedSeasons = expandedSeasonsRaw.map((v) => seasonNameMap[v] || String(v));
    const allText = "(All)";
    const unmarkedText = "(Unmarked)";
    const sectionText = this.filterSection === "__UNSET__"
      ? unmarkedText
      : (this.filterSection ? (this.sectionDisplayName ? this.sectionDisplayName(this.filterSection) : this.filterSection) : allText);
    if (this.exportSummaryFieldSection) {
      lines.push(`Section: ${sectionText}`);
    }
    if (this.exportSummaryFieldPaper) {
      lines.push(`Paper: ${paperInfo.labels.length ? paperInfo.labels.join(" / ") : allText}`);
    }
    if (this.exportSummaryFieldYear) {
      lines.push(`Year: ${expandedYears.length ? expandedYears.join(" / ") : allText}`);
    }
    if (this.exportSummaryFieldSeason) {
      lines.push(`Season: ${expandedSeasons.length ? expandedSeasons.join(" / ") : allText}`);
    }
    if (this.exportSummaryFieldFavorites) {
      lines.push(`Favorites: ${this.filterFavOnly ? "Yes" : "No"}    Exclude Multi: ${this.filterExcludeMultiSection ? "Yes" : "No"}`);
    }
    if (this.exportSummaryFieldCount) {
      lines.push(`Count: ${idsCount || 0}`);
    }
    return lines;
  },
  async editExportSaveDir() {
    const current = String(this.exportDefaultSaveDir || "").trim();
    try {
      const resp = await api("/export/pick_save_dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: current || null }),
      });
      if (!resp || resp.cancelled) return;
      const picked = String(resp.selected || "").trim();
      if (!picked) return;
      this.exportDefaultSaveDir = picked;
      if (this.updateExportDefaultSaveDir) this.updateExportDefaultSaveDir();
      return;
    } catch {
      const next = prompt("默认另存目录（可为空）", current);
      if (next == null) return;
      this.exportDefaultSaveDir = String(next || "").trim();
      if (this.updateExportDefaultSaveDir) this.updateExportDefaultSaveDir();
    }
  },
  async prepareFilterExportIds() {
    this.exportBusy = true;
    this.pendingExportIds = [];
    this.exportWizardSummary = "正在统计可导出题目…";
    try {
      let ids = [];
      const cacheKey = this.buildFilterExportCacheKey();
      if (
        cacheKey &&
        this.exportFilterIdsCacheKey === cacheKey &&
        Array.isArray(this.exportFilterIdsCacheIds) &&
        (Date.now() - Number(this.exportFilterIdsCacheAt || 0)) <= this.getExportCacheTtlMs()
      ) {
        ids = [...this.exportFilterIdsCacheIds];
        this.bumpExportCacheStat("hit");
      } else {
        if (
          cacheKey &&
          this.exportFilterIdsCacheKey === cacheKey &&
          Array.isArray(this.exportFilterIdsCacheIds) &&
          this.exportFilterIdsCacheIds.length
        ) {
          this.bumpExportCacheStat("expired");
        }
        const persisted = this.loadPersistedFilterExportIds(cacheKey);
        if (persisted && persisted.length) {
          ids = [...persisted];
          this.bumpExportCacheStat("hit");
        } else {
          this.bumpExportCacheStat("miss");
          ids = await this.collectAllFilteredQuestionIds();
          this.savePersistedFilterExportIds(cacheKey, ids);
        }
        this.exportFilterIdsCacheKey = cacheKey;
        this.exportFilterIdsCacheIds = [...ids];
        this.exportFilterIdsCacheAt = Date.now();
      }
      this.pendingExportIds = ids;
      this.exportWizardSummary = `筛选模式：共 ${ids.length} 题`;
      const shouldRefreshRecommended = !this.exportFileName || this.exportFileName === this.exportRecommendedName;
      if (shouldRefreshRecommended) {
        const name = this.buildRecommendedExportFileName({ idsCount: ids.length, fromRandom: false });
        this.exportFileName = name;
        this.exportRecommendedName = name;
      }
      if (!ids.length) this.setStatus("没有可导出的题目", "err");
      return ids;
    } catch (e) {
      this.pendingExportIds = [];
      this.exportWizardSummary = "统计失败";
      this.setStatus(String(e), "err");
      return [];
    } finally {
      this.exportBusy = false;
      this.refreshExportCacheOverview();
    }
  },
  async exportFilterPdf() {
    this.clearExportPolling();
    this.resetExportJobState();
    this.hydrateExportWizardOptions();
    this.exportFromRandomMode = false;
    const initName = this.buildRecommendedExportFileName({ idsCount: 0, fromRandom: false });
    this.exportFileName = initName;
    this.exportRecommendedName = initName;
    if (this.exportNameTemplateError) {
      this.setStatus(`${this.exportNameTemplateError}，已回退为默认模板`, "info");
    }

    if (this.filterMultiSelect && this.selectedQuestionIds.size > 0) {
      const ids = Array.from(this.selectedQuestionIds);
      if (!ids.length) {
        this.setStatus("没有可导出的题目", "err");
        return;
      }
      this.exportWizardSummary = `已选 ${ids.length} 题`;
      this.pendingExportIds = ids;
      const name = this.buildRecommendedExportFileName({ idsCount: ids.length, fromRandom: false });
      this.exportFileName = name;
      this.exportRecommendedName = name;
      this.exportBusy = false;
      this.exportWizardOpen = true;
      return;
    }

    // Open dialog first, then calculate asynchronously to keep UI responsive.
    this.exportWizardOpen = true;
    this.prepareFilterExportIds().catch(() => {});
  },
  async exportQuestionsPdfByIds(ids, options) {
    const safeIds = (ids || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (!safeIds.length) {
      this.setStatus("\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u9898\u76ee", "err");
      return;
    }
    const saveDir = String(options?.save_dir || "").trim();
    this.clearExportPolling();
    this.resetExportJobState();
    this.setStatus(`\u6b63\u5728\u521b\u5efa\u5bfc\u51fa\u4efb\u52a1\uff08${safeIds.length} \u9898\uff09`, "info");

    const createData = await api("/export/questions_pdf_job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: safeIds, options: options || null }),
    });
    const jobId = String(createData?.job_id || "");
    if (!jobId) throw new Error("\u5bfc\u51fa\u4efb\u52a1\u521b\u5efa\u5931\u8d25\uff1a\u672a\u8fd4\u56de\u4efb\u52a1 ID");
    this.exportJobId = jobId;
    this.updateExportJobProgress({
      status: createData?.status || "queued",
      queue_position: createData?.queue_position || 0,
      phase: "\u6392\u961f\u4e2d",
      progress: { done: 0, total: 3, percent: 0 },
    });

    const doneData = await this.pollExportJobUntilDone(jobId);
    if (this.exportJobId !== jobId) throw new Error("\u5bfc\u51fa\u4efb\u52a1\u72b6\u6001\u5df2\u5931\u6548");

    const savedCopyPath = String(doneData?.saved_copy_path || "");
    const url = String(doneData?.download_url || "");
    if (saveDir) {
      if (!savedCopyPath) throw new Error("\u5bfc\u51fa\u5b8c\u6210\uff0c\u4f46\u672a\u8fd4\u56de\u4fdd\u5b58\u8def\u5f84");
      this.setStatus(`\u5df2\u4fdd\u5b58\u5230\uff1a${savedCopyPath}`, "ok");
      return;
    }
    if (!url) throw new Error("\u5bfc\u51fa\u5b8c\u6210\uff0c\u4f46\u672a\u8fd4\u56de\u4e0b\u8f7d\u94fe\u63a5");
    if (savedCopyPath) this.setStatus(`\u5df2\u4fdd\u5b58\u5e76\u5f00\u59cb\u4e0b\u8f7d\uff1a${savedCopyPath}`, "ok");
    else this.setStatus("\u5bfc\u51fa\u5b8c\u6210\uff0c\u5f00\u59cb\u4e0b\u8f7d", "ok");
    this.triggerDownload(url);
  },
  async confirmExportWizard() {
    try {
      if (this.exportBusy) {
        this.setStatus("正在统计题目，请稍后…", "info");
        return;
      }
      const ids = Array.isArray(this.pendingExportIds) ? this.pendingExportIds : [];
      if (!ids.length) {
        this.setStatus("没有可导出的题目", "err");
        return;
      }
      if (ids.length > 200) {
        const ok = window.confirm(`当前导出共 ${ids.length} 题，生成 PDF 可能需要较长时间，是否继续？`);
        if (!ok) {
          this.setStatus("已取消导出", "info");
          return;
        }
      }
      if (!this.exportFileName) {
        const name = this.buildRecommendedExportFileName({ idsCount: ids.length, fromRandom: !!this.exportFromRandomMode });
        this.exportFileName = name;
        this.exportRecommendedName = name;
      }
      const filterSection = this.filterSection ? String(this.filterSection).trim() : "";
      const placement = this.exportAnsPlacement === "interleaved" ? "interleaved" : "end";
      const filenameInput = this.exportFileName ? String(this.exportFileName).trim() : "";
      const shouldCommitSeq = this.templateUsesSeq(this.exportNameTemplate) && filenameInput && filenameInput === this.exportRecommendedName;
      const selectedSummaryLines = ((!this.exportFromRandomMode) && this.exportIncludeFilterSummary)
        ? this.buildExportFilterSummaryLines(ids.length)
        : [];
      const shouldIncludeSummary = ((!this.exportFromRandomMode) && this.exportIncludeFilterSummary && selectedSummaryLines.length > 0);
      const options = {
        include_question_no: this.exportIncludeQno,
        include_section: this.exportIncludeSection,
        include_paper: this.exportIncludePaper,
        include_original_qno: this.exportIncludeOriginalQno,
        include_notes: this.exportIncludeNotes,
        include_answers: !!this.exportIncludeAnswers,
        answers_placement: placement,
        filter_section: filterSection || null,
        filename: filenameInput || null,
        save_dir: this.exportDefaultSaveDir ? String(this.exportDefaultSaveDir).trim() : null,
        include_filter_summary: shouldIncludeSummary,
        filter_summary_lines: selectedSummaryLines,
        crop_workers: Math.max(0, Number(this.exportCropWorkers || 0)),
      };
      if (!this.exportFromRandomMode) this.persistExportWizardOptions();
      this.exportBusy = true;
      await this.exportQuestionsPdfByIds(ids, options);
      if (shouldCommitSeq) this.commitExportSeq();
      this.exportWizardOpen = false;
      this.exportFromRandomMode = false;
    } catch (e) {
      this.setStatus(String(e), "err");
    } finally {
      this.exportBusy = false;
      this.clearExportPolling();
    }
  },
  // -------- random export --------
  async openRandomExportSettings() {
    try {
      this.exportBusy = false;
      const stats = await this.getSectionStats(this.randomExportFavOnly);
      this.randomExportSections = this.buildRandomExportSections(stats || []);
      this.randomExportGroups = this.buildRandomExportGroups(this.randomExportSections);
      this.randomExportGroupOpen = Object.fromEntries(
        (this.randomExportGroups || []).map((g) => [g.label, false])
      );
      this.randomExportYearList = this.buildRandomExportYearList();
      this.randomExportOpen = true;
    } catch (e) {
      this.setStatus("随机导出配置加载失败：" + String(e), "err");
    }
  },
  async onRandomExportFavOnlyChange() {
    try {
      const stats = await this.getSectionStats(this.randomExportFavOnly);
      const prev = new Map(this.randomExportSections.map((s) => [s.section, s]));
      this.randomExportSections = this.buildRandomExportSections(stats || [], prev);
      const nextGroups = this.buildRandomExportGroups(this.randomExportSections);
      const prevOpen = this.randomExportGroupOpen || {};
      const nextOpen = {};
      nextGroups.forEach((g) => { nextOpen[g.label] = prevOpen[g.label] ?? false; });
      this.randomExportGroups = nextGroups;
      this.randomExportGroupOpen = nextOpen;
      this.randomExportUpdateTotal();
    } catch (e) {
      this.setStatus("随机导出配置加载失败：" + String(e), "err");
    }
  },
  buildRandomExportGroups(sections) {
    const items = Array.isArray(sections) ? sections : [];
    if (!items.length) return [];
    const labelBySection = new Map();
    const orderedLabels = [];
    const groupsFromDefs = Array.isArray(this.sectionOptionGroupsAll) ? this.sectionOptionGroupsAll : [];
    for (const g of groupsFromDefs) {
      if (!g || !g.label) continue;
      orderedLabels.push(g.label);
      for (const opt of g.options || []) {
        labelBySection.set(opt, g.label);
      }
    }
    const fallbackLabel = "(未分类)";
    const groupMap = new Map();
    for (const item of items) {
      const label = labelBySection.get(item.section) || fallbackLabel;
      if (!groupMap.has(label)) groupMap.set(label, []);
      groupMap.get(label).push(item);
    }
    const out = [];
    for (const label of orderedLabels) {
      if (groupMap.has(label)) {
        const arr = groupMap.get(label);
        out.push({ label, items: arr, totalCount: arr.reduce((s, it) => s + (it.count || 0), 0) });
        groupMap.delete(label);
      }
    }
    for (const [label, arr] of groupMap.entries()) {
      out.push({ label, items: arr, totalCount: arr.reduce((s, it) => s + (it.count || 0), 0) });
    }
    return out;
  },
  buildRandomExportAliasMap() {
    const map = new Map();
    const names = Array.isArray(this.sectionNames) ? this.sectionNames : [];
    for (const name of names) {
      const label = this.sectionLabelMap?.[name] || name;
      if (label && label !== name) map.set(label, name);
    }
    return map;
  },
  buildRandomExportSections(stats, prevMap = null) {
    const items = Array.isArray(stats) ? stats : [];
    const aliasMap = this.buildRandomExportAliasMap();
    const merged = new Map();
    for (const item of items) {
      const raw = item?.section || "";
      const norm = aliasMap.get(raw) || raw;
      if (!merged.has(norm)) {
        merged.set(norm, {
          section: norm,
          count: 0,
          selected: false,
          value: 0,
          aliases: [],
        });
      }
      const entry = merged.get(norm);
      entry.count += item?.count || 0;
      entry.aliases.push({ name: raw, count: item?.count || 0 });
    }
    const prev = prevMap instanceof Map ? prevMap : new Map();
    for (const entry of merged.values()) {
      const old = prev.get(entry.section);
      if (old) {
        entry.selected = !!old.selected;
        entry.value = old.value || 0;
      }
    }
    return Array.from(merged.values());
  },
  isRandomExportGroupOpen(label) {
    return this.randomExportGroupOpen?.[label] === true;
  },
  toggleRandomExportGroup(label) {
    const cur = this.randomExportGroupOpen?.[label] === true;
    this.randomExportGroupOpen = { ...(this.randomExportGroupOpen || {}), [label]: !cur };
  },
  toggleRandomExportGroupSelectAll(group) {
    const items = group?.items || [];
    if (!items.length) return;
    const allSelected = items.every((s) => s.selected);
    items.forEach((s) => { s.selected = !allSelected; });
  },
  isRandomExportGroupAllSelected(group) {
    const items = group?.items || [];
    if (!items.length) return false;
    return items.every((s) => s.selected);
  },
  buildRandomExportYearList() {
    const years = new Set();
    this.papers.forEach((p) => {
      const year = extractYearFromPaperName(p);
      if (year) years.add(year);
    });
    return Array.from(years)
      .sort((a, b) => b - a)
      .map((y) => ({ year: y, checked: true }));
  },
  async getSectionStats(favoriteOnly = false) {
    const url = favoriteOnly ? "/section_stats?favorite_only=true" : "/section_stats";
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("获取分类库存失败");
    return await resp.json();
  },
  randomExportUpdateTotal() {
    const total = this.randomExportSections.reduce((sum, item) => sum + (parseInt(item.value, 10) || 0), 0);
    this.randomExportTotalCount = total;
  },
  randomExportSelectAll() {
    const allSelected = this.randomExportSections.every((s) => s.selected);
    this.randomExportSections.forEach((s) => { s.selected = !allSelected; });
  },
  randomExportBatch(delta) {
    const val = clampInt(this.randomExportBatchValue, 1, 9999);
    this.randomExportSections.forEach((s) => {
      if (!s.selected) return;
      const next = Math.max(0, (parseInt(s.value, 10) || 0) + delta * val);
      s.value = next;
    });
    this.randomExportUpdateTotal();
  },
  randomExportReset() {
    this.randomExportSections.forEach((s) => { s.value = 0; s.selected = false; });
    this.randomExportUpdateTotal();
  },
  async confirmRandomExport() {
    const config = {};
    for (const item of this.randomExportSections) {
      const count = Math.max(0, parseInt(item.value, 10) || 0);
      if (count <= 0) continue;
      const aliases = Array.isArray(item.aliases) && item.aliases.length
        ? item.aliases
        : [{ name: item.section, count: item.count || 0 }];
      if (aliases.length === 1) {
        const key = aliases[0].name || "";
        config[key] = (config[key] || 0) + count;
        continue;
      }
      const totalStock = aliases.reduce((sum, a) => sum + (a.count || 0), 0) || 0;
      let remaining = count;
      for (let i = 0; i < aliases.length; i++) {
        const alias = aliases[i];
        const key = alias.name || "";
        if (i === aliases.length - 1) {
          if (remaining > 0) config[key] = (config[key] || 0) + remaining;
          remaining = 0;
          break;
        }
        const share = totalStock > 0 ? Math.round(count * (alias.count || 0) / totalStock) : 0;
        const applied = Math.min(share, remaining);
        if (applied > 0) config[key] = (config[key] || 0) + applied;
        remaining -= applied;
      }
    }
    if (Object.keys(config).length === 0) {
      alert("请先给至少一个分类设置题量");
      return;
    }
    this.pendingExportIds = [];
    this.randomExportConfig = config;
    this.randomExportFavoriteOnly = !!this.randomExportFavOnly;
    this.randomExportExcludeYears = this.randomExportYearList.filter((y) => !y.checked).map((y) => y.year);
    try {
      const totalCount = Object.values(config).reduce((sum, val) => sum + val, 0);
      const sections = Object.keys(config).map((s) => s || "(未分类)").join("、");
      const favText = this.randomExportFavoriteOnly ? "（仅收藏）" : "";
      this.exportWizardSummary = `随机导出模式${favText}：共 ${totalCount} 题，分类:${sections}`;
      const ids = await this.getRandomExportIds(config, this.randomExportFavoriteOnly, this.randomExportExcludeYears);
      if (!ids.length) {
        this.setStatus("没有可导出的题目", "err");
        return;
      }
      this.pendingExportIds = ids;
      this.exportFromRandomMode = true;
      this.exportIncludeFilterSummary = false;
      const name = this.buildRecommendedExportFileName({ idsCount: ids.length, fromRandom: true });
      this.exportFileName = name;
      this.exportRecommendedName = name;
      if (this.exportNameTemplateError) {
        this.setStatus(`${this.exportNameTemplateError}，已回退为默认模板`, "info");
      }
      this.exportBusy = false;
      this.clearExportPolling();
      this.resetExportJobState();
      this.randomExportOpen = false;
      this.exportWizardOpen = true;
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async getRandomExportIds(config, favoriteOnly, excludeYears) {
    const resp = await api(`/random_by_sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sections: config,
        favorite_only: !!favoriteOnly,
        exclude_years: excludeYears || [],
      }),
    });
    return resp.question_ids || [];
  },
  
  // -------- answer mode --------
};

