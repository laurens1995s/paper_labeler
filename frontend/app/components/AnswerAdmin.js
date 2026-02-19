import { useAnswer } from "../use/useAnswer.js";

export default {
  name: "AnswerAdmin",
  setup() {
    return useAnswer();
  },
  template: `
    <div id="answerAdminView">
      <div class="row">
        <button id="backFromAnswerAdminBtn" @click="backFromAnswerAdmin">返回标注</button>
        <strong>答案管理（MS）</strong>
        <button id="refreshAnswerPapersBtn" @click="refreshAnswerPapers">刷新</button>
        <span class="muted">说明：答案卷不显示在试卷列表里。</span>
      </div>
      <div style="height:12px"></div>
      <div id="answerPaperList">
        <div v-if="!answerPaperList.length" class="muted">暂无答案卷（上传 *_ms_* PDF 即可自动识别）。</div>
        <div v-else v-for="p in answerPaperList" :key="p.id" class="paperItem">
          <div class="row" style="justify-content:space-between">
            <div>
              <div><strong>答案卷 {{ p.display_no != null ? p.display_no : p.id }}</strong> {{ formatPaperName(p) || ('paper#' + p.id) }}</div>
              <div class="muted">id={{ p.id }} · {{ p.filename }} · pages={{ p.page_count ?? '?' }}</div>
              <div class="muted">配对：{{ p.paired_paper_id ? ('#' + p.paired_paper_id) : '(未匹配)' }}</div>
            </div>
            <div class="row">
              <button @click="startAnswerMarkFromAdmin(p.id, p.paired_paper_id)">开始标记答案</button>
              <button @click="deleteAnswerPaper(p)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
