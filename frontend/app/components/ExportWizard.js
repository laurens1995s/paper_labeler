import { useExport } from "../use/useExport.js";

export default {
  name: "ExportWizard",
  setup() {
    return useExport();
  },
  template: `
    <div id="exportWizardMask" class="modalMask" :class="{ show: exportWizardOpen }">
      <div class="panel modalPanel">
        <div class="row" style="justify-content:space-between">
          <strong>导出 PDF</strong>
          <div class="row" style="gap:8px">
            <button id="exportWizardRandomBtn" class="secondaryBtn" @click="openRandomExportSettings">随机导出</button>
            <button id="exportWizardCloseBtn" @click="closeExportWizard">关闭</button>
          </div>
        </div>
        <div style="height:10px"></div>
        <div id="exportWizardSummary" class="muted">{{ exportWizardSummary }}</div>
        <div class="panel exportProgressWrap" v-if="exportJobStatus === 'queued' || exportJobStatus === 'processing'">
          <div class="row" style="justify-content:space-between; align-items:center">
            <strong>导出进度</strong>
            <span class="muted" v-if="exportJobStatus === 'queued' && exportJobQueuePos > 0">排队中，前方 {{ exportJobQueuePos }} 个任务</span>
            <span class="muted" v-else>{{ exportJobPhase || (exportJobStatus === 'processing' ? '处理中' : '') }}</span>
          </div>
          <div class="exportProgressBar">
            <div class="exportProgressFill" :style="{ width: (exportJobProgressPercent || 0) + '%' }"></div>
          </div>
          <div class="row" style="justify-content:space-between; align-items:center">
            <span class="muted">{{ Math.round(exportJobProgressPercent || 0) }}%</span>
            <button id="exportWizardCancelJobBtn" @click="cancelExportJob">取消任务</button>
          </div>
        </div>
        <div style="height:12px"></div>
        <div class="panel">
          <div class="row" style="align-items:center">
            <label class="muted" for="exportFileNameInput" style="min-width:74px">文件名</label>
            <input
              id="exportFileNameInput"
              v-model.trim="exportFileName"
              type="text"
              placeholder="可选，不含 .pdf 也可以"
              style="flex:1; min-width:220px"
            />
          </div>
          <div style="height:8px"></div>
          <div class="row" style="align-items:center; justify-content:space-between">
            <div class="muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:78%">
              默认另存目录：{{ exportDefaultSaveDir || '（未设置）' }}
            </div>
            <button id="exportWizardEditSaveDirBtn" @click="editExportSaveDir">修改目录</button>
          </div>
          <div class="muted" style="margin-top:8px">
            设置后将直接保存到该目录，不再触发浏览器下载。
          </div>
        </div>
        <div style="height:12px"></div>

        <div class="panel">
          <label :class="['muted', { disabled: exportFromRandomMode }]">
            <input
              id="exportOptIncludeFilterSummary"
              type="checkbox"
              v-model="exportIncludeFilterSummary"
              :disabled="exportFromRandomMode"
            />
            首页添加筛选信息
          </label>
          <div class="muted" style="margin-top:8px" v-if="!exportFromRandomMode">勾选后会在导出 PDF 首页居中显示筛选条件。</div>
          <div class="muted" style="margin-top:8px" v-else>随机导出模式下已自动禁用该选项。</div>
          <div v-if="exportIncludeFilterSummary && !exportFromRandomMode" style="margin-top:10px">
            <div class="muted" style="margin-bottom:6px">选择要显示的筛选项</div>
            <div class="grid2">
              <label class="muted"><input type="checkbox" v-model="exportSummaryFieldSection" /> 模块</label>
              <label class="muted"><input type="checkbox" v-model="exportSummaryFieldPaper" /> 试卷</label>
              <label class="muted"><input type="checkbox" v-model="exportSummaryFieldYear" /> 年份</label>
              <label class="muted"><input type="checkbox" v-model="exportSummaryFieldSeason" /> 季度</label>
              <label class="muted"><input type="checkbox" v-model="exportSummaryFieldFavorites" /> 收藏/排除多分类</label>
              <label class="muted"><input type="checkbox" v-model="exportSummaryFieldCount" /> 题目数量</label>
            </div>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div class="row" style="justify-content:space-between">
            <strong>题目信息（页眉）</strong>
            <span class="muted">每页一道题，正文留白</span>
          </div>
          <div style="height:10px"></div>
          <div class="grid2">
            <label class="muted"><input id="exportOptIncludeQno" type="checkbox" v-model="exportIncludeQno" /> 题号</label>
            <label class="muted"><input id="exportOptIncludeSection" type="checkbox" v-model="exportIncludeSection" /> 模块</label>
            <label class="muted"><input id="exportOptIncludePaper" type="checkbox" v-model="exportIncludePaper" /> 试卷来源</label>
            <label class="muted"><input id="exportOptIncludeOriginalQno" type="checkbox" v-model="exportIncludeOriginalQno" /> 题库内题号</label>
            <label class="muted"><input id="exportOptIncludeNotes" type="checkbox" v-model="exportIncludeNotes" /> 备注</label>
          </div>
        </div>

        <div style="height:12px"></div>

        <div class="panel">
          <div class="row" style="justify-content:space-between">
            <strong>答案</strong>
            <label class="muted"><input id="exportOptIncludeAnswers" type="checkbox" v-model="exportIncludeAnswers" /> 包含答案</label>
          </div>
          <div style="height:10px"></div>
          <div class="row" style="gap:14px">
            <label :class="['muted', { disabled: !exportIncludeAnswers }]">
              <input name="exportAnsPlacement" id="exportOptAnsEnd" type="radio" value="end" v-model="exportAnsPlacement" :disabled="!exportIncludeAnswers" />
              答案放在最后
            </label>
            <label :class="['muted', { disabled: !exportIncludeAnswers }]">
              <input name="exportAnsPlacement" id="exportOptAnsInterleaved" type="radio" value="interleaved" v-model="exportAnsPlacement" :disabled="!exportIncludeAnswers" />
              一道题接一个答案
            </label>
          </div>
          <div style="height:8px"></div>
          <div class="muted">说明：答案同样按“每页一题/一页一份答案”输出，只控制顺序。</div>
        </div>

        <div style="height:12px"></div>
        <div class="row" style="justify-content:flex-end">
          <button id="exportWizardCancelBtn" :disabled="exportBusy" @click="closeExportWizard">取消</button>
          <button id="exportWizardGoBtn" class="primaryBtn" :disabled="exportBusy" @click="confirmExportWizard">
            {{ exportBusy ? '导出中…' : '开始导出' }}
          </button>
        </div>
      </div>
    </div>
  `,
};
