import { authenticate } from "./_lib/auth.js";
import { sql } from "./_lib/db.js";
import { handleOptions, sendJson } from "./_lib/cors.js";

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
    const {rows} = await sql`
      SELECT d.id, d.label, d.description, COUNT(q.id) AS question_count
      FROM decks d
      LEFT JOIN questions q ON q.deck_id = d.id
      GROUP BY d.id
      ORDER BY d.id;
    `;
    const decks = rows.map(row => ({
      id: row.id,
      label: row.label,
      description: row.description,
      questionCount: Number(row.question_count || 0)
    }));
    return sendJson(req, res, 200, {decks});
  }catch(error){
    console.error(error);
    const status = error.status || 500;
    return sendJson(req, res, status, {error: error.message || "Internal Server Error"});
  }
}
