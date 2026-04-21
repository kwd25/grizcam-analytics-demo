import { randomUUID } from "node:crypto";
import type { DashboardFilters, GetReportResponse, ReportPhase, ReportStatusResponse, TriggerReportResponse } from "@grizcam/shared";
import { appConfig } from "../config.js";
import { ensureReportsStoreReady, pool, reportsStoreReady } from "../db.js";
import { getAnalyticsLab, getOverview } from "../queries/dashboard.js";
import { createOpenRouterReportClient } from "./openrouter.js";
import { buildReportFilterKey, buildReportSnapshot, hashReportSnapshot } from "./snapshot.js";
import {
  createQueuedReport,
  findExactReadyReport,
  findLatestByFilterKey,
  findLatestReadyByFilterKey,
  getReportById,
  toReportRecord,
  updateReportPhase,
  type StoredReportRow
} from "./storage.js";

const inflightReportIds = new Set<string>();
const reportClient = createOpenRouterReportClient();

const toDisabledResponse = (
  reason = "Reports are unavailable. Configure REPORTS_DATABASE_URL or use a writable DATABASE_URL for reports."
): GetReportResponse => ({
  status: "disabled",
  cacheKey: null,
  phase: "disabled",
  reason,
  latest: null,
  stale: null
});

const toErrorResponse = (reason: string): GetReportResponse => ({
  status: "error",
  cacheKey: null,
  phase: "error",
  reason,
  latest: null,
  stale: null
});

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

const scheduleReportGeneration = (reportId: string) => {
  if (inflightReportIds.has(reportId)) {
    return;
  }

  inflightReportIds.add(reportId);

  setTimeout(async () => {
    const overallStartedAt = Date.now();
    try {
      const row = await getReportById(reportId);
      if (!row) {
        return;
      }

      await updateReportPhase(reportId, {
        jobStatus: "generating",
        phase: "building_snapshot",
        started: true,
        debugPatch: {
          lastErrorCode: null,
          lastErrorMessage: null,
          timingMs: {}
        }
      });

      const snapshotStartedAt = Date.now();
      const [overview, analytics] = await Promise.all([getOverview(row.filters), getAnalyticsLab(row.filters)]);
      const snapshot = buildReportSnapshot(row.filters, overview, analytics);
      const snapshotHash = hashReportSnapshot(snapshot, appConfig.reportPromptVersion, appConfig.openRouterModel);
      const snapshotTimingMs = Date.now() - snapshotStartedAt;

      const exactReady = await findExactReadyReport(snapshotHash, appConfig.reportPromptVersion, appConfig.openRouterModel, reportId);
      if (exactReady?.report) {
        await updateReportPhase(reportId, {
          jobStatus: "ready",
          phase: "ready",
          snapshotHash,
          snapshot,
          report: exactReady.report,
          completed: true,
          debugPatch: {
            timingMs: {
              snapshotAssembly: snapshotTimingMs,
              total: Date.now() - overallStartedAt
            }
          }
        });
        return;
      }

      await updateReportPhase(reportId, {
        jobStatus: "generating",
        phase: "calling_model",
        snapshotHash,
        snapshot,
        debugPatch: {
          timingMs: {
            snapshotAssembly: snapshotTimingMs
          }
        }
      });

      const modelResult = await reportClient.generateReport(snapshot);

      await updateReportPhase(reportId, {
        jobStatus: "generating",
        phase: "validating_response",
        snapshotHash,
        snapshot,
        debugPatch: {
          timingMs: {
            snapshotAssembly: snapshotTimingMs,
            modelRequest: modelResult.timingMs.modelRequest,
            validation: modelResult.timingMs.validation
          }
        }
      });

      await updateReportPhase(reportId, {
        jobStatus: "ready",
        phase: "ready",
        snapshotHash,
        snapshot,
        report: modelResult.report,
        completed: true,
        debugPatch: {
          timingMs: {
            snapshotAssembly: snapshotTimingMs,
            modelRequest: modelResult.timingMs.modelRequest,
            validation: modelResult.timingMs.validation,
            total: Date.now() - overallStartedAt
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Report generation failed.";
      await updateReportPhase(reportId, {
        jobStatus: "error",
        phase: "error",
        error: message,
        completed: true,
        debugPatch: {
          lastErrorCode: "GENERATION_FAILED",
          lastErrorMessage: message,
          timingMs: {
            total: Date.now() - overallStartedAt
          }
        }
      }).catch(() => {
        console.error("Failed to persist report error state", { reportId, message });
      });
    } finally {
      inflightReportIds.delete(reportId);
    }
  }, 0);
};

export const getLatestReport = async (filters: DashboardFilters): Promise<GetReportResponse> => {
  const reportsStoreIssue = await getReportsStoreIssue();
  if (reportsStoreIssue) {
    return reportsStoreIssue.status === "disabled"
      ? toDisabledResponse(reportsStoreIssue.reason)
      : toErrorResponse(reportsStoreIssue.reason);
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
    return toErrorResponse(message);
  }
};

export const triggerReportGeneration = async (filters: DashboardFilters, force = false): Promise<TriggerReportResponse> => {
  const reportsStoreIssue = await getReportsStoreIssue();
  if (reportsStoreIssue) {
    return {
      status: reportsStoreIssue.status,
      phase: reportsStoreIssue.phase,
      cacheKey: null,
      reportId: "disabled",
      isExactMatch: false,
      report: null,
      reason: reportsStoreIssue.reason
    };
  }

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

  try {
    const filterKey = buildReportFilterKey(filters);
    const latestByFilter = await findLatestByFilterKey(filterKey);

    if (latestByFilter && !force) {
      if (latestByFilter.jobStatus === "queued" || latestByFilter.jobStatus === "generating") {
        scheduleReportGeneration(latestByFilter.id);
      }

      return {
        status:
          latestByFilter.jobStatus === "ready"
            ? "ready"
            : latestByFilter.jobStatus === "error"
              ? "error"
              : "generating",
        phase: latestByFilter.phase,
        cacheKey: latestByFilter.snapshotHash,
        reportId: latestByFilter.id,
        isExactMatch: latestByFilter.jobStatus === "ready",
        report:
          latestByFilter.jobStatus === "ready" || latestByFilter.jobStatus === "error"
            ? toReportRecord(latestByFilter, phaseToViewStatus(latestByFilter.phase), {
                isExactMatch: latestByFilter.jobStatus === "ready"
              })
            : toReportRecord(latestByFilter, "generating"),
        reason: latestByFilter.error
      };
    }

    if (latestByFilter && (latestByFilter.jobStatus === "queued" || latestByFilter.jobStatus === "generating")) {
      scheduleReportGeneration(latestByFilter.id);
      return {
        status: "generating",
        phase: latestByFilter.phase,
        cacheKey: latestByFilter.snapshotHash,
        reportId: latestByFilter.id,
        isExactMatch: false,
        report: toReportRecord(latestByFilter, "generating"),
        reason: null
      };
    }

    const reportRow = await createQueuedReport({
      id: randomUUID(),
      filterKey,
      promptVersion: appConfig.reportPromptVersion,
      model: appConfig.openRouterModel,
      filters
    });

    scheduleReportGeneration(reportRow.id);

    return {
      status: "generating",
      phase: "queued",
      cacheKey: null,
      reportId: reportRow.id,
      isExactMatch: false,
      report: toReportRecord(reportRow, "generating"),
      reason: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue report generation.";
    return {
      status: "error",
      phase: "error",
      cacheKey: null,
      reportId: "unavailable",
      isExactMatch: false,
      report: null,
      reason: message
    };
  }
};

export const getReportStatus = async (filters: DashboardFilters): Promise<ReportStatusResponse> => {
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
    openRouterConfigured: Boolean(appConfig.openRouterApiKey),
    reportsEnabled: reportsStoreReady()
  };
};
