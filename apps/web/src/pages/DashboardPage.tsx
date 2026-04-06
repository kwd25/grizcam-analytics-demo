import { useQuery } from "@tanstack/react-query";
import { defaultDashboardFilters, type EventQuery } from "@grizcam/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
import { NotableEventsList } from "../components/NotableEventsList";
import { OverviewKpiStrip } from "../components/OverviewKpiStrip";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
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
  const categoryTrendRows =
    overview?.categoryTrend.map((row) => ({
      ...row,
      total: row.wildlife + row.human + row.vehicle + row.emptyScene + row.unknown
    })) ?? [];

  return (
    <AppShell
      title="GrizCam Operations Dashboard"
      subtitle="Executive overview of fleet health, event activity, pipeline performance, and notable detections from the richer synthetic/raw-like event stream."
      badge={appEnv.demoLabel}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={onFilterChange} onReset={onReset} />}
    >
      {overview ? <OverviewKpiStrip data={overview.kpis} /> : <QueryState error={overviewQuery.error as Error | null} />}

      {overview ? <InsightList items={overview.insights} /> : null}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        {overview ? (
          <SectionCard title="Event Trend" subtitle="Grouped event volume by day and category. Click a day to drill into the underlying events.">
            <div className="h-80">
              <ResponsiveContainer>
                <ComposedChart data={categoryTrendRows} onClick={(state) => state?.activeLabel && setSelectedDate(String(state.activeLabel))}>
                  <defs>
                    <linearGradient id="dash-total" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#73e0ae" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#73e0ae" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
                  <YAxis stroke="#8ea6b1" />
                  <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  <Legend />
                  <Area type="monotone" dataKey="total" stroke="#73e0ae" fill="url(#dash-total)" strokeWidth={2} name="Total" />
                  <Line type="monotone" dataKey="wildlife" stroke="#59a8ff" dot={false} strokeWidth={1.6} name="Wildlife" />
                  <Line type="monotone" dataKey="human" stroke="#ffcf66" dot={false} strokeWidth={1.6} name="Human" />
                  <Line type="monotone" dataKey="vehicle" stroke="#ff7c7c" dot={false} strokeWidth={1.6} name="Vehicle" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}

        <DayDetailPanel selectedDate={selectedDate} data={daySummaryQuery.data} />
      </div>

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

      <div className="grid gap-4 xl:grid-cols-2">
        {overview ? (
          <SectionCard title="Category Mix" subtitle="What the cameras are seeing across the current selection.">
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={overview.categoryDistribution} dataKey="count" nameKey="category" innerRadius={54} outerRadius={88} paddingAngle={3}>
                      {overview.categoryDistribution.map((entry, index) => (
                        <Cell key={entry.category} fill={chartPalette[index % chartPalette.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3">
                {overview.categoryDistribution.map((item, index) => (
                  <div key={item.category} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: chartPalette[index % chartPalette.length] }} />
                      <span className="text-sm text-slate-200">{titleCase(item.category)}</span>
                    </div>
                    <span className="text-sm text-slate-400">{formatNumber(item.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}

        {overview ? (
          <SectionCard title="Hourly Activity" subtitle="When detections are happening, broken out by category.">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={overview.hourlyActivity}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="hour" stroke="#8ea6b1" />
                  <YAxis stroke="#8ea6b1" />
                  <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  <Legend />
                  <Bar dataKey="wildlife" stackId="hour" fill="#59a8ff" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="human" stackId="hour" fill="#ffcf66" />
                  <Bar dataKey="vehicle" stackId="hour" fill="#ff7c7c" />
                  <Bar dataKey="emptyScene" stackId="hour" fill="#6ee7f9" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
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
