import { randomUUID } from "node:crypto";
import type {
  DashboardFilters,
  GetReportResponse,
  ReportPhase,
  ReportSnapshotSummary,
  ReportStatusResponse,
  TriggerReportResponse
} from "@grizcam/shared";
import { buildReportFilterKey, normalizeReportFilters } from "@grizcam/shared";
import { appConfig } from "../config.js";
import { ensureReportsStoreReady, pool, reportsStoreReady } from "../db.js";
import { toReportServiceError, type ReportErrorCode } from "./errors.js";
import { createOpenRouterReportClient } from "./openrouter.js";
import { hashReportSnapshot } from "./snapshot.js";
import {
  createQueuedReport,
  findExactReadyReport,
  findLatestByFilterKey,
  findLatestReadyByFilterKey,
  toReportRecord,
  updateReportPhase,
  type StoredReportRow
} from "./storage.js";

const reportClient = createOpenRouterReportClient();
const supportsEphemeralGeneration = () => Boolean(appConfig.openRouterApiKey);
const buildRequestId = () => randomUUID();
const getSnapshotBytes = (snapshot: ReportSnapshotSummary) => Buffer.byteLength(JSON.stringify(snapshot), "utf8");

const toIdleResponse = (): GetReportResponse => ({
  status: "idle",
  cacheKey: null,
  phase: "idle",
  reason: null,
  latest: null,
  stale: null
});

const phaseToViewStatus = (phase: ReportPhase) => {
  switch (phase) {
    case "ready":
      return "ready" as const;
    case "error":
      return "error" as const;
    case "disabled":
      return "disabled" as const;
    case "idle":
      return "idle" as const;
    default:
      return "generating" as const;
  }
};

const getReportsStoreIssue = async () => {
  const state = await ensureReportsStoreReady();

  if (!state.configured) {
    return {
      status: "disabled" as const,
      phase: "disabled" as const,
      reason: state.failureReason ?? "Reports storage is unavailable. Configure REPORTS_DATABASE_URL or use a writable DATABASE_URL for reports."
    };
  }

  if (!state.connected || state.databaseStatus === "unavailable") {
    return {
      status: "error" as const,
      phase: "error" as const,
      reason: state.failureReason ?? "Reports storage is unavailable right now."
    };
  }

  if (state.readOnly) {
    return {
      status: "disabled" as const,
      phase: "disabled" as const,
      reason: state.failureReason ?? "Reports storage resolved to a read-only database."
    };
  }

  if (!state.schemaReady || !reportsStoreReady()) {
    return {
      status: "error" as const,
      phase: "error" as const,
      reason: state.failureReason ?? "Reports storage is connected but not initialized yet."
    };
  }

  return null;
};

const coerceSnapshot = (filters: DashboardFilters, snapshot: ReportSnapshotSummary): ReportSnapshotSummary => {
  const normalizedFilters = normalizeReportFilters(filters);
  return {
    ...snapshot,
    filters: normalizedFilters,
    filterKey: buildReportFilterKey(normalizedFilters),
    dateRange: {
      startDate: normalizedFilters.start_date ?? "",
      endDate: normalizedFilters.end_date ?? ""
    }
  };
};

const logGenerateAttempt = (payload: {
  requestId: string;
  snapshotHash: string;
  phase: ReportPhase;
  elapsedMs?: number;
  model?: string;
  cacheKeyAvailable?: boolean;
  storage?: {
    databaseStatus: string;
    readOnly: boolean | null;
    schemaReady: boolean;
    connectionSource: string;
    failureReason: string | null;
  };
  errorCode?: string | null;
  errorMessage?: string | null;
  timingMs?: Record<string, number>;
}) => {
  console.log("reports.generate", payload);
};

const buildErrorResponse = (input: {
  requestId: string;
  snapshotHash: string | null;
  reason: string;
  errorCode: ReportErrorCode;
  phase?: ReportPhase;
}): TriggerReportResponse => {
  logGenerateAttempt({
    requestId: input.requestId,
    snapshotHash: input.snapshotHash ?? "unavailable",
    phase: input.phase ?? "error",
    errorCode: input.errorCode,
    errorMessage: input.reason
  });

  return {
    status: "error",
    phase: input.phase ?? "error",
    cacheKey: input.snapshotHash,
    reportId: "unavailable",
    isExactMatch: false,
    report: null,
    reason: input.reason,
    errorCode: input.errorCode,
    requestId: input.requestId
  };
};

const buildEphemeralResponse = async (
  filters: DashboardFilters,
  snapshot: ReportSnapshotSummary,
  requestId: string,
  deadlineAtMs: number,
  baseTimingMs: Record<string, number>
): Promise<TriggerReportResponse> => {
  const overallStartedAt = Date.now();
  const filterKey = buildReportFilterKey(filters);
  const snapshotHash = hashReportSnapshot(snapshot, appConfig.reportPromptVersion, appConfig.openRouterModel);
  const modelResult = await reportClient.generateReport(snapshot, { requestId, deadlineAtMs });
  const completedAt = new Date().toISOString();
  const timingMs = {
    ...baseTimingMs,
    modelRequest: modelResult.timingMs.modelRequest,
    validation: modelResult.timingMs.validation,
    snapshotBytes: modelResult.timingMs.snapshotBytes,
    promptChars: modelResult.timingMs.promptChars,
    modelCalls: modelResult.timingMs.modelCalls,
    total: Date.now() - overallStartedAt
  };

  logGenerateAttempt({
    requestId,
    snapshotHash,
    phase: "ready",
    elapsedMs: timingMs.total,
    model: appConfig.openRouterModel,
    cacheKeyAvailable: true,
    timingMs
  });

  return {
    status: "ready",
    phase: "ready",
    cacheKey: snapshotHash,
    reportId: `ephemeral:${filterKey}`,
    isExactMatch: false,
    errorCode: null,
    requestId,
    report: {
      id: `ephemeral:${filterKey}`,
      normalizedFilterKey: filterKey,
      sourceMode: "ephemeral",
      snapshotHash,
      promptVersion: appConfig.reportPromptVersion,
      model: appConfig.openRouterModel,
      jobStatus: "ready",
      viewStatus: "ready",
      isRefreshing: false,
      isExactMatch: false,
      phase: "ready",
      generatedAt: completedAt,
      updatedAt: completedAt,
      startedAt: new Date(overallStartedAt).toISOString(),
      completedAt,
      error: null,
      report: modelResult.report,
      snapshot,
      debug: {
        requestId,
        lastErrorCode: null,
        lastErrorMessage: null,
        timingMs
      }
    },
    reason: null
  };
};

const persistReportBestEffort = async (input: {
  requestId: string;
  filters: DashboardFilters;
  snapshot: ReportSnapshotSummary;
  snapshotHash: string;
  report: NonNullable<TriggerReportResponse["report"]>["report"];
  timingMs: Record<string, number>;
}) => {
  if (!reportsStoreReady() || !input.report) {
    return null;
  }

  const startedAt = Date.now();
  try {
    const filterKey = buildReportFilterKey(input.filters);
    const reportRow = await createQueuedReport({
      id: randomUUID(),
      filterKey,
      promptVersion: appConfig.reportPromptVersion,
      model: appConfig.openRouterModel,
      filters: input.filters
    });

    const readyRow = await updateReportPhase(reportRow.id, {
      jobStatus: "ready",
      phase: "ready",
      snapshotHash: input.snapshotHash,
      snapshot: input.snapshot,
      report: input.report,
      started: true,
      completed: true,
      debugPatch: {
        requestId: input.requestId,
        timingMs: {
          ...input.timingMs,
          persistence: Date.now() - startedAt
        }
      }
    });

    logGenerateAttempt({
      requestId: input.requestId,
      snapshotHash: input.snapshotHash,
      phase: "ready",
      elapsedMs: Date.now() - startedAt,
      cacheKeyAvailable: true,
      timingMs: {
        persistence: Date.now() - startedAt
      }
    });

    return readyRow ? toReportRecord(readyRow, "ready") : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reports storage error.";
    logGenerateAttempt({
      requestId: input.requestId,
      snapshotHash: input.snapshotHash,
      phase: "error",
      errorCode: "REPORT_STORAGE_UNAVAILABLE",
      errorMessage: message,
      elapsedMs: Date.now() - startedAt
    });
    return null;
  }
};

export const selectLatestReportView = (input: {
  latestByFilter: StoredReportRow | null;
  staleReady: StoredReportRow | null;
}): GetReportResponse => {
  const cacheKey = input.latestByFilter?.snapshotHash ?? input.staleReady?.snapshotHash ?? null;

  if (!input.latestByFilter) {
    return {
      ...toIdleResponse(),
      cacheKey
    };
  }

  if (input.latestByFilter.jobStatus === "ready") {
    return {
      status: "ready",
      cacheKey,
      phase: input.latestByFilter.phase,
      reason: null,
      latest: toReportRecord(input.latestByFilter, "ready"),
      stale: null
    };
  }

  if (input.latestByFilter.jobStatus === "error") {
    const stale = input.staleReady ? toReportRecord(input.staleReady, "stale", { isRefreshing: false }) : null;
    return {
      status: stale ? "stale" : "error",
      cacheKey,
      phase: input.latestByFilter.phase,
      reason: input.latestByFilter.error,
      latest: toReportRecord(input.latestByFilter, stale ? "stale" : "error"),
      stale
    };
  }

  const stale = input.staleReady ? toReportRecord(input.staleReady, "stale", { isRefreshing: true }) : null;
  return {
    status: stale ? "stale" : "generating",
    cacheKey,
    phase: input.latestByFilter.phase,
    reason: null,
    latest: toReportRecord(input.latestByFilter, stale ? "stale" : phaseToViewStatus(input.latestByFilter.phase), {
      isRefreshing: Boolean(stale)
    }),
    stale
  };
};

export const getLatestReport = async (filters: DashboardFilters): Promise<GetReportResponse> => {
  const reportsStoreIssue = await getReportsStoreIssue();
  if (reportsStoreIssue) {
    return {
      ...toIdleResponse(),
      reason: supportsEphemeralGeneration()
        ? "Manual on-demand generation is available from the Reports page once analytics inputs are loaded."
        : reportsStoreIssue.reason
    };
  }

  try {
    const filterKey = buildReportFilterKey(filters);
    const latestByFilter = await findLatestByFilterKey(filterKey);
    const staleReady =
      latestByFilter?.jobStatus === "ready" ? null : await findLatestReadyByFilterKey(filterKey, latestByFilter?.id);

    return selectLatestReportView({
      latestByFilter,
      staleReady
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reports storage is unavailable.";
    return {
      status: "error",
      cacheKey: null,
      phase: "error",
      reason: message,
      latest: null,
      stale: null
    };
  }
};

export const triggerReportGeneration = async (
  filters: DashboardFilters,
  snapshotInput: ReportSnapshotSummary,
  force = false,
  requestId: string = buildRequestId()
): Promise<TriggerReportResponse> => {
  const overallStartedAt = Date.now();
  const deadlineAtMs = overallStartedAt + appConfig.reportGenerationTimeoutMs;

  if (!appConfig.openRouterApiKey) {
    return buildErrorResponse({
      requestId,
      snapshotHash: null,
      errorCode: "REPORT_MODEL_UNAVAILABLE",
      reason: "Report generation is unavailable because OPENROUTER_API_KEY is not configured on the server."
    });
  }

  const snapshot = coerceSnapshot(filters, snapshotInput);
  const snapshotHash = hashReportSnapshot(snapshot, appConfig.reportPromptVersion, appConfig.openRouterModel);
  const snapshotBytes = getSnapshotBytes(snapshot);
  const storageStartedAt = Date.now();
  const storageState = await ensureReportsStoreReady();
  const storageCheckMs = Date.now() - storageStartedAt;
  const baseTimingMs = {
    storageCheck: storageCheckMs,
    snapshotBytes
  };

  logGenerateAttempt({
    requestId,
    snapshotHash,
    phase: "queued",
    elapsedMs: Date.now() - overallStartedAt,
    model: appConfig.openRouterModel,
    cacheKeyAvailable: Boolean(snapshotHash),
    storage: {
      databaseStatus: storageState.databaseStatus,
      readOnly: storageState.readOnly,
      schemaReady: storageState.schemaReady,
      connectionSource: storageState.connectionSource,
      failureReason: storageState.failureReason
    },
    timingMs: baseTimingMs
  });

  if (reportsStoreReady() && !force) {
    try {
      const exactReady = await findExactReadyReport(snapshotHash, appConfig.reportPromptVersion, appConfig.openRouterModel);
      if (exactReady) {
        return {
          status: "ready",
          phase: "ready",
          cacheKey: snapshotHash,
          reportId: exactReady.id,
          isExactMatch: true,
          report: toReportRecord(exactReady, "ready", { isExactMatch: true }),
          reason: null,
          errorCode: null,
          requestId
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reports storage error.";
      logGenerateAttempt({
        requestId,
        snapshotHash,
        phase: "error",
        errorCode: "REPORT_STORAGE_UNAVAILABLE",
        errorMessage: message
      });
    }
  }

  try {
    const response = await buildEphemeralResponse(filters, snapshot, requestId, deadlineAtMs, baseTimingMs);

    if (response.report?.report) {
      const persistenceStartedAt = Date.now();
      const persistedRecord = await persistReportBestEffort({
        requestId,
        filters,
        snapshot,
        snapshotHash,
        report: response.report.report,
        timingMs: response.report.debug?.timingMs ?? {}
      });
      if (persistedRecord) {
        response.report = persistedRecord;
        response.reportId = persistedRecord.id;
      }
      if (response.report?.debug?.timingMs) {
        response.report.debug.timingMs.persistence = response.report.debug.timingMs.persistence ?? Date.now() - persistenceStartedAt;
        response.report.debug.timingMs.total = Date.now() - overallStartedAt;
      }
    }

    return response;
  } catch (error) {
    const normalized = toReportServiceError(error);
    return buildErrorResponse({
      requestId,
      snapshotHash,
      errorCode: normalized.code,
      phase: normalized.phase,
      reason: normalized.message
    });
  }
};

export const getReportStatus = async (filters: DashboardFilters): Promise<ReportStatusResponse> => {
  const reportsStoreIssue = await getReportsStoreIssue();
  if (reportsStoreIssue) {
    return {
      status: "idle",
      cacheKey: null,
      phase: "idle",
      reason: supportsEphemeralGeneration()
        ? "Manual on-demand generation is available from the Reports page once analytics inputs are loaded."
        : reportsStoreIssue.reason,
      current: null,
      stale: null
    };
  }

  const latest = await getLatestReport(filters);
  return {
    status: latest.status,
    cacheKey: latest.cacheKey,
    phase: latest.phase,
    reason: latest.reason,
    current: latest.latest,
    stale: latest.stale ?? null
  };
};

export const getReportsHealth = async () => {
  const reportsState = await ensureReportsStoreReady();
  const analyticsHealth = await pool
    .query("select current_setting('transaction_read_only') as read_only")
    .then((result) => ({
      status: "ok",
      readOnly: String(result.rows[0]?.read_only) === "on"
    }))
    .catch(() => ({
      status: "unavailable",
      readOnly: null
    }));

  return {
    analyticsDatabase: analyticsHealth.status,
    analyticsDatabaseReadOnly: analyticsHealth.readOnly,
    reportsDatabase: reportsState.databaseStatus,
    reportsDatabaseReadOnly: reportsState.readOnly,
    reportsConnectionSource: reportsState.connectionSource,
    reportsSchemaReady: reportsState.schemaReady,
    reportsFailureReason: reportsState.failureReason,
    supportsEphemeralGeneration: supportsEphemeralGeneration(),
    openRouterConfigured: Boolean(appConfig.openRouterApiKey),
    reportsEnabled: reportsStoreReady()
  };
};
