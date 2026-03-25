import type { EventQuery, EventsResponse } from "@grizcam/shared";
import { Fragment, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatNumber, titleCase } from "../lib/utils";
import { SectionCard } from "./SectionCard";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

type EventTableProps = {
  data?: EventsResponse;
  isLoading: boolean;
  query: EventQuery;
  onQueryChange: (patch: Partial<EventQuery>) => void;
  exportUrl: string;
};

const columns: Array<{ key: EventQuery["sort_by"]; label: string }> = [
  { key: "timestamp", label: "Local Timestamp" },
  { key: "camera_name", label: "Camera" },
  { key: "event", label: "Event Group" },
  { key: "sequence", label: "Sequence" },
  { key: "subject_class", label: "Subject Class" },
  { key: "subject_category", label: "Category" },
  { key: "lux", label: "Lux" },
  { key: "temperature", label: "Temp" },
  { key: "heat_level", label: "Heat" }
];

export const EventTable = ({ data, isLoading, query, onQueryChange, exportUrl }: EventTableProps) => {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");
  const debouncedSearch = useDebouncedValue(searchDraft, 350);

  useEffect(() => {
    setSearchDraft(query.q ?? "");
  }, [query.q]);

  useEffect(() => {
    if (debouncedSearch !== query.q) {
      onQueryChange({ q: debouncedSearch, page: 1 });
    }
  }, [debouncedSearch, onQueryChange, query.q]);

  const toggleSort = (sortBy: EventQuery["sort_by"]) => {
    onQueryChange({
      sort_by: sortBy,
      sort_dir: query.sort_by === sortBy && query.sort_dir === "desc" ? "asc" : "desc"
    });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <SectionCard
      title="Event Explorer"
      subtitle="Server-side search, sorting, and pagination over event-level details."
      actions={
        api.exportsEnabled ? (
          <a href={exportUrl} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10">
            Export CSV
          </a>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-500">
            CSV export disabled in demo
          </div>
        )
      }
    >
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search analysis title or summary"
          className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400 md:max-w-md"
        />
        <div className="text-sm text-slate-400">{data ? `${formatNumber(data.total)} matching rows` : "Loading rows..."}</div>
      </div>

      <div className="overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-950/90 text-slate-400">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-3">
                  <button className="font-medium hover:text-white" onClick={() => toggleSort(column.key)}>
                    {column.label}
                  </button>
                </th>
              ))}
              <th className="px-3 py-3">Summary</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-10 text-center text-slate-400">
                  Loading events…
                </td>
              </tr>
            ) : (
              data?.rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/5"
                    onClick={() => setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                  >
                    <td className="px-3 py-3">{row.timestamp.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-3">{row.cameraName}</td>
                    <td className="px-3 py-3">{row.event}</td>
                    <td className="px-3 py-3">{formatNumber(row.sequence)}</td>
                    <td className="px-3 py-3">{titleCase(row.subjectClass ?? "unknown")}</td>
                    <td className="px-3 py-3">{titleCase(row.subjectCategory ?? "unknown")}</td>
                    <td className="px-3 py-3">{row.lux ?? "—"}</td>
                    <td className="px-3 py-3">{row.temperature ?? "—"}</td>
                    <td className="px-3 py-3">{row.heatLevel ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-400">{row.analysisTitle ?? row.analysisSummary ?? "No narrative"}</td>
                  </tr>
                  {expandedRowId === row.id ? (
                    <tr className="border-t border-white/5 bg-white/[0.03]">
                      <td colSpan={columns.length + 1} className="px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2 text-sm text-slate-300">
                            <div><span className="text-slate-500">MAC:</span> {row.mac}</div>
                            <div><span className="text-slate-500">Sensor:</span> {row.sensor}</div>
                            <div><span className="text-slate-500">Time bucket:</span> {titleCase(row.timeOfDayBucket ?? "unknown")}</div>
                            <div><span className="text-slate-500">Battery:</span> {row.batteryPercentage ?? "—"}</div>
                            <div><span className="text-slate-500">Filename:</span> {row.filename ?? "—"}</div>
                          </div>
                          <div className="space-y-2 text-sm text-slate-300">
                            <div className="text-slate-500">Summary</div>
                            <div>{row.analysisSummary ?? "No analysis summary available."}</div>
                            {row.imageBlobUrl ? (
                              <a href={row.imageBlobUrl} target="_blank" rel="noreferrer" className="inline-block text-emerald-300 hover:text-emerald-200">
                                Open image blob
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-sm text-slate-400">
          Page {query.page} of {totalPages}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onQueryChange({ page: Math.max(1, query.page - 1) })}
            disabled={query.page <= 1}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => onQueryChange({ page: Math.min(totalPages, query.page + 1) })}
            disabled={query.page >= totalPages}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </SectionCard>
  );
};
