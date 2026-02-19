const SEASON_ORDER = ["m", "s", "w"];
const SEASON_LABEL = {
  m: "春 m",
  s: "夏 s",
  w: "冬 w",
  unknown: "未知季节",
};

function normalizeKey(value) {
  if (value === "" || value === null || value === undefined) return "";
  return String(value);
}

function parsePaperMeta(label) {
  const text = String(label || "");
  const subject = (text.match(/^([A-Za-z0-9]+)/)?.[1] || "(未识别科目)").trim();
  const ys = text.match(/_(m|s|w)(\d{2})_/i) || text.match(/(?:^|[_\-\s])(m|s|w)(\d{2})(?:[_\-\s]|$)/i);
  const season = ys?.[1] ? String(ys[1]).toLowerCase() : "unknown";
  const year = ys?.[2] ? String(ys[2]) : "unknown";
  return { subject, year, season };
}

function sortYears(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
  if (a === "unknown") return 1;
  if (b === "unknown") return -1;
  return String(a).localeCompare(String(b));
}

function sortSeasons(a, b) {
  const ia = SEASON_ORDER.indexOf(a);
  const ib = SEASON_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return String(a).localeCompare(String(b));
}

export default {
  name: "PaperCascadeMultiSelect",
  props: {
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: "(全部)" },
    disabled: { type: Boolean, default: false },
    id: { type: String, default: "" },
  },
  emits: ["update:modelValue", "change"],
  data() {
    return {
      open: false,
      openLeft: false,
      openUp: false,
      uid: Math.random().toString(36).slice(2),
      activeSubject: "",
      activeYear: "",
      activeSeason: "",
    };
  },
  computed: {
    normalizedOptions() {
      return (this.options || []).filter((opt) => opt && opt.value != null);
    },
    selectedKeys() {
      return new Set((this.modelValue || []).map((v) => normalizeKey(v)));
    },
    grouped() {
      const bySubject = new Map();
      for (const opt of this.normalizedOptions) {
        const value = normalizeKey(opt.value);
        const label = String(opt.label ?? opt.value ?? "");
        const meta = parsePaperMeta(label);
        if (!bySubject.has(meta.subject)) bySubject.set(meta.subject, new Map());
        const byYear = bySubject.get(meta.subject);
        if (!byYear.has(meta.year)) byYear.set(meta.year, new Map());
        const bySeason = byYear.get(meta.year);
        if (!bySeason.has(meta.season)) bySeason.set(meta.season, []);
        bySeason.get(meta.season).push({ value, label });
      }

      const subjects = Array.from(bySubject.keys()).sort((a, b) => String(a).localeCompare(String(b)));
      const out = subjects.map((subject) => {
        const yearMap = bySubject.get(subject) || new Map();
        const years = Array.from(yearMap.keys()).sort(sortYears).map((year) => {
          const seasonMap = yearMap.get(year) || new Map();
          const seasons = Array.from(seasonMap.keys()).sort(sortSeasons).map((season) => {
            const papers = (seasonMap.get(season) || []).slice().sort((x, y) => x.label.localeCompare(y.label));
            return {
              key: season,
              label: SEASON_LABEL[season] || season,
              count: papers.length,
              papers,
            };
          });
          return {
            key: year,
            label: year === "unknown" ? "未知年份" : year,
            count: seasons.reduce((sum, s) => sum + (s.count || 0), 0),
            seasons,
          };
        });
        return {
          key: subject,
          label: subject,
          count: years.reduce((sum, y) => sum + (y.count || 0), 0),
          years,
        };
      });
      return out;
    },
    activeSubjectNode() {
      return this.grouped.find((x) => x.key === this.activeSubject) || this.grouped[0] || null;
    },
    yearList() {
      return this.activeSubjectNode?.years || [];
    },
    activeYearNode() {
      const years = this.yearList;
      return years.find((x) => x.key === this.activeYear) || years[0] || null;
    },
    seasonList() {
      return this.activeYearNode?.seasons || [];
    },
    activeSeasonNode() {
      const seasons = this.seasonList;
      return seasons.find((x) => x.key === this.activeSeason) || seasons[0] || null;
    },
    currentPaperList() {
      return this.activeSeasonNode?.papers || [];
    },
    displayLabel() {
      const total = this.normalizedOptions.length;
      const selected = this.selectedKeys.size;
      if (selected <= 0 || selected >= total) return this.placeholder;
      if (selected === 1) {
        const target = this.normalizedOptions.find((x) => this.selectedKeys.has(normalizeKey(x.value)));
        return String(target?.label || this.placeholder);
      }
      return `已选 ${selected} 项`;
    },
  },
  methods: {
    ensureActivePath() {
      const s = this.activeSubjectNode;
      this.activeSubject = s?.key || "";
      const y = this.activeYearNode;
      this.activeYear = y?.key || "";
      const z = this.activeSeasonNode;
      this.activeSeason = z?.key || "";
    },
    emitFromKeySet(next) {
      const out = [];
      for (const opt of this.normalizedOptions) {
        const key = normalizeKey(opt.value);
        if (next.has(key)) out.push(opt.value);
      }
      this.$emit("update:modelValue", out);
      this.$emit("change", out);
    },
    toggleOpen() {
      if (this.disabled) return;
      const next = !this.open;
      if (!next) {
        this.close();
        return;
      }
      this.open = true;
      this.ensureActivePath();
      this.$nextTick(() => {
        this.updateMenuDirection();
        window.dispatchEvent(new CustomEvent("ui:dropdown-open", { detail: { uid: this.uid } }));
      });
    },
    close() {
      this.open = false;
      this.openLeft = false;
      this.openUp = false;
    },
    updateMenuDirection() {
      if (!this.open) return;
      const root = this.$refs.root;
      const menu = root?.querySelector?.(".paperCascadeMenu");
      if (!root || !menu) return;
      const rect = root.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const padding = 8;
      const wouldOverflowRight = rect.left + menuRect.width > (window.innerWidth - padding);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const wouldOverflowBottom = spaceBelow < menuRect.height + padding;
      this.openLeft = !!wouldOverflowRight;
      this.openUp = !!(wouldOverflowBottom && spaceAbove > spaceBelow);
    },
    togglePaper(value, checked) {
      const key = normalizeKey(value);
      const next = new Set(this.selectedKeys);
      if (checked) next.add(key);
      else next.delete(key);
      this.emitFromKeySet(next);
    },
    toggleSelectAll() {
      const next = new Set(this.selectedKeys);
      const total = this.normalizedOptions.length;
      if (next.size >= total) {
        next.clear();
      } else {
        for (const opt of this.normalizedOptions) next.add(normalizeKey(opt.value));
      }
      this.emitFromKeySet(next);
    },
    toggleCurrentSeasonSelectAll() {
      const next = new Set(this.selectedKeys);
      const list = this.currentPaperList || [];
      if (!list.length) return;
      const allSelected = list.every((p) => next.has(normalizeKey(p.value)));
      for (const p of list) {
        const key = normalizeKey(p.value);
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      this.emitFromKeySet(next);
    },
    onDocClick(evt) {
      if (!this.open) return;
      const target = evt?.target;
      if (target && target.closest?.(".paperCascadeSelect")) return;
      this.close();
    },
    onOtherOpen(evt) {
      const uid = evt?.detail?.uid;
      if (!uid || uid === this.uid) return;
      this.close();
    },
    onTriggerKeydown(evt) {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        this.toggleOpen();
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        this.close();
      }
    },
  },
  watch: {
    grouped: {
      handler() {
        this.ensureActivePath();
      },
      deep: true,
      immediate: true,
    },
    modelValue() {
      const valid = new Set(this.normalizedOptions.map((opt) => normalizeKey(opt.value)));
      const next = (this.modelValue || []).filter((v) => valid.has(normalizeKey(v)));
      if (next.length !== (this.modelValue || []).length) {
        this.$emit("update:modelValue", next);
        this.$emit("change", next);
      }
    },
  },
  mounted() {
    document.addEventListener("click", this.onDocClick);
    window.addEventListener("ui:dropdown-open", this.onOtherOpen);
    window.addEventListener("resize", this.updateMenuDirection);
  },
  beforeUnmount() {
    document.removeEventListener("click", this.onDocClick);
    window.removeEventListener("ui:dropdown-open", this.onOtherOpen);
    window.removeEventListener("resize", this.updateMenuDirection);
  },
  template: `
    <div class="cascadeSelect paperCascadeSelect" :class="{ open, disabled, openLeft, openUp }" ref="root">
      <button
        type="button"
        class="cascadeSelectTrigger"
        :id="id"
        :disabled="disabled"
        @click="toggleOpen"
        @keydown="onTriggerKeydown"
      >
        <span class="cascadeLabel" :title="displayLabel">{{ displayLabel }}</span>
        <span class="cascadeCaret">▾</span>
      </button>

      <div v-if="open" class="cascadeMenu paperCascadeMenu">
        <div class="simpleSelectMultiActions">
          <button type="button" class="simpleSelectOption" @click.stop="toggleSelectAll">
            {{ selectedKeys.size >= normalizedOptions.length ? '清空' : '全选' }}
          </button>
        </div>

        <div class="paperCascadeGrid">
          <div class="paperCascadeCol">
            <div
              v-for="s in grouped"
              :key="s.key"
              class="cascadeGroupItem"
              :class="{ active: s.key === activeSubject }"
              @mouseenter="activeSubject = s.key"
            >
              <span>{{ s.label }}</span>
              <span class="muted">({{ s.count }})</span>
            </div>
          </div>

          <div class="paperCascadeCol">
            <div
              v-for="y in yearList"
              :key="y.key"
              class="cascadeGroupItem"
              :class="{ active: y.key === activeYear }"
              @mouseenter="activeYear = y.key"
            >
              <span>{{ y.label }}</span>
              <span class="muted">({{ y.count }})</span>
            </div>
          </div>

          <div class="paperCascadeCol">
            <div
              v-for="z in seasonList"
              :key="z.key"
              class="cascadeGroupItem"
              :class="{ active: z.key === activeSeason }"
              @mouseenter="activeSeason = z.key"
            >
              <span>{{ z.label }}</span>
              <span class="muted">({{ z.count }})</span>
            </div>
          </div>

          <div class="paperCascadeCol paperCascadeLeaf">
            <div class="paperCascadeLeafActions">
              <button type="button" class="simpleSelectOption" @click.stop="toggleCurrentSeasonSelectAll">
                本季{{ currentPaperList.length && currentPaperList.every((p) => selectedKeys.has(String(p.value))) ? '清空' : '全选' }}
              </button>
            </div>
            <label
              v-for="p in currentPaperList"
              :key="String(p.value)"
              class="simpleSelectOption simpleSelectOptionCheck"
            >
              <input
                type="checkbox"
                :checked="selectedKeys.has(String(p.value))"
                @change="togglePaper(p.value, $event.target.checked)"
              />
              <span>{{ p.label }}</span>
            </label>
            <div v-if="!currentPaperList.length" class="cascadeEmpty">暂无试卷</div>
          </div>
        </div>
      </div>
    </div>
  `,
};

