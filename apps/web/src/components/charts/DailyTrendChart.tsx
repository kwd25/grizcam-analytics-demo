import type { DailyActivityPoint } from "@grizcam/shared";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "../SectionCard";

type DailyTrendChartProps = {
  data: DailyActivityPoint[];
  onSelectDate: (date: string) => void;
};

export const DailyTrendChart = ({ data, onSelectDate }: DailyTrendChartProps) => {
  const cameraNames = Array.from(new Set(data.map((point) => point.cameraName)));
  const rows = Array.from(
    data.reduce((map, point) => {
      const current = map.get(point.date) ?? ({ date: point.date, total: 0 } as Record<string, string | number>);
      current.total = Number(current.total ?? 0) + point.uniqueEventGroups;
      current[point.cameraName] = point.uniqueEventGroups;
      map.set(point.date, current);
      return map;
    }, new Map<string, Record<string, number | string>>()).values()
  );

  const palette = ["#73e0ae", "#59a8ff", "#ffcf66", "#ff7c7c", "#b08cff"];

  return (
    <SectionCard title="Daily Activity Trend" subtitle="Click a day to open a detailed drilldown panel.">
      <div className="h-80">
        <ResponsiveContainer>
          <AreaChart data={rows} onClick={(state) => state?.activeLabel && onSelectDate(String(state.activeLabel))}>
            <defs>
              <linearGradient id="activity-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#73e0ae" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#73e0ae" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
            <YAxis stroke="#8ea6b1" />
            <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
            <Legend />
            <Area type="monotone" dataKey="total" stroke="#73e0ae" fill="url(#activity-fill)" strokeWidth={2} name="All cameras" />
            {cameraNames.slice(0, 5).map((cameraName, index) => (
              <Area
                key={cameraName}
                type="monotone"
                dataKey={cameraName}
                stroke={palette[index % palette.length]}
                fillOpacity={0}
                strokeWidth={1.5}
                name={cameraName}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
};
