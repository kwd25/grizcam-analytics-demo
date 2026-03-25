import type { TelemetryPoint } from "@grizcam/shared";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "../SectionCard";

export const TelemetryChart = ({ data }: { data: TelemetryPoint[] }) => {
  const rows = Array.from(
    data.reduce((map, point) => {
      const current = map.get(point.date) ?? { date: point.date };
      current[`${point.cameraName} battery`] = point.avgBatteryPercentage ?? 0;
      map.set(point.date, current);
      return map;
    }, new Map<string, Record<string, number | string>>()).values()
  );
  const keys = Array.from(new Set(data.map((point) => `${point.cameraName} battery`)));
  const palette = ["#73e0ae", "#59a8ff", "#ffcf66", "#ff7c7c", "#b08cff"];

  return (
    <SectionCard title="Battery Telemetry" subtitle="Average battery percentage over time by camera.">
      <div className="h-72">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="date" stroke="#8ea6b1" minTickGap={36} />
            <YAxis stroke="#8ea6b1" domain={[0, 100]} />
            <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
            <Legend />
            {keys.map((key, index) => (
              <Line key={key} type="monotone" dataKey={key} stroke={palette[index % palette.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
};

