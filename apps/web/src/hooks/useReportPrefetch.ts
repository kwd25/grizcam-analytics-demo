import { useEffect, useRef } from "react";
import type { DashboardFilters } from "@grizcam/shared";
import { api } from "../lib/api";
import { useDebouncedValue } from "./useDebouncedValue";

const serializeFilters = (filters: DashboardFilters) =>
  JSON.stringify({
    ...filters,
    camera_name: [...filters.camera_name].sort(),
    mac: [...filters.mac].sort(),
    time_of_day_bucket: [...filters.time_of_day_bucket].sort(),
    subject_category: [...filters.subject_category].sort(),
    subject_class: [...filters.subject_class].sort(),
    q: filters.q?.trim() ?? ""
  });

export const useReportPrefetch = (filters: DashboardFilters) => {
  const debouncedFilters = useDebouncedValue(filters, 450);
  const lastTriggeredKey = useRef<string>("");

  useEffect(() => {
    const nextKey = serializeFilters(debouncedFilters);
    if (!nextKey || lastTriggeredKey.current === nextKey) {
      return;
    }

    lastTriggeredKey.current = nextKey;
    void api.triggerReportGeneration(debouncedFilters).catch(() => {
      // Fail silently so analytics pages remain responsive even if report generation is unavailable.
    });
  }, [debouncedFilters]);
};
