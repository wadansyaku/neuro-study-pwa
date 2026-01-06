/* 神経解剖学 学習Webアプリ - Vanilla JS / Offline-first */

const APP_VERSION = 2;
const STORAGE_KEY = "neuroStudyProgress_v1";
const ONGOING_TEST_KEY = "neuroStudyOngoingTest_v1";
const CUSTOM_DATA_KEY = "neuroStudyCustomData_v1"; // optional override
const CLOUD_CONFIG_KEY = "neuroStudyCloudConfig_v1"; // optional endpoint/token

let DATA = null; // {version, source, questions}
let QUESTIONS = []; // array of question objects
let INDEX = {}; // id -> question

function nowISO(){ return new Date().toISOString(); }
function loadProgress(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  }catch(e){ return {}; }
}
function saveProgress(p){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}
function resetProgress(){
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ONGOING_TEST_KEY);
}
function getStats(){
  const p = loadProgress();
  let attempted = 0, correct = 0, wrong = 0;
  for(const [id, v] of Object.entries(p)){
    attempted += (v.attempts || 0) > 0 ? 1 : 0;
    correct += (v.correct || 0);
    wrong += (v.wrong || 0);
  }
  const total = QUESTIONS.length;
  const acc = (correct + wrong) ? (correct/(correct+wrong)) : 0;
  return {total, attempted, correct, wrong, acc};
}

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
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

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

function renderHome(){
  const st = getStats();
  const progressPct = st.total ? Math.round((st.attempted/st.total)*100) : 0;

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

  const btns = el("div", {class:"row"}, [
    el("button", {class:"btn", onClick: () => startPractice({count:10})}, ["クイック練習（10問）"]),
    el("button", {class:"btn", onClick: () => startPractice({count:10, prioritizeUnlearned:true})}, ["未学習優先（10問）"]),
    el("button", {class:"btn btn--muted", onClick: () => renderTopicSelect()}, ["トピック/タグで練習"]),
    el("button", {class:"btn", onClick: () => startMockTest()}, ["模擬テスト（90分・100問）"]),
    el("button", {class:"btn btn--muted", onClick: () => startWeakReview()}, ["弱点復習（間違い優先）"]),
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
    btns,
    info
  ]));
}

function renderStats(){
  const st = getStats();
  const p = loadProgress();

  // Top wrong questions
  const worst = Object.entries(p)
    .map(([id,v]) => ({id, wrong:(v.wrong||0), correct:(v.correct||0), attempts:(v.attempts||0)}))
    .filter(x => x.attempts>0)
    .sort((a,b) => (b.wrong - a.wrong) || (a.correct - b.correct))
    .slice(0, 10);

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
    el("div", {class:"h2"}, ["間違いが多い問題（上位10）"]),
    worstList,
  ]));
}

function renderData(){
  const st = getStats();
  const cfg = loadCloudConfig();
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
    el("div", {class:"h2"}, ["クラウド連携（ChatGPT/Codex向け）"]),
    el("div", {class:"small"}, [
      "クラウドの受け口URLを設定すると、学習履歴と統計をJSONでPOST送信できます。ChatGPT/Codexには保存先URL（例: 署名付きURL）を渡してください。"
    ]),
    el("div", {class:"row"}, [
      el("input", {type:"url", placeholder:"https://example.com/upload", value: cfg.url, onChange: (e) => {
        cfg.url = e.target.value;
      }}),
      el("input", {type:"text", placeholder:"Authorizationヘッダー（任意）", value: cfg.token || "", onChange: (e) => {
        cfg.token = e.target.value;
      }}),
      el("button", {class:"btn btn--muted", onClick: () => {
        saveCloudConfig(cfg);
        alert("クラウド設定を保存しました。");
      }}, ["設定を保存"]),
      el("button", {class:"btn", onClick: (e) => syncToCloud(e.target)}, ["クラウドにアップロード"])
    ]),
    el("div", {class:"small"}, [
      "送信データ: { appVersion, exportedAt, questionsCount, stats, progress }"
    ]),
    el("div", {class:"hr"}, []),
    el("div", {class:"small"}, [`現在の総問題数: ${st.total}`]),
  ]);
  mount(node);
}

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
  const p = localStorage.getItem(STORAGE_KEY) || "{}";
  downloadText(`neuro_progress_v${APP_VERSION}.json`, p);
}
function importProgress(){
  pickFile(".json", async (txt) => {
    try{
      const obj = JSON.parse(txt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      alert("読み込みました。");
      renderHome();
    }catch(e){
      alert("JSONとして読み込めませんでした。");
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
  try{
    const cfg = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || "{}");
    return {
      url: cfg.url || "",
      token: cfg.token || ""
    };
  }catch(e){
    return {url:"", token:""};
  }
}

function saveCloudConfig(cfg){
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify({
    url: cfg.url || "",
    token: cfg.token || ""
  }));
}

async function syncToCloud(btn){
  const cfg = loadCloudConfig();
  if(!cfg.url){
    alert("クラウドのURLを設定してください。");
    return;
  }
  const payload = {
    appVersion: APP_VERSION,
    exportedAt: nowISO(),
    questionsCount: QUESTIONS.length,
    stats: getStats(),
    progress: loadProgress()
  };
  if(btn){
    btn.setAttribute("disabled", "disabled");
    btn.textContent = "アップロード中…";
  }
  try{
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.token ? {Authorization: cfg.token} : {})
      },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    alert("アップロードしました。ChatGPT/Codexに保存先URLやIDを共有してください。");
  }catch(e){
    console.error(e);
    alert("アップロードに失敗しました: " + e.message);
  }finally{
    if(btn){
      btn.removeAttribute("disabled");
      btn.textContent = "クラウドにアップロード";
    }
  }
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

function updateProgressForQuestion(id, correct){
  const p = loadProgress();
  if(!p[id]) p[id] = {attempts:0, correct:0, wrong:0, lastAttempt:null};
  p[id].attempts += 1;
  if(correct) p[id].correct += 1;
  else p[id].wrong += 1;
  p[id].lastAttempt = nowISO();
  saveProgress(p);
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
      const attempts = progress[q.id]?.attempts || 0;
      if(attempts === 0) unattempted.push(q);
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

function startWeakReview(){
  const p = loadProgress();
  const scored = QUESTIONS.map(q => {
    const v = p[q.id] || {};
    const wrong = v.wrong || 0;
    const correct = v.correct || 0;
    const attempts = v.attempts || 0;
    const score = wrong - correct*0.25 + (attempts===0 ? -0.5 : 0); // prioritize wrong, slightly penalize never-seen
    return {id:q.id, score, wrong, correct, attempts};
  }).sort((a,b)=> b.score - a.score);
  const ids = scored.slice(0, 10).map(x=>x.id);
  startPractice({ids});
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
  function showResult(selected){
    const ok = isCorrect(q, selected);
    updateProgressForQuestion(q.id, ok);

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
    const nextBtn = el("button", {class:"btn", type:"button", onClick: ()=> {
      if(session.idx < total-1){
        session.idx += 1;
        renderQuiz(session);
      }else{
        renderHome();
      }
    }}, [session.idx < total-1 ? "次へ" : "ホームへ"]);
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

  const body = [
    header,
    prog,
    el("div", {class:"hr"}, []),
    el("div", {class:"p"}, [q.stem]),
    form,
    resultBox,
  ];
  mount(viewCard("クイズ（練習）", body));
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
    updateProgressForQuestion(id, ok);
  }
  clearOngoingTest();

  const score = Math.round((correct/test.ids.length)*100);
  const stNode = viewCard("模擬テスト結果", [
    el("div", {class:"p"}, [
      `正解数: ${correct}/${test.ids.length}\n得点（%）: ${score}%`
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
    const res = await fetch("data/questions.json", {cache:"no-store"});
    DATA = await res.json();
  }
  QUESTIONS = DATA.questions || [];
  INDEX = {};
  QUESTIONS.forEach(q => { INDEX[q.id] = q; });
}

async function registerSW(){
  const elStatus = document.getElementById("swStatus");
  if(!("serviceWorker" in navigator)){
    elStatus.textContent = "（Service Worker非対応）";
    return;
  }
  try{
    await navigator.serviceWorker.register("./sw.js");
    elStatus.textContent = "（オフライン対応OK）";
  }catch(e){
    elStatus.textContent = "（オフライン対応: 未設定）";
  }
}

document.getElementById("navHome").addEventListener("click", renderHome);
document.getElementById("navStats").addEventListener("click", renderStats);
document.getElementById("navData").addEventListener("click", renderData);

initData().then(() => {
  renderHome();
  registerSW();
});
