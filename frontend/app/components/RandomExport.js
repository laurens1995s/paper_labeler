import { useExport } from "../use/useExport.js";

export default {
  name: "RandomExport",
  setup() {
    return useExport();
  },
  template: `
    <div id="randomExportMask" class="modalMask" :class="{ show: randomExportOpen }">
      <div class="panel modalPanel">
        <div class="row" style="justify-content:space-between">
          <strong>随机导出设置</strong>
          <button id="randomExportCloseBtn" @click="randomExportOpen = false">关闭</button>
        </div>
        <div style="height:10px"></div>
        <div class="muted">为每个分类设置题目数量，系统将随机抽取题目组成试卷</div>
        <div style="height:10px"></div>
        <div class="row">
          <label class="muted"><input id="randomExportFavOnly" type="checkbox" v-model="randomExportFavOnly" @change="onRandomExportFavOnlyChange" /> 仅从收藏题目中随机</label>
        </div>
        <div style="height:10px"></div>
        <div class="panel randomExportScroll">
          <div class="randomExportBlock">
            <div class="row" style="justify-content:space-between">
              <strong>包含年份</strong>
              <span class="muted">取消勾选即排除对应年份的题目</span>
            </div>
            <div style="height:8px"></div>
            <div id="randomExportYearList" class="grid2">
              <label v-for="y in randomExportYearList" :key="y.year" class="muted">
                <input type="checkbox" v-model="y.checked" /> {{ y.year }}
              </label>
            </div>
          </div>
          <div style="height:12px"></div>
          <div class="randomExportBlock">
            <div class="row" style="justify-content:space-between;margin-bottom:10px">
              <div class="row" style="gap:8px">
                <button id="randomExportBatchSubBtn" title="批量减少选中分类的题目数" @click="randomExportBatch(-1)">批量 -</button>
                <button id="randomExportBatchAddBtn" title="批量增加选中分类的题目数" @click="randomExportBatch(1)">批量 +</button>
                <input id="randomExportBatchValue" v-model.number="randomExportBatchValue" type="number" min="1" value="1" style="width:60px" />
              </div>
              <button id="randomExportResetBtn" class="secondaryBtn" @click="randomExportReset">清零</button>
            </div>
            <div id="randomExportSectionList">
              <div v-for="group in randomExportGroups" :key="group.label" class="randomGroup">
                <div class="row randomGroupHeader" style="justify-content:space-between; align-items:center;" @click="toggleRandomExportGroup(group.label)">
                  <div class="row" style="gap:8px; align-items:center;">
                    <span class="pill">{{ isRandomExportGroupOpen(group.label) ? '▼' : '▶' }}</span>
                    <strong>{{ group.label }}</strong>
                    <span class="muted">(库存 {{ group.totalCount }})</span>
                  </div>
                  <button class="groupSelectBtn" @click.stop="toggleRandomExportGroupSelectAll(group)">{{ isRandomExportGroupAllSelected(group) ? '取消全选' : '全选' }}</button>
                </div>
                <div v-show="isRandomExportGroupOpen(group.label)" style="margin-top:6px">
                  <div v-for="item in group.items" :key="item.section" class="row" style="justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f1f1;">
                    <label class="muted" style="display:flex; align-items:center; gap:8px; font-size:15px;">
                      <input type="checkbox" v-model="item.selected" />
                      <span :title="item.section || '未分类'">{{ item.section || '未分类' }}</span>
                      <span class="muted">(库存 {{ item.count }})</span>
                    </label>
                    <input type="number" min="0" style="width:80px" v-model.number="item.value" @input="randomExportUpdateTotal" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style="height:12px"></div>
        <div class="row" style="justify-content:space-between;align-items:center">
          <strong>预计总题数: <span id="randomExportTotalCount">{{ randomExportTotalCount }}</span></strong>
          <div class="row" style="gap:8px">
            <button id="randomExportCancelBtn" @click="randomExportOpen = false">取消</button>
            <button id="randomExportConfirmBtn" class="primaryBtn" @click="confirmRandomExport">确认</button>
          </div>
        </div>
      </div>
    </div>
  `,
};
