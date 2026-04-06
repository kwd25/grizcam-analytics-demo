import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CameraHealthRow, ProcessingFunnelPoint } from "@grizcam/shared";
import { AppShell } from "../components/AppShell";
import { CameraHealthTable } from "../components/CameraHealthTable";
import { FilterBar } from "../components/FilterBar";
import { NotableEventsList } from "../components/NotableEventsList";
import { OpsKpiStrip } from "../components/OpsKpiStrip";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import {
  formatDurationShort,
  formatEventTimestamp,
  formatNumber,
  formatPercent
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
  const recentReporting = useMemo(() => {
    if (!overview) {
      return { within24h: 0, within48h: 0, total: 0 };
    }

    return {
      within24h: overview.cameraHealth.filter((camera) => (camera.lastSeenHoursAgo ?? Number.POSITIVE_INFINITY) <= 24).length,
      within48h: overview.cameraHealth.filter((camera) => (camera.lastSeenHoursAgo ?? Number.POSITIVE_INFINITY) <= 48).length,
      total: overview.cameraHealth.length
    };
  }, [overview]);

  const pipelineDropoff = useMemo(() => {
    const empty = {
      uploaded: { count: 0, conversionPct: 0, dropPct: 0 },
      json: { count: 0, conversionPct: 0, dropPct: 0 },
      ai: { count: 0, conversionPct: 0, dropPct: 0 }
    };

    if (!overview) {
      return empty;
    }

    const stageCount = (stage: string) =>
      overview.processingFunnel.find((point: ProcessingFunnelPoint) => point.stage === stage)?.count ?? 0;

    const captured = stageCount("captured");
    const uploaded = stageCount("uploaded");
    const json = stageCount("json_processed");
    const ai = stageCount("ai_processed");

    const ratio = (count: number, base: number) => (base > 0 ? count / base : 0);
    const drop = (count: number, base: number) => (base > 0 ? (base - count) / base : 0);

    return {
      uploaded: { count: uploaded, conversionPct: ratio(uploaded, captured), dropPct: drop(uploaded, captured) },
      json: { count: json, conversionPct: ratio(json, uploaded), dropPct: drop(json, uploaded) },
      ai: { count: ai, conversionPct: ratio(ai, json), dropPct: drop(ai, json) }
    };
  }, [overview]);

  const topRiskCameras = useMemo(() => {
    if (!overview) {
      return [];
    }

    const riskScore = (camera: CameraHealthRow) => {
      const staleHours = camera.lastSeenHoursAgo ?? 0;
      const processingLagHours = (camera.avgProcessingLagSeconds ?? 0) / 3600;
      const voltageGap = camera.avgVoltage !== null && camera.avgVoltage < 11.5 ? (11.5 - camera.avgVoltage) * 20 : 0;
      const statusPenalty = camera.status === "alert" ? 18 : camera.status === "warning" ? 8 : 0;
      return staleHours * 0.9 + processingLagHours * 6 + voltageGap + statusPenalty;
    };

    return [...overview.cameraHealth]
      .map((camera) => ({ ...camera, riskScore: Math.round(riskScore(camera)) }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 5);
  }, [overview]);

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
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Triage-first operations console for fleet status, pipeline bottlenecks, and the cameras that need follow-up now.
          </p>
        </div>
      </section>

      {overview ? <OpsKpiStrip data={overview} /> : <QueryState error={overviewQuery.error as Error | null} />}

      {overview ? (
        <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
          <SectionCard title="Reporting Recently" subtitle="Camera freshness counts for the current slice.">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Seen in 24h</div>
                <div className="mt-3 text-3xl font-semibold text-emerald-300">
                  {formatNumber(recentReporting.within24h)} <span className="text-lg text-slate-400">/ {formatNumber(recentReporting.total)}</span>
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Seen in 48h</div>
                <div className="mt-3 text-3xl font-semibold text-white">
                  {formatNumber(recentReporting.within48h)} <span className="text-lg text-slate-400">/ {formatNumber(recentReporting.total)}</span>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Pipeline Drop-Off" subtitle="Stage-by-stage conversion and loss from upload through JSON and AI completion.">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["Uploaded", pipelineDropoff.uploaded.count, pipelineDropoff.uploaded.conversionPct, pipelineDropoff.uploaded.dropPct],
                ["JSON", pipelineDropoff.json.count, pipelineDropoff.json.conversionPct, pipelineDropoff.json.dropPct],
                ["AI", pipelineDropoff.ai.count, pipelineDropoff.ai.conversionPct, pipelineDropoff.ai.dropPct]
              ].map(([label, count, conversionPct, dropPct]) => (
                <div key={String(label)} className="rounded-2xl bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
                  <div className="mt-3 text-3xl font-semibold text-white">{formatNumber(Number(count))}</div>
                  <div className="mt-2 text-sm text-slate-300">Conversion {formatPercent(Number(conversionPct), 0)}</div>
                  <div className="mt-1 text-sm text-amber-300">Drop-off {formatPercent(Number(dropPct), 0)}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      ) : (
        <QueryState error={overviewQuery.error as Error | null} />
      )}

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        {overview ? <CameraHealthTable rows={overview.cameraHealth} /> : <QueryState error={overviewQuery.error as Error | null} />}

        {overview ? (
          <div className="space-y-4">
            <SectionCard title="Needs Attention" subtitle="Fast triage list for stale or degraded cameras in the current slice.">
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
          <SectionCard title="Pipeline Lag Trend" subtitle="Primary bottleneck view for upload, AI, and end-to-end processing delay.">
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
          <SectionCard title="Pipeline Funnel" subtitle="Grouped events moving from upload through JSON extraction and AI analysis.">
            <div className="h-72">
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
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        {overview ? (
          <SectionCard title="Top Risk Cameras" subtitle="Ranked by stale reporting, processing lag, low voltage, and current status severity.">
            <div className="space-y-3">
              {topRiskCameras.map((camera) => (
                <div key={camera.cameraName} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{camera.cameraName}</div>
                      <div className="mt-1 text-sm text-slate-400">
                        Stale {formatDurationShort((camera.lastSeenHoursAgo ?? 0) * 3600)} • Lag {formatDurationShort(camera.avgProcessingLagSeconds)} • Voltage{" "}
                        {camera.avgVoltage?.toFixed(2) ?? "N/A"}v
                      </div>
                      {camera.alertReason ? <div className="mt-2 text-xs text-slate-500">{camera.alertReason}</div> : null}
                    </div>
                    <div className="text-right">
                      <StatusBadge status={camera.status} />
                      <div className="mt-2 text-sm font-semibold text-amber-300">Risk {formatNumber(camera.riskScore)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}

        {overview ? (
          <NotableEventsList
            rows={overview.notableEvents}
            title="Operational Outliers"
            subtitle="Recent events with elevated lag, degraded status, or other operator-relevant signals."
          />
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-1">
        {overview ? (
          <SectionCard title="Telemetry Snapshot" subtitle="Power signals only, kept lightweight for diagnosis rather than exploration.">
            <div className="grid gap-4">
              <div className="h-40">
                <ResponsiveContainer>
                  <LineChart data={overview.voltageTrend}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
                    <YAxis stroke="#8ea6b1" />
                    <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                    <Legend />
                    {Array.from(new Set(overview.voltageTrend.map((point) => point.cameraName))).slice(0, 5).map((cameraName, index) => (
                      <Line
                        key={cameraName}
                        dataKey={(row) => (row.cameraName === cameraName ? row.avgVoltage : null)}
                        name={cameraName}
                        type="monotone"
                        stroke={["#73e0ae", "#59a8ff", "#ffcf66", "#ff7c7c", "#6ee7f9"][index % 5]}
                        dot={false}
                        strokeWidth={1.8}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}
      </div>
    </AppShell>
  );
};
