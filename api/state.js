import { sql } from "@vercel/postgres";

const ROW_ID = "default";

function setCors(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res, status, payload){
  setCors(res);
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

export default async function handler(req, res){
  setCors(res);
  if(req.method === "OPTIONS"){
    res.statusCode = 200;
    res.end();
    return;
  }
  if(req.method !== "GET" && req.method !== "PUT"){
    return sendJson(res, 405, {error: "Method Not Allowed"});
  }
  if(!process.env.SYNC_TOKEN){
    return sendJson(res, 500, {error: "SYNC_TOKEN is not configured"});
  }
  const incomingToken = extractToken(req);
  if(incomingToken !== process.env.SYNC_TOKEN){
    return sendJson(res, 401, {error: "Unauthorized"});
  }

  try{
    await ensureTable();
    if(req.method === "GET"){
      const current = await fetchCurrentState();
      return sendJson(res, 200, current || {state:null, version:null, updatedAt:null});
    }

    // PUT
    let body = {};
    try{
      body = await readJsonBody(req);
    }catch(e){
      return sendJson(res, 400, {error: "Invalid JSON body"});
    }
    const state = body.state;
    const baseVersion = normalizeVersion(body.baseVersion);
    const force = !!body.force;
    if(!state || typeof state !== "object" || Array.isArray(state)){
      return sendJson(res, 400, {error: "state must be a JSON object"});
    }

    const existing = await fetchCurrentState();
    const currentVersion = existing ? existing.version : null;
    if(existing && !force){
      if(baseVersion === null || baseVersion !== currentVersion){
        return sendJson(res, 409, existing);
      }
    }

    const result = await saveState(state, currentVersion);
    return sendJson(res, 200, {...result, state});
  }catch(err){
    console.error(err);
    if(res.writableEnded) return;
    return sendJson(res, 500, {error: "Internal Server Error"});
  }
}
