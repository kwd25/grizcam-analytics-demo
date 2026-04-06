import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { AppShell } from "../components/AppShell";
import { FilterBar } from "../components/FilterBar";
import { Heatmap } from "../components/charts/Heatmap";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import {
  formatDurationShort,
  formatNumber,
  formatNullableNumber,
  formatSignedNumber,
  titleCase
} from "../lib/utils";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

const QueryState = ({ error }: { error?: Error | null }) => (
  <div className="panel rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center">
    <div className="text-sm font-medium text-white">{error ? "This section is temporarily unavailable" : "Loading analytics section"}</div>
    <div className="mt-2 text-sm text-slate-400">
      {error ? "The analytics endpoint returned an unexpected response. Try refreshing in a moment." : "Crunching deeper anomaly and readiness signals."}
    </div>
  </div>
);

export const AnalyticsLabPage = () => {
  const { filters, patchFilters, resetFilters } = useDashboardFilters();
  const stableFilters = useMemo(() => filters, [filters]);
  const optionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });
  const analyticsQuery = useQuery({ queryKey: ["analytics-lab", stableFilters], queryFn: () => api.analyticsLab(stableFilters) });

  const analytics = analyticsQuery.data;
  const hourRows = Array.from(new Set(analytics?.hourCategoryHeatmap.map((item) => String(item.row)) ?? []));
  const hourColumns = Array.from(new Set(analytics?.hourCategoryHeatmap.map((item) => String(item.column)) ?? []));
  const cameraRows = Array.from(new Set(analytics?.cameraCategoryHeatmap.map((item) => String(item.row)) ?? []));
  const cameraColumns = Array.from(new Set(analytics?.cameraCategoryHeatmap.map((item) => String(item.column)) ?? []));

  return (
    <AppShell
      title="Analytics Lab"
      subtitle="Deeper exploratory analysis, anomaly scoring, baseline forecasting, camera similarity views, and data-quality checks for future ML work."
      badge={`${appEnv.demoLabel} • Advanced views`}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={patchFilters} onReset={resetFilters} />}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        {analytics ? (
          <Heatmap
            title="Hour x Category Heatmap"
            subtitle="Grouped event volume by hour of day and normalized category."
            rows={hourRows}
            columns={hourColumns}
            variant="subject"
            data={analytics.hourCategoryHeatmap.map((item) => ({ row: String(item.row), column: String(item.column), value: item.count }))}
          />
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}

        {analytics ? (
          <Heatmap
            title="Camera x Category Heatmap"
            subtitle="How each camera's category mix differs from the rest of the fleet."
            rows={cameraRows}
            columns={cameraColumns}
            variant="subject"
            data={analytics.cameraCategoryHeatmap.map((item) => ({ row: String(item.row), column: String(item.column), value: item.count }))}
          />
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        {analytics ? (
          <SectionCard title="Expected vs Actual Volume" subtitle="Baseline forecast using trailing daily averages, ready to swap for a stronger forecasting model later.">
            <div className="h-80">
              <ResponsiveContainer>
                <LineChart data={analytics.forecast}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
                  <YAxis stroke="#8ea6b1" />
                  <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="#73e0ae" dot={false} strokeWidth={2} name="Actual" />
                  <Line type="monotone" dataKey="expected" stroke="#59a8ff" dot={false} strokeWidth={2} name="Expected" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}

        {analytics ? (
          <SectionCard title="Anomaly Timeline" subtitle="Rule/statistics-based anomaly count and severity over time.">
            <div className="h-80">
              <ResponsiveContainer>
                <ComposedChart data={analytics.anomalyTimeline}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
                  <YAxis yAxisId="left" stroke="#8ea6b1" />
                  <YAxis yAxisId="right" orientation="right" stroke="#8ea6b1" />
                  <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="anomalyCount" fill="#ff7c7c" radius={[8, 8, 0, 0]} name="Anomaly count" />
                  <Line yAxisId="right" type="monotone" dataKey="avgAnomalyScore" stroke="#ffcf66" dot={false} strokeWidth={2} name="Avg anomaly score" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {analytics ? (
          <SectionCard title="Camera Anomalies" subtitle="Health and anomaly scores combine stale behavior, lag, completion gaps, and suspicious telemetry.">
            <div className="overflow-auto rounded-2xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-950/90 text-slate-400">
                  <tr>
                    <th className="px-3 py-3">Camera</th>
                    <th className="px-3 py-3">Anomaly</th>
                    <th className="px-3 py-3">Health</th>
                    <th className="px-3 py-3">Avg Lag</th>
                    <th className="px-3 py-3">Low Volt</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.cameraAnomalies.map((row) => (
                    <tr key={row.cameraName} className="border-t border-white/5 text-slate-200">
                      <td className="px-3 py-3 font-medium">{row.cameraName}</td>
                      <td className="px-3 py-3">{formatNumber(row.anomalyScore)}</td>
                      <td className="px-3 py-3">{formatNumber(row.healthScore)}</td>
                      <td className="px-3 py-3">{formatDurationShort(row.avgLagSeconds)}</td>
                      <td className="px-3 py-3">{formatNumber(row.lowVoltageRatePct, 1)}%</td>
                      <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}

        {analytics ? (
          <SectionCard title="Camera Clusters" subtitle="Heuristic similarity groups that can later be replaced with real clustering outputs.">
            <div className="space-y-3">
              {analytics.cameraClusters.map((cluster) => (
                <div key={cluster.cameraName} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{cluster.cameraName}</div>
                      <div className="mt-1 text-sm text-slate-400">{cluster.cluster} • {titleCase(cluster.similarityLabel)}</div>
                    </div>
                    <StatusBadge status={cluster.anomalyScore >= 55 ? "alert" : cluster.anomalyScore >= 35 ? "warning" : "healthy"} />
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-300">{cluster.rationale}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        {analytics ? (
          <SectionCard title="Burst Behavior" subtitle="Sequence behavior by camera, useful for burst-sensitive tuning and alerting.">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={analytics.burstBehavior}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="cameraName" stroke="#8ea6b1" angle={-16} textAnchor="end" height={72} interval={0} />
                  <YAxis stroke="#8ea6b1" />
                  <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                  <Legend />
                  <Bar dataKey="avgBurstSize" fill="#73e0ae" radius={[8, 8, 0, 0]} name="Avg burst" />
                  <Bar dataKey="p95BurstSize" fill="#59a8ff" radius={[8, 8, 0, 0]} name="P95 burst" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}

        {analytics ? (
          <SectionCard title="Environmental Context" subtitle="How category mix varies with light and environmental conditions.">
            <div className="h-72">
              <ResponsiveContainer>
                <ScatterChart>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="avgLux" stroke="#8ea6b1" name="Avg lux" />
                  <YAxis dataKey="avgTemperature" stroke="#8ea6b1" name="Avg temperature" />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                    formatter={(value: unknown) =>
                      typeof value === "number"
                        ? formatNumber(value, 1)
                        : Array.isArray(value)
                          ? value.join(", ")
                          : String(value ?? "")
                    }
                    labelFormatter={(_, payload) => titleCase(String(payload?.[0]?.payload?.category ?? ""))}
                  />
                  <Scatter data={analytics.environmentalContext} fill="#73e0ae" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {analytics.environmentalContext.map((item) => (
                <div key={item.category} className="rounded-2xl bg-white/5 p-4">
                  <div className="text-sm font-medium text-white">{titleCase(item.category)}</div>
                  <div className="mt-2 text-xs text-slate-400">Lux {formatNullableNumber(item.avgLux, 1)}</div>
                  <div className="mt-1 text-xs text-slate-400">Temp {formatNullableNumber(item.avgTemperature, 1)}</div>
                  <div className="mt-1 text-xs text-slate-400">Heat {formatNullableNumber(item.avgHeatLevel, 1)}</div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        {analytics ? (
          <SectionCard title="Diversity vs Risk" subtitle="Quick view of which cameras are rich in subject diversity and which are drifting operationally.">
            <div className="h-72">
              <ResponsiveContainer>
                <ScatterChart>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="diversityScore" stroke="#8ea6b1" name="Diversity" />
                  <YAxis dataKey="lowLightSharePct" stroke="#8ea6b1" name="Low-light share" />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                    formatter={(value: unknown) =>
                      typeof value === "number"
                        ? formatNumber(value, 1)
                        : Array.isArray(value)
                          ? value.join(", ")
                          : String(value ?? "")
                    }
                    labelFormatter={(_, payload) => String(payload?.[0]?.payload?.cameraName ?? "")}
                  />
                  <Scatter data={analytics.diversityByCamera} fill="#59a8ff" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}

        {analytics ? (
          <SectionCard title="Data Quality & Model Readiness" subtitle="Completeness, parsing reliability, and suspicious-value checks on the enriched synthetic/raw-like feed.">
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Missing Analysis Rate</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(analytics.dataQuality.missingAnalysisRatePct, 1)}%</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Parse Success</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(analytics.dataQuality.parseSuccessPct, 1)}%</div>
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4">
                <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Field Completeness</div>
                <div className="space-y-2">
                  {analytics.dataQuality.fieldCompleteness.map((item) => (
                    <div key={item.field} className="flex items-center justify-between text-sm text-slate-200">
                      <span>{titleCase(item.field)}</span>
                      <span>{formatNumber(item.completenessPct, 1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Suspicious Value Counts</div>
                  <div className="space-y-2">
                    {analytics.dataQuality.suspiciousValueCounts.map((item) => (
                      <div key={item.label} className="flex items-center justify-between text-sm text-slate-200">
                        <span>{item.label}</span>
                        <span>{formatNumber(item.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4">
                  <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Pipeline Consistency</div>
                  <div className="space-y-2">
                    {analytics.dataQuality.pipelineConsistency.map((item) => (
                      <div key={item.label} className="flex items-center justify-between text-sm text-slate-200">
                        <span>{item.label}</span>
                        <span>{formatNumber(item.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        ) : (
          <QueryState error={analyticsQuery.error as Error | null} />
        )}
      </div>

      {analytics ? (
        <SectionCard title="Forecast Residuals" subtitle="Difference between actual volume and the current trailing-average expectation.">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {analytics.forecast.slice(-10).map((point) => (
              <div key={point.date} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{point.date}</div>
                <div className="mt-2 text-lg font-semibold text-white">{formatNumber(point.actual)}</div>
                <div className="mt-1 text-sm text-slate-400">Expected {formatNumber(point.expected, 1)}</div>
                <div className={`mt-2 text-sm ${point.delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  Delta {formatSignedNumber(point.delta, 1)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </AppShell>
  );
};
