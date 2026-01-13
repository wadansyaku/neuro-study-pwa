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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Id");
  res.setHeader("Vary", "Origin");
}

function sendJson(req, res, status, payload){
  setCors(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function handleOptions(req, res){
  setCors(req, res);
  res.statusCode = 200;
  res.end();
}

export {setCors, sendJson, handleOptions};
