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

const databaseUrl = process.env.DATABASE_URL;
const demoExportsEnabled = process.env.DEMO_EXPORTS_ENABLED ?? process.env.ENABLE_EVENT_EXPORTS;

if (isProduction && !databaseUrl) {
  throw new Error("DATABASE_URL is required in production.");
}

if (isProduction && allowedOrigins.length === 0) {
  throw new Error("ALLOWED_ORIGINS is required in production.");
}

export const appConfig = {
  environment: process.env.NODE_ENV ?? "development",
  isProduction,
  port: parseNumber(process.env.PORT, 4000),
  allowedOrigins,
  apiRateLimit: {
    windowMs: parseNumber(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000),
    max: parseNumber(process.env.API_RATE_LIMIT_MAX, 120)
  },
  exportsEnabled: parseBoolean(demoExportsEnabled, false),
  postgres: databaseUrl
    ? {
        connectionString: databaseUrl,
        ssl: isProduction ? { rejectUnauthorized: false } : undefined
      }
    : {
        host: process.env.PGHOST ?? "localhost",
        port: parseNumber(process.env.PGPORT, 5432),
        database: process.env.PGDATABASE ?? "grizcam_synthetic_2025",
        user: process.env.PGUSER ?? process.env.USER ?? "postgres",
        password: process.env.PGPASSWORD ?? ""
      }
};
