import { classNames, titleCase } from "../lib/utils";

export const StatusBadge = ({ status }: { status: string }) => (
  <span
    className={classNames(
      "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
      status === "healthy" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
      status === "warning" && "border-amber-400/30 bg-amber-400/10 text-amber-200",
      status === "alert" && "border-rose-400/30 bg-rose-400/10 text-rose-200"
    )}
  >
    {titleCase(status)}
  </span>
);
