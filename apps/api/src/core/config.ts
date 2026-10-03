export type AppConfig = {
  databaseUrl: string;
  host: string;
  port: number;
  openAiBaseUrl: string;
  lunaModel: string;
  jevUrl: string;
  jevModel: string;
  mailProvider: "gmail" | "smtp" | "disabled";
  llmMonthlyCapUsd: number;
  dailySendCap: number;
};

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const provider = env.MAIL_PROVIDER ?? "gmail";
  return {
    databaseUrl: env.DATABASE_URL ?? "postgres://localhost:5432/jobsniper",
    host: env.JOBSNIPER_HOST ?? "127.0.0.1",
    port: numberEnv("JOBSNIPER_PORT", 4870),
    openAiBaseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    lunaModel: env.JAV_LUNA_MODEL ?? env.LUNA_MODEL ?? "gpt-6-luna",
    jevUrl: env.JAV_JEV_URL ?? env.JEV_URL ?? "http://127.0.0.1:4871",
    jevModel: env.JAV_JEV_MODEL ?? env.JEV_MODEL ?? "jev-latest",
    mailProvider: provider === "smtp" || provider === "disabled" ? provider : "gmail",
    llmMonthlyCapUsd: numberEnv("LLM_MONTHLY_CAP_USD", 30),
    dailySendCap: numberEnv("DAILY_SEND_CAP", 20),
  };
}
