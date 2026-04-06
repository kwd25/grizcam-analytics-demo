import type { InsightItem } from "@grizcam/shared";
import { SectionCard } from "./SectionCard";

const toneClasses: Record<InsightItem["tone"], string> = {
  info: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  positive: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  alert: "border-rose-400/20 bg-rose-400/10 text-rose-100"
};

export const InsightList = ({ items }: { items: InsightItem[] }) => (
  <SectionCard title="What Changed" subtitle="Rules-based highlights from the current selection.">
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.title} className={`rounded-2xl border p-4 ${toneClasses[item.tone]}`}>
          <div className="text-sm font-semibold">{item.title}</div>
          <div className="mt-2 text-sm leading-6 opacity-90">{item.detail}</div>
        </div>
      ))}
    </div>
  </SectionCard>
);
