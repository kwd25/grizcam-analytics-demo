export const formatCompactNumber = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export const formatPercent = (value: number, digits = 1) =>
  new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

export const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);

export const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

export const formatHourLabel = (hour: number) => `${hour.toString().padStart(2, "0")}:00`;

export const titleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

