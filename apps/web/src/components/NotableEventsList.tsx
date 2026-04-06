import type { EventRecord } from "@grizcam/shared";
import { formatDurationShort, formatEventTimestamp, titleCase } from "../lib/utils";
import { SectionCard } from "./SectionCard";
import { StatusBadge } from "./StatusBadge";

type NotableEventsListProps = {
  rows: EventRecord[];
  title?: string;
  subtitle?: string;
};

export const NotableEventsList = ({
  rows,
  title = "Notable Events",
  subtitle = "High-signal detections and operational outliers, ordered by urgency and recency."
}: NotableEventsListProps) => (
  <SectionCard title={title} subtitle={subtitle}>
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[120px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
            {row.imageBlobUrl ? (
              <img src={row.imageBlobUrl} alt={row.analysisTitle ?? row.cameraName} className="h-28 w-full object-cover" />
            ) : (
              <div className="flex h-28 items-center justify-center text-xs text-slate-500">No image</div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={row.operationalStatus ?? "healthy"} />
              <div className="text-sm text-slate-400">{formatEventTimestamp(row.localTimestamp)}</div>
              <div className="text-sm text-slate-400">{row.cameraName}</div>
            </div>
            <div className="text-base font-semibold text-white">{row.analysisTitle ?? titleCase(row.subjectClass ?? row.subjectCategory ?? "unknown event")}</div>
            <div className="text-sm leading-6 text-slate-300">{row.summary ?? row.analysisSummary ?? "No narrative available."}</div>
            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
              <span>{titleCase(row.subjectCategory ?? "unknown")}</span>
              <span>Lag {formatDurationShort(row.processingLagSeconds)}</span>
              <span>Voltage {row.voltage?.toFixed(2) ?? "N/A"}v</span>
              <span>Burst {row.eventGroupSize}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </SectionCard>
);
