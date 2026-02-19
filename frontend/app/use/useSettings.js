import { useAppContext } from "./useAppContext.js";
import { api } from "../../modules/api.js";
import * as Settings from "../../modules/settings.js";

export const useSettings = () => {
  return useAppContext();
};

export const settingsMethods = {
  initSettingsFromStorage() {
    this.alignLeftEnabled = Settings.loadAlignLeftSetting() ?? this.alignLeftEnabled;
    this.alignPaperFirstEnabled = Settings.loadAlignPaperFirstSetting() ?? this.alignPaperFirstEnabled;
    this.answerAlignEnabled = Settings.loadAnswerAlignSetting() ?? this.answerAlignEnabled;
    this.ocrAutoEnabled = Settings.loadOcrAutoSetting() ?? this.ocrAutoEnabled;
    const tuning = Settings.loadOcrBoxTuningSettings();
    if (tuning) {
      this.ocrMinHeightPx = tuning.ocrMinHeightPx ?? this.ocrMinHeightPx;
      this.ocrYPaddingPx = tuning.ocrYPaddingPx ?? this.ocrYPaddingPx;
    }
    const paperAlign = Settings.loadPaperAlignRef();
    if (paperAlign) this.paperAlignRef = paperAlign;
    const filterPageSize = Settings.loadFilterPageSize();
    if (filterPageSize) this.filterPageSize = filterPageSize;
    const virtual = Settings.loadFilterVirtualSettings();
    if (virtual) {
      this.filterVirtualThreshold = virtual.filterVirtualThreshold ?? this.filterVirtualThreshold;
      this.filterVirtualOverscanPx = virtual.filterVirtualOverscanPx ?? this.filterVirtualOverscanPx;
    }
    this.exportDefaultSaveDir = Settings.loadExportDefaultSaveDir() ?? "";
    const exportName = Settings.loadExportNameSettings();
    if (exportName) {
      this.exportNameTemplate = exportName.exportNameTemplate ?? this.exportNameTemplate;
      this.exportNamePrefix = exportName.exportNamePrefix ?? this.exportNamePrefix;
      this.exportNameSuffix = exportName.exportNameSuffix ?? this.exportNameSuffix;
      this.exportNameCustom = exportName.exportNameCustom ?? this.exportNameCustom;
      this.exportNameAutoTimestamp = exportName.exportNameAutoTimestamp ?? this.exportNameAutoTimestamp;
      this.exportNameSectionStyle = exportName.exportNameSectionStyle ?? this.exportNameSectionStyle;
      this.exportCropWorkers = exportName.exportCropWorkers ?? this.exportCropWorkers;
    }
    const exportWizardOpts = Settings.loadExportWizardOptions();
    if (exportWizardOpts) {
      this.exportIncludeQno = exportWizardOpts.includeQno ?? this.exportIncludeQno;
      this.exportIncludeSection = exportWizardOpts.includeSection ?? this.exportIncludeSection;
      this.exportIncludePaper = exportWizardOpts.includePaper ?? this.exportIncludePaper;
      this.exportIncludeOriginalQno = exportWizardOpts.includeOriginalQno ?? this.exportIncludeOriginalQno;
      this.exportIncludeNotes = exportWizardOpts.includeNotes ?? this.exportIncludeNotes;
      this.exportIncludeAnswers = exportWizardOpts.includeAnswers ?? this.exportIncludeAnswers;
      this.exportAnsPlacement = exportWizardOpts.ansPlacement ?? this.exportAnsPlacement;
      this.exportIncludeFilterSummary = exportWizardOpts.includeFilterSummary ?? this.exportIncludeFilterSummary;
      this.exportSummaryFieldSection = exportWizardOpts.summaryFieldSection ?? this.exportSummaryFieldSection;
      this.exportSummaryFieldPaper = exportWizardOpts.summaryFieldPaper ?? this.exportSummaryFieldPaper;
      this.exportSummaryFieldYear = exportWizardOpts.summaryFieldYear ?? this.exportSummaryFieldYear;
      this.exportSummaryFieldSeason = exportWizardOpts.summaryFieldSeason ?? this.exportSummaryFieldSeason;
      this.exportSummaryFieldFavorites = exportWizardOpts.summaryFieldFavorites ?? this.exportSummaryFieldFavorites;
      this.exportSummaryFieldCount = exportWizardOpts.summaryFieldCount ?? this.exportSummaryFieldCount;
    }
    Settings.loadExportSeqState();
    if (this.validateExportNameTemplate) {
      this.exportNameTemplateError = this.validateExportNameTemplate(this.exportNameTemplate);
    }
    if (typeof this.refreshExportCacheOverview === "function") {
      this.refreshExportCacheOverview();
    }
  },
  formatAgeText(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 60 * 1000) return `${Math.floor(n / 1000)} 秒`;
    if (n < 60 * 60 * 1000) return `${Math.floor(n / 60000)} 分钟`;
    return `${Math.floor(n / 3600000)} 小时 ${Math.floor((n % 3600000) / 60000)} 分钟`;
  },
  exportCacheHitRateText() {
    const s = this.exportCacheStats || {};
    const hit = Number(s.hit || 0);
    const miss = Number(s.miss || 0);
    const total = hit + miss;
    if (total <= 0) return "暂无数据";
    const rate = ((hit / total) * 100).toFixed(1);
    return `${rate}%（命中 ${hit} / 请求 ${total}）`;
  },
  toggleAlignLeft() {
    this.alignLeftEnabled = Settings.saveAlignLeftSetting(this.alignLeftEnabled);
    if (this.alignLeftEnabled) this.alignPaperFirstEnabled = false;
  },
  toggleAlignPaperFirst() {
    this.alignPaperFirstEnabled = Settings.saveAlignPaperFirstSetting(this.alignPaperFirstEnabled);
    if (this.alignPaperFirstEnabled) this.alignLeftEnabled = false;
    if (this.alignPaperFirstEnabled && this.currentPaperId != null) {
      this.ensurePaperAlignRefFromFirstQuestion(this.currentPaperId).catch(() => {});
    }
  },
  toggleAnswerAlign() {
    this.answerAlignEnabled = Settings.saveAnswerAlignSetting(this.answerAlignEnabled);
    this.setStatus(this.answerAlignEnabled ? "答案框左右对齐：已开启" : "答案框左右对齐：已关闭", "ok");
    try {
      if (this.answerAlignEnabled && this.view === "answer" && this.ensureAnswerAlignRefFromFirstQuestion) {
        this.ensureAnswerAlignRefFromFirstQuestion().catch(() => {});
      }
      this.redrawAllAnswerOverlays();
    } catch {}
  },
  toggleOcrAuto() {
    this.ocrAutoEnabled = Settings.saveOcrAutoSetting(this.ocrAutoEnabled);
    this.setStatus(this.ocrAutoEnabled ? "OCR 自动识别：已开启" : "OCR 自动识别：已关闭", "ok");
  },
  updateOcrMinHeight() {
    this.ocrMinHeightPx = Settings.saveOcrMinHeightPx(this.ocrMinHeightPx);
  },
  updateOcrYPadding() {
    this.ocrYPaddingPx = Settings.saveOcrYPaddingPx(this.ocrYPaddingPx);
  },
  updateFilterVirtualThreshold() {
    this.filterVirtualThreshold = Settings.saveFilterVirtualThreshold(this.filterVirtualThreshold);
  },
  updateFilterVirtualOverscanPx() {
    this.filterVirtualOverscanPx = Settings.saveFilterVirtualOverscanPx(this.filterVirtualOverscanPx);
  },
  updateExportDefaultSaveDir() {
    this.exportDefaultSaveDir = Settings.saveExportDefaultSaveDir(this.exportDefaultSaveDir);
    this.setStatus(this.exportDefaultSaveDir ? `已保存导出目录：${this.exportDefaultSaveDir}` : "已清空默认导出目录", "ok");
  },
  async pickExportDefaultSaveDir() {
    const current = String(this.exportDefaultSaveDir || "").trim();
    try {
      const resp = await api("/export/pick_save_dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initial_dir: current || null }),
      });
      if (!resp || resp.cancelled) return;
      const picked = String(resp.selected || "").trim();
      if (!picked) return;
      this.exportDefaultSaveDir = picked;
      this.updateExportDefaultSaveDir();
      return;
    } catch (e) {
      const next = prompt("默认另存目录（可为空）", current);
      if (next == null) return;
      this.exportDefaultSaveDir = String(next || "").trim();
      this.updateExportDefaultSaveDir();
    }
  },
  clearExportDefaultSaveDir() {
    this.exportDefaultSaveDir = "";
    this.updateExportDefaultSaveDir();
  },
  updateExportNameTemplate() {
    this.exportNameTemplate = Settings.saveExportNameTemplate(this.exportNameTemplate);
    if (this.validateExportNameTemplate) {
      this.exportNameTemplateError = this.validateExportNameTemplate(this.exportNameTemplate);
    }
    if (this.exportNameTemplateError) this.setStatus(this.exportNameTemplateError, "err");
    else this.setStatus("已保存导出文件名模板", "ok");
  },
  updateExportNamePrefix() {
    this.exportNamePrefix = Settings.saveExportNamePrefix(this.exportNamePrefix);
    this.setStatus("已保存默认前缀", "ok");
  },
  updateExportNameSuffix() {
    this.exportNameSuffix = Settings.saveExportNameSuffix(this.exportNameSuffix);
    this.setStatus("已保存默认后缀", "ok");
  },
  updateExportNameCustom() {
    this.exportNameCustom = Settings.saveExportNameCustom(this.exportNameCustom);
    this.setStatus("已保存自定义常量", "ok");
  },
  toggleExportNameAutoTimestamp() {
    this.exportNameAutoTimestamp = Settings.saveExportNameAutoTimestamp(this.exportNameAutoTimestamp);
    this.setStatus(this.exportNameAutoTimestamp ? "导出文件名自动时间戳：已开启" : "导出文件名自动时间戳：已关闭", "ok");
  },
  updateExportNameSectionStyle() {
    this.exportNameSectionStyle = Settings.saveExportNameSectionStyle(this.exportNameSectionStyle);
    this.setStatus("已保存模块名称样式", "ok");
  },
  updateExportCropWorkers() {
    this.exportCropWorkers = Settings.saveExportCropWorkers(this.exportCropWorkers);
    this.setStatus(this.exportCropWorkers > 0 ? `已保存导出并发数：${this.exportCropWorkers}` : "已恢复导出并发数为自动", "ok");
  },
  resetExportNameTemplateDefaults() {
    this.exportNameTemplate = Settings.saveExportNameTemplate(Settings.DEFAULT_EXPORT_NAME_TEMPLATE);
    this.exportNamePrefix = Settings.saveExportNamePrefix("");
    this.exportNameSuffix = Settings.saveExportNameSuffix("");
    this.exportNameCustom = Settings.saveExportNameCustom("");
    this.exportNameAutoTimestamp = Settings.saveExportNameAutoTimestamp(true);
    this.exportNameSectionStyle = Settings.saveExportNameSectionStyle("display");
    this.exportCropWorkers = Settings.saveExportCropWorkers(0);
    if (this.validateExportNameTemplate) {
      this.exportNameTemplateError = this.validateExportNameTemplate(this.exportNameTemplate);
    }
    this.setStatus("已恢复导出文件名默认规则", "ok");
  },
  clearExportCache() {
    try {
      if (typeof this.invalidateExportFilterCache === "function") {
        this.invalidateExportFilterCache();
      } else {
        this.exportFilterIdsCacheKey = "";
        this.exportFilterIdsCacheIds = [];
        this.exportFilterIdsCacheAt = 0;
        this.exportFilterCacheVersion = 0;
        try {
          localStorage.removeItem("cache:exportFilterIdsByKey");
          localStorage.removeItem("cache:exportFilterIdsLatest");
          localStorage.removeItem("cache:exportFilterCacheVersion");
        } catch {}
      }
      this.pendingExportIds = [];
      this.setStatus("已清除导出缓存", "ok");
      if (typeof this.refreshExportCacheOverview === "function") {
        this.refreshExportCacheOverview();
      }
    } catch (e) {
      this.setStatus(`清除缓存失败：${String(e)}`, "err");
    }
  },
  async checkQuestionsIntegrity() {
    if (this.maintenanceBusy) return;
    this.maintenanceBusy = true;
    try {
      const data = await api("/maintenance/questions_integrity");
      this.maintenanceIntegrityReport = data || null;
      this.setStatus("完整性检查完成", "ok");
    } catch (e) {
      this.setStatus(`完整性检查失败：${String(e)}`, "err");
    } finally {
      this.maintenanceBusy = false;
    }
  },
  async repairQuestionsData(applyNow = false) {
    if (this.maintenanceBusy) return;
    const payload = {
      dry_run: !applyNow,
      remove_orphan_boxes: !!this.maintenanceRemoveOrphanBoxes,
      fill_missing_question_no: !!this.maintenanceFillMissingQuestionNo,
      renumber_question_no_sequence: !!this.maintenanceRenumberQuestionNo,
    };
    if (applyNow) {
      const ok = confirm("将执行真实修复（不可撤销），确认继续？");
      if (!ok) return;
    }
    this.maintenanceBusy = true;
    try {
      const data = await api("/maintenance/questions_repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      this.maintenanceRepairReport = data?.report || null;
      this.setStatus(applyNow ? "数据修复已执行" : "干跑完成（未落库）", "ok");
      await this.checkQuestionsIntegrity();
    } catch (e) {
      this.setStatus(`${applyNow ? "数据修复" : "干跑"}失败：${String(e)}`, "err");
    } finally {
      this.maintenanceBusy = false;
    }
  },

  // -------- section editor --------
  async refreshSectionDefsIntoUI() {
    try {
      const [d, g] = await Promise.all([
        api("/section_defs"),
        api("/section_groups").catch(() => ({ groups: [] })),
      ]);
      const defs = d.sections || [];
      const groups = g.groups || [];
      this.sectionDefs = defs
        .slice()
        .sort((a, b) => (b?.id || 0) - (a?.id || 0))
        .map((s) => ({
          ...s,
          group_id: s?.group_id != null ? Number(s.group_id) : null,
          __last已保存Name: s?.name ?? "",
          __last已保存GroupId: s?.group_id != null ? Number(s.group_id) : null,
          __last已保存Content: s?.content ?? "",
        }));
      this.sectionGroups = groups
        .slice()
        .sort((a, b) => (Number(b?.id) || 0) - (Number(a?.id) || 0))
        .map((g) => ({
          ...g,
          id: g?.id != null ? Number(g.id) : g?.id,
          __last已保存Name: g?.name ?? "",
          __last已保存Show: g?.show_in_filter !== false,
        }));
    } catch {
      this.sectionDefs = [];
      this.sectionGroups = [];
    }

    let names = this.sectionDefs.map((s) => s.name).filter(Boolean);
    if (!names.length) {
      try {
        const d2 = await api("/sections");
        names = (d2.sections || []).filter(Boolean);
      } catch {
        names = [];
      }
    }
    const allNames = Array.from(new Set(names));
    this.sectionNames = allNames;

    const groupById = new Map(this.sectionGroups.map((g) => [g.id, g]));
    const groupVisibleById = new Map(
      this.sectionGroups.map((g) => [g.id, g.show_in_filter !== false])
    );

    const visibleNames = [];
    const ungrouped = [];
    const optionsByGroup = new Map(this.sectionGroups.map((g) => [g.id, []]));
    const labelMap = {};

    for (const s of this.sectionDefs) {
      const name = s?.name;
      if (!name) continue;
      const gid = s.group_id;
      const g = gid ? groupById.get(gid) : null;
      if (g?.name) {
        const prefix = `${g.name}_`;
        labelMap[name] = name.startsWith(prefix) ? name : `${g.name}_${name}`;
      } else {
        labelMap[name] = name;
      }
      if (gid && optionsByGroup.has(gid)) {
        optionsByGroup.get(gid).push(name);
      } else {
        ungrouped.push(name);
      }
      if (!gid || groupVisibleById.get(gid) !== false) {
        visibleNames.push(name);
      }
    }

    const groupsAll = [];
    if (ungrouped.length) groupsAll.push({ label: "(未分类)", options: ungrouped });
    for (const g of this.sectionGroups) {
      const opts = optionsByGroup.get(g.id) || [];
      if (opts.length) groupsAll.push({ label: g.name, options: opts });
    }
    const groupsVisible = [];
    if (ungrouped.length) groupsVisible.push({ label: "(未分类)", options: ungrouped });
    for (const g of this.sectionGroups) {
      if (g.show_in_filter === false) continue;
      const opts = optionsByGroup.get(g.id) || [];
      if (opts.length) groupsVisible.push({ label: g.name, options: opts });
    }

    const visibleFinal = this.sectionDefs.length ? Array.from(new Set(visibleNames)) : allNames;
    this.sectionNamesFilter = allNames;
    this.sectionNamesMark = visibleFinal;
    this.sectionOptionGroupsAll = groupsAll.length ? groupsAll : (allNames.length ? [{ label: "(全部)", options: allNames }] : []);
    this.sectionOptionGroupsVisible = groupsVisible.length ? groupsVisible : (visibleFinal.length ? [{ label: "(全部)", options: visibleFinal }] : []);
    if (!Object.keys(labelMap).length && allNames.length) {
      allNames.forEach((n) => { labelMap[n] = n; });
    }
    this.sectionLabelMap = labelMap;
  },

  // -------- OCR draft --------
  async addSectionDef() {
    if (!this.newSectionName) return;
    try {
      this.setStatus("添加模块中…");
      const gid = this.newSectionGroupId != null && this.newSectionGroupId !== ""
        ? Number(this.newSectionGroupId)
        : null;
      await api("/section_defs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.newSectionName, content: "", group_id: gid }),
      });
      this.setStatus("已添加", "ok");
      this.newSectionName = "";
      this.newSectionGroupId = null;
      await this.refreshSectionDefsIntoUI();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async saveSectionDef(s) {
    try {
      this.setStatus(`保存模块 ${s.name} 中…`);
      const gid = s.group_id != null && s.group_id !== "" ? Number(s.group_id) : null;
      const resp = await api(`/section_defs/${s.id}` , {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name, content: s.content, group_id: gid }),
      });
      if (resp && resp.renamed_count != null && resp.renamed_count > 0) {
        this.setStatus(`已保存（同步更新 ${resp.renamed_count} 题）`, "ok");
      } else {
        this.setStatus("已保存", "ok");
      }
      await this.refreshSectionDefsIntoUI();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async deleteSectionDef(s) {
    if (!confirm(`确认删除模块 ${s.name}？`)) return;
    try {
      this.setStatus(`删除模块 ${s.name} 中…`);
      await api(`/section_defs/${s.id}`, { method: "DELETE" });
      this.setStatus("已删除", "ok");
      await this.refreshSectionDefsIntoUI();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async addSectionGroup() {
    if (!this.newSectionGroupName) return;
    try {
      this.setStatus("添加分类中…");
      await api("/section_groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.newSectionGroupName, show_in_filter: true }),
      });
      this.setStatus("已添加", "ok");
      this.newSectionGroupName = "";
      await this.refreshSectionDefsIntoUI();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async autoSaveSectionDef(s) {
    if (!s) return;
    const name = String(s.name || "").trim();
    if (!name) return;
    const groupId = s.group_id != null && s.group_id !== "" ? Number(s.group_id) : null;
    const content = s.content ?? "";
    if (
      name === (s.__last已保存Name ?? "") &&
      groupId === (s.__last已保存GroupId ?? null) &&
      content === (s.__last已保存Content ?? "")
    ) return;
    s.name = name;
    s.group_id = groupId;
    await this.saveSectionDef(s);
  },
  async onSectionDefGroupChange(s, value) {
    if (!s) return;
    s.group_id = value != null && value !== "" ? Number(value) : null;
    await this.autoSaveSectionDef(s);
  },
  async saveSectionGroup(g) {
    try {
      this.setStatus(`保存分类 ${g.name} 中…`);
      await api(`/section_groups/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: g.name, show_in_filter: g.show_in_filter }),
      });
      this.setStatus("分类已保存", "ok");
      await this.refreshSectionDefsIntoUI();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async autoSaveSectionGroup(g) {
    if (!g) return;
    const name = String(g.name || "").trim();
    if (!name) return;
    const show = g.show_in_filter !== false;
    if (name === (g.__last已保存Name ?? "") && show === (g.__last已保存Show ?? true)) return;
    g.name = name;
    await this.saveSectionGroup(g);
  },
  async deleteSectionGroup(g) {
    if (!confirm(`确认删除分类 ${g.name}？`)) return;
    try {
      this.setStatus(`删除分类 ${g.name} 中…`);
      await api(`/section_groups/${g.id}`, { method: "DELETE" });
      this.setStatus("分类已删除", "ok");
      await this.refreshSectionDefsIntoUI();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },

  sectionDisplayName(name) {
    if (!name) return "";
    return this.sectionLabelMap?.[name] || name;
  },

  // -------- section bulk --------
  toggleSectionMultiSelect() {
    this.sectionMultiSelect = !this.sectionMultiSelect;
    if (!this.sectionMultiSelect) this.selectedSectionDefIds = new Set();
  },
  toggleSectionSelection(s, evt) {
    const next = new Set(this.selectedSectionDefIds);
    if (evt?.target?.checked) next.add(s.id);
    else next.delete(s.id);
    this.selectedSectionDefIds = next;
  },
  selectAllSectionDefs() {
    this.selectedSectionDefIds = new Set((this.sectionDefs || []).map((s) => s.id));
  },
  clearSectionSelection() {
    this.selectedSectionDefIds = new Set();
  },
  async applyBatchSectionGroup() {
    const ids = Array.from(this.selectedSectionDefIds);
    if (!ids.length) {
      this.setStatus("未选择模块", "err");
      return;
    }
    try {
      this.setStatus(`批量归类中（${ids.length} 个）`);
      const gid = this.sectionBatchGroupId != null && this.sectionBatchGroupId !== ""
        ? Number(this.sectionBatchGroupId)
        : null;
      for (const id of ids) {
        await api(`/section_defs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group_id: gid }),
        });
      }
      this.setStatus("批量归类完成", "ok");
      await this.refreshSectionDefsIntoUI();
      this.clearSectionSelection();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },
  async deleteSelectedSectionDefs() {
    const ids = Array.from(this.selectedSectionDefIds);
    if (!ids.length) {
      this.setStatus("未选择模块", "err");
      return;
    }
    if (!confirm(`确认删除选中的 ${ids.length} 个模块？`)) return;
    try {
      this.setStatus(`批量删除模块中（${ids.length} 个）`);
      for (const id of ids) {
        await api(`/section_defs/${id}`, { method: "DELETE" });
      }
      this.setStatus("已删除", "ok");
      await this.refreshSectionDefsIntoUI();
      this.clearSectionSelection();
    } catch (e) {
      this.setStatus(String(e), "err");
    }
  },

  // -------- upload --------
};
