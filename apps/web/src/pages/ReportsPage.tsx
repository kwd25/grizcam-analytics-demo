import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AppShell } from "../components/AppShell";
import { FilterBar } from "../components/FilterBar";
import { SectionCard } from "../components/SectionCard";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import { classNames, formatDurationShort, formatNullableNumber, formatNumber, titleCase } from "../lib/utils";
import { useDashboardFilters } from "../hooks/useDashboardFilters";
import { useReportPrefetch } from "../hooks/useReportPrefetch";

const statusPillClass = {
  ready: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  generating: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  stale: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  error: "border-rose-400/20 bg-rose-400/10 text-rose-100"
} as const;

const QueryState = ({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) => (
  <div className="panel rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center">
    <div className="text-sm font-medium text-white">{title}</div>
    <div className="mt-2 text-sm text-slate-400">{detail}</div>
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);

const actionButtonClass =
  "rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60";

export const ReportsPage = () => {
  const { filters, patchFilters, resetFilters } = useDashboardFilters();
  useReportPrefetch(filters);
  const stableFilters = useMemo(() => filters, [filters]);

  const optionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });
  const reportQuery = useQuery({
    queryKey: ["reports", stableFilters],
    queryFn: () => api.latestReport(stableFilters),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "generating" || status === "stale" ? 2500 : false;
    }
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api.triggerReportGeneration(stableFilters, true),
    onSuccess: async () => {
      await reportQuery.refetch();
    }
  });

  const reportState = reportQuery.data;
  const activeRecord = reportState?.status === "stale" ? reportState.stale ?? reportState.latest : reportState?.latest;
  const snapshot = activeRecord?.snapshot;
  const report = activeRecord?.report;
  const isRefreshing = reportState?.status === "stale" || regenerateMutation.isPending;

  return (
    <AppShell
      title="Reports"
      subtitle="Operational briefings synthesized from the existing analytics stack, generated in the background for the current filter state."
      badge={`${appEnv.demoLabel} • Briefings`}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={patchFilters} onReset={resetFilters} />}
    >
      {!reportState && reportQuery.isLoading ? (
        <QueryState title="Preparing operational briefing" detail="Selecting the highest-signal analytics and checking the report cache for this filter state." />
      ) : reportQuery.error ? (
        <QueryState
          title="Report service unavailable"
          detail={(reportQuery.error as Error).message || "The reports endpoint returned an unexpected response."}
          action={
            <button type="button" className={actionButtonClass} onClick={() => void reportQuery.refetch()}>
              Retry
            </button>
          }
        />
      ) : report ? (
        <>
          <SectionCard
            title={report.headline}
            subtitle={
              snapshot
                ? `${snapshot.dateRange.startDate} to ${snapshot.dateRange.endDate} • ${snapshot.filters.camera_name.length || "All"} camera scope`
                : "Generated from the current analytics slice."
            }
            actions={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className={classNames("rounded-2xl border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em]", statusPillClass[reportState?.status ?? "ready"])}>
                  {reportState?.status === "stale" ? "Refreshing" : reportState?.status ?? "ready"}
                </div>
                <button
                  type="button"
                  className={actionButtonClass}
                  onClick={() => regenerateMutation.mutate()}
                  disabled={regenerateMutation.isPending}
                >
                  {regenerateMutation.isPending ? "Regenerating…" : "Regenerate report"}
                </button>
              </div>
            }
          >
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                {report.executive_summary.map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-slate-200">
                    {item}
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {(snapshot?.overviewMetrics ?? []).slice(0, 4).map((metric) => (
                  <div key={metric.label} className="rounded-2xl bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{metric.label}</div>
                    <div className="mt-3 text-3xl font-semibold text-white">
                      {metric.value === null ? "N/A" : `${formatNumber(metric.value, metric.unit === "%" ? 1 : 0)}${metric.unit ?? ""}`}
                    </div>
                    {metric.note ? <div className="mt-2 text-sm text-slate-400">{metric.note}</div> : null}
                  </div>
                ))}
              </div>
            </div>

            {isRefreshing ? (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                Showing the most recent compatible report while a fresh briefing is being generated for the current analytics state.
              </div>
            ) : null}
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Key Findings" subtitle="Grounded observations with evidence and explicit actionability.">
              <div className="space-y-3">
                {report.key_findings.map((finding) => (
                  <div key={finding.title} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-white">{finding.title}</div>
                      <div className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] text-slate-300">
                        {finding.confidence} confidence
                      </div>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-300">
                      {finding.evidence.map((item) => (
                        <div key={item} className="rounded-2xl bg-white/5 px-3 py-2">{item}</div>
                      ))}
                    </div>
                    <div className="mt-3 text-sm text-emerald-200">Actionability: {finding.actionability}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Recommended Actions" subtitle="Prioritized next steps for an operator or manager.">
              <div className="space-y-3">
                {report.recommended_actions.map((item) => (
                  <div key={`${item.priority}-${item.action}`} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-400/15 text-sm font-semibold text-emerald-100">
                        P{item.priority}
                      </div>
                      <div className="text-sm font-semibold text-white">{item.action}</div>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-slate-300">{item.why}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Risks And Watchouts" subtitle="Operational concerns to keep on the radar.">
              <div className="space-y-3">
                {report.risks_or_watchouts.length > 0 ? (
                  report.risks_or_watchouts.map((item) => (
                    <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">{item.impact}</div>
                      <div className="mt-3 text-sm text-amber-200">Follow-up: {item.suggested_followup}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/5 px-4 py-4 text-sm text-slate-400">No additional watchouts were elevated for this slice beyond the main findings.</div>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Open Questions" subtitle="Unknowns worth resolving before stronger action is taken.">
              <div className="space-y-3">
                {report.open_questions.length > 0 ? (
                  report.open_questions.map((item) => (
                    <div key={item} className="rounded-2xl bg-white/5 px-4 py-3 text-sm leading-6 text-slate-300">
                      {item}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/5 px-4 py-4 text-sm text-slate-400">No open questions were called out in the latest briefing.</div>
                )}
              </div>
            </SectionCard>
          </div>

          {snapshot ? (
            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <SectionCard title="Why The Model Said This" subtitle="Compact evidence bundle selected from existing analytics, not raw event dumps.">
                <div className="space-y-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Pipeline</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {snapshot.pipeline.map((item) => (
                        <div key={item.label} className="rounded-2xl bg-white/5 px-3 py-3">
                          <div className="text-sm font-medium text-white">{item.label}</div>
                          <div className="mt-1 text-lg font-semibold text-slate-100">
                            {item.value === null ? "N/A" : `${formatNumber(item.value, item.unit === "%" ? 1 : 0)}${item.unit ?? ""}`}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">{item.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Data Quality Caveats</div>
                    <div className="mt-2 space-y-2">
                      {snapshot.dataQualityCaveats.length > 0 ? (
                        snapshot.dataQualityCaveats.map((item) => (
                          <div key={item} className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-slate-300">{item}</div>
                        ))
                      ) : (
                        <div className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-slate-400">No material data quality caveats were elevated for this slice.</div>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Operational Signals" subtitle="Top movers, at-risk cameras, and trend notes selected for the report prompt.">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">At-Risk Cameras</div>
                    {(snapshot.atRiskCameras.length > 0 ? snapshot.atRiskCameras : snapshot.topCameras).map((item) => (
                      <div key={item.name} className="rounded-2xl bg-white/5 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-white">{item.name}</div>
                          {item.status ? <div className="text-xs uppercase tracking-[0.14em] text-amber-200">{titleCase(item.status)}</div> : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-400">{item.detail}</div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Trend Notes</div>
                    {snapshot.trends.map((trend) => (
                      <div key={trend.label} className="rounded-2xl bg-white/5 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-white">{trend.label}</div>
                          <div className="text-sm font-semibold text-slate-200">
                            {trend.deltaPct === null ? "N/A" : `${trend.deltaPct > 0 ? "+" : ""}${formatNumber(trend.deltaPct, 1)}%`}
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-slate-400">{trend.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </SectionCard>
            </div>
          ) : null}
        </>
      ) : (
        <QueryState
          title={reportState?.status === "error" ? "Report generation failed" : "Generating operational briefing"}
          detail={
            reportState?.latest?.error
              ? reportState.latest.error
              : "A background report is being prepared from the current analytics slice. If a cached match exists, it will appear here automatically."
          }
          action={
            <button
              type="button"
              className={actionButtonClass}
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
            >
              {regenerateMutation.isPending ? "Regenerating…" : "Generate report"}
            </button>
          }
        />
      )}

      {snapshot ? (
        <SectionCard title="Snapshot Context" subtitle="Filter-aware summary of the analytics state used for this report.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Date Range</div>
              <div className="mt-2 text-sm text-white">{snapshot.dateRange.startDate} to {snapshot.dateRange.endDate}</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Camera Filter</div>
              <div className="mt-2 text-sm text-white">{snapshot.filters.camera_name.length > 0 ? `${snapshot.filters.camera_name.length} selected` : "All cameras"}</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Average Voltage</div>
              <div className="mt-2 text-sm text-white">{formatNullableNumber(snapshot.overviewMetrics.find((item) => item.label === "Avg voltage")?.value ?? null, 2, "v")}</div>
            </div>
            <div className="rounded-2xl bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Avg Processing Lag</div>
              <div className="mt-2 text-sm text-white">
                {formatDurationShort(snapshot.overviewMetrics.find((item) => item.label === "Avg processing lag")?.value ?? null)}
              </div>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </AppShell>
  );
};
