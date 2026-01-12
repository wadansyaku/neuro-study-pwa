import { authenticate } from "../_lib/auth.js";
import { sql } from "../_lib/db.js";
import { handleOptions, sendJson } from "../_lib/cors.js";

function toMs(value){
  return value ? new Date(value).getTime() : null;
}

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
    const {rows} = await sql`
      SELECT p.*, q.external_id
      FROM progress_cards p
      JOIN questions q ON q.id = p.question_id
      WHERE p.user_id = ${userId}
        AND p.deck_id = ${deckId};
    `;
    const cards = {};
    rows.forEach(row => {
      cards[row.external_id] = {
        seen: row.seen,
        correct: row.correct,
        wrong: row.wrong,
        lastSeenAt: toMs(row.last_seen_at),
        lastAnsweredAt: toMs(row.last_answered_at),
        lastImportedAt: toMs(row.last_imported_at),
        sr: {
          dueAt: toMs(row.sr_due_at),
          intervalDays: row.sr_interval_days,
          ease: row.sr_ease,
          reps: row.sr_reps,
          lapses: row.sr_lapses,
          lastGrade: row.sr_last_grade
        },
        mistake: {
          lastReason: row.mistake_last_reason,
          reasonCounts: row.mistake_reason_counts || {},
          lastNote: row.mistake_last_note
        }
      };
    });
    const progress = {
      version: 3,
      updatedAt: Date.now(),
      cards,
      sessions: {},
      mockTest: {},
      attemptHistory: [],
      lastImportUndo: null
    };
    return sendJson(req, res, 200, {progress});
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
