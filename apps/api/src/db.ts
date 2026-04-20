import { Pool } from "pg";
import { appConfig } from "./config.js";

declare global {
  // eslint-disable-next-line no-var
  var __grizcamPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __grizcamReportsPool: Pool | undefined;
}

const buildPool = (connection: ConstructorParameters<typeof Pool>[0]) =>
  new Pool({
    ...connection,
    max: appConfig.isProduction ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    maxUses: appConfig.isProduction ? 7500 : undefined
  });

export const pool = globalThis.__grizcamPool ?? buildPool(appConfig.postgres);
export const reportsPool = appConfig.reportsPostgres
  ? globalThis.__grizcamReportsPool ?? buildPool(appConfig.reportsPostgres)
  : null;

if (!globalThis.__grizcamPool) {
  globalThis.__grizcamPool = pool;
}

if (reportsPool && !globalThis.__grizcamReportsPool) {
  globalThis.__grizcamReportsPool = reportsPool;
}

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", {
    message: error.message,
    name: error.name
  });
});

reportsPool?.on("error", (error) => {
  console.error("Unexpected reports PostgreSQL pool error", {
    message: error.message,
    name: error.name
  });
});

export const verifyDatabaseConnection = async () => {
  try {
    await pool.query("select 1");
    console.log("PostgreSQL connectivity check passed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    console.error("PostgreSQL connectivity check failed", { message });
  }
};

export const verifyReportsDatabaseConnection = async () => {
  if (!reportsPool) {
    return { ok: false, configured: false };
  }

  try {
    await reportsPool.query("select 1");
    console.log("Reports PostgreSQL connectivity check passed");
    return { ok: true, configured: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reports database error";
    console.error("Reports PostgreSQL connectivity check failed", { message });
    return { ok: false, configured: true };
  }
};
