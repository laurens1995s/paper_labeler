import { extractYearSeason } from "../../modules/utils.js";
import { defaultState } from "../store.js";
import { formatPaperName } from "../helpers.js";
import Sidebar from "./Sidebar.js";
import PaperList from "./PaperList.js";
import MarkView from "./MarkView.js";
import FilterView from "./FilterView.js";
import AnswerView from "./AnswerView.js";
import AnswerAdmin from "./AnswerAdmin.js";
import SectionEditor from "./SectionEditor.js";
import SettingsView from "./SettingsView.js";
import ExportWizard from "./ExportWizard.js";
import RandomExport from "./RandomExport.js";
import CieImport from "./CieImport.js";
import { coreMethods } from "../use/useCore.js";
import { paperMethods } from "../use/usePapers.js";
import { markMethods } from "../use/useMark.js";
import { filterMethods } from "../use/useFilter.js";
import { exportMethods } from "../use/useExport.js";
import { answerMethods } from "../use/useAnswer.js";
import { settingsMethods } from "../use/useSettings.js";
import { cieImportMethods } from "../use/useCieImport.js";

const computedKeys = [
  "viewPapers",
  "paperCountHint",
  "showDonePapersText",
  "currentPaper",
  "paperTitleText",
  "pageInfoText",
  "pageImgUrl",
  "canPrevPage",
  "canNextPage",
  "canOpenAnswer",
  "hasOcrDraftMode",
  "boxListGroups",
  "filterPaperOptions",
  "filterYearOptions",
  "filterPageInfoText",
  "selectedCount",
  "cornerHintText",
  "answerQInfoText",
  "answerQuestionMetaText",
  "answerPreviewMetaText",
  "canClearAnswerBoxes",
  "canSaveAnswer",
  "answerPaperTitleText",
  "answerBackText",
  "currentAnswerQuestion",
  "currentAnswerQuestionBoxes",
  "answerPreviewBoxes",
  "answerBoxesHintText",
  "canPrevAnswer",
  "canNextAnswer",
];

const appContextKeys = Array.from(
  new Set([
    ...Object.keys(defaultState()),
    ...computedKeys,
    ...Object.keys(coreMethods),
    ...Object.keys(paperMethods),
    ...Object.keys(markMethods),
    ...Object.keys(filterMethods),
    ...Object.keys(exportMethods),
    ...Object.keys(answerMethods),
    ...Object.keys(settingsMethods),
    ...Object.keys(cieImportMethods),
  ]),
);
const appContextKeySet = new Set(appContextKeys);

const createAppProxy = (app) => {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === Symbol.unscopables) return undefined;
        return app[key];
      },
      set(_target, key, value) {
        app[key] = value;
        return true;
      },
      has(_target, key) {
        if (typeof key === "symbol") return key in app;
        return appContextKeySet.has(key);
      },
      ownKeys() {
        return appContextKeys;
      },
      getOwnPropertyDescriptor(_target, key) {
        if (typeof key === "symbol") return undefined;
        if (appContextKeySet.has(key)) {
          return { enumerable: true, configurable: true };
        }
        return undefined;
      },
    },
  );
};

export default {
  name: "AppShell",
  components: {
    Sidebar,
    PaperList,
    MarkView,
    FilterView,
    AnswerView,
    AnswerAdmin,
    SectionEditor,
    SettingsView,
    ExportWizard,
    RandomExport,
    CieImport,
  },
  template: `
    <div class="appRoot">
      <header>
        <strong>Paper Labeler</strong>
        <span id="stats" class="muted">{{ statsText }}</span>
        <span id="status" :class="['muted', statusKind]">{{ statusText }}</span>
      </header>
      <main>
        <Sidebar />
        <section id="right" ref="rightScroll">
          <MarkView ref="markView" v-show="view === 'mark'" />
          <FilterView ref="filterView" v-show="view === 'filter'" />
          <AnswerView v-show="view === 'answer'" />
          <AnswerAdmin v-show="view === 'answerAdmin'" />
          <SectionEditor v-show="view === 'section'" />
          <SettingsView v-show="view === 'settings'" />
        </section>
      </main>
      <ExportWizard />
      <RandomExport />
      <CieImport />
      <div id="cornerPaperHint" class="cornerHint" v-show="cornerHintText">{{ cornerHintText }}</div>
    </div>
  `,

  data() {
    return { ...defaultState() };
  },
  provide() {
    return { app: createAppProxy(this) };
  },

  computed: {
    viewPapers() {
      const list = Array.isArray(this.papers) ? this.papers : [];
      return list.filter((p) => (!!p.done) === !!this.showDonePapers);
    },
    paperCountHint() {
      const total = this.papers.length;
      const done = this.papers.filter((p) => !!p.done).length;
      const todo = total - done;
      return `待做 ${todo} / 已做 ${done}`;
    },
    showDonePapersText() {
      return this.showDonePapers ? "显示未完成" : "显示已完成";
    },
    currentPaper() {
      return this.papers.find((p) => p.id === this.currentPaperId) || null;
    },
    paperTitleText() {
      const p = this.currentPaper;
      if (!p) return "未选择";
      return `#${p.id} ${formatPaperName(p)}${p.done ? " ✓" : ""}`;
    },
    pageInfoText() {
      const p = this.pages[this.currentPageIndex];
      return p ? `page ${p.page} / ${this.pages.length}` : "page -";
    },
    pageImgUrl() {
      const p = this.pages[this.currentPageIndex];
      return p ? p.image_url : "";
    },
    canPrevPage() {
      return this.currentPageIndex > 0;
    },
    canNextPage() {
      return this.currentPageIndex >= 0 && this.currentPageIndex < this.pages.length - 1;
    },
    canOpenAnswer() {
      const p = this.currentPaper;
      const qpHint = String(p?.exam_code || p?.filename || "");
      return /_qp_/i.test(qpHint);
    },
    hasOcrDraftMode() {
      return Array.isArray(this.ocrDraftQuestions) && this.ocrDraftQuestions.length > 0;
    },
    boxListGroups() {
      const boxesAll = this.newBoxes || [];
      const grouped = new Map();
      for (const b of boxesAll) {
        if (!grouped.has(b.page)) grouped.set(b.page, []);
        grouped.get(b.page).push(b);
      }
      const pagesSorted = Array.from(grouped.keys()).sort((a, b) => a - b);
      let idx = 0;
      const groups = [];
      for (const pageNum of pagesSorted) {
        const items = grouped.get(pageNum) || [];
        const out = [];
        for (const b of items) {
          idx += 1;
          out.push({ index: idx, box: b, label: b?.label });
        }
        groups.push({ page: pageNum, items: out });
      }
      return groups;
    },
    filterPaperOptions() {
      return this.papers.map((p) => ({ value: String(p.id), label: formatPaperName(p) }));
    },
    filterYearOptions() {
      const years = new Set();
      for (const p of this.papers) {
        const ys = extractYearSeason((p.exam_code || "") + " " + (p.filename || ""));
        if (ys.year) years.add(ys.year);
      }
      return Array.from(years).sort();
    },
    filterPageInfoText() {
      const page = this.filterPage;
      const totalPages = this.filterTotalPages || 1;
      const count = this.filterResults.length;
      const total = this.filterTotal || 0;
      return `第 ${page}/${totalPages} 页 · 本页 ${count} 题 · 共 ${total} 题`;
    },
    selectedCount() {
      return this.selectedQuestionIds.size;
    },
    cornerHintText() {
      if (this.view === "mark") {
        if (!this.currentQpPaperName) return "";
        return `当前试卷：${this.currentQpPaperName}`;
      }
      if (this.view === "answer") {
        const qp = this.currentQpPaperName ? `QP：${this.currentQpPaperName}` : "QP：-";
        const ms = this.currentMsPaperName ? `MS：${this.currentMsPaperName}` : "MS：-";
        return `${qp}  |  ${ms}`;
      }
      return "";
    },
    answerQInfoText() {
      if (this.answerQIndex < 0 || this.answerQIndex >= this.answerQuestions.length) return "题号 -";
      const q = this.answerQuestions[this.answerQIndex];
      return `题号 ${q.question_no || "(未填)"} / 共 ${this.answerQuestions.length}`;
    },
    answerQuestionMetaText() {
      const q = this.answerQuestions[this.answerQIndex];
      if (!q) return "";
      return q.section || "(未填模块)";
    },
    answerPreviewMetaText() {
      const all = [...(this.answerExistingBoxes || []), ...(this.answerNewBoxes || [])];
      return `框数：${all.length}`;
    },
    canClearAnswerBoxes() {
      return this.answerNewBoxes.length > 0;
    },
    canSaveAnswer() {
      const hasQ = this.answerQIndex >= 0 && this.answerQIndex < this.answerQuestions.length;
      return hasQ && (this.answerExistingBoxes.length + this.answerNewBoxes.length) > 0 && this.msPaperId != null;
    },
    answerPaperTitleText() {
      return this.currentMsPaperName ? `答案：${this.currentMsPaperName}` : "答案：未选择";
    },
    answerBackText() {
      return this.answerReplaceMode ? "返回题库" : "返回标注";
    },
    currentAnswerQuestion() {
      if (this.answerQIndex < 0 || this.answerQIndex >= this.answerQuestions.length) return null;
      return this.answerQuestions[this.answerQIndex] || null;
    },
    currentAnswerQuestionBoxes() {
      return this.currentAnswerQuestion?.boxes || [];
    },
    answerPreviewBoxes() {
      return [...(this.answerExistingBoxes || []), ...(this.answerNewBoxes || [])];
    },
    answerBoxesHintText() {
      return `已保存框：${this.answerExistingBoxes.length}，本次新框：${this.answerNewBoxes.length}`;
    },
    canPrevAnswer() {
      return this.answerQIndex > 0;
    },
    canNextAnswer() {
      return this.answerQIndex >= 0 && this.answerQIndex < this.answerQuestions.length - 1;
    },
  },
  methods: {
    ...coreMethods,
    ...paperMethods,
    ...markMethods,
    ...filterMethods,
    ...exportMethods,
    ...answerMethods,
    ...settingsMethods,
    ...cieImportMethods,
  },
  mounted() {
    this.initAppShell();
  },
};
