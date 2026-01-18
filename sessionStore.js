const SESSION_KEY = "neuroStudySession_v1";
const DEFAULT_SESSION = {
  apiBase: "",
  apiToken: "",
  userId: ""
};

let SESSION_CACHE = null;

function normalizeUserId(raw){
  const trimmed = (raw || "").trim();
  if(!trimmed) return "";
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeSession(raw){
  const next = {...DEFAULT_SESSION};
  if(raw && typeof raw === "object"){
    next.apiBase = typeof raw.apiBase === "string" ? raw.apiBase.trim() : "";
    next.apiToken = typeof raw.apiToken === "string" ? raw.apiToken.trim() : "";
    if(typeof raw.token === "string" && !next.apiToken){
      next.apiToken = raw.token.trim();
    }
    const normalizedUserId = normalizeUserId(raw.userId);
    if(normalizedUserId === null){
      return null;
    }
    next.userId = normalizedUserId || "";
  }
  return next;
}

function canUseSessionStorage(){
  try{
    return typeof sessionStorage !== "undefined";
  }catch(e){
    return false;
  }
}

function loadSession(){
  if(SESSION_CACHE){
    return SESSION_CACHE;
  }
  if(!canUseSessionStorage()){
    SESSION_CACHE = {...DEFAULT_SESSION};
    return SESSION_CACHE;
  }
  const raw = sessionStorage.getItem(SESSION_KEY);
  if(!raw){
    SESSION_CACHE = {...DEFAULT_SESSION};
    return SESSION_CACHE;
  }
  try{
    const parsed = JSON.parse(raw);
    const normalized = normalizeSession(parsed);
    SESSION_CACHE = normalized || {...DEFAULT_SESSION};
    return SESSION_CACHE;
  }catch(e){
    SESSION_CACHE = {...DEFAULT_SESSION};
    return SESSION_CACHE;
  }
}

function saveSession(session){
  const normalized = normalizeSession(session);
  if(!normalized){
    throw new Error("ユーザーIDは英数字・-・_のみ、64文字以内にしてください。");
  }
  SESSION_CACHE = normalized;
  if(!canUseSessionStorage()){
    return normalized;
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  return normalized;
}

function clearSession(){
  SESSION_CACHE = {...DEFAULT_SESSION};
  if(!canUseSessionStorage()) return;
  sessionStorage.removeItem(SESSION_KEY);
}

function hasSession(){
  const session = loadSession();
  return !!session.apiToken;
}

export {
  loadSession,
  saveSession,
  clearSession,
  hasSession,
  normalizeSession,
  normalizeUserId
};
