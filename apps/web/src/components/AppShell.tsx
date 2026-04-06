import type { PropsWithChildren, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { classNames } from "../lib/utils";

type AppShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  badge?: ReactNode;
  aside?: ReactNode;
}>;

const navItems = [
  { to: "/", label: "Overview", end: true },
  { to: "/ops", label: "Ops" },
  { to: "/analytics-lab", label: "ML" },
  { to: "/query", label: "Query" },
  { to: "/reports", label: "Reports" }
];

export const AppShell = ({ title, subtitle, badge, aside, children }: AppShellProps) => (
  <div className="min-h-screen overflow-x-hidden px-4 py-4 text-slate-100">
    <div className="mx-auto max-w-[1800px] space-y-4">
      <header className="rounded-[32px] border border-white/10 bg-white/[0.03] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    classNames(
                      "rounded-2xl border px-4 py-2 text-sm transition",
                      isActive
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                        : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-white">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{subtitle}</p>
            </div>
          </div>
          {badge ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{badge}</div> : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="min-w-0 space-y-4">{children}</main>
        {aside ? <div className="lg:order-2">{aside}</div> : null}
      </div>
    </div>
  </div>
);
