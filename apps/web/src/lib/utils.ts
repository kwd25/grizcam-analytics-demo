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

export const formatEventTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return "Unknown time";
  }

  const normalized = value.replace("T", " ");
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized;
};

export const formatDurationShort = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "N/A";
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${(seconds / 3600).toFixed(1)}h`;
  }
  return `${(seconds / 86400).toFixed(1)}d`;
};

export const formatSignedNumber = (value: number, digits = 1) => {
  const formatted = formatNumber(Math.abs(value), digits);
  if (value > 0) {
    return `+${formatted}`;
  }
  if (value < 0) {
    return `-${formatted}`;
  }
  return formatted;
};

export const formatNullableNumber = (value: number | null | undefined, digits = 1, suffix = "") => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${formatNumber(value, digits)}${suffix}`;
};
