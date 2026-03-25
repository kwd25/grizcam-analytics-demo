import type { DashboardFilters, EventQuery, EventSortField } from "@grizcam/shared";

type SqlFragment = {
  text: string;
  values: unknown[];
};

const eventSortColumns: Record<EventSortField, string> = {
  timestamp: 'e."timestamp"',
  camera_name: "e.camera_name",
  event: "e.event",
  sequence: "e.sequence",
  subject_class: "e.subject_class",
  subject_category: "e.subject_category",
  lux: "e.lux",
  temperature: "e.temperature",
  heat_level: "e.heat_level"
};

export const buildFilterClause = (filters: DashboardFilters, alias = "e"): SqlFragment => {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const pushCondition = (sql: string, value?: unknown) => {
    if (value !== undefined) {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    } else {
      conditions.push(sql);
    }
  };

  if (filters.camera_name.length > 0) {
    values.push(filters.camera_name);
    conditions.push(`${alias}.camera_name = ANY($${values.length}::text[])`);
  }

  if (filters.mac.length > 0) {
    values.push(filters.mac);
    conditions.push(`${alias}.mac = ANY($${values.length}::text[])`);
  }

  if (filters.start_date) {
    pushCondition(`${alias}."timestamp"::date >= ?::date`, filters.start_date);
  }

  if (filters.end_date) {
    pushCondition(`${alias}."timestamp"::date <= ?::date`, filters.end_date);
  }

  if (filters.time_of_day_bucket.length > 0) {
    values.push(filters.time_of_day_bucket);
    conditions.push(`${alias}.time_of_day_bucket = ANY($${values.length}::text[])`);
  }

  if (filters.subject_category.length > 0) {
    values.push(filters.subject_category);
    conditions.push(`${alias}.subject_category = ANY($${values.length}::text[])`);
  }

  if (filters.subject_class.length > 0) {
    values.push(filters.subject_class);
    conditions.push(`${alias}.subject_class = ANY($${values.length}::text[])`);
  }

  if (filters.q) {
    values.push(`%${filters.q}%`);
    conditions.push(`(coalesce(${alias}.analysis_title, '') ILIKE $${values.length} OR coalesce(${alias}.analysis_summary, '') ILIKE $${values.length})`);
  }

  if (filters.min_lux !== undefined) {
    pushCondition(`${alias}.lux >= ?`, filters.min_lux);
  }

  if (filters.max_lux !== undefined) {
    pushCondition(`${alias}.lux <= ?`, filters.max_lux);
  }

  if (filters.min_temperature !== undefined) {
    pushCondition(`${alias}.temperature >= ?`, filters.min_temperature);
  }

  if (filters.max_temperature !== undefined) {
    pushCondition(`${alias}.temperature <= ?`, filters.max_temperature);
  }

  if (filters.min_heat_level !== undefined) {
    pushCondition(`${alias}.heat_level >= ?`, filters.min_heat_level);
  }

  if (filters.max_heat_level !== undefined) {
    pushCondition(`${alias}.heat_level <= ?`, filters.max_heat_level);
  }

  return {
    text: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "",
    values
  };
};

export const getEventOrderBy = (query: EventQuery) => {
  const column = eventSortColumns[query.sort_by];
  const direction = query.sort_dir === "asc" ? "asc" : "desc";
  return `order by ${column} ${direction}, e.id asc`;
};

export const mapEventRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  timestamp: String(row.timestamp),
  cameraName: row.camera_name ? String(row.camera_name) : "",
  mac: String(row.mac),
  event: String(row.event),
  sequence: Number(row.sequence),
  subjectClass: row.subject_class ? String(row.subject_class) : null,
  subjectCategory: row.subject_category ? String(row.subject_category) : null,
  timeOfDayBucket: row.time_of_day_bucket ? String(row.time_of_day_bucket) : null,
  analysisTitle: row.analysis_title ? String(row.analysis_title) : null,
  analysisSummary: row.analysis_summary ? String(row.analysis_summary) : null,
  lux: row.lux === null ? null : Number(row.lux),
  temperature: row.temperature === null ? null : Number(row.temperature),
  heatLevel: row.heat_level === null ? null : Number(row.heat_level),
  sensor: String(row.sensor),
  location: row.location ? String(row.location) : null,
  batteryPercentage: row.battery_percentage === null ? null : Number(row.battery_percentage),
  filename: row.filename ? String(row.filename) : null,
  imageBlobUrl: row.image_blob_url ? String(row.image_blob_url) : null
});

