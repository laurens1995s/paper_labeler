import { useSettings } from "../use/useSettings.js";

export default {
  name: "SettingsView",
  setup() {
    return useSettings();
  },
  template: `
    <div id="settingsView">
      <div class="row">
        <strong>设置</strong>
      </div>
      <div style="height:12px"></div>

      <div class="panel">
        <div><strong>标注对齐</strong></div>
        <div style="height:12px"></div>

        <div class="row" style="justify-content:space-between">
          <div>
            <div><strong>多选区左右对齐</strong></div>
            <div class="muted" style="margin-top:6px">框选同一题的第 2 个及以后选区时，自动把左右边界与第 1 个选区对齐（统一宽度）。</div>
          </div>
          <label class="muted" style="display:flex; gap:8px; align-items:center">
            <span class="switchWrap">
              <span class="muted">关闭</span>
              <label class="switch" title="开启/关闭">
                <input id="alignLeftEnabledChk" type="checkbox" v-model="alignLeftEnabled" @change="toggleAlignLeft" />
                <span class="slider"></span>
              </label>
              <span class="muted">开启</span>
            </span>
          </label>
        </div>

        <div style="height:14px"></div>

        <div class="row" style="justify-content:space-between">
          <div>
            <div><strong>按试卷第一题左右对齐</strong></div>
            <div class="muted" style="margin-top:6px">同一张试卷中，从第 2 题开始框选时，自动把左右边界对齐到该试卷第一道已框选题。</div>
          </div>
          <label class="muted" style="display:flex; gap:8px; align-items:center">
            <span class="switchWrap">
              <span class="muted">关闭</span>
              <label class="switch" title="开启/关闭">
                <input id="alignPaperFirstEnabledChk" type="checkbox" v-model="alignPaperFirstEnabled" @change="toggleAlignPaperFirst" />
                <span class="slider"></span>
              </label>
              <span class="muted">开启</span>
            </span>
          </label>
        </div>

        <div style="height:14px"></div>

        <div class="row" style="justify-content:space-between">
          <div>
            <div><strong>答案框左右对齐</strong></div>
            <div class="muted" style="margin-top:6px">标注答案（MS）时，从第 2 个框开始自动对齐到第 1 个框的左右边界。</div>
          </div>
          <label class="muted" style="display:flex; gap:8px; align-items:center">
            <span class="switchWrap">
              <span class="muted">关闭</span>
              <label class="switch" title="开启/关闭">
                <input id="answerAlignEnabledChk" type="checkbox" v-model="answerAlignEnabled" @change="toggleAnswerAlign" />
                <span class="slider"></span>
              </label>
              <span class="muted">开启</span>
            </span>
          </label>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="panel">
        <div><strong>OCR 识别</strong></div>
        <div style="height:12px"></div>

        <div class="row" style="justify-content:space-between">
          <div>
            <div><strong>自动读取 PDF 题号并生成建议框</strong></div>
            <div class="muted" style="margin-top:6px">上传 QP 后，从第 2 页开始识别题号/小题号，生成未保存的建议框选。</div>
          </div>
          <label class="muted" style="display:flex; gap:8px; align-items:center">
            <span class="switchWrap">
              <span class="muted">关闭</span>
              <label class="switch" title="开启/关闭">
                <input id="ocrAutoEnabledChk" type="checkbox" v-model="ocrAutoEnabled" @change="toggleOcrAuto" />
                <span class="slider"></span>
              </label>
              <span class="muted">开启</span>
            </span>
          </label>
        </div>

        <div style="height:10px"></div>

        <div id="ocrTuningPanel" class="row" style="justify-content:space-between; align-items:flex-start;" v-show="ocrAutoEnabled">
          <div>
            <div><strong>建议框最小高度 / 上下留白</strong></div>
            <div class="muted" style="margin-top:6px">单位像素，用于控制建议框最小高度与上下留白。</div>
          </div>
          <div class="row" style="gap:10px; align-items:center">
            <label class="muted">最小高度(px)</label>
            <input id="ocrMinHeightPxInput" v-model.number="ocrMinHeightPx" type="number" min="0" max="2000" step="1" style="width:96px" @change="updateOcrMinHeight" />
            <label class="muted">上下留白(px)</label>
            <input id="ocrYPaddingPxInput" v-model.number="ocrYPaddingPx" type="number" min="0" max="500" step="1" style="width:96px" @change="updateOcrYPadding" />
          </div>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="panel">
        <div><strong>列表性能</strong></div>
        <div style="height:12px"></div>

        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div><strong>题库列表虚拟化</strong></div>
            <div class="muted" style="margin-top:6px">阈值：达到该题数才启用虚拟化。Overscan：上下额外渲染像素（越大越顺滑，越小越省性能）。</div>
          </div>
          <div class="row" style="gap:10px; align-items:center">
            <label class="muted">阈值(题)</label>
            <input id="filterVirtualThresholdInput" v-model.number="filterVirtualThreshold" type="number" min="1" max="200" step="1" style="width:96px" @change="updateFilterVirtualThreshold" />
            <label class="muted">Overscan(px)</label>
            <input id="filterVirtualOverscanPxInput" v-model.number="filterVirtualOverscanPx" type="number" min="0" max="5000" step="50" style="width:110px" @change="updateFilterVirtualOverscanPx" />
          </div>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="panel">
        <div><strong>导出设置</strong></div>
        <div style="height:12px"></div>

        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div><strong>默认另存目录</strong></div>
            <div class="muted" style="margin-top:6px">导出 PDF 将直接保存到该目录（不再触发浏览器下载）。</div>
          </div>
          <div class="row" style="gap:10px; align-items:center; max-width:60%">
            <div
              id="exportDefaultSaveDirText"
              class="muted"
              :title="exportDefaultSaveDir || '（未设置）'"
              style="min-width:340px; max-width:520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:var(--panel)"
            >
              {{ exportDefaultSaveDir || '（未设置）' }}
            </div>
            <button id="pickExportDefaultSaveDirBtn" @click="pickExportDefaultSaveDir">选择目录</button>
            <button id="clearExportDefaultSaveDirBtn" @click="clearExportDefaultSaveDir">清空</button>
          </div>
        </div>

        <div style="height:14px"></div>
        <div class="row" style="justify-content:space-between; align-items:center; gap:12px;">
          <div>
            <div><strong>导出缓存管理</strong></div>
            <div class="muted" style="margin-top:4px;">切换筛选后再次导出会复用缓存；点击按钮可强制清空。</div>
            <div class="muted" style="margin-top:4px;">
              缓存有效期：{{ Math.round((exportCacheOverview?.ttlMs || 0) / 3600000) || 0 }} 小时；
              清理策略：超时自动失效 + 最多保留最近 12 组筛选缓存。
            </div>
            <div class="muted" style="margin-top:4px;">
              当前缓存：{{ exportCacheOverview?.entryCount || 0 }} 组；
              最新缓存年龄：{{ formatAgeText(exportCacheOverview?.newestAgeMs) }}；
              最旧缓存年龄：{{ formatAgeText(exportCacheOverview?.oldestAgeMs) }}
            </div>
            <div class="muted" style="margin-top:4px;">
              命中率：{{ exportCacheHitRateText() }}；
              过期失效：{{ exportCacheStats?.expired || 0 }} 次；
              写入：{{ exportCacheStats?.write || 0 }} 次
            </div>
          </div>
          <button id="clearExportCacheBtn" @click="clearExportCache">清除导出缓存</button>
        </div>

        <div style="height:14px"></div>
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div><strong>导出并发裁剪</strong></div>
            <div class="muted" style="margin-top:6px">控制导出时图片裁剪并发数。0 为自动，通常最快且最稳。</div>
          </div>
          <div class="row" style="gap:10px; align-items:center">
            <input
              id="exportCropWorkersInput"
              v-model.number="exportCropWorkers"
              type="number"
              min="0"
              max="32"
              step="1"
              style="width:120px"
              @change="updateExportCropWorkers"
            />
            <span class="muted">0 表示自动（推荐）</span>
          </div>
        </div>

        <div style="height:14px"></div>

        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div>
            <div><strong>推荐文件名模板</strong></div>
            <div class="muted" style="margin-top:6px">模板顺序即输出顺序，空片段会自动清理。</div>
            <div class="muted" style="margin-top:10px" :style="{ color: exportNameTemplateError ? '#dc2626' : '' }">
              模板校验：{{ exportNameTemplateError || '正常' }}
            </div>
            <div class="muted" style="margin-top:6px; word-break:break-all">
              当前预览：{{ buildRecommendedExportFileNamePreview({ idsCount: Math.max(0, Number(filterTotal || 0)), fromRandom: false }).name }}
            </div>
            <div class="muted" style="margin-top:6px">
              可用占位符：{mode} {section} {paper} {year} {season} {fav} {exclude} {count} {custom} {ts} {date} {time} {seq}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; min-width:420px; max-width:640px; flex:1">
            <input
              id="exportNameTemplateInput"
              v-model.trim="exportNameTemplate"
              type="text"
              placeholder="{mode}_{section}_{paper}_{year}_{season}_{count}"
              @keydown.enter.prevent="updateExportNameTemplate"
              @blur="updateExportNameTemplate"
            />
            <div class="row" style="gap:10px; align-items:center">
              <label class="muted" style="min-width:58px">{custom}</label>
              <input id="exportNameCustomInput" v-model.trim="exportNameCustom" type="text" placeholder="自定义常量" @keydown.enter.prevent="updateExportNameCustom" @blur="updateExportNameCustom" />
              <label class="muted" style="min-width:58px">模块值</label>
              <select id="exportNameSectionStyleSel" v-model="exportNameSectionStyle" @change="updateExportNameSectionStyle" style="min-width:180px">
                <option value="display">显示名（含大类）</option>
                <option value="raw">原始模块名</option>
              </select>
              <label class="muted" style="display:flex; gap:6px; align-items:center; white-space:nowrap">
                <input id="exportNameAutoTsChk" type="checkbox" v-model="exportNameAutoTimestamp" @change="toggleExportNameAutoTimestamp" />
                自动追加时间戳
              </label>
              <button id="resetExportNameTemplateBtn" @click="resetExportNameTemplateDefaults">恢复默认</button>
            </div>
          </div>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="panel">
        <div><strong>数据维护</strong></div>
        <div style="height:12px"></div>

        <div class="row" style="justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap;">
          <div style="min-width:320px; flex:1">
            <div><strong>完整性检查与修复（支持旧数据库）</strong></div>
            <div class="muted" style="margin-top:6px">
              可检查：缺失题号、重复题号、孤儿框、题号跳号；修复支持先干跑再落库。
            </div>
            <div style="height:10px"></div>
            <div class="row" style="gap:10px; align-items:center; flex-wrap:wrap;">
              <label class="muted">
                <input type="checkbox" v-model="maintenanceRemoveOrphanBoxes" /> 清理孤儿框
                <span class="muted" style="margin-left:6px;">（框记录存在，但对应题目/答案已不存在）</span>
              </label>
              <label class="muted"><input type="checkbox" v-model="maintenanceFillMissingQuestionNo" /> 填充缺失题号</label>
              <label class="muted"><input type="checkbox" v-model="maintenanceRenumberQuestionNo" /> 题号重排为连续序列（修复跳号）</label>
            </div>
          </div>
          <div class="row" style="gap:10px; align-items:center; flex-wrap:wrap;">
            <button id="checkIntegrityBtn" :disabled="maintenanceBusy" @click="checkQuestionsIntegrity">完整性检查</button>
            <button id="repairDryRunBtn" :disabled="maintenanceBusy" @click="repairQuestionsData(false)">干跑修复</button>
            <button id="repairApplyBtn" :disabled="maintenanceBusy" @click="repairQuestionsData(true)">执行修复</button>
          </div>
        </div>

        <div style="height:10px"></div>
        <div class="muted" v-if="maintenanceIntegrityReport">
          检查结果：
          总题数 {{ maintenanceIntegrityReport.total_questions || 0 }}，
          缺失题号 {{ maintenanceIntegrityReport.missing_question_no || 0 }}，
          题号跳号 {{ maintenanceIntegrityReport.question_no_gap_count || 0 }}，
          重复题号组 {{ maintenanceIntegrityReport.duplicate_question_no_groups || 0 }}，
          重复题号总条 {{ maintenanceIntegrityReport.duplicate_question_no_total || 0 }}，
          孤儿题框 {{ maintenanceIntegrityReport.orphan_question_boxes || 0 }}，
          孤儿答案框 {{ maintenanceIntegrityReport.orphan_answer_boxes || 0 }}
        </div>
        <div class="muted" style="margin-top:6px" v-if="maintenanceIntegrityReport && maintenanceIntegrityReport.question_no_gap_examples && maintenanceIntegrityReport.question_no_gap_examples.length">
          题号跳号示例：{{ maintenanceIntegrityReport.question_no_gap_examples.join(', ') }}
        </div>
        <div class="muted" style="margin-top:6px" v-if="maintenanceRepairReport">
          上次{{ maintenanceRepairReport.dry_run ? '干跑' : '修复' }}：
          清理题框 {{ maintenanceRepairReport.orphan_question_boxes_removed || 0 }}，
          清理答案框 {{ maintenanceRepairReport.orphan_answer_boxes_removed || 0 }}，
          填充题号 {{ maintenanceRepairReport.missing_question_no_filled || 0 }}，
          重排题号 {{ maintenanceRepairReport.question_no_resequenced_changed || 0 }}
        </div>
      </div>
    </div>
  `,
};
