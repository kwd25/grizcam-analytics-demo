import type {
  BurstinessPoint,
  CompositionPoint,
  DailyActivityPoint,
  DashboardFilters,
  DaySummaryResponse,
  EventsResponse,
  EventQuery,
  FilterOptionsResponse,
  HourlyHeatmapPoint,
  KpiResponse,
  MonthlySeasonalityPoint,
  SubjectCameraHeatmapPoint,
  TelemetryPoint,
  TimeOfDayCompositionPoint
} from "@grizcam/shared";
import { appEnv } from "./env";

const buildParams = (filters: DashboardFilters | EventQuery) => {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        params.append(key, item);
      });
      return;
    }

    params.set(key, String(value));
  });

  return params.toString();
};

const fetchJson = async <T>(path: string, filters?: DashboardFilters | EventQuery): Promise<T> => {
  const query = filters ? buildParams(filters) : "";
  const url = `${appEnv.apiBaseUrl}${path}${query ? `?${query}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const api = {
  filterOptions: () => fetchJson<FilterOptionsResponse>("/api/filters/options"),
  kpis: (filters: DashboardFilters) => fetchJson<KpiResponse>("/api/kpis", filters),
  dailyActivity: (filters: DashboardFilters) => fetchJson<DailyActivityPoint[]>("/api/charts/daily-activity", filters),
  hourlyHeatmap: (filters: DashboardFilters) => fetchJson<HourlyHeatmapPoint[]>("/api/charts/hourly-heatmap", filters),
  timeOfDayComposition: (filters: DashboardFilters) => fetchJson<TimeOfDayCompositionPoint[]>("/api/charts/time-of-day-composition", filters),
  subjectByCamera: (filters: DashboardFilters) => fetchJson<SubjectCameraHeatmapPoint[]>("/api/charts/subject-by-camera", filters),
  monthlySeasonality: (filters: DashboardFilters) => fetchJson<MonthlySeasonalityPoint[]>("/api/charts/monthly-seasonality", filters),
  burstiness: (filters: DashboardFilters) => fetchJson<BurstinessPoint[]>("/api/charts/burstiness", filters),
  telemetry: (filters: DashboardFilters) => fetchJson<TelemetryPoint[]>("/api/charts/telemetry", filters),
  composition: (filters: DashboardFilters) => fetchJson<CompositionPoint[]>("/api/charts/composition", filters),
  daySummary: (date: string, filters: DashboardFilters) => fetchJson<DaySummaryResponse>(`/api/day/${date}/summary`, filters),
  events: (filters: EventQuery) => fetchJson<EventsResponse>("/api/events", filters),
  exportUrl: (filters: EventQuery) => `${appEnv.apiBaseUrl}/api/events/export?${buildParams(filters)}`,
  exportsEnabled: appEnv.exportsEnabled
};
