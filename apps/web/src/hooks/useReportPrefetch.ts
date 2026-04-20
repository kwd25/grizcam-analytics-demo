import { useEffect, useRef, useState } from "react";
import type { DashboardFilters, ReportPhase, ReportViewStatus } from "@grizcam/shared";
import { api, QueryRequestError } from "../lib/api";
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
    const nextKey = serializeFilters(debouncedFilters);
    if (!nextKey || lastTriggeredKey.current === nextKey) {
      return;
    }

    lastTriggeredKey.current = nextKey;
    setState({
      status: "generating",
      phase: "queued",
      message: null
    });

    void api
      .triggerReportGeneration(debouncedFilters)
      .then((result) => {
        setState({
          status: result.status,
          phase: result.phase,
          message: result.reason ?? null
        });
      })
      .catch((error) => {
        const message =
          error instanceof QueryRequestError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Background report generation failed.";
        console.error("Background report generation failed", { message });
        setState({
          status: "error",
          phase: "error",
          message
        });
      });
  }, [debouncedFilters]);

  return state;
};
