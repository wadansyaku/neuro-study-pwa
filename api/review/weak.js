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
    const {userId} = await authenticate(req);
    const url = new URL(req.url, `http://${req.headers?.host || "localhost"}`);
    const deckId = url.searchParams.get("deckId");
    if(!deckId){
      return sendJson(req, res, 400, {error: "deckId is required"});
    }
    const limit = parseLimit(url.searchParams.get("limit"), {fallback: 10, max: 200});

    const weakRows = await sql`
      SELECT q.id
      FROM progress_cards p
      JOIN questions q ON q.id = p.question_id
      WHERE p.user_id = ${userId}
        AND p.deck_id = ${deckId}
        AND p.seen > 0
      ORDER BY p.wrong DESC, p.sr_due_at ASC, p.correct ASC
      LIMIT ${limit};
    `;
    const ids = weakRows.rows.map(row => row.id);
    const remaining = limit - ids.length;
    if(remaining > 0){
      const freshRows = await sql`
        SELECT q.id
        FROM questions q
        LEFT JOIN progress_cards p
          ON p.question_id = q.id
          AND p.user_id = ${userId}
        WHERE q.deck_id = ${deckId}
          AND (p.question_id IS NULL OR p.seen = 0)
        ORDER BY q.id ASC
        LIMIT ${remaining};
      `;
      freshRows.rows.forEach(row => ids.push(row.id));
    }
    const items = await fetchQuestionsByIds(ids);
    return sendJson(req, res, 200, {items});
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
