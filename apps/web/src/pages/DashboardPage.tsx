import { useQuery } from "@tanstack/react-query";
import { defaultDashboardFilters, type EventQuery } from "@grizcam/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { AppShell } from "../components/AppShell";
import { CameraHealthTable } from "../components/CameraHealthTable";
import { DayDetailPanel } from "../components/DayDetailPanel";
import { EventTable } from "../components/EventTable";
import { FilterBar } from "../components/FilterBar";
import { InsightList } from "../components/InsightList";
import { KpiStrip } from "../components/KpiStrip";
import { NotableEventsList } from "../components/NotableEventsList";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { CompositionChart } from "../components/charts/CompositionChart";
import { DailyTrendChart } from "../components/charts/DailyTrendChart";
import { Heatmap } from "../components/charts/Heatmap";
import { MonthlyActivityByCategoryChart } from "../components/charts/MonthlyActivityByCategoryChart";
import { TimeOfDayChart } from "../components/charts/TimeOfDayChart";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import {
  formatDurationShort,
  formatEventTimestamp,
  formatNumber,
  formatNullableNumber,
  titleCase
} from "../lib/utils";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

const QueryState = ({ error }: { error?: Error | null }) => (
  <div className="panel rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center">
    <div className="text-sm font-medium text-white">{error ? "This section is temporarily unavailable" : "Loading dashboard section"}</div>
    <div className="mt-2 text-sm text-slate-400">
      {error ? "The dashboard hit an unexpected response. Try refreshing in a moment." : "Fetching live analytics from the enriched synthetic dataset."}
    </div>
  </div>
);

const chartPalette = ["#73e0ae", "#59a8ff", "#ffcf66", "#ff7c7c", "#b08cff", "#6ee7f9"];

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
  const overviewQuery = useQuery({ queryKey: ["overview", stableFilters], queryFn: () => api.overview(stableFilters) });
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

  const overview = overviewQuery.data;
  const hourlyRows = Array.from(new Set(hourlyHeatmapQuery.data?.map((point) => point.cameraName) ?? []));
  const hourlyColumns = Array.from({ length: 24 }, (_, index) => String(index));
  const subjectRows = Array.from(new Set(subjectByCameraQuery.data?.map((point) => point.cameraName) ?? []));
  const subjectColumns = Array.from(new Set(subjectByCameraQuery.data?.map((point) => point.subjectClass) ?? []));

  return (
    <AppShell
      title="GrizCam Operations Dashboard"
      subtitle="Executive overview of fleet health, event activity, pipeline performance, and notable detections from the richer synthetic/raw-like event stream."
      badge={appEnv.demoLabel}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={onFilterChange} onReset={onReset} />}
    >
      {kpiQuery.data ? <KpiStrip data={kpiQuery.data} /> : <QueryState error={kpiQuery.error as Error | null} />}

      <section className="panel rounded-[28px] p-5">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Classic Analytics</div>
          <p className="mt-2 text-sm text-slate-400">Restored core analytics views from the earlier dashboard, still powered by the current filter state.</p>
        </div>
      </section>

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

        {overview ? (
          <SectionCard title="Event Burst Distribution" subtitle="How often grouped events arrive as single captures versus longer bursts.">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={overview.burstDistribution}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="burstSize" stroke="#8ea6b1" />
                  <YAxis stroke="#8ea6b1" />
                  <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  <Bar dataKey="count" fill="#59a8ff" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}
      </div>

      <section className="panel rounded-[28px] p-5">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Operations & Intelligence</div>
          <p className="mt-2 text-sm text-slate-400">New additive sections built on the richer operational, telemetry, and raw-like event schema.</p>
        </div>
      </section>

      {overview ? <InsightList items={overview.insights} /> : null}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        {overview ? <CameraHealthTable rows={overview.cameraHealth} /> : <QueryState error={overviewQuery.error as Error | null} />}

        {overview ? (
          <div className="space-y-4">
            <SectionCard title="Pipeline Funnel" subtitle="How many grouped events have moved through upload, JSON extraction, and AI analysis.">
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={overview.processingFunnel}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="stage" stroke="#8ea6b1" />
                    <YAxis stroke="#8ea6b1" />
                    <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                    <Bar dataKey="count" fill="#73e0ae" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Stale Or Unhealthy Cameras" subtitle="Quick triage list for cameras that need follow-up.">
              <div className="space-y-3">
                {overview.staleCameras.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-emerald-200">No stale or unhealthy cameras in the current slice.</div>
                ) : (
                  overview.staleCameras.map((camera) => (
                    <div key={camera.cameraName} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{camera.cameraName}</div>
                          <div className="mt-1 text-sm text-slate-400">
                            Last seen {formatEventTimestamp(camera.lastSeen)} • {formatDurationShort((camera.lastSeenHoursAgo ?? 0) * 3600)} ago
                          </div>
                        </div>
                        <StatusBadge status={camera.status} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        {overview ? (
          <SectionCard title="Pipeline Lag Trend" subtitle="Average upload and processing delay over time.">
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={overview.lagTrend}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
                  <YAxis stroke="#8ea6b1" />
                  <Tooltip
                    contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                    formatter={(value: unknown) =>
                      typeof value === "number"
                        ? formatDurationShort(value)
                        : Array.isArray(value)
                          ? value.join(", ")
                          : String(value ?? "")
                    }
                  />
                  <Legend />
                  <Line type="monotone" dataKey="avgUploadLagSeconds" stroke="#ffcf66" dot={false} strokeWidth={2} name="Upload lag" />
                  <Line type="monotone" dataKey="avgAiLagSeconds" stroke="#59a8ff" dot={false} strokeWidth={2} name="AI lag" />
                  <Line type="monotone" dataKey="avgProcessingLagSeconds" stroke="#73e0ae" dot={false} strokeWidth={2} name="Processing lag" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}

        {overview ? (
          <SectionCard title="Telemetry Snapshot" subtitle="Power and environmental signals that are useful for operations.">
            <div className="grid gap-4">
              <div className="h-40">
                <ResponsiveContainer>
                  <LineChart data={overview.temperatureTrend}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
                    <YAxis stroke="#8ea6b1" />
                    <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                    <Legend />
                    <Line type="monotone" dataKey="avgTemperature" stroke="#ffcf66" dot={false} strokeWidth={2} name="Avg temperature" />
                    <Line type="monotone" dataKey="avgHeatLevel" stroke="#ff7c7c" dot={false} strokeWidth={2} name="Avg heat level" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Low-Light Split</div>
                  <div className="mt-3 space-y-2">
                    {overview.lightSplit.map((item) => (
                      <div key={item.bucket} className="flex items-center justify-between text-sm text-slate-200">
                        <span>{titleCase(item.bucket)}</span>
                        <span>{formatNumber(item.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Top Cameras By Volume</div>
                  <div className="mt-3 space-y-2">
                    {overview.topCameras.map((item) => (
                      <div key={item.cameraName} className="flex items-center justify-between text-sm text-slate-200">
                        <span>{item.cameraName}</span>
                        <span>{formatNumber(item.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        {overview ? (
          <SectionCard title="Voltage Trend By Camera" subtitle="Camera power trend, with one line per device.">
            <div className="h-80">
              <ResponsiveContainer>
                <LineChart data={overview.voltageTrend}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
                  <YAxis stroke="#8ea6b1" domain={["dataMin - 0.2", "dataMax + 0.2"]} />
                  <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  <Legend />
                  {Array.from(new Set(overview.voltageTrend.map((point) => point.cameraName))).slice(0, 5).map((cameraName, index) => (
                    <Line
                      key={cameraName}
                      dataKey={(row) => (row.cameraName === cameraName ? row.avgVoltage : null)}
                      name={cameraName}
                      type="monotone"
                      stroke={chartPalette[index % chartPalette.length]}
                      dot={false}
                      strokeWidth={1.8}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}

        {overview ? <NotableEventsList rows={overview.notableEvents} /> : <QueryState error={overviewQuery.error as Error | null} />}
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
