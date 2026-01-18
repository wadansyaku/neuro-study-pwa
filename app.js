/* 学習Webアプリ - Vanilla JS / Cloud-first */
import { createCloudStore } from "./dataStore.js";
import { loadSession, saveSession, clearSession, hasSession } from "./sessionStore.js";
import {
  readLegacyProgressRaw,
  hasLegacyProgress,
  clearLegacyProgress,
  hasLegacyImportedQuestions,
  clearLegacyImportedQuestions,
  clearLegacyAppConfig
} from "./migration/legacyStorage.js";

const APP_VERSION = 7;
const PROGRESS_VERSION = 3;
const APP_BASE_NAME = "学習Webアプリ";
const DEFAULT_DECK_ID = "neuro";
const DEFAULT_DECK_NAME = "神経解剖";
const MIGRATION_KEY_PREFIX = "legacy_progress";

const dataStore = createCloudStore();


const SR_REASON_OPTIONS = [
  "知識不足",
  "混同（似た概念/名前/核など）",
  "用語・英略語",
  "設問の読み違い",
  "ケアレス",
  "時間不足",
  "その他"
];
const SR_SHORT_RETRY_MINUTES = 10;
const DAILY_REVIEW_LIMIT = 20;
const REVIEW_SET_SIZES = [10,20,30];

let DATA = null; // {version, source, questions}
let QUESTIONS = []; // array of question objects
let INDEX = {}; // id -> question
let DECKS = [];
let ACTIVE_DECK = null;
let CURRENT_VIEW = "init";
const IMPORTED_QUESTIONS = new Map();

function setActiveDeck(deckId){
  const next = DECKS.find(d => d.id === deckId) || DECKS[0];
  ACTIVE_DECK = next || {
    id: DEFAULT_DECK_ID,
    label: DEFAULT_DECK_NAME,
    displayNameJa: DEFAULT_DECK_NAME,
    shortLabelJa: DEFAULT_DECK_NAME
  };
}

/* -------- Utils -------- */
function nowISO(){ return new Date().toISOString(); }
function nowMs(){ return Date.now(); }
function safeJsonParse(str, fallback){
  if(str === null || str === undefined) return fallback;
  const trimmed = String(str).trim();
  if(!trimmed || trimmed === "null") return fallback;
  try{ return JSON.parse(trimmed); }catch(e){ return fallback; }
}
function clamp(num, min, max){ return Math.min(max, Math.max(min, num)); }
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function htmlEscape(s){
  return (s||"").replace(/[&<>\"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[m]));
}
function formatDateTime(ts){
  if(!ts) return "未同期";
  try{
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }catch(e){
    return String(ts);
  }
}
function setNodeText(node, text){ if(node) node.textContent = text; }
function clone(obj){
  return JSON.parse(JSON.stringify(obj));
}
function uniq(arr){
  return Array.from(new Set(arr));
}
function padQuestionNumber(num){
  return `Q${String(num).padStart(3,"0")}`;
}

function normalizeDeck(deck){
  if(!deck || typeof deck !== "object") return null;
  const id = typeof deck.id === "string" ? deck.id : null;
  if(!id) return null;
  const displayNameJa = typeof deck.displayNameJa === "string" && deck.displayNameJa
    ? deck.displayNameJa
    : (typeof deck.label === "string" ? deck.label : "");
  const shortLabelJa = typeof deck.shortLabelJa === "string" && deck.shortLabelJa
    ? deck.shortLabelJa
    : (displayNameJa || deck.label || id);
  const label = typeof deck.label === "string" && deck.label
    ? deck.label
    : (shortLabelJa || displayNameJa || id);
  const description = typeof deck.description === "string" ? deck.description : "";
  const path = typeof deck.path === "string" ? deck.path : "";
  return {id, label, displayNameJa, shortLabelJa, description, path};
}

function normalizeDecks(list){
  if(!Array.isArray(list)) return [];
  return list.map(normalizeDeck).filter(Boolean);
}

function getDeckDisplayName(deck){
  return deck?.displayNameJa || deck?.label || deck?.shortLabelJa || deck?.id || DEFAULT_DECK_NAME;
}

function getDeckShortLabel(deck){
  return deck?.shortLabelJa || deck?.label || deck?.displayNameJa || deck?.id || DEFAULT_DECK_NAME;
}

function updateAppTitle(){
  const deckName = getDeckDisplayName(ACTIVE_DECK);
  const titleText = deckName ? `${APP_BASE_NAME}（${deckName}）` : APP_BASE_NAME;
  setNodeText(document.getElementById("appTitle"), titleText);
  document.title = titleText;
}

function setCurrentView(name){
  CURRENT_VIEW = name;
  console.log("[view] change", {view: CURRENT_VIEW, path: location.pathname});
}

function isDevMode(){
  const host = location.hostname || "";
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".pages.dev") || host.includes("pages.dev");
}

function getImportedQuestions(deckId){
  return IMPORTED_QUESTIONS.get(deckId) || null;
}

function saveImportedQuestions(deckId, payload){
  IMPORTED_QUESTIONS.set(deckId, payload);
}

/* -------- Progress model (v3) -------- */
let PROGRESS_CACHE = null;

function defaultSr(){
  const n = nowMs();
  return {
    dueAt: n,
    intervalDays: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    lastGrade: null
  };
}

function defaultMistake(){
  return {
    lastReason: null,
    reasonCounts: {},
    lastNote: null
  };
}

function defaultCard(){
  return {
    seen: 0,
    correct: 0,
    wrong: 0,
    lastSeenAt: null,
    lastAnsweredAt: null,
    lastImportedAt: null,
    sr: defaultSr(),
    mistake: defaultMistake()
  };
}

function createEmptyProgress(){
  return {
    version: PROGRESS_VERSION,
    updatedAt: nowMs(),
    cards:{},
    sessions:{},
    mockTest:{},
    attemptHistory: [],
    lastImportUndo: null
  };
}

function normalizeCard(card){
  if(!card) return defaultCard();
  const base = defaultCard();
  return {
    ...base,
    ...card,
    sr: {...base.sr, ...(card.sr||{})},
    mistake: {...base.mistake, ...(card.mistake||{})}
  };
}

function normalizeProgress(p){
  const base = createEmptyProgress();
  const incoming = p || {};
  const out = {
    ...base,
    ...incoming,
    cards: {}
  };
  for(const id of Object.keys(incoming.cards||{})){
    out.cards[id] = normalizeCard(incoming.cards[id]);
  }
  out.version = PROGRESS_VERSION;
  if(!Array.isArray(out.attemptHistory)) out.attemptHistory = [];
  if(out.lastImportUndo && typeof out.lastImportUndo !== "object") out.lastImportUndo = null;
  return out;
}

function readLegacyProgress(){
  const deckId = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
  const {rawV2, rawV1} = readLegacyProgressRaw(deckId);
  if(rawV2){
    const parsed = safeJsonParse(rawV2, null);
    return parsed ? normalizeProgress(parsed) : null;
  }
  const rawV1Parsed = safeJsonParse(rawV1, {});
  if(rawV1Parsed && typeof rawV1Parsed === "object" && Object.keys(rawV1Parsed).length){
    const p = createEmptyProgress();
    const now = nowMs();
    for(const [id, v] of Object.entries(rawV1Parsed)){
      const card = normalizeCard(v);
      card.seen = v.attempts || v.seen || 0;
      card.correct = v.correct || 0;
      card.wrong = v.wrong || 0;
      const ts = v.lastAttempt ? Date.parse(v.lastAttempt) : null;
      card.lastSeenAt = isFinite(ts) ? ts : null;
      card.lastAnsweredAt = card.lastSeenAt;
      card.sr = {...defaultSr(), dueAt: now};
      card.mistake = defaultMistake();
      p.cards[id] = card;
    }
    return p;
  }
  return null;
}

async function initProgress(){
  if(PROGRESS_CACHE) return PROGRESS_CACHE;
  const deckId = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
  const remote = await dataStore.exportProgress(deckId);
  const progress = remote?.progress || createEmptyProgress();
  PROGRESS_CACHE = normalizeProgress(progress);
  return PROGRESS_CACHE;
}

function loadProgress(){
  if(PROGRESS_CACHE) return PROGRESS_CACHE;
  const empty = createEmptyProgress();
  PROGRESS_CACHE = empty;
  return empty;
}

function saveProgress(p){
  const obj = normalizeProgress(p || {});
  obj.updatedAt = nowMs();
  PROGRESS_CACHE = obj;
  return obj;
}

async function resetProgress(){
  await dataStore.importProgress({
    deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID,
    reset: true
  });
  PROGRESS_CACHE = null;
  await initProgress();
}

function getOrCreateCard(p, id){
  if(!p.cards[id]) p.cards[id] = defaultCard();
  else p.cards[id] = normalizeCard(p.cards[id]);
  return p.cards[id];
}

function incrementStats(card, correct){
  card.seen += 1;
  card.lastSeenAt = nowMs();
  card.lastAnsweredAt = card.lastSeenAt;
  if(correct) card.correct += 1; else card.wrong += 1;
}

function applySpacedRepetition(card, grade){
  const sr = card.sr || defaultSr();
  const now = nowMs();
  if(grade === "again"){
    sr.reps = 0;
    sr.lapses = (sr.lapses||0) + 1;
    sr.intervalDays = 0;
    sr.dueAt = now + SR_SHORT_RETRY_MINUTES*60*1000;
    sr.ease = clamp((sr.ease||2.5) - 0.2, 1.3, 3.5);
  }else{
    sr.reps = (sr.reps||0) + 1;
    const delta = grade === "hard" ? -0.15 : (grade === "easy" ? 0.15 : 0);
    sr.ease = clamp((sr.ease||2.5) + delta, 1.3, 3.5);
    if(sr.reps === 1){
      sr.intervalDays = 1;
    }else if(sr.reps === 2){
      sr.intervalDays = 3;
    }else{
      const mult = grade === "hard" ? 1.2 : (grade === "easy" ? (sr.ease + 0.3) : sr.ease);
      sr.intervalDays = Math.max(1, Math.round(sr.intervalDays * mult));
    }
    sr.dueAt = now + sr.intervalDays * 24*60*60*1000;
  }
  sr.lastGrade = grade;
  card.sr = sr;
  card.lastAnsweredAt = now;
  return sr;
}

function isoToMs(value){
  if(!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function applyRemoteProgressCard(progress, remote){
  if(!remote || !remote.questionId) return;
  const card = normalizeCard({
    seen: remote.seen || 0,
    correct: remote.correct || 0,
    wrong: remote.wrong || 0,
    lastSeenAt: isoToMs(remote.lastSeenAt),
    lastAnsweredAt: isoToMs(remote.lastAnsweredAt),
    lastImportedAt: isoToMs(remote.lastImportedAt),
    sr: {
      dueAt: isoToMs(remote.srDueAt) || nowMs(),
      intervalDays: remote.srIntervalDays || 0,
      ease: remote.srEase || 2.5,
      reps: remote.srReps || 0,
      lapses: remote.srLapses || 0,
      lastGrade: remote.srLastGrade || null
    },
    mistake: {
      lastReason: remote.mistakeLastReason || null,
      reasonCounts: remote.mistakeReasonCounts || {},
      lastNote: remote.mistakeLastNote || null
    }
  });
  progress.cards[remote.questionId] = card;
}

async function recordAttempt(payload){
  const res = await dataStore.recordAttempt(payload);
  return res.progressCard || null;
}

function recordAttemptHistory(p, entry){
  if(!Array.isArray(p.attemptHistory)) p.attemptHistory = [];
  p.attemptHistory.push(entry);
  const MAX_HISTORY = 30;
  if(p.attemptHistory.length > MAX_HISTORY){
    p.attemptHistory = p.attemptHistory.slice(-MAX_HISTORY);
  }
}

function logMistake(card, reason, note){
  const trimmedNote = (note||"").trim();
  if(reason){
    card.mistake.lastReason = reason;
    card.mistake.reasonCounts[reason] = (card.mistake.reasonCounts[reason]||0) + 1;
  }
  if(trimmedNote){
    card.mistake.lastNote = trimmedNote;
  }
}

function getStats(){
  const p = loadProgress();
  let attempted = 0, correct = 0, wrong = 0;
  for(const card of Object.values(p.cards)){
    if(card.seen > 0) attempted += 1;
    correct += card.correct || 0;
    wrong += card.wrong || 0;
  }
  const total = QUESTIONS.length;
  const acc = (correct + wrong) ? (correct/(correct+wrong)) : 0;
  return {total, attempted, correct, wrong, acc};
}

function summarizeDue(){
  const p = loadProgress();
  const now = nowMs();
  const startToday = new Date(); startToday.setHours(0,0,0,0);
  const startTomorrow = new Date(startToday.getTime() + 24*60*60*1000);
  const startDayAfter = new Date(startTomorrow.getTime() + 24*60*60*1000);
  let due = 0, overdue = 0, dueTomorrow = 0, seen = 0;
  for(const card of Object.values(p.cards)){
    if(card.seen > 0){
      seen++;
      const dueAt = card.sr?.dueAt || 0;
      if(dueAt <= now){
        due += 1;
        if(dueAt < startToday.getTime()) overdue += 1;
      }else if(dueAt < startTomorrow.getTime()){
        due += 1;
      }else if(dueAt < startDayAfter.getTime()){
        dueTomorrow += 1;
      }
    }
  }
  const newCount = Math.max(0, QUESTIONS.length - seen);
  return {due, overdue, dueTomorrow, newCount};
}

function getReasonRanking(){
  const p = loadProgress();
  const counts = {};
  for(const card of Object.values(p.cards)){
    for(const [reason, cnt] of Object.entries(card.mistake?.reasonCounts || {})){
      counts[reason] = (counts[reason]||0) + cnt;
    }
  }
  return Object.entries(counts).sort((a,b)=> b[1]-a[1]);
}

function getTagStats(){
  const p = loadProgress();
  const byTag = {};
  for(const q of QUESTIONS){
    const tag = q.tag || "その他";
    if(!byTag[tag]) byTag[tag] = {correct:0, wrong:0, due:0, total:0};
    const card = p.cards[q.id];
    if(card){
      byTag[tag].correct += card.correct||0;
      byTag[tag].wrong += card.wrong||0;
      if(card.seen>0 && card.sr?.dueAt <= nowMs()) byTag[tag].due += 1;
    }
    byTag[tag].total += 1;
  }
  return byTag;
}

/* -------- Mock import helpers -------- */
function parseImportText(raw){
  const errors = [];
  if(!raw || !raw.trim()){
    errors.push("入力が空です。100文字の回答列または番号付き形式で入力してください。");
    return {errors};
  }
  const trimmed = raw.trim();
  const collapsed = trimmed.replace(/\s/g, "").toUpperCase();
  const total = QUESTIONS.length;
  const answers = {};

  function setAnswer(num, val){
    if(num < 1 || num > total){
      errors.push(`問題番号 ${num} は範囲外です（1-${total}）。`);
      return;
    }
    const key = padQuestionNumber(num);
    answers[key] = val === "-" ? null : val;
  }

  if(/^[A-E\-]+$/.test(collapsed)){
    if(collapsed.length !== total){
      errors.push(`文字数が${collapsed.length}文字でした。${total}文字で入力してください。`);
    }else{
      collapsed.split("").forEach((ch, idx) => setAnswer(idx+1, ch));
    }
    return {answers, errors};
  }

  const tokens = trimmed.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
  tokens.forEach(tok => {
    const m = tok.match(/^(\d+)\s*[:=]?\s*([A-E\-])$/i);
    if(!m){
      errors.push(`形式を解釈できませんでした: 「${tok}」 (例: \"12 A\" または \"12:A\")`);
      return;
    }
    const num = Number(m[1]);
    const val = m[2].toUpperCase();
    if(answers[padQuestionNumber(num)] !== undefined){
      errors.push(`問題番号 ${num} が重複しています。`);
      return;
    }
    setAnswer(num, val);
  });
  return {answers, errors};
}

function gradeAttempt(answerMap){
  const total = QUESTIONS.length;
  const wrongIds = [];
  const unansweredIds = [];
  const tagMissCounts = {};
  let correctCount = 0;
  QUESTIONS.forEach((q, idx) => {
    const key = q.id;
    if(q.type === "short"){
      unansweredIds.push(idx+1);
      wrongIds.push(idx+1);
      return;
    }
    const ans = answerMap[key];
    if(ans === undefined){
      unansweredIds.push(idx+1);
      wrongIds.push(idx+1);
      return;
    }
    const userSel = ans ? [ans] : [];
    const ok = isCorrect(q, userSel);
    if(ok){
      correctCount += 1;
    }else{
      wrongIds.push(idx+1);
      if(ans === null){
        unansweredIds.push(idx+1);
      }
      const tag = q.tag || "その他";
      tagMissCounts[tag] = (tagMissCounts[tag]||0) + 1;
    }
  });
  return {
    correct: correctCount,
    total,
    wrongIds,
    unansweredIds,
    tagMissCounts
  };
}
/* -------- Tag/Concept utilities -------- */
function ensureQuestionTags(){
  const keywordMap = [
    {tag:"視床", keywords:["視床","thalam"]},
    {tag:"内包", keywords:["内包","internal capsule"]},
    {tag:"基底核", keywords:["基底核","線条体","被殻","尾状核","globus"]},
    {tag:"小脳", keywords:["小脳","cerebell"]},
    {tag:"脳神経", keywords:["脳神経","神経核","動眼","滑車","外転","三叉","顔面","舌咽","迷走","副神経","舌下"]},
    {tag:"脊髄", keywords:["脊髄","spinal"]},
    {tag:"自律", keywords:["自律","交感","副交感","内臓"]},
  ];
  QUESTIONS.forEach(q => {
    if(!q.tag){
      const hay = `${q.stem || ""} ${Object.values(q.options||{}).join(" ")}`.toLowerCase();
      const hit = keywordMap.find(k => k.keywords.some(w => hay.includes(w.toLowerCase())));
      if(hit) q.tag = hit.tag;
      else q.tag = "その他";
    }
    if(!Array.isArray(q.concepts)) q.concepts = [];
  });
}

function validateQuestions(list){
  const errors = [];
  (list || []).forEach((q, idx) => {
    if(!q || typeof q !== "object"){
      errors.push(`Q#${idx+1}: invalid question object`);
      return;
    }
    if(q.type === "short"){
      if(!Array.isArray(q.answer) || q.answer.some(a => typeof a !== "string" || !a.trim())){
        errors.push(`${q.id || `Q#${idx+1}`}: short answer must be string array`);
      }
      if(!q.options || typeof q.options !== "object") q.options = {};
    }else{
      if(!q.options || typeof q.options !== "object"){
        errors.push(`${q.id || `Q#${idx+1}`}: options are required`);
      }else{
        const optionKeys = Object.keys(q.options || {});
        const answers = Array.isArray(q.answer) ? q.answer : [];
        if(answers.length === 0 || answers.some(a => !optionKeys.includes(a))){
          errors.push(`${q.id || `Q#${idx+1}`}: answer must be option keys`);
        }
      }
    }
  });
  if(errors.length){
    console.warn("Question validation warnings:", errors);
  }
}

function getConceptsForQuestion(q){
  const tags = [];
  if(q.tag) tags.push(q.tag);
  if(Array.isArray(q.concepts)) tags.push(...q.concepts);
  return uniq(tags.filter(Boolean));
}

/* -------- DOM helpers -------- */
function el(tag, attrs={}, children=[]){
  const e = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k === "class") e.className = v;
    else if(k === "html") e.innerHTML = v;
    else if(k.startsWith("on") && typeof v === "function"){
      const evtName = k.slice(2).toLowerCase();
      e.addEventListener(evtName, v);
    }
    else e.setAttribute(k, v);
  }
  (children||[]).forEach(c => {
    if(c === null || c === undefined) return;
    if(typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}

function viewCard(title, bodyNodes){
  return el("div", {class:"card"}, [
    el("div", {class:"h1"}, [title]),
    ...(bodyNodes||[])
  ]);
}

function mount(node){
  const root = document.getElementById("app");
  root.innerHTML = "";
  root.appendChild(node);
}

/* -------- UI: Home / Stats / Data -------- */
function renderHome(){
  setCurrentView("home");
  const st = getStats();
  const progressPct = st.total ? Math.round((st.attempted/st.total)*100) : 0;
  const dueSummary = summarizeDue();
  const session = loadSession();
  const settingsNotice = [];
  if(!navigator.onLine){
    settingsNotice.push(el("div", {class:"status status--warn"}, [
      "オフラインのため学習は開始できません。オンラインに接続してください。"
    ]));
  }else{
    const userLabel = session.userId ? `ユーザー: ${session.userId}` : "ユーザー: default";
    settingsNotice.push(el("div", {class:"status status--ok"}, [
      `クラウドDBに保存中（${userLabel}）`
    ]));
  }

  const kpis = el("div", {class:"kpi"}, [
    el("div", {class:"kpi__item"}, [
      el("div", {class:"kpi__value"}, [String(st.total)]),
      el("div", {class:"kpi__label"}, ["総問題数"])
    ]),
    el("div", {class:"kpi__item"}, [
      el("div", {class:"kpi__value"}, [String(st.attempted)]),
      el("div", {class:"kpi__label"}, ["解いた問題（ユニーク）"])
    ]),
    el("div", {class:"kpi__item"}, [
      el("div", {class:"kpi__value"}, [String(Math.round(st.acc*100)) + "%"]),
      el("div", {class:"kpi__label"}, ["正答率（累積）"])
    ]),
  ]);

  const prog = el("div", {class:"progress"}, [el("div", {style:`width:${progressPct}%`}, [])]);

  const reviewCard = el("div", {class:"card"}, [
    el("div", {class:"h2"}, ["今日の復習"]),
    el("div", {class:"p"}, [`期限切れ/今日: ${dueSummary.due}  |  新規: ${dueSummary.newCount}`]),
    el("div", {class:"small"}, [
      `期限切れ: ${dueSummary.overdue}件 / 明日まで: ${dueSummary.due + dueSummary.dueTomorrow}件`
    ]),
    el("div", {class:"row"}, [
      el("button", {class:"btn", onClick: () => startDailyReview()}, ["今日の復習を開始（最大20問）"]),
      el("button", {class:"btn btn--muted", onClick: () => startPractice({count:10})}, ["クイック練習（10問）"])
    ])
  ]);

  const latestMock = getLatestMockAttempt();
  const mockReviewCard = el("div", {class:"card"}, [
    el("div", {class:"h2"}, ["復習セット（模試ベース）"]),
    el("div", {class:"p"}, [latestMock ? `直近の模試インポート: ${latestMock.label || latestMock.importedAt}` : "まだ模試結果がインポートされていません。"]),
    el("div", {class:"small"}, ["未回答→誤答→関連タグ→SR期限の順で優先して20問（変更可）出題します。"]),
    el("div", {class:"row"}, REVIEW_SET_SIZES.map(sz => el("button", {class:"btn btn--muted", onClick: () => startMockReview(sz), ...(latestMock?{}:{disabled:"disabled"})}, [`${sz}問で開始`]))),
    el("button", {class:"btn", onClick: () => renderMockImport()}, ["模擬試験結果をインポートする"])
  ]);

  const btns = el("div", {class:"row"}, [
    el("button", {class:"btn", onClick: () => startPractice({count:10, prioritizeUnlearned:true})}, ["未学習優先（10問）"]),
    el("button", {class:"btn btn--muted", onClick: () => renderTopicSelect()}, ["トピック/タグで練習"]),
    el("button", {class:"btn", onClick: () => startMockTest()}, ["模擬テスト（90分・100問）"]),
    el("button", {class:"btn btn--muted", onClick: () => startWeakReview()}, ["弱点復習（間違い+期限）"]),
  ]);

  const info = el("div", {class:"small"}, [
    "※未学習優先は、まだ解いていない問題を優先的に10問出題します。模擬テストは途中で閉じても自動保存して再開できます。"
  ]);

  mount(viewCard("ホーム", [
    ...settingsNotice,
    kpis,
    el("div", {class:"hr"}, []),
    el("div", {class:"p"}, ["進捗（解いた問題割合）"]),
    prog,
    el("div", {class:"hr"}, []),
    reviewCard,
    mockReviewCard,
    btns,
    info
  ]));
}

function renderStats(){
  setCurrentView("stats");
  const st = getStats();
  const p = loadProgress();
  const dueSummary = summarizeDue();

  const worst = Object.entries(p.cards)
    .map(([id,v]) => ({id, wrong:(v.wrong||0), correct:(v.correct||0), attempts:v.seen||0}))
    .filter(x => x.attempts>0)
    .sort((a,b) => {
      const ar = (a.correct+a.wrong) ? a.correct/(a.correct+a.wrong) : 0;
      const br = (b.correct+b.wrong) ? b.correct/(b.correct+b.wrong) : 0;
      return (b.wrong - a.wrong) || (ar - br);
    })
    .slice(0, 10);

  const reasonRanking = getReasonRanking();
  const tagStats = getTagStats();

  const reasonNode = reasonRanking.length ? reasonRanking.map(([reason, cnt]) => {
    return el("div", {class:"row"}, [
      el("div", {class:"col"}, [reason]),
      el("div", {class:"col"}, [`${cnt}件`])
    ]);
  }) : [el("div", {class:"small"}, ["まだ誤答理由の記録がありません。問題を解いてみましょう。"])
  ];

  const tagRows = Object.entries(tagStats).sort((a,b)=> (b[1].due - a[1].due) || (b[1].wrong - a[1].wrong)).map(([tag, val]) => {
    const totalAttempts = val.correct + val.wrong;
    const acc = totalAttempts ? Math.round((val.correct/totalAttempts)*100) : 0;
    return el("div", {class:"card"}, [
      el("div", {class:"h2"}, [`${tag}`]),
      el("div", {class:"small"}, [`正答率: ${acc}%  / Due: ${val.due} / 問題数: ${val.total}`])
    ]);
  });

  const worstList = el("div", {}, worst.length ? worst.map(x => {
    const q = INDEX[x.id];
    const title = `${x.id}  (正:${x.correct} / 誤:${x.wrong})`;
    const summary = q ? q.stem.split("\n")[0].slice(0,80) : "";
    return el("div", {class:"card"}, [
      el("div", {class:"h2"}, [title]),
      el("div", {class:"small"}, [summary]),
      el("button", {class:"btn btn--muted", onClick: ()=> startPractice({ids:[x.id]})}, ["この1問を復習"])
    ]);
  }) : [el("div", {class:"small"}, ["まだ記録がありません。まずはクイック練習からどうぞ。"])]);

  mount(viewCard("進捗", [
    el("div", {class:"p"}, [
      `総問題数: ${st.total}\n解いた問題（ユニーク）: ${st.attempted}\n累積 正答/誤答: ${st.correct}/${st.wrong}\n累積 正答率: ${Math.round(st.acc*100)}%`
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"p"}, [
      `期限切れ/今日 Due: ${dueSummary.due}  |  明日 Due: ${dueSummary.dueTomorrow}  |  新規: ${dueSummary.newCount}`
    ]),
    el("div", {class:"h2"}, ["理由別ランキング"]),
    ...reasonNode,
    el("div", {class:"hr"}, []),
    el("div", {class:"h2"}, ["タグ別 正答率 & Due"]),
    ...tagRows,
    el("div", {class:"hr"}, []),
    el("div", {class:"h2"}, ["間違いが多い問題（上位10）"]),
    worstList,
  ]));
}

async function renderData(){
  setCurrentView("data");
  console.log("[view] renderData", {view: CURRENT_VIEW, path: location.pathname});
  if(!hasSession()){
    renderLogin({message: "クラウド利用にはログインが必要です。"});
    return;
  }
  const session = loadSession();
  const importStatusNode = el("div", {class:"status status--muted", style:"display:none"}, []);
  const dataSummaryNode = el("div", {class:"small"}, []);
  const legacyProgress = readLegacyProgress();
  const legacyProgressStatus = el("div", {class:"status status--warn", style:"display:none"}, []);
  const legacyQuestionStatus = el("div", {class:"status status--warn", style:"display:none"}, []);

  function setImportMessage(msg, variant="info"){
    importStatusNode.className = `status status--${variant}`;
    importStatusNode.style.display = "block";
    setNodeText(importStatusNode, msg);
  }

  function refreshDataSummary(){
    const latestStats = getStats();
    const source = DATA?.source || "(不明)";
    setNodeText(dataSummaryNode, `現在の総問題数: ${latestStats.total} / source: ${source}`);
  }
  refreshDataSummary();

  const questionFileInput = el("input", {
    type: "file",
    accept: "application/json,.json",
    required: "required",
    style: "display:none"
  });
  questionFileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(!file){
      console.log("[import] file input canceled");
      return;
    }
    try{
      setImportMessage("問題データを読み込み中…", "muted");
      await importQuestionsFromFile(file, {setImportMessage, refreshDataSummary});
    }catch(err){
      console.error("[import] question import failed", err);
      setImportMessage(err?.message || "問題データの読み込みに失敗しました。", "warn");
    }finally{
      questionFileInput.value = "";
    }
  });

  const tokenInput = el("input", {
    type:"password",
    placeholder:"APIトークン（Bearerトークン）",
    value: session.apiToken,
    onChange: (e) => { session.apiToken = e.target.value.trim(); }
  });
  const endpointInput = el("input", {
    type:"url",
    placeholder:"APIベースURL（任意。同一オリジンなら空でOK）",
    value: session.apiBase,
    onChange: (e) => { session.apiBase = e.target.value.trim(); }
  });
  const userIdInput = el("input", {
    type:"text",
    placeholder:"ユーザーID（任意。英数字・-・_のみ）",
    value: session.userId,
    onChange: (e) => { session.userId = e.target.value.trim(); }
  });
  const settingsDebug = el("pre", {class:"small", style: isDevMode() ? "" : "display:none"}, []);

  function refreshSettingsDebug(){
    if(!isDevMode()) return;
    setNodeText(settingsDebug, JSON.stringify(loadSession(), null, 2));
  }
  refreshSettingsDebug();

  const btnSave = el("button", {class:"btn btn--muted"}, ["API設定を更新"]);
  btnSave.addEventListener("click", async () => {
    try{
      saveSession(session);
      refreshSettingsDebug();
      setImportMessage("API設定を更新しました。", "ok");
    }catch(e){
      setImportMessage(e.message || "API設定の更新に失敗しました。", "warn");
    }
  });

  const logoutBtn = el("button", {class:"btn btn--danger", onClick: () => {
    if(confirm("ログアウトしますか？")){
      clearSession();
      renderLogin({message: "ログアウトしました。"});
    }
  }}, ["ログアウト"]);

  const migrateBtn = el("button", {class:"btn"}, ["旧データをクラウドへ移行"]);
  const deckId = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
  const migrationKey = `${MIGRATION_KEY_PREFIX}_${deckId}`;

  async function refreshMigrationStatus(){
    if(!hasLegacyProgress(deckId)){
      legacyProgressStatus.style.display = "none";
      return;
    }
    try{
      const res = await dataStore.getMigrationStatus(migrationKey);
      if(res?.exists){
        legacyProgressStatus.className = "status status--muted";
        legacyProgressStatus.style.display = "block";
        setNodeText(legacyProgressStatus, "旧ローカル進捗はすでに移行済みです。");
        migrateBtn.setAttribute("disabled", "disabled");
      }else{
        legacyProgressStatus.className = "status status--warn";
        legacyProgressStatus.style.display = "block";
        setNodeText(legacyProgressStatus, "旧バージョンの学習履歴が見つかりました。クラウドへ移行できます。");
        migrateBtn.removeAttribute("disabled");
      }
    }catch(e){
      legacyProgressStatus.className = "status status--warn";
      legacyProgressStatus.style.display = "block";
      setNodeText(legacyProgressStatus, "移行状態の確認に失敗しました。オンライン状態を確認してください。");
    }
  }

  migrateBtn.addEventListener("click", async () => {
    if(!legacyProgress){
      setImportMessage("移行できるデータがありません。", "warn");
      return;
    }
    if(!navigator.onLine){
      setImportMessage("オフラインのため移行できません。オンラインで再試行してください。", "warn");
      return;
    }
    setImportMessage("旧データを移行中…", "muted");
    try{
      await dataStore.importProgress({deckId, progress: legacyProgress});
      await dataStore.setMigrationComplete(migrationKey);
      clearLegacyProgress(deckId);
      clearLegacyImportedQuestions();
      PROGRESS_CACHE = null;
      await initProgress();
      setImportMessage("移行が完了しました。", "ok");
      await refreshMigrationStatus();
      renderHome();
    }catch(e){
      setImportMessage(e.message || "移行に失敗しました。", "warn");
    }
  });

  if(hasLegacyImportedQuestions()){
    legacyQuestionStatus.style.display = "block";
    setNodeText(legacyQuestionStatus, "旧ローカルの問題インポートデータが残っています。必要なら再インポート後に削除してください。");
  }
  const clearLegacyQuestionsBtn = el("button", {class:"btn btn--muted", onClick: () => {
    clearLegacyImportedQuestions();
    legacyQuestionStatus.style.display = "none";
    setImportMessage("旧ローカルの問題インポートデータを削除しました。", "ok");
  }}, ["旧ローカル問題データを削除"]);

  const node = viewCard("データ", [
    el("div", {class:"p"}, [
      "・学習履歴はクラウドDBに保存されます（ログイン必須）。\n" +
      "・ローカル永続ストレージには学習データを保存しません。\n" +
      "・オフライン時は学習を開始できません。"
    ]),
    el("div", {class:"status status--muted"}, [
      session.userId ? `ログイン中: ${session.userId}` : "ログイン中: default"
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"row"}, [
      el("button", {class:"btn btn--muted", onClick: exportProgress}, ["学習履歴を書き出す（JSON）"]),
      el("button", {class:"btn btn--muted", onClick: importProgress}, ["学習履歴を読み込む（JSON）"]),
      el("button", {class:"btn btn--danger", onClick: async () => {
        if(confirm("学習履歴と途中保存の模試をリセットします。よろしいですか？")){
          try{
            await resetProgress();
            renderHome();
          }catch(e){
            alert(e.message || "リセットに失敗しました。");
          }
        }
      }}, ["学習履歴をリセット"])
    ]),
    el("div", {class:"row"}, [
      el("button", {class:"btn btn--muted", onClick: () => {
        console.log("[import] questions button clicked", {view: CURRENT_VIEW});
        questionFileInput.click();
      }}, ["問題データを読み込む（JSON）"]),
      el("button", {class:"btn btn--muted", onClick: exportQuestions}, ["問題データを書き出す（JSON）"])
    ]),
    questionFileInput,
    el("div", {class:"small"}, [
      "※読み込んだ問題データはこのセッション中のみ利用され、再読み込み後は再インポートが必要です。"
    ]),
    legacyProgressStatus,
    legacyProgress ? migrateBtn : null,
    legacyQuestionStatus,
    hasLegacyImportedQuestions() ? clearLegacyQuestionsBtn : null,
    importStatusNode,
    el("div", {class:"hr"}, []),
    el("div", {class:"h2"}, ["API設定"]),
    el("div", {class:"small"}, ["APIトークンはセッションストレージにのみ保存されます（ブラウザを閉じると消えます）。"]),
    el("div", {class:"cloud-grid"}, [
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["APIトークン（必須。入力はマスク表示）"]),
        tokenInput
      ]),
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["APIベースURL（任意。省略時はこのサイトの /api を使用）"]),
        endpointInput
      ]),
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["ユーザーID（任意。英数字・-・_のみ / 64文字以内）"]),
        userIdInput
      ])
    ]),
    el("div", {class:"row"}, [btnSave, logoutBtn]),
    el("div", {class:"hr"}, []),
    dataSummaryNode,
    settingsDebug
  ].filter(Boolean));
  mount(node);
  await refreshMigrationStatus();
}

function renderLogin({message} = {}){
  setCurrentView("login");
  const session = loadSession();
  const statusNode = el("div", {class:"status status--muted"}, [
    message || "クラウドDBに接続して学習します。APIトークンを入力してください。"
  ]);

  const tokenInput = el("input", {
    type:"password",
    placeholder:"APIトークン（Bearerトークン）",
    value: session.apiToken,
    onChange: (e) => { session.apiToken = e.target.value.trim(); }
  });
  const endpointInput = el("input", {
    type:"url",
    placeholder:"APIベースURL（任意。同一オリジンなら空でOK）",
    value: session.apiBase,
    onChange: (e) => { session.apiBase = e.target.value.trim(); }
  });
  const userIdInput = el("input", {
    type:"text",
    placeholder:"ユーザーID（任意。英数字・-・_のみ）",
    value: session.userId,
    onChange: (e) => { session.userId = e.target.value.trim(); }
  });

  const loginBtn = el("button", {class:"btn"}, ["ログイン"]);
  loginBtn.addEventListener("click", async () => {
    try{
      saveSession(session);
      clearLegacyAppConfig();
      if(!navigator.onLine){
        throw new Error("オフラインのためログインできません。オンラインで再試行してください。");
      }
      await dataStore.init();
      await initAuthenticatedApp();
    }catch(e){
      console.error(e);
      clearSession();
      statusNode.className = "status status--warn";
      setNodeText(statusNode, e.message || "ログインに失敗しました。");
    }
  });

  const node = viewCard("ログイン", [
    statusNode,
    el("div", {class:"small"}, [
      "ログイン後、学習履歴や模試結果はクラウドDBに保存されます。ローカル永続ストレージは使用しません。"
    ]),
    el("div", {class:"cloud-grid"}, [
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["APIトークン（必須。入力はマスク表示）"]),
        tokenInput
      ]),
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["APIベースURL（任意。省略時はこのサイトの /api を使用）"]),
        endpointInput
      ]),
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["ユーザーID（任意。英数字・-・_のみ / 64文字以内）"]),
        userIdInput
      ])
    ]),
    el("div", {class:"row"}, [loginBtn])
  ]);
  mount(node);
}

/* -------- Import / Export / Cloud -------- */
function downloadText(filename, text){
  const blob = new Blob([text], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportProgress(){
  if(!navigator.onLine){
    alert("オフラインのため書き出しできません。");
    return;
  }
  dataStore.exportProgress(ACTIVE_DECK?.id || DEFAULT_DECK_ID)
    .then(res => {
      const payload = {
        appVersion: APP_VERSION,
        exportedAt: nowISO(),
        questionsCount: QUESTIONS.length,
        progress: res.progress || createEmptyProgress()
      };
      downloadText(`neuro_progress_v${APP_VERSION}.json`, JSON.stringify(payload, null, 2));
    })
    .catch(err => {
      alert(err.message || "エクスポートに失敗しました。");
    });
}

function importProgress(){
  pickFile(".json", async (txt) => {
    try{
      if(!navigator.onLine){
        throw new Error("オフラインのため読み込めません。");
      }
      const obj = JSON.parse(txt);
      let incoming = null;
      if((obj.version === 2 || obj.version === 3) && obj.cards){
        incoming = obj;
      }else if(obj.progress && (obj.progress.version === 2 || obj.progress.version === 3)){
        incoming = obj.progress;
      }else if(obj && typeof obj === "object"){
        // maybe legacy v1 shape
        incoming = {version:PROGRESS_VERSION, updatedAt: nowMs(), cards:{}, attemptHistory: [], lastImportUndo: null};
        for(const [id,v] of Object.entries(obj)){
          const card = normalizeCard({
            seen: v.attempts || v.seen || 0,
            correct: v.correct || 0,
            wrong: v.wrong || 0,
            lastSeenAt: v.lastAttempt ? Date.parse(v.lastAttempt) : null,
            lastAnsweredAt: v.lastAttempt ? Date.parse(v.lastAttempt) : null,
            sr: defaultSr(),
            mistake: defaultMistake()
          });
          incoming.cards[id] = card;
        }
      }
      if(!incoming || !incoming.cards || typeof incoming.cards !== "object"){
        throw new Error("invalid");
      }
      await dataStore.importProgress({deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID, progress: incoming});
      PROGRESS_CACHE = null;
      await initProgress();
      alert("読み込みました。");
      renderHome();
    }catch(e){
      console.error(e);
      alert("JSONとして読み込めませんでした。フォーマットを確認してください。");
    }
  });
}

function exportQuestions(){
  const payload = {
    version: DATA?.version || 1,
    source: DATA?.source || "db",
    questions: QUESTIONS || []
  };
  downloadText(`${ACTIVE_DECK?.id || DEFAULT_DECK_ID}_questions_v${APP_VERSION}.json`, JSON.stringify(payload, null, 2));
}

function summarizeQuestionTypes(list){
  const counts = {single: 0, multi: 0, short: 0, other: 0};
  (list || []).forEach(q => {
    if(q?.type === "single") counts.single += 1;
    else if(q?.type === "multi") counts.multi += 1;
    else if(q?.type === "short") counts.short += 1;
    else counts.other += 1;
  });
  return counts;
}

function validateImportedQuestions(list){
  const accepted = [];
  const rejected = [];
  const ids = new Set();

  (list || []).forEach((q, idx) => {
    const base = {id: q?.id || null, type: q?.type || null, index: idx + 1, reason: ""};
    if(!q || typeof q !== "object"){
      rejected.push({...base, reason: "invalid object"});
      return;
    }
    if(!q.id || typeof q.id !== "string"){
      rejected.push({...base, reason: "id missing"});
      return;
    }
    if(ids.has(q.id)){
      rejected.push({...base, reason: "id duplicated"});
      return;
    }
    ids.add(q.id);
    if(!q.stem || typeof q.stem !== "string"){
      rejected.push({...base, reason: "stem missing"});
      return;
    }

    if(q.type === "short"){
      rejected.push({...base, reason: "short未対応"});
      return;
    }
    if(q.type !== "single" && q.type !== "multi"){
      rejected.push({...base, reason: "type未対応"});
      return;
    }
    if(!q.options || typeof q.options !== "object"){
      rejected.push({...base, reason: "options missing"});
      return;
    }
    const optionKeys = Object.keys(q.options || {});
    const normalizedOptionKeys = optionKeys.map(k => normalizeOptionKey(k));
    const answers = Array.isArray(q.answer) ? q.answer : (typeof q.answer === "string" ? [q.answer] : []);
    if(optionKeys.length === 0){
      rejected.push({...base, reason: "options empty"});
      return;
    }
    const normalizedAnswers = answers.map(a => normalizeOptionKey(a));
    if(normalizedAnswers.length === 0 || normalizedAnswers.some(a => !normalizedOptionKeys.includes(a))){
      rejected.push({...base, reason: "answer invalid"});
      return;
    }
    const normalized = {...q, answer: normalizedAnswers};
    accepted.push(normalized);
  });
  return {accepted, rejected};
}

function summarizeRejectedQuestions(rejected){
  if(!rejected.length) return "";
  const byReason = rejected.reduce((acc, cur) => {
    acc[cur.reason] = (acc[cur.reason] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(byReason)
    .map(([reason, count]) => `${reason}: ${count}件`)
    .join(" / ");
}

function pickFile(accept, cb){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = async () => {
    const file = input.files[0];
    if(!file) return;
    const txt = await file.text();
    cb(txt);
  };
  input.click();
}

async function resetStateAfterQuestionImport(){
  PROGRESS_CACHE = createEmptyProgress();
  if(!navigator.onLine){
    console.log("[import] progress reset skipped (offline)");
    return;
  }
  try{
    await resetProgress();
    console.log("[import] progress reset via API", {deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID});
  }catch(e){
    console.warn("[import] progress reset failed", e);
  }
}

async function importQuestionsFromFile(file, {setImportMessage, refreshDataSummary}){
  console.log("[import] file selected", {name: file.name, size: file.size, type: file.type});
  let parsed;
  try{
    const text = await file.text();
    parsed = JSON.parse(text);
    console.log("[import] JSON.parse ok", {length: text.length});
  }catch(e){
    console.error("[import] JSON.parse failed", e);
    setImportMessage("JSON形式が不正です。ファイルを確認してください。", "warn");
    return;
  }

  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : (Array.isArray(parsed) ? parsed : null);
  if(!rawQuestions){
    setImportMessage("questions配列が見つかりません。JSONの構造を確認してください。", "warn");
    return;
  }

  console.log("[import] payload summary", {
    source: parsed?.source || file.name,
    questions: rawQuestions.length
  });

  const typeCounts = summarizeQuestionTypes(rawQuestions);
  console.log("[import] type counts", typeCounts);

  const {accepted, rejected} = validateImportedQuestions(rawQuestions);
  const rejectedSummary = summarizeRejectedQuestions(rejected);
  if(rejected.length){
    console.log("[import] rejected summary", rejectedSummary);
    console.table(rejected);
  }

  if(accepted.length === 0){
    const reasonNote = rejectedSummary ? `（除外理由: ${rejectedSummary}）` : "";
    setImportMessage(`取り込める問題がありませんでした。shortは未対応です。${reasonNote}`, "warn");
    return;
  }

  const importSource = parsed?.source || file.name || "import";
  const payload = {
    version: parsed?.version || 1,
    source: importSource,
    importedAt: nowISO(),
    questions: accepted
  };

  const deckId = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
  saveImportedQuestions(deckId, payload);
  DATA = {version: payload.version, source: payload.source, questions: accepted};
  QUESTIONS = accepted;
  INDEX = {};
  ensureQuestionTags();
  validateQuestions(QUESTIONS);
  QUESTIONS.forEach(q => { INDEX[q.id] = q; });
  await resetStateAfterQuestionImport();
  refreshDataSummary();
  const note = rejected.length ? `（除外: ${rejected.length}件 / ${rejectedSummary}）` : "";
  setImportMessage(`問題データを読み込みました（source: ${importSource} / ${accepted.length}件）${note}`, "ok");
}

/* -------- Mock result import -------- */
async function applyImportedAttempt(parsed, graded, rawText, label){
  if(!navigator.onLine){
    throw new Error("オフラインのため反映できません。オンラインで再試行してください。");
  }
  const progress = loadProgress();
  const snapshot = clone(progress);
  snapshot.lastImportUndo = null;
  const nowIso = nowISO();
  const nowMsVal = nowMs();

  QUESTIONS.forEach((q, idx) => {
    const id = q.id;
    const ans = parsed.answers[id];
    const ok = ans !== undefined && ans !== null && isCorrect(q, [ans]);
    const card = getOrCreateCard(progress, id);
    incrementStats(card, !!ok);
    applySpacedRepetition(card, ok ? "good" : "again");
    card.lastImportedAt = nowMsVal;
  });

  const compactAnswers = Object.entries(parsed.answers).map(([id, ans]) => ({id, answer: ans}));
  const attemptEntry = {
    type: "mockImport",
    importedAt: nowIso,
    label: label || `模試インポート ${nowIso}`,
    correct: graded.correct,
    total: graded.total,
    wrongIds: graded.wrongIds,
    unansweredIds: graded.unansweredIds,
    tagMissCounts: graded.tagMissCounts,
    tags: Object.keys(graded.tagMissCounts || {}),
    relatedTags: Object.keys(graded.tagMissCounts || {}),
    answers: compactAnswers,
    rawLength: rawText.length
  };
  recordAttemptHistory(progress, attemptEntry);
  progress.lastImportUndo = {savedAt: nowIso, label: attemptEntry.label, snapshot};
  saveProgress(progress);
  await dataStore.importProgress({deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID, progress});
  return attemptEntry;
}

function undoLastImport(){
  const p = loadProgress();
  if(!p.lastImportUndo || !p.lastImportUndo.snapshot){
    alert("取り消せるインポートがありません。");
    return;
  }
  const restored = normalizeProgress(p.lastImportUndo.snapshot);
  restored.lastImportUndo = null;
  saveProgress(restored);
  dataStore.importProgress({deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID, progress: restored}).then(() => {
    alert("直前のインポートを取り消しました。");
    renderHome();
  }).catch(err => {
    console.error(err);
    alert(err.message || "取り消しに失敗しました。");
  });
}

function renderMockImport(){
  setCurrentView("mockImport");
  const inputSingle = el("textarea", {rows:3, placeholder:"例）ABAAD--EBABC...（100文字）"});
  const inputLines = el("textarea", {rows:6, placeholder:"例）1 A\\n2 B\\n3 -  または  1:A,2:B,3:-"});
  const status = el("div", {class:"small"}, []);
  const resultBox = el("div", {class:"card", style:"display:none"}, []);
  let parsed = null;
  let graded = null;

  function handleGrade(){
    const raw = (inputSingle.value || "").trim() ? inputSingle.value : inputLines.value;
    const {answers, errors} = parseImportText(raw || "");
    parsed = null; graded = null;
    resultBox.style.display = "none";
    resultBox.innerHTML = "";
    if(errors.length){
      status.textContent = errors.join(" / ");
      return;
    }
    const filled = Object.keys(answers).length;
    if(filled === 0){
      status.textContent = "有効な回答が見つかりませんでした。";
      return;
    }
    parsed = {answers, raw};
    graded = gradeAttempt(answers);
    status.textContent = `採点しました: ${graded.correct}/${graded.total} 点`;
    resultBox.style.display = "block";
    const wrongList = graded.wrongIds.length ? graded.wrongIds.join(", ") : "なし";
    const unansweredList = graded.unansweredIds.length ? graded.unansweredIds.join(", ") : "なし";
    const tagList = Object.entries(graded.tagMissCounts).map(([tag,cnt]) => `${tag}: ${cnt}件`).join(" / ") || "なし";
    resultBox.appendChild(el("div", {class:"h2"}, [`得点: ${graded.correct}/${graded.total}`]));
    resultBox.appendChild(el("div", {class:"p"}, [`誤答: ${wrongList}\n未回答: ${unansweredList}\nタグ別誤答: ${tagList}`]));
  }

  const applyBtn = el("button", {class:"btn", onClick: () => {
    if(!parsed || !graded){
      alert("まず採点してください。");
      return;
    }
    const label = `模試インポート (${nowISO().slice(0,10)})`;
    applyImportedAttempt(parsed, graded, parsed.raw, label)
      .then(() => {
        alert("学習履歴を更新しました。復習セット（模試ベース）から取り出せます。");
        renderHome();
      })
      .catch(err => {
        console.error(err);
        alert(err.message || "学習履歴の更新に失敗しました。");
      });
  }}, ["この結果を学習履歴に反映"]);

  const undoBtn = el("button", {class:"btn btn--muted", onClick: () => undoLastImport()}, ["直前のインポートを取り消す（Undo）"]);
  const p = loadProgress();
  if(!p.lastImportUndo) undoBtn.setAttribute("disabled", "disabled");

  const node = viewCard("模擬試験結果インポート", [
    el("div", {class:"p"}, ["100文字の回答列または番号付き形式を貼り付けてください。A-Eと-（未回答）が使えます。"]),
    el("div", {class:"h2"}, ["方法A: 100文字入力（Q1→Q100）"]),
    inputSingle,
    el("div", {class:"h2"}, ["方法B: 行形式/カンマ区切り"]),
    inputLines,
    el("div", {class:"row"}, [
      el("button", {class:"btn", onClick: handleGrade}, ["採点する"]),
      applyBtn,
      undoBtn
    ]),
    status,
    el("div", {class:"hr"}, []),
    resultBox,
    el("div", {class:"hr"}, []),
    el("button", {class:"btn btn--muted", onClick: () => {
      inputSingle.value = "";
      inputLines.value = "";
      status.textContent = "";
      resultBox.style.display = "none";
    }}, ["入力をクリア"])
  ]);
  mount(node);
}

/* -------- Topic / Tag selection -------- */
function buildTopicMap(){
  const byTopic = {};
  for(const q of QUESTIONS){
    const topic = q.topic || "その他";
    if(!byTopic[topic]) byTopic[topic] = [];
    byTopic[topic].push(q);
  }
  return byTopic;
}

function renderTopicSelect(){
  setCurrentView("topicSelect");
  const byTopic = buildTopicMap();
  const topics = Object.keys(byTopic).sort((a,b)=> byTopic[b].length - byTopic[a].length);

  const topicCards = topics.map(topic => {
    const qs = byTopic[topic];
    const tags = {};
    qs.forEach(q => { tags[q.tag] = (tags[q.tag]||0)+1; });

    const tagList = Object.entries(tags).sort((a,b)=>b[1]-a[1]).map(([tag,count]) => {
      return el("button", {class:"btn btn--muted", onClick: ()=> startPractice({count:10, tag})}, [`${tag}（${count}）`]);
    });

    return el("div", {class:"card"}, [
      el("div", {class:"h2"}, [`${topic}（${qs.length}）`]),
      el("div", {class:"small"}, ["下のタグボタンを押すと、その範囲から10問ランダムで練習します。"]),
      el("div", {class:"row"}, tagList)
    ]);
  });

  mount(viewCard("トピック/タグで練習", [
    el("div", {class:"small"}, ["まずは「脳幹」「脳神経」「感覚路」「大脳基底核」あたりが高頻度になりがちです。"]),
    ...topicCards
  ]));
}

/* -------- Practice / Quiz engine -------- */
function normalizeShortAnswer(input){
  return String(input ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[\s\u3000]+/g, "")
    .toLowerCase();
}
function normalizeOptionKey(key){
  return String(key ?? "").trim().toUpperCase();
}
function normalizeOptionList(arr){
  const normalized = (arr || []).map(normalizeOptionKey).filter(Boolean);
  return Array.from(new Set(normalized));
}
function isSameOptionSet(a, b){
  if(a.size !== b.size) return false;
  for(const v of a){
    if(!b.has(v)) return false;
  }
  return true;
}
function formatOptionKeys(keys){
  const normalized = normalizeOptionList(keys).sort();
  return normalized.join("・");
}
function isCorrect(q, selectedLetters){
  if(q.type === "short"){
    const userInput = Array.isArray(selectedLetters) ? selectedLetters.join("") : selectedLetters;
    const normalized = normalizeShortAnswer(userInput);
    return (q.answer || []).some(ans => normalizeShortAnswer(ans) === normalized);
  }
  const answerSet = new Set(normalizeOptionList(q.answer));
  const selectedSet = new Set(normalizeOptionList(selectedLetters));
  return isSameOptionSet(answerSet, selectedSet);
}
function getSelectedFromForm(form, qtype){
  const selected = [];
  if(qtype === "single"){
    const v = form.querySelector("input[name='opt']:checked");
    if(v) selected.push(normalizeOptionKey(v.value));
  }else{
    form.querySelectorAll("input[name='opt']:checked").forEach(x => selected.push(normalizeOptionKey(x.value)));
  }
  return selected;
}

function pickPracticeIds({count=10, tag=null, ids=null, prioritizeUnlearned=false}={}){
  let pool = QUESTIONS;
  if(ids && ids.length){
    pool = ids.map(id => INDEX[id]).filter(Boolean);
  }else if(tag){
    pool = QUESTIONS.filter(q => q.tag === tag);
  }

  const limit = Math.min(count, pool.length);
  if(limit <= 0) return [];

  if(prioritizeUnlearned){
    const progress = loadProgress();
    const unattempted = [];
    const attempted = [];
    pool.forEach(q => {
      const seen = progress.cards[q.id]?.seen || 0;
      if(seen === 0) unattempted.push(q);
      else attempted.push(q);
    });
    const ordered = [...shuffle(unattempted), ...shuffle(attempted)];
    return ordered.slice(0, limit).map(q => q.id);
  }

  return shuffle(pool).slice(0, limit).map(q => q.id);
}

function startPractice({count=10, tag=null, ids=null, prioritizeUnlearned=false}={}){
  if(!requireSession({online: true})) return;
  const picked = pickPracticeIds({count, tag, ids, prioritizeUnlearned});
  if(picked.length === 0){
    alert("出題できる問題が見つかりませんでした。");
    renderHome();
    return;
  }
  const session = {mode:"practice", ids:picked, idx:0, answers:{}, startAt: nowISO()};
  renderQuiz(session);
}

function startDailyReview(){
  if(!requireSession({online: true})) return;
  const ids = buildReviewQueue(DAILY_REVIEW_LIMIT);
  if(ids.length === 0){
    alert("今日やるべき問題はありません。新しい問題を解きましょう！");
    return;
  }
  const session = {mode:"review", ids, idx:0, answers:{}, startAt: nowISO()};
  renderQuiz(session);
}

function startMockReview(count=20){
  if(!requireSession({online: true})) return;
  const ids = buildMockReviewQueue(count);
  if(ids.length === 0){
    alert("直近の模試インポートが見つかりません。先に模試結果をインポートしてください。");
    return;
  }
  const session = {mode:"mockReview", ids, idx:0, answers:{}, startAt: nowISO()};
  renderQuiz(session);
}

function buildReviewQueue(limit){
  const progress = loadProgress();
  const now = nowMs();
  const due = [];
  const fresh = [];
  QUESTIONS.forEach(q => {
    const card = progress.cards[q.id];
    if(card && card.seen > 0){
      if((card.sr?.dueAt || 0) <= now) due.push(q);
    }else{
      fresh.push(q);
    }
  });
  const queue = [];
  shuffle(due).forEach(q => { if(queue.length < limit) queue.push(q.id); });
  shuffle(fresh).forEach(q => { if(queue.length < limit) queue.push(q.id); });
  return queue;
}

function startWeakReview(){
  if(!requireSession({online: true})) return;
  const p = loadProgress();
  const now = nowMs();
  const scored = QUESTIONS.map(q => {
    const card = p.cards[q.id] || defaultCard();
    const wrong = card.wrong || 0;
    const correct = card.correct || 0;
    const attempts = card.seen || 0;
    const correctRate = (correct+wrong) ? correct/(correct+wrong) : 0;
    const dueScore = (card.sr?.dueAt || 0) <= now ? 5 : 0;
    const score = wrong*2 + dueScore + (1 - correctRate)*3 + (attempts === 0 ? -0.5 : 0);
    return {id:q.id, score};
  }).sort((a,b)=> b.score - a.score);
  const ids = scored.slice(0, 10).map(x=>x.id);
  startPractice({ids});
}

function getLatestMockAttempt(){
  const p = loadProgress();
  const hist = Array.isArray(p.attemptHistory) ? p.attemptHistory : [];
  const mockAttempts = hist.filter(h => h.type === "mockImport");
  return mockAttempts.length ? mockAttempts[mockAttempts.length-1] : null;
}

function interleaveByTag(ids){
  const buckets = {};
  ids.forEach(id => {
    const q = INDEX[id];
    const tag = q?.tag || "その他";
    if(!buckets[tag]) buckets[tag] = [];
    buckets[tag].push(id);
  });
  const tags = Object.keys(buckets);
  const output = [];
  while(tags.some(t => buckets[t].length)){
    tags.forEach(t => {
      const v = buckets[t].shift();
      if(v) output.push(v);
    });
  }
  return output;
}

function buildMockReviewQueue(limit){
  const latest = getLatestMockAttempt();
  if(!latest) return [];
  const progress = loadProgress();
  const unansweredIds = latest.unansweredIds.map(n => padQuestionNumber(n));
  const wrongIds = latest.wrongIds.map(n => padQuestionNumber(n)).filter(id => !unansweredIds.includes(id));
  const targetTags = uniq([...latest.relatedTags || [], ...latest.tags || []]);

  const queue = [];
  const pushUnique = (id) => {
    if(id && !queue.includes(id)) queue.push(id);
  };

  unansweredIds.forEach(pushUnique);
  wrongIds.forEach(pushUnique);

  if(queue.length < limit){
    const relatedPool = QUESTIONS.filter(q => {
      if(queue.includes(q.id)) return false;
      const concepts = getConceptsForQuestion(q);
      return concepts.some(c => targetTags.includes(c));
    });
    shuffle(relatedPool).forEach(q => {
      if(queue.length < limit) pushUnique(q.id);
    });
  }

  if(queue.length < limit){
    const now = nowMs();
    const duePool = QUESTIONS.filter(q => {
      const card = progress.cards[q.id];
      return card && card.seen > 0 && (card.sr?.dueAt || 0) <= now;
    }).filter(q => !queue.includes(q.id));
    shuffle(duePool).forEach(q => {
      if(queue.length < limit) pushUnique(q.id);
    });
  }

  if(queue.length < limit){
    const remaining = QUESTIONS.filter(q => !queue.includes(q.id));
    shuffle(remaining).forEach(q => {
      if(queue.length < limit) pushUnique(q.id);
    });
  }

  return interleaveByTag(queue).slice(0, limit);
}

function renderQuiz(session){
  const total = session.ids.length;
  const qid = session.ids[session.idx];
  const q = INDEX[qid];
  if(!q){
    mount(viewCard("エラー", [el("div", {class:"p"}, ["問題が見つかりませんでした。"])]));
    return;
  }
  const progressPct = Math.round(((session.idx)/total)*100);

  const header = el("div", {class:"row"}, [
    el("span", {class:"badge"}, [`${session.idx+1}/${total}`]),
    el("span", {class:"badge"}, [q.type_raw]),
    el("span", {class:"badge"}, [q.tag]),
    el("span", {class:"badge"}, [session.mode === "review" ? "復習" : (session.mode === "mockReview" ? "模試復習" : "練習")]),
  ]);

  const prog = el("div", {class:"progress"}, [el("div", {style:`width:${progressPct}%`}, [])]);

  const form = el("form", {}, []);
  const isShort = q.type === "short";
  const optType = q.type === "multi" ? "checkbox" : "radio";

  const prevSel = session.answers[q.id]?.selected || [];
  const prevText = session.answers[q.id]?.text || "";
  let shortInput = null;

  if(isShort){
    shortInput = el("input", {type:"text", placeholder:"回答を入力", value: prevText});
    form.appendChild(shortInput);
  }else{
    ["A","B","C","D","E"].forEach(k => {
      const checked = prevSel.includes(k);
      const inputId = `${q.id}_${k}`;
      form.appendChild(el("label", {class:"option", for: inputId}, [
        el("input", {type: optType, name:"opt", value:k, id: inputId, ...(checked?{checked:"checked"}:{})}),
        el("div", {class:"option__key"}, [k]),
        el("div", {class:"option__label"}, [q.options[k] || ""])
      ]));
    });
  }

  const resultBox = el("div", {class:"card", style:"display:none"}, []);
  let graded = false;

  function goNext(){
    if(session.idx < total-1){
      session.idx += 1;
      renderQuiz(session);
    }else{
      renderHome();
    }
  }

  async function handleGrade(grade, meta){
    if(graded) return;
    if(!navigator.onLine){
      alert("オフラインのため更新できません。オンライン時に再度お試しください。");
      return;
    }
    graded = true;
    const p = loadProgress();
    const card = getOrCreateCard(p, q.id);
    applySpacedRepetition(card, grade);
    if(meta.reason || meta.note){
      logMistake(card, meta.reason, meta.note);
    }
    saveProgress(p);
    const answerEntry = session.answers[q.id] || {};
    const chosenAnswers = answerEntry.selected || (answerEntry.text ? [answerEntry.text] : []);
    const isCorrectFlag = typeof answerEntry.ok === "boolean" ? answerEntry.ok : null;
    try{
      const remote = await recordAttempt({
        deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID,
        questionId: q.id,
        grade,
        chosenAnswers,
        isCorrect: isCorrectFlag,
        reason: meta.reason || null,
        note: meta.note || null
      });
      applyRemoteProgressCard(p, remote);
      saveProgress(p);
    }catch(err){
      console.error("[attempt] sync failed", err);
      alert(err.message || "回答の同期に失敗しました。");
    }
    goNext();
  }

  function appendResultControls(ok){
    const controls = el("div", {class:"sr-controls"}, []);
    const reasonLabel = el("label", {class:"small"}, ["誤答理由（任意）"]);
    const reasonSel = el("select", {}, [el("option", {value:""}, ["選択してください"]), ...SR_REASON_OPTIONS.map(r=> el("option", {value:r}, [r]))]);
    if(!ok){ reasonSel.value = SR_REASON_OPTIONS[0]; }
    const noteInput = el("input", {type:"text", placeholder:"メモ（語呂合わせ/混同ポイントなど）"});

    controls.appendChild(reasonLabel);
    controls.appendChild(reasonSel);
    controls.appendChild(noteInput);

    const gradeRow = el("div", {class:"row grade-row"}, []);
    const offline = !navigator.onLine;
    [
      {key:"again", label:"Again", cls:"btn--danger"},
      {key:"hard", label:"Hard", cls:"btn--muted"},
      {key:"good", label:"Good", cls:"btn--ok"},
      {key:"easy", label:"Easy", cls:"btn"}
    ].forEach(g => {
      const btn = el("button", {
        class:`btn ${g.cls} btn--sr`,
        type:"button",
        onClick: () => handleGrade(g.key, {reason: reasonSel.value || null, note: noteInput.value}),
        ...(offline ? {disabled:"disabled"} : {})
      }, [g.label]);
      if(!ok && g.key === "again") btn.classList.add("btn--primary");
      gradeRow.appendChild(btn);
    });
    if(offline){
      controls.appendChild(el("div", {class:"small"}, ["※オフラインのため評価できません。オンラインで再試行してください。"]));
    }
    controls.appendChild(el("div", {class:"small"}, ["※評価すると自動で次の問題へ進みます"]));
    controls.appendChild(gradeRow);

    resultBox.appendChild(el("div", {class:"hr"}, []));
    resultBox.appendChild(controls);
    resultBox.appendChild(el("div", {class:"hr"}, []));
  }

  function showResultSelected(selected){
    const ok = isCorrect(q, selected);
    if(navigator.onLine){
      const p = loadProgress();
      const card = getOrCreateCard(p, q.id);
      incrementStats(card, ok);
      saveProgress(p);
    }

    session.answers[q.id] = {selected, ok};

    const ansStr = formatOptionKeys(q.answer);
    const selStr = formatOptionKeys(selected);

    resultBox.style.display = "block";
    resultBox.innerHTML = "";
    resultBox.appendChild(el("div", {class:"h2"}, [ ok ? "✅ 正解" : "❌ 不正解" ]));
    resultBox.appendChild(el("div", {class:"p"}, [
      `あなたの回答: ${selStr || "(未選択)"}\n正解: ${ansStr}`
    ]));
    if(q.explanation){
      resultBox.appendChild(el("div", {class:"hr"}, []));
      resultBox.appendChild(el("div", {class:"small"}, ["解説"]));
      resultBox.appendChild(el("div", {class:"p"}, [q.explanation]));
    }
    appendResultControls(ok);

    const nextBtn = el("button", {class:"btn btn--muted", type:"button", onClick: goNext}, [session.idx < total-1 ? "次へ" : "ホームへ"]);

    resultBox.appendChild(nextBtn);
  }

  function showResultShort(inputText){
    const ok = isCorrect(q, inputText);
    if(navigator.onLine){
      const p = loadProgress();
      const card = getOrCreateCard(p, q.id);
      incrementStats(card, ok);
      saveProgress(p);
    }

    session.answers[q.id] = {text: inputText, ok};

    const representative = (q.answer || [])[0] || "";
    const userText = inputText || "(未入力)";

    resultBox.style.display = "block";
    resultBox.innerHTML = "";
    resultBox.appendChild(el("div", {class:"h2"}, [ ok ? "✅ 正解" : "❌ 不正解" ]));
    resultBox.appendChild(el("div", {class:"p"}, [
      `あなたの回答: ${userText}\n正解（代表）: ${representative}`
    ]));
    if(q.explanation){
      resultBox.appendChild(el("div", {class:"hr"}, []));
      resultBox.appendChild(el("div", {class:"small"}, ["解説"]));
      resultBox.appendChild(el("div", {class:"p"}, [q.explanation]));
    }
    appendResultControls(ok);

    const nextBtn = el("button", {class:"btn btn--muted", type:"button", onClick: goNext}, [session.idx < total-1 ? "次へ" : "ホームへ"]);

    resultBox.appendChild(nextBtn);
  }

  const submitBtn = el("button", {class:"btn", type:"submit"}, [isShort ? "判定する" : "採点する"]);
  const backBtn = el("button", {class:"btn btn--muted", type:"button", onClick: ()=> {
    if(session.idx>0){
      session.idx -= 1;
      renderQuiz(session);
    }else{
      renderHome();
    }
  }}, [session.idx>0 ? "前へ" : "ホームへ"]);

  form.appendChild(el("div", {class:"row"}, [backBtn, submitBtn]));

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if(isShort){
      const inputText = shortInput ? shortInput.value : "";
      session.answers[q.id] = {text: inputText};
      showResultShort(inputText);
    }else{
      const selected = getSelectedFromForm(form, q.type);
      if(q.type === "multi" && selected.length === 0){
        alert("少なくとも1つ選択してください。");
        return;
      }
      session.answers[q.id] = {selected};
      showResultSelected(selected);
    }
  });

  const title = session.mode === "review" ? "クイズ（復習）" : (session.mode === "mockReview" ? "クイズ（模試ベース復習）" : "クイズ（練習）");
  const body = [
    header,
    prog,
    el("div", {class:"hr"}, []),
    el("div", {class:"p"}, [q.stem]),
    form,
    resultBox,
  ];
  mount(viewCard(title, body));
}

/* -------- Mock test (90 min, 100 Q) -------- */
async function fetchOngoingTest(){
  const deckId = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
  const res = await dataStore.getOngoingTest(deckId);
  if(!res.session) return null;
  const ids = (res.items || []).sort((a,b) => a.orderIndex - b.orderIndex).map(item => item.questionId);
  return {
    id: res.session.id,
    mode: res.session.mode,
    ids,
    idx: res.session.meta?.idx || 0,
    answers: res.session.meta?.answers || {},
    startedAt: Date.parse(res.session.startedAt || nowISO()),
    durationSec: res.session.durationSec || 90 * 60,
    finished: !!res.session.completedAt
  };
}

function saveOngoingTest(test){
  const meta = {idx: test.idx, answers: test.answers || {}};
  dataStore.updateTestSession({id: test.id, meta}).catch(err => {
    console.error("[test] save failed", err);
  });
}

function clearOngoingTest(testId){
  if(!testId) return;
  dataStore.updateTestSession({id: testId, completedAt: nowISO()}).catch(err => {
    console.error("[test] clear failed", err);
  });
}

async function startMockTest(){
  if(!requireSession({online: true})) return;
  if(deckHasShort()){
    alert("短答問題が含まれているため、このデッキでは模擬テストを利用できません。");
    return;
  }
  try{
    const existing = await fetchOngoingTest().catch(() => null);
    if(existing && existing.mode === "mock" && existing.ids && confirm("途中保存の模擬テストがあります。再開しますか？")){
      renderMock(existing);
      return;
    }
    const res = await dataStore.createTestSession({
      deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID,
      mode: "mock",
      size: 100
    });
    const test = {
      id: res.sessionId,
      mode: "mock",
      ids: res.questionIds || [],
      idx: 0,
      answers: {},
      startedAt: Date.now(),
      durationSec: 90 * 60,
      finished: false
    };
    saveOngoingTest(test);
    renderMock(test);
  }catch(e){
    console.error(e);
    alert(e.message || "模擬テストの開始に失敗しました。");
  }
}

function formatTime(sec){
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s/60);
  const r = s%60;
  const mm = String(m).padStart(2,"0");
  const rr = String(r).padStart(2,"0");
  return `${mm}:${rr}`;
}

let mockTimerHandle = null;

function renderMock(test){
  // Stop previous timer
  if(mockTimerHandle) clearInterval(mockTimerHandle);

  const total = test.ids.length;
  const qid = test.ids[test.idx];
  const q = INDEX[qid];

  const header = el("div", {class:"row"}, [
    el("span", {class:"badge"}, [`${test.idx+1}/${total}`]),
    el("span", {class:"badge"}, [q.type_raw]),
    el("span", {class:"badge"}, [q.tag]),
    el("span", {class:"badge timer", id:"timerText"}, ["--:--"]),
  ]);

  const prog = el("div", {class:"progress"}, [el("div", {style:`width:${Math.round((test.idx/total)*100)}%`}, [])]);

  const form = el("form", {}, []);
  const optType = q.type === "multi" ? "checkbox" : "radio";
  const prevSel = test.answers[q.id]?.selected || [];

  ["A","B","C","D","E"].forEach(k => {
    const checked = prevSel.includes(k);
    const inputId = `${q.id}_${k}`;
    form.appendChild(el("label", {class:"option", for: inputId}, [
      el("input", {type: optType, name:"opt", value:k, id: inputId, ...(checked?{checked:"checked"}:{})}),
      el("div", {class:"option__key"}, [k]),
      el("div", {class:"option__label"}, [q.options[k] || ""])
    ]));
  });

  function autosave(){
    saveOngoingTest(test);
  }

  form.addEventListener("change", () => {
    const selected = getSelectedFromForm(form, q.type);
    test.answers[q.id] = {selected};
    autosave();
  });

  const nav = el("div", {class:"row"}, [
    el("button", {class:"btn btn--muted", type:"button", onClick: ()=> {
      if(test.idx>0){ test.idx -= 1; autosave(); renderMock(test); }
    }}, ["前へ"]),
    el("button", {class:"btn btn--muted", type:"button", onClick: ()=> {
      if(test.idx<total-1){ test.idx += 1; autosave(); renderMock(test); }
    }}, ["次へ"]),
    el("button", {class:"btn", type:"button", onClick: ()=> finishMock(test)}, ["提出して採点"])
  ]);

  const node = viewCard("模擬テスト（90分・100問）", [
    header,
    prog,
    el("div", {class:"hr"}, []),
    el("div", {class:"p"}, [q.stem]),
    form,
    el("div", {class:"hr"}, []),
    nav,
    el("div", {class:"small"}, ["※解答は自動保存されます。タイマーが0になったら提出してください。"]),
  ]);
  mount(node);

  // timer
  const timerText = document.getElementById("timerText");
  const tick = () => {
    const elapsed = (Date.now() - test.startedAt)/1000;
    const left = test.durationSec - elapsed;
    timerText.textContent = formatTime(left);
    if(left <= 0){
      clearInterval(mockTimerHandle);
      finishMock(test);
    }
  };
  tick();
  mockTimerHandle = setInterval(tick, 500);
}

async function applyMockResults(results, reflectToSR, sessionId){
  if(!navigator.onLine){
    throw new Error("オフラインのため模試結果を保存できません。オンラインで再試行してください。");
  }
  const p = loadProgress();
  for(const r of results){
    const card = getOrCreateCard(p, r.id);
    incrementStats(card, r.ok);
    const grade = reflectToSR ? (r.ok ? "good" : "again") : null;
    if(grade){
      applySpacedRepetition(card, grade);
    }
    try{
      const remote = await recordAttempt({
        deckId: ACTIVE_DECK?.id || DEFAULT_DECK_ID,
        questionId: r.id,
        grade,
        chosenAnswers: r.selected || [],
        isCorrect: r.ok,
        sessionId
      });
      applyRemoteProgressCard(p, remote);
    }catch(err){
      console.error("[mock] attempt sync failed", err);
    }
  }
  saveProgress(p);
}

function finishMock(test){
  if(mockTimerHandle) clearInterval(mockTimerHandle);

  // grade
  let correct = 0;
  const results = [];
  for(const id of test.ids){
    const q = INDEX[id];
    const selected = (test.answers[id]?.selected || []);
    const ok = isCorrect(q, selected);
    results.push({id, ok, selected, answer:q.answer, tag:q.tag, type:q.type_raw});
    if(ok) correct += 1;
  }
  clearOngoingTest(test.id);

  const score = Math.round((correct/test.ids.length)*100);
  let reflectChecked = true;
  let applied = false;

  const reflectToggle = el("input", {type:"checkbox", checked:"checked"});
  reflectToggle.addEventListener("change", () => {
    reflectChecked = reflectToggle.checked;
  });

  const applyBtn = el("button", {class:"btn", onClick: () => {
    if(applied) return;
    applyMockResults(results, reflectChecked, test.id)
      .then(() => {
        applied = true;
        applyBtn.setAttribute("disabled", "disabled");
        applyBtn.textContent = "記録済み";
        alert(reflectChecked ? "模試結果を復習キューに反映しました。" : "正誤だけを進捗に記録しました。");
      })
      .catch(err => {
        console.error(err);
        alert(err.message || "模試結果の記録に失敗しました。");
      });
  }}, ["結果を記録"]);

  const stNode = viewCard("模擬テスト結果", [
    el("div", {class:"p"}, [
      `正解数: ${correct}/${test.ids.length}\n得点（%）: ${score}%`
    ]),
    el("div", {class:"row"}, [
      el("label", {class:"small"}, [
        reflectToggle,
        " この模試の結果を復習キューに反映（正解: Good / 不正解: Again）"
      ]),
      applyBtn
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"row"}, [
      el("button", {class:"btn", onClick: ()=> startWeakReview()}, ["弱点復習へ"]),
      el("button", {class:"btn btn--muted", onClick: ()=> renderHome()}, ["ホームへ"])
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"h2"}, ["見直し（不正解のみ・上位20）"]),
    ...results.filter(r=>!r.ok).slice(0,20).map(r => {
      const q = INDEX[r.id];
      return el("div", {class:"card"}, [
        el("div", {class:"h2"}, [`${r.id}  ❌`]),
        el("div", {class:"small"}, [`${r.tag} / ${r.type}`]),
        el("div", {class:"p"}, [q.stem]),
        el("div", {class:"small"}, [`あなた: ${formatOptionKeys(r.selected) || "(未選択)"} / 正解: ${formatOptionKeys(r.answer)}`]),
        q.explanation ? el("div", {class:"p"}, [q.explanation]) : el("div", {class:"small"}, ["（解説なし）"])
      ]);
    })
  ]);
  mount(stNode);
}

function deckHasShort(){
  return QUESTIONS.some(q => q.type === "short");
}

/* -------- Init -------- */

function ensureDeckDefaults(list){
  const decks = normalizeDecks(list);
  if(!decks.some(d => d.id === DEFAULT_DECK_ID)){
    decks.unshift({
      id: DEFAULT_DECK_ID,
      label: DEFAULT_DECK_NAME,
      displayNameJa: DEFAULT_DECK_NAME,
      shortLabelJa: DEFAULT_DECK_NAME
    });
  }
  return decks;
}

function renderDeckSelect(){
  const sel = document.getElementById("deckSelect");
  if(!sel) return;
  sel.innerHTML = "";
  DECKS.forEach(deck => {
    const opt = document.createElement("option");
    opt.value = deck.id;
    opt.textContent = getDeckShortLabel(deck);
    sel.appendChild(opt);
  });
  sel.value = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
  sel.onchange = async () => {
    if(!navigator.onLine){
      alert("オフラインのためデッキを切り替えられません。オンラインで再試行してください。");
      sel.value = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
      return;
    }
    setActiveDeck(sel.value);
    PROGRESS_CACHE = null;
    DATA = null;
    QUESTIONS = [];
    INDEX = {};
    await initData();
    await initProgress();
    renderHome();
    updateAppTitle();
  };
}

async function initDecks(){
  const decks = await dataStore.getDecks();
  DECKS = ensureDeckDefaults(decks);
  const defaultDeck = DECKS.find(d => d.id === DEFAULT_DECK_ID) || DECKS[0];
  setActiveDeck(defaultDeck?.id || DEFAULT_DECK_ID);
  renderDeckSelect();
  updateAppTitle();
}

async function initData(){
  const deckId = ACTIVE_DECK?.id || DEFAULT_DECK_ID;
  const imported = getImportedQuestions(deckId);
  if(imported && Array.isArray(imported.questions) && imported.questions.length > 0){
    console.log("[data] using imported questions", {deckId, count: imported.questions.length});
    DATA = {version: imported.version || 1, source: imported.source || "import", questions: imported.questions};
    QUESTIONS = imported.questions;
  }else{
    const questions = await dataStore.getQuestionsPaged(deckId);
    DATA = {version: 1, source: "db", questions};
    QUESTIONS = questions;
  }
  INDEX = {};
  ensureQuestionTags();
  validateQuestions(QUESTIONS);
  QUESTIONS.forEach(q => { INDEX[q.id] = q; });
}

async function registerSW(){
  const elStatus = document.getElementById("swStatus");
  if(!("serviceWorker" in navigator)){
    elStatus.textContent = "（Service Worker非対応）";
    return;
  }
  try{
    await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`);
    elStatus.textContent = "（オフライン対応OK）";
  }catch(e){
    elStatus.textContent = "（オフライン対応: 未設定）";
  }
}

document.getElementById("navHome").addEventListener("click", () => {
  console.log("[nav] home clicked", {path: location.pathname, view: CURRENT_VIEW});
  if(!requireSession()){
    return;
  }
  renderHome();
});
document.getElementById("navStats").addEventListener("click", () => {
  console.log("[nav] stats clicked", {path: location.pathname, view: CURRENT_VIEW});
  if(!requireSession()){
    return;
  }
  renderStats();
});
document.getElementById("navData").addEventListener("click", () => {
  console.log("[nav] data clicked", {path: location.pathname, view: CURRENT_VIEW});
  renderData().catch(e => {
    console.error("[nav] renderData failed", e);
    const details = [
      el("div", {class:"p"}, ["データ画面の表示に失敗しました。"]),
      el("div", {class:"small"}, [String(e?.message || e || "unknown error")])
    ];
    if(e?.stack){
      details.push(el("pre", {class:"small"}, [e.stack]));
    }
    mount(viewCard("エラー", details));
  });
});
document.getElementById("navImport").addEventListener("click", () => {
  console.log("[nav] mock import clicked", {path: location.pathname, view: CURRENT_VIEW});
  if(!requireSession()){
    return;
  }
  renderMockImport();
});

function renderOfflineGate(){
  mount(viewCard("オフライン", [
    el("div", {class:"p"}, ["オフラインのため学習データにアクセスできません。オンラインで再試行してください。"]),
    el("button", {class:"btn", onClick: () => initApp()}, ["再読み込み"])
  ]));
}

function requireSession({online = false} = {}){
  if(!hasSession()){
    renderLogin({message: "ログインが必要です。"});
    return false;
  }
  if(online && !navigator.onLine){
    renderOfflineGate();
    return false;
  }
  return true;
}

async function initAuthenticatedApp(){
  await initDecks();
  await initData();
  await initProgress();
  renderHome();
}

async function initApp(){
  registerSW();
  clearLegacyAppConfig();
  if(!hasSession()){
    renderLogin();
    return;
  }
  if(!navigator.onLine){
    renderOfflineGate();
    return;
  }
  try{
    await dataStore.init();
    await initAuthenticatedApp();
  }catch(e){
    console.error(e);
    renderLogin({message: "APIトークンまたは接続に問題があります。設定を確認してください。"});
  }
}

initApp();
