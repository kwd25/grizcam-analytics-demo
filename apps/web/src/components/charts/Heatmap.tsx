import type { CSSProperties } from "react";
import { classNames, formatHourLabel, formatNumber, titleCase } from "../../lib/utils";
import { SectionCard } from "../SectionCard";

type MatrixCell = {
  row: string;
  column: string;
  value: number;
};

type HeatmapProps = {
  title: string;
  subtitle: string;
  rows: string[];
  columns: string[];
  data: MatrixCell[];
  variant?: "hour" | "subject";
};

export const Heatmap = ({ title, subtitle, rows, columns, data, variant = "hour" }: HeatmapProps) => {
  const values = data.map((cell) => cell.value);
  const maxValue = Math.max(...values, 1);
  const gridClass = variant === "hour" ? "heatmap-grid-24" : "heatmap-grid-subject";
  const style = variant === "subject" ? ({ ["--subject-columns" as string]: columns.length } as CSSProperties) : undefined;

  const lookup = new Map(data.map((cell) => [`${cell.row}-${cell.column}`, cell.value]));

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="overflow-auto">
        <div className={`grid min-w-max gap-2 text-xs ${gridClass}`} style={style}>
          <div />
          {columns.map((column) => (
            <div key={column} className="px-1 text-center text-slate-400">
              {variant === "hour" ? formatHourLabel(Number(column)) : titleCase(column)}
            </div>
          ))}
          {rows.map((row) => (
            <div key={row} className="contents">
              <div key={`${row}-label`} className="pr-3 text-sm font-medium text-slate-300">
                {row}
              </div>
              {columns.map((column) => {
                const value = lookup.get(`${row}-${column}`) ?? 0;
                const intensity = value / maxValue;
                return (
                  <div
                    key={`${row}-${column}`}
                    className={classNames(
                      "flex h-10 items-center justify-center rounded-xl border border-white/5 text-[11px] font-medium text-slate-100"
                    )}
                    style={{
                      backgroundColor: `rgba(115, 224, 174, ${0.08 + intensity * 0.7})`
                    }}
                    title={`${row} • ${column}: ${formatNumber(value)}`}
                  >
                    {value > 0 ? formatNumber(value) : ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
};
