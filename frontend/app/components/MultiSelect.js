const EMPTY_KEY = "__empty__";

export default {
  name: "MultiSelect",
  props: {
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: "(全部)" },
    disabled: { type: Boolean, default: false },
    id: { type: String, default: "" },
    fixed: { type: Boolean, default: false },
    placeholderMuted: { type: Boolean, default: true },
    shortLabelMap: { type: Object, default: () => ({}) },
    displayMode: { type: String, default: "count" }, // count | values
    valueSeparator: { type: String, default: " / " },
    showAllWhenAllSelected: { type: Boolean, default: false },
  },
  emits: ["update:modelValue", "change"],
  data() {
    return {
      open: false,
      openLeft: false,
      openUp: false,
      uid: Math.random().toString(36).slice(2),
      menuStyle: {},
      openAdjusted: false,
    };
  },
  computed: {
    normalizedOptions() {
      return (this.options || []).filter((opt) => opt && !opt.disabled);
    },
    selectedKeys() {
      const arr = Array.isArray(this.modelValue) ? this.modelValue : [];
      return new Set(arr.map((v) => this.normalizeKey(v)));
    },
    selectedCount() {
      return this.selectedKeys.size;
    },
    displayLabel() {
      const total = this.normalizedOptions.length;
      const selected = this.selectedCount;
      const fallback = this.placeholder || "(全部)";
      if (selected <= 0) return fallback;
      const selectedOptions = this.normalizedOptions.filter((opt) => this.selectedKeys.has(this.normalizeKey(opt.value)));
      const labels = selectedOptions
        .map((opt) => String(opt.label ?? opt.value ?? "").trim())
        .filter((s) => s);
      if (this.displayMode === "values") {
        if (this.showAllWhenAllSelected && total > 0 && selected >= total) return fallback;
        const shortMap = this.shortLabelMap && typeof this.shortLabelMap === "object" ? this.shortLabelMap : {};
        const useShort = selected > 1 && Object.keys(shortMap).length > 0;
        const viewLabels = useShort
          ? selectedOptions.map((opt) => shortMap[String(opt.value)] || String(opt.label ?? opt.value ?? "").trim())
          : labels;
        return viewLabels.join(this.valueSeparator || " / ");
      }
      if (total > 0 && selected >= total) return fallback;
      if (selected === 1) return labels[0] || fallback;
      return `已选 ${selected} 项`;
    },
    isPlaceholder() {
      return this.selectedCount <= 0;
    },
  },
  methods: {
    normalizeKey(value) {
      if (value === "" || value === null || value === undefined) return EMPTY_KEY;
      return String(value);
    },
    toggleOpen() {
      if (this.disabled) return;
      const next = !this.open;
      if (!next) {
        this.close();
        return;
      }
      this.openAdjusted = false;
      this.open = true;
      this.$nextTick(() => {
        this.updateMenuDirection();
        window.dispatchEvent(new CustomEvent("ui:dropdown-open", { detail: { uid: this.uid } }));
      });
    },
    close() {
      this.open = false;
      this.openLeft = false;
      this.openUp = false;
      this.openAdjusted = false;
    },
    findScrollableAncestor(el) {
      let cur = el?.parentElement || null;
      while (cur && cur !== document.body) {
        const style = window.getComputedStyle(cur);
        const oy = style?.overflowY || "";
        if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight + 1) return cur;
        cur = cur.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    },
    nudgeScrollForDropdown(extraNeeded) {
      const root = this.$refs.root;
      const sc = this.findScrollableAncestor(root);
      if (!sc || !(extraNeeded > 0)) return false;
      const isDoc =
        sc === document.body ||
        sc === document.documentElement ||
        sc === document.scrollingElement;
      const maxDown = isDoc
        ? Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight - window.scrollY)
        : Math.max(0, sc.scrollHeight - sc.clientHeight - sc.scrollTop);
      if (maxDown <= 0) return false;
      const delta = Math.min(maxDown, Math.ceil(extraNeeded) + 12);
      if (delta <= 0) return false;
      if (isDoc) window.scrollBy({ top: delta, behavior: "auto" });
      else sc.scrollTop += delta;
      return true;
    },
    updateMenuDirection() {
      if (!this.open) return;
      const root = this.$refs.root;
      const menu = root?.querySelector?.(".simpleSelectMenu");
      if (!root || !menu) return;
      let rect = root.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const padding = 8;
      const wouldOverflowRight = rect.left + menuRect.width > (window.innerWidth - padding);
      let spaceBelow = window.innerHeight - rect.bottom - padding;
      let spaceAbove = rect.top - padding;
      const wouldOverflowBottom = spaceBelow < menuRect.height + padding;
      this.openLeft = !!wouldOverflowRight;
      if (this.fixed && !this.openAdjusted) {
        const minBelow = 220;
        if (spaceBelow < minBelow && this.nudgeScrollForDropdown(minBelow - spaceBelow)) {
          this.openAdjusted = true;
          requestAnimationFrame(() => this.updateMenuDirection());
          return;
        }
        this.openAdjusted = true;
        rect = root.getBoundingClientRect();
        spaceBelow = window.innerHeight - rect.bottom - padding;
        spaceAbove = rect.top - padding;
      }
      this.openUp = this.fixed ? false : !!(wouldOverflowBottom && spaceAbove > spaceBelow);
      if (this.fixed) {
        const left = this.openLeft
          ? Math.max(padding, rect.right - menuRect.width)
          : Math.max(padding, rect.left);
        const maxHeight = Math.max(1, Math.min(menu.scrollHeight, Math.max(1, spaceBelow), 280));
        const top = rect.bottom + 6;
        this.menuStyle = {
          left: `${left}px`,
          top: `${top}px`,
          minWidth: `${Math.max(120, rect.width)}px`,
          maxHeight: `${maxHeight}px`,
        };
      } else {
        this.menuStyle = {};
      }
    },
    emitSelectionFromKeys(nextKeys) {
      const out = [];
      for (const opt of this.normalizedOptions) {
        if (nextKeys.has(this.normalizeKey(opt.value))) {
          out.push(opt.value);
        }
      }
      this.$emit("update:modelValue", out);
      this.$emit("change", out);
    },
    toggleOption(value, checked) {
      const key = this.normalizeKey(value);
      if (key === EMPTY_KEY) {
        this.clearAll();
        return;
      }
      const next = new Set(this.selectedKeys);
      if (checked) next.add(key);
      else next.delete(key);
      this.emitSelectionFromKeys(next);
    },
    clearAll() {
      this.$emit("update:modelValue", []);
      this.$emit("change", []);
    },
    toggleSelectAll() {
      if (this.selectedCount >= this.normalizedOptions.length) {
        this.clearAll();
        return;
      }
      const all = this.normalizedOptions.map((opt) => opt.value);
      this.$emit("update:modelValue", all);
      this.$emit("change", all);
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
    onDocClick(evt) {
      if (!this.open) return;
      const target = evt?.target;
      if (target && target.closest?.(".simpleSelect")) return;
      this.close();
    },
    onOtherOpen(evt) {
      const uid = evt?.detail?.uid;
      if (!uid || uid === this.uid) return;
      this.close();
    },
    onAnyScroll() {
      if (!this.open) return;
      this.updateMenuDirection();
    },
  },
  mounted() {
    document.addEventListener("click", this.onDocClick);
    window.addEventListener("ui:dropdown-open", this.onOtherOpen);
    window.addEventListener("resize", this.updateMenuDirection);
    window.addEventListener("scroll", this.onAnyScroll, true);
  },
  beforeUnmount() {
    document.removeEventListener("click", this.onDocClick);
    window.removeEventListener("ui:dropdown-open", this.onOtherOpen);
    window.removeEventListener("resize", this.updateMenuDirection);
    window.removeEventListener("scroll", this.onAnyScroll, true);
  },
  template: `
    <div class="simpleSelect" :class="{ open, disabled, openLeft, openUp, fixed }" ref="root">
      <button
        type="button"
        class="simpleSelectTrigger"
        :id="id"
        :disabled="disabled"
        @click="toggleOpen"
        @keydown="onTriggerKeydown"
      >
        <span class="simpleSelectLabel" :class="{ muted: placeholderMuted && isPlaceholder }" :title="displayLabel">{{ displayLabel }}</span>
        <span class="simpleSelectCaret">▼</span>
      </button>
      <div v-if="open" class="simpleSelectMenu simpleSelectMenuMulti" :style="menuStyle">
        <div class="simpleSelectMultiActions">
          <button type="button" class="simpleSelectOption" @click.stop="toggleSelectAll">
            {{ selectedCount >= normalizedOptions.length ? '清空' : '全选' }}
          </button>
        </div>
        <label
          v-for="opt in normalizedOptions"
          :key="String(opt?.value)"
          class="simpleSelectOption simpleSelectOptionCheck"
        >
          <input
            type="checkbox"
            :checked="selectedKeys.has(normalizeKey(opt?.value))"
            @change="toggleOption(opt?.value, $event.target.checked)"
          />
          <span>{{ opt?.label ?? String(opt?.value ?? '') }}</span>
        </label>
      </div>
    </div>
  `,
};
