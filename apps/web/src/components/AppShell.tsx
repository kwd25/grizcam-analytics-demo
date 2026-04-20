import type { PropsWithChildren, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { classNames } from "../lib/utils";

type AppShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  badge?: ReactNode;
  aside?: ReactNode;
  viewportLayout?: boolean;
  mainClassName?: string;
  asideClassName?: string;
}>;

const navItems = [
  { to: "/", label: "Query", end: true },
  { to: "/overview", label: "Overview" },
  { to: "/ops", label: "Ops" },
  { to: "/advanced", label: "Advanced" },
  { to: "/reports", label: "Reports" }
];

export const AppShell = ({ title, subtitle, badge, aside, viewportLayout = false, mainClassName, asideClassName, children }: AppShellProps) => (
  <div
    className={classNames(
      "overflow-x-hidden px-3 py-2 text-slate-100",
      viewportLayout ? "h-[100dvh] overflow-y-hidden" : "min-h-screen"
    )}
  >
    <div className={classNames("mx-auto max-w-[1800px]", viewportLayout ? "flex h-full min-h-0 flex-col gap-2" : "space-y-2")}>
      <header className="shrink-0 rounded-[24px] border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    classNames(
                      "rounded-2xl border px-3 py-1 text-xs transition",
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
              <h1 className="text-2xl font-semibold leading-none text-white">{title}</h1>
              <p className="mt-0.5 max-w-3xl text-xs leading-4 text-slate-400">{subtitle}</p>
            </div>
          </div>
          {badge ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1.5 text-xs text-emerald-100">{badge}</div> : null}
        </div>
      </header>

      <div className={classNames("grid gap-2 lg:grid-cols-[minmax(0,1fr)_210px]", viewportLayout ? "min-h-0 flex-1" : "")}>
        <main className={classNames("min-w-0", viewportLayout ? "min-h-0" : "space-y-4", mainClassName)}>{children}</main>
        {aside ? <div className={classNames("lg:order-2", viewportLayout ? "min-h-0" : "", asideClassName)}>{aside}</div> : null}
      </div>
    </div>
  </div>
);
