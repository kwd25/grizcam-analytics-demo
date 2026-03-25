import type { BurstinessPoint } from "@grizcam/shared";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "../SectionCard";

export const BurstinessChart = ({ data }: { data: BurstinessPoint[] }) => (
  <SectionCard title="Burstiness" subtitle="Average burst length and percentage of multi-row groups by camera.">
    <div className="h-72">
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis dataKey="label" stroke="#8ea6b1" />
          <YAxis yAxisId="left" stroke="#8ea6b1" />
          <YAxis yAxisId="right" orientation="right" stroke="#8ea6b1" />
          <Tooltip contentStyle={{ background: "#102028", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16 }} />
          <Legend />
          <Bar yAxisId="left" dataKey="avgRowsPerGroup" fill="#59a8ff" />
          <Line yAxisId="right" type="monotone" dataKey="burstGroupPct" stroke="#73e0ae" strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  </SectionCard>
);

