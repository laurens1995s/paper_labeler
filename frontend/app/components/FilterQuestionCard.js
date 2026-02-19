import SectionTagEditor from "./SectionTagEditor.js";
import CropPreview from "./CropPreview.js";

export default {
  name: "FilterQuestionCard",
  components: { SectionTagEditor, CropPreview },
  props: {
    q: { type: Object, required: true },
    filterMultiSelect: { type: Boolean, default: false },
    isSelected: { type: Boolean, default: false },
    sectionNamesFilter: { type: Array, default: () => [] },
    sectionOptionGroupsAll: { type: Array, default: () => [] },
    sectionLabelMap: { type: Object, default: () => ({}) },
    paperLabel: { type: Function, required: true },
    getQuestionSectionList: { type: Function, required: true },
    sectionDisplayName: { type: Function, required: true },
    onToggleItem: { type: Function, required: true },
    onToggleSelection: { type: Function, required: true },
    onToggleEdit: { type: Function, required: true },
    onToggleNotes: { type: Function, required: true },
    onToggleAnswer: { type: Function, required: true },
    onToggleFavorite: { type: Function, required: true },
    onJump: { type: Function, required: true },
    onDelete: { type: Function, required: true },
    onSectionsChange: { type: Function, required: true },
    onNotesBlur: { type: Function, required: true },
    onEditQBoxes: { type: Function, required: true },
    onEditABoxes: { type: Function, required: true },
  },
  computed: {
    sectionList() {
      const list = this.getQuestionSectionList(this.q);
      return Array.isArray(list) ? list : [];
    },
    paperLabelText() {
      return this.paperLabel(this.q);
    },
    questionBoxSig() {
      const boxes = Array.isArray(this.q?.boxes) ? this.q.boxes : [];
      return boxes.map((b) => `${b?.id ?? ""}:${b?.image_url ?? ""}:${(b?.bbox || []).join(",")}`).join("|");
    },
    answerBoxSig() {
      const boxes = Array.isArray(this.q?.__ansBoxes) ? this.q.__ansBoxes : [];
      return boxes.map((b) => `${b?.id ?? ""}:${b?.image_url ?? ""}:${(b?.bbox || []).join(",")}`).join("|");
    },
    headerMemo() {
      return [
        this.q?.id,
        this.q?.question_no,
        this.q?.is_favorite,
        this.q?.__editOpen,
        this.q?.__ansOpen,
        this.q?.notes,
        this.filterMultiSelect,
        this.isSelected,
        this.sectionList.join("|"),
        this.paperLabelText,
      ];
    },
    editPanelMemo() {
      const sections = Array.isArray(this.q?.__editSections) ? this.q.__editSections.join("|") : "";
      return [
        this.q?.id,
        this.q?.__editOpen,
        this.q?.__notesOpen,
        sections,
        this.q?.__editNotes,
      ];
    },
    qBoxesMemo() {
      return [this.q?.id, this.questionBoxSig];
    },
    ansPanelMemo() {
      return [
        this.q?.id,
        this.q?.__ansOpen,
        this.q?.__ansMeta,
        this.answerBoxSig,
      ];
    },
  },
  methods: {
    handleToggleItem(evt) {
      this.onToggleItem(this.q, evt);
    },
    handleToggleSelection(evt) {
      this.onToggleSelection(this.q, evt);
    },
    handleToggleEdit() {
      this.onToggleEdit(this.q);
    },
    handleToggleNotes() {
      this.onToggleNotes(this.q);
    },
    handleToggleAnswer() {
      this.onToggleAnswer(this.q);
    },
    handleToggleFavorite() {
      this.onToggleFavorite(this.q);
    },
    handleJump() {
      this.onJump(this.q);
    },
    handleDelete() {
      this.onDelete(this.q);
    },
    handleSectionsChange(val) {
      this.onSectionsChange(this.q, val);
    },
    handleNotesBlur() {
      this.onNotesBlur(this.q);
    },
    handleEditQBoxes() {
      this.onEditQBoxes(this.q);
    },
    handleEditABoxes() {
      this.onEditABoxes(this.q);
    },
  },
  template: `
    <div class="qItem" @click="handleToggleItem">
      <div class="row" style="justify-content:space-between" v-memo="headerMemo">
        <div>
          <input
            type="checkbox"
            data-act="sel"
            :checked="isSelected"
            v-show="filterMultiSelect"
            style="margin-right:10px; width:20px; height:20px;"
            @change="handleToggleSelection"
          />
          <strong>题号 {{ q.question_no || '(未填)' }}</strong>
          <template v-if="sectionList.length">
            <span v-for="s in sectionList" :key="s" class="pill tagPill" :title="sectionDisplayName(s)">{{ sectionDisplayName(s) }}</span>
          </template>
          <span v-else class="pill">(未填模块)</span>
          <span class="pill">{{ paperLabelText }}</span>
          <div v-if="q.notes" class="muted" style="margin:6px 0 0 0;">备注：{{ q.notes }}</div>
        </div>
        <div class="row">
          <button data-act="fav" title="收藏/取消收藏" @click.stop="handleToggleFavorite">{{ q.is_favorite ? '★' : '☆' }}</button>
          <button data-act="jump" @click.stop="handleJump">跳转定位</button>
          <button data-act="edit" @click.stop="handleToggleEdit">{{ q.__editOpen ? '收起' : '修改' }}</button>
          <button data-act="toggleAns" @click.stop="handleToggleAnswer">{{ q.__ansOpen ? '隐藏答案' : '显示答案' }}</button>
          <button data-act="del" @click.stop="handleDelete">删除</button>
        </div>
      </div>

      <div style="height:8px"></div>
      <div class="panel" data-edit-panel style="border-radius:12px;" v-show="q.__editOpen" v-memo="editPanelMemo">
        <div class="row">
          <label class="muted">模块（可多选）</label>
          <SectionTagEditor
            :model-value="q.__editSections"
            :options="sectionNamesFilter"
            :option-groups="sectionOptionGroupsAll"
            :label-map="sectionLabelMap"
            @update:modelValue="handleSectionsChange"
          />
          <button data-act="editNotes" @click.stop="handleToggleNotes">修改备注</button>
          <button data-act="editQBoxes" @click.stop="handleEditQBoxes">修改题目</button>
          <button data-act="editABoxes" @click.stop="handleEditABoxes">修改答案</button>
        </div>
        <div style="height:8px"></div>
        <div class="row" style="align-items:stretch" v-show="q.__notesOpen">
          <label class="muted">备注</label>
          <textarea
            data-field="notes"
            v-model="q.__editNotes"
            style="width:100%; min-height:56px; padding:8px; border:1px solid #eee; border-radius:8px;"
            placeholder="可空"
            @blur="handleNotesBlur"
          ></textarea>
        </div>
      </div>

      <div class="boxes" v-memo="qBoxesMemo">
        <div v-for="(b, idx) in (q.boxes || [])" :key="b.id || idx">
          <CropPreview :image-url="b.image_url" :bbox="b.bbox" lazy-level="near" />
        </div>
      </div>

      <div style="height:10px"></div>
      <div class="panel" data-ans-panel style="border-radius:12px;" v-show="q.__ansOpen" v-memo="ansPanelMemo">
        <div class="row" style="justify-content:space-between">
          <strong>答案（MS）</strong>
          <span class="muted" data-slot="ansMeta">{{ q.__ansMeta || '未加载' }}</span>
        </div>
        <div style="height:8px"></div>
        <div class="boxes" data-slot="ansBoxes">
          <div v-if="!q.__ansBoxes.length" class="muted">{{ q.__ansMeta === '无答案' ? '（未标注）' : '（空）' }}</div>
          <div v-else v-for="(b, idx) in (q.__ansBoxes || [])" :key="b.id || idx">
            <CropPreview :image-url="b.image_url" :bbox="b.bbox" lazy-level="far" />
          </div>
        </div>
      </div>
    </div>
  `,
};
