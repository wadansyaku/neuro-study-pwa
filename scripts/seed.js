import { createClient } from "@vercel/postgres";
import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");

function resolveDeckPath(deckPath){
  if(deckPath.startsWith(".")){
    return path.resolve(DATA_DIR, deckPath.replace(/^.\//, ""));
  }
  return path.resolve(DATA_DIR, deckPath);
}

function mapAnswer(question){
  if(question.type === "short"){
    return {answerKeys: [], answerTexts: question.answer || []};
  }
  return {answerKeys: question.answer || [], answerTexts: []};
}

async function readJson(filePath){
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function run(){
  const decksPath = path.join(DATA_DIR, "decks.json");
  const decks = await readJson(decksPath);
  if(!Array.isArray(decks)){
    throw new Error("decks.json must be an array");
  }

  const client = createClient();
  await client.connect();
  try{
    await client.query("BEGIN");
    for(const deck of decks){
      if(!deck?.id || !deck?.path) continue;
      const label = deck.label || deck.id;
      const description = deck.description || null;
      await client.query(
        `INSERT INTO decks (id, label, description)
         VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description`,
        [deck.id, label, description]
      );

      const deckFile = resolveDeckPath(deck.path);
      const data = await readJson(deckFile);
      const questions = Array.isArray(data.questions) ? data.questions : [];
      for(const question of questions){
        if(!question?.id) continue;
        const {answerKeys, answerTexts} = mapAnswer(question);
        const result = await client.query(
          `INSERT INTO questions (
             deck_id, external_id, type, type_raw, stem, explanation, topic, tag, answer_keys, answer_texts
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (deck_id, external_id)
           DO UPDATE SET
             type = EXCLUDED.type,
             type_raw = EXCLUDED.type_raw,
             stem = EXCLUDED.stem,
             explanation = EXCLUDED.explanation,
             topic = EXCLUDED.topic,
             tag = EXCLUDED.tag,
             answer_keys = EXCLUDED.answer_keys,
             answer_texts = EXCLUDED.answer_texts
           RETURNING id`,
          [
            deck.id,
            question.id,
            question.type,
            question.type_raw || null,
            question.stem,
            question.explanation || null,
            question.topic || null,
            question.tag || null,
            answerKeys,
            answerTexts
          ]
        );
        const questionId = result.rows[0]?.id;
        const options = question.options && typeof question.options === "object" ? question.options : {};
        const optionEntries = Object.entries(options);
        if(optionEntries.length){
          for(const [key, text] of optionEntries){
            await client.query(
              `INSERT INTO question_options (question_id, option_key, option_text, option_order)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (question_id, option_key)
               DO UPDATE SET option_text = EXCLUDED.option_text, option_order = EXCLUDED.option_order`,
              [questionId, key, text, key.charCodeAt(0)]
            );
          }
          await client.query(
            `DELETE FROM question_options
             WHERE question_id = $1 AND option_key <> ALL($2::text[])`,
            [questionId, optionEntries.map(([key]) => key)]
          );
        }else{
          await client.query(
            "DELETE FROM question_options WHERE question_id = $1",
            [questionId]
          );
        }
      }
    }
    await client.query("COMMIT");
    console.log("[seed] completed");
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{
    await client.end();
  }
}

run().catch(error => {
  console.error("[seed] failed", error);
  process.exitCode = 1;
});
