import { randomUUID } from "node:crypto";
import type {
  DashboardFilters,
  GetReportResponse,
  ReportStatusResponse,
  TriggerReportResponse
} from "@grizcam/shared";
import { appConfig } from "../config.js";
import { getAnalyticsLab, getOverview } from "../queries/dashboard.js";
import { createOpenRouterReportClient } from "./openrouter.js";
import { buildReportFilterKey, buildReportSnapshot, hashReportSnapshot } from "./snapshot.js";
import {
  createQueuedReport,
  ensureReportsTable,
  findExactReport,
  findLatestByFilterKey,
  findLatestReadyByFilterKey,
  getReportById,
  markReportError,
  markReportGenerating,
  markReportQueued,
  markReportReady,
  toReportRecord,
  type StoredReportRow
} from "./storage.js";

const inflightReportIds = new Set<string>();
const reportClient = createOpenRouterReportClient();

type PreparedReportContext = {
  filters: DashboardFilters;
  filterKey: string;
  snapshotHash: string;
  snapshot: ReturnType<typeof buildReportSnapshot>;
};

const prepareReportContext = async (filters: DashboardFilters): Promise<PreparedReportContext> => {
  const [overview, analytics] = await Promise.all([getOverview(filters), getAnalyticsLab(filters)]);
  const snapshot = buildReportSnapshot(filters, overview, analytics);
  const filterKey = buildReportFilterKey(filters);
  const snapshotHash = hashReportSnapshot(snapshot, appConfig.reportPromptVersion, appConfig.openRouterModel);

  return {
    filters,
    filterKey,
    snapshotHash,
    snapshot
  };
};

export const selectLatestReportView = (input: {
  exact: StoredReportRow | null;
  latestByFilter: StoredReportRow | null;
  staleReady: StoredReportRow | null;
}): GetReportResponse => {
  const cacheKey = input.exact?.snapshotHash ?? input.latestByFilter?.snapshotHash ?? input.staleReady?.snapshotHash ?? "pending";

  if (input.exact?.jobStatus === "ready") {
    return {
      status: "ready",
      cacheKey,
      latest: toReportRecord(input.exact, "ready", { isExactMatch: true })
    };
  }

  if (input.exact && (input.exact.jobStatus === "queued" || input.exact.jobStatus === "generating")) {
    const stale = input.staleReady ? toReportRecord(input.staleReady, "stale", { isRefreshing: true }) : null;
    return {
      status: stale ? "stale" : "generating",
      cacheKey,
      latest: toReportRecord(input.exact, stale ? "stale" : "generating", { isExactMatch: true, isRefreshing: Boolean(stale) }),
      stale
    };
  }

  if (input.exact?.jobStatus === "error") {
    const stale = input.staleReady ? toReportRecord(input.staleReady, "stale", { isRefreshing: false }) : null;
    return {
      status: stale ? "stale" : "error",
      cacheKey,
      latest: toReportRecord(input.exact, stale ? "stale" : "error", { isExactMatch: true }),
      stale
    };
  }

  if (input.latestByFilter && (input.latestByFilter.jobStatus === "queued" || input.latestByFilter.jobStatus === "generating")) {
    const stale = input.staleReady ? toReportRecord(input.staleReady, "stale", { isRefreshing: true }) : null;
    return {
      status: stale ? "stale" : "generating",
      cacheKey,
      latest: toReportRecord(input.latestByFilter, stale ? "stale" : "generating", { isRefreshing: Boolean(stale) }),
      stale
    };
  }

  if (input.latestByFilter?.jobStatus === "ready") {
    return {
      status: "ready",
      cacheKey,
      latest: toReportRecord(input.latestByFilter, "ready")
    };
  }

  if (input.latestByFilter?.jobStatus === "error") {
    return {
      status: "error",
      cacheKey,
      latest: toReportRecord(input.latestByFilter, "error")
    };
  }

  return {
    status: "generating",
    cacheKey,
    latest: null
  };
};

const scheduleReportGeneration = (reportId: string) => {
  if (inflightReportIds.has(reportId)) {
    return;
  }

  inflightReportIds.add(reportId);
  setTimeout(async () => {
    try {
      const row = await getReportById(reportId);
      if (!row || !row.snapshot) {
        return;
      }

      await markReportGenerating(reportId);
      const report = await reportClient.generateReport(row.snapshot);
      await markReportReady(reportId, report);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Report generation failed.";
      await markReportError(reportId, message);
    } finally {
      inflightReportIds.delete(reportId);
    }
  }, 0);
};

export const getLatestReport = async (filters: DashboardFilters): Promise<GetReportResponse> => {
  await ensureReportsTable();
  const context = await prepareReportContext(filters);
  const [exact, latestByFilter] = await Promise.all([
    findExactReport(context.snapshotHash, appConfig.reportPromptVersion, appConfig.openRouterModel),
    findLatestByFilterKey(context.filterKey)
  ]);
  const staleReady = await findLatestReadyByFilterKey(context.filterKey, exact?.id ?? latestByFilter?.id);

  return selectLatestReportView({
    exact,
    latestByFilter,
    staleReady
  });
};

export const triggerReportGeneration = async (filters: DashboardFilters, force = false): Promise<TriggerReportResponse> => {
  await ensureReportsTable();
  const context = await prepareReportContext(filters);
  const existing = await findExactReport(context.snapshotHash, appConfig.reportPromptVersion, appConfig.openRouterModel);

  if (existing && !force) {
    if (existing.jobStatus === "queued" || existing.jobStatus === "generating") {
      scheduleReportGeneration(existing.id);
    }

    return {
      status: existing.jobStatus,
      cacheKey: context.snapshotHash,
      reportId: existing.id,
      isExactMatch: true,
      report:
        existing.jobStatus === "ready"
          ? toReportRecord(existing, "ready", { isExactMatch: true })
          : existing.jobStatus === "error"
            ? toReportRecord(existing, "error", { isExactMatch: true })
            : toReportRecord(existing, "generating", { isExactMatch: true })
    };
  }

  const reportRow = existing
    ? await markReportQueued(existing.id, context.filters, context.snapshot)
    : await createQueuedReport({
        id: randomUUID(),
        filterKey: context.filterKey,
        snapshotHash: context.snapshotHash,
        promptVersion: appConfig.reportPromptVersion,
        model: appConfig.openRouterModel,
        filters: context.filters,
        snapshot: context.snapshot
      });

  scheduleReportGeneration(reportRow.id);

  return {
    status: reportRow.jobStatus,
    cacheKey: context.snapshotHash,
    reportId: reportRow.id,
    isExactMatch: true,
    report: null
  };
};

export const getReportStatus = async (filters: DashboardFilters): Promise<ReportStatusResponse> => {
  await ensureReportsTable();
  const latest = await getLatestReport(filters);
  return {
    status: latest.status,
    cacheKey: latest.cacheKey,
    current: latest.latest,
    stale: latest.stale ?? null
  };
};
