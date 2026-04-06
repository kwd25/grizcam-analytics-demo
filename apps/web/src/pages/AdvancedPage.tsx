import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { AppShell } from "../components/AppShell";
import { FilterBar } from "../components/FilterBar";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import {
  classNames,
  formatNumber,
  formatSignedNumber,
  titleCase
} from "../lib/utils";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

const QueryState = ({ error }: { error?: Error | null }) => (
  <div className="panel rounded-3xl border border-white/8 bg-white/[0.03] px-4 py-10 text-center">
    <div className="text-sm font-medium text-white">{error ? "This section is temporarily unavailable" : "Loading advanced section"}</div>
    <div className="mt-2 text-sm text-slate-400">
      {error ? "The analytics endpoint returned an unexpected response. Try refreshing in a moment." : "Scoring predictions, novelty, and category shifts."}
    </div>
  </div>
);

const insightToneClasses = {
  info: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  positive: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  alert: "border-rose-400/20 bg-rose-400/10 text-rose-100"
} as const;

const shiftCellClass = (value: number) => {
  if (value >= 15) {
    return "bg-emerald-400/30 text-emerald-100";
  }
  if (value >= 5) {
    return "bg-emerald-400/15 text-emerald-100";
  }
  if (value <= -15) {
    return "bg-rose-400/30 text-rose-100";
  }
  if (value <= -5) {
    return "bg-rose-400/15 text-rose-100";
  }
  return "bg-white/5 text-slate-300";
};

export const AdvancedPage = () => {
  const { filters, patchFilters, resetFilters } = useDashboardFilters();
  const stableFilters = useMemo(() => filters, [filters]);
  const optionsQuery = useQuery({ queryKey: ["filter-options"], queryFn: api.filterOptions });
  const analyticsQuery = useQuery({ queryKey: ["analytics-lab", stableFilters], queryFn: () => api.analyticsLab(stableFilters) });

  const analytics = analyticsQuery.data;
  const forecastLeaderNames = analytics?.cameraForecastLeaders.slice(0, 5).map((item) => item.cameraName) ?? [];
  const forecastTrendData =
    analytics?.cameraForecast
      .filter((item) => forecastLeaderNames.includes(item.cameraName))
      .map((item) => ({ ...item, label: `${item.cameraName.split(" ")[0]} ${item.date.slice(5)}` })) ?? [];
  const shiftCameraRows = Array.from(new Set(analytics?.categoryShiftMatrix.slice(0, 24).map((item) => item.cameraName) ?? []));
  const shiftColumns = Array.from(new Set(analytics?.categoryShiftMatrix.slice(0, 24).map((item) => item.category) ?? []));
  const shiftLookup = new Map(
    analytics?.categoryShiftMatrix.slice(0, 24).map((item) => [`${item.cameraName}|||${item.category}`, item]) ?? []
  );
  const noveltyTrend = analytics?.anomalyTimeline ?? [];
  const forecastSurpriseData =
    analytics?.cameraForecastLeaders.map((item) => ({
      cameraName: item.cameraName,
      delta: item.delta,
      residualPct: item.residualPct
    })) ?? [];
  const noveltyMixByCategory = Array.from(
    (analytics?.novelEvents ?? []).reduce((accumulator, item) => {
      const current = accumulator.get(item.category) ?? {
        category: item.category,
        currentCount: 0,
        noveltyScoreTotal: 0,
        highNoveltyCount: 0,
        itemCount: 0
      };

      current.currentCount += item.currentCount;
      current.noveltyScoreTotal += item.noveltyScore;
      current.highNoveltyCount += item.noveltyScore >= 70 ? 1 : 0;
      current.itemCount += 1;
      accumulator.set(item.category, current);
      return accumulator;
    }, new Map<string, { category: string; currentCount: number; noveltyScoreTotal: number; highNoveltyCount: number; itemCount: number }>())
      .values()
  )
    .map((item) => ({
      category: titleCase(item.category),
      currentCount: item.currentCount,
      avgNoveltyScore: item.itemCount > 0 ? Number((item.noveltyScoreTotal / item.itemCount).toFixed(1)) : 0,
      highNoveltyCount: item.highNoveltyCount
    }))
    .sort((left, right) => right.avgNoveltyScore - left.avgNoveltyScore || right.currentCount - left.currentCount);

  return (
    <AppShell
      title="Advanced"
      subtitle="Advanced analytics for camera-level forecasting, novel pattern detection, and category shift analysis."
      badge={`${appEnv.demoLabel} • Advanced views`}
      aside={<FilterBar filters={filters} options={optionsQuery.data} onChange={patchFilters} onReset={resetFilters} />}
    >
      {analytics ? (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            {analytics.advancedInsights.map((item) => (
              <SectionCard key={item.title} title={item.title} className={classNames("border", insightToneClasses[item.tone])}>
                <p className="text-sm leading-6 text-inherit/90">{item.detail}</p>
              </SectionCard>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <SectionCard title="Forecast Residual Trend" subtitle="Camera-level actual versus expected activity for the most deviant cameras in the current window.">
              <div className="h-80">
                <ResponsiveContainer>
                  <ComposedChart data={forecastTrendData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="label" stroke="#8ea6b1" minTickGap={24} />
                    <YAxis yAxisId="left" stroke="#8ea6b1" />
                    <YAxis yAxisId="right" orientation="right" stroke="#8ea6b1" />
                    <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="delta" fill="#59a8ff" radius={[8, 8, 0, 0]} name="Residual delta" />
                    <Line yAxisId="right" type="monotone" dataKey="expected" stroke="#ffcf66" dot={false} strokeWidth={2} name="Expected" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Camera Forecast Leaderboard" subtitle="Largest current-window misses ranked by deviation from each camera's trailing 7-day expectation.">
              <div className="overflow-auto rounded-2xl border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/90 text-slate-400">
                    <tr>
                      <th className="px-3 py-3">Camera</th>
                      <th className="px-3 py-3">Actual</th>
                      <th className="px-3 py-3">Expected</th>
                      <th className="px-3 py-3">Delta</th>
                      <th className="px-3 py-3">Residual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.cameraForecastLeaders.map((row) => (
                      <tr key={row.cameraName} className="border-t border-white/5 text-slate-200">
                        <td className="px-3 py-3 font-medium">{row.cameraName}</td>
                        <td className="px-3 py-3">{formatNumber(row.actual)}</td>
                        <td className="px-3 py-3">{formatNumber(row.expected, 1)}</td>
                        <td className={`px-3 py-3 ${row.delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatSignedNumber(row.delta, 1)}</td>
                        <td className={`px-3 py-3 ${row.residualPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatSignedNumber(row.residualPct, 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <SectionCard title="Novel Events" subtitle="Rare camera-category-time combinations weighted toward uncommon pairings and baseline deviation.">
              <div className="overflow-auto rounded-2xl border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-950/90 text-slate-400">
                    <tr>
                      <th className="px-3 py-3">Pattern</th>
                      <th className="px-3 py-3">Novelty</th>
                      <th className="px-3 py-3">Recent</th>
                      <th className="px-3 py-3">Baseline</th>
                      <th className="px-3 py-3">Shift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.novelEvents.map((row) => (
                      <tr key={`${row.cameraName}-${row.category}-${row.hour}`} className="border-t border-white/5 text-slate-200">
                        <td className="px-3 py-3">
                          <div className="font-medium">{row.cameraName}</div>
                          <div className="mt-1 text-xs text-slate-400">{titleCase(row.category)} at {String(row.hour).padStart(2, "0")}:00</div>
                        </td>
                        <td className="px-3 py-3 text-amber-300">{formatNumber(row.noveltyScore, 1)}</td>
                        <td className="px-3 py-3">{formatNumber(row.currentCount)}</td>
                        <td className="px-3 py-3">{formatNumber(row.baselineDailyAvg, 1)}/day</td>
                        <td className={`px-3 py-3 ${row.shiftPct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatSignedNumber(row.shiftPct, 1)} pts</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 space-y-2">
                {analytics.novelEvents.slice(0, 3).map((row) => (
                  <div key={`${row.cameraName}-${row.category}-${row.hour}-detail`} className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-300">
                    {row.narrative}
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Novelty and Anomaly Timeline" subtitle="When advanced signals spike, with the strongest driver called out for quick interpretation.">
              <div className="h-80">
                <ResponsiveContainer>
                  <ComposedChart data={noveltyTrend}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={32} />
                    <YAxis yAxisId="left" stroke="#8ea6b1" />
                    <YAxis yAxisId="right" orientation="right" stroke="#8ea6b1" />
                    <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="novelEventCount" fill="#ffcf66" radius={[8, 8, 0, 0]} name="Novel event count" />
                    <Line yAxisId="right" type="monotone" dataKey="avgAnomalyScore" stroke="#ff7c7c" dot={false} strokeWidth={2} name="Avg anomaly score" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {noveltyTrend.slice(-4).map((item) => (
                  <div key={item.date} className="rounded-2xl bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.date}</div>
                    <div className="mt-2 text-sm text-white">Novel events {formatNumber(item.novelEventCount)}</div>
                    <div className="mt-1 text-sm text-slate-300">Avg anomaly {formatNumber(item.avgAnomalyScore, 1)}</div>
                    <div className="mt-2 text-xs text-slate-400">{item.topDriver ?? "No standout novelty driver"}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <SectionCard title="Category Shift Matrix" subtitle="Camera-category share movement against recent baseline, highlighting over- and under-indexing rather than raw volume.">
              <div className="overflow-auto">
                <div className="grid min-w-max gap-2 text-xs" style={{ gridTemplateColumns: `220px repeat(${shiftColumns.length || 1}, minmax(92px, 1fr))` }}>
                  <div />
                  {shiftColumns.map((column) => (
                    <div key={column} className="px-1 text-center text-slate-400">{titleCase(column)}</div>
                  ))}
                  {shiftCameraRows.map((cameraName) => (
                    <div key={cameraName} className="contents">
                      <div className="pr-3 text-sm font-medium text-slate-300">{cameraName}</div>
                      {shiftColumns.map((column) => {
                        const item = shiftLookup.get(`${cameraName}|||${column}`);
                        return (
                          <div
                            key={`${cameraName}-${column}`}
                            className={classNames("flex h-12 items-center justify-center rounded-xl border border-white/5 font-medium", shiftCellClass(item?.shiftPct ?? 0))}
                            title={
                              item
                                ? `${cameraName} ${column}: recent ${formatNumber(item.recentSharePct, 1)}%, baseline ${formatNumber(item.baselineSharePct, 1)}%`
                                : `${cameraName} ${column}: no material shift`
                            }
                          >
                            {item ? `${formatSignedNumber(item.shiftPct, 1)}p` : ""}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Behavior Archetypes" subtitle="Behavioral segmentation of cameras using category mix, diversity, and anomaly context.">
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
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <SectionCard title="Forecast Surprise by Camera" subtitle="Largest forecast deviations by camera in the current window.">
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={forecastSurpriseData} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
                    <XAxis type="number" stroke="#8ea6b1" />
                    <YAxis type="category" dataKey="cameraName" stroke="#8ea6b1" width={150} />
                    <Tooltip
                      contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                      formatter={(value: unknown, name: unknown) => [
                        typeof value === "number"
                          ? `${formatSignedNumber(value, 1)}${name === "Residual %" ? "%" : ""}`
                          : String(value ?? ""),
                        String(name ?? "")
                      ]}
                    />
                    <Legend />
                    <Bar dataKey="delta" fill="#59a8ff" radius={[0, 8, 8, 0]} name="Delta" />
                    <Bar dataKey="residualPct" fill="#73e0ae" radius={[0, 8, 8, 0]} name="Residual %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard title="Novelty Mix by Category" subtitle="Which categories are driving the most unusual activity right now.">
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={noveltyMixByCategory}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="category" stroke="#8ea6b1" />
                    <YAxis yAxisId="left" stroke="#8ea6b1" />
                    <YAxis yAxisId="right" orientation="right" stroke="#8ea6b1" />
                    <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="currentCount" fill="#ffcf66" radius={[8, 8, 0, 0]} name="Recent count" />
                    <Bar yAxisId="right" dataKey="avgNoveltyScore" fill="#ff7c7c" radius={[8, 8, 0, 0]} name="Avg novelty score" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {noveltyMixByCategory.slice(0, 3).map((item) => (
                  <div key={item.category} className="rounded-2xl bg-white/5 p-4">
                    <div className="text-sm font-medium text-white">{item.category}</div>
                    <div className="mt-2 text-xs text-slate-400">Recent count {formatNumber(item.currentCount)}</div>
                    <div className="mt-1 text-xs text-slate-400">Avg novelty {formatNumber(item.avgNoveltyScore, 1)}</div>
                    <div className="mt-1 text-xs text-slate-400">High-novelty patterns {formatNumber(item.highNoveltyCount)}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </>
      ) : (
        <QueryState error={analyticsQuery.error as Error | null} />
      )}
    </AppShell>
  );
};
