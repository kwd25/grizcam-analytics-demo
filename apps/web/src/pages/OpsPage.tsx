import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "../components/AppShell";
import { CameraHealthTable } from "../components/CameraHealthTable";
import { FilterBar } from "../components/FilterBar";
import { InsightList } from "../components/InsightList";
import { NotableEventsList } from "../components/NotableEventsList";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import {
  formatDurationShort,
  formatEventTimestamp,
  formatNumber,
  titleCase
} from "../lib/utils";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

const QueryState = ({ error }: { error?: Error | null }) => (
  <div className="panel rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center">
    <div className="text-sm font-medium text-white">{error ? "This section is temporarily unavailable" : "Loading operations section"}</div>
    <div className="mt-2 text-sm text-slate-400">
      {error ? "The operations dashboard hit an unexpected response. Try refreshing in a moment." : "Loading fleet health, pipeline, and telemetry analytics."}
    </div>
  </div>
);

export const OpsPage = () => {
  const { filters, patchFilters, resetFilters } = useDashboardFilters();
  const stableFilters = useMemo(() => filters, [filters]);

  const optionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });
  const overviewQuery = useQuery({ queryKey: ["overview", stableFilters], queryFn: () => api.overview(stableFilters) });

  const overview = overviewQuery.data;

  return (
    <AppShell
      title="GrizCam Ops Dashboard"
      subtitle="Fleet health, processing pipeline, telemetry, and notable operational events from the richer raw-like event stream."
      badge={`${appEnv.demoLabel} • Operations`}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={patchFilters} onReset={resetFilters} />}
    >
      <section className="panel rounded-[28px] p-5">
        <div className="mb-4">
          <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Operations</div>
          <p className="mt-2 text-sm text-slate-400">Focused operational analytics, separated from the classic overview so the main dashboard loads faster.</p>
        </div>
      </section>

      {overview ? <InsightList items={overview.insights} /> : <QueryState error={overviewQuery.error as Error | null} />}

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
                      stroke={["#73e0ae", "#59a8ff", "#ffcf66", "#ff7c7c", "#b08cff", "#6ee7f9"][index % 6]}
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

      <div className="grid gap-4 xl:grid-cols-2">
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
    </AppShell>
  );
};
