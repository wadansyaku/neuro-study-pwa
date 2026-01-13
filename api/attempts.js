import { authenticate } from "./_lib/auth.js";
import { createClient, sql } from "./_lib/db.js";
import { handleOptions, sendJson } from "./_lib/cors.js";
import { applySpacedRepetition } from "./_lib/sr.js";
import { readJsonBody, requireString } from "./_lib/validate.js";

const GRADES = new Set(["again", "hard", "good", "easy"]);

function normalizeAnswer(arr){
  return (arr || []).slice().sort().join("");
}

function normalizeShortAnswer(input){
  return String(input ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[\s\u3000]+/g, "")
    .toLowerCase();
}

function isCorrectAnswer(question, chosenAnswers){
  if(question.type === "short"){
    const userInput = Array.isArray(chosenAnswers) ? chosenAnswers.join("") : chosenAnswers;
    const normalized = normalizeShortAnswer(userInput);
    return (question.answer_texts || []).some(ans => normalizeShortAnswer(ans) === normalized);
  }
  return normalizeAnswer(question.answer_keys || []) === normalizeAnswer(chosenAnswers || []);
}

function mapProgressRow(row){
  return {
    questionId: row.external_id,
    seen: row.seen,
    correct: row.correct,
    wrong: row.wrong,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    lastAnsweredAt: row.last_answered_at ? row.last_answered_at.toISOString() : null,
    lastImportedAt: row.last_imported_at ? row.last_imported_at.toISOString() : null,
    srDueAt: row.sr_due_at ? row.sr_due_at.toISOString() : null,
    srIntervalDays: row.sr_interval_days,
    srEase: row.sr_ease,
    srReps: row.sr_reps,
    srLapses: row.sr_lapses,
    srLastGrade: row.sr_last_grade,
    mistakeLastReason: row.mistake_last_reason,
    mistakeReasonCounts: row.mistake_reason_counts,
    mistakeLastNote: row.mistake_last_note,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null
  };
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
    const questionExternalId = requireString(body.questionId, "questionId");
    const grade = body.grade ? String(body.grade) : null;
    if(grade && !GRADES.has(grade)){
      return sendJson(req, res, 400, {error: "Invalid grade"});
    }
    const chosenAnswers = Array.isArray(body.chosenAnswers) ? body.chosenAnswers : [];
    const elapsedMs = body.elapsedMs ?? null;
    const reason = body.reason ? String(body.reason) : null;
    const note = body.note ? String(body.note) : null;
    const sessionId = body.sessionId ? String(body.sessionId) : null;
    const providedCorrect = typeof body.isCorrect === "boolean" ? body.isCorrect : null;

    const client = createClient();
    await client.connect();
    try{
      await client.query("BEGIN");
      const questionRes = await client.query(
        `SELECT id, external_id, type, answer_keys, answer_texts
         FROM questions
         WHERE deck_id = $1 AND external_id = $2
         LIMIT 1`,
        [deckId, questionExternalId]
      );
      const question = questionRes.rows[0];
      if(!question){
        await client.query("ROLLBACK");
        return sendJson(req, res, 404, {error: "Question not found"});
      }
      const isCorrect = providedCorrect ?? isCorrectAnswer(question, chosenAnswers);
      const now = new Date();
      const progressRes = await client.query(
        `SELECT seen, correct, wrong, sr_due_at, sr_interval_days, sr_ease, sr_reps, sr_lapses, sr_last_grade
         FROM progress_cards
         WHERE user_id = $1 AND question_id = $2
         LIMIT 1`,
        [userId, question.id]
      );
      const prev = progressRes.rows[0] || {
        seen: 0,
        correct: 0,
        wrong: 0,
        sr_due_at: now,
        sr_interval_days: 0,
        sr_ease: 2.5,
        sr_reps: 0,
        sr_lapses: 0,
        sr_last_grade: null
      };
      const nextSr = grade ? applySpacedRepetition({
        sr: {
          intervalDays: prev.sr_interval_days,
          ease: prev.sr_ease,
          reps: prev.sr_reps,
          lapses: prev.sr_lapses,
          dueAt: prev.sr_due_at ? new Date(prev.sr_due_at).getTime() : now.getTime(),
          lastGrade: prev.sr_last_grade
        },
        grade,
        now: now.getTime()
      }) : {
        intervalDays: prev.sr_interval_days,
        ease: prev.sr_ease,
        reps: prev.sr_reps,
        lapses: prev.sr_lapses,
        dueAt: prev.sr_due_at ? new Date(prev.sr_due_at).getTime() : now.getTime(),
        lastGrade: prev.sr_last_grade
      };

      const seen = (prev.seen || 0) + 1;
      const correct = (prev.correct || 0) + (isCorrect ? 1 : 0);
      const wrong = (prev.wrong || 0) + (isCorrect ? 0 : 1);

      await client.query(
        `INSERT INTO attempts (user_id, deck_id, question_id, session_id, is_correct, grade, chosen_answers, elapsed_ms, reason, note, answered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          userId,
          deckId,
          question.id,
          sessionId,
          isCorrect,
          grade,
          chosenAnswers,
          elapsedMs,
          reason,
          note,
          now
        ]
      );

      const updateRes = await client.query(
        `INSERT INTO progress_cards (
            user_id, question_id, deck_id, seen, correct, wrong,
            last_seen_at, last_answered_at, sr_due_at, sr_interval_days, sr_ease, sr_reps, sr_lapses, sr_last_grade,
            mistake_last_reason, mistake_reason_counts, mistake_last_note, updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,
            CASE WHEN $14 IS NULL THEN '{}'::jsonb ELSE jsonb_build_object($14, 1) END,
            $15,$7)
          ON CONFLICT (user_id, question_id)
          DO UPDATE SET
            seen = EXCLUDED.seen,
            correct = EXCLUDED.correct,
            wrong = EXCLUDED.wrong,
            last_seen_at = EXCLUDED.last_seen_at,
            last_answered_at = EXCLUDED.last_answered_at,
            sr_due_at = EXCLUDED.sr_due_at,
            sr_interval_days = EXCLUDED.sr_interval_days,
            sr_ease = EXCLUDED.sr_ease,
            sr_reps = EXCLUDED.sr_reps,
            sr_lapses = EXCLUDED.sr_lapses,
            sr_last_grade = EXCLUDED.sr_last_grade,
            mistake_last_reason = COALESCE($14, progress_cards.mistake_last_reason),
            mistake_last_note = COALESCE($15, progress_cards.mistake_last_note),
            mistake_reason_counts = CASE
              WHEN $14 IS NULL THEN progress_cards.mistake_reason_counts
              ELSE jsonb_set(
                COALESCE(progress_cards.mistake_reason_counts, '{}'::jsonb),
                ARRAY[$14],
                to_jsonb(COALESCE((progress_cards.mistake_reason_counts ->> $14)::int, 0) + 1),
                true
              )
            END,
            updated_at = EXCLUDED.updated_at
          RETURNING progress_cards.*`,
        [
          userId,
          question.id,
          deckId,
          seen,
          correct,
          wrong,
          now,
          new Date(nextSr.dueAt),
          nextSr.intervalDays,
          nextSr.ease,
          nextSr.reps,
          nextSr.lapses,
          nextSr.lastGrade,
          reason,
          note
        ]
      );

      await client.query("COMMIT");
      const progressRow = updateRes.rows[0];
      const progressCard = mapProgressRow({...progressRow, external_id: question.external_id});
      return sendJson(req, res, 200, {progressCard});
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
