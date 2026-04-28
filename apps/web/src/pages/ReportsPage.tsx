import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildReportSnapshot, type ReportRecord, type ReportSourceBundle } from "@grizcam/shared";
import type { ReportPhase, ReportViewStatus } from "@grizcam/shared";
import { AppShell } from "../components/AppShell";
import { FilterBar } from "../components/FilterBar";
import { SectionCard } from "../components/SectionCard";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import { classNames, formatDurationShort, formatNullableNumber, formatNumber, titleCase } from "../lib/utils";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

const statusPillClass: Record<ReportViewStatus, string> = {
  idle: "border-white/10 bg-white/5 text-slate-200",
  ready: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  generating: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  stale: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  error: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  disabled: "border-slate-400/20 bg-slate-400/10 text-slate-200"
};

const phaseLabel: Record<ReportPhase, string> = {
  idle: "Idle",
  disabled: "Disabled",
  queued: "Queued",
  building_snapshot: "Loading inputs",
  calling_model: "Generating briefing",
  validating_response: "Validating response",
  ready: "Ready",
  error: "Failed"
};

const phaseDescription: Record<ReportPhase, string> = {
  idle: "The Overview and Advanced analytics inputs are loaded and ready to generate a report.",
  disabled: "Report generation is unavailable until OpenRouter is configured on the server.",
  queued: "The report request has been accepted and is waiting to start.",
  building_snapshot: "Loading the required analytics inputs for the current filter state.",
  calling_model: "Sending the compact analytics bundle to OpenRouter to generate the briefing.",
  validating_response: "The model response is being validated and repaired into the required JSON shape if needed.",
  ready: "The latest generated report is ready.",
  error: "The latest report attempt failed."
};

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
  const stableFilters = useMemo(() => filters, [filters]);
  const inputLoadStartedAt = useRef(Date.now());
  const [inputLoadMs, setInputLoadMs] = useState<number | null>(null);
  const [generatedReport, setGeneratedReport] = useState<ReportRecord | null>(null);
  const [reportStatus, setReportStatus] = useState<ReportViewStatus>("idle");
  const [reportPhase, setReportPhase] = useState<ReportPhase>("building_snapshot");
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [reportRequestId, setReportRequestId] = useState<string | null>(null);
  const [reportErrorCode, setReportErrorCode] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });
  const healthQuery = useQuery({
    queryKey: ["report-health"],
    queryFn: api.reportHealth,
    staleTime: 30_000
  });
  const overviewQuery = useQuery({
    queryKey: ["reports-overview", stableFilters],
    queryFn: () => api.overview(stableFilters)
  });
  const analyticsQuery = useQuery({
    queryKey: ["reports-analytics-lab", stableFilters],
    queryFn: () => api.analyticsLab(stableFilters)
  });

  useEffect(() => {
    inputLoadStartedAt.current = Date.now();
    setInputLoadMs(null);
    setGeneratedReport(null);
    setReportStatus("idle");
    setReportPhase("building_snapshot");
    setReportReason(null);
    setReportRequestId(null);
    setReportErrorCode(null);
  }, [stableFilters]);

  const inputError = (overviewQuery.error as Error | null) ?? (analyticsQuery.error as Error | null);
  const inputErrorLabel = overviewQuery.error ? "Overview analytics failed to load." : analyticsQuery.error ? "Advanced analytics failed to load." : null;
  const inputErrorMessage = inputError ? `${inputErrorLabel ?? "Analytics inputs failed to load."} ${inputError.message}` : null;
  const inputsLoading = overviewQuery.isLoading || analyticsQuery.isLoading;
  const inputsReady = Boolean(overviewQuery.data && analyticsQuery.data && !inputError);

  useEffect(() => {
    if (inputsReady && inputLoadMs === null) {
      setInputLoadMs(Date.now() - inputLoadStartedAt.current);
      setReportPhase("idle");
    }
  }, [inputLoadMs, inputsReady]);

  useEffect(() => {
    if (inputErrorMessage) {
      setReportStatus("error");
      setReportPhase("building_snapshot");
      setReportReason(inputErrorMessage);
      setReportErrorCode("REPORT_INPUT_UNAVAILABLE");
    }
  }, [inputErrorMessage]);

  const snapshot: ReportSourceBundle | null = useMemo(() => {
    if (!overviewQuery.data || !analyticsQuery.data) {
      return null;
    }

    return buildReportSnapshot(stableFilters, overviewQuery.data, analyticsQuery.data);
  }, [analyticsQuery.data, overviewQuery.data, stableFilters]);

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!snapshot) {
        throw new Error(inputErrorMessage ?? "Analytics inputs are not ready yet.");
      }
      return api.triggerReportGeneration(stableFilters, snapshot, true);
    },
    onMutate: () => {
      setReportStatus("generating");
      setReportPhase("calling_model");
      setReportReason(null);
      setReportRequestId(null);
      setReportErrorCode(null);
    },
    onSuccess: (result) => {
      setGeneratedReport(result.report ?? null);
      setReportStatus(result.status);
      setReportPhase(result.phase);
      setReportReason(result.reason ?? null);
      setReportRequestId(result.requestId ?? result.report?.debug?.requestId ?? null);
      setReportErrorCode(result.errorCode ?? result.report?.debug?.lastErrorCode ?? null);
    },
    onError: (error) => {
      setGeneratedReport(null);
      setReportStatus("error");
      setReportPhase("error");
      setReportReason(error instanceof Error ? error.message : "Report generation failed.");
      setReportRequestId(null);
      setReportErrorCode(null);
    }
  });

  const visibleStatus = generateMutation.isPending ? "generating" : reportStatus;
  const visiblePhase = generateMutation.isPending ? "calling_model" : reportPhase;
  const visibleReason = inputErrorMessage ?? reportReason ?? (!healthQuery.data?.openRouterConfigured ? "OPENROUTER_API_KEY is not configured on the server." : null);
  const timingMs = generatedReport?.debug?.timingMs ?? {};
  const generatedBriefing = generatedReport?.report ?? null;
  const diagnosticEntries = [
    { label: "Input load", value: inputLoadMs, unit: "ms" },
    { label: "Storage check", value: timingMs.storageCheck, unit: "ms" },
    { label: "Model request", value: timingMs.modelRequest, unit: "ms" },
    { label: "Validation", value: timingMs.validation, unit: "ms" },
    { label: "Persistence", value: timingMs.persistence, unit: "ms" },
    { label: "Total", value: timingMs.total, unit: "ms" },
    { label: "Snapshot size", value: timingMs.snapshotBytes, unit: "bytes" },
    { label: "Prompt chars", value: timingMs.promptChars, unit: "chars" }
  ].filter((entry): entry is { label: string; value: number; unit: string } => typeof entry.value === "number");
  const canGenerate = Boolean(snapshot) && !inputsLoading && !inputError && !generateMutation.isPending && healthQuery.data?.openRouterConfigured !== false;
  const hasStorageWarning = healthQuery.data && !healthQuery.data.reportsEnabled && healthQuery.data.supportsEphemeralGeneration;
  const storageWarningDetail = healthQuery.data?.reportsFailureReason ?? "You can still generate a report manually from the loaded analytics inputs.";
  const visibleRequestId = reportRequestId ?? generatedReport?.debug?.requestId ?? null;
  const visibleErrorCode = reportErrorCode ?? generatedReport?.debug?.lastErrorCode ?? null;

  return (
    <AppShell
      title="Reports"
      subtitle="Operational briefings synthesized from the existing analytics stack, generated after the current analytics inputs are loaded."
      badge={`${appEnv.demoLabel} • Briefings`}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={patchFilters} onReset={resetFilters} />}
    >
      {hasStorageWarning ? (
        <div className="rounded-3xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
          Persistent report storage is unavailable. {storageWarningDetail} Manual generation will use the loaded analytics inputs without waiting on storage.
        </div>
      ) : null}

      {healthQuery.data && !healthQuery.data.openRouterConfigured ? (
        <div className="rounded-3xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          Report generation is disabled because `OPENROUTER_API_KEY` is not configured on the server.
        </div>
      ) : null}

      {inputsLoading ? (
        <QueryState title="Loading report inputs" detail="Fetching Overview and Advanced analytics for the current filter state before report generation is enabled." />
      ) : inputError ? (
        <QueryState
          title="Report inputs failed to load"
          detail={inputErrorMessage ?? "Analytics inputs failed to load."}
          action={
            <button type="button" className={actionButtonClass} onClick={() => {
              void overviewQuery.refetch();
              void analyticsQuery.refetch();
            }}>
              Retry loading inputs
            </button>
          }
        />
      ) : generatedBriefing ? (
        <>
          <SectionCard
            title={generatedBriefing.headline}
            subtitle={`${snapshot?.dateRange.startDate ?? ""} to ${snapshot?.dateRange.endDate ?? ""} • ${snapshot?.filters.camera_name.length || "All"} camera scope`}
            actions={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className={classNames("rounded-2xl border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em]", statusPillClass[visibleStatus])}>
                  {visibleStatus}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-200">
                  {phaseLabel[visiblePhase]}
                </div>
                <button type="button" className={actionButtonClass} onClick={() => generateMutation.mutate()} disabled={!canGenerate}>
                  {generateMutation.isPending ? "Generating…" : "Regenerate report"}
                </button>
              </div>
            }
          >
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                {generatedBriefing.executive_summary.map((item) => (
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

            {visibleReason && visibleStatus === "error" ? (
              <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {visibleReason}
              </div>
            ) : null}
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Key Findings" subtitle="Grounded observations with evidence and explicit actionability.">
              <div className="space-y-3">
                {generatedBriefing.key_findings.map((finding) => (
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
                {generatedBriefing.recommended_actions.map((item) => (
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
                {generatedBriefing.risks_or_watchouts.length > 0 ? (
                  generatedBriefing.risks_or_watchouts.map((item) => (
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
                {generatedBriefing.open_questions.length > 0 ? (
                  generatedBriefing.open_questions.map((item) => (
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
        </>
      ) : (
        <QueryState
          title={visibleStatus === "error" ? "Report generation failed" : "Ready to generate operational briefing"}
          detail={
            visibleStatus === "error"
              ? visibleReason ?? phaseDescription.error
              : "Overview and Advanced analytics inputs are loaded. Generate a compact, grounded report from the current filter state."
          }
          action={
            <button type="button" className={actionButtonClass} onClick={() => generateMutation.mutate()} disabled={!canGenerate}>
              {generateMutation.isPending ? "Generating…" : inputsReady ? "Generate report" : "Loading analytics inputs…"}
            </button>
          }
        />
      )}

      <SectionCard title="Generation Status" subtitle="Current analytics input and report-generation diagnostics.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Status</div>
            <div className="mt-2 text-sm text-white">{titleCase(visibleStatus)}</div>
          </div>
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Phase</div>
            <div className="mt-2 text-sm text-white">{phaseLabel[visiblePhase]}</div>
          </div>
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Reports Cache Key</div>
            <div className="mt-2 text-sm text-white">{generatedReport?.snapshotHash ? `${generatedReport.snapshotHash.slice(0, 12)}…` : "Not available yet"}</div>
          </div>
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Latest Error</div>
            <div className="mt-2 text-sm text-white">{generatedReport?.debug?.lastErrorMessage ?? visibleReason ?? "None"}</div>
          </div>
        </div>

        {visibleRequestId || visibleErrorCode ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Request ID</div>
              <div className="mt-2 text-sm text-white">{visibleRequestId ?? "Not available"}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Error Code</div>
              <div className="mt-2 text-sm text-white">{visibleErrorCode ?? "None"}</div>
            </div>
          </div>
        ) : null}

        {diagnosticEntries.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {diagnosticEntries.map(({ label, value, unit }) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{label}</div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {formatNumber(value, 0)}
                  {unit === "ms" ? "ms" : ` ${unit}`}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>

      {snapshot ? (
        <>
          <SectionCard title="Snapshot Context" subtitle="Compact analytics bundle that will be sent to the report model.">
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

          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <SectionCard title="Overview Signals" subtitle="Summary inputs from the current Overview and Ops analytics state.">
              <div className="space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Overview Highlights</div>
                  <div className="mt-2 space-y-2">
                    {snapshot.overviewHighlights.map((item) => (
                      <div key={item.name} className="rounded-2xl bg-white/5 px-3 py-3">
                        <div className="text-sm font-medium text-white">{item.name}</div>
                        <div className="mt-2 text-sm text-slate-400">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

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
              </div>
            </SectionCard>

            <SectionCard title="Advanced Signals" subtitle="Compact evidence selected for report generation, not raw chart dumps.">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Ops Highlights</div>
                  {snapshot.opsHighlights.map((item) => (
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
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Advanced Highlights</div>
                  {snapshot.advancedHighlights.map((item) => (
                    <div key={item.name} className="rounded-2xl bg-white/5 px-3 py-3">
                      <div className="text-sm font-medium text-white">{item.name}</div>
                      <div className="mt-2 text-sm text-slate-400">{item.detail}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Data Quality Caveats</div>
                  {(snapshot.dataQualityCaveats.length > 0 ? snapshot.dataQualityCaveats : ["No material data quality caveats were elevated for this slice."]).map((item) => (
                    <div key={item} className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-slate-300">{item}</div>
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
        </>
      ) : null}
    </AppShell>
  );
};
