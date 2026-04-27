import type {
  AnalyticsLabResponse,
  CameraHealthRow,
  DashboardFilters,
  OverviewResponse,
  ReportSnapshotItem,
  ReportSnapshotMetric,
  ReportSnapshotSummary,
  ReportSnapshotTrend
} from "./index.js";

const SNAPSHOT_BUDGET = {
  metrics: 9,
  highlights: 5,
  cameras: 5,
  trends: 6,
  caveats: 6,
  narrative: 6
} as const;

const round = (value: number | null | undefined, digits = 1) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const power = 10 ** digits;
  return Math.round(value * power) / power;
};

const average = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const averageNullable = (values: Array<number | null | undefined>) =>
  average(values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value)));

export const normalizeReportFilters = (filters: DashboardFilters): DashboardFilters => ({
  ...filters,
  q: filters.q?.trim() ?? "",
  camera_name: [...filters.camera_name].sort(),
  mac: [...filters.mac].sort(),
  time_of_day_bucket: [...filters.time_of_day_bucket].sort(),
  subject_category: [...filters.subject_category].sort(),
  subject_class: [...filters.subject_class].sort()
});

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const describeCamera = (camera: CameraHealthRow): string => {
  const details: string[] = [];
  if (camera.avgVoltage !== null) {
    details.push(`avg voltage ${camera.avgVoltage.toFixed(2)}v`);
  }
  if (camera.avgProcessingLagSeconds !== null) {
    details.push(`avg processing lag ${Math.round(camera.avgProcessingLagSeconds / 60)}m`);
  }
  if (camera.lastSeenHoursAgo !== null) {
    details.push(`last seen ${Math.round(camera.lastSeenHoursAgo)}h ago`);
  }
  if (camera.alertReason) {
    details.push(camera.alertReason);
  }
  return details.join(" • ");
};

const compareRecentWindow = (values: number[]) => {
  if (values.length < 2) {
    return { deltaPct: null, direction: "flat" as const };
  }

  const recentWindow = values.slice(-Math.min(7, Math.max(1, Math.ceil(values.length / 2))));
  const baselineWindow = values.slice(0, Math.max(1, values.length - recentWindow.length));
  const recentAvg = average(recentWindow) ?? 0;
  const baselineAvg = average(baselineWindow) ?? recentAvg;
  const deltaPct = baselineAvg > 0 ? ((recentAvg - baselineAvg) / baselineAvg) * 100 : recentAvg > 0 ? 100 : 0;

  if (Math.abs(deltaPct) < 5) {
    return { deltaPct: round(deltaPct, 1), direction: "flat" as const };
  }

  return { deltaPct: round(deltaPct, 1), direction: deltaPct > 0 ? ("up" as const) : ("down" as const) };
};

const buildPipelineMetrics = (overview: OverviewResponse): ReportSnapshotMetric[] => {
  const stageCount = (stage: string) => overview.processingFunnel.find((point) => point.stage === stage)?.count ?? 0;
  const captured = stageCount("captured");
  const uploaded = stageCount("uploaded");
  const jsonProcessed = stageCount("json_processed");
  const aiProcessed = stageCount("ai_processed");
  const ratio = (count: number, base: number) => (base > 0 ? round((count / base) * 100, 1) : 0);

  return [
    { label: "Captured groups", value: captured, note: "Distinct grouped events in the current slice." },
    { label: "Uploaded conversion", value: ratio(uploaded, captured), unit: "%", note: `${captured - uploaded} groups dropped before upload.` },
    { label: "JSON conversion", value: ratio(jsonProcessed, uploaded), unit: "%", note: `${uploaded - jsonProcessed} groups dropped before JSON extraction.` },
    { label: "AI conversion", value: ratio(aiProcessed, jsonProcessed), unit: "%", note: `${jsonProcessed - aiProcessed} groups dropped before AI summary.` }
  ].slice(0, SNAPSHOT_BUDGET.metrics);
};

const buildTrends = (overview: OverviewResponse): ReportSnapshotTrend[] => {
  const wildlifeSeries = overview.categoryTrend.map((point) => point.wildlife);
  const humanSeries = overview.categoryTrend.map((point) => point.human);
  const processingLagSeries = overview.lagTrend.map((point) => point.avgProcessingLagSeconds ?? 0);
  const avgVoltageByDate = new Map<string, number[]>();

  overview.voltageTrend.forEach((point) => {
    if (point.avgVoltage === null) {
      return;
    }
    avgVoltageByDate.set(point.date, [...(avgVoltageByDate.get(point.date) ?? []), point.avgVoltage]);
  });

  const orderedVoltageSeries = overview.temperatureTrend.map((point) => averageNullable(avgVoltageByDate.get(point.date) ?? []) ?? 0);
  const temperatureSeries = overview.temperatureTrend.map((point) => point.avgTemperature ?? 0);
  const anomalySeries = overview.notableEvents.map((point) => point.anomalyScore ?? 0);

  return [
    {
      label: "Wildlife activity",
      ...compareRecentWindow(wildlifeSeries),
      note: "Recent wildlife grouped-event volume versus the earlier filtered baseline."
    },
    {
      label: "Human activity",
      ...compareRecentWindow(humanSeries),
      note: "Recent human detections versus the earlier filtered baseline."
    },
    {
      label: "Processing lag",
      ...compareRecentWindow(processingLagSeries),
      note: "Average processing lag trend across the filtered period."
    },
    {
      label: "Average voltage",
      ...compareRecentWindow(orderedVoltageSeries),
      note: "Average per-camera voltage trend across the filtered period."
    },
    {
      label: "Temperature context",
      ...compareRecentWindow(temperatureSeries),
      note: "Average environmental temperature trend in the filtered period."
    },
    {
      label: "Recent anomaly pressure",
      ...compareRecentWindow(anomalySeries),
      note: "Change in anomaly intensity among the most operationally relevant recent events."
    }
  ].slice(0, SNAPSHOT_BUDGET.trends);
};

const buildDataQualityCaveats = (analytics: AnalyticsLabResponse): string[] => {
  const caveats: string[] = [];
  const completeness = new Map(analytics.dataQuality.fieldCompleteness.map((item) => [item.field, item.completenessPct]));

  if (analytics.dataQuality.parseSuccessPct < 90) {
    caveats.push(`Parse success is ${round(analytics.dataQuality.parseSuccessPct, 1)}%, so some AI-derived fields may be incomplete.`);
  }
  if (analytics.dataQuality.missingAnalysisRatePct > 10) {
    caveats.push(`${round(analytics.dataQuality.missingAnalysisRatePct, 1)}% of rows are missing analysis summary/title content.`);
  }
  if ((completeness.get("voltage") ?? 100) < 75) {
    caveats.push(`Voltage coverage is ${round(completeness.get("voltage") ?? 0, 1)}%, so power recommendations may understate blind spots.`);
  }
  if ((completeness.get("temperature") ?? 100) < 75) {
    caveats.push(`Temperature coverage is ${round(completeness.get("temperature") ?? 0, 1)}%, limiting environmental interpretation.`);
  }

  analytics.dataQuality.suspiciousValueCounts
    .filter((item) => item.count > 0)
    .slice(0, 2)
    .forEach((item) => {
      caveats.push(`${item.label}: ${item.count}.`);
    });

  analytics.dataQuality.pipelineConsistency
    .filter((item) => item.count > 0)
    .slice(0, 2)
    .forEach((item) => {
      caveats.push(`${item.label}: ${item.count}.`);
    });

  return caveats.slice(0, SNAPSHOT_BUDGET.caveats);
};

const buildOverviewHighlights = (overview: OverviewResponse): ReportSnapshotItem[] => {
  const totalGroups = overview.categoryDistribution.reduce((sum, item) => sum + item.count, 0);
  const topCategories = overview.categoryDistribution.slice(0, 3).map((item) => ({
    name: `${item.category} mix`,
    value: item.count,
    detail:
      totalGroups > 0
        ? `${item.count} grouped events, ${round((item.count / totalGroups) * 100, 1)}% share in this slice.`
        : `${item.count} grouped events in this slice.`
  }));

  const topCamera = overview.topCameras[0];
  const wildlifeTrend = compareRecentWindow(overview.categoryTrend.map((point) => point.wildlife));
  const humanTrend = compareRecentWindow(overview.categoryTrend.map((point) => point.human));

  const highlights: ReportSnapshotItem[] = [
    {
      name: "Grouped event volume",
      value: overview.kpis.totalEvents,
      detail: `${overview.kpis.totalEvents} grouped events across ${overview.kpis.activeCameras} active cameras in the current filter slice.`
    },
    ...topCategories
  ];

  if (topCamera) {
    highlights.push({
      name: "Most active camera",
      value: topCamera.count,
      detail: `${topCamera.cameraName} contributed ${topCamera.count} grouped events in the current slice.`
    });
  }

  if (wildlifeTrend.deltaPct !== null) {
    highlights.push({
      name: "Wildlife trend",
      value: wildlifeTrend.deltaPct,
      detail: `Wildlife grouped-event volume is ${wildlifeTrend.direction} ${Math.abs(wildlifeTrend.deltaPct)}% versus the earlier filtered baseline.`
    });
  } else if (humanTrend.deltaPct !== null) {
    highlights.push({
      name: "Human trend",
      value: humanTrend.deltaPct,
      detail: `Human detections are ${humanTrend.direction} ${Math.abs(humanTrend.deltaPct)}% versus the earlier filtered baseline.`
    });
  }

  return highlights.slice(0, SNAPSHOT_BUDGET.highlights);
};

const buildOpsHighlights = (overview: OverviewResponse): ReportSnapshotItem[] => {
  const staleCamera = [...overview.staleCameras].sort((left, right) => (right.lastSeenHoursAgo ?? 0) - (left.lastSeenHoursAgo ?? 0))[0];
  const highestLag = [...overview.cameraHealth]
    .filter((camera) => camera.avgProcessingLagSeconds !== null)
    .sort((left, right) => (right.avgProcessingLagSeconds ?? 0) - (left.avgProcessingLagSeconds ?? 0))[0];
  const lowestVoltage = [...overview.cameraHealth]
    .filter((camera) => camera.avgVoltage !== null)
    .sort((left, right) => (left.avgVoltage ?? 99) - (right.avgVoltage ?? 99))[0];

  const items: ReportSnapshotItem[] = [
    {
      name: "Cameras with alerts",
      value: overview.kpis.camerasWithAlerts,
      detail: `${overview.kpis.camerasWithAlerts} cameras are currently flagged with non-healthy operational status.`
    }
  ];

  if (staleCamera) {
    items.push({
      name: "Stalest camera",
      value: round(staleCamera.lastSeenHoursAgo, 1),
      status: staleCamera.status,
      detail: `${staleCamera.cameraName} was last seen ${round(staleCamera.lastSeenHoursAgo, 1)} hours ago.`
    });
  }

  if (highestLag) {
    items.push({
      name: "Highest lag camera",
      value: round(highestLag.avgProcessingLagSeconds, 1),
      status: highestLag.status,
      detail: `${highestLag.cameraName} is averaging ${Math.round((highestLag.avgProcessingLagSeconds ?? 0) / 60)} minutes of processing lag.`
    });
  }

  if (lowestVoltage) {
    items.push({
      name: "Lowest voltage camera",
      value: round(lowestVoltage.avgVoltage, 2),
      status: lowestVoltage.status,
      detail: `${lowestVoltage.cameraName} is averaging ${round(lowestVoltage.avgVoltage, 2)}v.`
    });
  }

  return items.slice(0, SNAPSHOT_BUDGET.highlights);
};

const buildAdvancedHighlights = (analytics: AnalyticsLabResponse): ReportSnapshotItem[] => {
  const forecastLeaders = analytics.cameraForecastLeaders.slice(0, 2).map((item) => ({
    name: `${item.cameraName} forecast gap`,
    value: round(item.residualPct, 1),
    detail: `Actual ${item.actual} vs expected ${round(item.expected, 1)} on ${item.date}.`
  }));

  const novelLeaders = analytics.novelEvents.slice(0, 2).map((item) => ({
    name: `${item.cameraName} ${item.category} novelty`,
    value: round(item.noveltyScore, 1),
    detail: `${item.currentCount} recent groups vs ${round(item.baselineDailyAvg, 1)}/day baseline around ${String(item.hour).padStart(2, "0")}:00.`
  }));

  const strongestShift = analytics.categoryShiftMatrix
    .filter((item) => Math.abs(item.shiftPct) >= 5)
    .slice(0, 1)
    .map((item) => ({
      name: `${item.cameraName} category shift`,
      value: round(item.shiftPct, 1),
      detail: `${item.category} moved to ${round(item.recentSharePct, 1)}% share from ${round(item.baselineSharePct, 1)}%.`
    }));

  return [...forecastLeaders, ...novelLeaders, ...strongestShift].slice(0, SNAPSHOT_BUDGET.highlights);
};

export const buildReportFilterKey = (filters: DashboardFilters) => stableSerialize(normalizeReportFilters(filters));

export const buildReportSnapshot = (
  filters: DashboardFilters,
  overview: OverviewResponse,
  analytics: AnalyticsLabResponse
): ReportSnapshotSummary => {
  const normalizedFilters = normalizeReportFilters(filters);
  const filterKey = buildReportFilterKey(normalizedFilters);
  const topCameras: ReportSnapshotItem[] = overview.topCameras.slice(0, SNAPSHOT_BUDGET.cameras).map((camera) => ({
    name: camera.cameraName,
    value: camera.count,
    detail: `${camera.count} grouped events in the current slice.`
  }));

  const atRiskCameras: ReportSnapshotItem[] = [...overview.cameraHealth]
    .filter((camera) => camera.status !== "healthy")
    .sort((left, right) => right.anomalyScore - left.anomalyScore || (left.avgVoltage ?? 99) - (right.avgVoltage ?? 99))
    .slice(0, SNAPSHOT_BUDGET.cameras)
    .map((camera) => ({
      name: camera.cameraName,
      value: round(camera.anomalyScore, 1),
      status: camera.status,
      detail: describeCamera(camera)
    }));

  const notableShifts: ReportSnapshotItem[] = analytics.categoryShiftMatrix
    .filter((item) => Math.abs(item.shiftPct) >= 5)
    .slice(0, SNAPSHOT_BUDGET.highlights)
    .map((item) => ({
      name: `${item.cameraName} • ${item.category}`,
      value: round(item.shiftPct, 1),
      detail: `Recent share ${round(item.recentSharePct, 1)}% vs baseline ${round(item.baselineSharePct, 1)}% (${item.recentCount} recent groups).`
    }));

  const anomalies: ReportSnapshotItem[] = [
    ...analytics.cameraForecastLeaders.slice(0, 3).map((item) => ({
      name: `${item.cameraName} forecast delta`,
      value: round(item.residualPct, 1),
      detail: `Actual ${item.actual} vs expected ${round(item.expected, 1)} on ${item.date}.`
    })),
    ...analytics.novelEvents.slice(0, 2).map((item) => ({
      name: `${item.cameraName} ${item.category} @ ${String(item.hour).padStart(2, "0")}:00`,
      value: round(item.noveltyScore, 1),
      detail: `${item.currentCount} recent groups vs ${round(item.baselineDailyAvg, 1)}/day baseline.`
    }))
  ].slice(0, SNAPSHOT_BUDGET.highlights);

  const overviewMetrics: ReportSnapshotMetric[] = [
    { label: "Grouped events", value: overview.kpis.totalEvents },
    { label: "Active cameras", value: overview.kpis.activeCameras },
    { label: "Wildlife share", value: round(overview.kpis.wildlifeSharePct, 1), unit: "%" },
    { label: "Human share", value: round(overview.kpis.humanSharePct, 1), unit: "%" },
    { label: "Upload success", value: round(overview.kpis.uploadSuccessPct, 1), unit: "%" },
    { label: "AI processed", value: round(overview.kpis.aiProcessedPct, 1), unit: "%" },
    { label: "Avg processing lag", value: round(overview.kpis.avgProcessingLagSeconds, 1), unit: "sec" },
    { label: "Avg voltage", value: round(overview.kpis.avgVoltage, 2), unit: "v" },
    { label: "Cameras with alerts", value: overview.kpis.camerasWithAlerts }
  ].slice(0, SNAPSHOT_BUDGET.metrics);

  const narrativeContext = [
    ...overview.insights.map((item) => `${item.title}: ${item.detail}`),
    ...analytics.advancedInsights.map((item) => `${item.title}: ${item.detail}`)
  ].slice(0, SNAPSHOT_BUDGET.narrative);

  return {
    filterKey,
    filters: normalizedFilters,
    dateRange: {
      startDate: normalizedFilters.start_date ?? "",
      endDate: normalizedFilters.end_date ?? ""
    },
    overviewMetrics,
    overviewHighlights: buildOverviewHighlights(overview),
    pipeline: buildPipelineMetrics(overview),
    opsHighlights: buildOpsHighlights(overview),
    topCameras,
    atRiskCameras,
    advancedHighlights: buildAdvancedHighlights(analytics),
    notableShifts,
    anomalies,
    trends: buildTrends(overview),
    dataQualityCaveats: buildDataQualityCaveats(analytics),
    narrativeContext
  };
};
