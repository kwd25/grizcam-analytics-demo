import type { OverviewKpis } from "@grizcam/shared";
import { formatCompactNumber, formatDurationShort, formatNullableNumber, formatPercent } from "../lib/utils";

const MetricCard = ({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) => (
  <div className="panel rounded-3xl p-4">
    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    <div className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</div>
  </div>
);

export const OverviewKpiStrip = ({ data }: { data: OverviewKpis }) => {
  const cards = [
    ["Total Events", formatCompactNumber(data.totalEvents), "text-white"],
    ["Active Cameras", formatCompactNumber(data.activeCameras), "text-white"],
    ["Wildlife Share", formatPercent(data.wildlifeSharePct / 100)],
    ["Human Share", formatPercent(data.humanSharePct / 100)],
    ["AI Processed", formatPercent(data.aiProcessedPct / 100)],
    ["Upload Success", formatPercent(data.uploadSuccessPct / 100)],
    ["Avg Upload Lag", formatDurationShort(data.avgUploadLagSeconds), "text-emerald-300"],
    ["Avg Processing Lag", formatDurationShort(data.avgProcessingLagSeconds), "text-emerald-300"],
    ["Cameras With Alerts", formatCompactNumber(data.camerasWithAlerts), data.camerasWithAlerts > 0 ? "text-amber-300" : "text-emerald-300"],
    ["Avg Voltage", formatNullableNumber(data.avgVoltage, 2, "v"), "text-emerald-300"],
    ["Low-Light Share", formatPercent(data.lowLightSharePct / 100), "text-emerald-300"]
  ];

  return (
    <div className="grid metric-grid gap-3">
      {cards.map(([label, value, tone]) => (
        <MetricCard key={label} label={label} value={value} tone={tone} />
      ))}
    </div>
  );
};
