import { sql } from "./db.js";

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

async function fetchQuestionsByIds(ids){
  if(!ids.length) return [];
  const {rows} = await sql`
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
    WHERE q.id = ANY(${ids}::bigint[])
    GROUP BY q.id
    ORDER BY q.id ASC;
  `;
  const byId = new Map(rows.map(row => [row.id, mapQuestionRow(row)]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

export {mapQuestionRow, fetchQuestionsByIds};
