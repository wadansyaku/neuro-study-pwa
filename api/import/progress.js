import { authenticate } from "../_lib/auth.js";
import { createClient, sql } from "../_lib/db.js";
import { handleOptions, sendJson } from "../_lib/cors.js";
import { readJsonBody, requireString } from "../_lib/validate.js";

function toDate(ms){
  if(ms === null || ms === undefined) return null;
  const num = Number(ms);
  if(!Number.isFinite(num)) return null;
  return new Date(num);
}

function ensureObject(value){
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export default async function handler(req, res){
  if(req.method === "OPTIONS"){
    handleOptions(req, res);
    return;
  }
  if(req.method !== "POST"){
    return sendJson(req, res, 405, {error: "Method Not Allowed"});
  }
  try{
    const {userId} = await authenticate(req);
    let body = {};
    try{
      body = await readJsonBody(req);
    }catch(e){
      return sendJson(req, res, 400, {error: "Invalid JSON body"});
    }
    const deckId = requireString(body.deckId, "deckId");
    const reset = body.reset === true;
    const progress = body.progress;
    const cards = progress && typeof progress === "object" ? progress.cards || {} : {};

    const client = createClient();
    await client.connect();
    try{
      await client.query("BEGIN");
      if(reset){
        await client.query(
          "DELETE FROM progress_cards WHERE user_id = $1 AND deck_id = $2",
          [userId, deckId]
        );
        await client.query(
          "DELETE FROM attempts WHERE user_id = $1 AND deck_id = $2",
          [userId, deckId]
        );
      }
      const questionRes = await client.query(
        "SELECT id, external_id FROM questions WHERE deck_id = $1",
        [deckId]
      );
      const questionMap = new Map(questionRes.rows.map(row => [row.external_id, row.id]));
      let imported = 0;
      for(const [externalId, rawCard] of Object.entries(cards || {})){
        const questionId = questionMap.get(externalId);
        if(!questionId) continue;
        const card = ensureObject(rawCard);
        const sr = ensureObject(card.sr);
        const mistake = ensureObject(card.mistake);
        await client.query(
          `INSERT INTO progress_cards (
              user_id, question_id, deck_id, seen, correct, wrong,
              last_seen_at, last_answered_at, last_imported_at,
              sr_due_at, sr_interval_days, sr_ease, sr_reps, sr_lapses, sr_last_grade,
              mistake_last_reason, mistake_reason_counts, mistake_last_note, updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
            ON CONFLICT (user_id, question_id)
            DO UPDATE SET
              seen = EXCLUDED.seen,
              correct = EXCLUDED.correct,
              wrong = EXCLUDED.wrong,
              last_seen_at = EXCLUDED.last_seen_at,
              last_answered_at = EXCLUDED.last_answered_at,
              last_imported_at = EXCLUDED.last_imported_at,
              sr_due_at = EXCLUDED.sr_due_at,
              sr_interval_days = EXCLUDED.sr_interval_days,
              sr_ease = EXCLUDED.sr_ease,
              sr_reps = EXCLUDED.sr_reps,
              sr_lapses = EXCLUDED.sr_lapses,
              sr_last_grade = EXCLUDED.sr_last_grade,
              mistake_last_reason = EXCLUDED.mistake_last_reason,
              mistake_reason_counts = EXCLUDED.mistake_reason_counts,
              mistake_last_note = EXCLUDED.mistake_last_note,
              updated_at = now()`,
          [
            userId,
            questionId,
            deckId,
            Number(card.seen || 0),
            Number(card.correct || 0),
            Number(card.wrong || 0),
            toDate(card.lastSeenAt),
            toDate(card.lastAnsweredAt),
            new Date(),
            toDate(sr.dueAt) || new Date(),
            Number(sr.intervalDays || 0),
            Number(sr.ease || 2.5),
            Number(sr.reps || 0),
            Number(sr.lapses || 0),
            sr.lastGrade || null,
            mistake.lastReason || null,
            mistake.reasonCounts || {},
            mistake.lastNote || null
          ]
        );
        imported += 1;
      }
      await client.query("COMMIT");
      return sendJson(req, res, 200, {ok: true, imported});
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{
      await client.end();
    }
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
