import type {
  DashboardFilters,
  OperationalReport,
  ReportDebug,
  ReportJobStatus,
  ReportPhase,
  ReportRecord,
  ReportSnapshotSummary,
  ReportViewStatus
} from "@grizcam/shared";
import { reportsPool } from "../db.js";

export type StoredReportRow = {
  id: string;
  normalizedFilterKey: string;
  snapshotHash: string | null;
  promptVersion: string;
  model: string;
  filters: DashboardFilters;
  jobStatus: ReportJobStatus;
  phase: ReportPhase;
  generatedAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  report: OperationalReport | null;
  snapshot: ReportSnapshotSummary | null;
  debug: ReportDebug | null;
};

const selectColumns = `
  select
    id,
    normalized_filter_key,
    snapshot_hash,
    prompt_version,
    model,
    status,
    phase,
    filters_json,
    snapshot_json,
    report_json,
    error_text,
    generation_meta_json,
    started_at,
    completed_at,
    updated_at
  from analytics_reports
`;

export const reportsStoreConfigured = () => Boolean(reportsPool);

const requireReportsPool = () => {
  if (!reportsPool) {
    throw new Error("Reports storage is not configured.");
  }
  return reportsPool;
};

const mapRow = (row: Record<string, unknown>): StoredReportRow => ({
  id: String(row.id),
  normalizedFilterKey: String(row.normalized_filter_key),
  snapshotHash: row.snapshot_hash ? String(row.snapshot_hash) : null,
  promptVersion: String(row.prompt_version),
  model: String(row.model),
  filters: row.filters_json as DashboardFilters,
  jobStatus: String(row.status) as ReportJobStatus,
  phase: String(row.phase) as ReportPhase,
  generatedAt: row.completed_at ? String(row.completed_at) : null,
  updatedAt: row.updated_at ? String(row.updated_at) : null,
  startedAt: row.started_at ? String(row.started_at) : null,
  completedAt: row.completed_at ? String(row.completed_at) : null,
  error: row.error_text ? String(row.error_text) : null,
  report: (row.report_json as OperationalReport | null) ?? null,
  snapshot: (row.snapshot_json as ReportSnapshotSummary | null) ?? null,
  debug: (row.generation_meta_json as ReportDebug | null) ?? null
});

const mergeDebug = (current: ReportDebug | null | undefined, patch: Partial<ReportDebug>): ReportDebug => ({
  lastErrorCode: patch.lastErrorCode ?? current?.lastErrorCode ?? null,
  lastErrorMessage: patch.lastErrorMessage ?? current?.lastErrorMessage ?? null,
  timingMs: {
    ...(current?.timingMs ?? {}),
    ...(patch.timingMs ?? {})
  }
});

export const getReportById = async (id: string) => {
  if (!reportsPool) {
    return null;
  }

  const result = await requireReportsPool().query(`${selectColumns} where id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const findLatestByFilterKey = async (filterKey: string) => {
  if (!reportsPool) {
    return null;
  }

  const result = await requireReportsPool().query(
    `${selectColumns}
     where normalized_filter_key = $1
     order by updated_at desc
     limit 1`,
    [filterKey]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const findLatestReadyByFilterKey = async (filterKey: string, excludeId?: string) => {
  if (!reportsPool) {
    return null;
  }

  const values: string[] = [filterKey];
  let exclusion = "";
  if (excludeId) {
    values.push(excludeId);
    exclusion = "and id <> $2";
  }

  const result = await requireReportsPool().query(
    `${selectColumns}
     where normalized_filter_key = $1
       and status = 'ready'
       ${exclusion}
     order by completed_at desc nulls last, updated_at desc
     limit 1`,
    values
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const findExactReadyReport = async (snapshotHash: string, promptVersion: string, model: string, excludeId?: string) => {
  if (!reportsPool) {
    return null;
  }

  const values = [snapshotHash, promptVersion, model];
  let exclusion = "";
  if (excludeId) {
    values.push(excludeId);
    exclusion = "and id <> $4";
  }

  const result = await requireReportsPool().query(
    `${selectColumns}
     where snapshot_hash = $1
       and prompt_version = $2
       and model = $3
       and status = 'ready'
       ${exclusion}
     limit 1`,
    values
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const createQueuedReport = async (input: {
  id: string;
  filterKey: string;
  promptVersion: string;
  model: string;
  filters: DashboardFilters;
}) => {
  const result = await requireReportsPool().query(
    `
    insert into analytics_reports (
      id,
      normalized_filter_key,
      prompt_version,
      model,
      status,
      phase,
      filters_json,
      generation_meta_json,
      updated_at
    )
    values ($1, $2, $3, $4, 'queued', 'queued', $5::jsonb, $6::jsonb, now())
    returning *
    `,
    [input.id, input.filterKey, input.promptVersion, input.model, JSON.stringify(input.filters), JSON.stringify({ timingMs: {} })]
  );

  return mapRow(result.rows[0]);
};

export const updateReportPhase = async (
  id: string,
  input: {
    jobStatus?: ReportJobStatus;
    phase: ReportPhase;
    snapshotHash?: string | null;
    snapshot?: ReportSnapshotSummary | null;
    report?: OperationalReport | null;
    error?: string | null;
    debugPatch?: Partial<ReportDebug>;
    started?: boolean;
    completed?: boolean;
  }
) => {
  const current = await getReportById(id);
  if (!current) {
    return null;
  }

  const debug = mergeDebug(current.debug, input.debugPatch ?? {});
  const result = await requireReportsPool().query(
    `
    update analytics_reports
    set
      status = $2,
      phase = $3,
      snapshot_hash = $4,
      snapshot_json = $5::jsonb,
      report_json = $6::jsonb,
      error_text = $7,
      generation_meta_json = $8::jsonb,
      started_at = case when $9::boolean then coalesce(started_at, now()) else started_at end,
      completed_at = case when $10::boolean then now() else completed_at end,
      updated_at = now()
    where id = $1
    returning *
    `,
    [
      id,
      input.jobStatus ?? current.jobStatus,
      input.phase,
      input.snapshotHash ?? current.snapshotHash,
      JSON.stringify(input.snapshot ?? current.snapshot),
      JSON.stringify(input.report ?? current.report),
      input.error ?? null,
      JSON.stringify(debug),
      Boolean(input.started),
      Boolean(input.completed)
    ]
  );

  return mapRow(result.rows[0]);
};

export const toReportRecord = (
  row: StoredReportRow,
  viewStatus: ReportViewStatus,
  options?: { isRefreshing?: boolean; isExactMatch?: boolean }
): ReportRecord => ({
  id: row.id,
  normalizedFilterKey: row.normalizedFilterKey,
  sourceMode: "persistent",
  snapshotHash: row.snapshotHash,
  promptVersion: row.promptVersion,
  model: row.model,
  jobStatus: row.jobStatus,
  viewStatus,
  isRefreshing: options?.isRefreshing ?? false,
  isExactMatch: options?.isExactMatch ?? false,
  phase: row.phase,
  generatedAt: row.generatedAt,
  updatedAt: row.updatedAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  error: row.error,
  report: row.report,
  snapshot: row.snapshot,
  debug: row.debug
});
