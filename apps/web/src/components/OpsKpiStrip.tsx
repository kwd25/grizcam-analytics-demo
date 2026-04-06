import type { OverviewResponse } from "@grizcam/shared";
import { formatCompactNumber, formatDurationShort, formatPercent } from "../lib/utils";

const MetricCard = ({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) => (
  <div className="panel rounded-3xl p-4">
    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    <div className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</div>
  </div>
);

export const OpsKpiStrip = ({ data }: { data: OverviewResponse }) => {
  const staleOrUnhealthyCount = data.cameraHealth.filter((camera) => (camera.lastSeenHoursAgo ?? 0) > 48 || camera.status !== "healthy").length;

  const cards = [
    [
      "Cameras With Alerts",
      formatCompactNumber(data.kpis.camerasWithAlerts),
      data.kpis.camerasWithAlerts > 0 ? "text-amber-300" : "text-emerald-300"
    ],
    [
      "Stale / Unhealthy",
      formatCompactNumber(staleOrUnhealthyCount),
      staleOrUnhealthyCount > 0 ? "text-amber-300" : "text-emerald-300"
    ],
    ["Avg Upload Lag", formatDurationShort(data.kpis.avgUploadLagSeconds), "text-emerald-300"],
    ["Avg Processing Lag", formatDurationShort(data.kpis.avgProcessingLagSeconds), "text-emerald-300"],
    [
      "Upload Success",
      formatPercent(data.kpis.uploadSuccessPct / 100),
      data.kpis.uploadSuccessPct < 95 ? "text-amber-300" : "text-emerald-300"
    ],
    [
      "JSON Completion",
      formatPercent(data.kpis.jsonProcessedPct / 100),
      data.kpis.jsonProcessedPct < 90 ? "text-amber-300" : "text-emerald-300"
    ]
  ];

  return (
    <div className="grid metric-grid gap-3">
      {cards.map(([label, value, tone]) => (
        <MetricCard key={label} label={label} value={value} tone={tone} />
      ))}
    </div>
  );
};
