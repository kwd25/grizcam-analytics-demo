import { z } from "zod";
export { buildReportFilterKey, buildReportSnapshot, normalizeReportFilters } from "./reportSnapshot.js";

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

export type NoveltyTimelinePoint = {
  date: string;
  noveltyCount: number;
  avgNoveltyScore: number;
  maxNoveltyScore: number;
  topDriver: string | null;
  dominantCategory: string | null;
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
  noveltyTimelineDaily: NoveltyTimelinePoint[];
  categoryShiftMatrix: CategoryShiftPoint[];
  advancedInsights: InsightItem[];
  cameraClusters: CameraClusterPoint[];
  dataQuality: DataQualityResponse;
};

export const reportConfidenceSchema = z.enum(["low", "medium", "high"]);
export type ReportConfidence = z.infer<typeof reportConfidenceSchema>;

export const operationalReportFindingSchema = z.object({
  title: z.string().trim().min(1).max(240),
  evidence: z.array(z.string().trim().min(1).max(320)).min(1).max(3),
  confidence: reportConfidenceSchema,
  actionability: z.string().trim().min(1).max(320)
});
export type OperationalReportFinding = z.infer<typeof operationalReportFindingSchema>;

export const operationalReportActionSchema = z.object({
  priority: z.number().int().min(1).max(5),
  action: z.string().trim().min(1).max(240),
  why: z.string().trim().min(1).max(320)
});
export type OperationalReportAction = z.infer<typeof operationalReportActionSchema>;

export const operationalReportRiskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  impact: z.string().trim().min(1).max(320),
  suggested_followup: z.string().trim().min(1).max(320)
});
export type OperationalReportRisk = z.infer<typeof operationalReportRiskSchema>;

export const operationalReportSchema = z.object({
  headline: z.string().trim().min(1).max(240),
  executive_summary: z.array(z.string().trim().min(1).max(320)).min(2).max(4),
  key_findings: z.array(operationalReportFindingSchema).min(2).max(6),
  recommended_actions: z.array(operationalReportActionSchema).min(1).max(5),
  risks_or_watchouts: z.array(operationalReportRiskSchema).min(0).max(5),
  open_questions: z.array(z.string().trim().min(1).max(240)).min(0).max(5)
});
export type OperationalReport = z.infer<typeof operationalReportSchema>;

export const reportJobStatusSchema = z.enum(["queued", "generating", "ready", "error"]);
export type ReportJobStatus = z.infer<typeof reportJobStatusSchema>;

export const reportPhaseSchema = z.enum([
  "idle",
  "disabled",
  "queued",
  "building_snapshot",
  "calling_model",
  "validating_response",
  "ready",
  "error"
]);
export type ReportPhase = z.infer<typeof reportPhaseSchema>;

export const reportViewStatusSchema = z.enum(["idle", "disabled", "generating", "ready", "stale", "error"]);
export type ReportViewStatus = z.infer<typeof reportViewStatusSchema>;

export const reportConnectionSourceSchema = z.enum([
  "reports_database_url",
  "database_url",
  "postgres_url",
  "postgres_prisma_url",
  "postgres_url_non_pooling",
  "local_postgres",
  "unconfigured"
]);
export type ReportConnectionSource = z.infer<typeof reportConnectionSourceSchema>;

export const reportSourceModeSchema = z.enum(["persistent", "ephemeral"]);
export type ReportSourceMode = z.infer<typeof reportSourceModeSchema>;

export const reportDebugSchema = z.object({
  requestId: z.string().nullable().optional(),
  lastErrorCode: z.string().nullable().optional(),
  lastErrorMessage: z.string().nullable().optional(),
  timingMs: z.record(z.string(), z.number()).optional()
});
export type ReportDebug = z.infer<typeof reportDebugSchema>;

export const reportSnapshotTrendSchema = z.object({
  label: z.string(),
  direction: z.enum(["up", "down", "flat", "mixed"]),
  deltaPct: z.number().nullable(),
  note: z.string()
});
export type ReportSnapshotTrend = z.infer<typeof reportSnapshotTrendSchema>;

export const reportSnapshotMetricSchema = z.object({
  label: z.string(),
  value: z.number().nullable(),
  unit: z.string().optional(),
  note: z.string().optional()
});
export type ReportSnapshotMetric = z.infer<typeof reportSnapshotMetricSchema>;

export const reportSnapshotItemSchema = z.object({
  name: z.string(),
  value: z.number().nullable().optional(),
  detail: z.string(),
  status: z.string().optional()
});
export type ReportSnapshotItem = z.infer<typeof reportSnapshotItemSchema>;

export const reportSnapshotSummarySchema = z.object({
  filterKey: z.string(),
  filters: dashboardFiltersSchema,
  dateRange: z.object({
    startDate: z.string(),
    endDate: z.string()
  }),
  overviewMetrics: z.array(reportSnapshotMetricSchema).max(12),
  overviewHighlights: z.array(reportSnapshotItemSchema).max(6),
  pipeline: z.array(reportSnapshotMetricSchema).max(8),
  opsHighlights: z.array(reportSnapshotItemSchema).max(6),
  topCameras: z.array(reportSnapshotItemSchema).max(6),
  atRiskCameras: z.array(reportSnapshotItemSchema).max(6),
  advancedHighlights: z.array(reportSnapshotItemSchema).max(6),
  notableShifts: z.array(reportSnapshotItemSchema).max(6),
  anomalies: z.array(reportSnapshotItemSchema).max(6),
  trends: z.array(reportSnapshotTrendSchema).max(8),
  dataQualityCaveats: z.array(z.string()).max(8),
  narrativeContext: z.array(z.string()).max(8)
});
export type ReportSnapshotSummary = z.infer<typeof reportSnapshotSummarySchema>;

export const reportSourceBundleSchema = reportSnapshotSummarySchema;
export type ReportSourceBundle = z.infer<typeof reportSourceBundleSchema>;

export const reportRecordSchema = z.object({
  id: z.string().min(1),
  normalizedFilterKey: z.string().min(1),
  sourceMode: reportSourceModeSchema.default("persistent"),
  snapshotHash: z.string().nullable().optional(),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  jobStatus: reportJobStatusSchema.nullable().optional(),
  viewStatus: reportViewStatusSchema,
  isRefreshing: z.boolean().default(false),
  isExactMatch: z.boolean().default(false),
  phase: reportPhaseSchema,
  generatedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  report: operationalReportSchema.nullable().optional(),
  snapshot: reportSnapshotSummarySchema.nullable().optional(),
  debug: reportDebugSchema.nullable().optional()
});
export type ReportRecord = z.infer<typeof reportRecordSchema>;

export const getReportResponseSchema = z.object({
  status: reportViewStatusSchema,
  cacheKey: z.string().nullable().optional(),
  phase: reportPhaseSchema,
  reason: z.string().nullable().optional(),
  latest: reportRecordSchema.nullable(),
  stale: reportRecordSchema.nullable().optional()
});
export type GetReportResponse = z.infer<typeof getReportResponseSchema>;

export const triggerReportRequestSchema = z.object({
  filters: dashboardFiltersSchema,
  snapshot: reportSourceBundleSchema,
  force: z.boolean().optional().default(false)
});
export type TriggerReportRequest = z.infer<typeof triggerReportRequestSchema>;

export const triggerReportResponseSchema = z.object({
  status: reportViewStatusSchema,
  phase: reportPhaseSchema,
  cacheKey: z.string().nullable().optional(),
  reportId: z.string(),
  isExactMatch: z.boolean(),
  report: reportRecordSchema.nullable().optional(),
  reason: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  requestId: z.string().nullable().optional()
});
export type TriggerReportResponse = z.infer<typeof triggerReportResponseSchema>;

export const reportStatusResponseSchema = z.object({
  status: reportViewStatusSchema,
  cacheKey: z.string().nullable().optional(),
  phase: reportPhaseSchema,
  reason: z.string().nullable().optional(),
  current: reportRecordSchema.nullable(),
  stale: reportRecordSchema.nullable().optional()
});
export type ReportStatusResponse = z.infer<typeof reportStatusResponseSchema>;

export const reportHealthResponseSchema = z.object({
  analyticsDatabase: z.string(),
  analyticsDatabaseReadOnly: z.boolean().nullable(),
  reportsDatabase: z.enum(["ok", "disabled", "unavailable"]),
  reportsDatabaseReadOnly: z.boolean().nullable(),
  reportsConnectionSource: reportConnectionSourceSchema,
  reportsSchemaReady: z.boolean(),
  reportsFailureReason: z.string().nullable().optional(),
  supportsEphemeralGeneration: z.boolean(),
  openRouterConfigured: z.boolean(),
  reportsEnabled: z.boolean()
});
export type ReportHealthResponse = z.infer<typeof reportHealthResponseSchema>;

export type QueryColumnType = "text" | "number" | "date" | "timestamp" | "boolean" | "json";

export type QueryOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "IN"
  | "LIKE"
  | "ILIKE"
  | "IS NULL"
  | "IS NOT NULL"
  | "BETWEEN";

export type QueryAggregate = "COUNT" | "AVG" | "MIN" | "MAX" | "SUM";

export type QueryColumnMetadata = {
  name: string;
  label: string;
  type: QueryColumnType;
  description?: string;
  filterOperators: QueryOperator[];
  aggregates: QueryAggregate[];
  groupable: boolean;
  sortable: boolean;
};

export type QueryRelationMetadata = {
  name: string;
  label: string;
  description: string;
  category: "preferred" | "advanced";
  defaultLimit: number;
  maxLimit: number;
  columns: QueryColumnMetadata[];
  defaultColumns: string[];
  supportsAggregates: boolean;
  supportsGroupBy: boolean;
};

export type QueryExample = {
  id: string;
  label: string;
  description: string;
  relation: string;
  sql: string;
};

export type QueryMetadataResponse = {
  relations: QueryRelationMetadata[];
  allowedAggregates: QueryAggregate[];
  maxLimit: number;
  defaultLimit: number;
  examples: QueryExample[];
  helpText: {
    title: string;
    body: string;
  };
};

export type QueryBuilderAggregate = {
  column: string;
  func: QueryAggregate;
  alias?: string;
};

export type QueryBuilderFilter = {
  id: string;
  column: string;
  operator: QueryOperator;
  value?: string;
  secondValue?: string;
};

export type QueryBuilderSort = {
  column: string;
  direction: "asc" | "desc";
};

export type QueryBuilderState = {
  relation: string;
  columns: string[];
  aggregates: QueryBuilderAggregate[];
  filters: QueryBuilderFilter[];
  groupBy: string[];
  sort: QueryBuilderSort[];
  limit: number;
};

export type QueryErrorCode =
  | "EMPTY_QUERY"
  | "COMMENT_NOT_ALLOWED"
  | "MULTI_STATEMENT_NOT_ALLOWED"
  | "NON_SELECT_NOT_ALLOWED"
  | "UNSAFE_KEYWORD"
  | "SYSTEM_SCHEMA_BLOCKED"
  | "RELATION_NOT_ALLOWED"
  | "COLUMN_NOT_ALLOWED"
  | "FUNCTION_NOT_ALLOWED"
  | "SELECT_ALL_NOT_ALLOWED"
  | "JOIN_NOT_ALLOWED"
  | "LIMIT_TOO_HIGH"
  | "INVALID_LIMIT"
  | "INVALID_QUERY"
  | "QUERY_TIMEOUT"
  | "EXECUTION_ERROR";

export type QueryValidationIssue = {
  code: QueryErrorCode;
  message: string;
};

export type QueryValidationResponse = {
  ok: boolean;
  normalizedSql?: string;
  appliedLimit?: number;
  issues: QueryValidationIssue[];
};

export type QueryRunRequest = {
  sql: string;
};

export type GenerateSqlRequest = {
  prompt: string;
};

export type GenerateSqlResponse = {
  sql: string;
  userIntentSummary: string;
  queryExplanation: string;
  model?: string;
  warning?: string;
};

export type QueryChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type QueryLatestResultSummary = {
  rowCount?: number;
  durationMs?: number;
  appliedLimit?: number;
  columns?: string[];
};

export type QueryLatestContext = {
  sql?: string;
  validation?: {
    ok: boolean;
    appliedLimit?: number;
    issues: string[];
  };
  result?: QueryLatestResultSummary;
};

export type QueryFollowUpRequest = {
  prompt: string;
  history: QueryChatHistoryMessage[];
  latestQuery?: QueryLatestContext;
};

export type QueryFollowUpResponse = {
  answer: string;
  suggestedSql?: string;
  warning?: string;
  model?: string;
};

export type QueryExportFormat = "csv";

export type QueryExportRequest = {
  sql: string;
  format: QueryExportFormat;
};

export type QueryResultColumn = {
  name: string;
  label: string;
};

export type QueryRunResponse = {
  ok: boolean;
  normalizedSql?: string;
  appliedLimit?: number;
  durationMs?: number;
  rowCount?: number;
  columns?: QueryResultColumn[];
  rows?: Array<Record<string, unknown>>;
  issues: QueryValidationIssue[];
};
