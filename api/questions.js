import { authenticate } from "./_lib/auth.js";
import { sql } from "./_lib/db.js";
import { handleOptions, sendJson } from "./_lib/cors.js";
import { parseCursor, parseLimit } from "./_lib/paging.js";

function mapQuestionRow(row){
  const options = {};
  (row.options || []).forEach(opt => {
    if(opt?.key){
      options[opt.key] = opt.text || "";
    }
  });
  const answer = row.type === "short" ? (row.answer_texts || []) : (row.answer_keys || []);
  return {
    id: row.external_id,
    type: row.type,
    type_raw: row.type_raw,
    stem: row.stem,
    explanation: row.explanation,
    tag: row.tag,
    topic: row.topic,
    options,
    answer
  };
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
    await authenticate(req);
    const url = new URL(req.url, `http://${req.headers?.host || "localhost"}`);
    const deckId = url.searchParams.get("deckId");
    if(!deckId){
      return sendJson(req, res, 400, {error: "deckId is required"});
    }
    const tag = url.searchParams.get("tag");
    const topic = url.searchParams.get("topic");
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const limit = parseLimit(url.searchParams.get("limit"), {fallback: 200, max: 1000});

    const params = [deckId];
    let where = "q.deck_id = $1";
    if(tag){
      params.push(tag);
      where += ` AND q.tag = $${params.length}`;
    }
    if(topic){
      params.push(topic);
      where += ` AND q.topic = $${params.length}`;
    }
    if(cursor){
      params.push(cursor);
      where += ` AND q.id > $${params.length}`;
    }

    params.push(limit);
    const limitRef = `$${params.length}`;
    const query = `
      SELECT q.id, q.external_id, q.type, q.type_raw, q.stem, q.explanation, q.topic, q.tag,
        q.answer_keys, q.answer_texts,
        COALESCE(
          jsonb_agg(
            jsonb_build_object('key', qo.option_key, 'text', qo.option_text, 'order', qo.option_order)
            ORDER BY qo.option_order
          ) FILTER (WHERE qo.id IS NOT NULL),
          '[]'::jsonb
        ) AS options
      FROM questions q
      LEFT JOIN question_options qo ON qo.question_id = q.id
      WHERE ${where}
      GROUP BY q.id
      ORDER BY q.id ASC
      LIMIT ${limitRef};
    `;

    const {rows} = await sql.query(query, params);
    const items = rows.map(mapQuestionRow);
    const nextCursor = rows.length ? rows[rows.length - 1].id : null;
    return sendJson(req, res, 200, {items, nextCursor});
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
