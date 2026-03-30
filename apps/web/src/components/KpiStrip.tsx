import type { KpiResponse } from "@grizcam/shared";
import { formatCompactNumber, formatNumber, formatPercent, titleCase } from "../lib/utils";

const MetricCard = ({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) => (
  <div className="panel rounded-3xl p-4">
    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
    <div className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</div>
  </div>
);

export const KpiStrip = ({ data }: { data: KpiResponse }) => {
  const cards = [
    ["Total Events", formatCompactNumber(data.totalUniqueEventGroups), "text-white"],
    ["Total Captures", formatCompactNumber(data.totalRawRows), "text-white"],
    ["Wildlife Share", formatPercent(data.wildlifeSharePct / 100)],
    ["Human Share", formatPercent(data.humanSharePct / 100)],
    ["Vehicle Share", formatPercent(data.vehicleSharePct / 100)],
    ["Most Active Camera", data.mostActiveCamera ?? "N/A"],
    ["Peak Activity Hour", data.peakActivityHour === null ? "N/A" : `${data.peakActivityHour}:00`],
    ["Avg Daily Events", formatNumber(data.avgDailyEventGroups, 1)],
    ["Avg Images per Event", formatNumber(data.avgBurstLength, 2)],
    ["Wildlife Types Seen", formatNumber(data.biodiversityScore), "text-emerald-300"],
    ["Night Activity Share", formatPercent(data.nocturnalityScore), "text-emerald-300"],
    ["Dawn/Dusk Activity Share", formatPercent(data.dawnDuskPreference), "text-emerald-300"],
    ["Top Species", data.topSpecies ? titleCase(data.topSpecies) : "N/A", "text-emerald-300"]
  ];

  return (
    <div className="grid metric-grid gap-3">
      {cards.map(([label, value, tone]) => (
        <MetricCard key={label} label={label} value={value} tone={tone} />
      ))}
    </div>
  );
};
