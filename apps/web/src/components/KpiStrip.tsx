import type { KpiResponse } from "@grizcam/shared";
import { formatCompactNumber, formatNumber, formatPercent } from "../lib/utils";

const MetricCard = ({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) => (
  <div className="panel rounded-3xl p-4">
    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    <div className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</div>
  </div>
);

export const KpiStrip = ({ data }: { data: KpiResponse }) => {
  const primary = [
    ["Total Raw Rows", formatCompactNumber(data.totalRawRows)],
    ["Unique Event Groups", formatCompactNumber(data.totalUniqueEventGroups)],
    ["Selected Cameras", formatNumber(data.selectedCamerasCount)],
    ["Wildlife Share", formatPercent(data.wildlifeSharePct / 100)],
    ["Human Share", formatPercent(data.humanSharePct / 100)],
    ["Vehicle Share", formatPercent(data.vehicleSharePct / 100)],
    ["Most Active Camera", data.mostActiveCamera ?? "N/A"],
    ["Peak Activity Hour", data.peakActivityHour === null ? "N/A" : `${data.peakActivityHour}:00`],
    ["Avg Daily Groups", formatNumber(data.avgDailyEventGroups, 1)],
    ["Avg Burst Length", formatNumber(data.avgBurstLength, 2)]
  ];

  const secondary = [
    ["Burst Intensity", formatNumber(data.burstIntensity, 2)],
    ["Biodiversity Score", formatNumber(data.biodiversityScore)],
    ["Disturbance Score", formatNumber(data.disturbanceScore, 1)],
    ["Nocturnality", formatPercent(data.nocturnalityScore)],
    ["Dawn/Dusk Preference", formatPercent(data.dawnDuskPreference)],
    ["Camera Volatility", formatNumber(data.cameraVolatility, 2)],
    ["Rare Bear/Wolf Groups", formatNumber(data.rareEventGroups)]
  ];

  return (
    <div className="space-y-3">
      <div className="grid metric-grid gap-3">
        {primary.map(([label, value]) => (
          <MetricCard key={label} label={label} value={value} />
        ))}
      </div>
      <div className="grid metric-grid gap-3">
        {secondary.map(([label, value]) => (
          <MetricCard key={label} label={label} value={value} tone="text-emerald-300" />
        ))}
      </div>
    </div>
  );
};

