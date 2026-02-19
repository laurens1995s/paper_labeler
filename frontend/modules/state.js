// Global State
export let papers = [];
export let currentPaperId = null;
export let currentQpPaperName = "";
export let currentMsPaperName = "";
export let currentPaperCacheToken = null;
export let currentMsCacheToken = null;
export let pages = []; // {page, image_url}
export let currentPageIndex = -1;

// View state
export let showDonePapers = false;

// Draw state
export let drawing = false;
export let startPt = null;
export let newBoxes = []; // {page, bbox}
export let selectedNewBox = null;
export let dragNewBoxOp = null; // {kind:'resize'|'move', box, corner?, w?, h?, offX?, offY?}
export let pageQuestions = []; // questions for current page
export let suggestedNextNo = null;
export let globalSuggestedNextNo = null;

// Section state
export let sectionDefs = []; // {id,name,content}
export let sectionNames = []; // cached names for selects

// Answer marking state
export let msPaperId = null;
export let msPages = []; // {page,image_url}
export let msCanvasByPage = new Map(); // page -> {img, canvas}
export let answerQuestions = []; // questions from qp paper
export let answerQIndex = -1;
export let answerExistingBoxes = []; // current question existing answer boxes
export let answerNewBoxes = []; // {page,bbox}
export let answerDrawing = null; // {page, startX, startY}
export let selectedAnswerNew = null;
export let dragAnswerOp = null;

// Alignment
export let answerAlignRef = null; // [x0,x1] normalized
export let paperAlignRef = {}; // persisted

// Edit modes
export let editingQuestionId = null;
export let editingQuestionOriginal = null;
export let answerReplaceMode = false;
export let answerReplaceQuestionId = null;

// Filtering
export let filterMultiSelect = false;
export let selectedQuestionIds = new Set();
export let filterPage = 1;
export let filterPageSize = 10;

// OCR / Auto Suggestion
export const pendingOcrBoxesByPaperId = new Map();
export const pendingOcrDraftByPaperId = new Map();
export const pendingOcrWarningByPaperId = new Map();
export const pendingOcrDraftSelectedIdxByPaperId = new Map();
export let ocrDraftQuestions = []; // [{label, section}]
export let selectedOcrDraftIdx = 0;

// Setters
export const setPapers = (v) => { papers = v; };
export const setCurrentPaperId = (v) => { currentPaperId = v; };
export const setPages = (v) => { pages = v; };
export const setCurrentPageIndex = (v) => { currentPageIndex = v; };
export const setShowDonePapers = (v) => { showDonePapers = v; };
export const setNewBoxes = (v) => { newBoxes = v; };
export const setPageQuestions = (v) => { pageQuestions = v; };
export const setSuggestedNextNo = (v) => { suggestedNextNo = v; };
export const setGlobalSuggestedNextNo = (v) => { globalSuggestedNextNo = v; };
export const setSectionDefs = (v) => { sectionDefs = v; };
export const setSectionNames = (v) => { sectionNames = v; };
export const setMsPaperId = (v) => { msPaperId = v; };
export const setMsPages = (v) => { msPages = v; };
export const setAnswerQuestions = (v) => { answerQuestions = v; };
export const setAnswerQIndex = (v) => { answerQIndex = v; };
export const setAnswerExistingBoxes = (v) => { answerExistingBoxes = v; };
export const setAnswerNewBoxes = (v) => { answerNewBoxes = v; };
export const setEditingQuestionId = (v) => { editingQuestionId = v; };
export const setFilterPage = (v) => { filterPage = v; };
export const setPaperAlignRef = (v) => { paperAlignRef = v; };
export const setOcrDraftQuestions = (v) => { ocrDraftQuestions = v; };
export const setSelectedOcrDraftIdx = (v) => { selectedOcrDraftIdx = v; };
export const setCurrentQpPaperName = (v) => { currentQpPaperName = v; };
export const setCurrentMsPaperName = (v) => { currentMsPaperName = v; };
export const setCurrentPaperCacheToken = (v) => { currentPaperCacheToken = v; };
export const setCurrentMsCacheToken = (v) => { currentMsCacheToken = v; };

// Canvas state setters
export const setDrawing = (v) => { drawing = v; };
export const setStartPt = (v) => { startPt = v; };
export const setSelectedNewBox = (v) => { selectedNewBox = v; };
export const setDragNewBoxOp = (v) => { dragNewBoxOp = v; };

export const setAnswerDrawing = (v) => { answerDrawing = v; };
export const setSelectedAnswerNew = (v) => { selectedAnswerNew = v; };
export const setDragAnswerOp = (v) => { dragAnswerOp = v; };
export const setEditingQuestionOriginal = (v) => { editingQuestionOriginal = v; };
export const setAnswerReplaceMode = (v) => { answerReplaceMode = v; };
export const setAnswerReplaceQuestionId = (v) => { answerReplaceQuestionId = v; };
export const setFilterMultiSelect = (v) => { filterMultiSelect = v; };
export const setFilterPageSize = (v) => { filterPageSize = v; };
export const setAnswerAlignRef = (v) => { answerAlignRef = v; };

