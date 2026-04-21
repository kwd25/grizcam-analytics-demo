# GrizCam Analytics Demo

Hosted-demo-ready analytics dashboard for the synthetic Postgres database `grizcam_synthetic_2025`, now split into an operational overview dashboard and a separate Analytics Lab for deeper ML-oriented exploration.

## Stack

- React + TypeScript + Vite
- Tailwind CSS
- React Router
- TanStack Query
- Recharts
- Node + Express + TypeScript
- Vercel-compatible serverless API entrypoint
- PostgreSQL via `pg`
- Shared filter/query types in `packages/shared`

## Project Layout

```text
apps/
  api/
  web/
packages/
  shared/
synthetic/
```

## What It Includes

- URL-backed dashboard filters
- Camera multi-select, date range, time-of-day, subject, and telemetry filters
- Operational overview dashboard with KPI, camera health, pipeline, telemetry, and notable-event sections
- Analytics Lab page for anomaly analysis, forecasting baselines, clustering-style camera groupings, and data-quality/model-readiness checks
- Reports page for cached natural-language operational briefings generated from existing analytics aggregates
- Daily trend, day drilldown, event explorer, and reusable chart/card components across both pages
- Clickable day drilldown panel
- Server-side event explorer with sorting, pagination, debounced text search, and row expansion
- Parameterized SQL throughout the API
- Runtime API base URL for local or hosted deployments
- Demo-safe backend protections: `helmet`, rate limiting, strict env-based origins, read-only API surface

## Local Setup

1. Make sure the local Postgres database already exists:

   - Database: `grizcam_synthetic_2025`
   - Host: `localhost`
   - Port: `5432`

2. Create an env file:

```bash
cp .env.example .env
```

3. Install dependencies:

```bash
npm install
```

## Run In Dev

Run both frontend and backend together:

```bash
npm run dev
```

Default local URLs:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:4000](http://localhost:4000)

If you want to run them separately:

```bash
npm run dev --workspace @grizcam/api
npm run dev --workspace @grizcam/web
```

Local env behavior:

- If `DATABASE_URL` is set, the API uses it.
- Otherwise the API falls back to `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD`.
- Set `OPENROUTER_API_KEY` on the API server to enable the `/query` AI SQL helper and the Reports briefing generator.
- `OPENROUTER_API_KEY` stays server-only and is never exposed to the browser.
- `OPENROUTER_MODEL` defaults to `anthropic/claude-sonnet-4.6` for Reports and can be swapped later without code changes.
- `REPORT_PROMPT_VERSION` lets you invalidate cached reports when the prompt contract changes.
- `REPORTS_DATABASE_URL` is preferred for a dedicated writable reports database.
- If `REPORTS_DATABASE_URL` is not set, Reports falls back to `DATABASE_URL` when that database is writable.
- If the resolved reports database is read-only, Reports stays unavailable with a clear diagnostic instead of failing the whole API.
- Leave `VITE_API_BASE_URL` empty for same-origin `/api` calls.
- Set `VITE_API_BASE_URL=http://localhost:4000` only if you want the frontend to call a separately addressed local API directly instead of using the Vite proxy.

## Build

```bash
npm run build
```

## Public Demo Deployment

This repo is prepared for a Vercel-hosted manager demo:

- Static frontend built from `apps/web`
- Vercel API handler at [`/Users/kyle/grizcam/api/index.js`](/Users/kyle/grizcam/api/index.js)
- Vercel config in [`/Users/kyle/grizcam/vercel.json`](/Users/kyle/grizcam/vercel.json)

Suggested deployment setup:

1. Create a managed Postgres database seeded with the synthetic 2025 tables.
2. Create a read-only database user for analytics reads.
3. Optional but recommended: create a separate writable Postgres database or schema for report jobs/cache. If you skip this, Reports will fall back to `DATABASE_URL` when it is writable.
4. Link the repo to Vercel:

```bash
vercel link
```

4. Add environment variables in Vercel:

```bash
vercel env add NODE_ENV
vercel env add DATABASE_URL
vercel env add ALLOWED_ORIGINS
vercel env add DEMO_EXPORTS_ENABLED
vercel env add API_RATE_LIMIT_WINDOW_MS
vercel env add API_RATE_LIMIT_MAX
vercel env add OPENROUTER_API_KEY
vercel env add OPENROUTER_BASE_URL
vercel env add OPENROUTER_MODEL
vercel env add REPORT_PROMPT_VERSION
vercel env add REPORTS_DATABASE_URL
vercel env add VITE_API_BASE_URL
vercel env add VITE_DEMO_EXPORTS_ENABLED
vercel env add VITE_DEMO_LABEL
vercel env add VITE_APP_TITLE
```

Recommended production values:

```bash
NODE_ENV=production
DATABASE_URL=postgres://readonly_user:password@host:5432/grizcam_demo
REPORTS_DATABASE_URL=postgres://reports_user:password@host:5432/grizcam_reports
ALLOWED_ORIGINS=https://your-project.vercel.app
DEMO_EXPORTS_ENABLED=false
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=120
OPENROUTER_API_KEY=your_openrouter_server_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6
REPORT_PROMPT_VERSION=v1
VITE_API_BASE_URL=
VITE_DEMO_EXPORTS_ENABLED=false
VITE_DEMO_LABEL=Synthetic data demo
VITE_APP_TITLE=GrizCam Demo | Yellowstone 2025 Analytics
```

5. Optional manual migration if you want to pre-create the reports table yourself:

```bash
psql "$REPORTS_DATABASE_URL" -f apps/api/migrations/001_analytics_reports.sql
```

The API now auto-ensures `analytics_reports` on startup for the active writable reports connection, so this step is optional for the demo deployment.
If you are using `DATABASE_URL` as the reports fallback, run the SQL against that database instead.

6. Deploy:

```bash
vercel deploy
vercel deploy --prod
```

Notes:

- Leave `VITE_API_BASE_URL` empty on Vercel to use same-origin `/api`.
- `DATABASE_URL` can remain read-only when you provide a separate writable `REPORTS_DATABASE_URL`.
- If you want Reports to fall back to `DATABASE_URL`, that database must be writable.
- `REPORTS_DATABASE_URL` should point at a writable database for report cache/job state when you want a dedicated reports store.
- If `REPORTS_DATABASE_URL` is unset, `DATABASE_URL` is used for reports when it is writable.
- CSV export is disabled by default for the public demo.
- You can still use `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` locally if you do not want a local `DATABASE_URL`.
- The production API expects `DATABASE_URL` and `ALLOWED_ORIGINS`.

## Required Environment Variables

Supported variables:

- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`
- `ALLOWED_ORIGINS`
- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`
- `REPORT_PROMPT_VERSION`
- `REPORTS_DATABASE_URL`
- `VITE_API_BASE_URL`
- `DEMO_EXPORTS_ENABLED`
- `NODE_ENV`

Frontend/demo variables:

- `VITE_DEMO_EXPORTS_ENABLED`
- `VITE_DEMO_LABEL`
- `VITE_APP_TITLE`

Recommended minimum Vercel set:

- `NODE_ENV`
- `DATABASE_URL`
- `ALLOWED_ORIGINS`
- `DEMO_EXPORTS_ENABLED`
- `API_RATE_LIMIT_WINDOW_MS`
- `API_RATE_LIMIT_MAX`
- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`
- `REPORT_PROMPT_VERSION`
- `REPORTS_DATABASE_URL`
- `VITE_API_BASE_URL`
- `VITE_DEMO_EXPORTS_ENABLED`
- `VITE_DEMO_LABEL`
- `VITE_APP_TITLE`

## Key API Routes

- `GET /api/health`
- `GET /api/devices`
- `GET /api/filters/options`
- `GET /api/kpis`
- `GET /api/charts/daily-activity`
- `GET /api/charts/hourly-heatmap`
- `GET /api/charts/time-of-day-composition`
- `GET /api/charts/subject-by-camera`
- `GET /api/charts/composition`
- `GET /api/overview`
- `GET /api/analytics-lab`
- `GET /api/day/:date/summary`
- `GET /api/events`
- `POST /api/query/generate-sql`
- `GET /api/reports/latest`
- `GET /api/reports/status`
- `GET /api/reports/health`
- `POST /api/reports/generate`

The query page also includes a single-turn AI SQL helper. It sends a natural-language request to the backend, the backend calls OpenRouter with the server-side GrizCam schema briefing, then the generated SQL is inserted into the editor and pushed through the existing validator and query runner.

`GET /api/events/export` exists but is disabled by default for the public demo unless `DEMO_EXPORTS_ENABLED=true`.

## Reports Briefing Cache

- Report generation reuses the existing `overview` and `analytics-lab` aggregates instead of shipping raw events to the model.
- The backend queues report work first, then builds the analytics snapshot and computes the hash inside the background worker.
- Exact hash matches reuse an already-ready report without another model call.
- If the current filter key has an older ready report while a new snapshot is regenerating, the UI shows that stale report with a refresh indicator and current phase label.
- Reports storage prefers a separate writable database via `REPORTS_DATABASE_URL`, but can fall back to `DATABASE_URL` when that database is writable.
- The API auto-ensures the reports table on startup for the active writable reports connection, and does not create it on every request.
- If persistent reports storage is unavailable, the Reports page can still generate the first report on demand without saving it.
- In that fallback mode, reports are not retained across refreshes or serverless cold starts and background prefetch is disabled.

All chart and event endpoints accept the dashboard filter params:

- `camera_name`
- `mac`
- `start_date`
- `end_date`
- `time_of_day_bucket`
- `subject_category`
- `subject_class`
- `q`
- `min_lux` / `max_lux`
- `min_temperature` / `max_temperature`
- `min_heat_level` / `max_heat_level`

## Assumptions

- Unique event groups are modeled as `count(distinct event)`.
- Default filters are all cameras and the full 2025 date range.
- The API reads the existing database directly and does not mutate schema.
- Event timestamps are exposed as Yellowstone-local wall-clock strings from the stored `timestamp` column.
- The hosted demo uses synthetic data only and does not require login for v1.
- Production deployments should use read-only analytics access unless they intentionally rely on writable `DATABASE_URL` as the reports fallback.

## Verification

- `npm run typecheck`
- `npm run build`

## Manager Demo Checklist

- Hosted Postgres contains `events`, `dim_devices`, and `daily_camera_summary`
- Demo API user is read-only unless you intentionally rely on writable `DATABASE_URL` for Reports fallback
- Vercel env vars are set
- `DEMO_EXPORTS_ENABLED=false`
- The app opens with a polished default overview
- At least one saved/shareable filtered URL is ready to send

## Post-Deploy Smoke Test

1. Open the deployed homepage and confirm the KPI strip loads.
2. Confirm charts render and filters update the URL.
3. Open a day drilldown from the daily trend chart.
4. Search the event explorer and paginate once.
5. Confirm `/api/health` returns `{"ok":true,...}`.
6. Confirm `/api/events/export` returns a disabled response unless you intentionally enabled it.

## Manual Steps Still Required

- Provision a hosted Postgres instance
- Seed/import the synthetic dataset into hosted Postgres
- Create a read-only database user for the demo API
- Run `vercel link`
- Set Vercel environment variables
- Trigger the first preview and production deploy
