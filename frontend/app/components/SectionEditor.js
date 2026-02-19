import { useSettings } from "../use/useSettings.js";
import SimpleSelect from "./SimpleSelect.js";

export default {
  name: "SectionEditor",
  setup() {
    return useSettings();
  },
  components: { SimpleSelect },
  computed: {
    sectionDefsGroupedSorted() {
      const defs = Array.isArray(this.sectionDefs) ? this.sectionDefs.slice() : [];
      if (!defs.length) return [];
      const groups = Array.isArray(this.sectionGroups) ? this.sectionGroups : [];
      const order = new Map();
      order.set(null, -1);
      groups.forEach((g, idx) => {
        order.set(g?.id ?? null, idx);
      });
      defs.sort((a, b) => {
        const ga = a?.group_id ?? null;
        const gb = b?.group_id ?? null;
        const oa = order.has(ga) ? order.get(ga) : 9999;
        const ob = order.has(gb) ? order.get(gb) : 9999;
        if (oa !== ob) return oa - ob;
        return (Number(b?.id) || 0) - (Number(a?.id) || 0);
      });
      return defs;
    },
  },
  template: `
    <div id="sectionView">
      <div class="row">
        <strong>模块编辑</strong>
        <span class="muted">预先编写模块与分类；框选时可下拉选择。</span>
      </div>
      <div style="height:12px"></div>
      <div class="panel">
        <div class="sectionSticky">
          <div class="row">
            <label class="muted">新分类</label>
            <input
              id="newSectionGroupName"
              v-model="newSectionGroupName"
              style="width:220px"
              @keydown.enter.prevent="addSectionGroup"
            />
            <button id="addSectionGroupBtn" @click="addSectionGroup">添加分类</button>
          </div>
          <div style="height:10px"></div>
          <div class="row">
            <label class="muted">分类</label>
            <SimpleSelect
              v-model="newSectionGroupId"
              :options="[{ value: null, label: '(不分类)' }, ...sectionGroups.map((g) => ({ value: g.id, label: g.name }))]"
              :fixed="true"
              style="width:180px"
            />
            <label class="muted">新模块名</label>
            <input
              id="newSectionName"
              v-model="newSectionName"
              style="width:280px"
              @keydown.enter.prevent="addSectionDef"
            />
            <button id="addSectionBtn" @click="addSectionDef">添加</button>
          </div>
        </div>
        <div class="row" style="margin: 6px 0 10px 0;">
          <button @click="toggleSectionMultiSelect">{{ sectionMultiSelect ? '取消多选' : '多选' }}</button>
          <button v-show="sectionMultiSelect" @click="selectAllSectionDefs">全选</button>
          <button v-show="sectionMultiSelect" @click="clearSectionSelection">清空</button>
          <span v-show="sectionMultiSelect" class="muted">已选 {{ selectedSectionDefIds.size }} 个</span>
          <SimpleSelect
            v-show="sectionMultiSelect"
            v-model="sectionBatchGroupId"
            :options="[{ value: null, label: '(不分类)' }, ...sectionGroups.map((g) => ({ value: g.id, label: g.name }))]"
            :fixed="true"
            style="width:180px"
          />
          <button v-show="sectionMultiSelect" @click="applyBatchSectionGroup">一键归类</button>
          <button v-show="sectionMultiSelect" @click="deleteSelectedSectionDefs">删除选中</button>
        </div>
        <div class="sectionBox">
          <div class="row" style="justify-content:space-between">
            <strong>分类</strong>
            <span class="muted">可控制标注界面是否显示</span>
          </div>
          <div class="sectionScroll sectionGroupScroll">
            <div v-if="!sectionGroups.length" class="muted">暂无分类。</div>
            <div v-else v-for="g in sectionGroups" :key="g.id" class="qItem">
              <div class="row" style="justify-content:space-between; align-items:center;">
                <div class="row sectionGroupFields">
                  <span class="pill" style="background:#eef2ff; color:#4338ca; border:1px solid rgba(67,56,202,0.25);">分类</span>
                  <input
                    v-model="g.name"
                    style="width:260px; padding:6px 8px; border:1px solid #eee; border-radius:8px;"
                    @blur="autoSaveSectionGroup(g)"
                    @keydown.enter.prevent="autoSaveSectionGroup(g)"
                  />
                  <label class="muted" style="display:flex; gap:6px; align-items:center">
                    <input type="checkbox" v-model="g.show_in_filter" @change="autoSaveSectionGroup(g)" />
                    标注界面显示
                  </label>
                </div>
                <div class="row">
                  <button @click="deleteSectionGroup(g)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style="height:12px"></div>
        <div class="sectionBox">
          <div class="row" style="justify-content:space-between">
            <strong>模块</strong>
            <span class="muted">模块归属分类</span>
          </div>
          <div id="sectionList" class="sectionScroll sectionModuleScroll">
            <div v-if="!sectionDefs.length" class="muted">暂无预设模块。你可以先添加几个常用模块。</div>
            <div v-else v-for="s in sectionDefsGroupedSorted" :key="s.id" class="qItem">
              <div class="row" style="justify-content:space-between">
                <div class="row sectionItemFields">
                  <input
                    v-show="sectionMultiSelect"
                    type="checkbox"
                    :checked="selectedSectionDefIds.has(s.id)"
                    style="margin-right:8px"
                    @change="toggleSectionSelection(s, $event)"
                  />
                  <span class="pill" style="background:#ecfeff; color:#0f766e; border:1px solid rgba(13,148,136,0.25);">模块</span>
                  <SimpleSelect
                    v-model="s.group_id"
                    :options="[{ value: null, label: '(不分类)' }, ...sectionGroups.map((g) => ({ value: g.id, label: g.name }))]"
                    :fixed="true"
                    style="width:180px;"
                    @change="(val) => onSectionDefGroupChange(s, val)"
                  />
                  <input
                    v-model="s.name"
                    style="width:320px; padding:6px 8px; border:1px solid #eee; border-radius:8px; margin-left:8px;"
                    @blur="autoSaveSectionDef(s)"
                    @keydown.enter.prevent="autoSaveSectionDef(s)"
                  />
                </div>
                <div class="row">
                  <button @click="deleteSectionDef(s)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
