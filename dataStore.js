import { loadSession } from "./sessionStore.js";

function buildApiUrl(session, path){
  const base = session.apiBase ? session.apiBase.replace(/\/$/, "") : "";
  let resolved = path;
  try{
    if(base){
      resolved = new URL(path, base).toString();
    }
  }catch(e){
    // fallback
  }
  const userId = session.userId;
  if(userId){
    try{
      const withUser = new URL(resolved, location.href);
      withUser.searchParams.set("user", userId);
      return withUser.toString();
    }catch(e){
      return resolved;
    }
  }
  return resolved;
}

function resolveApiPath(session, path){
  const base = session.apiBase ? session.apiBase.replace(/\/$/, "") : "";
  const needsApiPrefix = !(base && base.endsWith("/api"));
  return needsApiPrefix ? `/api${path}` : path;
}

function createCloudStore(){
  async function request(path, options = {}){
    const session = loadSession();
    if(!session.apiToken){
      throw new Error("ログインが必要です。APIトークンを入力してください。");
    }
    const apiPath = resolveApiPath(session, path);
    const url = buildApiUrl(session, apiPath);
    const headers = {
      "Accept": "application/json",
      ...(options.body ? {"Content-Type": "application/json"} : {}),
      ...(session.apiToken ? {Authorization: `Bearer ${session.apiToken}`} : {})
    };
    const res = await fetch(url, {
      ...options,
      headers,
      cache: "no-store"
    });
    if(res.status === 401 || res.status === 403){
      throw new Error("認証に失敗しました。APIトークンを確認してください。");
    }
    if(!res.ok){
      const message = await res.text().catch(() => "");
      throw new Error(`APIエラー (HTTP ${res.status}) ${message}`);
    }
    if(res.status === 204){
      return null;
    }
    return res.json();
  }

  async function init(){
    await request("/decks");
  }

  function getUser(){
    const session = loadSession();
    return {
      userId: session.userId || "default",
      apiBase: session.apiBase || "",
      isAuthenticated: !!session.apiToken
    };
  }

  async function getDecks(){
    const res = await request("/decks");
    return res.decks || [];
  }

  async function getQuestionsPaged(deckId){
    const items = [];
    let cursor = null;
    while(true){
      const params = new URLSearchParams({deckId, limit: "500"});
      if(cursor) params.set("cursor", String(cursor));
      const res = await request(`/questions?${params.toString()}`);
      const chunk = Array.isArray(res.items) ? res.items : [];
      items.push(...chunk);
      if(!res.nextCursor || chunk.length === 0) break;
      if(res.nextCursor === cursor) break;
      cursor = res.nextCursor;
    }
    return items;
  }

  async function exportProgress(deckId){
    return request(`/export/progress?deckId=${encodeURIComponent(deckId)}`);
  }

  async function getStats(deckId){
    return request(`/progress/summary?deckId=${encodeURIComponent(deckId)}`);
  }

  async function getDueItems(deckId, limit = 20){
    return request(`/review/today?deckId=${encodeURIComponent(deckId)}&limit=${limit}`);
  }

  async function importProgress({deckId, progress, reset}){
    return request("/import/progress", {
      method: "POST",
      body: JSON.stringify({deckId, progress, reset})
    });
  }

  async function recordAttempt(payload){
    return request("/attempts", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function recordAnswer(payload){
    return recordAttempt(payload);
  }

  async function importMockExam(payload){
    const deckId = payload?.deckId;
    if(!deckId){
      throw new Error("deckId is required");
    }
    return importProgress({deckId, progress: payload.progress});
  }

  async function exportUserData(deckId){
    return exportProgress(deckId);
  }

  async function getOngoingTest(deckId){
    return request(`/test-sessions?deckId=${encodeURIComponent(deckId)}`);
  }

  async function createTestSession({deckId, mode, size}){
    return request("/test-sessions", {
      method: "POST",
      body: JSON.stringify({deckId, mode, size})
    });
  }

  async function updateTestSession(payload){
    return request("/test-sessions", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async function getMigrationStatus(key){
    return request(`/migrations?key=${encodeURIComponent(key)}`);
  }

  async function setMigrationComplete(key){
    return request("/migrations", {
      method: "POST",
      body: JSON.stringify({key})
    });
  }

  return {
    init,
    getUser,
    getDecks,
    getQuestionsPaged,
    getStats,
    getDueItems,
    exportProgress,
    exportUserData,
    importProgress,
    recordAttempt,
    recordAnswer,
    importMockExam,
    getOngoingTest,
    createTestSession,
    updateTestSession,
    getMigrationStatus,
    setMigrationComplete
  };
}

export { createCloudStore };
