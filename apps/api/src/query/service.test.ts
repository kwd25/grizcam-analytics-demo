import assert from "node:assert/strict";
import test from "node:test";
import { validateQuerySql } from "./service.js";

const issueCodes = (sql: string) => validateQuerySql(sql).issues.map((issue) => issue.code);

test("accepts computed select alias in ORDER BY", () => {
  const sql = `
    select
      d.camera_name,
      s.total_rows,
      s.unique_event_groups,
      s.total_rows - s.unique_event_groups as diff
    from daily_camera_summary s
    join dim_devices d on d.mac = s.mac
    where s.date >= '2025-12-18' and s.date <= '2025-12-31'
    order by diff desc
    limit 20
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.ok(result.normalizedSql);
});

test("accepts aggregate alias in ORDER BY", () => {
  const sql = `
    select
      d.camera_name,
      sum(s.unique_event_groups) as total_event_groups
    from daily_camera_summary s
    join dim_devices d on d.mac = s.mac
    where s.date >= current_date - interval '30 days'
    group by d.camera_name
    order by total_event_groups desc
    limit 10
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("accepts repeated computed expression in ORDER BY", () => {
  const sql = `
    select
      d.camera_name,
      s.total_rows,
      s.unique_event_groups,
      s.total_rows - s.unique_event_groups as diff
    from daily_camera_summary s
    join dim_devices d on d.mac = s.mac
    order by s.total_rows - s.unique_event_groups desc
    limit 20
  `;

  assert.equal(validateQuerySql(sql).ok, true);
});

test("accepts valid ORDER BY ordinal", () => {
  const sql = `
    select
      d.camera_name,
      sum(s.unique_event_groups) as total_event_groups
    from daily_camera_summary s
    join dim_devices d on d.mac = s.mac
    group by d.camera_name
    order by 2 desc
    limit 10
  `;

  assert.equal(validateQuerySql(sql).ok, true);
});

test("rejects invalid ORDER BY ordinal outside select range", () => {
  const sql = `
    select
      camera_name
    from dim_devices
    order by 2 desc
    limit 10
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "INVALID_QUERY" && issue.message.includes("ORDER BY position 2")));
});

test("rejects ORDER BY alias that does not resolve to a select projection", () => {
  const sql = `
    select
      d.camera_name,
      s.total_rows - s.unique_event_groups as diff
    from daily_camera_summary s
    join dim_devices d on d.mac = s.mac
    order by total_event_groups desc
    limit 20
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "COLUMN_NOT_ALLOWED" && issue.message.includes("total_event_groups")));
});

test("rejects schema-qualified allowlisted function in ORDER BY", () => {
  const sql = `
    select
      d.camera_name,
      sum(s.unique_event_groups) as total_event_groups
    from daily_camera_summary s
    join dim_devices d on d.mac = s.mac
    group by d.camera_name
    order by pg_catalog.sum(s.unique_event_groups) desc
    limit 10
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "SYSTEM_SCHEMA_BLOCKED" && issue.message.includes("pg_catalog")));
});

test("rejects blocked schema reference inside ORDER BY subquery", () => {
  const sql = `
    select
      camera_name
    from dim_devices
    order by (select count(*) from information_schema.tables) desc
    limit 10
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "SYSTEM_SCHEMA_BLOCKED"));
});

test("still rejects select star from events", () => {
  const sql = `
    select *
    from events
    order by timestamp desc
    limit 10
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "SELECT_ALL_NOT_ALLOWED"));
});

test("still rejects window functions", () => {
  const sql = `
    select
      camera_name,
      row_number() over (order by camera_name) as rn
    from dim_devices
    limit 10
  `;

  const result = validateQuerySql(sql);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "FUNCTION_NOT_ALLOWED"));
});

test("still rejects non-read-only sql", () => {
  const result = validateQuerySql("delete from events");
  assert.equal(result.ok, false);
  assert.ok(issueCodes("delete from events").some((code) => code === "UNSAFE_KEYWORD" || code === "NON_SELECT_NOT_ALLOWED"));
});

test("accepts alias backed by safe ratio expression", () => {
  const sql = `
    select
      camera_name,
      wildlife_rows::numeric / nullif(total_rows, 0) as wildlife_ratio
    from daily_camera_summary
    order by wildlife_ratio desc
    limit 20
  `;

  assert.equal(validateQuerySql(sql).ok, true);
});

test("accepts alias backed by safe coalesce/case expression", () => {
  const sql = `
    select
      camera_name,
      case
        when coalesce(avg_lux, 0) < 20 then 'dark'
        else 'bright'
      end as light_band
    from daily_camera_summary
    order by light_band asc
    limit 20
  `;

  assert.equal(validateQuerySql(sql).ok, true);
});
