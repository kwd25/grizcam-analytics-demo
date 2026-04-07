import { useQuery } from "@tanstack/react-query";
import { defaultDashboardFilters, type EventQuery } from "@grizcam/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { DayDetailPanel } from "../components/DayDetailPanel";
import { EventTable } from "../components/EventTable";
import { FilterBar } from "../components/FilterBar";
import { KpiStrip } from "../components/KpiStrip";
import { CompositionChart } from "../components/charts/CompositionChart";
import { DailyTrendChart } from "../components/charts/DailyTrendChart";
import { Heatmap } from "../components/charts/Heatmap";
import { MonthlyActivityByCategoryChart } from "../components/charts/MonthlyActivityByCategoryChart";
import { TimeOfDayChart } from "../components/charts/TimeOfDayChart";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

const QueryState = ({ error }: { error?: Error | null }) => (
  <div className="panel rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center">
    <div className="text-sm font-medium text-white">{error ? "This section is temporarily unavailable" : "Loading dashboard section"}</div>
    <div className="mt-2 text-sm text-slate-400">
      {error ? "The dashboard hit an unexpected response. Try refreshing in a moment." : "Fetching classic analytics from the enriched synthetic dataset."}
    </div>
  </div>
);

export const DashboardPage = () => {
  const { filters, patchFilters, resetFilters } = useDashboardFilters();
  const [selectedDate, setSelectedDate] = useState<string>();
  const [eventQuery, setEventQuery] = useState<EventQuery>({
    ...defaultDashboardFilters,
    ...filters,
    page: 1,
    page_size: 25,
    sort_by: "timestamp",
    sort_dir: "desc"
  });

  const stableFilters = useMemo(() => filters, [filters]);

  useEffect(() => {
    setEventQuery((current) => ({
      ...current,
      ...filters,
      page: 1
    }));
  }, [filters]);

  const optionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });
  const kpiQuery = useQuery({ queryKey: ["kpis", stableFilters], queryFn: () => api.kpis(stableFilters) });
  const dailyActivityQuery = useQuery({ queryKey: ["daily-activity", stableFilters], queryFn: () => api.dailyActivity(stableFilters) });
  const hourlyHeatmapQuery = useQuery({ queryKey: ["hourly-heatmap", stableFilters], queryFn: () => api.hourlyHeatmap(stableFilters) });
  const timeOfDayQuery = useQuery({ queryKey: ["time-of-day", stableFilters], queryFn: () => api.timeOfDayComposition(stableFilters) });
  const subjectByCameraQuery = useQuery({ queryKey: ["subject-camera", stableFilters], queryFn: () => api.subjectByCamera(stableFilters) });
  const monthlyActivityByCategoryQuery = useQuery({
    queryKey: ["monthly-activity-by-category", stableFilters],
    queryFn: () => api.monthlyActivityByCategory(stableFilters)
  });
  const compositionQuery = useQuery({ queryKey: ["composition", stableFilters], queryFn: () => api.composition(stableFilters) });
  const daySummaryQuery = useQuery({
    queryKey: ["day-summary", selectedDate, stableFilters],
    queryFn: () => api.daySummary(selectedDate!, stableFilters),
    enabled: Boolean(selectedDate)
  });
  const eventsQuery = useQuery({
    queryKey: ["events", eventQuery],
    queryFn: () => api.events(eventQuery)
  });

  const syncEventFilters = (nextFilters = filters) => {
    setEventQuery((current) => ({
      ...current,
      ...nextFilters,
      page: 1
    }));
  };

  const onFilterChange = (patch: Partial<typeof filters>) => {
    const nextFilters = { ...filters, ...patch };
    patchFilters(patch);
    syncEventFilters(nextFilters);
  };

  const onReset = () => {
    resetFilters();
    setEventQuery({
      ...defaultDashboardFilters,
      page: 1,
      page_size: 25,
      sort_by: "timestamp",
      sort_dir: "desc"
    });
    setSelectedDate(undefined);
  };

  const handleEventQueryChange = useCallback((patch: Partial<EventQuery>) => {
    setEventQuery((current) => ({ ...current, ...patch }));
  }, []);

  const hourlyRows = Array.from(new Set(hourlyHeatmapQuery.data?.map((point) => point.cameraName) ?? []));
  const hourlyColumns = Array.from({ length: 24 }, (_, index) => String(index));
  const subjectRows = Array.from(new Set(subjectByCameraQuery.data?.map((point) => point.cameraName) ?? []));
  const subjectColumns = Array.from(new Set(subjectByCameraQuery.data?.map((point) => point.subjectClass) ?? []));

  return (
    <AppShell
      title="GrizCam Overview"
      subtitle="Classic wildlife and activity dashboard, focused on the familiar analytics views."
      badge={appEnv.demoLabel}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={onFilterChange} onReset={onReset} />}
    >
      {kpiQuery.data ? <KpiStrip data={kpiQuery.data} /> : <QueryState error={kpiQuery.error as Error | null} />}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        {dailyActivityQuery.data ? (
          <DailyTrendChart data={dailyActivityQuery.data} onSelectDate={setSelectedDate} />
        ) : (
          <QueryState error={dailyActivityQuery.error as Error | null} />
        )}

        <DayDetailPanel selectedDate={selectedDate} data={daySummaryQuery.data} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {hourlyHeatmapQuery.data ? (
          <Heatmap
            title="Hour-Of-Day Heatmap"
            subtitle="Unique event groups by camera and local hour."
            rows={hourlyRows}
            columns={hourlyColumns}
            data={hourlyHeatmapQuery.data.map((point) => ({
              row: point.cameraName,
              column: String(point.hour),
              value: point.uniqueEventGroups
            }))}
          />
        ) : (
          <QueryState error={hourlyHeatmapQuery.error as Error | null} />
        )}

        {subjectByCameraQuery.data ? (
          <Heatmap
            title="Subject Mix by Camera"
            subtitle="Compare what each camera sees most often."
            rows={subjectRows}
            columns={subjectColumns}
            variant="subject"
            data={subjectByCameraQuery.data.map((point) => ({
              row: point.cameraName,
              column: point.subjectClass,
              value: point.uniqueEventGroups
            }))}
          />
        ) : (
          <QueryState error={subjectByCameraQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {timeOfDayQuery.data ? <TimeOfDayChart data={timeOfDayQuery.data} /> : <QueryState error={timeOfDayQuery.error as Error | null} />}

        {monthlyActivityByCategoryQuery.data ? (
          <MonthlyActivityByCategoryChart data={monthlyActivityByCategoryQuery.data} />
        ) : (
          <QueryState error={monthlyActivityByCategoryQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {compositionQuery.data ? <CompositionChart data={compositionQuery.data} /> : <QueryState error={compositionQuery.error as Error | null} />}
      </div>

      <EventTable
        data={eventsQuery.data}
        isLoading={eventsQuery.isLoading}
        query={eventQuery}
        onQueryChange={handleEventQueryChange}
        exportUrl={api.exportUrl(eventQuery)}
      />
    </AppShell>
  );
};
