import { timingSafeEqual } from "crypto";
import { sql } from "./db.js";

const DEFAULT_USER_ID = "default";

function extractToken(req){
  const header = (req.headers?.authorization || "").trim();
  if(!header) return "";
  if(header.toLowerCase().startsWith("bearer ")){
    return header.slice(7).trim();
  }
  return header;
}

function isTokenValid(incoming, expected){
  if(!incoming || !expected) return false;
  const incomingBuf = Buffer.from(incoming);
  const expectedBuf = Buffer.from(expected);
  if(incomingBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(incomingBuf, expectedBuf);
}

function normalizeUserId(raw){
  if(!raw) return DEFAULT_USER_ID;
  const trimmed = String(raw).trim();
  if(!trimmed) return DEFAULT_USER_ID;
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function extractUserId(req){
  try{
    const url = new URL(req.url, `http://${req.headers?.host || "localhost"}`);
    const queryUser = url.searchParams.get("user");
    if(queryUser) return normalizeUserId(queryUser);
  }catch(e){
    // fallthrough
  }
  const headerUser = req.headers?.["x-user-id"];
  if(headerUser) return normalizeUserId(headerUser);
  return DEFAULT_USER_ID;
}

async function ensureAppUser(userId){
  await sql`INSERT INTO app_user (id) VALUES (${userId}) ON CONFLICT (id) DO NOTHING;`;
}

async function authenticate(req){
  if(!process.env.SYNC_TOKEN){
    const error = new Error("SYNC_TOKEN is not configured");
    error.status = 500;
    throw error;
  }
  const incomingToken = extractToken(req);
  if(!isTokenValid(incomingToken, process.env.SYNC_TOKEN)){
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
  const userId = extractUserId(req);
  if(!userId){
    const error = new Error("Invalid user id");
    error.status = 400;
    throw error;
  }
  await ensureAppUser(userId);
  return {userId};
}

export {authenticate, normalizeUserId};
