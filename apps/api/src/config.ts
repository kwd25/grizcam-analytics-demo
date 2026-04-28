import { config } from "dotenv";

config();

const isProduction = process.env.NODE_ENV === "production";
const parseNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === "true";
};

const parseOrigins = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const localOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const configuredOrigins = parseOrigins(process.env.ALLOWED_ORIGINS);
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : isProduction ? [] : localOrigins;

const databaseUrlCandidates = [
  ["database_url", process.env.DATABASE_URL],
  ["postgres_url", process.env.POSTGRES_URL],
  ["postgres_prisma_url", process.env.POSTGRES_PRISMA_URL],
  ["postgres_url_non_pooling", process.env.POSTGRES_URL_NON_POOLING]
] as const;
const selectedDatabaseUrl = databaseUrlCandidates.find(([, value]) => Boolean(value));
const databaseConnectionSource = selectedDatabaseUrl?.[0] ?? (!isProduction ? "local_postgres" : "unconfigured");
const databaseUrl = selectedDatabaseUrl?.[1];
const reportsDatabaseUrl = process.env.REPORTS_DATABASE_URL;
const demoExportsEnabled = process.env.DEMO_EXPORTS_ENABLED ?? process.env.ENABLE_EVENT_EXPORTS;
const defaultPostgresConfig = {
  host: process.env.PGHOST ?? "localhost",
  port: parseNumber(process.env.PGPORT, 5432),
  database: process.env.PGDATABASE ?? "grizcam_synthetic_2025",
  user: process.env.PGUSER ?? process.env.USER ?? "postgres",
  password: process.env.PGPASSWORD ?? ""
};

const postgres = databaseUrl
  ? {
      connectionString: databaseUrl,
      ssl: isProduction ? { rejectUnauthorized: false } : undefined
    }
  : defaultPostgresConfig;

const reportsConnectionSource = reportsDatabaseUrl
  ? "reports_database_url"
  : databaseUrl && databaseConnectionSource !== "unconfigured"
    ? databaseConnectionSource
    : !isProduction
      ? "local_postgres"
      : "unconfigured";

const reportsPostgres =
  reportsConnectionSource === "reports_database_url"
    ? {
        connectionString: reportsDatabaseUrl,
        ssl: isProduction ? { rejectUnauthorized: false } : undefined
      }
    : databaseUrl && reportsConnectionSource !== "local_postgres" && reportsConnectionSource !== "unconfigured"
      ? {
          connectionString: databaseUrl,
          ssl: isProduction ? { rejectUnauthorized: false } : undefined
        }
      : reportsConnectionSource === "local_postgres"
        ? defaultPostgresConfig
        : null;

if (isProduction && !databaseUrl) {
  throw new Error("DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL_NON_POOLING is required in production.");
}

if (isProduction && allowedOrigins.length === 0) {
  throw new Error("ALLOWED_ORIGINS is required in production.");
}

export const appConfig = {
  environment: process.env.NODE_ENV ?? "development",
  isProduction,
  port: parseNumber(process.env.PORT, 4000),
  allowedOrigins,
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
  reportModelTimeoutMs: parseNumber(process.env.REPORT_MODEL_TIMEOUT_MS, 45_000),
  reportGenerationTimeoutMs: parseNumber(process.env.REPORT_GENERATION_TIMEOUT_MS, 50_000),
  reportRepairMinRemainingMs: parseNumber(process.env.REPORT_REPAIR_MIN_REMAINING_MS, 8_000),
  reportMaxTokens: parseNumber(process.env.REPORT_MAX_TOKENS, 3_500),
  reportPromptVersion: process.env.REPORT_PROMPT_VERSION ?? "v1",
  reportsEnabled: Boolean(reportsPostgres),
  reportsConnectionSource,
  databaseConnectionSource,
  databaseEnvPresence: {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    postgresUrl: Boolean(process.env.POSTGRES_URL),
    postgresPrismaUrl: Boolean(process.env.POSTGRES_PRISMA_URL),
    postgresUrlNonPooling: Boolean(process.env.POSTGRES_URL_NON_POOLING)
  },
  apiRateLimit: {
    windowMs: parseNumber(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000),
    max: parseNumber(process.env.API_RATE_LIMIT_MAX, 120)
  },
  exportsEnabled: parseBoolean(demoExportsEnabled, false),
  postgres,
  reportsPostgres
};
