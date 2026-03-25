import type { TimeOfDayCompositionPoint } from "@grizcam/shared";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "../SectionCard";

export const TimeOfDayChart = ({ data }: { data: TimeOfDayCompositionPoint[] }) => (
  <SectionCard title="Time-Of-Day Composition" subtitle="Unique event groups by daylight bucket and subject type.">
    <div className="h-72">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis dataKey="bucket" stroke="#8ea6b1" />
          <YAxis stroke="#8ea6b1" />
          <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
          <Legend />
          <Bar dataKey="wildlife" stackId="a" fill="#73e0ae" />
          <Bar dataKey="human" stackId="a" fill="#59a8ff" />
          <Bar dataKey="vehicle" stackId="a" fill="#ffcf66" />
          <Bar dataKey="emptyScene" stackId="a" fill="#6e7f89" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </SectionCard>
);

