import { usePapers } from "../use/usePapers.js";

export default {
  name: "PaperList",
  setup() {
    return usePapers();
  },
  template: `
    <div id="paperScrollList" class="paperScroll">
      <div v-if="!papers.length" class="muted">暂无试卷（请先上传 PDF）。</div>
      <div v-else-if="!viewPapers.length" class="muted">
        {{ showDonePapers ? '暂无已完成试卷。' : '暂无未完成试卷。若试卷都已标记完成，请点右上角“已完成试卷”。' }}
      </div>
      <div v-else v-for="p in viewPapers" :key="p.id" class="paperRow" :class="{ done: p.done, active: p.id === currentPaperId }" @click="openPaper(p.id)">
        <div class="top">
          <div style="min-width:0">
            <div><strong>卷 {{ p.display_no != null ? p.display_no : p.id }}</strong> {{ formatPaperName(p) || ('paper#' + p.id) }}</div>
          </div>
          <div class="row" style="flex:0 0 auto">
            <label class="muted" style="display:flex;gap:6px;align-items:center">
              <input type="checkbox" :checked="p.done" @click.stop="togglePaperDone(p, $event)" /> 完成
            </label>
            <button @click.stop="deletePaper(p, $event)" title="删除整卷">删除</button>
          </div>
        </div>
        <div class="meta">
          <span>页数：{{ p.page_count ?? '?' }}</span>
          <span>题目数：{{ p.question_count ?? 0 }}</span>
          <span>答案标注：{{ p.answers_marked ?? 0 }}</span>
        </div>
      </div>
    </div>
  `,
};
