import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "../components/AppShell";
import { FilterBar } from "../components/FilterBar";
import { SectionCard } from "../components/SectionCard";
import { api } from "../lib/api";
import { appEnv } from "../lib/env";
import { classNames, formatNumber, formatSignedNumber, titleCase } from "../lib/utils";
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

const residualCellClass = (value: number) => {
  if (value >= 40) {
    return "bg-emerald-400/35 text-emerald-100";
  }
  if (value >= 15) {
    return "bg-emerald-400/20 text-emerald-100";
  }
  if (value <= -40) {
    return "bg-rose-400/35 text-rose-100";
  }
  if (value <= -15) {
    return "bg-rose-400/20 text-rose-100";
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
  const forecastDateColumns = Array.from(new Set(
    analytics?.cameraForecast.filter((item) => forecastLeaderNames.includes(item.cameraName)).map((item) => item.date) ?? []
  )).sort();
  const forecastResidualLookup = new Map(
    analytics?.cameraForecast
      .filter((item) => forecastLeaderNames.includes(item.cameraName))
      .map((item) => [`${item.cameraName}|||${item.date}`, item]) ?? []
  );
  const shiftCameraRows = Array.from(new Set(analytics?.categoryShiftMatrix.slice(0, 24).map((item) => item.cameraName) ?? []));
  const shiftColumns = Array.from(new Set(analytics?.categoryShiftMatrix.slice(0, 24).map((item) => item.category) ?? []));
  const shiftLookup = new Map(
    analytics?.categoryShiftMatrix.slice(0, 24).map((item) => [`${item.cameraName}|||${item.category}`, item]) ?? []
  );
  const noveltyVolumeData = analytics?.noveltyTimelineDaily ?? [];

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
            <SectionCard title="Forecast Residual Heatmap" subtitle="Residual percentage by camera and date, using real dates to show where activity is above or below expectation.">
              <div className="overflow-auto">
                <div className="grid min-w-max gap-2 text-xs" style={{ gridTemplateColumns: `220px repeat(${forecastDateColumns.length || 1}, minmax(74px, 1fr))` }}>
                  <div />
                  {forecastDateColumns.map((date) => (
                    <div key={date} className="px-1 text-center text-slate-400">{date.slice(5)}</div>
                  ))}
                  {forecastLeaderNames.map((cameraName) => (
                    <div key={cameraName} className="contents">
                      <div className="pr-3 text-sm font-medium text-slate-300">{cameraName}</div>
                      {forecastDateColumns.map((date) => {
                        const item = forecastResidualLookup.get(`${cameraName}|||${date}`);
                        return (
                          <div
                            key={`${cameraName}-${date}`}
                            className={classNames("flex h-12 items-center justify-center rounded-xl border border-white/5 font-medium", residualCellClass(item?.residualPct ?? 0))}
                            title={
                              item
                                ? `${cameraName} ${date}: actual ${formatNumber(item.actual)}, expected ${formatNumber(item.expected, 1)}, delta ${formatSignedNumber(item.delta, 1)}, residual ${formatSignedNumber(item.residualPct, 1)}%`
                                : `${cameraName} ${date}: no forecast signal`
                            }
                          >
                            {item ? `${formatSignedNumber(item.residualPct, 0)}%` : ""}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
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

          <div className="grid gap-4 xl:grid-cols-1">
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
          </div>

          <div className="grid gap-4 xl:grid-cols-1">
            <SectionCard title="Novelty Volume Timeline" subtitle="Daily count of novelty-qualified patterns across the full filtered date range.">
              <div className="h-80">
                <ResponsiveContainer>
                  <BarChart data={noveltyVolumeData}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                    <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={32} />
                    <YAxis stroke="#8ea6b1" />
                    <Tooltip
                      contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }}
                      formatter={(value: unknown) => (typeof value === "number" ? formatNumber(value, 0) : String(value ?? ""))}
                      labelFormatter={(_, payload) => {
                        const item = payload?.[0]?.payload;
                        return item ? `${item.date} • ${item.topDriver ?? "No dominant driver"} • ${item.dominantCategory ? titleCase(item.dominantCategory) : "No dominant category"}` : "";
                      }}
                    />
                    <Bar dataKey="noveltyCount" fill="#ffcf66" radius={[8, 8, 0, 0]} name="Novelty count" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-1">
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
          </div>
        </>
      ) : (
        <QueryState error={analyticsQuery.error as Error | null} />
      )}
    </AppShell>
  );
};
