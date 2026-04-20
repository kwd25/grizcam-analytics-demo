import type {
  DashboardFilters,
  OperationalReport,
  ReportJobStatus,
  ReportRecord,
  ReportSnapshotSummary,
  ReportViewStatus
} from "@grizcam/shared";
import { pool } from "../db.js";

export type StoredReportRow = {
  id: string;
  normalizedFilterKey: string;
  snapshotHash: string;
  promptVersion: string;
  model: string;
  jobStatus: ReportJobStatus;
  generatedAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  report: OperationalReport | null;
  snapshot: ReportSnapshotSummary | null;
};

const REPORTS_TABLE_SQL = `
  create table if not exists analytics_reports (
    id text primary key,
    normalized_filter_key text not null,
    snapshot_hash text not null,
    prompt_version text not null,
    model text not null,
    status text not null check (status in ('queued', 'generating', 'ready', 'error')),
    filters_json jsonb not null,
    snapshot_json jsonb,
    report_json jsonb,
    error_text text,
    generation_meta_json jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz
  );

  create unique index if not exists analytics_reports_snapshot_cache_idx
    on analytics_reports (snapshot_hash, prompt_version, model);

  create index if not exists analytics_reports_filter_key_idx
    on analytics_reports (normalized_filter_key, updated_at desc);
`;

const mapRow = (row: Record<string, unknown>): StoredReportRow => ({
  id: String(row.id),
  normalizedFilterKey: String(row.normalized_filter_key),
  snapshotHash: String(row.snapshot_hash),
  promptVersion: String(row.prompt_version),
  model: String(row.model),
  jobStatus: String(row.status) as ReportJobStatus,
  generatedAt: row.completed_at ? String(row.completed_at) : null,
  updatedAt: row.updated_at ? String(row.updated_at) : null,
  startedAt: row.started_at ? String(row.started_at) : null,
  completedAt: row.completed_at ? String(row.completed_at) : null,
  error: row.error_text ? String(row.error_text) : null,
  report: (row.report_json as OperationalReport | null) ?? null,
  snapshot: (row.snapshot_json as ReportSnapshotSummary | null) ?? null
});

const selectColumns = `
  select
    id,
    normalized_filter_key,
    snapshot_hash,
    prompt_version,
    model,
    status,
    snapshot_json,
    report_json,
    error_text,
    started_at,
    completed_at,
    updated_at
  from analytics_reports
`;

export const ensureReportsTable = async () => {
  await pool.query(REPORTS_TABLE_SQL);
};

export const getReportById = async (id: string) => {
  const result = await pool.query(`${selectColumns} where id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const findExactReport = async (snapshotHash: string, promptVersion: string, model: string) => {
  const result = await pool.query(
    `${selectColumns}
     where snapshot_hash = $1 and prompt_version = $2 and model = $3
     limit 1`,
    [snapshotHash, promptVersion, model]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const findLatestByFilterKey = async (filterKey: string) => {
  const result = await pool.query(
    `${selectColumns}
     where normalized_filter_key = $1
     order by updated_at desc
     limit 1`,
    [filterKey]
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
};

export const findLatestReadyByFilterKey = async (filterKey: string, excludeId?: string) => {
  const values: string[] = [filterKey];
  let exclusion = "";
  if (excludeId) {
    values.push(excludeId);
    exclusion = "and id <> $2";
  }

  const result = await pool.query(
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

export const createQueuedReport = async (input: {
  id: string;
  filterKey: string;
  snapshotHash: string;
  promptVersion: string;
  model: string;
  filters: DashboardFilters;
  snapshot: ReportSnapshotSummary;
}) => {
  const result = await pool.query(
    `
    insert into analytics_reports (
      id,
      normalized_filter_key,
      snapshot_hash,
      prompt_version,
      model,
      status,
      filters_json,
      snapshot_json,
      updated_at
    )
    values ($1, $2, $3, $4, $5, 'queued', $6::jsonb, $7::jsonb, now())
    on conflict (snapshot_hash, prompt_version, model)
    do update set
      normalized_filter_key = excluded.normalized_filter_key,
      filters_json = excluded.filters_json,
      snapshot_json = excluded.snapshot_json,
      status = 'queued',
      report_json = null,
      error_text = null,
      started_at = null,
      completed_at = null,
      updated_at = now()
    returning *
    `,
    [
      input.id,
      input.filterKey,
      input.snapshotHash,
      input.promptVersion,
      input.model,
      JSON.stringify(input.filters),
      JSON.stringify(input.snapshot)
    ]
  );

  return mapRow(result.rows[0]);
};

export const markReportQueued = async (id: string, filters: DashboardFilters, snapshot: ReportSnapshotSummary) => {
  const result = await pool.query(
    `
    update analytics_reports
    set
      status = 'queued',
      filters_json = $2::jsonb,
      snapshot_json = $3::jsonb,
      report_json = null,
      error_text = null,
      started_at = null,
      completed_at = null,
      updated_at = now()
    where id = $1
    returning *
    `,
    [id, JSON.stringify(filters), JSON.stringify(snapshot)]
  );
  return mapRow(result.rows[0]);
};

export const markReportGenerating = async (id: string) => {
  await pool.query(
    `
    update analytics_reports
    set status = 'generating', started_at = coalesce(started_at, now()), updated_at = now(), error_text = null
    where id = $1
    `,
    [id]
  );
};

export const markReportReady = async (id: string, report: OperationalReport) => {
  const result = await pool.query(
    `
    update analytics_reports
    set
      status = 'ready',
      report_json = $2::jsonb,
      error_text = null,
      completed_at = now(),
      updated_at = now()
    where id = $1
    returning *
    `,
    [id, JSON.stringify(report)]
  );
  return mapRow(result.rows[0]);
};

export const markReportError = async (id: string, error: string) => {
  const result = await pool.query(
    `
    update analytics_reports
    set
      status = 'error',
      error_text = $2,
      completed_at = now(),
      updated_at = now()
    where id = $1
    returning *
    `,
    [id, error]
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
  snapshotHash: row.snapshotHash,
  promptVersion: row.promptVersion,
  model: row.model,
  jobStatus: row.jobStatus,
  viewStatus,
  isRefreshing: options?.isRefreshing ?? false,
  isExactMatch: options?.isExactMatch ?? false,
  generatedAt: row.generatedAt,
  updatedAt: row.updatedAt,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  error: row.error,
  report: row.report,
  snapshot: row.snapshot
});
