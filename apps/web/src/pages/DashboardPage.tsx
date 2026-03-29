import { useQuery } from "@tanstack/react-query";
import { defaultDashboardFilters, type EventQuery } from "@grizcam/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import { Heatmap } from "../components/charts/Heatmap";
import { BurstinessChart } from "../components/charts/BurstinessChart";
import { CompositionChart } from "../components/charts/CompositionChart";
import { DailyTrendChart } from "../components/charts/DailyTrendChart";
import { MonthlySeasonalityChart } from "../components/charts/MonthlySeasonalityChart";
import { TelemetryChart } from "../components/charts/TelemetryChart";
import { TimeOfDayChart } from "../components/charts/TimeOfDayChart";
import { DayDetailPanel } from "../components/DayDetailPanel";
import { EventTable } from "../components/EventTable";
import { FilterBar } from "../components/FilterBar";
import { KpiStrip } from "../components/KpiStrip";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

const QueryState = ({ error }: { error?: Error | null }) => (
  <div className="panel rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center">
    <div className="text-sm font-medium text-white">{error ? "This section is temporarily unavailable" : "Loading dashboard section"}</div>
    <div className="mt-2 text-sm text-slate-400">
      {error ? "The demo backend returned an unexpected response. Try refreshing in a moment." : "Fetching live analytics from the demo dataset."}
    </div>
  </div>
);

const demoPresets = [
  {
    label: "All Cameras 2025",
    description: "Full-year overview across every device",
    filters: {
      ...defaultDashboardFilters,
      start_date: "2025-01-01",
      end_date: "2025-12-31"
    }
  },
  {
    label: "Wildlife Morning",
    description: "Early wildlife movement across the park",
    filters: {
      ...defaultDashboardFilters,
      subject_category: ["wildlife"],
      time_of_day_bucket: ["morning"]
    }
  },
  {
    label: "Human Activity",
    description: "Trail and perimeter human detections",
    filters: {
      ...defaultDashboardFilters,
      subject_category: ["human"]
    }
  }
];

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
  const monthlySeasonalityQuery = useQuery({ queryKey: ["monthly-seasonality", stableFilters], queryFn: () => api.monthlySeasonality(stableFilters) });
  const burstinessQuery = useQuery({ queryKey: ["burstiness", stableFilters], queryFn: () => api.burstiness(stableFilters) });
  const telemetryQuery = useQuery({ queryKey: ["telemetry", stableFilters], queryFn: () => api.telemetry(stableFilters) });
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

  const hourlyRows = Array.from(new Set(hourlyHeatmapQuery.data?.map((point) => point.cameraName) ?? []));
  const hourlyColumns = Array.from({ length: 24 }, (_, index) => String(index));
  const subjectRows = Array.from(new Set(subjectByCameraQuery.data?.map((point) => point.cameraName) ?? []));
  const subjectColumns = Array.from(new Set(subjectByCameraQuery.data?.map((point) => point.subjectClass) ?? []));
  const handleEventQueryChange = useCallback((patch: Partial<EventQuery>) => {
    setEventQuery((current) => ({ ...current, ...patch }));
  }, []);
  const applyPreset = useCallback(
    (nextFilters: typeof demoPresets[number]["filters"]) => {
      patchFilters(nextFilters);
      setSelectedDate(undefined);
      setEventQuery({
        ...nextFilters,
        page: 1,
        page_size: 25,
        sort_by: "timestamp",
        sort_dir: "desc"
      });
    },
    [patchFilters]
  );

  return (
    <div className="min-h-screen overflow-x-hidden px-4 py-4 text-slate-100">
      <div className="mx-auto grid max-w-[1800px] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <FilterBar filters={filters} options={optionsQuery.data} onChange={onFilterChange} onReset={onReset} />

        <main className="min-w-0 space-y-4">
          <div className="rounded-[32px] border border-white/10 bg-white/[0.03] px-5 py-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-3xl font-semibold text-white">Yellowstone 2025 synthetic analytics</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                  Explore synthetic 2025 Yellowstone camera activity with fast filtering, drilldowns, and event-level search.
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                Synthetic Yellowstone 2025 demo data.
              </div>
            </div>
          </div>

          <section className="panel rounded-[28px] p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Presets</div>
                <p className="mt-2 text-sm text-slate-400">Quick views for common slices of the data.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {demoPresets.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset.filters)}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/10"
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {kpiQuery.data ? <KpiStrip data={kpiQuery.data} /> : <QueryState error={kpiQuery.error as Error | null} />}

          <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
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
                title="Subject-By-Camera Heatmap"
                subtitle="Unique event groups by camera and detected subject class."
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

          <div className="grid gap-4 xl:grid-cols-3">
            {timeOfDayQuery.data ? <TimeOfDayChart data={timeOfDayQuery.data} /> : <QueryState error={timeOfDayQuery.error as Error | null} />}
            {compositionQuery.data ? <CompositionChart data={compositionQuery.data} /> : <QueryState error={compositionQuery.error as Error | null} />}
            {burstinessQuery.data ? <BurstinessChart data={burstinessQuery.data} /> : <QueryState error={burstinessQuery.error as Error | null} />}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {monthlySeasonalityQuery.data ? (
              <MonthlySeasonalityChart data={monthlySeasonalityQuery.data} />
            ) : (
              <QueryState error={monthlySeasonalityQuery.error as Error | null} />
            )}
            {telemetryQuery.data ? <TelemetryChart data={telemetryQuery.data} /> : <QueryState error={telemetryQuery.error as Error | null} />}
          </div>

          <EventTable
            data={eventsQuery.data}
            isLoading={eventsQuery.isLoading}
            query={eventQuery}
            onQueryChange={handleEventQueryChange}
            exportUrl={api.exportUrl(eventQuery)}
          />

          <footer className="px-1 pb-4 text-sm text-slate-500">
            {appEnv.appTitle} is a public synthetic-data demo site prepared for stakeholder review. No live wildlife operations data is exposed here.
          </footer>
        </main>
      </div>
    </div>
  );
};
