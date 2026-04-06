import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CameraHealthRow, ProcessingFunnelPoint } from "@grizcam/shared";
import { AppShell } from "../components/AppShell";
import { CameraHealthTable } from "../components/CameraHealthTable";
import { FilterBar } from "../components/FilterBar";
import { NotableEventsList } from "../components/NotableEventsList";
import { OpsKpiStrip } from "../components/OpsKpiStrip";
import { SectionCard } from "../components/SectionCard";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import {
  formatNumber,
  formatPercent,
  formatNullableNumber
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

  const lowestVoltageCameras = useMemo(() => {
    if (!overview) {
      return [];
    }

    return [...overview.cameraHealth]
      .filter((camera) => camera.avgVoltage !== null)
      .sort((a, b) => (a.avgVoltage ?? Number.POSITIVE_INFINITY) - (b.avgVoltage ?? Number.POSITIVE_INFINITY))
      .slice(0, 5);
  }, [overview]);

  return (
    <AppShell
      title="GrizCam Ops Dashboard"
      subtitle="Fleet health, pipeline status, and the cameras that need attention."
      badge={`${appEnv.demoLabel} • Operations`}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={patchFilters} onReset={resetFilters} />}
    >
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

      {overview ? <CameraHealthTable rows={overview.cameraHealth} /> : <QueryState error={overviewQuery.error as Error | null} />}

      <div className="grid gap-4 xl:grid-cols-2">
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

        {overview ? (
          <SectionCard title="Telemetry Snapshot" subtitle="Power diagnostics without the hard-to-read line chart.">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Avg Voltage</div>
                <div className="mt-3 text-3xl font-semibold text-white">{formatNullableNumber(overview.kpis.avgVoltage, 2, "v")}</div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Under 11.5v</div>
                <div className="mt-3 text-3xl font-semibold text-amber-300">
                  {formatNumber(overview.cameraHealth.filter((camera) => (camera.avgVoltage ?? Number.POSITIVE_INFINITY) < 11.5).length)}
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Lowest Voltage</div>
                <div className="mt-3 text-3xl font-semibold text-rose-300">
                  {lowestVoltageCameras[0]?.avgVoltage?.toFixed(2) ?? "N/A"}v
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {lowestVoltageCameras.map((camera) => (
                <div key={camera.cameraName} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div>
                    <div className="font-medium text-white">{camera.cameraName}</div>
                    <div className="mt-1 text-sm text-slate-400">{camera.alertReason ?? "Power reading available in current slice."}</div>
                  </div>
                  <div className="text-lg font-semibold text-white">{formatNullableNumber(camera.avgVoltage, 2, "v")}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <QueryState error={overviewQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-1">
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
    </AppShell>
  );
};
