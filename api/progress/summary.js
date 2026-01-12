import { authenticate } from "../_lib/auth.js";
import { sql } from "../_lib/db.js";
import { handleOptions, sendJson } from "../_lib/cors.js";

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
    const totalRes = await sql`
      SELECT COUNT(*)::int AS total
      FROM questions
      WHERE deck_id = ${deckId};
    `;
    const progressRes = await sql`
      SELECT
        COUNT(*) FILTER (WHERE seen > 0)::int AS attempted,
        COALESCE(SUM(correct), 0)::int AS correct,
        COALESCE(SUM(wrong), 0)::int AS wrong
      FROM progress_cards
      WHERE user_id = ${userId}
        AND deck_id = ${deckId};
    `;
    const worstRes = await sql`
      SELECT q.external_id AS question_id, p.wrong, p.correct
      FROM progress_cards p
      JOIN questions q ON q.id = p.question_id
      WHERE p.user_id = ${userId}
        AND p.deck_id = ${deckId}
        AND p.seen > 0
      ORDER BY p.wrong DESC, p.correct ASC
      LIMIT 10;
    `;
    const tagRes = await sql`
      SELECT q.tag,
        COUNT(*) FILTER (WHERE p.sr_due_at <= now())::int AS due,
        COUNT(*)::int AS attempted
      FROM progress_cards p
      JOIN questions q ON q.id = p.question_id
      WHERE p.user_id = ${userId}
        AND p.deck_id = ${deckId}
      GROUP BY q.tag
      ORDER BY due DESC, attempted DESC;
    `;
    const reasonRes = await sql`
      SELECT key, SUM(value::int)::int AS count
      FROM progress_cards,
        jsonb_each_text(COALESCE(mistake_reason_counts, '{}'::jsonb))
      WHERE user_id = ${userId}
        AND deck_id = ${deckId}
      GROUP BY key
      ORDER BY count DESC;
    `;
    const total = totalRes.rows[0]?.total || 0;
    const attempted = progressRes.rows[0]?.attempted || 0;
    const correct = progressRes.rows[0]?.correct || 0;
    const wrong = progressRes.rows[0]?.wrong || 0;
    const acc = correct + wrong > 0 ? correct / (correct + wrong) : 0;
    return sendJson(req, res, 200, {
      total,
      attempted,
      correct,
      wrong,
      acc,
      worst: worstRes.rows.map(row => ({
        id: row.question_id,
        wrong: row.wrong,
        correct: row.correct
      })),
      tagStats: tagRes.rows.map(row => ({
        tag: row.tag || "その他",
        due: row.due,
        attempted: row.attempted
      })),
      reasonStats: reasonRes.rows.map(row => ({
        reason: row.key,
        count: row.count
      }))
    });
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
