import { authenticate } from "./_lib/auth.js";
import { sql } from "./_lib/db.js";
import { handleOptions, sendJson } from "./_lib/cors.js";
import { readJsonBody } from "./_lib/validate.js";

function normalizeKey(raw){
  if(typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if(!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

export default async function handler(req, res){
  if(req.method === "OPTIONS"){
    handleOptions(req, res);
    return;
  }
  if(req.method !== "GET" && req.method !== "POST"){
    return sendJson(req, res, 405, {error: "Method Not Allowed"});
  }
  try{
    const {userId} = await authenticate(req);
    if(req.method === "GET"){
      const url = new URL(req.url, `http://${req.headers?.host || "localhost"}`);
      const key = normalizeKey(url.searchParams.get("key"));
      if(!key){
        return sendJson(req, res, 400, {error: "key is required"});
      }
      const {rows} = await sql`
        SELECT 1 FROM user_migrations WHERE user_id = ${userId} AND key = ${key} LIMIT 1;
      `;
      return sendJson(req, res, 200, {key, exists: rows.length > 0});
    }

    const body = await readJsonBody(req);
    const key = normalizeKey(body?.key);
    if(!key){
      return sendJson(req, res, 400, {error: "key is required"});
    }
    await sql`
      INSERT INTO user_migrations (user_id, key)
      VALUES (${userId}, ${key})
      ON CONFLICT (user_id, key) DO NOTHING;
    `;
    return sendJson(req, res, 200, {key, exists: true});
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
