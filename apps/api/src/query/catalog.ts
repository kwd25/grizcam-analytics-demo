import type {
  QueryAggregate,
  QueryColumnMetadata,
  QueryColumnType,
  QueryExample,
  QueryMetadataResponse,
  QueryOperator,
  QueryRelationMetadata
} from "@grizcam/shared";

type CatalogColumnInput = Omit<QueryColumnMetadata, "label" | "filterOperators" | "aggregates" | "groupable" | "sortable"> & {
  label?: string;
  filterOperators?: QueryOperator[];
  aggregates?: QueryAggregate[];
  groupable?: boolean;
  sortable?: boolean;
};

type CatalogRelationInput = Omit<QueryRelationMetadata, "columns"> & {
  columns: CatalogColumnInput[];
};

const operatorSets: Record<QueryColumnType, QueryOperator[]> = {
  text: ["=", "!=", "IN", "LIKE", "ILIKE", "IS NULL", "IS NOT NULL"],
  number: ["=", "!=", ">", ">=", "<", "<=", "IN", "BETWEEN", "IS NULL", "IS NOT NULL"],
  date: ["=", "!=", ">", ">=", "<", "<=", "BETWEEN", "IS NULL", "IS NOT NULL"],
  timestamp: ["=", "!=", ">", ">=", "<", "<=", "BETWEEN", "IS NULL", "IS NOT NULL"],
  boolean: ["=", "!=", "IS NULL", "IS NOT NULL"],
  json: ["IS NULL", "IS NOT NULL"]
};

const aggregateSets: Record<QueryColumnType, QueryAggregate[]> = {
  text: ["COUNT", "MIN", "MAX"],
  number: ["COUNT", "AVG", "MIN", "MAX", "SUM"],
  date: ["COUNT", "MIN", "MAX"],
  timestamp: ["COUNT", "MIN", "MAX"],
  boolean: ["COUNT"],
  json: ["COUNT"]
};

const createColumn = (column: CatalogColumnInput): QueryColumnMetadata => ({
  name: column.name,
  label: column.label ?? column.name.replace(/_/g, " "),
  type: column.type,
  description: column.description,
  filterOperators: column.filterOperators ?? operatorSets[column.type],
  aggregates: column.aggregates ?? aggregateSets[column.type],
  groupable: column.groupable ?? column.type !== "json",
  sortable: column.sortable ?? column.type !== "json"
});

const createRelation = (relation: CatalogRelationInput): QueryRelationMetadata => ({
  ...relation,
  columns: relation.columns.map(createColumn)
});

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const relations: QueryRelationMetadata[] = [
  createRelation({
    name: "daily_camera_summary",
    label: "Daily Camera Summary",
    description: "Daily rollups by camera. Best starting point for trend and KPI-style analysis.",
    category: "preferred",
    defaultLimit: DEFAULT_LIMIT,
    maxLimit: MAX_LIMIT,
    defaultColumns: ["date", "camera_name", "unique_event_groups", "avg_temperature", "avg_lux"],
    supportsAggregates: true,
    supportsGroupBy: true,
    columns: [
      { name: "date", type: "date" },
      { name: "mac", type: "text" },
      { name: "camera_name", type: "text" },
      { name: "total_rows", type: "number" },
      { name: "unique_event_groups", type: "number" },
      { name: "wildlife_rows", type: "number" },
      { name: "human_rows", type: "number" },
      { name: "vehicle_rows", type: "number" },
      { name: "empty_scene_rows", type: "number" },
      { name: "morning_rows", type: "number" },
      { name: "afternoon_rows", type: "number" },
      { name: "evening_rows", type: "number" },
      { name: "night_rows", type: "number" },
      { name: "avg_temperature", type: "number" },
      { name: "avg_lux", type: "number" },
      { name: "avg_heat_level", type: "number" },
      { name: "avg_battery_percentage", type: "number" }
    ]
  }),
  createRelation({
    name: "dim_devices",
    label: "Camera Devices",
    description: "Camera lookup and device context metadata.",
    category: "preferred",
    defaultLimit: 50,
    maxLimit: 100,
    defaultColumns: ["camera_name", "mac", "location_name", "camera_profile"],
    supportsAggregates: true,
    supportsGroupBy: true,
    columns: [
      { name: "mac", type: "text" },
      { name: "camera_name", type: "text" },
      { name: "location_name", type: "text" },
      { name: "location_code", type: "text" },
      { name: "latitude", type: "number" },
      { name: "longitude", type: "number" },
      { name: "camera_profile", type: "text" },
      { name: "notes", type: "text" }
    ]
  }),
  createRelation({
    name: "events",
    label: "Events (Advanced)",
    description: "Event-level rows for deeper inspection. Explicit columns are required and row limits are enforced.",
    category: "advanced",
    defaultLimit: 100,
    maxLimit: 250,
    defaultColumns: ["timestamp", "camera_name", "event", "subject_category", "analysis_title"],
    supportsAggregates: true,
    supportsGroupBy: true,
    columns: [
      { name: "id", type: "text" },
      { name: "name", type: "text" },
      { name: "camera_name", type: "text" },
      { name: "mac", type: "text" },
      { name: "event", type: "text" },
      { name: "timestamp", type: "timestamp" },
      { name: "utc_timestamp", type: "timestamp" },
      { name: "sequence", type: "number" },
      { name: "sensor", type: "text" },
      { name: "location", type: "text" },
      { name: "latitude", type: "number" },
      { name: "longitude", type: "number" },
      { name: "temperature", type: "number" },
      { name: "humidity", type: "number" },
      { name: "pressure", type: "number" },
      { name: "voltage", type: "number" },
      { name: "bearing", type: "number" },
      { name: "battery_percentage", type: "number" },
      { name: "lux", type: "number" },
      { name: "heat_level", type: "number" },
      { name: "file_type", type: "text" },
      { name: "filename", type: "text" },
      { name: "image_blob_url", type: "text" },
      { name: "uploaded", type: "boolean" },
      { name: "upload", type: "text" },
      { name: "created", type: "timestamp" },
      { name: "ai_processed", type: "boolean" },
      { name: "ai_timestamp", type: "timestamp" },
      { name: "json_processed", type: "boolean" },
      { name: "json_timestamp", type: "timestamp" },
      { name: "utc_timestamp_off", type: "timestamp" },
      { name: "timezone", type: "text" },
      { name: "tag", type: "text" },
      { name: "analysis_title", type: "text" },
      { name: "analysis_summary", type: "text" },
      { name: "subject_class", type: "text" },
      { name: "subject_category", type: "text" },
      { name: "time_of_day_bucket", type: "text" }
    ]
  })
];

const examples: QueryExample[] = [
  {
    id: "daily-rollups",
    label: "Daily rollups by camera",
    description: "Summary trend query across daily camera rollups.",
    relation: "daily_camera_summary",
    sql: `select
  date,
  camera_name,
  unique_event_groups,
  avg_temperature,
  avg_lux
from daily_camera_summary
order by date desc, camera_name asc
limit 30`
  },
  {
    id: "recent-events",
    label: "Recent events",
    description: "Inspect the latest event rows with explicit safe columns.",
    relation: "events",
    sql: `select
  timestamp,
  camera_name,
  event,
  subject_category,
  analysis_title
from events
order by timestamp desc
limit 50`
  },
  {
    id: "top-cameras",
    label: "Top cameras by volume",
    description: "Aggregate summary rows to find the busiest cameras.",
    relation: "daily_camera_summary",
    sql: `select
  camera_name,
  sum(unique_event_groups) as total_event_groups
from daily_camera_summary
group by camera_name
order by total_event_groups desc
limit 10`
  },
  {
    id: "category-counts",
    label: "Category counts",
    description: "Count event rows by subject category.",
    relation: "events",
    sql: `select
  subject_category,
  count(*) as event_count
from events
where subject_category is not null
group by subject_category
order by event_count desc
limit 20`
  },
  {
    id: "avg-voltage",
    label: "Average voltage by camera",
    description: "Average telemetry reading by camera.",
    relation: "events",
    sql: `select
  camera_name,
  round(avg(voltage)::numeric, 2) as avg_voltage
from events
where voltage is not null
group by camera_name
order by avg_voltage desc
limit 20`
  }
];

export const queryCatalog = {
  defaultLimit: DEFAULT_LIMIT,
  maxLimit: MAX_LIMIT,
  allowedAggregates: ["COUNT", "AVG", "MIN", "MAX", "SUM"] as QueryAggregate[],
  allowedFunctions: new Set(["count", "avg", "min", "max", "sum", "date_trunc", "round", "coalesce", "lower", "upper"]),
  relations,
  relationMap: new Map(relations.map((relation) => [relation.name, relation])),
  examples
};

export const getQueryMetadata = (): QueryMetadataResponse => ({
  relations: queryCatalog.relations,
  allowedAggregates: queryCatalog.allowedAggregates,
  maxLimit: queryCatalog.maxLimit,
  defaultLimit: queryCatalog.defaultLimit,
  examples: queryCatalog.examples,
  helpText: {
    title: "Read-only query workspace",
    body: "Only approved analytics relations are available. The backend blocks writes, comments, multi-statement SQL, unsafe relations, and oversized result sets."
  }
});
