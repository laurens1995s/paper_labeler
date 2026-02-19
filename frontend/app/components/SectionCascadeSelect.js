export default {
  name: "SectionCascadeSelect",
  props: {
    modelValue: { type: String, default: "" },
    groups: { type: Array, default: () => [] },
    specialOptions: { type: Array, default: () => [] },
    placeholder: { type: String, default: "(请选择)" },
    labelMap: { type: Object, default: () => ({}) },
    disabled: { type: Boolean, default: false },
    id: { type: String, default: "" },
  },
  emits: ["update:modelValue", "change"],
  data() {
    return {
      open: false,
      activeGroupIdx: -1,
      openLeft: false,
      openUp: false,
      uid: Math.random().toString(36).slice(2),
      pointerHistory: [],
      pendingGroupIdx: -1,
      pendingSwitchTimer: null,
      menuAimDelayMs: 320,
    };
  },
  computed: {
    displayLabel() {
      const special = (this.specialOptions || []).find((opt) => opt.value === this.modelValue);
      if (special) return special.label;
      if (this.modelValue !== null && this.modelValue !== undefined && String(this.modelValue) !== "") {
        return this.labelMap?.[this.modelValue] || this.modelValue;
      }
      return this.placeholder;
    },
    isPlaceholder() {
      const hasValue = this.modelValue !== null && this.modelValue !== undefined && String(this.modelValue) !== "";
      if (hasValue) return false;
      const hasSpecialEmpty = (this.specialOptions || []).some(
        (opt) => opt.value === "" || opt.value === null
      );
      return !hasSpecialEmpty;
    },
    activeGroup() {
      if (!Array.isArray(this.groups) || !this.groups.length) return null;
      if (this.activeGroupIdx < 0) return null;
      return this.groups[this.activeGroupIdx] || null;
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
      this.clearPendingGroupSwitch();
      this.pointerHistory = [];
    },
    updateMenuDirection() {
      if (!this.open) return;
      const root = this.$refs.root;
      const menu = root?.querySelector?.(".cascadeMenu");
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
      if (target && target.closest?.(".cascadeSelect")) return;
      this.close();
    },
    setActiveGroup(idx) {
      this.activeGroupIdx = idx;
      this.$nextTick(() => this.updateMenuDirection());
    },
    clearPendingGroupSwitch() {
      if (this.pendingSwitchTimer) clearTimeout(this.pendingSwitchTimer);
      this.pendingSwitchTimer = null;
      this.pendingGroupIdx = -1;
    },
    onMenuMouseMove(evt) {
      if (!this.open) return;
      const x = Number(evt?.clientX);
      const y = Number(evt?.clientY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.pointerHistory.push({ x, y, t: Date.now() });
      if (this.pointerHistory.length > 6) this.pointerHistory.shift();
    },
    isPointInTriangle(p, a, b, c) {
      const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
      const d1 = sign(p, a, b);
      const d2 = sign(p, b, c);
      const d3 = sign(p, c, a);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(hasNeg && hasPos);
    },
    isMovingTowardSubmenu(currEvt) {
      if (this.activeGroupIdx < 0) return false;
      const submenu = this.$refs.optionList;
      if (!submenu) return false;
      const rect = submenu.getBoundingClientRect();
      const prev = this.pointerHistory[this.pointerHistory.length - 2] || this.pointerHistory[this.pointerHistory.length - 1];
      if (!prev) return false;
      const curr = {
        x: Number(currEvt?.clientX),
        y: Number(currEvt?.clientY),
      };
      if (!Number.isFinite(curr.x) || !Number.isFinite(curr.y)) return false;

      const movingRight = curr.x >= prev.x + 2;
      if (!movingRight) return false;

      const targetA = { x: rect.left + 24, y: rect.top - 24 };
      const targetB = { x: rect.left + 24, y: rect.bottom + 24 };
      return this.isPointInTriangle(curr, prev, targetA, targetB);
    },
    scheduleGroupActivation(idx, evt) {
      if (idx === this.activeGroupIdx) {
        this.clearPendingGroupSwitch();
        return;
      }
      this.clearPendingGroupSwitch();
      this.pendingGroupIdx = idx;
      this.pendingSwitchTimer = setTimeout(() => {
        if (this.pendingGroupIdx === idx) this.setActiveGroup(idx);
        this.clearPendingGroupSwitch();
      }, this.menuAimDelayMs);
      this.onMenuMouseMove(evt);
    },
    onGroupEnter(idx, evt) {
      if (!this.open) return;
      if (this.isMovingTowardSubmenu(evt)) {
        this.scheduleGroupActivation(idx, evt);
        return;
      }
      this.clearPendingGroupSwitch();
      this.setActiveGroup(idx);
      this.onMenuMouseMove(evt);
    },
    onMenuLeave() {
      this.clearPendingGroupSwitch();
      this.pointerHistory = [];
    },
    onOtherOpen(evt) {
      const uid = evt?.detail?.uid;
      if (!uid || uid === this.uid) return;
      this.close();
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
    this.clearPendingGroupSwitch();
  },
  template: `
    <div class="cascadeSelect" :class="{ open, disabled, openLeft, openUp }" ref="root">
      <button
        type="button"
        class="cascadeSelectTrigger"
        :id="id"
        :disabled="disabled"
        @click="toggleOpen"
        @keydown="onTriggerKeydown"
      >
        <span class="cascadeLabel" :class="{ muted: isPlaceholder }" :title="displayLabel">{{ displayLabel }}</span>
        <span class="cascadeCaret">▾</span>
      </button>
      <div v-if="open" class="cascadeMenu" @mousemove="onMenuMouseMove" @mouseleave="onMenuLeave">
        <div v-if="specialOptions && specialOptions.length" class="cascadeSpecial">
          <button
            v-for="opt in specialOptions"
            :key="opt.value"
            type="button"
            class="cascadeOption"
            @click="selectValue(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="groups && groups.length" class="cascadeGroups">
          <div class="cascadeGroupList">
            <div
              v-for="(g, idx) in groups"
              :key="g.label"
              class="cascadeGroupItem"
              :class="{ active: idx === activeGroupIdx }"
              @mouseenter="onGroupEnter(idx, $event)"
            >
              <span>{{ g.label }}</span>
              <span class="cascadeArrow">›</span>
            </div>
          </div>
          <div class="cascadeOptionList" ref="optionList">
            <div v-if="!activeGroup" class="cascadeEmpty">悬停选择分类</div>
            <div v-else-if="!activeGroup.options || !activeGroup.options.length" class="cascadeEmpty">暂无分类</div>
            <button
              v-else
              v-for="opt in activeGroup.options"
              :key="opt"
              type="button"
              class="cascadeOption"
              :title="labelMap?.[opt] || opt"
              @click="selectValue(opt)"
            >
              {{ opt }}
            </button>
          </div>
        </div>
        <div v-else class="cascadeEmpty">暂无分类</div>
      </div>
    </div>
  `,
};
