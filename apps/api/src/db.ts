import { Pool } from "pg";
import { appConfig } from "./config.js";
import { REPORTS_TABLE_SQL } from "./reports/schema.js";

export type ReportsConnectionSource =
  | "reports_database_url"
  | "database_url"
  | "postgres_url"
  | "postgres_prisma_url"
  | "postgres_url_non_pooling"
  | "local_postgres"
  | "unconfigured";
export type ReportsStoreState = {
  configured: boolean;
  connectionSource: ReportsConnectionSource;
  connected: boolean;
  databaseStatus: "ok" | "disabled" | "unavailable";
  readOnly: boolean | null;
  schemaReady: boolean;
  failureReason: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __grizcamPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __grizcamReportsPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __grizcamReportsStoreState: ReportsStoreState | undefined;
  // eslint-disable-next-line no-var
  var __grizcamReportsStoreInitPromise: Promise<ReportsStoreState> | undefined;
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

const connectionSourceLabel: Record<ReportsConnectionSource, string> = {
  reports_database_url: "REPORTS_DATABASE_URL",
  database_url: "DATABASE_URL",
  postgres_url: "POSTGRES_URL",
  postgres_prisma_url: "POSTGRES_PRISMA_URL",
  postgres_url_non_pooling: "POSTGRES_URL_NON_POOLING",
  local_postgres: "local Postgres config",
  unconfigured: "unconfigured reports connection"
};

const createDefaultReportsStoreState = (): ReportsStoreState => ({
  configured: Boolean(reportsPool),
  connectionSource: appConfig.reportsConnectionSource as ReportsConnectionSource,
  connected: false,
  databaseStatus: reportsPool ? "unavailable" : "disabled",
  readOnly: null,
  schemaReady: false,
  failureReason: reportsPool
    ? "Reports storage has not been initialized yet."
    : "Reports storage is unavailable. Configure REPORTS_DATABASE_URL or use a writable DATABASE_URL for reports."
});

if (!globalThis.__grizcamPool) {
  globalThis.__grizcamPool = pool;
}

if (reportsPool && !globalThis.__grizcamReportsPool) {
  globalThis.__grizcamReportsPool = reportsPool;
}

if (!globalThis.__grizcamReportsStoreState) {
  globalThis.__grizcamReportsStoreState = createDefaultReportsStoreState();
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

const setReportsStoreState = (patch: Partial<ReportsStoreState>) => {
  globalThis.__grizcamReportsStoreState = {
    ...(globalThis.__grizcamReportsStoreState ?? createDefaultReportsStoreState()),
    ...patch
  };

  return globalThis.__grizcamReportsStoreState;
};

export const getReportsStoreState = () => globalThis.__grizcamReportsStoreState ?? createDefaultReportsStoreState();

export const reportsStoreReady = () => {
  const state = getReportsStoreState();
  return state.configured && state.databaseStatus === "ok" && state.readOnly === false && state.schemaReady;
};

export const verifyDatabaseConnection = async () => {
  try {
    await pool.query("select 1");
    console.log("PostgreSQL connectivity check passed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    console.error("PostgreSQL connectivity check failed", { message });
  }
};

export const ensureReportsStoreReady = async (): Promise<ReportsStoreState> => {
  const currentState = getReportsStoreState();
  const hasSettledNonTransientFailure =
    currentState.failureReason !== null &&
    currentState.failureReason !== "Reports storage has not been initialized yet." &&
    currentState.databaseStatus !== "unavailable";

  if (
    reportsStoreReady() ||
    !currentState.configured ||
    currentState.readOnly === true ||
    hasSettledNonTransientFailure
  ) {
    return currentState;
  }

  if (!reportsPool) {
    return setReportsStoreState(createDefaultReportsStoreState());
  }

  if (globalThis.__grizcamReportsStoreInitPromise) {
    return globalThis.__grizcamReportsStoreInitPromise;
  }

  globalThis.__grizcamReportsStoreInitPromise = (async () => {
    const sourceLabel = connectionSourceLabel[appConfig.reportsConnectionSource as ReportsConnectionSource];

    try {
      const result = await reportsPool.query("select current_setting('transaction_read_only') as read_only");
      const readOnly = String(result.rows[0]?.read_only) === "on";

      if (readOnly) {
        return setReportsStoreState({
          configured: true,
          connectionSource: appConfig.reportsConnectionSource as ReportsConnectionSource,
          connected: true,
          databaseStatus: "ok",
          readOnly: true,
          schemaReady: false,
          failureReason: `Reports storage resolved to ${sourceLabel}, but that database is read-only. Configure REPORTS_DATABASE_URL or use a writable DATABASE_URL for reports.`
        });
      }

      try {
        await reportsPool.query(REPORTS_TABLE_SQL);
        console.log("Reports storage is ready");
        return setReportsStoreState({
          configured: true,
          connectionSource: appConfig.reportsConnectionSource as ReportsConnectionSource,
          connected: true,
          databaseStatus: "ok",
          readOnly: false,
          schemaReady: true,
          failureReason: null
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown reports schema error";
        console.error("Reports storage schema initialization failed", { message });
        return setReportsStoreState({
          configured: true,
          connectionSource: appConfig.reportsConnectionSource as ReportsConnectionSource,
          connected: true,
          databaseStatus: "ok",
          readOnly: false,
          schemaReady: false,
          failureReason: `Reports storage connected via ${sourceLabel}, but failed to initialize the analytics_reports table. ${message}`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reports database error";
      console.error("Reports PostgreSQL connectivity check failed", { message });
      return setReportsStoreState({
        configured: true,
        connectionSource: appConfig.reportsConnectionSource as ReportsConnectionSource,
        connected: false,
        databaseStatus: "unavailable",
        readOnly: null,
        schemaReady: false,
        failureReason: `Reports storage connection via ${sourceLabel} is unavailable. ${message}`
      });
    } finally {
      globalThis.__grizcamReportsStoreInitPromise = undefined;
    }
  })();

  return globalThis.__grizcamReportsStoreInitPromise;
};

export const verifyReportsDatabaseConnection = async () => {
  const state = await ensureReportsStoreReady();
  return {
    ok: reportsStoreReady(),
    configured: state.configured
  };
};
