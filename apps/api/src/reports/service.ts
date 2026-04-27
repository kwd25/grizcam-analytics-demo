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

const buildEphemeralResponse = async (filters: DashboardFilters, snapshot: ReportSnapshotSummary): Promise<TriggerReportResponse> => {
  const overallStartedAt = Date.now();
  const filterKey = buildReportFilterKey(filters);
  const snapshotHash = hashReportSnapshot(snapshot, appConfig.reportPromptVersion, appConfig.openRouterModel);
  const modelResult = await reportClient.generateReport(snapshot);
  const completedAt = new Date().toISOString();

  return {
    status: "ready",
    phase: "ready",
    cacheKey: snapshotHash,
    reportId: `ephemeral:${filterKey}`,
    isExactMatch: false,
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
        lastErrorCode: null,
        lastErrorMessage: null,
        timingMs: {
          modelRequest: modelResult.timingMs.modelRequest,
          validation: modelResult.timingMs.validation,
          total: Date.now() - overallStartedAt
        }
      }
    },
    reason: null
  };
};

const buildStoredResponse = async (
  filters: DashboardFilters,
  snapshot: ReportSnapshotSummary,
  snapshotHash: string
): Promise<TriggerReportResponse> => {
  const overallStartedAt = Date.now();
  const filterKey = buildReportFilterKey(filters);
  const reportRow = await createQueuedReport({
    id: randomUUID(),
    filterKey,
    promptVersion: appConfig.reportPromptVersion,
    model: appConfig.openRouterModel,
    filters
  });

  await updateReportPhase(reportRow.id, {
    jobStatus: "generating",
    phase: "calling_model",
    snapshotHash,
    snapshot,
    started: true,
    debugPatch: {
      lastErrorCode: null,
      lastErrorMessage: null,
      timingMs: {}
    }
  });

  try {
    const modelResult = await reportClient.generateReport(snapshot);
    const readyRow = await updateReportPhase(reportRow.id, {
      jobStatus: "ready",
      phase: "ready",
      snapshotHash,
      snapshot,
      report: modelResult.report,
      completed: true,
      debugPatch: {
        timingMs: {
          modelRequest: modelResult.timingMs.modelRequest,
          validation: modelResult.timingMs.validation,
          total: Date.now() - overallStartedAt
        }
      }
    });

    return {
      status: "ready",
      phase: "ready",
      cacheKey: snapshotHash,
      reportId: readyRow?.id ?? reportRow.id,
      isExactMatch: false,
      report: readyRow ? toReportRecord(readyRow, "ready") : null,
      reason: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed.";
    const failedRow = await updateReportPhase(reportRow.id, {
      jobStatus: "error",
      phase: "error",
      snapshotHash,
      snapshot,
      error: message,
      completed: true,
      debugPatch: {
        lastErrorCode: "GENERATION_FAILED",
        lastErrorMessage: message,
        timingMs: {
          total: Date.now() - overallStartedAt
        }
      }
    });

    return {
      status: "error",
      phase: "error",
      cacheKey: snapshotHash,
      reportId: failedRow?.id ?? reportRow.id,
      isExactMatch: false,
      report: failedRow ? toReportRecord(failedRow, "error") : null,
      reason: message
    };
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
  force = false
): Promise<TriggerReportResponse> => {
  if (!appConfig.openRouterApiKey) {
    return {
      status: "error",
      phase: "error",
      cacheKey: null,
      reportId: "unavailable",
      isExactMatch: false,
      report: null,
      reason: "Report generation is unavailable because OPENROUTER_API_KEY is not configured on the server."
    };
  }

  const snapshot = coerceSnapshot(filters, snapshotInput);
  const snapshotHash = hashReportSnapshot(snapshot, appConfig.reportPromptVersion, appConfig.openRouterModel);
  const reportsStoreIssue = await getReportsStoreIssue();

  if (!reportsStoreIssue && !force) {
    const exactReady = await findExactReadyReport(snapshotHash, appConfig.reportPromptVersion, appConfig.openRouterModel);
    if (exactReady) {
      return {
        status: "ready",
        phase: "ready",
        cacheKey: snapshotHash,
        reportId: exactReady.id,
        isExactMatch: true,
        report: toReportRecord(exactReady, "ready", { isExactMatch: true }),
        reason: null
      };
    }
  }

  try {
    if (reportsStoreIssue) {
      return await buildEphemeralResponse(filters, snapshot);
    }

    return await buildStoredResponse(filters, snapshot, snapshotHash);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed.";
    return {
      status: "error",
      phase: "error",
      cacheKey: snapshotHash,
      reportId: "unavailable",
      isExactMatch: false,
      report: null,
      reason: message
    };
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
