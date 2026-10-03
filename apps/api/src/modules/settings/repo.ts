import type { Settings } from "./ports";
import type { Queryable } from "./ports";

export class SettingsRepository {
  constructor(private readonly database: Queryable) {}

  async get(): Promise<Settings | undefined> {
    const result = await this.database.query<{ value: Settings }>(
      "SELECT value FROM settings WHERE key = 'app'",
    );
    return result.rows[0]?.value;
  }

  async save(settings: Settings): Promise<Settings> {
    await this.database.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('app', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
      [JSON.stringify(settings)],
    );
    return settings;
  }
}
