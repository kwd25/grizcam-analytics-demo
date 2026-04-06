import { AppShell } from "../components/AppShell";
import { SectionCard } from "../components/SectionCard";
import { appEnv } from "../lib/env";

export const ReportsPage = () => (
  <AppShell
    title="Reports"
    subtitle="Scheduled summaries, exportable operational reports, and stakeholder-ready report views will live here."
    badge={`${appEnv.demoLabel} • Placeholder`}
  >
    <SectionCard title="Coming Soon" subtitle="This route is intentionally scaffolded without functionality yet.">
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-sm text-slate-400">
        Reporting workflows have not been implemented yet. This page is reserved for future report generation and report history.
      </div>
    </SectionCard>
  </AppShell>
);
