/* 神経解剖学 学習Webアプリ - Vanilla JS / Offline-first */

const APP_VERSION = 3;
const PROGRESS_VERSION = 3;
const PROGRESS_KEY_V2 = "neuroStudyProgressV2";
const PROGRESS_KEY_V1 = "neuroStudyProgress_v1";
const ONGOING_TEST_KEY = "neuroStudyOngoingTest_v1";
const CUSTOM_DATA_KEY = "neuroStudyCustomData_v1"; // optional override
const CLOUD_CONFIG_KEY = "neuroStudyCloudConfig_v2"; // cloud sync endpoint/token
const CLOUD_STATUS_KEY = "neuroStudyCloudStatus_v1"; // last sync metadata
const CLOUD_SESSION_TOKEN_KEY = "neuroStudyCloudToken_session";

let PROGRESS_CORRUPT_INFO = null;

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

/* -------- Utils -------- */
function nowISO(){ return new Date().toISOString(); }
function nowMs(){ return Date.now(); }
function safeJsonParse(str, fallback){ try{ return JSON.parse(str); }catch(e){ return fallback; } }
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

function loadProgressStored(){
  const raw = localStorage.getItem(PROGRESS_KEY_V2);
  if(!raw) return null;
  try{
    const obj = JSON.parse(raw);
    if(obj && obj.version >= 2){
      return normalizeProgress(obj);
    }
  }catch(e){
    PROGRESS_CORRUPT_INFO = {
      detectedAt: nowISO(),
      rawLength: raw.length
    };
    localStorage.setItem(`${PROGRESS_KEY_V2}_corrupt_backup`, raw);
    localStorage.setItem(`${PROGRESS_KEY_V2}_corrupt_at`, JSON.stringify(PROGRESS_CORRUPT_INFO.detectedAt));
    localStorage.removeItem(PROGRESS_KEY_V2);
  }
  return null;
}

function loadProgressV1Raw(){
  return safeJsonParse(localStorage.getItem(PROGRESS_KEY_V1), {});
}

function migrateFromV1(){
  const old = loadProgressV1Raw();
  if(!old || typeof old !== "object" || Object.keys(old).length === 0) return null;
  const p = createEmptyProgress();
  const now = nowMs();
  for(const [id, v] of Object.entries(old)){
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
  saveProgress(p);
  return p;
}

function loadProgress(){
  if(PROGRESS_CACHE) return PROGRESS_CACHE;
  const existing = loadProgressStored();
  if(existing){ PROGRESS_CACHE = existing; return existing; }
  const migrated = migrateFromV1();
  if(migrated){ PROGRESS_CACHE = migrated; return migrated; }
  const empty = createEmptyProgress();
  saveProgress(empty);
  PROGRESS_CACHE = empty;
  return empty;
}

function saveProgress(p){
  const obj = normalizeProgress(p || {});
  obj.updatedAt = nowMs();
  localStorage.setItem(PROGRESS_KEY_V2, JSON.stringify(obj));
  PROGRESS_CACHE = obj;
  return obj;
}

function resetProgress(){
  localStorage.removeItem(PROGRESS_KEY_V2);
  localStorage.removeItem(PROGRESS_KEY_V1);
  localStorage.removeItem(ONGOING_TEST_KEY);
  PROGRESS_CACHE = null;
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
  const st = getStats();
  const progressPct = st.total ? Math.round((st.attempted/st.total)*100) : 0;
  const dueSummary = summarizeDue();

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

function renderData(){
  const st = getStats();
  const cfgRef = loadCloudConfig();
  let cloudMeta = loadCloudStatus();
  let conflictPayload = null;
  const corruptInfo = PROGRESS_CORRUPT_INFO || safeJsonParse(localStorage.getItem(`${PROGRESS_KEY_V2}_corrupt_at`), null);

  const cloudMessage = el("div", {class:"status status--muted"}, ["クラウド同期は任意設定です。オフラインでも学習できます。"]);
  const corruptMessage = el("div", {class:"status status--warn", style: corruptInfo ? "" : "display:none"}, [
    "⚠️ 進捗データの破損を検知しました。バックアップを保存しました（",
    typeof corruptInfo === "string" ? corruptInfo : (corruptInfo?.detectedAt || "日時不明"),
    "）。JSONのインポートで復旧できるか確認してください。"
  ]);
  const cloudMetaNode = el("div", {class:"small"}, []);
  const cloudConflictNode = el("div", {class:"small status status--warn"}, []);
  const normalizeVersion = (v) => {
    if(v === null || v === undefined) return null;
    const num = Number(v);
    return Number.isFinite(num) ? num : null;
  };

  function updateCloudMetaText(){
    const parts = [];
    parts.push(`最終同期: ${formatDateTime(cloudMeta.lastSyncedAt)}`);
    parts.push(`クラウド version: ${cloudMeta.lastRemoteVersion ?? "未取得"}`);
    parts.push(`クラウド更新: ${formatDateTime(cloudMeta.lastRemoteUpdatedAt)}`);
    setNodeText(cloudMetaNode, parts.join(" / "));
    if(conflictPayload){
      setNodeText(cloudConflictNode, `⚠️ 別の端末で更新されています (version ${conflictPayload.version ?? "?"}, ${formatDateTime(conflictPayload.updatedAt)}). 強制上書きするか、クラウドから取得してください。`);
      cloudConflictNode.style.display = "block";
    }else{
      setNodeText(cloudConflictNode, "");
      cloudConflictNode.style.display = "none";
    }
  }
  updateCloudMetaText();

  function setCloudMessage(msg, variant="info"){
    cloudMessage.className = `status status--${variant}`;
    setNodeText(cloudMessage, msg);
  }

  const tokenInput = el("input", {
    type:"password",
    placeholder:"同期トークン（Bearerトークン）",
    value: cfgRef.token,
    onChange: (e) => { cfgRef.token = e.target.value.trim(); }
  });
  const rememberToggle = el("input", {
    type:"checkbox",
    checked: cfgRef.rememberToken ? "checked" : undefined,
    onChange: (e) => { cfgRef.rememberToken = e.target.checked; }
  });
  const endpointInput = el("input", {
    type:"url",
    placeholder:"APIベースURL（任意。同一オリジンなら空でOK）",
    value: cfgRef.apiBase,
    onChange: (e) => { cfgRef.apiBase = e.target.value.trim(); }
  });

  const btnSaveCloud = el("button", {class:"btn btn--muted"}, ["設定を保存"]);
  const btnPull = el("button", {class:"btn btn--muted"}, ["クラウドから取得"]);
  const btnPush = el("button", {class:"btn"}, ["クラウドへ送信"]);
  const btnForce = el("button", {class:"btn btn--danger", disabled:"disabled"}, ["クラウドを強制上書き"]);

  function setBusy(isBusy){
    [btnSaveCloud, btnPull, btnPush, btnForce].forEach(btn => {
      if(!btn) return;
      if(isBusy){
        btn.setAttribute("disabled", "disabled");
      }else{
        if(btn === btnForce && !conflictPayload){
          btn.setAttribute("disabled", "disabled");
        }else{
          btn.removeAttribute("disabled");
        }
      }
    });
  }

  btnSaveCloud.addEventListener("click", () => {
    saveCloudConfig(cfgRef);
    setCloudMessage("クラウド設定を保存しました。", "ok");
  });

  async function handlePull(){
    if(!cfgRef.token){
      setCloudMessage("同期トークンを入力してください。", "warn");
      return;
    }
    setBusy(true);
    setCloudMessage("クラウドから取得中…", "muted");
    try{
      const remote = await fetchCloudState(cfgRef);
      conflictPayload = null;
      if(remote.state){
        saveProgress(remote.state);
      }
      cloudMeta = {
        ...cloudMeta,
        lastSyncedAt: nowISO(),
        lastRemoteVersion: normalizeVersion(remote.version),
        lastRemoteUpdatedAt: remote.updatedAt || null
      };
      saveCloudStatus(cloudMeta);
      updateCloudMetaText();
      setCloudMessage(remote.state ? "クラウド版を読み込みました。" : "クラウドにデータはまだありません。", "ok");
      renderHome();
    }catch(e){
      setCloudMessage(e.message || "クラウド取得に失敗しました。", "warn");
    }finally{
      setBusy(false);
    }
  }

  async function handlePush(force=false){
    if(!cfgRef.token){
      setCloudMessage("同期トークンを入力してください。", "warn");
      return;
    }
    setBusy(true);
    setCloudMessage(force ? "クラウドへ強制送信中…" : "クラウドへ送信中…", "muted");
    try{
      const result = await pushCloudState(cfgRef, cloudMeta, {force, baseVersion: conflictPayload?.version ?? null});
      conflictPayload = null;
      cloudMeta = {
        ...cloudMeta,
        lastSyncedAt: nowISO(),
        lastRemoteVersion: normalizeVersion(result.version) ?? cloudMeta.lastRemoteVersion,
        lastRemoteUpdatedAt: result.updatedAt || nowISO()
      };
      saveCloudStatus(cloudMeta);
      updateCloudMetaText();
      setCloudMessage("クラウドへ保存しました。", "ok");
    }catch(e){
      if(e instanceof CloudConflictError){
        conflictPayload = e.payload || null;
        if(conflictPayload && conflictPayload.version !== undefined){
          cloudMeta = {...cloudMeta, lastRemoteVersion: normalizeVersion(conflictPayload.version), lastRemoteUpdatedAt: conflictPayload.updatedAt || cloudMeta.lastRemoteUpdatedAt};
          saveCloudStatus(cloudMeta);
        }
        updateCloudMetaText();
        setCloudMessage("クラウド側が更新されています。取得するか、強制上書きしてください。", "warn");
      }else{
        setCloudMessage(e.message || "クラウド送信に失敗しました。", "warn");
      }
    }finally{
      setBusy(false);
    }
  }

  btnPull.addEventListener("click", () => handlePull());
  btnPush.addEventListener("click", () => handlePush(false));
  btnForce.addEventListener("click", () => handlePush(true));

  const node = viewCard("データ", [
    el("div", {class:"p"}, [
      "・学習履歴は端末内（localStorage）に保存されます。\n" +
      "・問題データは同梱 questions.json を使用します（必要なら差し替え/インポート可）。"
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"row"}, [
      el("button", {class:"btn btn--muted", onClick: exportProgress}, ["学習履歴を書き出す（JSON）"]),
      el("button", {class:"btn btn--muted", onClick: importProgress}, ["学習履歴を読み込む（JSON）"]),
      el("button", {class:"btn btn--danger", onClick: () => {
        if(confirm("学習履歴と途中保存の模試をリセットします。よろしいですか？")){
          resetProgress();
          renderHome();
        }
      }}, ["学習履歴をリセット"])
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"h2"}, ["問題データ（上級）"]),
    el("div", {class:"small"}, ["JSONを差し替えるか、インポートで上書きできます（端末内のみ）。"]),
    el("div", {class:"row"}, [
      el("button", {class:"btn btn--muted", onClick: exportQuestions}, ["問題データを書き出す（JSON）"]),
      el("button", {class:"btn btn--muted", onClick: importQuestions}, ["問題データをインポート（JSON）"]),
      el("button", {class:"btn btn--danger", onClick: () => {
        if(confirm("カスタム問題データを解除して、同梱データに戻します。よろしいですか？")){
          localStorage.removeItem(CUSTOM_DATA_KEY);
          initData().then(renderHome);
        }
      }}, ["同梱データに戻す"])
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"h2"}, ["クラウド同期（単一ユーザー用）"]),
    el("div", {class:"small"}, [
      "Vercel Functions / Postgres に学習履歴（progress v3）を同期します。トークンで認証し、バージョンで衝突を検出します。"
    ]),
    el("div", {class:"cloud-grid"}, [
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["同期トークン（必須。入力はマスク表示）"]),
        tokenInput,
        el("label", {class:"small"}, [
          rememberToggle,
          " この端末にトークンを保存する（共有端末ではOFF推奨）"
        ])
      ]),
      el("div", {class:"cloud-grid__item"}, [
        el("div", {class:"small"}, ["APIベースURL（任意。省略時はこのサイトの /api を使用）"]),
        endpointInput
      ])
    ]),
    el("div", {class:"row"}, [
      btnSaveCloud,
      btnPull,
      btnPush,
      btnForce
    ]),
    cloudMessage,
    corruptMessage,
    cloudConflictNode,
    cloudMetaNode,
    el("div", {class:"small"}, [
      "同期するデータ: { state: progress v3 JSON, version, updatedAt } / API: GET・PUT /api/state"
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"small"}, [`現在の総問題数: ${st.total}`]),
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
  const payload = {
    appVersion: APP_VERSION,
    exportedAt: nowISO(),
    questionsCount: QUESTIONS.length,
    progress: loadProgress(),
    ongoingTest: loadOngoingTest()
  };
  downloadText(`neuro_progress_v${APP_VERSION}.json`, JSON.stringify(payload, null, 2));
}

function importProgress(){
  pickFile(".json", async (txt) => {
    try{
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
      saveProgress(incoming);
      alert("読み込みました。");
      renderHome();
    }catch(e){
      console.error(e);
      alert("JSONとして読み込めませんでした。フォーマットを確認してください。");
    }
  });
}

function exportQuestions(){
  const d = localStorage.getItem(CUSTOM_DATA_KEY) || JSON.stringify(DATA);
  downloadText(`neuro_questions_v${APP_VERSION}.json`, d);
}
function importQuestions(){
  pickFile(".json", async (txt) => {
    try{
      const obj = JSON.parse(txt);
      if(!obj.questions || !Array.isArray(obj.questions)) throw new Error("bad");
      localStorage.setItem(CUSTOM_DATA_KEY, JSON.stringify(obj));
      alert("問題データを上書きしました。");
      await initData();
      renderHome();
    }catch(e){
      alert("問題データとして読み込めませんでした。");
    }
  });
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

function loadCloudConfig(){
  const legacy = safeJsonParse(localStorage.getItem("neuroStudyCloudConfig_v1"), {});
  const cfg = safeJsonParse(localStorage.getItem(CLOUD_CONFIG_KEY), {}) || {};
  const rememberToken = cfg.rememberToken ?? !!(cfg.token || legacy.token);
  const sessionToken = safeJsonParse(sessionStorage.getItem(CLOUD_SESSION_TOKEN_KEY), "");
  const resolvedToken = rememberToken ? (cfg.token || legacy.token || "") : (sessionToken || cfg.token || legacy.token || "");
  return {
    apiBase: cfg.apiBase || legacy.url || "",
    token: resolvedToken,
    rememberToken
  };
}

function saveCloudConfig(cfg){
  const rememberToken = !!cfg.rememberToken;
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify({
    apiBase: cfg.apiBase || "",
    token: rememberToken ? (cfg.token || "") : "",
    rememberToken
  }));
  if(rememberToken){
    sessionStorage.removeItem(CLOUD_SESSION_TOKEN_KEY);
  }else{
    sessionStorage.setItem(CLOUD_SESSION_TOKEN_KEY, JSON.stringify(cfg.token || ""));
  }
}

function loadCloudStatus(){
  return safeJsonParse(localStorage.getItem(CLOUD_STATUS_KEY), {
    lastSyncedAt: null,
    lastRemoteVersion: null,
    lastRemoteUpdatedAt: null
  }) || {
    lastSyncedAt: null,
    lastRemoteVersion: null,
    lastRemoteUpdatedAt: null
  };
}

function saveCloudStatus(st){
  localStorage.setItem(CLOUD_STATUS_KEY, JSON.stringify(st || {}));
}

function buildApiUrl(cfg, path){
  const base = (cfg && cfg.apiBase) ? cfg.apiBase : "";
  try{
    if(base){
      return new URL(path, base).toString();
    }
  }catch(e){
    // fallback
  }
  return path;
}

class CloudConflictError extends Error{
  constructor(payload){
    super("クラウドデータが別の端末で更新されています。");
    this.payload = payload;
  }
}

async function fetchCloudState(cfg){
  const url = buildApiUrl(cfg, "/api/state");
  const headers = {
    "Accept": "application/json",
    ...(cfg.token ? {Authorization: `Bearer ${cfg.token}`} : {})
  };
  const res = await fetch(url, {headers, cache:"no-store"});
  if(res.status === 401 || res.status === 403){
    throw new Error("認証に失敗しました。同期トークンを確認してください。");
  }
  if(!res.ok){
    throw new Error(`クラウド取得に失敗しました (HTTP ${res.status})`);
  }
  const json = await res.json();
  return {
    state: json.state || null,
    version: json.version ?? null,
    updatedAt: json.updatedAt || null
  };
}

async function pushCloudState(cfg, meta, options={}){
  const url = buildApiUrl(cfg, "/api/state");
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(cfg.token ? {Authorization: `Bearer ${cfg.token}`} : {})
  };
  const progress = loadProgress();
  const selectedBase = options.force ? (options.baseVersion ?? meta.lastRemoteVersion ?? null) : (meta.lastRemoteVersion ?? null);
  const baseVersion = (selectedBase === null || selectedBase === undefined || Number.isNaN(Number(selectedBase))) ? null : Number(selectedBase);
  const body = {
    state: progress,
    baseVersion: baseVersion,
    force: !!options.force
  };
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
    cache:"no-store"
  });
  if(res.status === 401 || res.status === 403){
    throw new Error("認証に失敗しました。同期トークンを確認してください。");
  }
  if(res.status === 409){
    const payload = await res.json().catch(()=> ({}));
    throw new CloudConflictError(payload);
  }
  if(!res.ok){
    throw new Error(`クラウド保存に失敗しました (HTTP ${res.status})`);
  }
  const json = await res.json();
  return {
    version: json.version ?? null,
    updatedAt: json.updatedAt || nowISO(),
    state: json.state || progress
  };
}

/* -------- Mock result import -------- */
function applyImportedAttempt(parsed, graded, rawText, label){
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
  alert("直前のインポートを取り消しました。");
  renderHome();
}

function renderMockImport(){
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
    applyImportedAttempt(parsed, graded, parsed.raw, label);
    alert("学習履歴を更新しました。復習セット（模試ベース）から取り出せます。");
    renderHome();
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
function normalizeAnswer(arr){
  return (arr||[]).slice().sort().join("");
}
function isCorrect(q, selectedLetters){
  return normalizeAnswer(q.answer) === normalizeAnswer(selectedLetters);
}
function getSelectedFromForm(form, qtype){
  const selected = [];
  if(qtype === "single"){
    const v = form.querySelector("input[name='opt']:checked");
    if(v) selected.push(v.value);
  }else{
    form.querySelectorAll("input[name='opt']:checked").forEach(x => selected.push(x.value));
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
  const ids = buildReviewQueue(DAILY_REVIEW_LIMIT);
  if(ids.length === 0){
    alert("今日やるべき問題はありません。新しい問題を解きましょう！");
    return;
  }
  const session = {mode:"review", ids, idx:0, answers:{}, startAt: nowISO()};
  renderQuiz(session);
}

function startMockReview(count=20){
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
  const optType = q.type === "multi" ? "checkbox" : "radio";

  const prevSel = session.answers[q.id]?.selected || [];

  ["A","B","C","D","E"].forEach(k => {
    const checked = prevSel.includes(k);
    const inputId = `${q.id}_${k}`;
    form.appendChild(el("label", {class:"option", for: inputId}, [
      el("input", {type: optType, name:"opt", value:k, id: inputId, ...(checked?{checked:"checked"}:{})}),
      el("div", {class:"option__key"}, [k]),
      el("div", {class:"option__label"}, [q.options[k] || ""])
    ]));
  });

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

  function handleGrade(grade, meta){
    if(graded) return;
    graded = true;
    const p = loadProgress();
    const card = getOrCreateCard(p, q.id);
    applySpacedRepetition(card, grade);
    if(meta.reason || meta.note){
      logMistake(card, meta.reason, meta.note);
    }
    saveProgress(p);
    goNext();
  }

  function showResult(selected){
    const ok = isCorrect(q, selected);
    const p = loadProgress();
    const card = getOrCreateCard(p, q.id);
    incrementStats(card, ok);
    saveProgress(p);

    session.answers[q.id] = {selected, ok};

    const ansStr = q.answer.join("");
    const selStr = selected.join("");

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
    const controls = el("div", {class:"sr-controls"}, []);
    const reasonLabel = el("label", {class:"small"}, ["誤答理由（任意）"]);
    const reasonSel = el("select", {}, [el("option", {value:""}, ["選択してください"]), ...SR_REASON_OPTIONS.map(r=> el("option", {value:r}, [r]))]);
    if(!ok){ reasonSel.value = SR_REASON_OPTIONS[0]; }
    const noteInput = el("input", {type:"text", placeholder:"メモ（語呂合わせ/混同ポイントなど）"});

    controls.appendChild(reasonLabel);
    controls.appendChild(reasonSel);
    controls.appendChild(noteInput);

    const gradeRow = el("div", {class:"row grade-row"}, []);
    [
      {key:"again", label:"Again", cls:"btn--danger"},
      {key:"hard", label:"Hard", cls:"btn--muted"},
      {key:"good", label:"Good", cls:"btn--ok"},
      {key:"easy", label:"Easy", cls:"btn"}
    ].forEach(g => {
      const btn = el("button", {class:`btn ${g.cls} btn--sr`, type:"button", onClick: () => handleGrade(g.key, {reason: reasonSel.value || null, note: noteInput.value})}, [g.label]);
      if(!ok && g.key === "again") btn.classList.add("btn--primary");
      gradeRow.appendChild(btn);
    });
    controls.appendChild(el("div", {class:"small"}, ["※評価すると自動で次の問題へ進みます"]));
    controls.appendChild(gradeRow);

    const nextBtn = el("button", {class:"btn btn--muted", type:"button", onClick: goNext}, [session.idx < total-1 ? "次へ" : "ホームへ"]);

    resultBox.appendChild(el("div", {class:"hr"}, []));
    resultBox.appendChild(controls);
    resultBox.appendChild(el("div", {class:"hr"}, []));
    resultBox.appendChild(nextBtn);
  }

  const submitBtn = el("button", {class:"btn", type:"submit"}, ["採点する"]);
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
    const selected = getSelectedFromForm(form, q.type);
    session.answers[q.id] = {selected};
    showResult(selected);
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
function loadOngoingTest(){
  try{
    return JSON.parse(localStorage.getItem(ONGOING_TEST_KEY) || "null");
  }catch(e){ return null; }
}
function saveOngoingTest(t){
  localStorage.setItem(ONGOING_TEST_KEY, JSON.stringify(t));
}
function clearOngoingTest(){
  localStorage.removeItem(ONGOING_TEST_KEY);
}

function startMockTest(){
  const existing = loadOngoingTest();
  if(existing && existing.mode==="mock" && existing.ids && confirm("途中保存の模擬テストがあります。再開しますか？")){
    renderMock(existing);
    return;
  }
  const ids = QUESTIONS.map(q=>q.id); // 100問
  const test = {
    mode: "mock",
    ids,
    idx: 0,
    answers: {}, // id -> selected[]
    startedAt: Date.now(),
    durationSec: 90*60,
    finished: false
  };
  saveOngoingTest(test);
  renderMock(test);
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

function applyMockResults(results, reflectToSR){
  const p = loadProgress();
  results.forEach(r => {
    const card = getOrCreateCard(p, r.id);
    incrementStats(card, r.ok);
    if(reflectToSR){
      const grade = r.ok ? "good" : "again";
      applySpacedRepetition(card, grade);
    }
  });
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
  clearOngoingTest();

  const score = Math.round((correct/test.ids.length)*100);
  let reflectChecked = true;
  let applied = false;

  const reflectToggle = el("input", {type:"checkbox", checked:"checked"});
  reflectToggle.addEventListener("change", () => {
    reflectChecked = reflectToggle.checked;
  });

  const applyBtn = el("button", {class:"btn", onClick: () => {
    if(applied) return;
    applyMockResults(results, reflectChecked);
    applied = true;
    applyBtn.setAttribute("disabled", "disabled");
    applyBtn.textContent = "記録済み";
    alert(reflectChecked ? "模試結果を復習キューに反映しました。" : "正誤だけを進捗に記録しました。");
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
        el("div", {class:"small"}, [`あなた: ${(r.selected||[]).join("") || "(未選択)"} / 正解: ${(r.answer||[]).join("")}`]),
        q.explanation ? el("div", {class:"p"}, [q.explanation]) : el("div", {class:"small"}, ["（解説なし）"])
      ]);
    })
  ]);
  mount(stNode);
}

/* -------- Init -------- */
async function initData(){
  // custom override
  const custom = localStorage.getItem(CUSTOM_DATA_KEY);
  if(custom){
    try{ DATA = JSON.parse(custom); }catch(e){ DATA = null; }
  }
  if(!DATA){
    const dataUrl = new URL("./data/questions.json", location.href);
    const res = await fetch(dataUrl.toString(), {cache:"no-store"});
    DATA = await res.json();
  }
  QUESTIONS = DATA.questions || [];
  INDEX = {};
  ensureQuestionTags();
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

document.getElementById("navHome").addEventListener("click", renderHome);
document.getElementById("navStats").addEventListener("click", renderStats);
document.getElementById("navData").addEventListener("click", renderData);
document.getElementById("navImport").addEventListener("click", renderMockImport);

initData().then(() => {
  loadProgress(); // ensure migration
  renderHome();
  registerSW();
});
