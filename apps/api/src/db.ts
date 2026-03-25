import { Pool } from "pg";
import { appConfig } from "./config.js";

declare global {
  // eslint-disable-next-line no-var
  var __grizcamPool: Pool | undefined;
}

const buildPool = () =>
  new Pool({
    ...appConfig.postgres,
    max: appConfig.isProduction ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    maxUses: appConfig.isProduction ? 7500 : undefined
  });

export const pool = globalThis.__grizcamPool ?? buildPool();

if (!globalThis.__grizcamPool) {
  globalThis.__grizcamPool = pool;
}

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", {
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
