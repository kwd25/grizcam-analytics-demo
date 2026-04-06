import type { DashboardFilters, EventQuery, EventSortField } from "@grizcam/shared";

type SqlFragment = {
  text: string;
  values: unknown[];
};

const blankToNullSql = (value: string) => `nullif(btrim(${value}), '')`;
const replaceSpacesSql = (value: string) => `replace(lower(${value}), ' ', '_')`;
const parseAiDescriptionSql = (alias: string) =>
  `case when ${alias}.ai_description is not null and left(ltrim(${alias}.ai_description), 1) = '{' then ${alias}.ai_description::jsonb else null end`;

export const normalizedAnalysisSql = (alias = "e") => `coalesce(${alias}.analysis, ${parseAiDescriptionSql(alias)})`;

const subjectSignalSql = (alias = "e") => `lower(concat_ws(' ',
  ${blankToNullSql(`${alias}.subject_class`)},
  ${blankToNullSql(`${alias}.subject_category`)},
  ${blankToNullSql(`${normalizedAnalysisSql(alias)}->'details'->>'main_subject'`)},
  ${blankToNullSql(`${normalizedAnalysisSql(alias)}->'keywords'->>'Animals'`)},
  ${blankToNullSql(`${normalizedAnalysisSql(alias)}->'keywords'->>'People'`)},
  ${blankToNullSql(`${normalizedAnalysisSql(alias)}->'keywords'->>'Threats'`)},
  ${blankToNullSql(`${normalizedAnalysisSql(alias)}->>'title'`)},
  ${blankToNullSql(`${normalizedAnalysisSql(alias)}->>'summary'`)}
))`;

export const normalizedTimestampSql = (alias = "e") =>
  `coalesce(${alias}."timestamp", ${alias}.utc_timestamp_off, ${alias}.utc_timestamp, ${alias}.created, ${alias}.ai_timestamp, ${alias}.json_timestamp)`;

export const normalizedCameraNameSql = (alias = "e") =>
  `coalesce(${blankToNullSql(`${alias}.camera_name`)}, ${blankToNullSql(`${alias}.name`)}, ${alias}.mac)`;

export const normalizedEventSql = (alias = "e") =>
  `coalesce(${blankToNullSql(`${alias}.event`)}, ${blankToNullSql(`${alias}.id`)})`;

export const normalizedAnalysisTitleSql = (alias = "e") =>
  `coalesce(${blankToNullSql(`${alias}.analysis_title`)}, ${blankToNullSql(`${normalizedAnalysisSql(alias)}->>'title'`)})`;

export const normalizedAnalysisSummarySql = (alias = "e") =>
  `coalesce(${blankToNullSql(`${alias}.analysis_summary`)}, ${blankToNullSql(`${normalizedAnalysisSql(alias)}->>'summary'`)})`;

export const normalizedBatteryPercentageSql = (alias = "e") =>
  `coalesce(${alias}.battery_percentage, ${alias}."batteryPercentage")`;

export const normalizedHeatLevelSql = (alias = "e") => `coalesce(${alias}.heat_level, ${alias}."heatLevel")`;

export const normalizedSubjectClassSql = (alias = "e") => {
  const source = subjectSignalSql(alias);
  return `
    case
      when ${blankToNullSql(`${alias}.subject_class`)} is not null then ${replaceSpacesSql(blankToNullSql(`${alias}.subject_class`))}
      when ${source} like '%wolf%' then 'wolf'
      when ${source} like '%bison%' then 'bison'
      when ${source} like '%elk%' then 'elk'
      when ${source} like '%deer%' or ${source} like '%antler%' then 'deer'
      when ${source} like '%bear%' then 'bear'
      when ${source} like '%fox%' or ${source} like '%coyote%' or ${source} like '%canid%' then 'fox_coyote'
      when ${source} like '%bird%' or ${source} like '%waterfowl%' then 'bird'
      when ${source} like '%ranger%' then 'ranger'
      when ${source} like '%hiker%' or ${source} like '%visitor%' or ${source} like '%person%' or ${source} like '%people%' or ${source} like '%human%' then 'hiker'
      when ${source} like '%truck%' or ${source} like '%vehicle%' or ${source} like '%pickup%' or ${source} like '%car%' or ${source} like '%jeep%' or ${source} like '%atv%' then 'vehicle'
      when ${source} like '%empty%' or ${source} like '%landscape%' or ${source} like '%no active subject%' or ${source} like '%still meadow%' or ${source} like '%quiet valley%' then 'empty_landscape'
      else null
    end
  `;
};

export const normalizedSubjectCategorySql = (alias = "e") => {
  const subjectClass = normalizedSubjectClassSql(alias);
  const source = subjectSignalSql(alias);
  return `
    case
      when ${blankToNullSql(`${alias}.subject_category`)} is not null then ${replaceSpacesSql(blankToNullSql(`${alias}.subject_category`))}
      when (${subjectClass}) in ('elk', 'bison', 'deer', 'wolf', 'bear', 'fox_coyote', 'bird') then 'wildlife'
      when (${subjectClass}) in ('hiker', 'ranger') then 'human'
      when (${subjectClass}) = 'vehicle' then 'vehicle'
      when (${subjectClass}) = 'empty_landscape' then 'empty_scene'
      when ${source} like '%threat%' then 'threat'
      else null
    end
  `;
};

export const normalizedTimeOfDayBucketSql = (alias = "e") => `
  coalesce(
    ${blankToNullSql(`${alias}.time_of_day_bucket`)},
    case
      when extract(hour from ${normalizedTimestampSql(alias)}) between 6 and 11 then 'morning'
      when extract(hour from ${normalizedTimestampSql(alias)}) between 12 and 16 then 'afternoon'
      when extract(hour from ${normalizedTimestampSql(alias)}) between 17 and 21 then 'evening'
      else 'night'
    end
  )
`;

const eventSortColumns: Record<EventSortField, string> = {
  timestamp: normalizedTimestampSql("e"),
  camera_name: normalizedCameraNameSql("e"),
  event: normalizedEventSql("e"),
  sequence: "e.sequence",
  subject_class: normalizedSubjectClassSql("e"),
  subject_category: normalizedSubjectCategorySql("e"),
  lux: "e.lux",
  temperature: "e.temperature",
  heat_level: normalizedHeatLevelSql("e")
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
    conditions.push(`${normalizedCameraNameSql(alias)} = ANY($${values.length}::text[])`);
  }

  if (filters.mac.length > 0) {
    values.push(filters.mac);
    conditions.push(`${alias}.mac = ANY($${values.length}::text[])`);
  }

  if (filters.start_date) {
    pushCondition(`${normalizedTimestampSql(alias)}::date >= ?::date`, filters.start_date);
  }

  if (filters.end_date) {
    pushCondition(`${normalizedTimestampSql(alias)}::date <= ?::date`, filters.end_date);
  }

  if (filters.time_of_day_bucket.length > 0) {
    values.push(filters.time_of_day_bucket);
    conditions.push(`${normalizedTimeOfDayBucketSql(alias)} = ANY($${values.length}::text[])`);
  }

  if (filters.subject_category.length > 0) {
    values.push(filters.subject_category);
    conditions.push(`${normalizedSubjectCategorySql(alias)} = ANY($${values.length}::text[])`);
  }

  if (filters.subject_class.length > 0) {
    values.push(filters.subject_class);
    conditions.push(`${normalizedSubjectClassSql(alias)} = ANY($${values.length}::text[])`);
  }

  if (filters.q) {
    values.push(`%${filters.q}%`);
    conditions.push(
      `(coalesce(${normalizedAnalysisTitleSql(alias)}, '') ILIKE $${values.length} OR coalesce(${normalizedAnalysisSummarySql(alias)}, '') ILIKE $${values.length})`
    );
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
    pushCondition(`${normalizedHeatLevelSql(alias)} >= ?`, filters.min_heat_level);
  }

  if (filters.max_heat_level !== undefined) {
    pushCondition(`${normalizedHeatLevelSql(alias)} <= ?`, filters.max_heat_level);
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

const asString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
};

const safeJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const analysisObjectForRow = (row: Record<string, unknown>) => safeJsonObject(row.analysis) ?? safeJsonObject(row.ai_description);

export const mapEventRow = (row: Record<string, unknown>) => {
  const analysis = analysisObjectForRow(row);
  const analysisTitle = asString(row.analysis_title) ?? asString(analysis?.title);
  const analysisSummary = asString(row.analysis_summary) ?? asString(analysis?.summary);

  return {
    id: String(row.id),
    timestamp: asString(row.timestamp) ?? asString(row.utc_timestamp_off) ?? asString(row.utc_timestamp) ?? "",
    cameraName: asString(row.camera_name) ?? asString(row.name) ?? asString(row.mac) ?? "",
    mac: String(row.mac),
    event: asString(row.event) ?? String(row.id),
    sequence: Number(row.sequence ?? 0),
    subjectClass: asString(row.subject_class),
    subjectCategory: asString(row.subject_category),
    timeOfDayBucket: asString(row.time_of_day_bucket),
    analysisTitle,
    analysisSummary,
    lux: asNumber(row.lux),
    temperature: asNumber(row.temperature),
    heatLevel: asNumber(row.heat_level),
    sensor: asString(row.sensor) ?? "unknown",
    location: asString(row.location),
    batteryPercentage: asNumber(row.battery_percentage),
    filename: asString(row.filename),
    imageBlobUrl: asString(row.image_blob_url),
    aiProcessed: asBoolean(row.ai_processed),
    jsonProcessed: asBoolean(row.json_processed),
    uploaded: asBoolean(row.uploaded),
    voltage: asNumber(row.voltage)
  };
};
