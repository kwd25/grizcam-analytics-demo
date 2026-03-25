import {
  dashboardFiltersSchema,
  defaultDashboardFilters,
  type DashboardFilters,
  type EventQuery
} from "@grizcam/shared";
import { useMemo, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

const toSearchParams = (filters: Record<string, unknown>) => {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
      return;
    }

    params.set(key, String(value));
  });

  return params;
};

export const useDashboardFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [, startTransition] = useTransition();

  const filters = useMemo<DashboardFilters>(() => {
    const parsed = dashboardFiltersSchema.safeParse({
      ...defaultDashboardFilters,
      camera_name: searchParams.getAll("camera_name"),
      mac: searchParams.getAll("mac"),
      start_date: searchParams.get("start_date") ?? defaultDashboardFilters.start_date,
      end_date: searchParams.get("end_date") ?? defaultDashboardFilters.end_date,
      time_of_day_bucket: searchParams.getAll("time_of_day_bucket"),
      subject_category: searchParams.getAll("subject_category"),
      subject_class: searchParams.getAll("subject_class"),
      q: searchParams.get("q") ?? "",
      min_lux: searchParams.get("min_lux") ?? undefined,
      max_lux: searchParams.get("max_lux") ?? undefined,
      min_temperature: searchParams.get("min_temperature") ?? undefined,
      max_temperature: searchParams.get("max_temperature") ?? undefined,
      min_heat_level: searchParams.get("min_heat_level") ?? undefined,
      max_heat_level: searchParams.get("max_heat_level") ?? undefined
    });

    return parsed.success ? parsed.data : defaultDashboardFilters;
  }, [searchParams]);

  const setFilters = (next: DashboardFilters) => {
    startTransition(() => {
      setSearchParams(toSearchParams(next), { replace: true });
    });
  };

  const patchFilters = (patch: Partial<DashboardFilters>) => {
    setFilters({ ...filters, ...patch });
  };

  const eventQuery = (overrides: Partial<EventQuery>): EventQuery => ({
    ...filters,
    page: 1,
    page_size: 25,
    sort_by: "timestamp",
    sort_dir: "desc",
    ...overrides
  });

  return { filters, setFilters, patchFilters, eventQuery, resetFilters: () => setFilters(defaultDashboardFilters) };
};

