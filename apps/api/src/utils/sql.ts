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
  `case
    when coalesce(${alias}.battery_percentage, ${alias}."batteryPercentage") between 0 and 100
      then coalesce(${alias}.battery_percentage, ${alias}."batteryPercentage")
    else null
  end`;

export const rawBatteryPercentageSql = (alias = "e") => `coalesce(${alias}.battery_percentage, ${alias}."batteryPercentage")`;

export const normalizedHeatLevelSql = (alias = "e") =>
  `case
    when coalesce(${alias}.heat_level, ${alias}."heatLevel") between 0 and 100
      then coalesce(${alias}.heat_level, ${alias}."heatLevel")
    else null
  end`;

export const normalizedVoltageSql = (alias = "e") =>
  `case when ${alias}.voltage between 0 and 18 then ${alias}.voltage else null end`;

export const normalizedTemperatureSql = (alias = "e") =>
  `case when ${alias}.temperature between -60 and 160 then ${alias}.temperature else null end`;

export const normalizedHumiditySql = (alias = "e") =>
  `case when ${alias}.humidity between 0 and 100 then ${alias}.humidity else null end`;

export const normalizedPressureSql = (alias = "e") =>
  `case when ${alias}.pressure between 800 and 1200 then ${alias}.pressure else null end`;

export const normalizedLuxSql = (alias = "e") =>
  `case when ${alias}.lux between 0 and 200000 then ${alias}.lux else null end`;

export const normalizedBearingSql = (alias = "e") =>
  `case when ${alias}.bearing between 0 and 360 then ${alias}.bearing else null end`;

export const normalizedLatitudeSql = (alias = "e") =>
  `case when ${alias}.latitude between -90 and 90 then ${alias}.latitude else null end`;

export const normalizedLongitudeSql = (alias = "e") =>
  `case when ${alias}.longitude between -180 and 180 then ${alias}.longitude else null end`;

export const normalizedFileTypeSql = (alias = "e") =>
  `coalesce(${blankToNullSql(`${alias}.file_type`)}, ${blankToNullSql(`${alias}."fileType"`)})`;

export const normalizedTimezoneSql = (alias = "e") =>
  `coalesce(${blankToNullSql(`${alias}.timezone`)}, 'America/Denver')`;

export const normalizedUploadTextSql = (alias = "e") =>
  `coalesce(
    ${blankToNullSql(`${alias}.upload`)},
    case
      when ${alias}.uploaded is true then 'true'
      when ${alias}.uploaded is false then 'false'
      else null
    end
  )`;

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

const clampNumber = (value: unknown, min: number, max: number): number | null => {
  const parsed = asNumber(value);
  if (parsed === null) {
    return null;
  }
  return parsed >= min && parsed <= max ? parsed : null;
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

const parseTimestamp = (value: unknown) => {
  const text = asString(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(text.includes("T") ? text : text.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const diffSeconds = (start: unknown, end: unknown) => {
  const startDate = parseTimestamp(start);
  const endDate = parseTimestamp(end);
  if (!startDate || !endDate) {
    return null;
  }

  const diff = Math.round((endDate.getTime() - startDate.getTime()) / 1000);
  return diff >= 0 ? diff : null;
};

const toIsoLikeString = (value: unknown) => asString(value);

const buildDataQualityFlags = (input: {
  analysisSummary: string | null;
  analysisTitle: string | null;
  aiProcessed: boolean | null;
  jsonProcessed: boolean | null;
  uploaded: boolean | null;
  voltage: number | null;
  batteryPercentage: number | null;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  lux: number | null;
}) => {
  const flags: string[] = [];

  if (!input.analysisSummary && !input.analysisTitle) {
    flags.push("missing_analysis");
  }
  if (input.aiProcessed === true && !input.analysisSummary && !input.analysisTitle) {
    flags.push("ai_without_summary");
  }
  if (input.jsonProcessed === false && input.aiProcessed === true) {
    flags.push("json_pending");
  }
  if (input.uploaded === false) {
    flags.push("upload_failed");
  }
  if (input.voltage !== null && input.voltage < 11.4) {
    flags.push("low_voltage");
  }
  if (input.batteryPercentage !== null && input.batteryPercentage < 20) {
    flags.push("low_battery");
  }
  if (input.lux !== null && input.lux < 15) {
    flags.push("low_light");
  }
  if (input.temperature === null) {
    flags.push("missing_temperature");
  }
  if (input.humidity === null) {
    flags.push("missing_humidity");
  }
  if (input.pressure === null) {
    flags.push("missing_pressure");
  }

  return flags;
};

const deriveDaypart = (timestamp: string | null) => {
  if (!timestamp) {
    return "unknown";
  }

  const parsed = parseTimestamp(timestamp);
  if (!parsed) {
    return "unknown";
  }

  const hour = parsed.getHours();
  if (hour >= 5 && hour <= 7) {
    return "dawn";
  }
  if (hour >= 8 && hour <= 16) {
    return "day";
  }
  if (hour >= 17 && hour <= 20) {
    return "dusk";
  }
  return "night";
};

const computeHealthScore = (input: {
  uploaded: boolean | null;
  aiProcessed: boolean | null;
  jsonProcessed: boolean | null;
  uploadLagSeconds: number | null;
  processingLagSeconds: number | null;
  voltage: number | null;
  batteryPercentage: number | null;
}) => {
  let score = 100;

  if (input.uploaded === false) {
    score -= 28;
  }
  if (input.aiProcessed === false) {
    score -= 12;
  }
  if (input.jsonProcessed === false) {
    score -= 10;
  }
  if (input.uploadLagSeconds !== null && input.uploadLagSeconds > 3600) {
    score -= 12;
  }
  if (input.processingLagSeconds !== null && input.processingLagSeconds > 7200) {
    score -= 14;
  }
  if (input.voltage !== null && input.voltage < 11.5) {
    score -= 16;
  }
  if (input.batteryPercentage !== null && input.batteryPercentage < 20) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
};

const computeAnomalyScore = (input: {
  uploaded: boolean | null;
  aiProcessed: boolean | null;
  jsonProcessed: boolean | null;
  uploadLagSeconds: number | null;
  processingLagSeconds: number | null;
  aiLagSeconds: number | null;
  voltage: number | null;
  batteryPercentage: number | null;
  lowLightFlag: boolean;
  analysisSummary: string | null;
}) => {
  let score = 0;

  if (input.uploaded === false) {
    score += 32;
  }
  if (input.aiProcessed === false) {
    score += 12;
  }
  if (input.jsonProcessed === false) {
    score += 10;
  }
  if (input.uploadLagSeconds !== null) {
    score += Math.min(18, input.uploadLagSeconds / 900);
  }
  if (input.processingLagSeconds !== null) {
    score += Math.min(16, input.processingLagSeconds / 1200);
  }
  if (input.aiLagSeconds !== null) {
    score += Math.min(12, input.aiLagSeconds / 1200);
  }
  if (input.voltage !== null && input.voltage < 11.5) {
    score += 14;
  }
  if (input.batteryPercentage !== null && input.batteryPercentage < 20) {
    score += 12;
  }
  if (!input.analysisSummary && input.aiProcessed === true) {
    score += 8;
  }
  if (input.lowLightFlag) {
    score += 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
};

const deriveOperationalStatus = (healthScore: number, anomalyScore: number, uploaded: boolean | null) => {
  if (uploaded === false || anomalyScore >= 65 || healthScore < 45) {
    return "alert";
  }
  if (anomalyScore >= 35 || healthScore < 70) {
    return "warning";
  }
  return "healthy";
};

export const mapEventRow = (row: Record<string, unknown>) => {
  const analysis = analysisObjectForRow(row);
  const analysisTitle = asString(row.analysis_title) ?? asString(analysis?.title);
  const analysisSummary = asString(row.analysis_summary) ?? asString(analysis?.summary);
  const timestamp = toIsoLikeString(row.local_timestamp) ?? asString(row.timestamp) ?? asString(row.utc_timestamp_off) ?? asString(row.utc_timestamp) ?? "";
  const utcTimestamp = toIsoLikeString(row.utc_timestamp);
  const utcTimestampOff = toIsoLikeString(row.utc_timestamp_off);
  const created = toIsoLikeString(row.created);
  const aiTimestamp = toIsoLikeString(row.ai_timestamp);
  const jsonTimestamp = toIsoLikeString(row.json_timestamp);
  const aiProcessed = asBoolean(row.ai_processed);
  const jsonProcessed = asBoolean(row.json_processed);
  const uploaded = asBoolean(row.uploaded);
  const lux = clampNumber(row.lux, 0, 200000);
  const temperature = clampNumber(row.temperature, -60, 160);
  const heatLevel = clampNumber(row.heat_level, 0, 100);
  const humidity = clampNumber(row.humidity, 0, 100);
  const pressure = clampNumber(row.pressure, 800, 1200);
  const voltage = clampNumber(row.voltage, 0, 18);
  const batteryPercentage = clampNumber(row.battery_percentage, 0, 100);
  const uploadLagSeconds = asNumber(row.upload_lag_seconds) ?? diffSeconds(timestamp, created);
  const aiLagSeconds = asNumber(row.ai_lag_seconds) ?? diffSeconds(timestamp, aiTimestamp);
  const processingLagSeconds = asNumber(row.processing_lag_seconds) ?? aiLagSeconds ?? diffSeconds(timestamp, jsonTimestamp) ?? uploadLagSeconds;
  const lowLightFlag = typeof row.low_light_flag === "boolean" ? row.low_light_flag : lux !== null && lux < 15;
  const daypart = asString(row.daypart) ?? deriveDaypart(timestamp);
  const healthScore = asNumber(row.health_score) ?? computeHealthScore({
    uploaded,
    aiProcessed,
    jsonProcessed,
    uploadLagSeconds,
    processingLagSeconds,
    voltage,
    batteryPercentage
  });
  const anomalyScore = asNumber(row.anomaly_score) ?? computeAnomalyScore({
    uploaded,
    aiProcessed,
    jsonProcessed,
    uploadLagSeconds,
    processingLagSeconds,
    aiLagSeconds,
    voltage,
    batteryPercentage,
    lowLightFlag,
    analysisSummary
  });
  const operationalStatus =
    asString(row.operational_status) ?? deriveOperationalStatus(healthScore, anomalyScore, uploaded);
  const dataQualityFlags = buildDataQualityFlags({
    analysisSummary,
    analysisTitle,
    aiProcessed,
    jsonProcessed,
    uploaded,
    voltage,
    batteryPercentage,
    temperature,
    humidity,
    pressure,
    lux
  });

  return {
    id: String(row.id),
    timestamp,
    localTimestamp: timestamp,
    utcTimestamp,
    utcTimestampOff,
    created,
    aiTimestamp,
    jsonTimestamp,
    timezone: asString(row.timezone) ?? "America/Denver",
    cameraName: asString(row.camera_name) ?? asString(row.name) ?? asString(row.mac) ?? "",
    camera: asString(row.camera_name) ?? asString(row.name) ?? asString(row.mac) ?? "",
    mac: String(row.mac),
    event: asString(row.event) ?? String(row.id),
    eventGroup: asString(row.event) ?? String(row.id),
    sequence: Number(row.sequence ?? 0),
    subjectClass: asString(row.subject_class),
    subjectCategory: asString(row.subject_category),
    timeOfDayBucket: asString(row.time_of_day_bucket),
    daypart,
    analysisTitle,
    analysisSummary,
    summary: analysisSummary ?? analysisTitle ?? "Unprocessed",
    aiDescription: asString(row.ai_description),
    analysis,
    lux,
    temperature,
    humidity,
    pressure,
    heatLevel,
    sensor: asString(row.sensor) ?? "unknown",
    location: asString(row.location),
    latitude: clampNumber(row.latitude, -90, 90),
    longitude: clampNumber(row.longitude, -180, 180),
    bearing: clampNumber(row.bearing, 0, 360),
    batteryPercentage,
    filename: asString(row.filename),
    fileType: asString(row.file_type) ?? asString(row.fileType),
    imageBlobUrl: asString(row.image_blob_url),
    aiProcessed,
    jsonProcessed,
    uploaded,
    upload: asString(row.upload),
    voltage,
    tag: asString(row.tag),
    eventGroupSize: Number(row.event_group_size ?? 1),
    uploadLagSeconds,
    aiLagSeconds,
    processingLagSeconds,
    lowLightFlag,
    operationalStatus,
    anomalyFlag: anomalyScore >= 45,
    anomalyScore,
    healthScore,
    dataQualityFlags
  };
};
