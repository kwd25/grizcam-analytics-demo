import type { DaySummaryResponse } from "@grizcam/shared";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber, titleCase } from "../lib/utils";
import { SectionCard } from "./SectionCard";

export const DayDetailPanel = ({ selectedDate, data }: { selectedDate?: string; data?: DaySummaryResponse }) => (
  <SectionCard
    title="Day Drilldown"
    subtitle={selectedDate ? `Detailed distribution for ${selectedDate}` : "Click a day in the activity trend to inspect that date."}
    className="h-full"
  >
    {!selectedDate || !data ? (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-sm text-slate-400">
        No day selected yet.
      </div>
    ) : (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Event Groups</div>
            <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(data.totalEventGroups)}</div>
          </div>
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Raw Rows</div>
            <div className="mt-2 text-2xl font-semibold text-white">{formatNumber(data.totalRawRows)}</div>
          </div>
        </div>

        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={data.hourlyDistribution}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="hour" stroke="#8ea6b1" />
              <YAxis stroke="#8ea6b1" />
              <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
              <Bar dataKey="uniqueEventGroups" fill="#73e0ae" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Subject Breakdown</div>
            <div className="space-y-2 text-sm">
              {data.subjectBreakdown.slice(0, 8).map((item) => (
                <div key={item.subjectClass} className="flex items-center justify-between text-slate-200">
                  <span>{titleCase(item.subjectClass)}</span>
                  <span>{formatNumber(item.uniqueEventGroups)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-white/5 p-4">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Camera Breakdown</div>
            <div className="space-y-2 text-sm">
              {data.cameraBreakdown.map((item) => (
                <div key={item.cameraName} className="flex items-center justify-between text-slate-200">
                  <span>{item.cameraName}</span>
                  <span>{formatNumber(item.uniqueEventGroups)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white/5 p-4">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Detailed Event List</div>
          <div className="max-h-80 overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-950/90 text-slate-400">
                <tr>
                  <th className="px-2 py-2">Timestamp</th>
                  <th className="px-2 py-2">Camera</th>
                  <th className="px-2 py-2">Subject</th>
                  <th className="px-2 py-2">Summary</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr key={event.id} className="border-t border-white/5 align-top text-slate-200">
                    <td className="px-2 py-2">{event.timestamp.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-2 py-2">{event.cameraName}</td>
                    <td className="px-2 py-2">{titleCase(event.subjectClass ?? "unknown")}</td>
                    <td className="px-2 py-2 text-slate-400">{event.analysisSummary ?? event.analysisTitle ?? "No summary"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}
  </SectionCard>
);

