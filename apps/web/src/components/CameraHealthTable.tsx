import type { CameraHealthRow } from "@grizcam/shared";
import { formatDurationShort, formatEventTimestamp, formatNullableNumber, formatNumber } from "../lib/utils";
import { SectionCard } from "./SectionCard";
import { StatusBadge } from "./StatusBadge";

export const CameraHealthTable = ({ rows }: { rows: CameraHealthRow[] }) => (
  <SectionCard title="Camera Health" subtitle="Operational summary by camera, including freshness, pipeline completion, and power signals.">
    <div className="overflow-auto rounded-2xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-950/90 text-slate-400">
          <tr>
            <th className="px-3 py-3">Camera</th>
            <th className="px-3 py-3">Last Seen</th>
            <th className="px-3 py-3">Events</th>
            <th className="px-3 py-3">AI %</th>
            <th className="px-3 py-3">Upload Lag</th>
            <th className="px-3 py-3">Voltage</th>
            <th className="px-3 py-3">Health</th>
            <th className="px-3 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.cameraName} className="border-t border-white/5 text-slate-200">
              <td className="px-3 py-3 font-medium">{row.cameraName}</td>
              <td className="px-3 py-3">{formatEventTimestamp(row.lastSeen)}</td>
              <td className="px-3 py-3">{formatNumber(row.totalEvents)}</td>
              <td className="px-3 py-3">{formatNumber(row.aiProcessedPct, 1)}%</td>
              <td className="px-3 py-3">{formatDurationShort(row.avgUploadLagSeconds)}</td>
              <td className="px-3 py-3">{formatNullableNumber(row.avgVoltage, 2, "v")}</td>
              <td className="px-3 py-3">{formatNumber(row.healthScore)}</td>
              <td className="px-3 py-3">
                <div className="space-y-2">
                  <StatusBadge status={row.status} />
                  {row.alertReason ? <div className="text-xs text-slate-400">{row.alertReason}</div> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </SectionCard>
);
