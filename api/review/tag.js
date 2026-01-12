import { authenticate } from "../_lib/auth.js";
import { sql } from "../_lib/db.js";
import { handleOptions, sendJson } from "../_lib/cors.js";
import { parseLimit } from "../_lib/paging.js";
import { fetchQuestionsByIds } from "../_lib/questions.js";

export default async function handler(req, res){
  if(req.method === "OPTIONS"){
    handleOptions(req, res);
    return;
  }
  if(req.method !== "GET"){
    return sendJson(req, res, 405, {error: "Method Not Allowed"});
  }
  try{
    await authenticate(req);
    const url = new URL(req.url, `http://${req.headers?.host || "localhost"}`);
    const deckId = url.searchParams.get("deckId");
    const tag = url.searchParams.get("tag");
    if(!deckId || !tag){
      return sendJson(req, res, 400, {error: "deckId and tag are required"});
    }
    const limit = parseLimit(url.searchParams.get("limit"), {fallback: 10, max: 200});

    const rows = await sql`
      SELECT q.id
      FROM questions q
      WHERE q.deck_id = ${deckId}
        AND q.tag = ${tag}
      ORDER BY q.id ASC
      LIMIT ${limit};
    `;
    const ids = rows.rows.map(row => row.id);
    const items = await fetchQuestionsByIds(ids);
    return sendJson(req, res, 200, {items});
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
