import { useEffect, useRef, useState } from "react";
import type { DashboardFilters, ReportPhase, ReportViewStatus } from "@grizcam/shared";
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

type PrefetchState = {
  status: ReportViewStatus;
  phase: ReportPhase;
  message: string | null;
};

const defaultState: PrefetchState = {
  status: "idle",
  phase: "idle",
  message: null
};

export const useReportPrefetch = (filters: DashboardFilters) => {
  const debouncedFilters = useDebouncedValue(filters, 450);
  const lastTriggeredKey = useRef<string>("");
  const [state, setState] = useState<PrefetchState>(defaultState);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const nextKey = serializeFilters(debouncedFilters);
      if (!nextKey || lastTriggeredKey.current === nextKey) {
        return;
      }

      lastTriggeredKey.current = nextKey;
      if (!cancelled) {
        setState({
          status: "idle",
          phase: "idle",
          message: "Background generation is paused. Load analytics inputs on the Reports tab, then generate manually."
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedFilters]);

  return state;
};
