import { useMark } from "../use/useMark.js";
import SectionTagEditor from "./SectionTagEditor.js";
import SectionCascadeSelect from "./SectionCascadeSelect.js";

export default {
  name: "MarkView",
  components: { SectionTagEditor, SectionCascadeSelect },
  setup() {
    return useMark();
  },
  methods: {
    formatBbox(bbox) {
      if (!Array.isArray(bbox)) return "";
      return bbox.map((v) => Number(v).toFixed(3)).join(", ");
    },
    ocrBoxCount(idx) {
      return (this.newBoxes || []).filter((b) => b && b.source === "ocr" && Number(b.draftIdx) === idx).length;
    },
    onOcrDraftRowClick(idx, evt) {
      const t = evt?.target;
      if (
        t &&
        (
          t.closest?.(".cascadeSelect") ||
          t.closest?.(".simpleSelect") ||
          t.closest?.("button") ||
          t.closest?.("input") ||
          t.closest?.("textarea") ||
          t.closest?.("select")
        )
      ) return;
      this.selectOcrDraft(idx);
    },
  },
  template: `
    <div id="markView">
      <div class="row">
        <button id="backToPrevBtn" v-show="navStack.length" @click="backToPrev">返回</button>
        <button id="prevPageBtn" :disabled="!canPrevPage" @click="gotoPageIndex(currentPageIndex - 1)">上一页 (K)</button>
        <button id="nextPageBtn" :disabled="!canNextPage" @click="gotoPageIndex(currentPageIndex + 1)">下一页 (J)</button>
        <label class="muted">跳转</label>
        <input id="markJumpPageInput" v-model="markJumpPageInput" type="number" min="1" placeholder="页" style="width:72px" @keydown.enter="jumpToMarkPageFromUI" />
        <button id="markJumpPageBtn" :disabled="!pages.length" @click="jumpToMarkPageFromUI">跳页</button>
        <button id="autoRecognizeBtn" class="saveBtn" :disabled="currentPaperId == null" @click="manualAutoRecognize">自动识别</button>
        <button id="openAnswerBtn" class="primaryBtn" :disabled="!canOpenAnswer" @click="openAnswerMode()">标注答案</button>
        <span id="pageInfo" class="pill">{{ pageInfoText }}</span>
        <span class="muted">提示：在右侧图片上拖拽即可框选，多框选后再保存为一题。</span>
      </div>

      <div style="height:10px"></div>
      <div class="markLayout">
        <div class="markLeft">
          <div class="imgWrap" id="imgWrap">
            <img id="pageImg" ref="pageImg" :src="pageImgUrl" alt="page" @load="onPageImgLoad" />
            <canvas id="overlay" ref="overlay"></canvas>
          </div>
        </div>

        <div class="markRight">
          <div class="panel">
            <div class="row" style="justify-content:space-between">
              <strong>新建题目</strong>
              <div class="row markActionRow">
                <span id="editModeHint" class="pill" v-show="editingQuestionId != null">{{ editingQuestionId != null ? ('修改题目 #' + editingQuestionId) : '' }}</span>
                <button id="cancelEditBtn" v-show="editingQuestionId != null" @click="cancelEditQuestion">取消修改</button>
                <div class="markActionButtons">
                  <button
                    id="markUndoBtn"
                    :disabled="markPersistBusy || (!markUndoStack.length && !(markSavedUndoStack && markSavedUndoStack.length))"
                    @click="undoMark"
                  >
                    撤销 (Ctrl+Z)
                  </button>
                  <button
                    id="markRedoBtn"
                    :disabled="markPersistBusy || (!markRedoStack.length && !(markSavedRedoStack && markSavedRedoStack.length))"
                    @click="redoMark"
                  >
                    重做 (Ctrl+Y)
                  </button>
                  <button id="clearBoxesBtn" :disabled="!newBoxes.length" @click="clearBoxes">清空框选</button>
                  <button
                    id="saveQuestionBtn"
                    class="saveBtn"
                    :disabled="!newBoxes.length"
                    @click="editingQuestionId == null && hasOcrDraftMode ? saveOcrDraftQuestionsBatch() : saveQuestion()"
                  >
                    {{ editingQuestionId == null && hasOcrDraftMode ? '一键保存' : '保存为题目' }}
                  </button>
                </div>
              </div>
            </div>

            <div style="height:10px"></div>
            <div class="row" id="manualMetaRow" v-show="!hasOcrDraftMode">
              <label class="muted">模块</label>
              <SectionCascadeSelect
                id="qSectionSelect"
                v-model="qSectionSelectValue"
                :groups="sectionOptionGroupsVisible"
                :label-map="sectionLabelMap"
                :special-options="[{ label: '(请选择)', value: '' }]"
                placeholder="选择模块"
                style="min-width:200px; width:auto; max-width:360px;"
                @change="addSectionFromSelect"
              />
            </div>

            <div style="height:8px"></div>
            <div id="selectedSectionsDisplay" class="row" style="flex-wrap:wrap; gap:8px; min-height:32px;" v-show="!hasOcrDraftMode && selectedSectionsForNewQuestion.length">
              <span class="muted">已选分类：</span>
              <span v-for="sec in selectedSectionsForNewQuestion" :key="sec" class="pill" :title="sectionDisplayName(sec)" style="display:flex; align-items:center; gap:6px; max-width:260px;">
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{{ sectionDisplayName(sec) }}</span>
                <button @click.stop="removeSelectedSection(sec)" style="border:none; background:transparent; cursor:pointer;">×</button>
              </span>
            </div>

            <div style="height:8px"></div>
            <div class="row" id="manualNotesRow" v-show="!hasOcrDraftMode">
              <label class="muted">备注</label>
              <input id="qNotes" v-model="qNotes" placeholder="可空" style="width:520px; max-width:100%" />
            </div>

            <div style="height:10px"></div>
            <div id="boxList" class="muted">
              <template v-if="hasOcrDraftMode">
                <div class="row" style="justify-content:space-between">
                  <strong>批量分类（自动识别）</strong>
                  <div class="row" style="gap:8px">
                    <span class="muted">每题可多模块，保存时按题合并多框/跨页</span>
                    <button @click="addOcrDraftQuestion" style="font-size:13px; padding:4px 10px;">+ 新增一题</button>
                  </div>
                </div>
                <div style="height:10px"></div>

                <div v-if="!newBoxes.length" class="muted">暂无建议框</div>
                <div v-else>
                  <div
                    v-for="(q, idx) in ocrDraftQuestions"
                    :key="idx"
                    @click="onOcrDraftRowClick(idx, $event)"
                    :style="'display:grid; grid-template-columns:100px 1fr; align-items:center; gap:8px; border:1px solid #eee; border-radius:10px; padding:8px 10px; margin-bottom:8px;' + (idx === selectedOcrDraftIdx ? 'outline:2px solid #2563eb;' : '')"
                  >
                    <div style="display:flex; align-items:center; gap:8px; min-width:100px;">
                      <span class="pill">题 {{ q && q.label ? q.label : '?' }}</span>
                      <span class="muted">{{ ocrBoxCount(idx) }} 框</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex:1;">
                      <SectionTagEditor
                        :model-value="Array.isArray(q.sections) ? q.sections : []"
                        :options="sectionNamesMark"
                        :option-groups="sectionOptionGroupsVisible"
                        :label-map="sectionLabelMap"
                        :compact="true"
                        @update:modelValue="(val) => { q.sections = val; }"
                        style="flex:1"
                      />
                    </div>
                  </div>
                </div>
              </template>
              <template v-else>
                <div v-if="!newBoxes.length" class="muted">暂无框选（支持跨页：翻页后可继续框选同一题）</div>
                <div v-else>
                  <div v-for="group in boxListGroups" :key="group.page">
                    <div class="row" style="justify-content:space-between">
                      <span class="pill">page {{ group.page }}</span>
                      <button @click="jumpToBoxPage(group.page)">跳到该页</button>
                    </div>
                    <div v-for="item in group.items" :key="item.index" class="row">
                      <span class="pill">#{{ item.index }}</span>
                      <span v-if="item.label" class="pill">题 {{ item.label }}</span>
                      <span class="muted">bbox=[{{ formatBbox(item.box.bbox) }}]</span>
                      <button @click="deleteBox(item.box)">删除</button>
                    </div>
                    <div style="height:8px"></div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <div style="height:12px"></div>
          <div class="panel">
            <div class="row" style="justify-content:space-between">
              <strong>本页已标注题目</strong>
              <button id="refreshPageQuestionsBtn" :disabled="currentPaperId == null || currentPageIndex < 0" @click="manualRefreshPageQuestions">刷新</button>
            </div>
            <div style="height:10px"></div>
            <div id="pageQuestions">
              <div v-if="!pageQuestions.length" class="muted">本页暂无已标注题目。</div>
              <div v-else v-for="q in pageQuestions" :key="q.id" class="qItem">
                <div class="row" style="justify-content:space-between">
                  <div>
                    <strong>题号 {{ q.question_no || '(未填)' }}</strong>
                    <template v-if="getQuestionSectionList(q).length">
                      <span v-for="s in getQuestionSectionList(q)" :key="s" class="pill tagPill" :title="sectionDisplayName(s)">{{ sectionDisplayName(s) }}</span>
                    </template>
                    <span v-else class="pill">(未填模块)</span>
                  </div>
                  <div class="row">
                    <button @click="editQuestion(q)">修改</button>
                    <button @click="highlightQuestion(q)">高亮</button>
                    <button @click="deleteQuestion(q)">删除</button>
                  </div>
                </div>
                <div class="muted">{{ q.notes || '' }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
