import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DatabasePort } from "../ports/database";

export async function migrateDatabase(database: DatabasePort): Promise<string[]> {
  await database.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  // Inside the packaged app the migrations ship as a resource (import.meta.dir is virtual there).
  const directory = process.env.JOBSNIPER_MIGRATIONS_DIR ?? resolve(import.meta.dir, "../../../../../db/migrations");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const name of names) {
    const result = await database.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1) AS exists",
      [name],
    );
    if (result.rows[0]?.exists) continue;

    const sql = await readFile(join(directory, name), "utf8");
    await database.transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    });
    applied.push(name);
  }
  return applied;
}
