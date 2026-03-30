import type {
  CompositionPoint,
  DailyActivityPoint,
  DashboardFilters,
  DaySummaryResponse,
  EventsResponse,
  EventQuery,
  FilterOptionsResponse,
  HourlyHeatmapPoint,
  KpiResponse,
  MonthlyActivityCategoryPoint,
  SubjectCameraHeatmapPoint,
  TimeOfDayCompositionPoint
} from "@grizcam/shared";
import { pool } from "../db.js";
import { buildFilterClause, getEventOrderBy, mapEventRow } from "../utils/sql.js";

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
    pool.query(`select distinct time_of_day_bucket from events where time_of_day_bucket is not null order by 1 asc`),
    pool.query(`select distinct subject_category from events where subject_category is not null order by 1 asc`),
    pool.query(`select distinct subject_class from events where subject_class is not null order by 1 asc`),
    pool.query(
      `select
         min(lux)::int as min_lux,
         max(lux)::int as max_lux,
         floor(min(temperature))::int as min_temperature,
         ceil(max(temperature))::int as max_temperature,
         min(heat_level)::int as min_heat_level,
         max(heat_level)::int as max_heat_level
       from events`
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
        event,
        min(camera_name) as camera_name,
        min(subject_category) as subject_category,
        min(subject_class) as subject_class,
        min(timestamp) as first_seen,
        count(*) as row_count
      from filtered
      group by event
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
      timestamp::date::text as date,
      camera_name as "cameraName",
      count(distinct event)::int as "uniqueEventGroups",
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
      camera_name as "cameraName",
      extract(hour from timestamp)::int as hour,
      count(distinct event)::int as "uniqueEventGroups",
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
      time_of_day_bucket as bucket,
      count(distinct event) filter (where subject_category = 'wildlife')::int as wildlife,
      count(distinct event) filter (where subject_category = 'human')::int as human,
      count(distinct event) filter (where subject_category = 'vehicle')::int as vehicle,
      count(distinct event) filter (where subject_category = 'empty_scene')::int as "emptyScene"
    from filtered
    group by 1
    order by case time_of_day_bucket when 'morning' then 1 when 'afternoon' then 2 when 'evening' then 3 else 4 end
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
      camera_name as "cameraName",
      subject_class as "subjectClass",
      count(distinct event)::int as "uniqueEventGroups"
    from filtered
    where subject_class is not null
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
      to_char(date_trunc('month', timestamp), 'YYYY-MM') as month,
      count(distinct event) filter (where subject_category = 'wildlife')::int as wildlife,
      count(distinct event) filter (where subject_category = 'human')::int as human,
      count(distinct event) filter (where subject_category = 'vehicle')::int as vehicle,
      count(distinct event) filter (where subject_category = 'empty_scene')::int as "emptyScene"
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
      coalesce(subject_category, 'unknown') as category,
      count(distinct event)::int as "uniqueEventGroups"
    from filtered
    group by 1
    order by "uniqueEventGroups" desc, category asc
    `,
    filter.values
  );
  return result.rows as CompositionPoint[];
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
        count(distinct event)::int as total_event_groups,
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
        extract(hour from timestamp)::int as hour,
        count(distinct event)::int as "uniqueEventGroups",
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
        subject_class as "subjectClass",
        count(distinct event)::int as "uniqueEventGroups"
      from filtered
      where subject_class is not null
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
        camera_name as "cameraName",
        count(distinct event)::int as "uniqueEventGroups"
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
        to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SS') as "timestamp",
        camera_name,
        mac,
        event,
        sequence,
        subject_class,
        subject_category,
        time_of_day_bucket,
        analysis_title,
        analysis_summary,
        lux,
        temperature,
        heat_level,
        sensor,
        location,
        battery_percentage,
        filename,
        image_blob_url
      from filtered
      order by "timestamp" desc, id asc
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
        to_char(e."timestamp", 'YYYY-MM-DD"T"HH24:MI:SS') as "timestamp",
        camera_name,
        mac,
        event,
        sequence,
        subject_class,
        subject_category,
        time_of_day_bucket,
        analysis_title,
        analysis_summary,
        lux,
        temperature,
        heat_level,
        sensor,
        location,
        battery_percentage,
        filename,
        image_blob_url
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
      to_char(e."timestamp", 'YYYY-MM-DD HH24:MI:SS') as timestamp,
      e.camera_name,
      e.mac,
      e.event,
      e.sequence,
      e.subject_class,
      e.subject_category,
      e.time_of_day_bucket,
      replace(coalesce(e.analysis_title, ''), ',', ' ') as analysis_title,
      replace(coalesce(e.analysis_summary, ''), ',', ' ') as analysis_summary,
      e.lux,
      e.temperature,
      e.heat_level,
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
