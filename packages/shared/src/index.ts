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
  wildlifeSharePct: number;
  humanSharePct: number;
  vehicleSharePct: number;
  mostActiveCamera: string | null;
  peakActivityHour: number | null;
  avgDailyEventGroups: number;
  avgBurstLength: number;
  biodiversityScore: number;
  nocturnalityScore: number;
  dawnDuskPreference: number;
  topSpecies: string | null;
};

export type InsightTone = "info" | "positive" | "warning" | "alert";

export type InsightItem = {
  title: string;
  detail: string;
  tone: InsightTone;
};

export type EventAnalysisRecord = {
  title?: string | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
  keywords?: Record<string, unknown> | null;
  [key: string]: unknown;
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

export type MonthlyActivityCategoryPoint = {
  month: string;
  wildlife: number;
  human: number;
  vehicle: number;
  emptyScene: number;
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
  localTimestamp: string;
  utcTimestamp?: string | null;
  utcTimestampOff?: string | null;
  created?: string | null;
  aiTimestamp?: string | null;
  jsonTimestamp?: string | null;
  timezone?: string | null;
  cameraName: string;
  camera: string;
  mac: string;
  event: string;
  eventGroup: string;
  eventGroupSize: number;
  sequence: number;
  subjectClass: string | null;
  subjectCategory: string | null;
  timeOfDayBucket: string | null;
  daypart?: string | null;
  analysisTitle: string | null;
  analysisSummary: string | null;
  summary?: string | null;
  aiDescription?: string | null;
  analysis?: EventAnalysisRecord | null;
  lux: number | null;
  temperature: number | null;
  humidity?: number | null;
  pressure?: number | null;
  heatLevel: number | null;
  sensor: string;
  location: string | null;
  latitude?: number | null;
  longitude?: number | null;
  bearing?: number | null;
  batteryPercentage: number | null;
  filename: string | null;
  fileType?: string | null;
  imageBlobUrl: string | null;
  aiProcessed?: boolean | null;
  jsonProcessed?: boolean | null;
  uploaded?: boolean | null;
  upload?: string | null;
  voltage?: number | null;
  tag?: string | null;
  uploadLagSeconds?: number | null;
  aiLagSeconds?: number | null;
  processingLagSeconds?: number | null;
  lowLightFlag?: boolean;
  operationalStatus?: string;
  anomalyFlag?: boolean;
  anomalyScore?: number;
  healthScore?: number;
  dataQualityFlags?: string[];
};

export type EventsResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: EventRecord[];
};

export type OverviewKpis = {
  totalEvents: number;
  activeCameras: number;
  wildlifeSharePct: number;
  humanSharePct: number;
  aiProcessedPct: number;
  jsonProcessedPct: number;
  uploadSuccessPct: number;
  avgUploadLagSeconds: number | null;
  avgProcessingLagSeconds: number | null;
  camerasWithAlerts: number;
  avgVoltage: number | null;
  lowLightSharePct: number;
};

export type CameraHealthRow = {
  cameraName: string;
  lastSeen: string | null;
  lastSeenHoursAgo: number | null;
  totalEvents: number;
  aiProcessedPct: number;
  jsonProcessedPct: number;
  uploadSuccessPct: number;
  avgUploadLagSeconds: number | null;
  avgAiLagSeconds: number | null;
  avgProcessingLagSeconds: number | null;
  avgVoltage: number | null;
  healthScore: number;
  anomalyScore: number;
  status: string;
  alertReason: string | null;
};

export type ProcessingFunnelPoint = {
  stage: string;
  count: number;
};

export type LagTrendPoint = {
  date: string;
  avgUploadLagSeconds: number | null;
  avgAiLagSeconds: number | null;
  avgProcessingLagSeconds: number | null;
};

export type StaleCameraPoint = {
  cameraName: string;
  lastSeen: string | null;
  lastSeenHoursAgo: number | null;
  status: string;
  anomalyScore: number;
};

export type CategoryDistributionPoint = {
  category: string;
  count: number;
};

export type CategoryTrendPoint = {
  date: string;
  wildlife: number;
  human: number;
  vehicle: number;
  emptyScene: number;
  unknown: number;
};

export type TopCameraPoint = {
  cameraName: string;
  count: number;
};

export type HourlyActivityPoint = {
  hour: number;
  total: number;
  wildlife: number;
  human: number;
  vehicle: number;
  emptyScene: number;
  unknown: number;
};

export type BurstDistributionPoint = {
  burstSize: number;
  count: number;
};

export type VoltageTrendPoint = {
  date: string;
  cameraName: string;
  avgVoltage: number | null;
};

export type LightSplitPoint = {
  bucket: string;
  count: number;
};

export type TemperatureTrendPoint = {
  date: string;
  avgTemperature: number | null;
  avgHeatLevel: number | null;
};

export type OverviewResponse = {
  kpis: OverviewKpis;
  cameraHealth: CameraHealthRow[];
  processingFunnel: ProcessingFunnelPoint[];
  lagTrend: LagTrendPoint[];
  staleCameras: StaleCameraPoint[];
  categoryDistribution: CategoryDistributionPoint[];
  categoryTrend: CategoryTrendPoint[];
  topCameras: TopCameraPoint[];
  hourlyActivity: HourlyActivityPoint[];
  burstDistribution: BurstDistributionPoint[];
  notableEvents: EventRecord[];
  voltageTrend: VoltageTrendPoint[];
  lightSplit: LightSplitPoint[];
  temperatureTrend: TemperatureTrendPoint[];
  insights: InsightItem[];
};

export type HeatmapCountPoint = {
  row: string;
  column: string;
  count: number;
};

export type DiversityPoint = {
  cameraName: string;
  diversityScore: number;
  wildlifeRatioPct: number;
  humanRatioPct: number;
  lowLightSharePct: number;
  avgVoltage: number | null;
  totalEvents: number;
};

export type EnvironmentalContextPoint = {
  category: string;
  avgLux: number | null;
  avgTemperature: number | null;
  avgHeatLevel: number | null;
};

export type CameraAnomalyPoint = {
  cameraName: string;
  anomalyScore: number;
  healthScore: number;
  staleHours: number | null;
  avgLagSeconds: number | null;
  lowVoltageRatePct: number;
  missingAiRatePct: number;
  suspiciousTelemetryCount: number;
  status: string;
};

export type AnomalyTimelinePoint = {
  date: string;
  anomalyCount: number;
  avgAnomalyScore: number;
  topDriver: string | null;
  novelEventCount: number;
};

export type ForecastPoint = {
  date: string;
  actual: number;
  expected: number;
  delta: number;
};

export type CameraForecastPoint = {
  date: string;
  cameraName: string;
  actual: number;
  expected: number;
  delta: number;
  residualPct: number;
};

export type CameraForecastLeader = {
  cameraName: string;
  date: string;
  actual: number;
  expected: number;
  delta: number;
  residualPct: number;
};

export type NovelEventPoint = {
  cameraName: string;
  category: string;
  hour: number;
  currentCount: number;
  baselineDailyAvg: number;
  comboCount: number;
  categoryHourCount: number;
  shiftPct: number;
  noveltyScore: number;
  narrative: string;
};

export type CategoryShiftPoint = {
  cameraName: string;
  category: string;
  recentSharePct: number;
  baselineSharePct: number;
  shiftPct: number;
  lift: number;
  recentCount: number;
  baselineCount: number;
};

export type CameraClusterPoint = {
  cameraName: string;
  cluster: string;
  similarityLabel: string;
  rationale: string;
  healthScore: number;
  anomalyScore: number;
  diversityScore: number;
};

export type FieldCompletenessPoint = {
  field: string;
  completenessPct: number;
};

export type CountLabelPoint = {
  label: string;
  count: number;
};

export type DataQualityResponse = {
  missingAnalysisRatePct: number;
  parseSuccessPct: number;
  fieldCompleteness: FieldCompletenessPoint[];
  suspiciousValueCounts: CountLabelPoint[];
  pipelineConsistency: CountLabelPoint[];
};

export type AnalyticsLabResponse = {
  hourCategoryHeatmap: HeatmapCountPoint[];
  cameraCategoryHeatmap: HeatmapCountPoint[];
  dailySeasonality: CategoryTrendPoint[];
  burstBehavior: Array<{ cameraName: string; avgBurstSize: number; p95BurstSize: number; eventCount: number }>;
  diversityByCamera: DiversityPoint[];
  humanWildlifeRatioByCamera: Array<{ cameraName: string; wildlifePct: number; humanPct: number; vehiclePct: number }>;
  environmentalContext: EnvironmentalContextPoint[];
  cameraAnomalies: CameraAnomalyPoint[];
  anomalyTimeline: AnomalyTimelinePoint[];
  forecast: ForecastPoint[];
  cameraForecast: CameraForecastPoint[];
  cameraForecastLeaders: CameraForecastLeader[];
  novelEvents: NovelEventPoint[];
  categoryShiftMatrix: CategoryShiftPoint[];
  advancedInsights: InsightItem[];
  cameraClusters: CameraClusterPoint[];
  dataQuality: DataQualityResponse;
};
