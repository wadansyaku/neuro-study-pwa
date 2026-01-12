import { sql } from "@vercel/postgres";
import fs from "fs/promises";
import path from "path";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");
const DRY_RUN = process.argv.includes("--dry-run");

async function ensureMigrationsTable(){
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );`;
}

async function listMigrationFiles(){
  const entries = await fs.readdir(MIGRATIONS_DIR, {withFileTypes: true});
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".sql"))
    .map(entry => entry.name)
    .sort();
}

async function fetchAppliedMigrations(){
  const {rows} = await sql`SELECT id FROM schema_migrations ORDER BY id;`;
  return new Set(rows.map(row => row.id));
}

async function applyMigration(id, migrationSql){
  if(DRY_RUN){
    console.log(`[dry-run] apply ${id}`);
    return;
  }
  await sql`BEGIN`;
  try{
    await sql.query(migrationSql);
    await sql`INSERT INTO schema_migrations (id) VALUES (${id});`;
    await sql`COMMIT`;
    console.log(`[migrate] applied ${id}`);
  }catch(error){
    await sql`ROLLBACK`;
    throw error;
  }
}

async function run(){
  await ensureMigrationsTable();
  const files = await listMigrationFiles();
  if(files.length === 0){
    console.log("[migrate] no migrations found");
    return;
  }
  const applied = await fetchAppliedMigrations();
  for(const file of files){
    if(applied.has(file)) continue;
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const migrationSql = await fs.readFile(fullPath, "utf8");
    await applyMigration(file, migrationSql);
  }
}

run().catch(error => {
  console.error("[migrate] failed", error);
  process.exitCode = 1;
});
