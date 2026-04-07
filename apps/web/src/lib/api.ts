import type {
  AnalyticsLabResponse,
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
  OverviewResponse,
  QueryMetadataResponse,
  QueryRunResponse,
  SubjectCameraHeatmapPoint,
  TimeOfDayCompositionPoint,
  QueryValidationResponse
} from "@grizcam/shared";
import { appEnv } from "./env";

export type QueryRequestErrorCode = "TIMEOUT" | "NETWORK" | "INVALID_RESPONSE";

export class QueryRequestError extends Error {
  code: QueryRequestErrorCode;

  constructor(code: QueryRequestErrorCode, message: string) {
    super(message);
    this.name = "QueryRequestError";
    this.code = code;
  }
}

const QUERY_REQUEST_TIMEOUT_MS = 10_000;

const isStructuredQueryResponse = (payload: unknown): payload is { issues: unknown[] } => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  return "issues" in payload && Array.isArray((payload as { issues?: unknown[] }).issues);
};

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
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.issues?.[0]?.message ?? `Request failed: ${response.status}`);
  }
  return payload as T;
};

const postQueryJson = async <T>(path: string, body: unknown): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), QUERY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${appEnv.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      if (isStructuredQueryResponse(payload)) {
        return payload as T;
      }

      const message =
        payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `The query service returned HTTP ${response.status}.`;
      throw new QueryRequestError("INVALID_RESPONSE", message);
    }

    if (!isStructuredQueryResponse(payload) && (!payload || typeof payload !== "object")) {
      throw new QueryRequestError("INVALID_RESPONSE", "The query service returned an invalid response.");
    }

    return payload as T;
  } catch (error) {
    if (error instanceof QueryRequestError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new QueryRequestError("TIMEOUT", "The query request took longer than 10 seconds and was stopped.");
    }
    throw new QueryRequestError("NETWORK", "The query service is unreachable right now. Please retry in a moment.");
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const api = {
  filterOptions: () => fetchJson<FilterOptionsResponse>("/api/filters/options"),
  kpis: (filters: DashboardFilters) => fetchJson<KpiResponse>("/api/kpis", filters),
  dailyActivity: (filters: DashboardFilters) => fetchJson<DailyActivityPoint[]>("/api/charts/daily-activity", filters),
  hourlyHeatmap: (filters: DashboardFilters) => fetchJson<HourlyHeatmapPoint[]>("/api/charts/hourly-heatmap", filters),
  timeOfDayComposition: (filters: DashboardFilters) => fetchJson<TimeOfDayCompositionPoint[]>("/api/charts/time-of-day-composition", filters),
  subjectByCamera: (filters: DashboardFilters) => fetchJson<SubjectCameraHeatmapPoint[]>("/api/charts/subject-by-camera", filters),
  monthlyActivityByCategory: (filters: DashboardFilters) =>
    fetchJson<MonthlyActivityCategoryPoint[]>("/api/charts/monthly-activity-by-category", filters),
  composition: (filters: DashboardFilters) => fetchJson<CompositionPoint[]>("/api/charts/composition", filters),
  overview: (filters: DashboardFilters) => fetchJson<OverviewResponse>("/api/overview", filters),
  analyticsLab: (filters: DashboardFilters) => fetchJson<AnalyticsLabResponse>("/api/analytics-lab", filters),
  daySummary: (date: string, filters: DashboardFilters) => fetchJson<DaySummaryResponse>(`/api/day/${date}/summary`, filters),
  events: (filters: EventQuery) => fetchJson<EventsResponse>("/api/events", filters),
  queryMetadata: () => fetchJson<QueryMetadataResponse>("/api/query/metadata"),
  validateQuery: (sql: string) => postQueryJson<QueryValidationResponse>("/api/query/validate", { sql }),
  runQuery: (sql: string) => postQueryJson<QueryRunResponse>("/api/query/run", { sql }),
  exportUrl: (filters: EventQuery) => `${appEnv.apiBaseUrl}/api/events/export?${buildParams(filters)}`,
  exportsEnabled: appEnv.exportsEnabled
};
