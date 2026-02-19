import { useCieImport } from "../use/useCieImport.js";
import SimpleSelect from "./SimpleSelect.js";

export default {
  name: "CieImport",
  components: { SimpleSelect },
  setup() {
    return useCieImport();
  },
  template: `
    <div id="cieImportMask" class="modalMask" :class="{ show: cieImportOpen }">
      <div class="panel modalPanel">
        <div class="row" style="justify-content:space-between">
          <strong>从 CIE 网站导入试卷</strong>
          <button id="cieImportCloseBtn" @click="closeCieImportModal">关闭</button>
        </div>
        <div style="height:10px"></div>
        <div class="muted">从 cie.fraft.cn 查询并导入试卷，支持按科目、年份、季度筛选</div>
        <div style="height:12px"></div>

        <div class="panel">
          <div class="row" style="justify-content:space-between">
            <strong>筛选条件</strong>
            <span class="muted">cie.fraft.cn</span>
          </div>
          <div style="height:8px"></div>
          <div class="row" style="gap:8px; align-items:center">
            <label class="muted" style="white-space:nowrap">科目:</label>
            <input id="cieSubjectInput" v-model="cieSubjectInput" type="text" placeholder="9709" style="width:80px" @input="updateCieSubjectName" />
            <span id="cieSubjectName" class="muted" style="font-size:12px" :class="cieSubjectNameKind">{{ cieSubjectName }}</span>
            <label class="muted" style="white-space:nowrap">年份:</label>
            <input id="cieYearInput" v-model="cieYearInput" type="text" placeholder="2023" style="width:80px" />
            <label class="muted" style="white-space:nowrap">季度:</label>
            <SimpleSelect
              id="cieSeasonSelect"
              v-model="cieSeason"
              :fixed="true"
              :options="[{ value: 'Mar', label: 'Mar' }, { value: 'Jun', label: 'Jun' }, { value: 'Nov', label: 'Nov' }]"
              style="width:80px"
            />
            <button id="cieFetchBtn" class="primaryBtn" :disabled="cieLoading" @click="fetchCiePapers">查询</button>
          </div>
          <div style="height:8px"></div>
          <div id="cieImportStatus" class="muted">{{ cieImportStatus }}</div>
        </div>

        <div style="height:12px"></div>

        <div id="ciePaperListContainer" v-show="ciePaperGroups.length || ciePaperUnpaired.length">
          <div class="panel">
            <div class="row" style="justify-content:space-between; align-items:center">
              <span id="ciePaperCount" class="muted">{{ ciePaperCountText }}</span>
              <div class="row" style="gap:6px">
                <button id="cieSelectAllBtn" class="secondaryBtn" style="padding:4px 8px; font-size:12px" @click="cieSelectAll">全选</button>
                <button id="cieDeselectAllBtn" class="secondaryBtn" style="padding:4px 8px; font-size:12px" @click="cieDeselectAll">取消全选</button>
              </div>
            </div>
            <div style="height:6px"></div>
            <div id="ciePaperList" style="max-height:300px; overflow-y:auto; border:1px solid #ddd; border-radius:4px; padding:8px; background:#fafafa">
              <div v-if="!ciePaperGroups.length && !ciePaperUnpaired.length" style="padding:20px; text-align:center; color:#999">暂无试卷</div>
              <template v-else>
                <div v-for="group in ciePaperGroups" :key="group.baseName" style="padding:6px; border-bottom:1px solid #eee; display:flex; gap:12px">
                  <div v-if="group.qp" style="flex:1; display:flex; align-items:center; gap:6px">
                    <input
                      type="checkbox"
                      class="ciePaperCheckbox"
                      :id="\`ciePaper\${group.qp.originalIdx}\`"
                      :checked="cieSelectedIds.has(group.qp.originalIdx)"
                      @change="toggleCieSelection(group.qp, $event.target.checked)"
                    />
                    <label :for="\`ciePaper\${group.qp.originalIdx}\`" style="cursor:pointer; display:flex; align-items:center; gap:6px; flex:1">
                      <span style="font-family:monospace; font-size:13px">{{ group.qp.filename }}</span>
                      <span style="font-size:11px; padding:2px 6px; border-radius:3px; background:#2563eb; color:white">试题</span>
                      <span v-if="group.qp.exists" style="font-size:10px; padding:2px 5px; border-radius:3px; background:#f59e0b; color:white">已导入</span>
                      <span v-if="group.qp.done" style="font-size:10px; padding:2px 5px; border-radius:3px; background:#10b981; color:white">已完成</span>
                    </label>
                  </div>
                  <div v-if="group.ms" style="flex:1; display:flex; align-items:center; gap:6px">
                    <input
                      type="checkbox"
                      class="ciePaperCheckbox"
                      :id="\`ciePaper\${group.ms.originalIdx}\`"
                      :checked="cieSelectedIds.has(group.ms.originalIdx)"
                      @change="toggleCieSelection(group.ms, $event.target.checked)"
                    />
                    <label :for="\`ciePaper\${group.ms.originalIdx}\`" style="cursor:pointer; display:flex; align-items:center; gap:6px; flex:1">
                      <span style="font-family:monospace; font-size:13px">{{ group.ms.filename }}</span>
                      <span style="font-size:11px; padding:2px 6px; border-radius:3px; background:#059669; color:white">答案</span>
                      <span v-if="group.ms.exists" style="font-size:10px; padding:2px 5px; border-radius:3px; background:#f59e0b; color:white">已导入</span>
                      <span v-if="group.ms.done" style="font-size:10px; padding:2px 5px; border-radius:3px; background:#10b981; color:white">已完成</span>
                    </label>
                  </div>
                </div>

                <div v-for="paper in ciePaperUnpaired" :key="paper.originalIdx" style="padding:6px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:8px">
                  <input
                    type="checkbox"
                    class="ciePaperCheckbox"
                    :id="\`ciePaper\${paper.originalIdx}\`"
                    :checked="cieSelectedIds.has(paper.originalIdx)"
                    @change="toggleCieSelection(paper, $event.target.checked)"
                  />
                  <label :for="\`ciePaper\${paper.originalIdx}\`" style="flex:1; cursor:pointer; display:flex; align-items:center; gap:8px">
                    <span style="font-family:monospace; font-size:13px">{{ paper.filename }}</span>
                    <span style="font-size:11px; padding:2px 6px; border-radius:3px; background:#6b7280; color:white">其他</span>
                    <span v-if="paper.exists" style="font-size:10px; padding:2px 5px; border-radius:3px; background:#f59e0b; color:white">已导入</span>
                  </label>
                </div>
              </template>
            </div>
            <div style="height:8px"></div>
            <div class="row" style="justify-content:space-between; align-items:center">
              <span id="cieSelectedCount" class="muted">已选择 {{ cieSelectedIds.size }} 份</span>
              <button id="cieBatchImportBtn" class="primaryBtn" :disabled="cieSelectedIds.size === 0 || cieLoading" @click="startCieBatchImportFromList">导入选中试卷</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
