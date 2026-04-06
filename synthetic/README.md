# Synthetic Yellowstone Seeder

This module creates deterministic Yellowstone synthetic event data for the full 2025 calendar year, seeds a local Postgres database, and now also exports a raw-style JSON dataset for ops demos.

The generated `events` table preserves the analytics-friendly columns used by the dashboard while also carrying a much richer raw-event shape. The synthetic raw export intentionally includes operational fields such as:
- `utc_timestamp_off`
- `timezone`
- `tag`
- `upload`
- `uploaded`
- `created`
- `ai_processed`
- `ai_timestamp`
- `json_processed`
- `json_timestamp`
- `analysis`
- `ai_description`
- `bearing`
- `batteryPercentage`
- `heatLevel`

The generator intentionally excludes Azure/Cosmos system metadata such as `_rid`, `_self`, `_etag`, `_attachments`, and `_ts`.

Messiness patterns are deliberate rather than random:
- some missing AI / JSON processing
- variable upload and processing lag
- controlled telemetry drift and stale burst telemetry
- occasional battery, lux, humidity, temperature, and pressure anomalies
- camera-specific operational personalities

Time handling assumptions:
- Yellowstone local time is modeled with `America/Denver`.
- `timestamp` stores local Yellowstone wall-clock time as a naive Postgres `TIMESTAMP`.
- `utc_timestamp` stores the UTC equivalent, also as a naive Postgres `TIMESTAMP`.
- `utc_timestamp_off` and `timezone` reflect the same local-to-UTC mapping in the raw export, with a very small minority of intentionally messy rows.
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
  --drop-existing true \
  --json-output synthetic/generated_raw_events.json.gz
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
export GRIZCAM_SYNTHETIC_JSON_OUTPUT=synthetic/generated_raw_events.json.gz

python3 -m synthetic.generate_synthetic_events
```

To export the raw JSON without requiring a local Postgres instance:

```bash
python3 -m synthetic.generate_synthetic_events \
  --skip-db true \
  --json-output synthetic/generated_raw_events.json.gz
```

The script prints:
- database name
- total raw rows
- total unique event groups
- rows by device
- rows by time-of-day bucket
- estimated database size

## Developer Note

Fields added:
- raw pipeline fields for upload / AI / JSON processing state and timestamps
- raw capture fields such as `utc_timestamp_off`, `timezone`, `tag`, and `bearing`
- raw analysis fields `analysis` and `ai_description`
- camelCase raw telemetry aliases such as `batteryPercentage`, `heatLevel`, and `fileType`

Excluded metadata:
- `_rid`
- `_self`
- `_etag`
- `_attachments`
- `_ts`

Intentional messiness:
- variable ingestion and processing lag, including backlog spikes
- missing AI / JSON outputs on a minority of rows
- inconsistent `upload` string values compared with boolean `uploaded`
- burst-level repeated telemetry and partial within-burst drift
- occasional suspicious battery values and environmental outliers

Camera behavior patterns:
- `Lamar Valley North`: darker low-lux wildlife corridor with slightly low voltage
- `Hayden Valley South`: highest weather volatility
- `Mammoth Trail Edge`: more frequent missing AI / JSON results
- `Old Faithful Perimeter`: heavier upload lag and backlog behavior
- `Yellowstone Lake Overlook`: under-volted camera with more battery weirdness and lakeside humidity spikes
