export default {
  name: "SimpleSelect",
  props: {
    modelValue: { default: "" },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    id: { type: String, default: "" },
    fixed: { type: Boolean, default: false },
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
    selectedOption() {
      const opts = this.options || [];
      const mv = this.modelValue;
      return opts.find((opt) => {
        if (!opt) return false;
        const ov = opt.value;
        if (ov === mv) return true;
        const ovEmpty = ov === null || ov === undefined || ov === "";
        const mvEmpty = mv === null || mv === undefined || mv === "";
        if (ovEmpty && mvEmpty) return true;
        if (!ovEmpty && !mvEmpty && String(ov) === String(mv)) return true;
        return false;
      }) || null;
    },
    displayLabel() {
      if (this.selectedOption) return this.selectedOption.label ?? String(this.selectedOption.value ?? "");
      if (this.placeholder) return this.placeholder;
      if (this.modelValue === null || this.modelValue === undefined) return "";
      return String(this.modelValue);
    },
    isPlaceholder() {
      const hasValue = this.modelValue !== null && this.modelValue !== undefined && String(this.modelValue) !== "";
      if (hasValue) return false;
      const hasEmptyOpt = (this.options || []).some((opt) => opt && (opt.value === "" || opt.value === null));
      return !hasEmptyOpt;
    },
  },
  methods: {
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
    selectValue(value) {
      this.$emit("update:modelValue", value);
      this.$emit("change", value);
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
        <span class="simpleSelectLabel" :class="{ muted: isPlaceholder }" :title="displayLabel">{{ displayLabel }}</span>
        <span class="simpleSelectCaret">▾</span>
      </button>
      <div v-if="open" class="simpleSelectMenu" :style="menuStyle">
        <button
          v-for="opt in options"
          :key="String(opt?.value)"
          type="button"
          class="simpleSelectOption"
          :disabled="!!opt?.disabled"
          @click="selectValue(opt?.value)"
        >
          {{ opt?.label ?? String(opt?.value ?? '') }}
        </button>
      </div>
    </div>
  `,
};
