import type { CompositionPoint } from "@grizcam/shared";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { SectionCard } from "../SectionCard";

export const CompositionChart = ({ data }: { data: CompositionPoint[] }) => {
  const palette = ["#73e0ae", "#59a8ff", "#ffcf66", "#6e7f89"];

  return (
    <SectionCard title="Activity Composition" subtitle="Wildlife versus human, vehicle, and empty-scene mix.">
      <div className="h-72">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="uniqueEventGroups" nameKey="category" innerRadius={64} outerRadius={100} paddingAngle={2}>
              {data.map((entry, index) => (
                <Cell key={entry.category} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
};

