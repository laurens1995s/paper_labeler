import PaperList from "./PaperList.js";
import { usePapers } from "../use/usePapers.js";

export default {
  name: "Sidebar",
  components: { PaperList },
  setup() {
    const app = usePapers();
    return app;
  },
  template: `
    <section id="left">
      <button id="openFilterBtn" class="wideBtn" @click="showFilterView(); runFilter()">题库管理</button>
      <div style="height:10px"></div>
      <button id="openSectionEditorBtn" class="wideBtn" @click="showSectionView(); refreshSectionDefsIntoUI()">模块编辑</button>
      <div style="height:10px"></div>
      <button id="openSettingsBtn" class="wideBtn" @click="showSettingsView()">设置</button>
      <div style="height:10px"></div>

      <div class="panel">
        <div class="row" style="justify-content:space-between">
          <strong>上传 PDF</strong>
          <span id="uploadHint" class="muted">支持批量上传</span>
        </div>
        <div style="height:8px"></div>
        <div class="row">
          <input id="uploadInput" ref="uploadInput" type="file" accept="application/pdf" multiple @change="uploadSelectedFiles" />
        </div>
        <div style="height:6px"></div>
        <button id="openCieImportBtn" class="wideBtn secondaryBtn" @click="openCieImportModal()">从 CIE 网站导入</button>
        <div style="height:6px"></div>
        <div id="uploadStatus" class="muted">{{ uploadStatus }}</div>
      </div>

      <div style="height:10px"></div>
      <div class="panel">
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <label class="muted">当前试卷</label>
            <span id="paperTitle" class="pill">{{ paperTitleText }}</span>
          </div>
          <div class="row fullRow">
            <button id="refreshBtn" @click="refreshPapers()">刷新试卷</button>
            <button id="openAnswerAdminBtn" @click="showAnswerAdminView(); refreshAnswerPapers()">答案管理</button>
          </div>
        </div>
      </div>

      <div style="height:10px"></div>
      <div class="row" style="justify-content:space-between; padding: 4px 2px;">
        <strong>试卷选择</strong>
        <span class="row" style="gap:8px">
          <button id="showDonePapersBtn" @click="toggleShowDonePapers()">{{ showDonePapersText }}</button>
          <span id="paperCountHint" class="muted">{{ paperCountHint }}</span>
        </span>
      </div>
      <div style="height:8px"></div>
      <PaperList />
    </section>
  `,
};
