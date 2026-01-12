import { sql } from "@vercel/postgres";

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
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res){
  setCors(req, res);
  if(req.method === "OPTIONS"){
    res.statusCode = 200;
    res.end();
    return;
  }
  let dbOk = false;
  try{
    await sql`SELECT 1;`;
    dbOk = true;
  }catch(error){
    dbOk = false;
  }
  res.statusCode = dbOk ? 200 : 500;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ok: dbOk, timestamp: new Date().toISOString()}));
}
