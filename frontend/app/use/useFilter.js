import { useAppContext } from "./useAppContext.js";
import { api } from "../../modules/api.js";
import { clampInt } from "../../modules/utils.js";
import * as Settings from "../../modules/settings.js";

export const useFilter = () => {
  return useAppContext();
};

const FILTER_PRESET_KEY = "setting:filterPresets";

export const filterMethods = {
  loadFilterPresets() {
    try {
      const raw = localStorage.getItem(FILTER_PRESET_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this.filterPresets = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.filterPresets = [];
    }
  },
  saveFilterPresetsToStorage() {
    try {
      localStorage.setItem(FILTER_PRESET_KEY, JSON.stringify(this.filterPresets || []));
    } catch {}
  },
  saveCurrentFilterPreset() {
    const name = String(this.filterPresetNameInput || "").trim();
    if (!name) {
      this.setStatus("请先输入预设名称", "err");
      return;
    }
    const payload = {
      name,
      filterSection: this.filterSection || "",
      filterPaperMulti: Array.isArray(this.filterPaperMulti) ? [...this.filterPaperMulti] : [],
      filterYearMulti: Array.isArray(this.filterYearMulti) ? [...this.filterYearMulti] : [],
      filterSeasonMulti: Array.isArray(this.filterSeasonMulti) ? [...this.filterSeasonMulti] : [],
      filterFavOnly: !!this.filterFavOnly,
      filterExcludeMultiSection: !!this.filterExcludeMultiSection,
    };
    const next = (this.filterPresets || []).filter((x) => x?.name !== name);
    next.unshift(payload);
    this.filterPresets = next.slice(0, 20);
    this.filterPresetSelected = name;
    this.saveFilterPresetsToStorage();
    this.setStatus(`已保存筛选预设：${name}`, "ok");
  },
  async applyFilterPreset(name) {
    const key = String(name || "").trim();
    if (!key) return;
    const p = (this.filterPresets || []).find((x) => x?.name === key);
    if (!p) return;
    this.filterSection = p.filterSection || "";
    this.filterPaperMulti = Array.isArray(p.filterPaperMulti) ? [...p.filterPaperMulti] : [];
    this.filterYearMulti = Array.isArray(p.filterYearMulti) ? [...p.filterYearMulti] : [];
    this.filterSeasonMulti = Array.isArray(p.filterSeasonMulti) ? [...p.filterSeasonMulti] : [];
    this.filterFavOnly = !!p.filterFavOnly;
    this.filterExcludeMultiSection = !!p.filterExcludeMultiSection;
    this.filterPage = 1;
    this.filterPresetSelected = key;
    await this.runFilter();
    this.setStatus(`已应用筛选预设：${key}`, "ok");
  },
  deleteFilterPreset(name) {
    const key = String(name || "").trim();
    if (!key) return;
    const before = this.filterPresets || [];
    this.filterPresets = before.filter((x) => x?.name !== key);
    if (this.filterPresetSelected === key) this.filterPresetSelected = "";
    this.saveFilterPresetsToStorage();
    this.setStatus(`已删除筛选预设：${key}`, "ok");
  },
  markQuestionDatasetChanged() {
    if (typeof this.invalidateExportFilterCache === "function") {
      this.invalidateExportFilterCache();
    }
  },
  clearFilterWarmupTimer() {
    try {
      if (this._filterWarmupTimer) clearTimeout(this._filterWarmupTimer);
    } catch {}
    this._filterWarmupTimer = null;
  },
  scheduleFilterExportIdsWarmup(delayMs = 900) {
    this.clearFilterWarmupTimer();
    const cacheKey = typeof this.buildFilterExportCacheKey === "function"
      ? this.buildFilterExportCacheKey()
      : "";
    if (!cacheKey) return;
    const hasMemoryCache =
      this.exportFilterIdsCacheKey === cacheKey &&
      Array.isArray(this.exportFilterIdsCacheIds) &&
      this.exportFilterIdsCacheIds.length > 0;
    if (hasMemoryCache) return;
    const hasPersisted = typeof this.loadPersistedFilterExportIds === "function"
      ? this.loadPersistedFilterExportIds(cacheKey)
      : null;
    if (Array.isArray(hasPersisted) && hasPersisted.length > 0) return;
    this._filterWarmupTimer = setTimeout(async () => {
      this._filterWarmupTimer = null;
      if (this._filterWarmupKeyInFlight === cacheKey) return;
      this._filterWarmupKeyInFlight = cacheKey;
      try {
        const ids = await this.collectAllFilteredQuestionIds();
        if (this._filterRunSeq <= 0) return;
        const currentKey = typeof this.buildFilterExportCacheKey === "function"
          ? this.buildFilterExportCacheKey()
          : "";
        if (currentKey !== cacheKey) return;
        this.exportFilterIdsCacheKey = cacheKey;
        this.exportFilterIdsCacheIds = [...ids];
        this.exportFilterIdsCacheAt = Date.now();
        if (typeof this.savePersistedFilterExportIds === "function") {
          this.savePersistedFilterExportIds(cacheKey, ids);
        }
      } catch {}
      finally {
        this._filterWarmupKeyInFlight = "";
      }
    }, Math.max(0, Number(delayMs) || 0));
  },
  scheduleRunFilter(delayMs = 220) {
    try {
      if (this._filterRunDebounceTimer) clearTimeout(this._filterRunDebounceTimer);
    } catch {}
    this._filterRunDebounceTimer = setTimeout(() => {
      this._filterRunDebounceTimer = null;
      this.runFilter().catch((e) => this.setStatus(String(e), "err"));
    }, Math.max(0, Number(delayMs) || 0));
  },
  abortRunningFilterRequest() {
    const ctrl = this._filterAbortController;
    if (!ctrl) return;
    try { ctrl.abort(); } catch {}
    this._filterAbortController = null;
  },
  pruneCurrentExportCacheByQuestion(qid, stillMatch) {
    const id = Number(qid);
    if (!Number.isFinite(id)) return;
    if (stillMatch) return;

    const cacheKey = typeof this.buildFilterExportCacheKey === "function"
      ? this.buildFilterExportCacheKey()
      : "";
    if (!cacheKey) return;

    if (this.exportFilterIdsCacheKey === cacheKey && Array.isArray(this.exportFilterIdsCacheIds)) {
      this.exportFilterIdsCacheIds = this.exportFilterIdsCacheIds.filter((x) => Number(x) !== id);
    }
    if (Array.isArray(this.pendingExportIds)) {
      this.pendingExportIds = this.pendingExportIds.filter((x) => Number(x) !== id);
    }
    try {
      const raw = localStorage.getItem("cache:exportFilterIdsByKey");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const item = parsed[cacheKey];
      if (!item || !Array.isArray(item.ids)) return;
      item.ids = item.ids.filter((x) => Number(x) !== id);
      parsed[cacheKey] = item;
      localStorage.setItem("cache:exportFilterIdsByKey", JSON.stringify(parsed));
    } catch {}
  },
  shouldQuestionRemainInCurrentFilter(sections, isFavorite) {
    const sectionList = Array.isArray(sections)
      ? sections.filter(Boolean).map((s) => String(s))
      : [];
    if (this.filterFavOnly && !isFavorite) return false;
    if (this.filterExcludeMultiSection && sectionList.length > 1) return false;
    if (this.filterSection === "__UNSET__") return sectionList.length === 0;
    if (this.filterSection) return sectionList.includes(String(this.filterSection));
    return true;
  },
  getFilterScrollContainer() {
    const right = this.$refs.rightScroll;
    if (right && right.scrollHeight > right.clientHeight + 1) return right;
    return document.scrollingElement || document.documentElement;
  },
  getFilterScrollRoot() {
    const right = this.$refs.rightScroll;
    if (right && right.scrollHeight > right.clientHeight + 1) return right;
    return document;
  },
  scrollFilterContainerTo(top, behavior = "auto") {
    const container = this.getFilterScrollContainer();
    if (!container) return;
    const isDoc =
      container === document.body ||
      container === document.documentElement ||
      container === document.scrollingElement;
    if (isDoc) {
      window.scrollTo({ top, behavior });
      return;
    }
    if (container.scrollTo) {
      container.scrollTo({ top, behavior });
    } else {
      container.scrollTop = top;
    }
  },
  onFilterChange() {
    this.filterPaper = Array.isArray(this.filterPaperMulti) && this.filterPaperMulti.length ? String(this.filterPaperMulti[0]) : "";
    this.filterYear = Array.isArray(this.filterYearMulti) && this.filterYearMulti.length ? String(this.filterYearMulti[0]) : "";
    this.filterSeason = Array.isArray(this.filterSeasonMulti) && this.filterSeasonMulti.length ? String(this.filterSeasonMulti[0]) : "";
    this.filterPage = 1;
    this.scheduleRunFilter(220);
  },
  onFilterPageSizeChange() {
    const next = clampInt(this.filterPageSize, 1, 200);
    this.filterPageSize = next;
    Settings.saveFilterPageSize(next);
    this.filterPage = 1;
    this.runFilter().catch((e) => this.setStatus(String(e), "err"));
  },
  async runFilter() {
    if (this._filterRunDebounceTimer) {
      clearTimeout(this._filterRunDebounceTimer);
      this._filterRunDebounceTimer = null;
    }
    this.clearFilterWarmupTimer();
    this.abortRunningFilterRequest();
    const reqSeq = Number(this._filterRunSeq || 0) + 1;
    this._filterRunSeq = reqSeq;
    this.filterLoading = true;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    this._filterAbortController = controller;
    this.setStatus("筛选中…");
    let data;
    try {
      data = await this.requestFilterSearch({
        page: this.filterPage,
        pageSize: this.filterPageSize,
        idsOnly: false,
        signal: controller ? controller.signal : null,
      });
    } catch (e) {
      if (e?.name === "AbortError") return;
      throw e;
    } finally {
      if (this._filterAbortController === controller) this._filterAbortController = null;
      this.filterLoading = false;
    }
    if (reqSeq !== this._filterRunSeq) return;
    const qs = data.questions || [];
    const total = data.total != null ? Number(data.total) : qs.length;
    const page = data.page != null ? Number(data.page) : this.filterPage;
    const pageSize = data.page_size != null ? Number(data.page_size) : this.filterPageSize;
    const totalPages = data.total_pages != null ? Number(data.total_pages) : Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    this.filterPage = page;
    this.filterTotal = total;
    this.filterTotalPages = totalPages;

    this.filterResults = (qs || []).map((q) => ({
      ...q,
      __editOpen: false,
      __ansOpen: false,
      __ansLoaded: false,
      __ansBoxes: [],
      __ansMeta: "Not loaded",
      __editSections: q.sections && Array.isArray(q.sections) ? [...q.sections] : (q.section ? [q.section] : []),
      __editNotes: q.notes || "",
      __notesOpen: false,
    }));

    if (!qs.length) {
      this.setStatus("筛选完成：0", "ok");
      return;
    }
    this.setStatus(`筛选完成：${qs.length}`, "ok");
    this.scheduleFilterExportIdsWarmup(700);
  },
  buildFilterSearchParams({ page, pageSize }) {
    const params = new URLSearchParams();
    const section = this.filterSection;
    const selectedPaperIds = Array.isArray(this.filterPaperMulti) && this.filterPaperMulti.length
      ? this.filterPaperMulti
      : (this.filterPaper ? [this.filterPaper] : []);
    const selectedYears = Array.isArray(this.filterYearMulti) && this.filterYearMulti.length
      ? this.filterYearMulti
      : (this.filterYear ? [this.filterYear] : []);
    const selectedSeasons = Array.isArray(this.filterSeasonMulti) && this.filterSeasonMulti.length
      ? this.filterSeasonMulti
      : (this.filterSeason ? [this.filterSeason] : []);
    const allPaperIds = (this.filterPaperOptions || []).map((o) => String(o.value));
    const allYears = (this.filterYearOptions || []).map((y) => String(y));
    const allSeasons = ["m", "s", "w"];
    const paperIds = selectedPaperIds.map((v) => String(v)).filter((v) => v);
    const years = selectedYears.map((v) => String(v)).filter((v) => v);
    const seasons = selectedSeasons.map((v) => String(v).toLowerCase()).filter((v) => v);
    const usePaperFilter = paperIds.length > 0 && paperIds.length < allPaperIds.length;
    const useYearFilter = years.length > 0 && years.length < allYears.length;
    const useSeasonFilter = seasons.length > 0 && seasons.length < allSeasons.length;
    if (section === "__UNSET__") {
      params.set("unsectioned", "true");
    } else if (section) {
      params.set("section", section);
    }
    if (usePaperFilter) params.set("paper_ids", paperIds.join(","));
    if (useYearFilter) params.set("years", years.join(","));
    if (useSeasonFilter) params.set("seasons", seasons.join(","));
    if (this.filterFavOnly) params.set("favorite", "true");
    if (this.filterExcludeMultiSection) params.set("exclude_multi_section", "true");
    params.set("page", String(page || 1));
    params.set("page_size", String(pageSize || 10));
    return params;
  },
  buildFilterSearchPayload({ page, pageSize, idsOnly = false }) {
    const selectedPaperIds = Array.isArray(this.filterPaperMulti) && this.filterPaperMulti.length
      ? this.filterPaperMulti
      : (this.filterPaper ? [this.filterPaper] : []);
    const selectedYears = Array.isArray(this.filterYearMulti) && this.filterYearMulti.length
      ? this.filterYearMulti
      : (this.filterYear ? [this.filterYear] : []);
    const selectedSeasons = Array.isArray(this.filterSeasonMulti) && this.filterSeasonMulti.length
      ? this.filterSeasonMulti
      : (this.filterSeason ? [this.filterSeason] : []);
    const allPaperIds = (this.filterPaperOptions || []).map((o) => String(o.value));
    const allYears = (this.filterYearOptions || []).map((y) => String(y));
    const allSeasons = ["m", "s", "w"];

    let paperIds = selectedPaperIds.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    let years = selectedYears.map((x) => String(x)).filter(Boolean);
    let seasons = selectedSeasons.map((x) => String(x).toLowerCase()).filter(Boolean);

    if (paperIds.length >= allPaperIds.length) paperIds = [];
    if (years.length >= allYears.length) years = [];
    if (seasons.length >= allSeasons.length) seasons = [];

    return {
      section: this.filterSection === "__UNSET__" ? null : (this.filterSection || null),
      unsectioned: this.filterSection === "__UNSET__" ? true : null,
      paper_id: null,
      paper_ids: paperIds,
      years,
      seasons,
      favorite: this.filterFavOnly ? true : null,
      exclude_multi_section: this.filterExcludeMultiSection ? true : null,
      page: Number(page || 1),
      page_size: Number(pageSize || 10),
      ids_only: !!idsOnly,
    };
  },
  async requestFilterSearch({ page, pageSize, idsOnly = false, signal = null }) {
    const params = this.buildFilterSearchParams({ page, pageSize });
    if (!idsOnly && params.toString().length < 1200) {
      return api(`/questions?${params.toString()}`, signal ? { signal } : undefined);
    }
    const req = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.buildFilterSearchPayload({ page, pageSize, idsOnly })),
    };
    if (signal) req.signal = signal;
    return api("/questions/search", req);
  },
  toggleFilterMultiSelect() {
    this.filterMultiSelect = !this.filterMultiSelect;
    if (!this.filterMultiSelect) {
      this.selectedQuestionIds = new Set();
    }
  },
  toggleFilterSelection(q, evt) {
    const next = new Set(this.selectedQuestionIds);
    if (evt?.target?.checked) next.add(q.id);
    else next.delete(q.id);
    this.selectedQuestionIds = next;
  },
  toggleFilterItemSelection(q, evt) {
    if (!this.filterMultiSelect) return;
    const t = evt?.target;
    if (t && (t.closest?.("button") || t.closest?.("a") || t.closest?.("input") || t.closest?.("textarea") || t.closest?.("select"))) return;
    const next = new Set(this.selectedQuestionIds);
    if (next.has(q.id)) next.delete(q.id); else next.add(q.id);
    this.selectedQuestionIds = next;
  },
  async toggleFilterEdit(q) {
    q.__editOpen = !q.__editOpen;
    if (q.__editOpen) q.__notesOpen = false;
  },
  toggleFilterNotes(q) {
    if (!q) return;
    q.__notesOpen = !q.__notesOpen;
  },
  async saveFilterQuestionMeta(q, sections, notes) {
    try {
      const prevSections = Array.isArray(q.sections) ? [...q.sections] : (q.section ? [q.section] : []);
      this.setStatus(`保存题目 #${q.id} 中…`);
      await api(`/questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, notes }),
      });
      q.sections = sections;
      q.section = sections[0] || null;
      q.notes = notes;
      const changedSections =
        prevSections.length !== sections.length ||
        prevSections.some((s, i) => String(s) !== String(sections[i]));
      if (changedSections) {
        const keep = this.shouldQuestionRemainInCurrentFilter(sections, !!q.is_favorite);
        this.pruneCurrentExportCacheByQuestion(q.id, keep);
        this.markQuestionDatasetChanged();
      }
      this.setStatus("已保存", "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  onFilterSectionsChange(q, sections) {
    q.__editSections = sections;
    this.saveFilterQuestionMeta(q, sections, q.__editNotes);
  },
  onFilterNotesBlur(q) {
    this.saveFilterQuestionMeta(q, q.__editSections, q.__editNotes);
  },
  async toggleFilterAnswer(q) {
    if (q.__ansOpen) {
      q.__ansOpen = false;
      return;
    }
    q.__ansOpen = true;
    if (q.__ansLoaded) return;
    q.__ansMeta = "Loading...";
    try {
      const d = await api(`/questions/${q.id}/answer`);
      const a = d.answer;
      if (!a) {
        q.__ansMeta = "No answer";
        q.__ansBoxes = [];
        q.__ansLoaded = true;
        return;
      }
      const ab = a.boxes || [];
      q.__ansMeta = `Boxes: ${ab.length} · MS#${a.ms_paper_id}`;
      q.__ansBoxes = ab.map((b) => ({ image_url: b.image_url, bbox: b.bbox }));
      q.__ansLoaded = true;
    } catch (e) {
      q.__ansMeta = "Load failed";
    }
  },
  async toggleFavorite(q) {
    try {
      const next = !q.is_favorite;
      this.setStatus(`${next ? "收藏" : "取消收藏"} 题目 #${q.id} 中…`);
      await api(`/questions/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_favorite: next }),
      });
      q.is_favorite = next;
      const sections = Array.isArray(q.sections) ? q.sections : (q.section ? [q.section] : []);
      const keep = this.shouldQuestionRemainInCurrentFilter(sections, next);
      this.pruneCurrentExportCacheByQuestion(q.id, keep);
      this.markQuestionDatasetChanged();
      this.setStatus("已更新", "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async jumpToQuestionFromFilter(q) {
    if (!q.paper_id) return;
    this.navStack.push({ kind: "filter", state: this.captureFilterState() });
    await this.openPaper(q.paper_id);
    const targetPage = q.boxes?.[0]?.page ?? 1;
    const idx = this.pages.findIndex((p) => p.page === targetPage);
    if (idx >= 0) await this.gotoPageIndex(idx);
    this.drawOverlay();
    this.$nextTick(() => {
      this.scrollFilterContainerTo(0, "smooth");
    });
  },
  async editQuestionBoxesFromFilter(q) {
    this.filterReturnQid = q?.id ?? null;
    await this.jumpToQuestionFromFilter(q);
    await this.editQuestion(q);
  },
  async editAnswerBoxesFromFilter(q) {
    this.navStack.push({ kind: "filter", state: this.captureFilterState() });
    this.filterReturnQid = q?.id ?? null;
    if (q?.paper_id && this.currentPaperId !== q.paper_id) {
      await this.openPaper(q.paper_id);
    }
    this.answerReplaceMode = true;
    this.answerReplaceQuestionId = q?.id ?? null;
    await this.openAnswerMode(null, q.id);
  },
  async deleteFilterQuestion(q) {
    if (!confirm(`确认删除题目 #${q.id}？`)) return;
    try {
      this.setStatus(`删除题目 #${q.id} 中…`);
      await api(`/questions/${q.id}`, { method: "DELETE" });
      this.pruneCurrentExportCacheByQuestion(q.id, false);
      this.markQuestionDatasetChanged();
      this.setStatus("已删除", "ok");
      await this.runFilter();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  captureFilterState() {
    const right = this.getFilterScrollContainer();
    return {
      section: this.filterSection,
      paper: this.filterPaper,
      paperMulti: Array.isArray(this.filterPaperMulti) ? [...this.filterPaperMulti] : [],
      year: this.filterYear,
      yearMulti: Array.isArray(this.filterYearMulti) ? [...this.filterYearMulti] : [],
      season: this.filterSeason,
      seasonMulti: Array.isArray(this.filterSeasonMulti) ? [...this.filterSeasonMulti] : [],
      favOnly: this.filterFavOnly,
      excludeMultiSection: this.filterExcludeMultiSection,
      page: this.filterPage,
      pageSize: this.filterPageSize,
      questionNoInput: this.filterQuestionNoInput,
      scrollTop: right ? right.scrollTop : 0,
    };
  },
  async restoreFilterState(state) {
    this.showFilterView();
    this.filterSection = state.section || "";
    this.filterPaper = state.paper || "";
    this.filterPaperMulti = Array.isArray(state.paperMulti) ? [...state.paperMulti] : (this.filterPaper ? [this.filterPaper] : []);
    this.filterYear = state.year || "";
    this.filterYearMulti = Array.isArray(state.yearMulti) ? [...state.yearMulti] : (this.filterYear ? [this.filterYear] : []);
    this.filterSeason = state.season || "";
    this.filterSeasonMulti = Array.isArray(state.seasonMulti) ? [...state.seasonMulti] : (this.filterSeason ? [this.filterSeason] : []);
    this.filterFavOnly = !!state.favOnly;
    this.filterExcludeMultiSection = !!state.excludeMultiSection;
    this.filterPage = state.page || 1;
    this.filterPageSize = state.pageSize || this.filterPageSize;
    this.filterQuestionNoInput = state.questionNoInput || "";
    await this.runFilter();
    this.$nextTick(() => {
      this.scrollFilterContainerTo(state.scrollTop || 0, "auto");
    });
  },
  scrollToFilterQuestion(qid) {
    if (qid == null) return;
    const virtualView = this.$refs?.filterView;
    if (virtualView?.scrollToVirtualQuestion?.(qid)) {
      this.$nextTick(() => {
        const root = this.getFilterScrollRoot();
        const el = root?.querySelector?.(`[data-qid="${qid}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "auto", block: "center" });
      });
      return;
    }
    const root = this.getFilterScrollRoot();
    const el = root?.querySelector?.(`[data-qid="${qid}"]`);
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: "auto", block: "center" });
    }
  },
  async returnToFilterFromNavStack() {
    const last = this.navStack.pop();
    if (!last || last.kind !== "filter") {
      if (this.filterReturnQid != null) this.filterReturnQid = null;
      return false;
    }
    await this.restoreFilterState(last.state);
    await this.$nextTick();
    if (this.filterReturnQid != null) {
      this.scrollToFilterQuestion(this.filterReturnQid);
      this.filterReturnQid = null;
    }
    return true;
  },
  async filterPrevPage() {
    if (this.filterPage <= 1) return;
    this.filterPage -= 1;
    this.scrollFilterContainerTo(0, "auto");
    await this.runFilter();
  },
  async filterNextPage() {
    if (this.filterPage >= this.filterTotalPages) return;
    this.filterPage += 1;
    this.scrollFilterContainerTo(0, "auto");
    await this.runFilter();
  },
  async filterJumpPage() {
    const n = clampInt(this.filterJumpPageInput, 1, this.filterTotalPages || 1);
    this.filterPage = n;
    await this.runFilter();
  },
  async jumpToQuestionNoFromFilter() {
    const raw = String(this.filterQuestionNoInput || "").trim();
    if (!raw) return;
    try {
      this.setStatus(`定位题号 ${raw} 中…`);
      const selectedPaperIds = Array.isArray(this.filterPaperMulti) && this.filterPaperMulti.length
        ? this.filterPaperMulti.map((x) => Number(x)).filter((x) => Number.isFinite(x))
        : (this.filterPaper ? [Number(this.filterPaper)].filter((x) => Number.isFinite(x)) : []);
      const localNo = Number(raw);

      // 优先：当只选择了 1 张试卷且输入为数字时，按“该试卷内第 N 题”定位（不是全库 question_no）。
      if (selectedPaperIds.length === 1 && Number.isInteger(localNo) && localNo > 0) {
        const paperId = selectedPaperIds[0];
        const paperData = await api(`/papers/${paperId}/questions`);
        const rows = Array.isArray(paperData?.questions) ? [...paperData.questions] : [];
        if (!rows.length) {
          this.setStatus(`当前试卷没有可定位题目：${raw}`, "err");
          return;
        }
        rows.sort((a, b) => {
          const aBox = Array.isArray(a?.boxes) && a.boxes.length ? a.boxes[0] : null;
          const bBox = Array.isArray(b?.boxes) && b.boxes.length ? b.boxes[0] : null;
          const ap = Number(aBox?.page || 0);
          const bp = Number(bBox?.page || 0);
          if (ap !== bp) return ap - bp;
          const ay = Number(aBox?.bbox?.[1] || 0);
          const by = Number(bBox?.bbox?.[1] || 0);
          if (ay !== by) return ay - by;
          return Number(a?.id || 0) - Number(b?.id || 0);
        });
        const target = rows[localNo - 1];
        if (!target?.id) {
          this.setStatus(`试卷内题号超出范围：${raw}（共 ${rows.length} 题）`, "err");
          return;
        }
        const currentIds = await this.collectAllFilteredQuestionIds();
        if (!currentIds.includes(Number(target.id))) {
          // 当前筛选排除了目标题，保留试卷筛选，清空其余条件。
          this.filterSection = "";
          this.filterYear = "";
          this.filterYearMulti = [];
          this.filterSeason = "";
          this.filterSeasonMulti = [];
          this.filterFavOnly = false;
          this.filterExcludeMultiSection = false;
        }
        const ids = await this.collectAllFilteredQuestionIds();
        const idx = ids.indexOf(Number(target.id));
        if (idx < 0) {
          this.setStatus(`未找到试卷内题号：${raw}`, "err");
          return;
        }
        const page = Math.floor(idx / Math.max(1, this.filterPageSize)) + 1;
        this.filterPage = page;
        await this.runFilter();
        this.scrollToFilterQuestion(target.id);
        this.setStatus(`已定位试卷内题号：${raw}`, "ok");
        return;
      }

      const lookupParams = new URLSearchParams();
      lookupParams.set("question_no", raw);
      lookupParams.set("page", "1");
      lookupParams.set("page_size", "1");
      const lookup = await api(`/questions?${lookupParams.toString()}`);
      const q = lookup?.questions?.[0];
      if (!q || q.id == null) {
        this.setStatus(`未找到题号：${raw}`, "err");
        return;
      }
      const ids = await this.collectAllFilteredQuestionIds();
      let idx = ids.indexOf(q.id);
      if (idx < 0) {
        this.setStatus("题号不在当前筛选条件，已清空筛选", "info");
        this.filterSection = "";
        this.filterPaper = "";
        this.filterPaperMulti = [];
        this.filterYear = "";
        this.filterYearMulti = [];
        this.filterSeason = "";
        this.filterSeasonMulti = [];
        this.filterFavOnly = false;
        this.filterExcludeMultiSection = false;
        const allIds = await this.collectAllFilteredQuestionIds();
        idx = allIds.indexOf(q.id);
        if (idx < 0) {
          this.setStatus(`未找到题号：${raw}`, "err");
          return;
        }
      }
      const page = Math.floor(idx / Math.max(1, this.filterPageSize)) + 1;
      this.filterPage = page;
      await this.runFilter();
      this.scrollToFilterQuestion(q.id);
      this.setStatus(`已定位题号：${raw}`, "ok");
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async collectAllFilteredQuestionIds() {
    const ids = [];
    let page = 1;
    let totalPages = 1;
    do {
      const data = await this.requestFilterSearch({
        page,
        pageSize: 1000,
        idsOnly: true,
      });
      const pageIds = Array.isArray(data?.question_ids)
        ? data.question_ids
        : (Array.isArray(data?.questions) ? data.questions.map((q) => q.id) : []);
      ids.push(...pageIds.map((x) => Number(x)).filter((x) => Number.isFinite(x)));
      totalPages = Number(data.total_pages || 1);
      page += 1;
    } while (page <= totalPages);
    return ids;
  },
  async applyBatchSection() {
    const ids = Array.from(this.selectedQuestionIds);
    if (!ids.length) {
      this.setStatus("未选择题目", "err");
      return;
    }
    if (!this.filterBatchSection) {
      this.setStatus("请先选择模块", "err");
      return;
    }
    try {
      this.setStatus(`批量改模块中（${ids.length} 题）`);
      await api(`/questions/batch_update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, sections: [this.filterBatchSection] }),
      });
      for (const id of ids) {
        const q = this.filterResults.find((x) => x.id === id);
        if (!q) continue;
        q.sections = [this.filterBatchSection];
        q.section = this.filterBatchSection;
        q.__editSections = [this.filterBatchSection];
        const keep = this.shouldQuestionRemainInCurrentFilter([this.filterBatchSection], !!q.is_favorite);
        this.pruneCurrentExportCacheByQuestion(id, keep);
      }
      this.markQuestionDatasetChanged();
      this.setStatus("批量改模块完成", "ok");
      await this.runFilter();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async batchFavorite(isFav) {
    const ids = Array.from(this.selectedQuestionIds);
    if (!ids.length) {
      this.setStatus("未选择题目", "err");
      return;
    }
    try {
      this.setStatus(`${isFav ? "批量收藏" : "批量取消收藏"}（${ids.length} 题）…`);
      await api(`/questions/batch_update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, is_favorite: !!isFav }),
      });
      for (const id of ids) {
        const q = this.filterResults.find((x) => x.id === id);
        if (!q) continue;
        q.is_favorite = !!isFav;
        const sections = Array.isArray(q.sections) ? q.sections : (q.section ? [q.section] : []);
        const keep = this.shouldQuestionRemainInCurrentFilter(sections, !!isFav);
        this.pruneCurrentExportCacheByQuestion(id, keep);
      }
      this.markQuestionDatasetChanged();
      this.setStatus(isFav ? "批量收藏完成" : "批量取消收藏完成", "ok");
      await this.runFilter();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },

  // -------- export --------
  showAllFilterAnswers() {
    this.filterResults.forEach((q) => {
      q.__ansOpen = false;
      this.toggleFilterAnswer(q);
    });
  },
  hideAllFilterAnswers() {
    this.filterResults.forEach((q) => { q.__ansOpen = false; });
  },
};

