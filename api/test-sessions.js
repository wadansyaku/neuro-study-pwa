import { randomUUID } from "crypto";
import { authenticate } from "./_lib/auth.js";
import { createClient, sql } from "./_lib/db.js";
import { handleOptions, sendJson } from "./_lib/cors.js";
import { readJsonBody, requireString } from "./_lib/validate.js";

function mapSessionRow(row){
  return {
    id: row.id,
    deckId: row.deck_id,
    mode: row.mode,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    durationSec: row.duration_sec,
    meta: row.meta || {}
  };
}

async function sampleQuestionIds(client, deckId, size){
  const rangeRes = await client.query(
    "SELECT MIN(id) AS min_id, MAX(id) AS max_id FROM questions WHERE deck_id = $1",
    [deckId]
  );
  const range = rangeRes.rows[0];
  if(!range || !range.min_id || !range.max_id){
    return [];
  }
  const minId = Number(range.min_id);
  const maxId = Number(range.max_id);
  const start = Math.floor(Math.random() * (maxId - minId + 1)) + minId;
  const first = await client.query(
    "SELECT id FROM questions WHERE deck_id = $1 AND id >= $2 ORDER BY id ASC LIMIT $3",
    [deckId, start, size]
  );
  const ids = first.rows.map(row => row.id);
  if(ids.length < size){
    const remain = size - ids.length;
    const second = await client.query(
      "SELECT id FROM questions WHERE deck_id = $1 AND id < $2 ORDER BY id ASC LIMIT $3",
      [deckId, start, remain]
    );
    second.rows.forEach(row => ids.push(row.id));
  }
  return ids;
}

async function mapExternalIds(client, ids){
  if(!ids.length) return [];
  const res = await client.query(
    "SELECT id, external_id FROM questions WHERE id = ANY($1::bigint[])",
    [ids]
  );
  const map = new Map(res.rows.map(row => [row.id, row.external_id]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

export default async function handler(req, res){
  if(req.method === "OPTIONS"){
    handleOptions(req, res);
    return;
  }
  try{
    const {userId} = await authenticate(req);
    if(req.method === "GET"){
      const url = new URL(req.url, `http://${req.headers?.host || "localhost"}`);
      const sessionId = url.searchParams.get("id");
      const deckId = url.searchParams.get("deckId");
      if(!sessionId && !deckId){
        return sendJson(req, res, 400, {error: "id or deckId is required"});
      }
      if(sessionId){
        const sessionRes = await sql`
          SELECT * FROM test_sessions
          WHERE id = ${sessionId} AND user_id = ${userId}
          LIMIT 1;
        `;
        const session = sessionRes.rows[0];
        if(!session){
          return sendJson(req, res, 404, {error: "Session not found"});
        }
        const itemsRes = await sql`
          SELECT q.external_id AS question_id, i.order_index
          FROM test_session_items i
          JOIN questions q ON q.id = i.question_id
          WHERE i.session_id = ${sessionId}
          ORDER BY i.order_index ASC;
        `;
        return sendJson(req, res, 200, {
          session: mapSessionRow(session),
          items: itemsRes.rows.map(row => ({
            questionId: row.question_id,
            orderIndex: row.order_index
          }))
        });
      }

      const latestRes = await sql`
        SELECT * FROM test_sessions
        WHERE user_id = ${userId}
          AND deck_id = ${deckId}
          AND completed_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1;
      `;
      const latest = latestRes.rows[0];
      if(!latest){
        return sendJson(req, res, 200, {session: null, items: []});
      }
      const itemsRes = await sql`
        SELECT q.external_id AS question_id, i.order_index
        FROM test_session_items i
        JOIN questions q ON q.id = i.question_id
        WHERE i.session_id = ${latest.id}
        ORDER BY i.order_index ASC;
      `;
      return sendJson(req, res, 200, {
        session: mapSessionRow(latest),
        items: itemsRes.rows.map(row => ({
          questionId: row.question_id,
          orderIndex: row.order_index
        }))
      });
    }

    if(req.method === "POST"){
      let body = {};
      try{
        body = await readJsonBody(req);
      }catch(e){
        return sendJson(req, res, 400, {error: "Invalid JSON body"});
      }
      const deckId = requireString(body.deckId, "deckId");
      const mode = requireString(body.mode || "mock", "mode");
      const size = Number(body.size || 100);
      const clampedSize = Math.max(1, Math.min(200, Number.isFinite(size) ? size : 100));

      const client = createClient();
      await client.connect();
      try{
        await client.query("BEGIN");
        const ids = await sampleQuestionIds(client, deckId, clampedSize);
        if(ids.length === 0){
          await client.query("ROLLBACK");
          return sendJson(req, res, 404, {error: "No questions available"});
        }
        const sessionId = randomUUID();
        await client.query(
          `INSERT INTO test_sessions (id, user_id, deck_id, mode, duration_sec, meta)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [sessionId, userId, deckId, mode, 90 * 60, {}]
        );
        for(let i = 0; i < ids.length; i += 1){
          await client.query(
            `INSERT INTO test_session_items (session_id, question_id, order_index)
             VALUES ($1,$2,$3)`,
            [sessionId, ids[i], i]
          );
        }
        await client.query("COMMIT");
        const questionIds = await mapExternalIds(client, ids);
        return sendJson(req, res, 200, {sessionId, questionIds});
      }catch(error){
        await client.query("ROLLBACK");
        throw error;
      }finally{
        await client.end();
      }
    }

    if(req.method === "PUT"){
      let body = {};
      try{
        body = await readJsonBody(req);
      }catch(e){
        return sendJson(req, res, 400, {error: "Invalid JSON body"});
      }
      const sessionId = requireString(body.id, "id");
      const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
      const completedAt = body.completedAt ? new Date(body.completedAt) : null;
      const durationSec = Number.isFinite(Number(body.durationSec)) ? Number(body.durationSec) : null;

      const updateRes = await sql`
        UPDATE test_sessions
        SET meta = ${meta},
            completed_at = COALESCE(${completedAt}, completed_at),
            duration_sec = COALESCE(${durationSec}, duration_sec)
        WHERE id = ${sessionId} AND user_id = ${userId}
        RETURNING *;
      `;
      const session = updateRes.rows[0];
      if(!session){
        return sendJson(req, res, 404, {error: "Session not found"});
      }
      return sendJson(req, res, 200, {session: mapSessionRow(session)});
    }

    return sendJson(req, res, 405, {error: "Method Not Allowed"});
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
