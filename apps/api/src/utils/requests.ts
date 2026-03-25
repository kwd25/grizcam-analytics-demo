import {
  dashboardFiltersSchema,
  DEFAULT_END_DATE,
  DEFAULT_START_DATE,
  eventQuerySchema,
  type DashboardFilters,
  type EventQuery
} from "@grizcam/shared";

export const parseFilters = (query: Record<string, unknown>): DashboardFilters =>
  dashboardFiltersSchema.parse({
    ...query,
    start_date: query.start_date ?? DEFAULT_START_DATE,
    end_date: query.end_date ?? DEFAULT_END_DATE
  });

export const parseEventQuery = (query: Record<string, unknown>): EventQuery =>
  eventQuerySchema.parse({
    ...query,
    start_date: query.start_date ?? DEFAULT_START_DATE,
    end_date: query.end_date ?? DEFAULT_END_DATE
  });

