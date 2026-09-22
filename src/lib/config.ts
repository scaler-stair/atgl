import "server-only";

/**
 * Central runtime configuration. Secrets are read from the environment only
 * (never from source, prompts or documents, per Security section 8).
 */
export type AppEnvironment = "development" | "staging" | "production";

function readEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

const appEnv = readEnv("APP_ENV", "staging") as AppEnvironment;

export const config = {
  appEnv,
  tenantId: readEnv("TENANT_ID", "atgl"),
  tenantName: readEnv("TENANT_NAME", "Adani Total Gas"),
  /** Marks every screen and report so synthetic/staging output is never mistaken for production. */
  dataMode: readEnv("DATA_MODE", "synthetic") as "synthetic" | "live",
  /** Postgres (Neon) connection string. When empty, the local SQLite file is used. */
  databaseUrl: readEnv("DATABASE_URL"),
  databasePoolSize: Number(readEnv("DATABASE_POOL_SIZE", "10")),
  /** Postgres schema for the app's tables. "public" allows pooled (serverless) connections. */
  databaseSchema: readEnv("DATABASE_SCHEMA", "atgl"),
  databasePath: readEnv("DATABASE_PATH", "data/atgl.db"),
  sessionTtlHours: Number(readEnv("SESSION_TTL_HOURS", "10")),
  sessionIdleMinutes: Number(readEnv("SESSION_IDLE_MINUTES", "60")),
  gemini: {
    apiKey: readEnv("GEMINI_API_KEY"),
    model: readEnv("GEMINI_MODEL", "gemini-3.5-flash"),
    /** Tried in order when the primary model is overloaded or rate limited. */
    fallbackModels: readEnv("GEMINI_FALLBACK_MODELS", "gemini-flash-lite-latest")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  },
  bootstrapAdminPassword: readEnv("BOOTSTRAP_ADMIN_PASSWORD"),
} as const;

export function geminiConfigured(): boolean {
  return config.gemini.apiKey.length > 0;
}
