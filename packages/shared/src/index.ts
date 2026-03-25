import { z } from "zod";

const splitCsv = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      typeof entry === "string" ? entry.split(",").map((item) => item.trim()).filter(Boolean) : []
    );
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const numericParam = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return Number(value);
}, z.number().finite().optional());

export const dashboardFiltersSchema = z.object({
  camera_name: z.preprocess(splitCsv, z.array(z.string()).default([])),
  mac: z.preprocess(splitCsv, z.array(z.string()).default([])),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  time_of_day_bucket: z.preprocess(splitCsv, z.array(z.string()).default([])),
  subject_category: z.preprocess(splitCsv, z.array(z.string()).default([])),
  subject_class: z.preprocess(splitCsv, z.array(z.string()).default([])),
  q: z.string().optional(),
  min_lux: numericParam,
  max_lux: numericParam,
  min_temperature: numericParam,
  max_temperature: numericParam,
  min_heat_level: numericParam,
  max_heat_level: numericParam
});

export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export const DEFAULT_START_DATE = "2025-01-01";
export const DEFAULT_END_DATE = "2025-12-31";

export const defaultDashboardFilters: DashboardFilters = {
  camera_name: [],
  mac: [],
  start_date: DEFAULT_START_DATE,
  end_date: DEFAULT_END_DATE,
  time_of_day_bucket: [],
  subject_category: [],
  subject_class: [],
  q: "",
  min_lux: undefined,
  max_lux: undefined,
  min_temperature: undefined,
  max_temperature: undefined,
  min_heat_level: undefined,
  max_heat_level: undefined
};

export const eventSortSchema = z.enum([
  "timestamp",
  "camera_name",
  "event",
  "sequence",
  "subject_class",
  "subject_category",
  "lux",
  "temperature",
  "heat_level"
]);

export type EventSortField = z.infer<typeof eventSortSchema>;

export const eventQuerySchema = dashboardFiltersSchema.extend({
  page: z.preprocess((value) => Number(value ?? 1), z.number().int().min(1).default(1)),
  page_size: z.preprocess((value) => Number(value ?? 25), z.number().int().min(1).max(200).default(25)),
  sort_by: eventSortSchema.optional().default("timestamp"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("desc")
});

export type EventQuery = z.infer<typeof eventQuerySchema>;

export type FilterOption = {
  value: string;
  label: string;
};

export type FilterOptionsResponse = {
  cameras: FilterOption[];
  macs: FilterOption[];
  timeOfDayBuckets: FilterOption[];
  subjectCategories: FilterOption[];
  subjectClasses: FilterOption[];
  ranges: {
    lux: { min: number; max: number };
    temperature: { min: number; max: number };
    heatLevel: { min: number; max: number };
  };
};

export type KpiResponse = {
  totalRawRows: number;
  totalUniqueEventGroups: number;
  selectedCamerasCount: number;
  wildlifeSharePct: number;
  humanSharePct: number;
  vehicleSharePct: number;
  mostActiveCamera: string | null;
  peakActivityHour: number | null;
  avgDailyEventGroups: number;
  avgBurstLength: number;
  burstIntensity: number;
  biodiversityScore: number;
  disturbanceScore: number;
  nocturnalityScore: number;
  dawnDuskPreference: number;
  cameraVolatility: number;
  rareEventGroups: number;
};

export type DailyActivityPoint = {
  date: string;
  cameraName: string;
  uniqueEventGroups: number;
  rawRows: number;
};

export type HourlyHeatmapPoint = {
  cameraName: string;
  hour: number;
  uniqueEventGroups: number;
  rawRows: number;
};

export type TimeOfDayCompositionPoint = {
  bucket: string;
  wildlife: number;
  human: number;
  vehicle: number;
  emptyScene: number;
};

export type SubjectCameraHeatmapPoint = {
  cameraName: string;
  subjectClass: string;
  uniqueEventGroups: number;
};

export type MonthlySeasonalityPoint = {
  month: string;
  splitLabel: string;
  avgDailyEventGroups: number;
};

export type BurstinessPoint = {
  label: string;
  avgRowsPerGroup: number;
  burstGroupPct: number;
  uniqueEventGroups: number;
};

export type TelemetryPoint = {
  date: string;
  cameraName: string;
  avgBatteryPercentage: number | null;
  avgTemperature: number | null;
  activity: number;
};

export type CompositionPoint = {
  category: string;
  uniqueEventGroups: number;
};

export type DaySummaryResponse = {
  date: string;
  totalEventGroups: number;
  totalRawRows: number;
  hourlyDistribution: Array<{ hour: number; uniqueEventGroups: number; rawRows: number }>;
  subjectBreakdown: Array<{ subjectClass: string; uniqueEventGroups: number }>;
  cameraBreakdown: Array<{ cameraName: string; uniqueEventGroups: number }>;
  events: EventRecord[];
};

export type EventRecord = {
  id: string;
  timestamp: string;
  cameraName: string;
  mac: string;
  event: string;
  sequence: number;
  subjectClass: string | null;
  subjectCategory: string | null;
  timeOfDayBucket: string | null;
  analysisTitle: string | null;
  analysisSummary: string | null;
  lux: number | null;
  temperature: number | null;
  heatLevel: number | null;
  sensor: string;
  location: string | null;
  batteryPercentage: number | null;
  filename: string | null;
  imageBlobUrl: string | null;
};

export type EventsResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: EventRecord[];
};

