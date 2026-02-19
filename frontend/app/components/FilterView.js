import { useFilter } from "../use/useFilter.js";
import SectionCascadeSelect from "./SectionCascadeSelect.js";
import MultiSelect from "./MultiSelect.js";
import PaperCascadeMultiSelect from "./PaperCascadeMultiSelect.js";
import FilterQuestionCard from "./FilterQuestionCard.js";

export default {
  name: "FilterView",
  components: { SectionCascadeSelect, MultiSelect, PaperCascadeMultiSelect, FilterQuestionCard },
  setup() {
    return useFilter();
  },
  data() {
    return {
      filterAdvancedOpen: false,
      virtualScrollTopInList: 0,
      virtualViewportHeight: 0,
      virtualOverscanPx: 900,
      virtualDefaultItemHeight: 620,
      virtualMinRowsForStability: 20,
      virtualThreshold: 24,
      virtualHeights: {},
      _virtualScrollTarget: null,
      _virtualScrollHandler: null,
      _virtualMeasureRaf: 0,
      _virtualRefreshRaf: 0,
      _virtualResizeObserver: null,
      _virtualObservedEls: null,
      _virtualHeightsSaveTimer: null,
      _virtualHeightsCacheKey: "cache:filterVirtualHeights:v1",
    };
  },
  computed: {
    virtualThresholdValue() {
      const n = Number(this.filterVirtualThreshold);
      if (Number.isFinite(n)) return Math.max(1, Math.min(200, Math.floor(n)));
      return this.virtualThreshold;
    },
    virtualOverscanPxValue() {
      const n = Number(this.filterVirtualOverscanPx);
      if (Number.isFinite(n)) return Math.max(0, Math.min(5000, Math.floor(n)));
      return this.virtualOverscanPx;
    },
    virtualEstimatedItemHeight() {
      const vals = Object.values(this.virtualHeights || {}).filter((v) => Number.isFinite(v) && v > 0);
      if (!vals.length) return this.virtualDefaultItemHeight;
      const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      return Math.max(320, Math.min(2000, avg));
    },
    isVirtualizingFilterResults() {
      const n = this.filterResults?.length || 0;
      if (n <= this.virtualMinRowsForStability) return false;
      return n >= this.virtualThresholdValue;
    },
    virtualFilterState() {
      const all = Array.isArray(this.filterResults) ? this.filterResults : [];
      if (!this.isVirtualizingFilterResults) {
        return { totalHeight: 0, topById: {}, rows: all };
      }

      const starts = new Array(all.length);
      let total = 0;
      for (let i = 0; i < all.length; i++) {
        starts[i] = total;
        const id = Number(all[i]?.id);
        const h = Number.isFinite(id) && this.virtualHeights[id] > 0
          ? this.virtualHeights[id]
          : this.virtualEstimatedItemHeight;
        total += h;
      }

      const minY = Math.max(0, this.virtualScrollTopInList - this.virtualOverscanPxValue);
      const maxY = this.virtualScrollTopInList + this.virtualViewportHeight + this.virtualOverscanPxValue;

      let start = 0;
      while (start < all.length - 1 && starts[start + 1] < minY) start += 1;
      let end = start;
      while (end < all.length && starts[end] < maxY) end += 1;
      if (end <= start) end = Math.min(all.length, start + 1);

      const topById = {};
      for (let i = 0; i < all.length; i++) {
        const id = Number(all[i]?.id);
        if (Number.isFinite(id) && topById[id] == null) topById[id] = starts[i];
      }
      const rows = all.slice(start, end);

      return { totalHeight: total, topById, rows };
    },
    virtualFilterRows() {
      return this.isVirtualizingFilterResults ? this.virtualFilterState.rows : this.filterResults;
    },
    virtualFilterContainerStyle() {
      if (!this.isVirtualizingFilterResults) return null;
      return {
        position: "relative",
        minHeight: "120px",
        height: `${this.virtualFilterState.totalHeight}px`,
      };
    },
  },
  methods: {
    toggleFilterAdvanced() {
      this.filterAdvancedOpen = !this.filterAdvancedOpen;
    },
    paperLabel(q) {
      if (q && q.paper) return this.formatPaperName(q.paper) || `paper#${q.paper.id}`;
      return `paper#${q.paper_id}`;
    },
    queueVirtualRefresh() {
      if (this._virtualRefreshRaf) cancelAnimationFrame(this._virtualRefreshRaf);
      this._virtualRefreshRaf = requestAnimationFrame(() => {
        this._virtualRefreshRaf = 0;
        this.refreshVirtualViewport();
        this.syncVirtualResizeObserverTargets();
        this.scheduleVirtualMeasure();
      });
    },
    loadVirtualHeightsCache() {
      try {
        const raw = localStorage.getItem(this._virtualHeightsCacheKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;
        const next = {};
        for (const [k, v] of Object.entries(parsed)) {
          const id = Number(k);
          const h = Number(v);
          if (!Number.isFinite(id) || id <= 0) continue;
          if (!Number.isFinite(h) || h < 120 || h > 5000) continue;
          next[id] = Math.round(h);
        }
        this.virtualHeights = next;
      } catch {}
    },
    saveVirtualHeightsCache() {
      try {
        localStorage.setItem(this._virtualHeightsCacheKey, JSON.stringify(this.virtualHeights || {}));
      } catch {}
    },
    queueSaveVirtualHeightsCache() {
      if (this._virtualHeightsSaveTimer) clearTimeout(this._virtualHeightsSaveTimer);
      this._virtualHeightsSaveTimer = setTimeout(() => {
        this._virtualHeightsSaveTimer = null;
        this.saveVirtualHeightsCache();
      }, 220);
    },
    ensureVirtualResizeObserver() {
      if (this._virtualResizeObserver || typeof ResizeObserver === "undefined") return;
      this._virtualObservedEls = new Set();
      this._virtualResizeObserver = new ResizeObserver((entries) => {
        if (!entries?.length) return;
        // Only schedule re-measure; avoid noisy direct writes from resize callbacks.
        this.refreshVirtualViewport();
        this.scheduleVirtualMeasure();
      });
    },
    syncVirtualResizeObserverTargets() {
      if (!this.isVirtualizingFilterResults) {
        this.clearVirtualResizeObserverTargets();
        return;
      }
      this.ensureVirtualResizeObserver();
      if (!this._virtualResizeObserver) return;
      if (!this._virtualObservedEls) this._virtualObservedEls = new Set();
      const refs = this.$refs.filterQItems;
      const nodes = Array.isArray(refs) ? refs : (refs ? [refs] : []);
      const nextSet = new Set(nodes.filter(Boolean));

      for (const el of this._virtualObservedEls) {
        if (!nextSet.has(el)) this._virtualResizeObserver.unobserve(el);
      }
      for (const el of nextSet) {
        if (!this._virtualObservedEls.has(el)) this._virtualResizeObserver.observe(el);
      }
      this._virtualObservedEls = nextSet;
    },
    clearVirtualResizeObserverTargets() {
      if (!this._virtualResizeObserver || !this._virtualObservedEls) return;
      for (const el of this._virtualObservedEls) {
        this._virtualResizeObserver.unobserve(el);
      }
      this._virtualObservedEls.clear();
    },
    destroyVirtualResizeObserver() {
      this.clearVirtualResizeObserverTargets();
      if (this._virtualResizeObserver) this._virtualResizeObserver.disconnect();
      this._virtualResizeObserver = null;
      this._virtualObservedEls = null;
    },
    onUiToggleFilterMultiSelect() {
      this.toggleFilterMultiSelect();
      this.queueVirtualRefresh();
    },
    onUiShowAllFilterAnswers() {
      this.showAllFilterAnswers();
      this.queueVirtualRefresh();
    },
    onUiHideAllFilterAnswers() {
      this.hideAllFilterAnswers();
      this.queueVirtualRefresh();
    },
    async onUiToggleFilterEdit(q) {
      await this.toggleFilterEdit(q);
      this.queueVirtualRefresh();
    },
    onUiToggleFilterNotes(q) {
      this.toggleFilterNotes(q);
      this.queueVirtualRefresh();
    },
    async onUiToggleFilterAnswer(q) {
      this.queueVirtualRefresh();
      await this.toggleFilterAnswer(q);
      this.queueVirtualRefresh();
    },
    virtualFilterItemStyle(id) {
      if (!this.isVirtualizingFilterResults) return null;
      const top = this.virtualFilterState.topById?.[Number(id)] || 0;
      return {
        position: "absolute",
        left: "0",
        right: "0",
        top: `${top}px`,
      };
    },
    attachVirtualScrollListener() {
      this.detachVirtualScrollListener();
      const container = this.getFilterScrollContainer?.();
      const isDoc =
        !container ||
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;
      this._virtualScrollTarget = isDoc ? window : container;
      this._virtualScrollHandler = () => {
        this.refreshVirtualViewport();
        this.syncVirtualResizeObserverTargets();
        this.scheduleVirtualMeasure();
      };
      this._virtualScrollTarget.addEventListener("scroll", this._virtualScrollHandler, { passive: true });
      window.addEventListener("resize", this._virtualScrollHandler);
      this.refreshVirtualViewport();
    },
    detachVirtualScrollListener() {
      if (this._virtualScrollTarget && this._virtualScrollHandler) {
        this._virtualScrollTarget.removeEventListener("scroll", this._virtualScrollHandler);
      }
      if (this._virtualScrollHandler) {
        window.removeEventListener("resize", this._virtualScrollHandler);
      }
      this._virtualScrollTarget = null;
      this._virtualScrollHandler = null;
    },
    refreshVirtualViewport() {
      const root = this.$refs.filterResultsRoot;
      if (!root) {
        this.virtualScrollTopInList = 0;
        this.virtualViewportHeight = window.innerHeight || 800;
        return;
      }
      const container = this.getFilterScrollContainer?.();
      const isDoc =
        !container ||
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;
      const listRect = root.getBoundingClientRect();
      if (isDoc) {
        this.virtualScrollTopInList = Math.max(0, -listRect.top);
        this.virtualViewportHeight = window.innerHeight || 800;
        return;
      }
      const crect = container.getBoundingClientRect();
      this.virtualScrollTopInList = Math.max(0, crect.top - listRect.top);
      this.virtualViewportHeight = container.clientHeight || crect.height || 800;
    },
    scheduleVirtualMeasure() {
      if (!this.isVirtualizingFilterResults) return;
      if (this._virtualMeasureRaf) cancelAnimationFrame(this._virtualMeasureRaf);
      this._virtualMeasureRaf = requestAnimationFrame(() => {
        this._virtualMeasureRaf = 0;
        this.measureVirtualHeights();
      });
    },
    measureVirtualHeights() {
      const refs = this.$refs.filterQItems;
      const nodes = Array.isArray(refs) ? refs : (refs ? [refs] : []);
      if (!nodes.length) return;
      const next = { ...(this.virtualHeights || {}) };
      let changed = false;
      for (const el of nodes) {
        const id = Number(el?.getAttribute?.("data-qid"));
        if (!Number.isFinite(id)) continue;
        const h = Math.max(280, Math.ceil(el.offsetHeight || 0));
        if (!h) continue;
        const prev = Number(next[id]) || 0;
        if (Math.abs(prev - h) >= 2) {
          next[id] = h;
          changed = true;
        }
      }
      if (changed) this.virtualHeights = next;
      if (changed) this.queueSaveVirtualHeightsCache();
    },
    scrollToVirtualQuestion(qid) {
      if (!this.isVirtualizingFilterResults) return false;
      const id = Number(qid);
      if (!Number.isFinite(id)) return false;
      const top = this.virtualFilterState.topById?.[id];
      if (top == null) return false;
      const root = this.$refs.filterResultsRoot;
      if (!root) return false;

      const container = this.getFilterScrollContainer?.();
      const isDoc =
        !container ||
        container === document.body ||
        container === document.documentElement ||
        container === document.scrollingElement;
      if (isDoc) {
        const base = window.scrollY + root.getBoundingClientRect().top;
        window.scrollTo({ top: Math.max(0, base + top - 140), behavior: "auto" });
        return true;
      }
      const crect = container.getBoundingClientRect();
      const baseTop = container.scrollTop + (root.getBoundingClientRect().top - crect.top);
      container.scrollTo({ top: Math.max(0, baseTop + top - 140), behavior: "auto" });
      return true;
    },
  },
  watch: {
    filterResults() {
      this.$nextTick(() => {
        this.queueVirtualRefresh();
      });
    },
    filterVirtualThreshold: "queueVirtualRefresh",
    filterVirtualOverscanPx: "queueVirtualRefresh",
    isVirtualizingFilterResults() {
      this.$nextTick(() => this.queueVirtualRefresh());
    },
  },
  mounted() {
    this.loadVirtualHeightsCache();
    this.attachVirtualScrollListener();
    this.$nextTick(() => {
      this.queueVirtualRefresh();
    });
  },
  updated() {
    this.syncVirtualResizeObserverTargets();
    this.scheduleVirtualMeasure();
  },
  beforeUnmount() {
    this.detachVirtualScrollListener();
    if (this._virtualMeasureRaf) cancelAnimationFrame(this._virtualMeasureRaf);
    if (this._virtualRefreshRaf) cancelAnimationFrame(this._virtualRefreshRaf);
    if (this._virtualHeightsSaveTimer) clearTimeout(this._virtualHeightsSaveTimer);
    this.destroyVirtualResizeObserver();
  },
  template: `
    <div id="filterView">
      <div class="stickyBar">
        <div class="row">
          <label class="muted">模块</label>
          <SectionCascadeSelect
            id="filterSection"
            v-model="filterSection"
            :groups="sectionOptionGroupsAll"
            :special-options="[{ label: '(全部)', value: '' }, { label: '(未标记)', value: '__UNSET__' }]"
            :label-map="sectionLabelMap"
            placeholder="选择模块"
            class="centerLabel"
            style="min-width:200px; width:auto; max-width:360px;"
            @change="onFilterChange"
          />
          <label class="muted">试卷</label>
          <PaperCascadeMultiSelect
            id="filterPaper"
            v-model="filterPaperMulti"
            class="centerLabel"
            :options="filterPaperOptions"
            placeholder="(全部)"
            @change="onFilterChange"
          />
          <label class="muted">年份</label>
          <MultiSelect
            id="filterYear"
            v-model="filterYearMulti"
            class="centerLabel"
            :options="filterYearOptions.map((y) => ({ value: y, label: y }))"
            placeholder="(全部)"
            :placeholder-muted="false"
            display-mode="values"
            value-separator="/"
            :show-all-when-all-selected="true"
            @change="onFilterChange"
          />
          <label class="muted">季度</label>
          <MultiSelect
            id="filterSeason"
            v-model="filterSeasonMulti"
            class="centerLabel"
            :options="[
              { value: 'm', label: '春 m' },
              { value: 's', label: '夏 s' },
              { value: 'w', label: '冬 w' },
            ]"
            placeholder="(全部)"
            :placeholder-muted="false"
            :short-label-map="{ m: 'm', s: 's', w: 'w' }"
            display-mode="values"
            value-separator="/"
            :show-all-when-all-selected="true"
            @change="onFilterChange"
          />
          <label class="muted" style="display:flex; gap:6px; align-items:center">
            <input id="filterFavOnly" type="checkbox" v-model="filterFavOnly" @change="onFilterChange" /> 仅收藏
          </label>
          <label class="muted" style="display:flex; gap:6px; align-items:center">
            <input id="filterExcludeMultiSection" type="checkbox" v-model="filterExcludeMultiSection" @change="onFilterChange" /> 排除多分类题目
          </label>
          <label class="muted">预设</label>
          <select id="filterPresetSelect" v-model="filterPresetSelected" @change="applyFilterPreset(filterPresetSelected)" style="min-width:180px">
            <option value="">(未选择)</option>
            <option v-for="p in (filterPresets || [])" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="muted">每页</label>
          <input id="filterPageSize" v-model.number="filterPageSize" type="number" min="1" max="200" style="width:70px" @change="onFilterPageSizeChange" />
          <button id="filterPrevPageBtn" @click="filterPrevPage">上一页</button>
          <button id="filterNextPageBtn" @click="filterNextPage">下一页</button>
          <span id="filterPageInfo" class="muted">{{ filterPageInfoText }}</span>
          <label class="muted">跳转</label>
          <input id="filterJumpPageInput" v-model.number="filterJumpPageInput" type="number" min="1" placeholder="页" style="width:64px" @keydown.enter="filterJumpPage" />
          <button id="filterJumpPageBtn" @click="filterJumpPage">跳页</button>
          <label class="muted">题号</label>
          <input id="filterQuestionNoInput" v-model="filterQuestionNoInput" type="text" placeholder="题号" style="width:64px" @keydown.enter="jumpToQuestionNoFromFilter" />
          <button id="filterQuestionNoBtn" @click="jumpToQuestionNoFromFilter">跳题号</button>
          <button id="exportFilterPdfBtn" class="exportBtn" @click="exportFilterPdf">导出PDF</button>
          <button id="toggleFilterAdvancedBtn" @click="toggleFilterAdvanced">{{ filterAdvancedOpen ? '收起更多' : '更多' }}</button>
        </div>

        <div class="row" style="margin-top:8px" v-show="filterAdvancedOpen">
          <input id="filterPresetNameInput" v-model.trim="filterPresetNameInput" type="text" placeholder="预设名称" style="width:140px" @keydown.enter="saveCurrentFilterPreset" />
          <button id="saveFilterPresetBtn" @click="saveCurrentFilterPreset">保存预设</button>
          <button id="deleteFilterPresetBtn" :disabled="!filterPresetSelected" @click="deleteFilterPreset(filterPresetSelected)">删除预设</button>
          <button id="showAllAnswersBtn" @click="onUiShowAllFilterAnswers">全部显示答案</button>
          <button id="hideAllAnswersBtn" @click="onUiHideAllFilterAnswers">全部隐藏答案</button>
          <button id="toggleMultiSelectBtn" @click="onUiToggleFilterMultiSelect">{{ filterMultiSelect ? '取消多选' : '多选' }}</button>
          <span id="selectedCount" class="muted" v-show="filterMultiSelect">已选 {{ selectedCount }} 题</span>
          <span id="batchSectionGroup" class="row" style="display:inline-flex" v-show="filterMultiSelect">
            <SectionCascadeSelect
              id="batchSectionSelect"
              v-model="filterBatchSection"
              :groups="sectionOptionGroupsAll"
              :special-options="[{ label: '(批量改模块…)', value: '' }]"
              :label-map="sectionLabelMap"
              placeholder="批量改模块…"
            />
            <button id="applyBatchSectionBtn" @click="applyBatchSection">批量改模块</button>
          </span>
          <button id="batchFavBtn" v-show="filterMultiSelect" @click="batchFavorite(true)">批量收藏</button>
          <button id="batchUnfavBtn" v-show="filterMultiSelect" @click="batchFavorite(false)">批量取消收藏</button>
        </div>
      </div>

      <div style="height:12px"></div>
      <div id="filterResults" ref="filterResultsRoot">
        <div v-if="filterLoading" class="filterSkeletonList">
          <div v-for="i in 4" :key="'sk-'+i" class="qItem filterSkeletonItem">
            <div class="filterSk filterSkTitle"></div>
            <div class="filterSk filterSkLine"></div>
            <div class="filterSk filterSkLine short"></div>
          </div>
        </div>
        <div v-if="!filterLoading && !filterResults.length" class="muted">没有匹配的题目。</div>
        <div v-else-if="!filterLoading" :style="virtualFilterContainerStyle">
          <div
            v-for="q in virtualFilterRows"
            :key="q.id"
            ref="filterQItems"
            class="filterRowWrap"
            :style="virtualFilterItemStyle(q.id)"
            :data-qid="q.id"
          >
            <FilterQuestionCard
              :q="q"
              :filter-multi-select="filterMultiSelect"
              :is-selected="selectedQuestionIds.has(q.id)"
              :section-names-filter="sectionNamesFilter"
              :section-option-groups-all="sectionOptionGroupsAll"
              :section-label-map="sectionLabelMap"
              :paper-label="paperLabel"
              :get-question-section-list="getQuestionSectionList"
              :section-display-name="sectionDisplayName"
              :on-toggle-item="toggleFilterItemSelection"
              :on-toggle-selection="toggleFilterSelection"
              :on-toggle-edit="onUiToggleFilterEdit"
              :on-toggle-notes="onUiToggleFilterNotes"
              :on-toggle-answer="onUiToggleFilterAnswer"
              :on-toggle-favorite="toggleFavorite"
              :on-jump="jumpToQuestionFromFilter"
              :on-delete="deleteFilterQuestion"
              :on-sections-change="onFilterSectionsChange"
              :on-notes-blur="onFilterNotesBlur"
              :on-edit-q-boxes="editQuestionBoxesFromFilter"
              :on-edit-a-boxes="editAnswerBoxesFromFilter"
            />
          </div>
        </div>
      </div>
    </div>
  `,
};
