import { useAnswer } from "../use/useAnswer.js";
import CropPreview from "./CropPreview.js";

export default {
  name: "AnswerView",
  components: { CropPreview },
  setup() {
    return useAnswer();
  },
  template: `
    <div id="answerView">
      <div class="stickyBar">
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <button id="backFromAnswerBtn" @click="backFromAnswer">{{ answerBackText }}</button>
            <span id="answerPaperTitle" class="pill">{{ answerPaperTitleText }}</span>
            <span id="answerQInfo" class="pill">{{ answerQInfoText }}</span>
          </div>
          <div class="row">
            <button id="prevQBtn" :disabled="!canPrevAnswer" @click="answerPrev">上一题 (K)</button>
            <button id="nextQBtn" :disabled="!canAnswerNextAction()" @click="answerNext">{{ answerNextButtonLabel() }} (J)</button>
            <label class="muted">跳到 MS</label>
            <input id="answerJumpMsPageInput" v-model.number="answerJumpMsPageInput" type="number" min="1" placeholder="页" style="width:72px" @keydown.enter="jumpToMsPage" />
            <button id="answerJumpMsPageBtn" :disabled="!msPages.length" @click="jumpToMsPage">跳页</button>
            <button id="answerUndoBtn" :disabled="!answerUndoStack.length" @click="undoAnswer">撤销 (Ctrl+Z)</button>
            <button id="answerRedoBtn" :disabled="!answerRedoStack.length" @click="redoAnswer">重做 (Ctrl+Y)</button>
            <button id="clearAnswerBoxesBtn" :disabled="!canClearAnswerBoxes" @click="clearAnswerBoxes">清空框选</button>
          </div>
        </div>
      </div>

      <div style="height:10px"></div>
      <div class="answerLayout">
        <div class="markLeft">
          <div id="msScroll" ref="msScroll">
            <div v-for="p in msPages" :key="p.page" class="msPage" :data-page="p.page">
              <div class="imgWrap">
                <img :src="p.image_url" @load="(evt) => onMsImageLoad(p.page, evt)" />
                <canvas
                  :ref="(el) => setMsCanvasRef(p.page, el)"
                  @pointerdown="(evt) => onAnswerPointerDown(p.page, evt)"
                  @pointermove="(evt) => onAnswerPointerMove(p.page, evt)"
                  @pointerup="(evt) => onAnswerPointerUp(p.page, evt)"
                ></canvas>
                <span class="pageLabel">page {{ p.page }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="markRight">
          <div class="panel">
            <div class="row" style="justify-content:space-between">
              <strong>当前题目（QP）</strong>
              <span id="answerQuestionMeta" class="muted">{{ answerQuestionMetaText }}</span>
            </div>
            <div style="height:8px"></div>
            <div id="answerQuestionCrops" class="boxes">
              <div v-if="!currentAnswerQuestionBoxes.length" class="muted">暂无题目框选</div>
              <div v-else v-for="(b, idx) in currentAnswerQuestionBoxes" :key="idx">
                <CropPreview :image-url="b.image_url" :bbox="b.bbox" />
              </div>
            </div>
            <div style="height:10px"></div>
            <div class="row" style="justify-content:space-between">
              <strong>答案预览（MS）</strong>
              <span id="answerPreviewMeta" class="muted">{{ answerPreviewMetaText }}</span>
            </div>
            <div style="height:8px"></div>
            <div id="answerPreviewCrops" class="boxes">
              <div v-if="!answerPreviewBoxes.length" class="muted">暂无答案框选</div>
              <div v-else v-for="(b, idx) in answerPreviewBoxes" :key="idx">
                <CropPreview :image-url="msImageUrlForPage(b.page)" :bbox="b.bbox" />
              </div>
            </div>
            <div style="height:10px"></div>
            <div id="answerBoxesHint" class="muted">{{ answerBoxesHintText }}</div>
          </div>
        </div>
      </div>
    </div>
  `,
};
