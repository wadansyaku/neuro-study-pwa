import { sql } from "@vercel/postgres";
import { timingSafeEqual } from "crypto";

const ROW_ID = "default";
let didEnsureTable = false;

function parseAllowedOrigins(){
  const raw = process.env.SYNC_ALLOWED_ORIGINS || "";
  return raw.split(",").map(v => v.trim()).filter(Boolean);
}

function resolveCorsOrigin(req){
  const origin = req.headers?.origin;
  if(!origin) return "*";
  const allowed = parseAllowedOrigins();
  if(allowed.length === 0){
    try{
      const originUrl = new URL(origin);
      const host = req.headers?.host;
      if(host && originUrl.host === host){
        return origin;
      }
    }catch(e){
      return "null";
    }
    return "null";
  }
  return allowed.includes(origin) ? origin : "null";
}

function setCors(req, res){
  res.setHeader("Access-Control-Allow-Origin", resolveCorsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

function sendJson(req, res, status, payload){
  setCors(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function normalizeVersion(v){
  if(v === null || v === undefined) return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

async function readJsonBody(req){
  const chunks = [];
  for await (const chunk of req){
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if(!raw) return {};
  return JSON.parse(raw);
}

function extractToken(req){
  const header = (req.headers?.authorization || "").trim();
  if(!header) return "";
  if(header.toLowerCase().startsWith("bearer ")){
    return header.slice(7).trim();
  }
  return header;
}

async function ensureTable(){
  await sql`CREATE TABLE IF NOT EXISTS user_state (
    id text PRIMARY KEY,
    state_json jsonb,
    version bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  );`;
}

async function ensureTableOnce(){
  if(didEnsureTable) return;
  await ensureTable();
  didEnsureTable = true;
}

async function fetchCurrentState(){
  const {rows} = await sql`SELECT state_json, version, updated_at FROM user_state WHERE id = ${ROW_ID} LIMIT 1;`;
  const row = rows[0];
  if(!row) return null;
  return {
    state: row.state_json,
    version: normalizeVersion(row.version),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null
  };
}

async function saveState(state, baseVersion){
  const nextVersion = (baseVersion ?? 0) + 1;
  await sql`INSERT INTO user_state (id, state_json, version)
    VALUES (${ROW_ID}, ${state}, ${nextVersion})
    ON CONFLICT (id)
    DO UPDATE SET state_json = EXCLUDED.state_json, version = EXCLUDED.version, updated_at = now();`;
  return {
    version: nextVersion,
    updatedAt: new Date().toISOString()
  };
}

async function insertInitialState(state){
  const {rows} = await sql`INSERT INTO user_state (id, state_json, version)
    VALUES (${ROW_ID}, ${state}, 1)
    ON CONFLICT (id)
    DO NOTHING
    RETURNING version, updated_at;`;
  const row = rows[0];
  if(!row) return null;
  return {
    version: normalizeVersion(row.version),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : new Date().toISOString()
  };
}

async function updateStateIfVersionMatch(state, baseVersion){
  if(baseVersion === null || baseVersion === undefined) return null;
  const {rows} = await sql`UPDATE user_state
    SET state_json = ${state}, version = version + 1, updated_at = now()
    WHERE id = ${ROW_ID} AND version = ${baseVersion}
    RETURNING version, updated_at;`;
  const row = rows[0];
  if(!row) return null;
  return {
    version: normalizeVersion(row.version),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : new Date().toISOString()
  };
}

function isTokenValid(incoming, expected){
  if(!incoming || !expected) return false;
  const incomingBuf = Buffer.from(incoming);
  const expectedBuf = Buffer.from(expected);
  if(incomingBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(incomingBuf, expectedBuf);
}

export default async function handler(req, res){
  setCors(req, res);
  if(req.method === "OPTIONS"){
    res.statusCode = 200;
    res.end();
    return;
  }
  if(req.method !== "GET" && req.method !== "PUT"){
    return sendJson(req, res, 405, {error: "Method Not Allowed"});
  }
  if(!process.env.SYNC_TOKEN){
    return sendJson(req, res, 500, {error: "SYNC_TOKEN is not configured"});
  }
  const incomingToken = extractToken(req);
  if(!isTokenValid(incomingToken, process.env.SYNC_TOKEN)){
    return sendJson(req, res, 401, {error: "Unauthorized"});
  }

  try{
    await ensureTableOnce();
    if(req.method === "GET"){
      const current = await fetchCurrentState();
      return sendJson(req, res, 200, current || {state:null, version:null, updatedAt:null});
    }

    // PUT
    let body = {};
    try{
      body = await readJsonBody(req);
    }catch(e){
      return sendJson(req, res, 400, {error: "Invalid JSON body"});
    }
    const state = body.state;
    const baseVersion = normalizeVersion(body.baseVersion);
    const force = !!body.force;
    if(!state || typeof state !== "object" || Array.isArray(state)){
      return sendJson(req, res, 400, {error: "state must be a JSON object"});
    }

    const existing = await fetchCurrentState();
    const currentVersion = existing ? existing.version : null;
    if(force){
      const result = await saveState(state, currentVersion);
      return sendJson(req, res, 200, {...result, state});
    }

    if(existing){
      if(baseVersion === null || baseVersion !== currentVersion){
        return sendJson(req, res, 409, existing);
      }
      const updated = await updateStateIfVersionMatch(state, baseVersion);
      if(!updated){
        const latest = await fetchCurrentState();
        return sendJson(req, res, 409, latest || {state:null, version:null, updatedAt:null});
      }
      return sendJson(req, res, 200, {...updated, state});
    }

    if(baseVersion !== null && baseVersion !== 0){
      return sendJson(req, res, 409, {state:null, version:null, updatedAt:null});
    }
    const inserted = await insertInitialState(state);
    if(inserted){
      return sendJson(req, res, 200, {...inserted, state});
    }
    const updated = await updateStateIfVersionMatch(state, baseVersion ?? 0);
    if(updated){
      return sendJson(req, res, 200, {...updated, state});
    }
    const latest = await fetchCurrentState();
    return sendJson(req, res, 409, latest || {state:null, version:null, updatedAt:null});
  }catch(err){
    console.error(err);
    if(res.writableEnded) return;
    return sendJson(req, res, 500, {error: "Internal Server Error"});
  }
}
