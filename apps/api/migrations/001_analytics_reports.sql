create table if not exists analytics_reports (
  id text primary key,
  normalized_filter_key text not null,
  snapshot_hash text,
  prompt_version text not null,
  model text not null,
  status text not null check (status in ('queued', 'generating', 'ready', 'error')),
  phase text not null check (phase in ('idle', 'disabled', 'queued', 'building_snapshot', 'calling_model', 'validating_response', 'ready', 'error')),
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
  on analytics_reports (snapshot_hash, prompt_version, model)
  where snapshot_hash is not null;

create index if not exists analytics_reports_filter_key_idx
  on analytics_reports (normalized_filter_key, updated_at desc);
