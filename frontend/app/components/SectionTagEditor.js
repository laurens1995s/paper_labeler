import SectionCascadeSelect from "./SectionCascadeSelect.js";
import SimpleSelect from "./SimpleSelect.js";

export default {
  name: "SectionTagEditor",
  props: {
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, default: () => [] },
    optionGroups: { type: Array, default: () => [] },
    labelMap: { type: Object, default: () => ({}) },
    compact: { type: Boolean, default: false },
    placeholder: { type: String, default: "(请选择)" },
  },
  emits: ["update:modelValue"],
  components: { SectionCascadeSelect, SimpleSelect },
  data() {
    return { pending: "" };
  },
  computed: {
    selected() {
      return Array.isArray(this.modelValue) ? this.modelValue : [];
    },
    containerStyle() {
      return this.compact
        ? "display:flex; align-items:center; gap:6px; flex:1"
        : "display:flex; align-items:center; gap:8px; flex:1";
    },
    tagsStyle() {
      return this.compact
        ? "display:flex; flex-wrap:wrap; gap:4px; align-items:center; flex-grow:0; flex-shrink:1;"
        : "display:flex; flex-wrap:wrap; gap:6px; max-width:400px; min-height:30px; padding:6px; border:1px solid #eee; border-radius:6px; background:#fafafa;";
    },
    addRowStyle() {
      return this.compact
        ? "display:flex; gap:6px; align-items:center; flex-shrink:0; margin-left:auto;"
        : "display:flex; gap:6px; align-items:center;";
    },
    selectStyle() {
      return this.compact ? "width:130px; flex-shrink:0;" : "width:200px;";
    },
  },
  methods: {
    onCascadeSelect(value) {
      if (!value) return;
      this.pending = value;
      this.addSelected();
    },
    addSelected() {
      const value = this.pending;
      if (!value) return;
      if (!this.selected.includes(value)) {
        this.$emit("update:modelValue", [...this.selected, value]);
      }
      this.pending = "";
    },
    removeTag(tag) {
      const next = this.selected.filter((s) => s !== tag);
      this.$emit("update:modelValue", next);
    },
  },
  template: `
    <div :style="containerStyle">
      <div v-if="!compact || selected.length" :style="tagsStyle">
        <span v-if="!selected.length && !compact" class="muted" style="font-size:12px">(未选择分类)</span>
        <span v-for="tag in selected" :key="tag" :title="labelMap[tag] || tag" style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; background:var(--tag-bg); color:var(--tag-fg); border-radius:999px; font-size:13px; max-width:240px; border:1px solid var(--tag-border);">
          <span style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ labelMap[tag] || tag }}</span>
          <button type="button" @click.stop.prevent="removeTag(tag)" style="border:none; background:transparent; color:var(--tag-fg); cursor:pointer; padding:0; margin:0; width:16px; height:16px; display:flex; align-items:center; justify-content:center; font-size:16px; line-height:1;">×</button>
        </span>
      </div>
      <div :style="addRowStyle">
        <SectionCascadeSelect
          v-if="optionGroups && optionGroups.length"
          v-model="pending"
          :groups="optionGroups"
          :label-map="labelMap"
          :placeholder="compact ? '(选择分类)' : '(选择要添加的分类)'"
          :style="selectStyle"
          @change="onCascadeSelect"
        />
        <SimpleSelect
          v-else
          v-model="pending"
          :options="[{ value: '', label: (compact ? '(选择分类)' : '(选择要添加的分类)') }, ...options.map((opt) => ({ value: opt, label: opt }))]"
          :style="selectStyle"
          @change="addSelected"
        />
      </div>
    </div>
  `,
};
