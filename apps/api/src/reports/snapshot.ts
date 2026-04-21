import { createHash } from "node:crypto";
import type {
  AnalyticsLabResponse,
  CameraHealthRow,
  CompositionPoint,
  DailyActivityPoint,
  DashboardFilters,
  OverviewResponse,
  ReportSnapshotItem,
  ReportSnapshotMetric,
  ReportSnapshotSummary,
  ReportSnapshotTrend,
  SubjectCameraHeatmapPoint,
  TimeOfDayCompositionPoint
} from "@grizcam/shared";

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

const normalizeFilters = (filters: DashboardFilters): DashboardFilters => ({
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

const formatShareNote = (count: number, total: number) => (total > 0 ? `${round((count / total) * 100, 1)}% share` : "0% share");

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

const buildOverviewHighlights = (
  overview: OverviewResponse,
  composition: CompositionPoint[],
  dailyActivity: DailyActivityPoint[],
  timeOfDay: TimeOfDayCompositionPoint[],
  subjectByCamera: SubjectCameraHeatmapPoint[]
): ReportSnapshotItem[] => {
  const totalComposition = composition.reduce((sum, item) => sum + item.uniqueEventGroups, 0);
  const topComposition = composition
    .slice(0, 3)
    .map((item) => ({
      name: `${item.category} mix`,
      value: item.uniqueEventGroups,
      detail: `${item.uniqueEventGroups} grouped events, ${formatShareNote(item.uniqueEventGroups, totalComposition)} in this slice.`
    }));

  const dailyTotals = Array.from(
    dailyActivity.reduce<Map<string, number>>((map, point) => {
      map.set(point.date, (map.get(point.date) ?? 0) + point.uniqueEventGroups);
      return map;
    }, new Map())
  )
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => right.count - left.count || left.date.localeCompare(right.date));

  const peakDay = dailyTotals[0];
  const recentDailyAverage = average(dailyTotals.slice(0, Math.min(7, dailyTotals.length)).map((item) => item.count));

  const timeOfDayTotals = timeOfDay
    .map((bucket) => ({
      bucket: bucket.bucket,
      count: bucket.wildlife + bucket.human + bucket.vehicle + bucket.emptyScene
    }))
    .sort((left, right) => right.count - left.count || left.bucket.localeCompare(right.bucket));
  const dominantTimeOfDay = timeOfDayTotals[0];

  const topSubjectByCamera = [...subjectByCamera]
    .sort((left, right) => right.uniqueEventGroups - left.uniqueEventGroups || left.cameraName.localeCompare(right.cameraName))
    .slice(0, 2)
    .map((item) => ({
      name: `${item.cameraName} • ${item.subjectClass}`,
      value: item.uniqueEventGroups,
      detail: `${item.uniqueEventGroups} grouped events for this camera/subject combination.`
    }));

  const summary: ReportSnapshotItem[] = [
    {
      name: "Grouped event volume",
      value: overview.kpis.totalEvents,
      detail: `${overview.kpis.totalEvents} grouped events across ${overview.kpis.activeCameras} active cameras in the current filter slice.`
    },
    ...topComposition,
    peakDay
      ? {
          name: "Peak activity day",
          value: peakDay.count,
          detail: `${peakDay.date} recorded ${peakDay.count} grouped events. Recent average is ${round(recentDailyAverage, 1) ?? 0} per day.`
        }
      : null,
    dominantTimeOfDay
      ? {
          name: "Dominant time of day",
          value: dominantTimeOfDay.count,
          detail: `${dominantTimeOfDay.bucket} contributed ${dominantTimeOfDay.count} grouped events in the current slice.`
        }
      : null,
    ...topSubjectByCamera
  ].filter((item): item is ReportSnapshotItem => Boolean(item));

  return summary.slice(0, SNAPSHOT_BUDGET.highlights);
};

const buildOpsHighlights = (overview: OverviewResponse): ReportSnapshotItem[] => {
  const staleCamera = [...overview.staleCameras]
    .sort((left, right) => (right.lastSeenHoursAgo ?? 0) - (left.lastSeenHoursAgo ?? 0))
    [0];
  const highestLag = [...overview.cameraHealth]
    .filter((camera) => camera.avgProcessingLagSeconds !== null)
    .sort((left, right) => (right.avgProcessingLagSeconds ?? 0) - (left.avgProcessingLagSeconds ?? 0))
    [0];
  const lowestVoltage = [...overview.cameraHealth]
    .filter((camera) => camera.avgVoltage !== null)
    .sort((left, right) => (left.avgVoltage ?? 99) - (right.avgVoltage ?? 99))
    [0];

  const items: ReportSnapshotItem[] = [
    {
      name: "Cameras with alerts",
      value: overview.kpis.camerasWithAlerts,
      detail: `${overview.kpis.camerasWithAlerts} cameras are currently flagged with non-healthy operational status.`
    },
    staleCamera
      ? {
          name: "Stalest camera",
          value: round(staleCamera.lastSeenHoursAgo, 1),
          status: staleCamera.status,
          detail: `${staleCamera.cameraName} was last seen ${round(staleCamera.lastSeenHoursAgo, 1)} hours ago.`
        }
      : null,
    highestLag
      ? {
          name: "Highest lag camera",
          value: round(highestLag.avgProcessingLagSeconds, 1),
          status: highestLag.status,
          detail: `${highestLag.cameraName} is averaging ${Math.round((highestLag.avgProcessingLagSeconds ?? 0) / 60)} minutes of processing lag.`
        }
      : null,
    lowestVoltage
      ? {
          name: "Lowest voltage camera",
          value: round(lowestVoltage.avgVoltage, 2),
          status: lowestVoltage.status,
          detail: `${lowestVoltage.cameraName} is averaging ${round(lowestVoltage.avgVoltage, 2)}v.`
        }
      : null,
    {
      name: "Upload success",
      value: round(overview.kpis.uploadSuccessPct, 1),
      detail: `${round(overview.kpis.uploadSuccessPct, 1)}% of grouped events reached upload in the current period.`
    }
  ].filter((item): item is ReportSnapshotItem => Boolean(item));

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

export const buildReportFilterKey = (filters: DashboardFilters) => stableSerialize(normalizeFilters(filters));

export const buildReportSnapshot = (
  filters: DashboardFilters,
  overview: OverviewResponse,
  analytics: AnalyticsLabResponse,
  dashboard: {
    dailyActivity: DailyActivityPoint[];
    timeOfDay: TimeOfDayCompositionPoint[];
    subjectByCamera: SubjectCameraHeatmapPoint[];
    composition: CompositionPoint[];
  }
): ReportSnapshotSummary => {
  const normalizedFilters = normalizeFilters(filters);
  const filterKey = buildReportFilterKey(normalizedFilters);
  const topCameras: ReportSnapshotItem[] = overview.topCameras.slice(0, 5).map((camera) => ({
    name: camera.cameraName,
    value: camera.count,
    detail: `${camera.count} grouped events in the current slice.`
  }));

  const atRiskCameras: ReportSnapshotItem[] = [...overview.cameraHealth]
    .filter((camera) => camera.status !== "healthy")
    .sort((left, right) => right.anomalyScore - left.anomalyScore || (left.avgVoltage ?? 99) - (right.avgVoltage ?? 99))
    .slice(0, 5)
    .map((camera) => ({
      name: camera.cameraName,
      value: round(camera.anomalyScore, 1),
      status: camera.status,
      detail: describeCamera(camera)
    }));

  const notableShifts: ReportSnapshotItem[] = analytics.categoryShiftMatrix
    .filter((item) => Math.abs(item.shiftPct) >= 5)
    .slice(0, 5)
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
  ].slice(0, 5);

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
    overviewHighlights: buildOverviewHighlights(
      overview,
      dashboard.composition,
      dashboard.dailyActivity,
      dashboard.timeOfDay,
      dashboard.subjectByCamera
    ),
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

export const hashReportSnapshot = (snapshot: ReportSnapshotSummary, promptVersion: string, model: string) =>
  createHash("sha256")
    .update(
      stableSerialize({
        snapshot: {
          ...snapshot,
          filters: normalizeFilters(snapshot.filters),
          filterKey: buildReportFilterKey(snapshot.filters)
        },
        promptVersion,
        model
      })
    )
    .digest("hex");
