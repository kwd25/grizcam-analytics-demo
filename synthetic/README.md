# Synthetic Yellowstone Seeder

This module creates a brand-new local Postgres database, builds a small analytics-friendly schema, and seeds deterministic synthetic Yellowstone event data for the full 2025 calendar year.

The generated raw `events` table stays close to the existing GrizCam export shape while adding a few analytics columns:
- `subject_class`
- `subject_category`
- `time_of_day_bucket`
- `camera_name`

Time handling assumptions:
- Yellowstone local time is modeled with `America/Denver`.
- `timestamp` stores local Yellowstone wall-clock time as a naive Postgres `TIMESTAMP`.
- `utc_timestamp` stores the UTC equivalent, also as a naive Postgres `TIMESTAMP`.
- This keeps the data easy to work with in Metabase while preserving the logical relationship between local and UTC values.

## Run

With CLI flags:

```bash
python3 -m synthetic.generate_synthetic_events \
  --host localhost \
  --port 5432 \
  --admin-dbname postgres \
  --user "$USER" \
  --password "" \
  --target-dbname grizcam_synthetic_2025 \
  --drop-existing true
```

With environment variables:

```bash
export GRIZCAM_PG_HOST=localhost
export GRIZCAM_PG_PORT=5432
export GRIZCAM_PG_ADMIN_DB=postgres
export GRIZCAM_PG_USER="$USER"
export GRIZCAM_PG_PASSWORD=""
export GRIZCAM_SYNTHETIC_DB=grizcam_synthetic_2025
export GRIZCAM_SYNTHETIC_SEED=20250325
export GRIZCAM_SYNTHETIC_DROP_EXISTING=true

python3 -m synthetic.generate_synthetic_events
```

The script prints:
- database name
- total raw rows
- total unique event groups
- rows by device
- rows by time-of-day bucket
- estimated database size

