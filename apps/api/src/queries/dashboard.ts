import type {
  AnalyticsLabResponse,
  BurstDistributionPoint,
  CameraAnomalyPoint,
  CameraForecastLeader,
  CameraForecastPoint,
  CameraClusterPoint,
  CameraHealthRow,
  CategoryDistributionPoint,
  CategoryShiftPoint,
  CategoryTrendPoint,
  CompositionPoint,
  CountLabelPoint,
  DataQualityResponse,
  DailyActivityPoint,
  DashboardFilters,
  DaySummaryResponse,
  DiversityPoint,
  EnvironmentalContextPoint,
  EventsResponse,
  EventQuery,
  FilterOptionsResponse,
  ForecastPoint,
  HeatmapCountPoint,
  HourlyHeatmapPoint,
  HourlyActivityPoint,
  InsightItem,
  KpiResponse,
  LagTrendPoint,
  LightSplitPoint,
  MonthlyActivityCategoryPoint,
  NovelEventPoint,
  NoveltyTimelinePoint,
  OverviewResponse,
  ProcessingFunnelPoint,
  StaleCameraPoint,
  SubjectCameraHeatmapPoint,
  TemperatureTrendPoint,
  TimeOfDayCompositionPoint,
  TopCameraPoint,
  VoltageTrendPoint
} from "@grizcam/shared";
import { pool } from "../db.js";
import {
  buildFilterClause,
  getEventOrderBy,
  mapEventRow,
  normalizedAnalysisSummarySql,
  normalizedAnalysisTitleSql,
  normalizedBatteryPercentageSql,
  normalizedBearingSql,
  normalizedCameraNameSql,
  normalizedEventSql,
  normalizedFileTypeSql,
  normalizedHeatLevelSql,
  normalizedHumiditySql,
  normalizedLatitudeSql,
  normalizedLongitudeSql,
  normalizedLuxSql,
  normalizedPressureSql,
  normalizedSubjectCategorySql,
  normalizedSubjectClassSql,
  normalizedTimeOfDayBucketSql,
  normalizedTimestampSql,
  normalizedTimezoneSql,
  normalizedTemperatureSql,
  normalizedUploadTextSql,
  normalizedVoltageSql,
  rawBatteryPercentageSql
} from "../utils/sql.js";

export const getDevices = async () => {
  const result = await pool.query(
    `select mac, camera_name, location_name, location_code, latitude, longitude, camera_profile, notes
     from dim_devices
     order by camera_name asc`
  );
  return result.rows;
};

export const getFilterOptions = async (): Promise<FilterOptionsResponse> => {
  const [cameras, macs, timeBuckets, categories, classes, ranges] = await Promise.all([
    pool.query(`select distinct camera_name from dim_devices order by camera_name asc`),
    pool.query(`select mac, camera_name from dim_devices order by camera_name asc`),
    pool.query(`select distinct ${normalizedTimeOfDayBucketSql("e")} as time_of_day_bucket from events e where ${normalizedTimeOfDayBucketSql("e")} is not null order by 1 asc`),
    pool.query(`select distinct ${normalizedSubjectCategorySql("e")} as subject_category from events e where ${normalizedSubjectCategorySql("e")} is not null order by 1 asc`),
    pool.query(`select distinct ${normalizedSubjectClassSql("e")} as subject_class from events e where ${normalizedSubjectClassSql("e")} is not null order by 1 asc`),
    pool.query(
      `select
         min(lux)::int as min_lux,
         max(lux)::int as max_lux,
         floor(min(temperature))::int as min_temperature,
         ceil(max(temperature))::int as max_temperature,
         min(${normalizedHeatLevelSql("e")})::int as min_heat_level,
         max(${normalizedHeatLevelSql("e")})::int as max_heat_level
       from events e`
    )
  ]);

  const range = ranges.rows[0];

  return {
    cameras: cameras.rows.map((row: { camera_name: string }) => ({ value: row.camera_name, label: row.camera_name })),
    macs: macs.rows.map((row: { mac: string; camera_name: string }) => ({ value: row.mac, label: `${row.camera_name} (${row.mac})` })),
    timeOfDayBuckets: timeBuckets.rows.map((row: { time_of_day_bucket: string }) => ({ value: row.time_of_day_bucket, label: row.time_of_day_bucket })),
    subjectCategories: categories.rows.map((row: { subject_category: string }) => ({ value: row.subject_category, label: row.subject_category })),
    subjectClasses: classes.rows.map((row: { subject_class: string }) => ({ value: row.subject_class, label: row.subject_class })),
    ranges: {
      lux: { min: Number(range.min_lux ?? 0), max: Number(range.max_lux ?? 0) },
      temperature: { min: Number(range.min_temperature ?? 0), max: Number(range.max_temperature ?? 0) },
      heatLevel: { min: Number(range.min_heat_level ?? 0), max: Number(range.max_heat_level ?? 0) }
    }
  };
};

const filteredEventsCte = (filters: DashboardFilters, alias = "e") => {
  const filter = buildFilterClause(filters, alias);

  const text = `
    with filtered as (
      select * from events ${alias}
      ${filter.text}
    ),
    base as (
      select
        id,
        ${normalizedCameraNameSql("filtered")} as camera_name,
        filtered.name,
        filtered.mac,
        ${normalizedEventSql("filtered")} as event_group,
        filtered.sequence,
        ${normalizedTimestampSql("filtered")} as local_timestamp,
        filtered.utc_timestamp,
        filtered.utc_timestamp_off,
        filtered.created,
        filtered.ai_timestamp,
        filtered.json_timestamp,
        ${normalizedTimezoneSql("filtered")} as timezone,
        ${normalizedSubjectClassSql("filtered")} as subject_class,
        coalesce(${normalizedSubjectCategorySql("filtered")}, 'unknown') as subject_category,
        ${normalizedTimeOfDayBucketSql("filtered")} as time_of_day_bucket,
        ${normalizedAnalysisTitleSql("filtered")} as analysis_title,
        ${normalizedAnalysisSummarySql("filtered")} as analysis_summary,
        filtered.analysis,
        filtered.ai_description,
        filtered.ai_processed,
        filtered.json_processed,
        filtered.uploaded,
        ${normalizedUploadTextSql("filtered")} as upload,
        ${normalizedLuxSql("filtered")} as lux,
        ${normalizedTemperatureSql("filtered")} as temperature,
        ${normalizedHumiditySql("filtered")} as humidity,
        ${normalizedPressureSql("filtered")} as pressure,
        ${normalizedHeatLevelSql("filtered")} as heat_level,
        ${normalizedVoltageSql("filtered")} as voltage,
        ${normalizedBatteryPercentageSql("filtered")} as battery_percentage,
        ${rawBatteryPercentageSql("filtered")} as raw_battery_percentage,
        ${normalizedLatitudeSql("filtered")} as latitude,
        ${normalizedLongitudeSql("filtered")} as longitude,
        ${normalizedBearingSql("filtered")} as bearing,
        ${normalizedFileTypeSql("filtered")} as file_type,
        filtered.filename,
        filtered.image_blob_url,
        filtered.sensor,
        filtered.location,
        filtered.tag,
        count(*) over (partition by ${normalizedEventSql("filtered")})::int as event_group_size,
        case
          when filtered.created is not null then greatest(extract(epoch from (filtered.created - ${normalizedTimestampSql("filtered")})), 0)::int
          else null
        end as upload_lag_seconds,
        case
          when filtered.ai_timestamp is not null then greatest(extract(epoch from (filtered.ai_timestamp - ${normalizedTimestampSql("filtered")})), 0)::int
          else null
        end as ai_lag_seconds,
        case
          when coalesce(filtered.ai_timestamp, filtered.json_timestamp, filtered.created) is not null
            then greatest(extract(epoch from (coalesce(filtered.ai_timestamp, filtered.json_timestamp, filtered.created) - ${normalizedTimestampSql("filtered")})), 0)::int
          else null
        end as processing_lag_seconds,
        case when coalesce(${normalizedLuxSql("filtered")}, 999999) < 15 then true else false end as low_light_flag,
        case
          when extract(hour from ${normalizedTimestampSql("filtered")}) between 5 and 7 then 'dawn'
          when extract(hour from ${normalizedTimestampSql("filtered")}) between 8 and 16 then 'day'
          when extract(hour from ${normalizedTimestampSql("filtered")}) between 17 and 20 then 'dusk'
          else 'night'
        end as daypart,
        case when filtered.analysis is not null or filtered.ai_description is not null then true else false end as parse_success,
        case
          when filtered.voltage is not null and (${normalizedVoltageSql("filtered")}) is null then true
          when ${rawBatteryPercentageSql("filtered")} is not null and (${normalizedBatteryPercentageSql("filtered")}) is null then true
          when filtered.temperature is not null and (${normalizedTemperatureSql("filtered")}) is null then true
          when filtered.humidity is not null and (${normalizedHumiditySql("filtered")}) is null then true
          when filtered.pressure is not null and (${normalizedPressureSql("filtered")}) is null then true
          else false
        end as suspicious_numeric_flag
      from filtered
    ),
    event_groups as (
      select
        base.event_group as event_group,
        min(camera_name) as camera_name,
        min(mac) as mac,
        min(local_timestamp) as first_seen,
        max(local_timestamp) as last_seen,
        min(subject_category) as subject_category,
        min(subject_class) as subject_class,
        count(*)::int as event_group_size,
        avg(upload_lag_seconds)::double precision as avg_upload_lag_seconds,
        avg(ai_lag_seconds)::double precision as avg_ai_lag_seconds,
        avg(processing_lag_seconds)::double precision as avg_processing_lag_seconds,
        avg(voltage)::double precision as avg_voltage,
        avg(temperature)::double precision as avg_temperature,
        avg(heat_level)::double precision as avg_heat_level,
        avg(lux)::double precision as avg_lux,
        bool_or(coalesce(ai_processed, false)) as ai_processed_any,
        bool_or(coalesce(json_processed, false)) as json_processed_any,
        bool_or(coalesce(uploaded, false)) as uploaded_any,
        bool_or(coalesce(low_light_flag, false)) as low_light_any,
        count(*) filter (where suspicious_numeric_flag)::int as suspicious_numeric_count
      from base
      group by 1
    )
  `;

  return { text, values: filter.values };
};

const roundNumber = (value: unknown, digits = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const power = 10 ** digits;
  return Math.round(parsed * power) / power;
};

const computeCameraHealth = (row: Record<string, unknown>): CameraHealthRow => {
  const totalEvents = Number(row.total_events ?? 0);
  const aiProcessedPct = Number(row.ai_processed_pct ?? 0);
  const jsonProcessedPct = Number(row.json_processed_pct ?? 0);
  const uploadSuccessPct = Number(row.upload_success_pct ?? 0);
  const avgUploadLagSeconds = row.avg_upload_lag_seconds === null ? null : Number(row.avg_upload_lag_seconds);
  const avgAiLagSeconds = row.avg_ai_lag_seconds === null ? null : Number(row.avg_ai_lag_seconds);
  const avgProcessingLagSeconds = row.avg_processing_lag_seconds === null ? null : Number(row.avg_processing_lag_seconds);
  const avgVoltage = row.avg_voltage === null ? null : Number(row.avg_voltage);
  const lastSeenHoursAgo = row.last_seen_hours_ago === null ? null : Number(row.last_seen_hours_ago);

  let healthScore = 100;
  if (uploadSuccessPct < 95) {
    healthScore -= 18;
  }
  if (aiProcessedPct < 90) {
    healthScore -= 12;
  }
  if (jsonProcessedPct < 90) {
    healthScore -= 10;
  }
  if (avgUploadLagSeconds !== null && avgUploadLagSeconds > 3600) {
    healthScore -= 12;
  }
  if (avgProcessingLagSeconds !== null && avgProcessingLagSeconds > 7200) {
    healthScore -= 14;
  }
  if (avgVoltage !== null && avgVoltage < 11.5) {
    healthScore -= 18;
  }
  if (lastSeenHoursAgo !== null && lastSeenHoursAgo > 48) {
    healthScore -= 20;
  }
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  let anomalyScore = 0;
  if (uploadSuccessPct < 98) {
    anomalyScore += (98 - uploadSuccessPct) * 1.5;
  }
  if (aiProcessedPct < 95) {
    anomalyScore += (95 - aiProcessedPct) * 0.8;
  }
  if (avgUploadLagSeconds !== null) {
    anomalyScore += Math.min(18, avgUploadLagSeconds / 900);
  }
  if (avgProcessingLagSeconds !== null) {
    anomalyScore += Math.min(18, avgProcessingLagSeconds / 1200);
  }
  if (avgVoltage !== null && avgVoltage < 11.5) {
    anomalyScore += 16;
  }
  if (lastSeenHoursAgo !== null) {
    anomalyScore += Math.min(25, lastSeenHoursAgo / 2);
  }
  anomalyScore = Math.max(0, Math.min(100, Math.round(anomalyScore)));

  const status = anomalyScore >= 65 || healthScore < 45 ? "alert" : anomalyScore >= 35 || healthScore < 70 ? "warning" : "healthy";
  const alertReason =
    lastSeenHoursAgo !== null && lastSeenHoursAgo > 48
      ? "Camera is stale"
      : avgVoltage !== null && avgVoltage < 11.5
        ? "Under-voltage trend"
        : avgProcessingLagSeconds !== null && avgProcessingLagSeconds > 7200
          ? "Processing lag spike"
          : aiProcessedPct < 90
            ? "AI completion is below target"
            : null;

  return {
    cameraName: String(row.camera_name ?? "Unknown"),
    lastSeen: row.last_seen ? String(row.last_seen) : null,
    lastSeenHoursAgo,
    totalEvents,
    aiProcessedPct: roundNumber(aiProcessedPct),
    jsonProcessedPct: roundNumber(jsonProcessedPct),
    uploadSuccessPct: roundNumber(uploadSuccessPct),
    avgUploadLagSeconds,
    avgAiLagSeconds,
    avgProcessingLagSeconds,
    avgVoltage,
    healthScore,
    anomalyScore,
    status,
    alertReason
  };
};

const buildOverviewInsights = (input: {
  kpis: OverviewResponse["kpis"];
  staleCameras: StaleCameraPoint[];
  cameraHealth: CameraHealthRow[];
  categoryTrend: CategoryTrendPoint[];
  topCameras: TopCameraPoint[];
}): InsightItem[] => {
  const insights: InsightItem[] = [];

  if (input.cameraHealth.some((camera) => camera.status === "alert")) {
    const camera = input.cameraHealth.find((item) => item.status === "alert");
    if (camera) {
      insights.push({
        title: `${camera.cameraName} needs attention`,
        detail: camera.alertReason ?? "This camera has the highest operational anomaly score in the fleet.",
        tone: "alert"
      });
    }
  }

  if ((input.kpis.avgProcessingLagSeconds ?? 0) > 3600) {
    insights.push({
      title: "Processing lag is elevated",
      detail: `Average processing lag is ${Math.round((input.kpis.avgProcessingLagSeconds ?? 0) / 60)} minutes across the current slice.`,
      tone: "warning"
    });
  }

  if (input.topCameras[0]) {
    insights.push({
      title: `${input.topCameras[0].cameraName} is the busiest camera`,
      detail: `It generated ${input.topCameras[0].count.toLocaleString()} grouped events in the selected range.`,
      tone: "info"
    });
  }

  if (input.kpis.lowLightSharePct > 35) {
    insights.push({
      title: "Wildlife activity is skewing toward low light",
      detail: `${roundNumber(input.kpis.lowLightSharePct)}% of grouped events occurred in low-light conditions.`,
      tone: "positive"
    });
  }

  if (input.staleCameras.length > 0) {
    insights.push({
      title: `${input.staleCameras.length} stale cameras detected`,
      detail: "At least one camera has not reported recently and should be checked for power, connectivity, or upload backlog.",
      tone: "warning"
    });
  }

  return insights.slice(0, 4);
};

export const getKpis = async (filters: DashboardFilters): Promise<KpiResponse> => {
  const filter = buildFilterClause(filters);
  const result = await pool.query(
    `
    with filtered as (
      select * from events e
      ${filter.text}
    ),
    event_groups as (
      select
        ${normalizedEventSql("filtered")} as event,
        min(${normalizedCameraNameSql("filtered")}) as camera_name,
        min(${normalizedSubjectCategorySql("filtered")}) as subject_category,
        min(${normalizedSubjectClassSql("filtered")}) as subject_class,
        min(${normalizedTimestampSql("filtered")}) as first_seen,
        count(*) as row_count
      from filtered
      group by 1
    ),
    daily_groups as (
      select first_seen::date as day, count(*) as groups
      from event_groups
      group by 1
    ),
    camera_groups as (
      select camera_name, count(*) as groups
      from event_groups
      group by 1
      order by groups desc, camera_name asc
      limit 1
    ),
    hourly_groups as (
      select extract(hour from first_seen)::int as hour_value, count(*) as groups
      from event_groups
      group by 1
      order by groups desc, hour_value asc
      limit 1
    ),
    top_species as (
      select subject_class, count(*) as groups
      from event_groups
      where subject_class is not null
      group by 1
      order by groups desc, subject_class asc
      limit 1
    ),
    camera_daily as (
      select camera_name, first_seen::date as day, count(*) as groups
      from event_groups
      group by 1, 2
    )
    select
      (select count(*) from filtered) as total_raw_rows,
      (select count(*) from event_groups) as total_unique_event_groups,
      (select coalesce(100.0 * count(*) filter (where subject_category = 'wildlife') / nullif(count(*), 0), 0) from event_groups) as wildlife_share_pct,
      (select coalesce(100.0 * count(*) filter (where subject_category = 'human') / nullif(count(*), 0), 0) from event_groups) as human_share_pct,
      (select coalesce(100.0 * count(*) filter (where subject_category = 'vehicle') / nullif(count(*), 0), 0) from event_groups) as vehicle_share_pct,
      (select camera_name from camera_groups) as most_active_camera,
      (select hour_value from hourly_groups) as peak_activity_hour,
      (select coalesce(avg(groups), 0) from daily_groups) as avg_daily_event_groups,
      (select coalesce(avg(row_count), 0) from event_groups) as avg_burst_length,
      (select count(distinct subject_class) from event_groups where subject_category = 'wildlife') as biodiversity_score,
      (select coalesce(count(*) filter (where extract(hour from first_seen) between 22 and 23 or extract(hour from first_seen) between 0 and 5)::numeric / nullif(count(*), 0), 0) from event_groups) as nocturnality_score,
      (select coalesce(count(*) filter (where extract(hour from first_seen) between 6 and 11 or extract(hour from first_seen) between 17 and 21)::numeric / nullif(count(*), 0), 0) from event_groups) as dawn_dusk_preference,
      (select subject_class from top_species) as top_species
    `,
    filter.values
  );

  const row = result.rows[0];
  return {
    totalRawRows: Number(row.total_raw_rows ?? 0),
    totalUniqueEventGroups: Number(row.total_unique_event_groups ?? 0),
    wildlifeSharePct: Number(row.wildlife_share_pct ?? 0),
    humanSharePct: Number(row.human_share_pct ?? 0),
    vehicleSharePct: Number(row.vehicle_share_pct ?? 0),
    mostActiveCamera: row.most_active_camera ? String(row.most_active_camera) : null,
    peakActivityHour: row.peak_activity_hour === null ? null : Number(row.peak_activity_hour),
    avgDailyEventGroups: Number(row.avg_daily_event_groups ?? 0),
    avgBurstLength: Number(row.avg_burst_length ?? 0),
    biodiversityScore: Number(row.biodiversity_score ?? 0),
    nocturnalityScore: Number(row.nocturnality_score ?? 0),
    dawnDuskPreference: Number(row.dawn_dusk_preference ?? 0),
    topSpecies: row.top_species ? String(row.top_species) : null
  };
};

export const getDailyActivity = async (filters: DashboardFilters): Promise<DailyActivityPoint[]> => {
  const filter = buildFilterClause(filters);
  const result = await pool.query(
    `
    with filtered as (
      select * from events e
      ${filter.text}
    )
    select
      ${normalizedTimestampSql("filtered")}::date::text as date,
      ${normalizedCameraNameSql("filtered")} as "cameraName",
      count(distinct ${normalizedEventSql("filtered")})::int as "uniqueEventGroups",
      count(*)::int as "rawRows"
    from filtered
    group by 1, 2
    order by 1 asc, 2 asc
    `,
    filter.values
  );
  return result.rows as DailyActivityPoint[];
};

export const getHourlyHeatmap = async (filters: DashboardFilters): Promise<HourlyHeatmapPoint[]> => {
  const filter = buildFilterClause(filters);
  const result = await pool.query(
    `
    with filtered as (
      select * from events e
      ${filter.text}
    )
    select
      ${normalizedCameraNameSql("filtered")} as "cameraName",
      extract(hour from ${normalizedTimestampSql("filtered")})::int as hour,
      count(distinct ${normalizedEventSql("filtered")})::int as "uniqueEventGroups",
      count(*)::int as "rawRows"
    from filtered
    group by 1, 2
    order by 1 asc, 2 asc
    `,
    filter.values
  );
  return result.rows as HourlyHeatmapPoint[];
};

export const getTimeOfDayComposition = async (filters: DashboardFilters): Promise<TimeOfDayCompositionPoint[]> => {
  const filter = buildFilterClause(filters);
  const result = await pool.query(
    `
    with filtered as (
      select * from events e
      ${filter.text}
    )
    select
      ${normalizedTimeOfDayBucketSql("filtered")} as bucket,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'wildlife')::int as wildlife,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'human')::int as human,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'vehicle')::int as vehicle,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'empty_scene')::int as "emptyScene"
    from filtered
    group by 1
    order by case ${normalizedTimeOfDayBucketSql("filtered")} when 'morning' then 1 when 'afternoon' then 2 when 'evening' then 3 else 4 end
    `,
    filter.values
  );
  return result.rows as TimeOfDayCompositionPoint[];
};

export const getSubjectByCamera = async (filters: DashboardFilters): Promise<SubjectCameraHeatmapPoint[]> => {
  const filter = buildFilterClause(filters);
  const result = await pool.query(
    `
    with filtered as (
      select * from events e
      ${filter.text}
    )
    select
      ${normalizedCameraNameSql("filtered")} as "cameraName",
      ${normalizedSubjectClassSql("filtered")} as "subjectClass",
      count(distinct ${normalizedEventSql("filtered")})::int as "uniqueEventGroups"
    from filtered
    where ${normalizedSubjectClassSql("filtered")} is not null
    group by 1, 2
    order by 1 asc, 2 asc
    `,
    filter.values
  );
  return result.rows as SubjectCameraHeatmapPoint[];
};

export const getMonthlyActivityByCategory = async (filters: DashboardFilters): Promise<MonthlyActivityCategoryPoint[]> => {
  const filter = buildFilterClause(filters);
  const result = await pool.query(
    `
    with filtered as (
      select * from events e
      ${filter.text}
    )
    select
      to_char(date_trunc('month', ${normalizedTimestampSql("filtered")}), 'YYYY-MM') as month,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'wildlife')::int as wildlife,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'human')::int as human,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'vehicle')::int as vehicle,
      count(distinct ${normalizedEventSql("filtered")}) filter (where ${normalizedSubjectCategorySql("filtered")} = 'empty_scene')::int as "emptyScene"
    from filtered
    group by 1
    order by 1 asc
    `,
    filter.values
  );
  return result.rows as MonthlyActivityCategoryPoint[];
};

export const getComposition = async (filters: DashboardFilters): Promise<CompositionPoint[]> => {
  const filter = buildFilterClause(filters);
  const result = await pool.query(
    `
    with filtered as (
      select * from events e
      ${filter.text}
    )
    select
      coalesce(${normalizedSubjectCategorySql("filtered")}, 'unknown') as category,
      count(distinct ${normalizedEventSql("filtered")})::int as "uniqueEventGroups"
    from filtered
    group by 1
    order by "uniqueEventGroups" desc, category asc
    `,
    filter.values
  );
  return result.rows as CompositionPoint[];
};

export const getOverview = async (filters: DashboardFilters): Promise<OverviewResponse> => {
  const cte = filteredEventsCte(filters);

  const [
    kpisResult,
    cameraHealthResult,
    processingFunnelResult,
    lagTrendResult,
    categoryDistributionResult,
    categoryTrendResult,
    topCamerasResult,
    hourlyActivityResult,
    burstDistributionResult,
    notableEventsResult,
    voltageTrendResult,
    lightSplitResult,
    temperatureTrendResult
  ] = await Promise.all([
    pool.query(
      `
      ${cte.text}
      select
        count(*)::int as total_events,
        count(distinct camera_name)::int as active_cameras,
        coalesce(100.0 * count(*) filter (where subject_category = 'wildlife') / nullif(count(*), 0), 0) as wildlife_share_pct,
        coalesce(100.0 * count(*) filter (where subject_category = 'human') / nullif(count(*), 0), 0) as human_share_pct,
        coalesce(100.0 * count(*) filter (where ai_processed_any) / nullif(count(*), 0), 0) as ai_processed_pct,
        coalesce(100.0 * count(*) filter (where json_processed_any) / nullif(count(*), 0), 0) as json_processed_pct,
        coalesce(100.0 * count(*) filter (where uploaded_any) / nullif(count(*), 0), 0) as upload_success_pct,
        avg(avg_upload_lag_seconds)::double precision as avg_upload_lag_seconds,
        avg(avg_processing_lag_seconds)::double precision as avg_processing_lag_seconds,
        avg(avg_voltage)::double precision as avg_voltage,
        coalesce(100.0 * count(*) filter (where low_light_any) / nullif(count(*), 0), 0) as low_light_share_pct
      from event_groups
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        camera_name,
        to_char(max(local_timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') as last_seen,
        extract(epoch from (now()::timestamp - max(local_timestamp))) / 3600 as last_seen_hours_ago,
        count(distinct event_group)::int as total_events,
        coalesce(100.0 * count(distinct event_group) filter (where ai_processed) / nullif(count(distinct event_group), 0), 0) as ai_processed_pct,
        coalesce(100.0 * count(distinct event_group) filter (where json_processed) / nullif(count(distinct event_group), 0), 0) as json_processed_pct,
        coalesce(100.0 * count(distinct event_group) filter (where uploaded) / nullif(count(distinct event_group), 0), 0) as upload_success_pct,
        avg(upload_lag_seconds)::double precision as avg_upload_lag_seconds,
        avg(ai_lag_seconds)::double precision as avg_ai_lag_seconds,
        avg(processing_lag_seconds)::double precision as avg_processing_lag_seconds,
        avg(voltage)::double precision as avg_voltage
      from base
      group by 1
      order by total_events desc, camera_name asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select * from (
        select 'captured' as stage, count(*)::int as count from event_groups
        union all
        select 'uploaded' as stage, count(*) filter (where uploaded_any)::int as count from event_groups
        union all
        select 'json_processed' as stage, count(*) filter (where json_processed_any)::int as count from event_groups
        union all
        select 'ai_processed' as stage, count(*) filter (where ai_processed_any)::int as count from event_groups
      ) funnel
      order by case stage when 'captured' then 1 when 'uploaded' then 2 when 'json_processed' then 3 else 4 end
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        local_timestamp::date::text as date,
        avg(upload_lag_seconds)::double precision as avg_upload_lag_seconds,
        avg(ai_lag_seconds)::double precision as avg_ai_lag_seconds,
        avg(processing_lag_seconds)::double precision as avg_processing_lag_seconds
      from base
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        subject_category as category,
        count(*)::int as count
      from event_groups
      group by 1
      order by count desc, category asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        first_seen::date::text as date,
        count(*) filter (where subject_category = 'wildlife')::int as wildlife,
        count(*) filter (where subject_category = 'human')::int as human,
        count(*) filter (where subject_category = 'vehicle')::int as vehicle,
        count(*) filter (where subject_category = 'empty_scene')::int as "emptyScene",
        count(*) filter (where subject_category not in ('wildlife', 'human', 'vehicle', 'empty_scene'))::int as unknown
      from event_groups
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        camera_name as "cameraName",
        count(*)::int as count
      from event_groups
      group by 1
      order by count desc, "cameraName" asc
      limit 8
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        extract(hour from first_seen)::int as hour,
        count(*)::int as total,
        count(*) filter (where subject_category = 'wildlife')::int as wildlife,
        count(*) filter (where subject_category = 'human')::int as human,
        count(*) filter (where subject_category = 'vehicle')::int as vehicle,
        count(*) filter (where subject_category = 'empty_scene')::int as "emptyScene",
        count(*) filter (where subject_category not in ('wildlife', 'human', 'vehicle', 'empty_scene'))::int as unknown
      from event_groups
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        least(event_group_size, 6)::int as "burstSize",
        count(*)::int as count
      from event_groups
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        id,
        to_char(local_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as local_timestamp,
        to_char(utc_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as utc_timestamp,
        to_char(utc_timestamp_off, 'YYYY-MM-DD"T"HH24:MI:SS') as utc_timestamp_off,
        to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS') as created,
        to_char(ai_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as ai_timestamp,
        to_char(json_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as json_timestamp,
        camera_name,
        name,
        mac,
        event_group as event,
        event_group_size,
        sequence,
        subject_class,
        subject_category,
        time_of_day_bucket,
        analysis_title,
        analysis_summary,
        analysis,
        ai_description,
        ai_processed,
        json_processed,
        uploaded,
        upload,
        lux,
        temperature,
        humidity,
        pressure,
        heat_level,
        sensor,
        location,
        battery_percentage,
        voltage,
        timezone,
        latitude,
        longitude,
        bearing,
        file_type,
        filename,
        tag,
        image_blob_url,
        upload_lag_seconds,
        ai_lag_seconds,
        processing_lag_seconds,
        low_light_flag,
        daypart
      from base
      order by
        case when uploaded is false then 0 else 1 end asc,
        case when voltage is not null and voltage < 11.5 then 0 else 1 end asc,
        processing_lag_seconds desc nulls last,
        local_timestamp desc
      limit 8
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        local_timestamp::date::text as date,
        camera_name as "cameraName",
        avg(voltage)::double precision as "avgVoltage"
      from base
      where voltage is not null
      group by 1, 2
      order by 1 asc, 2 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        case when low_light_any then 'low_light' else 'normal_light' end as bucket,
        count(*)::int as count
      from event_groups
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        local_timestamp::date::text as date,
        avg(temperature)::double precision as "avgTemperature",
        avg(heat_level)::double precision as "avgHeatLevel"
      from base
      group by 1
      order by 1 asc
      `,
      cte.values
    )
  ]);

  const cameraHealth = cameraHealthResult.rows.map((row) => computeCameraHealth(row));
  const staleCameras = cameraHealth
    .filter((camera) => (camera.lastSeenHoursAgo ?? 0) > 48 || camera.status !== "healthy")
    .map<StaleCameraPoint>((camera) => ({
      cameraName: camera.cameraName,
      lastSeen: camera.lastSeen,
      lastSeenHoursAgo: camera.lastSeenHoursAgo,
      status: camera.status,
      anomalyScore: camera.anomalyScore
    }))
    .slice(0, 6);

  const kpiRow = kpisResult.rows[0] ?? {};
  const kpis: OverviewResponse["kpis"] = {
    totalEvents: Number(kpiRow.total_events ?? 0),
    activeCameras: Number(kpiRow.active_cameras ?? 0),
    wildlifeSharePct: Number(kpiRow.wildlife_share_pct ?? 0),
    humanSharePct: Number(kpiRow.human_share_pct ?? 0),
    aiProcessedPct: Number(kpiRow.ai_processed_pct ?? 0),
    jsonProcessedPct: Number(kpiRow.json_processed_pct ?? 0),
    uploadSuccessPct: Number(kpiRow.upload_success_pct ?? 0),
    avgUploadLagSeconds: kpiRow.avg_upload_lag_seconds === null ? null : Number(kpiRow.avg_upload_lag_seconds),
    avgProcessingLagSeconds:
      kpiRow.avg_processing_lag_seconds === null ? null : Number(kpiRow.avg_processing_lag_seconds),
    camerasWithAlerts: cameraHealth.filter((camera) => camera.status !== "healthy").length,
    avgVoltage: kpiRow.avg_voltage === null ? null : Number(kpiRow.avg_voltage),
    lowLightSharePct: Number(kpiRow.low_light_share_pct ?? 0)
  };

  const topCameras = topCamerasResult.rows as TopCameraPoint[];
  const categoryTrend = categoryTrendResult.rows as CategoryTrendPoint[];

  return {
    kpis,
    cameraHealth,
    processingFunnel: processingFunnelResult.rows as ProcessingFunnelPoint[],
    lagTrend: lagTrendResult.rows as LagTrendPoint[],
    staleCameras,
    categoryDistribution: categoryDistributionResult.rows as CategoryDistributionPoint[],
    categoryTrend,
    topCameras,
    hourlyActivity: hourlyActivityResult.rows as HourlyActivityPoint[],
    burstDistribution: burstDistributionResult.rows as BurstDistributionPoint[],
    notableEvents: notableEventsResult.rows.map(mapEventRow),
    voltageTrend: voltageTrendResult.rows as VoltageTrendPoint[],
    lightSplit: lightSplitResult.rows as LightSplitPoint[],
    temperatureTrend: temperatureTrendResult.rows as TemperatureTrendPoint[],
    insights: buildOverviewInsights({ kpis, staleCameras, cameraHealth, categoryTrend, topCameras })
  };
};

const percentile = (values: number[], point: number) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(point * (sorted.length - 1))));
  return sorted[index];
};

const buildCameraClusters = (
  diversityByCamera: DiversityPoint[],
  cameraAnomalies: CameraAnomalyPoint[]
): CameraClusterPoint[] => {
  const anomalyByCamera = new Map(cameraAnomalies.map((item) => [item.cameraName, item]));

  return diversityByCamera.map((item) => {
    const anomaly = anomalyByCamera.get(item.cameraName);
    let cluster = "Balanced";
    let similarityLabel = "mixed profile";
    let rationale = "Balanced traffic, category mix, and telemetry profile.";

    if ((anomaly?.anomalyScore ?? 0) >= 55) {
      cluster = "Operational Risk";
      similarityLabel = "ops anomaly";
      rationale = "Lag, stale behavior, or low-voltage conditions are driving the profile.";
    } else if (item.wildlifeRatioPct >= 70 && item.lowLightSharePct >= 40) {
      cluster = "Nocturnal Wildlife";
      similarityLabel = "wildlife corridor";
      rationale = "High wildlife share with strong low-light activity.";
    } else if (item.humanRatioPct >= 35) {
      cluster = "Human Interaction";
      similarityLabel = "human-exposed";
      rationale = "Human detections make up an elevated share of this camera's events.";
    } else if (item.diversityScore >= 4) {
      cluster = "Diverse Habitat";
      similarityLabel = "high diversity";
      rationale = "The camera sees a wider variety of categories and species than peers.";
    }

    return {
      cameraName: item.cameraName,
      cluster,
      similarityLabel,
      rationale,
      healthScore: anomaly?.healthScore ?? 100,
      anomalyScore: anomaly?.anomalyScore ?? 0,
      diversityScore: item.diversityScore
    };
  });
};

type CameraDailyAggregate = {
  date: string;
  cameraName: string;
  count: number;
};

type ComboDailyAggregate = {
  date: string;
  cameraName: string;
  category: string;
  hour: number;
  count: number;
};

const buildAnalysisWindows = (dates: string[]) => {
  const sortedDates = Array.from(new Set(dates)).sort();
  const recentCount = Math.min(14, Math.max(5, Math.ceil(sortedDates.length / 3)));
  const recentDates = sortedDates.slice(-recentCount);
  const baselineDates = sortedDates.slice(Math.max(0, sortedDates.length - recentCount - 28), -recentCount);
  const fallbackBaselineDates = baselineDates.length > 0 ? baselineDates : sortedDates.slice(0, -1);

  return {
    sortedDates,
    recentDates,
    recentDateSet: new Set(recentDates),
    baselineDates: fallbackBaselineDates,
    baselineDateSet: new Set(fallbackBaselineDates),
    latestDate: recentDates[recentDates.length - 1] ?? sortedDates[sortedDates.length - 1] ?? null
  };
};

const buildCameraForecast = (rows: CameraDailyAggregate[]) => {
  const dates = rows.map((row) => row.date);
  const { sortedDates, recentDateSet, latestDate } = buildAnalysisWindows(dates);
  const cameraNames = Array.from(new Set(rows.map((row) => row.cameraName))).sort();
  const countsByCamera = new Map<string, Map<string, number>>();

  rows.forEach((row) => {
    if (!countsByCamera.has(row.cameraName)) {
      countsByCamera.set(row.cameraName, new Map());
    }
    countsByCamera.get(row.cameraName)!.set(row.date, row.count);
  });

  const cameraForecast: CameraForecastPoint[] = [];

  cameraNames.forEach((cameraName) => {
    const counts = countsByCamera.get(cameraName) ?? new Map<string, number>();
    sortedDates.forEach((date, index) => {
      const actual = counts.get(date) ?? 0;
      const trailing = sortedDates
        .slice(Math.max(0, index - 7), index)
        .map((priorDate) => counts.get(priorDate) ?? 0);
      const expectedRaw = trailing.length > 0 ? trailing.reduce((sum, value) => sum + value, 0) / trailing.length : actual;
      const expected = roundNumber(expectedRaw, 2);
      const delta = roundNumber(actual - expected, 2);
      const residualPct = expected > 0 ? roundNumber((delta / expected) * 100, 1) : actual > 0 ? 100 : 0;

      if (!recentDateSet.has(date) || (actual === 0 && expected === 0)) {
        return;
      }

      cameraForecast.push({
        date,
        cameraName,
        actual,
        expected,
        delta,
        residualPct
      });
    });
  });

  const cameraForecastLeaders: CameraForecastLeader[] = cameraForecast
    .filter((item) => item.date === latestDate)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || right.actual - left.actual || left.cameraName.localeCompare(right.cameraName))
    .slice(0, 10)
    .map((item) => ({ ...item }));

  return { cameraForecast, cameraForecastLeaders };
};

const buildCategoryShiftMatrix = (rows: ComboDailyAggregate[]) => {
  const { recentDateSet, baselineDateSet } = buildAnalysisWindows(rows.map((row) => row.date));
  const recentCounts = new Map<string, number>();
  const baselineCounts = new Map<string, number>();
  const recentTotalsByCamera = new Map<string, number>();
  const baselineTotalsByCamera = new Map<string, number>();

  rows.forEach((row) => {
    const pairKey = `${row.cameraName}|||${row.category}`;
    if (recentDateSet.has(row.date)) {
      recentCounts.set(pairKey, (recentCounts.get(pairKey) ?? 0) + row.count);
      recentTotalsByCamera.set(row.cameraName, (recentTotalsByCamera.get(row.cameraName) ?? 0) + row.count);
    }
    if (baselineDateSet.has(row.date)) {
      baselineCounts.set(pairKey, (baselineCounts.get(pairKey) ?? 0) + row.count);
      baselineTotalsByCamera.set(row.cameraName, (baselineTotalsByCamera.get(row.cameraName) ?? 0) + row.count);
    }
  });

  const keys = Array.from(new Set([...recentCounts.keys(), ...baselineCounts.keys()]));

  return keys
    .map((key) => {
      const [cameraName, category] = key.split("|||");
      const recentCount = recentCounts.get(key) ?? 0;
      const baselineCount = baselineCounts.get(key) ?? 0;
      const recentTotal = recentTotalsByCamera.get(cameraName) ?? 0;
      const baselineTotal = baselineTotalsByCamera.get(cameraName) ?? 0;
      const recentSharePct = recentTotal > 0 ? roundNumber((recentCount / recentTotal) * 100, 1) : 0;
      const baselineSharePct = baselineTotal > 0 ? roundNumber((baselineCount / baselineTotal) * 100, 1) : 0;
      const shiftPct = roundNumber(recentSharePct - baselineSharePct, 1);
      const lift = baselineSharePct > 0 ? roundNumber(recentSharePct / baselineSharePct, 2) : recentSharePct > 0 ? 4 : 1;

      return {
        cameraName,
        category,
        recentSharePct,
        baselineSharePct,
        shiftPct,
        lift,
        recentCount,
        baselineCount
      } satisfies CategoryShiftPoint;
    })
    .filter((item) => item.recentCount > 0 || item.baselineCount > 0)
    .sort((left, right) => Math.abs(right.shiftPct) - Math.abs(left.shiftPct) || right.recentCount - left.recentCount || left.cameraName.localeCompare(right.cameraName))
    .slice(0, 36);
};

const buildNovelEvents = (rows: ComboDailyAggregate[], categoryShiftMatrix: CategoryShiftPoint[]) => {
  const { recentDateSet, baselineDateSet } = buildAnalysisWindows(rows.map((row) => row.date));
  const recentDayCount = Math.max(recentDateSet.size, 1);
  const baselineDayCount = Math.max(baselineDateSet.size, 1);
  const comboTotals = new Map<string, number>();
  const categoryHourTotals = new Map<string, number>();
  const recentComboCounts = new Map<string, number>();
  const baselineComboCounts = new Map<string, number>();
  const recentRowsByDate = new Map<string, ComboDailyAggregate[]>();
  const shiftByPair = new Map(categoryShiftMatrix.map((item) => [`${item.cameraName}|||${item.category}`, item]));

  rows.forEach((row) => {
    const comboKey = `${row.cameraName}|||${row.category}|||${row.hour}`;
    const categoryHourKey = `${row.category}|||${row.hour}`;
    comboTotals.set(comboKey, (comboTotals.get(comboKey) ?? 0) + row.count);
    categoryHourTotals.set(categoryHourKey, (categoryHourTotals.get(categoryHourKey) ?? 0) + row.count);

    if (recentDateSet.has(row.date)) {
      recentComboCounts.set(comboKey, (recentComboCounts.get(comboKey) ?? 0) + row.count);
      recentRowsByDate.set(row.date, [...(recentRowsByDate.get(row.date) ?? []), row]);
    }

    if (baselineDateSet.has(row.date)) {
      baselineComboCounts.set(comboKey, (baselineComboCounts.get(comboKey) ?? 0) + row.count);
    }
  });

  const maxComboCount = Math.max(...comboTotals.values(), 1);
  const maxCategoryHourCount = Math.max(...categoryHourTotals.values(), 1);

  const novelEvents: NovelEventPoint[] = Array.from(recentComboCounts.entries())
    .map(([comboKey, currentCount]) => {
      const [cameraName, category, hourValue] = comboKey.split("|||");
      const hour = Number(hourValue);
      const comboCount = comboTotals.get(comboKey) ?? currentCount;
      const categoryHourCount = categoryHourTotals.get(`${category}|||${hour}`) ?? currentCount;
      const baselineDailyAvg = roundNumber((baselineComboCounts.get(comboKey) ?? 0) / baselineDayCount, 2);
      const currentDailyRate = currentCount / recentDayCount;
      const pairShift = shiftByPair.get(`${cameraName}|||${category}`)?.shiftPct ?? 0;
      const comboRarity = 1 - comboCount / maxComboCount;
      const categoryHourRarity = 1 - categoryHourCount / maxCategoryHourCount;
      const deviation = Math.max(0, currentDailyRate - baselineDailyAvg);
      const deviationScore = Math.min(1, deviation / Math.max(baselineDailyAvg, 1));
      const shiftScore = Math.min(1, Math.max(0, pairShift) / 25);
      const noveltyScore = roundNumber(100 * (0.45 * comboRarity + 0.25 * categoryHourRarity + 0.2 * deviationScore + 0.1 * shiftScore), 1);
      const narrative = `${cameraName} is showing an unusual ${category} pattern near ${hour.toString().padStart(2, "0")}:00. Recent count ${currentCount}, baseline ${baselineDailyAvg.toFixed(1)} per day.`;

      return {
        cameraName,
        category,
        hour,
        currentCount,
        baselineDailyAvg,
        comboCount,
        categoryHourCount,
        shiftPct: roundNumber(pairShift, 1),
        noveltyScore,
        narrative
      } satisfies NovelEventPoint;
    })
    .filter((item) => item.currentCount > 0)
    .sort((left, right) => right.noveltyScore - left.noveltyScore || right.currentCount - left.currentCount || left.cameraName.localeCompare(right.cameraName))
    .slice(0, 12);

  const noveltyByCombo = new Map(novelEvents.map((item) => [`${item.cameraName}|||${item.category}|||${item.hour}`, item]));
  const noveltyByDate = new Map<string, { novelEventCount: number; topDriver: string | null; topScore: number }>();

  recentRowsByDate.forEach((dateRows, date) => {
    dateRows.forEach((row) => {
      const novel = noveltyByCombo.get(`${row.cameraName}|||${row.category}|||${row.hour}`);
      if (!novel || novel.noveltyScore < 55) {
        return;
      }

      const current = noveltyByDate.get(date) ?? { novelEventCount: 0, topDriver: null, topScore: -1 };
      current.novelEventCount += row.count;
      if (novel.noveltyScore > current.topScore) {
        current.topScore = novel.noveltyScore;
        current.topDriver = `${novel.cameraName} ${novel.category} @ ${novel.hour.toString().padStart(2, "0")}:00`;
      }
      noveltyByDate.set(date, current);
    });
  });

  return { novelEvents, noveltyByDate };
};

const buildNoveltyTimelineDaily = (rows: ComboDailyAggregate[], categoryShiftMatrix: CategoryShiftPoint[]): NoveltyTimelinePoint[] => {
  const { sortedDates, baselineDateSet } = buildAnalysisWindows(rows.map((row) => row.date));
  const baselineDayCount = Math.max(baselineDateSet.size, 1);
  const comboTotals = new Map<string, number>();
  const categoryHourTotals = new Map<string, number>();
  const baselineComboCounts = new Map<string, number>();
  const shiftByPair = new Map(categoryShiftMatrix.map((item) => [`${item.cameraName}|||${item.category}`, item]));
  const rowsByDate = new Map<string, ComboDailyAggregate[]>();

  rows.forEach((row) => {
    const comboKey = `${row.cameraName}|||${row.category}|||${row.hour}`;
    const categoryHourKey = `${row.category}|||${row.hour}`;
    comboTotals.set(comboKey, (comboTotals.get(comboKey) ?? 0) + row.count);
    categoryHourTotals.set(categoryHourKey, (categoryHourTotals.get(categoryHourKey) ?? 0) + row.count);
    rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row]);

    if (baselineDateSet.has(row.date)) {
      baselineComboCounts.set(comboKey, (baselineComboCounts.get(comboKey) ?? 0) + row.count);
    }
  });

  const maxComboCount = Math.max(...comboTotals.values(), 1);
  const maxCategoryHourCount = Math.max(...categoryHourTotals.values(), 1);

  return sortedDates.map((date) => {
    const dateRows = rowsByDate.get(date) ?? [];
    let noveltyCount = 0;
    let noveltyScoreTotal = 0;
    let maxNoveltyScore = 0;
    let topDriver: string | null = null;
    let dominantCategory: string | null = null;
    let topDriverScore = -1;
    const categoryContribution = new Map<string, number>();

    dateRows.forEach((row) => {
      const comboKey = `${row.cameraName}|||${row.category}|||${row.hour}`;
      const comboCount = comboTotals.get(comboKey) ?? row.count;
      const categoryHourCount = categoryHourTotals.get(`${row.category}|||${row.hour}`) ?? row.count;
      const baselineDailyAvg = roundNumber((baselineComboCounts.get(comboKey) ?? 0) / baselineDayCount, 2);
      const pairShift = shiftByPair.get(`${row.cameraName}|||${row.category}`)?.shiftPct ?? 0;
      const comboRarity = 1 - comboCount / maxComboCount;
      const categoryHourRarity = 1 - categoryHourCount / maxCategoryHourCount;
      const deviation = Math.max(0, row.count - baselineDailyAvg);
      const deviationScore = Math.min(1, deviation / Math.max(baselineDailyAvg, 1));
      const shiftScore = Math.min(1, Math.max(0, pairShift) / 25);
      const noveltyScore = roundNumber(100 * (0.45 * comboRarity + 0.25 * categoryHourRarity + 0.2 * deviationScore + 0.1 * shiftScore), 1);

      if (noveltyScore < 55) {
        return;
      }

      noveltyCount += row.count;
      noveltyScoreTotal += noveltyScore;
      categoryContribution.set(row.category, (categoryContribution.get(row.category) ?? 0) + row.count);

      if (noveltyScore > maxNoveltyScore) {
        maxNoveltyScore = noveltyScore;
      }

      if (noveltyScore > topDriverScore) {
        topDriverScore = noveltyScore;
        topDriver = `${row.cameraName} ${row.category} @ ${row.hour.toString().padStart(2, "0")}:00`;
      }
    });

    if (categoryContribution.size > 0) {
      dominantCategory = Array.from(categoryContribution.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
    }

    const qualifiedPatterns = dateRows.filter((row) => {
      const comboKey = `${row.cameraName}|||${row.category}|||${row.hour}`;
      const comboCount = comboTotals.get(comboKey) ?? row.count;
      const categoryHourCount = categoryHourTotals.get(`${row.category}|||${row.hour}`) ?? row.count;
      const baselineDailyAvg = roundNumber((baselineComboCounts.get(comboKey) ?? 0) / baselineDayCount, 2);
      const pairShift = shiftByPair.get(`${row.cameraName}|||${row.category}`)?.shiftPct ?? 0;
      const comboRarity = 1 - comboCount / maxComboCount;
      const categoryHourRarity = 1 - categoryHourCount / maxCategoryHourCount;
      const deviation = Math.max(0, row.count - baselineDailyAvg);
      const deviationScore = Math.min(1, deviation / Math.max(baselineDailyAvg, 1));
      const shiftScore = Math.min(1, Math.max(0, pairShift) / 25);
      const noveltyScore = roundNumber(100 * (0.45 * comboRarity + 0.25 * categoryHourRarity + 0.2 * deviationScore + 0.1 * shiftScore), 1);
      return noveltyScore >= 55;
    }).length;

    return {
      date,
      noveltyCount,
      avgNoveltyScore: qualifiedPatterns > 0 ? roundNumber(noveltyScoreTotal / qualifiedPatterns, 1) : 0,
      maxNoveltyScore: roundNumber(maxNoveltyScore, 1),
      topDriver,
      dominantCategory
    };
  });
};

const buildAdvancedInsights = (leaders: CameraForecastLeader[], novelEvents: NovelEventPoint[], shifts: CategoryShiftPoint[]) => {
  const insights: InsightItem[] = [];
  const positiveLeader = leaders.filter((item) => item.delta > 0).sort((left, right) => right.delta - left.delta)[0];
  const negativeLeader = leaders.filter((item) => item.delta < 0).sort((left, right) => left.delta - right.delta)[0];
  const topNovel = novelEvents[0];
  const topShift = shifts.filter((item) => item.shiftPct > 0).sort((left, right) => right.shiftPct - left.shiftPct)[0];

  if (positiveLeader) {
    insights.push({
      title: `${positiveLeader.cameraName} is running hot`,
      detail: `Actual activity is ${roundNumber(positiveLeader.residualPct)}% above expected on ${positiveLeader.date}.`,
      tone: "warning"
    });
  }

  if (negativeLeader) {
    insights.push({
      title: `${negativeLeader.cameraName} is quieter than expected`,
      detail: `Actual activity is ${roundNumber(Math.abs(negativeLeader.residualPct))}% below expected on ${negativeLeader.date}.`,
      tone: "info"
    });
  }

  if (topNovel) {
    insights.push({
      title: `Novel ${topNovel.category} activity is emerging`,
      detail: `${topNovel.cameraName} at ${topNovel.hour.toString().padStart(2, "0")}:00 carries the highest novelty score in the current slice.`,
      tone: "alert"
    });
  }

  if (topShift) {
    insights.push({
      title: `${topShift.cameraName} has a category shift`,
      detail: `${topShift.category} share moved by ${roundNumber(topShift.shiftPct)} points against baseline.`,
      tone: "positive"
    });
  }

  return insights.slice(0, 4);
};

export const getAnalyticsLab = async (filters: DashboardFilters): Promise<AnalyticsLabResponse> => {
  const cte = filteredEventsCte(filters);

  const [
    hourCategoryResult,
    cameraCategoryResult,
    dailySeasonalityResult,
    burstBehaviorResult,
    cameraDailyResult,
    comboDailyResult,
    diversityResult,
    ratioResult,
    environmentalResult,
    cameraAnomaliesRaw,
    anomalyTimelineResult,
    dataQualityResult
  ] = await Promise.all([
    pool.query(
      `
      ${cte.text}
      select
        extract(hour from first_seen)::int as row,
        subject_category as column,
        count(*)::int as count
      from event_groups
      group by 1, 2
      order by 1 asc, 2 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        camera_name as row,
        subject_category as column,
        count(*)::int as count
      from event_groups
      group by 1, 2
      order by 1 asc, 2 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        first_seen::date::text as date,
        count(*) filter (where subject_category = 'wildlife')::int as wildlife,
        count(*) filter (where subject_category = 'human')::int as human,
        count(*) filter (where subject_category = 'vehicle')::int as vehicle,
        count(*) filter (where subject_category = 'empty_scene')::int as "emptyScene",
        count(*) filter (where subject_category not in ('wildlife', 'human', 'vehicle', 'empty_scene'))::int as unknown
      from event_groups
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        camera_name as "cameraName",
        round(avg(event_group_size)::numeric, 2)::double precision as "avgBurstSize",
        percentile_cont(0.95) within group (order by event_group_size)::double precision as "p95BurstSize",
        count(*)::int as "eventCount"
      from event_groups
      group by 1
      order by "eventCount" desc, "cameraName" asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        first_seen::date::text as date,
        camera_name as "cameraName",
        count(*)::int as count
      from event_groups
      group by 1, 2
      order by 1 asc, 2 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        first_seen::date::text as date,
        camera_name as "cameraName",
        subject_category as category,
        extract(hour from first_seen)::int as hour,
        count(*)::int as count
      from event_groups
      group by 1, 2, 3, 4
      order by 1 asc, 2 asc, 3 asc, 4 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        camera_name as "cameraName",
        count(distinct subject_class)::int as "diversityScore",
        coalesce(100.0 * count(*) filter (where subject_category = 'wildlife') / nullif(count(*), 0), 0) as "wildlifeRatioPct",
        coalesce(100.0 * count(*) filter (where subject_category = 'human') / nullif(count(*), 0), 0) as "humanRatioPct",
        coalesce(100.0 * count(*) filter (where low_light_any) / nullif(count(*), 0), 0) as "lowLightSharePct",
        avg(avg_voltage)::double precision as "avgVoltage",
        count(*)::int as "totalEvents"
      from event_groups
      group by 1
      order by "totalEvents" desc, "cameraName" asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        camera_name as "cameraName",
        coalesce(100.0 * count(*) filter (where subject_category = 'wildlife') / nullif(count(*), 0), 0) as "wildlifePct",
        coalesce(100.0 * count(*) filter (where subject_category = 'human') / nullif(count(*), 0), 0) as "humanPct",
        coalesce(100.0 * count(*) filter (where subject_category = 'vehicle') / nullif(count(*), 0), 0) as "vehiclePct"
      from event_groups
      group by 1
      order by "cameraName" asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        subject_category as category,
        avg(lux)::double precision as "avgLux",
        avg(temperature)::double precision as "avgTemperature",
        avg(heat_level)::double precision as "avgHeatLevel"
      from base
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        camera_name,
        to_char(max(local_timestamp), 'YYYY-MM-DD"T"HH24:MI:SS') as last_seen,
        extract(epoch from (now()::timestamp - max(local_timestamp))) / 3600 as last_seen_hours_ago,
        count(distinct event_group)::int as total_events,
        coalesce(100.0 * count(distinct event_group) filter (where ai_processed) / nullif(count(distinct event_group), 0), 0) as ai_processed_pct,
        coalesce(100.0 * count(distinct event_group) filter (where uploaded) / nullif(count(distinct event_group), 0), 0) as upload_success_pct,
        avg(processing_lag_seconds)::double precision as avg_processing_lag_seconds,
        avg(voltage)::double precision as avg_voltage,
        count(*) filter (where suspicious_numeric_flag)::int as suspicious_telemetry_count,
        coalesce(100.0 * count(*) filter (where voltage is not null and voltage < 11.5) / nullif(count(*), 0), 0) as low_voltage_rate_pct,
        coalesce(100.0 * count(*) filter (where ai_processed is false or analysis_summary is null) / nullif(count(*), 0), 0) as missing_ai_rate_pct
      from base
      group by 1
      order by total_events desc, camera_name asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        local_timestamp::date::text as date,
        count(*) filter (
          where coalesce(uploaded, true) = false
            or (voltage is not null and voltage < 11.5)
            or coalesce(processing_lag_seconds, 0) > 7200
            or suspicious_numeric_flag
        )::int as "anomalyCount",
        avg(
          least(
            100,
            greatest(
              0,
              (case when coalesce(uploaded, true) = false then 30 else 0 end)
              + (case when voltage is not null and voltage < 11.5 then 18 else 0 end)
              + least(20, coalesce(processing_lag_seconds, 0) / 1200.0)
              + (case when suspicious_numeric_flag then 12 else 0 end)
            )
          )
        )::double precision as "avgAnomalyScore"
      from base
      group by 1
      order by 1 asc
      `,
      cte.values
    ),
    pool.query(
      `
      ${cte.text}
      select
        count(*)::int as total_rows,
        coalesce(100.0 * count(*) filter (where analysis_summary is null and analysis_title is null) / nullif(count(*), 0), 0) as missing_analysis_rate_pct,
        coalesce(100.0 * count(*) filter (where parse_success) / nullif(count(*), 0), 0) as parse_success_pct,
        coalesce(100.0 * count(*) filter (where analysis_summary is not null or analysis_title is not null) / nullif(count(*), 0), 0) as analysis_completeness_pct,
        coalesce(100.0 * count(*) filter (where voltage is not null) / nullif(count(*), 0), 0) as voltage_completeness_pct,
        coalesce(100.0 * count(*) filter (where lux is not null) / nullif(count(*), 0), 0) as lux_completeness_pct,
        coalesce(100.0 * count(*) filter (where temperature is not null) / nullif(count(*), 0), 0) as temperature_completeness_pct,
        coalesce(100.0 * count(*) filter (where humidity is not null) / nullif(count(*), 0), 0) as humidity_completeness_pct,
        count(*) filter (where suspicious_numeric_flag)::int as suspicious_numeric_count,
        count(*) filter (where coalesce(uploaded, true) = false)::int as upload_failures,
        count(*) filter (where ai_processed is true and (analysis_summary is null and analysis_title is null))::int as ai_without_summary,
        count(*) filter (where json_processed is false and ai_processed is true)::int as json_pending_after_ai
      from base
      `,
      cte.values
    )
  ]);

  const dailySeasonality = dailySeasonalityResult.rows as CategoryTrendPoint[];
  const forecast: ForecastPoint[] = dailySeasonality.map((day, index, all) => {
    const actual = day.wildlife + day.human + day.vehicle + day.emptyScene + day.unknown;
    const prior = all.slice(Math.max(0, index - 7), index).map((item) => item.wildlife + item.human + item.vehicle + item.emptyScene + item.unknown);
    const expected = prior.length > 0 ? prior.reduce((sum, value) => sum + value, 0) / prior.length : actual;
    return {
      date: day.date,
      actual,
      expected: roundNumber(expected, 2),
      delta: roundNumber(actual - expected, 2)
    };
  });
  const { cameraForecast, cameraForecastLeaders } = buildCameraForecast(cameraDailyResult.rows as CameraDailyAggregate[]);
  const categoryShiftMatrix = buildCategoryShiftMatrix(comboDailyResult.rows as ComboDailyAggregate[]);
  const { novelEvents, noveltyByDate } = buildNovelEvents(comboDailyResult.rows as ComboDailyAggregate[], categoryShiftMatrix);
  const noveltyTimelineDaily = buildNoveltyTimelineDaily(comboDailyResult.rows as ComboDailyAggregate[], categoryShiftMatrix);

  const cameraAnomalies: CameraAnomalyPoint[] = cameraAnomaliesRaw.rows.map((row) => {
    const health = computeCameraHealth({
      camera_name: row.camera_name,
      last_seen: row.last_seen,
      last_seen_hours_ago: row.last_seen_hours_ago,
      total_events: row.total_events,
      ai_processed_pct: row.ai_processed_pct,
      json_processed_pct: row.ai_processed_pct,
      upload_success_pct: row.upload_success_pct,
      avg_upload_lag_seconds: row.avg_processing_lag_seconds,
      avg_ai_lag_seconds: row.avg_processing_lag_seconds,
      avg_processing_lag_seconds: row.avg_processing_lag_seconds,
      avg_voltage: row.avg_voltage
    });

    return {
      cameraName: health.cameraName,
      anomalyScore: health.anomalyScore,
      healthScore: health.healthScore,
      staleHours: health.lastSeenHoursAgo,
      avgLagSeconds: row.avg_processing_lag_seconds === null ? null : Number(row.avg_processing_lag_seconds),
      lowVoltageRatePct: Number(row.low_voltage_rate_pct ?? 0),
      missingAiRatePct: Number(row.missing_ai_rate_pct ?? 0),
      suspiciousTelemetryCount: Number(row.suspicious_telemetry_count ?? 0),
      status: health.status
    };
  });

  const diversityByCamera = diversityResult.rows as DiversityPoint[];
  const dataQualityRow = dataQualityResult.rows[0] ?? {};
  const dataQuality: DataQualityResponse = {
    missingAnalysisRatePct: Number(dataQualityRow.missing_analysis_rate_pct ?? 0),
    parseSuccessPct: Number(dataQualityRow.parse_success_pct ?? 0),
    fieldCompleteness: [
      { field: "analysis", completenessPct: Number(dataQualityRow.analysis_completeness_pct ?? 0) },
      { field: "voltage", completenessPct: Number(dataQualityRow.voltage_completeness_pct ?? 0) },
      { field: "lux", completenessPct: Number(dataQualityRow.lux_completeness_pct ?? 0) },
      { field: "temperature", completenessPct: Number(dataQualityRow.temperature_completeness_pct ?? 0) },
      { field: "humidity", completenessPct: Number(dataQualityRow.humidity_completeness_pct ?? 0) }
    ],
    suspiciousValueCounts: [
      { label: "Suspicious numeric values", count: Number(dataQualityRow.suspicious_numeric_count ?? 0) },
      { label: "Upload failures", count: Number(dataQualityRow.upload_failures ?? 0) }
    ],
    pipelineConsistency: [
      { label: "AI processed without summary", count: Number(dataQualityRow.ai_without_summary ?? 0) },
      { label: "JSON pending after AI", count: Number(dataQualityRow.json_pending_after_ai ?? 0) }
    ]
  };
  const advancedInsights = buildAdvancedInsights(cameraForecastLeaders, novelEvents, categoryShiftMatrix);
  const anomalyTimeline = anomalyTimelineResult.rows.map((row) => {
    const novelty = noveltyByDate.get(String(row.date));
    return {
      date: String(row.date),
      anomalyCount: Number(row.anomalyCount ?? 0),
      avgAnomalyScore: roundNumber(row.avgAnomalyScore ?? 0, 1),
      topDriver: novelty?.topDriver ?? null,
      novelEventCount: novelty?.novelEventCount ?? 0
    };
  }) as AnalyticsLabResponse["anomalyTimeline"];

  return {
    hourCategoryHeatmap: hourCategoryResult.rows as HeatmapCountPoint[],
    cameraCategoryHeatmap: cameraCategoryResult.rows as HeatmapCountPoint[],
    dailySeasonality,
    burstBehavior: burstBehaviorResult.rows.map((row) => ({
      cameraName: String(row.cameraName),
      avgBurstSize: Number(row.avgBurstSize ?? 0),
      p95BurstSize: Number(row.p95BurstSize ?? 0),
      eventCount: Number(row.eventCount ?? 0)
    })),
    diversityByCamera,
    humanWildlifeRatioByCamera: ratioResult.rows.map((row) => ({
      cameraName: String(row.cameraName),
      wildlifePct: Number(row.wildlifePct ?? 0),
      humanPct: Number(row.humanPct ?? 0),
      vehiclePct: Number(row.vehiclePct ?? 0)
    })),
    environmentalContext: environmentalResult.rows as EnvironmentalContextPoint[],
    cameraAnomalies,
    anomalyTimeline,
    forecast,
    cameraForecast,
    cameraForecastLeaders,
    novelEvents,
    noveltyTimelineDaily,
    categoryShiftMatrix,
    advancedInsights,
    cameraClusters: buildCameraClusters(diversityByCamera, cameraAnomalies),
    dataQuality
  };
};

export const getDaySummary = async (date: string, filters: DashboardFilters): Promise<DaySummaryResponse> => {
  const dayFilters = { ...filters, start_date: date, end_date: date };
  const filter = buildFilterClause(dayFilters);

  const [summaryResult, hourlyResult, subjectResult, cameraResult, eventsResult] = await Promise.all([
    pool.query(
      `
      with filtered as (
        select * from events e
        ${filter.text}
      )
      select
        count(distinct ${normalizedEventSql("filtered")})::int as total_event_groups,
        count(*)::int as total_raw_rows
      from filtered
      `,
      filter.values
    ),
    pool.query(
      `
      with filtered as (
        select * from events e
        ${filter.text}
      )
      select
        extract(hour from ${normalizedTimestampSql("filtered")})::int as hour,
        count(distinct ${normalizedEventSql("filtered")})::int as "uniqueEventGroups",
        count(*)::int as "rawRows"
      from filtered
      group by 1
      order by 1 asc
      `,
      filter.values
    ),
    pool.query(
      `
      with filtered as (
        select * from events e
        ${filter.text}
      )
      select
        ${normalizedSubjectClassSql("filtered")} as "subjectClass",
        count(distinct ${normalizedEventSql("filtered")})::int as "uniqueEventGroups"
      from filtered
      where ${normalizedSubjectClassSql("filtered")} is not null
      group by 1
      order by "uniqueEventGroups" desc, "subjectClass" asc
      `,
      filter.values
    ),
    pool.query(
      `
      with filtered as (
        select * from events e
        ${filter.text}
      )
      select
        ${normalizedCameraNameSql("filtered")} as "cameraName",
        count(distinct ${normalizedEventSql("filtered")})::int as "uniqueEventGroups"
      from filtered
      group by 1
      order by "uniqueEventGroups" desc, "cameraName" asc
      `,
      filter.values
    ),
    pool.query(
      `
      with filtered as (
        select * from events e
        ${filter.text}
      )
      select
        id,
        to_char(${normalizedTimestampSql("filtered")}, 'YYYY-MM-DD"T"HH24:MI:SS') as "timestamp",
        to_char(${normalizedTimestampSql("filtered")}, 'YYYY-MM-DD"T"HH24:MI:SS') as local_timestamp,
        ${normalizedCameraNameSql("filtered")} as camera_name,
        name,
        mac,
        ${normalizedEventSql("filtered")} as event,
        count(*) over (partition by ${normalizedEventSql("filtered")})::int as event_group_size,
        sequence,
        ${normalizedSubjectClassSql("filtered")} as subject_class,
        ${normalizedSubjectCategorySql("filtered")} as subject_category,
        ${normalizedTimeOfDayBucketSql("filtered")} as time_of_day_bucket,
        ${normalizedAnalysisTitleSql("filtered")} as analysis_title,
        ${normalizedAnalysisSummarySql("filtered")} as analysis_summary,
        analysis,
        ai_description,
        ai_processed,
        json_processed,
        uploaded,
        ${normalizedUploadTextSql("filtered")} as upload,
        lux,
        ${normalizedTemperatureSql("filtered")} as temperature,
        ${normalizedHumiditySql("filtered")} as humidity,
        ${normalizedPressureSql("filtered")} as pressure,
        ${normalizedHeatLevelSql("filtered")} as heat_level,
        sensor,
        location,
        ${normalizedBatteryPercentageSql("filtered")} as battery_percentage,
        ${normalizedVoltageSql("filtered")} as voltage,
        ${normalizedTimezoneSql("filtered")} as timezone,
        ${normalizedLatitudeSql("filtered")} as latitude,
        ${normalizedLongitudeSql("filtered")} as longitude,
        ${normalizedBearingSql("filtered")} as bearing,
        ${normalizedFileTypeSql("filtered")} as file_type,
        tag,
        to_char(utc_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as utc_timestamp,
        to_char(utc_timestamp_off, 'YYYY-MM-DD"T"HH24:MI:SS') as utc_timestamp_off,
        to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS') as created,
        to_char(ai_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as ai_timestamp,
        to_char(json_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as json_timestamp,
        filename,
        image_blob_url,
        case
          when created is not null then greatest(extract(epoch from (created - ${normalizedTimestampSql("filtered")})), 0)::int
          else null
        end as upload_lag_seconds,
        case
          when ai_timestamp is not null then greatest(extract(epoch from (ai_timestamp - ${normalizedTimestampSql("filtered")})), 0)::int
          else null
        end as ai_lag_seconds,
        case
          when coalesce(ai_timestamp, json_timestamp, created) is not null
            then greatest(extract(epoch from (coalesce(ai_timestamp, json_timestamp, created) - ${normalizedTimestampSql("filtered")})), 0)::int
          else null
        end as processing_lag_seconds,
        case when coalesce(${normalizedLuxSql("filtered")}, 999999) < 15 then true else false end as low_light_flag,
        case
          when extract(hour from ${normalizedTimestampSql("filtered")}) between 5 and 7 then 'dawn'
          when extract(hour from ${normalizedTimestampSql("filtered")}) between 8 and 16 then 'day'
          when extract(hour from ${normalizedTimestampSql("filtered")}) between 17 and 20 then 'dusk'
          else 'night'
        end as daypart
      from filtered
      order by ${normalizedTimestampSql("filtered")} desc, id asc
      limit 50
      `,
      filter.values
    )
  ]);

  const summary = summaryResult.rows[0];
  return {
    date,
    totalEventGroups: Number(summary.total_event_groups ?? 0),
    totalRawRows: Number(summary.total_raw_rows ?? 0),
    hourlyDistribution: hourlyResult.rows as DaySummaryResponse["hourlyDistribution"],
    subjectBreakdown: subjectResult.rows as DaySummaryResponse["subjectBreakdown"],
    cameraBreakdown: cameraResult.rows as DaySummaryResponse["cameraBreakdown"],
    events: eventsResult.rows.map(mapEventRow)
  };
};

export const getEvents = async (query: EventQuery): Promise<EventsResponse> => {
  const filter = buildFilterClause(query);
  const orderBy = getEventOrderBy(query);
  const offset = (query.page - 1) * query.page_size;
  const values = [...filter.values, query.page_size, offset];

  const [countResult, rowsResult] = await Promise.all([
    pool.query(
      `
      select count(*)::int as total
      from events e
      ${filter.text}
      `,
      filter.values
    ),
    pool.query(
      `
      select
        id,
        to_char(${normalizedTimestampSql("e")}, 'YYYY-MM-DD"T"HH24:MI:SS') as "timestamp",
        to_char(${normalizedTimestampSql("e")}, 'YYYY-MM-DD"T"HH24:MI:SS') as local_timestamp,
        ${normalizedCameraNameSql("e")} as camera_name,
        name,
        mac,
        ${normalizedEventSql("e")} as event,
        count(*) over (partition by ${normalizedEventSql("e")})::int as event_group_size,
        sequence,
        ${normalizedSubjectClassSql("e")} as subject_class,
        ${normalizedSubjectCategorySql("e")} as subject_category,
        ${normalizedTimeOfDayBucketSql("e")} as time_of_day_bucket,
        ${normalizedAnalysisTitleSql("e")} as analysis_title,
        ${normalizedAnalysisSummarySql("e")} as analysis_summary,
        analysis,
        ai_description,
        ai_processed,
        json_processed,
        uploaded,
        ${normalizedUploadTextSql("e")} as upload,
        lux,
        ${normalizedTemperatureSql("e")} as temperature,
        ${normalizedHumiditySql("e")} as humidity,
        ${normalizedPressureSql("e")} as pressure,
        ${normalizedHeatLevelSql("e")} as heat_level,
        sensor,
        location,
        ${normalizedBatteryPercentageSql("e")} as battery_percentage,
        ${normalizedVoltageSql("e")} as voltage,
        ${normalizedTimezoneSql("e")} as timezone,
        ${normalizedLatitudeSql("e")} as latitude,
        ${normalizedLongitudeSql("e")} as longitude,
        ${normalizedBearingSql("e")} as bearing,
        ${normalizedFileTypeSql("e")} as file_type,
        tag,
        to_char(utc_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as utc_timestamp,
        to_char(utc_timestamp_off, 'YYYY-MM-DD"T"HH24:MI:SS') as utc_timestamp_off,
        to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS') as created,
        to_char(ai_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as ai_timestamp,
        to_char(json_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as json_timestamp,
        filename,
        image_blob_url,
        case
          when created is not null then greatest(extract(epoch from (created - ${normalizedTimestampSql("e")})), 0)::int
          else null
        end as upload_lag_seconds,
        case
          when ai_timestamp is not null then greatest(extract(epoch from (ai_timestamp - ${normalizedTimestampSql("e")})), 0)::int
          else null
        end as ai_lag_seconds,
        case
          when coalesce(ai_timestamp, json_timestamp, created) is not null
            then greatest(extract(epoch from (coalesce(ai_timestamp, json_timestamp, created) - ${normalizedTimestampSql("e")})), 0)::int
          else null
        end as processing_lag_seconds,
        case when coalesce(${normalizedLuxSql("e")}, 999999) < 15 then true else false end as low_light_flag,
        case
          when extract(hour from ${normalizedTimestampSql("e")}) between 5 and 7 then 'dawn'
          when extract(hour from ${normalizedTimestampSql("e")}) between 8 and 16 then 'day'
          when extract(hour from ${normalizedTimestampSql("e")}) between 17 and 20 then 'dusk'
          else 'night'
        end as daypart
      from events e
      ${filter.text}
      ${orderBy}
      limit $${values.length - 1}
      offset $${values.length}
      `,
      values
    )
  ]);

  return {
    page: query.page,
    pageSize: query.page_size,
    total: Number(countResult.rows[0]?.total ?? 0),
    rows: rowsResult.rows.map(mapEventRow)
  };
};

export const getEventsCsv = async (query: EventQuery): Promise<string> => {
  const filter = buildFilterClause(query);
  const orderBy = getEventOrderBy(query);
  const result = await pool.query(
    `
    select
      to_char(${normalizedTimestampSql("e")}, 'YYYY-MM-DD HH24:MI:SS') as timestamp,
      ${normalizedCameraNameSql("e")} as camera_name,
      e.mac,
      ${normalizedEventSql("e")} as event,
      e.sequence,
      ${normalizedSubjectClassSql("e")} as subject_class,
      ${normalizedSubjectCategorySql("e")} as subject_category,
      ${normalizedTimeOfDayBucketSql("e")} as time_of_day_bucket,
      replace(coalesce(${normalizedAnalysisTitleSql("e")}, ''), ',', ' ') as analysis_title,
      replace(coalesce(${normalizedAnalysisSummarySql("e")}, ''), ',', ' ') as analysis_summary,
      e.lux,
      e.temperature,
      ${normalizedHeatLevelSql("e")} as heat_level,
      e.sensor
    from events e
    ${filter.text}
    ${orderBy}
    limit 5000
    `,
    filter.values
  );

  const header = [
    "timestamp",
    "camera_name",
    "mac",
    "event",
    "sequence",
    "subject_class",
    "subject_category",
    "time_of_day_bucket",
    "analysis_title",
    "analysis_summary",
    "lux",
    "temperature",
    "heat_level",
    "sensor"
  ];

  const lines = result.rows.map((row: Record<string, unknown>) =>
    header
      .map((key) => {
        const raw = row[key];
        const value = raw === null || raw === undefined ? "" : String(raw).replace(/"/g, '""');
        return `"${value}"`;
      })
      .join(",")
  );

  return [header.join(","), ...lines].join("\n");
};
