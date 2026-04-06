import { AppShell } from "../components/AppShell";
import { SectionCard } from "../components/SectionCard";
import { appEnv } from "../lib/env";

export const QueryPage = () => (
  <AppShell
    title="Natural Language Query"
    subtitle="Ad hoc natural language querying will live here, letting operators ask questions about camera activity, telemetry, and pipeline behavior."
    badge={`${appEnv.demoLabel} • Placeholder`}
  >
    <SectionCard title="Coming Soon" subtitle="This route is intentionally scaffolded without functionality yet.">
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-sm text-slate-400">
        Natural language query tooling has not been implemented yet. This page is reserved for the future ad hoc querying experience.
      </div>
    </SectionCard>
  </AppShell>
);
