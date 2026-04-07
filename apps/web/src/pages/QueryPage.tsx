import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  QueryBuilderFilter,
  QueryBuilderState,
  QueryMetadataResponse,
  QueryOperator,
  QueryRelationMetadata,
  QueryRunResponse,
  QueryValidationIssue,
  QueryValidationResponse
} from "@grizcam/shared";
import { AppShell } from "../components/AppShell";
import { SectionCard } from "../components/SectionCard";
import { api, QueryRequestError } from "../lib/api";
import { appEnv } from "../lib/env";
import { classNames, formatNumber } from "../lib/utils";

const DISALLOWED_SQL = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|comment)\b/i;
type RequestStatus = "idle" | "validating" | "running" | "success" | "error" | "timeout";

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
const formatOperatorLabel = (value: string) => value.replace(/_/g, " ");

const makeFilterId = () => `filter-${Math.random().toString(36).slice(2, 10)}`;

const buildInitialState = (metadata: QueryMetadataResponse): QueryBuilderState => {
  const relation = metadata.relations.find((item) => item.category === "preferred") ?? metadata.relations[0];
  return {
    relation: relation.name,
    columns: relation.defaultColumns,
    aggregates: [],
    filters: [],
    groupBy: [],
    sort: relation.defaultColumns[0] ? [{ column: relation.defaultColumns[0], direction: "desc" }] : [],
    limit: relation.defaultLimit
  };
};

const escapeLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const getColumnType = (relation: QueryRelationMetadata | undefined, columnName: string) =>
  relation?.columns.find((column) => column.name === columnName)?.type ?? "text";

const parseInValues = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const formatFilterValue = (relation: QueryRelationMetadata | undefined, filter: QueryBuilderFilter) => {
  const type = getColumnType(relation, filter.column);
  const normalizeSingle = (value: string) => {
    if (type === "number" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return String(Number(value));
    }
    if (type === "boolean") {
      return value.toLowerCase() === "true" ? "true" : "false";
    }
    return escapeLiteral(value);
  };

  if (filter.operator === "IS NULL" || filter.operator === "IS NOT NULL") {
    return "";
  }

  if (filter.operator === "IN") {
    const values = parseInValues(filter.value ?? "");
    return `(${values.length > 0 ? values.map(normalizeSingle).join(", ") : "''"})`;
  }

  if (filter.operator === "BETWEEN") {
    const first = normalizeSingle(filter.value ?? "");
    const second = normalizeSingle(filter.secondValue ?? "");
    return `${first} and ${second}`;
  }

  return normalizeSingle(filter.value ?? "");
};

const buildBuilderSql = (metadata: QueryMetadataResponse | undefined, builder: QueryBuilderState | null) => {
  if (!metadata || !builder) {
    return "";
  }

  const relation = metadata.relations.find((item) => item.name === builder.relation);
  if (!relation) {
    return "";
  }

  const selectedColumns = builder.columns.length > 0 ? builder.columns : relation.defaultColumns;
  const groupBy = builder.aggregates.length > 0 ? (builder.groupBy.length > 0 ? builder.groupBy : selectedColumns) : builder.groupBy;
  const selectParts = [
    ...selectedColumns.map((column) => quoteIdentifier(column)),
    ...builder.aggregates.map((aggregate) => {
      const expression = aggregate.func === "COUNT" ? "count(*)" : `${aggregate.func.toLowerCase()}(${quoteIdentifier(aggregate.column)})`;
      const alias = aggregate.alias?.trim() || `${aggregate.func.toLowerCase()}_${aggregate.column}`;
      return `${expression} as ${quoteIdentifier(alias)}`;
    })
  ];

  const whereParts = builder.filters
    .filter((filter) => filter.column)
    .map((filter) => `${quoteIdentifier(filter.column)} ${filter.operator} ${formatFilterValue(relation, filter)}`.trim());

  const orderParts = builder.sort.filter((sort) => sort.column).map((sort) => `${quoteIdentifier(sort.column)} ${sort.direction}`);
  const lines = [`select ${selectParts.join(", ")}`, `from ${quoteIdentifier(relation.name)}`];

  if (whereParts.length > 0) {
    lines.push(`where ${whereParts.join(" and ")}`);
  }

  if (groupBy.length > 0) {
    lines.push(`group by ${groupBy.map((column) => quoteIdentifier(column)).join(", ")}`);
  }

  if (orderParts.length > 0) {
    lines.push(`order by ${orderParts.join(", ")}`);
  }

  lines.push(`limit ${Math.min(builder.limit || relation.defaultLimit, relation.maxLimit)}`);

  return lines.join("\n");
};

const frontendLint = (sql: string): QueryValidationIssue[] => {
  const trimmed = sql.trim();
  const issues: QueryValidationIssue[] = [];

  if (!trimmed) {
    issues.push({ code: "EMPTY_QUERY", message: "Enter a query to continue." });
  }
  if (/--|\/\*/.test(trimmed)) {
    issues.push({ code: "COMMENT_NOT_ALLOWED", message: "Comments are blocked in this workspace." });
  }
  if (trimmed.replace(/;\s*$/, "").includes(";")) {
    issues.push({ code: "MULTI_STATEMENT_NOT_ALLOWED", message: "Only one statement can run at a time." });
  }
  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    issues.push({ code: "NON_SELECT_NOT_ALLOWED", message: "Only SELECT queries are allowed." });
  }
  if (DISALLOWED_SQL.test(trimmed)) {
    issues.push({ code: "UNSAFE_KEYWORD", message: "Unsafe write or DDL keywords were detected." });
  }

  return issues;
};

const formatCellValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return <span className="text-slate-500">NULL</span>;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};

const applyExample = (metadata: QueryMetadataResponse, id: string): QueryBuilderState | null => {
  const relation = metadata.relations.find((item) => item.name === "daily_camera_summary") ?? metadata.relations[0];
  const eventsRelation = metadata.relations.find((item) => item.name === "events") ?? relation;

  switch (id) {
    case "daily-rollups":
      return {
        relation: relation.name,
        columns: ["date", "camera_name", "unique_event_groups", "avg_temperature", "avg_lux"],
        aggregates: [],
        filters: [],
        groupBy: [],
        sort: [
          { column: "date", direction: "desc" },
          { column: "camera_name", direction: "asc" }
        ],
        limit: 30
      };
    case "recent-events":
      return {
        relation: eventsRelation.name,
        columns: ["timestamp", "camera_name", "event", "subject_category", "analysis_title"],
        aggregates: [],
        filters: [],
        groupBy: [],
        sort: [{ column: "timestamp", direction: "desc" }],
        limit: 50
      };
    case "top-cameras":
      return {
        relation: relation.name,
        columns: ["camera_name"],
        aggregates: [{ column: "unique_event_groups", func: "SUM", alias: "total_event_groups" }],
        filters: [],
        groupBy: ["camera_name"],
        sort: [{ column: "total_event_groups", direction: "desc" }],
        limit: 10
      };
    case "category-counts":
      return {
        relation: eventsRelation.name,
        columns: ["subject_category"],
        aggregates: [{ column: "id", func: "COUNT", alias: "event_count" }],
        filters: [{ id: makeFilterId(), column: "subject_category", operator: "IS NOT NULL" }],
        groupBy: ["subject_category"],
        sort: [{ column: "event_count", direction: "desc" }],
        limit: 20
      };
    case "avg-voltage":
      return {
        relation: eventsRelation.name,
        columns: ["camera_name"],
        aggregates: [{ column: "voltage", func: "AVG", alias: "avg_voltage" }],
        filters: [{ id: makeFilterId(), column: "voltage", operator: "IS NOT NULL" }],
        groupBy: ["camera_name"],
        sort: [{ column: "avg_voltage", direction: "desc" }],
        limit: 20
      };
    default:
      return null;
  }
};

const QueryIssues = ({ issues, tone = "danger" }: { issues: QueryValidationIssue[]; tone?: "danger" | "muted" }) =>
  issues.length > 0 ? (
    <div
      className={classNames(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "danger" ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/5 text-slate-300"
      )}
    >
      <div className="font-medium">{tone === "danger" ? "Validation feedback" : "Workspace notes"}</div>
      <ul className="mt-2 space-y-1 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  ) : null;

const normalizeRequestIssues = (error: unknown): QueryValidationIssue[] => {
  if (!error) {
    return [];
  }

  if (error instanceof QueryRequestError) {
    return [
      {
        code: error.code === "TIMEOUT" ? "QUERY_TIMEOUT" : "EXECUTION_ERROR",
        message: error.message
      }
    ];
  }

  if (error instanceof Error) {
    return [{ code: "EXECUTION_ERROR", message: error.message }];
  }

  return [{ code: "EXECUTION_ERROR", message: "The query failed unexpectedly. Please retry." }];
};

const ResultsTable = ({
  result,
  status,
  overlayText
}: {
  result?: QueryRunResponse | null;
  status: RequestStatus;
  overlayText?: string;
}) => {
  if (!result && status === "running") {
    return (
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-10 text-center text-sm text-emerald-100">
        <div className="text-base font-medium">Running query…</div>
        <div className="mt-2 text-sm text-emerald-50/90">Queries auto-stop after 10 seconds if the response does not come back.</div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
        Run a safe query to inspect rows here.
      </div>
    );
  }

  if (!result.ok) {
    return <QueryIssues issues={result.issues} />;
  }

  if ((result.rowCount ?? 0) === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-10 text-center text-sm text-slate-300">
        The query ran successfully but returned no rows.
      </div>
    );
  }

  return (
    <div className="relative space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span>{formatNumber(result.rowCount ?? 0, 0)} rows</span>
        <span>{formatNumber(result.durationMs ?? 0, 0)} ms</span>
        <span>Applied limit: {formatNumber(result.appliedLimit ?? 0, 0)}</span>
      </div>
      <div className="overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-950/90 text-slate-400">
            <tr>
              {result.columns?.map((column) => (
                <th key={column.name} className="px-3 py-3 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows?.map((row, index) => (
              <tr key={index} className="border-t border-white/5 text-slate-200">
                {result.columns?.map((column) => (
                  <td key={`${index}-${column.name}`} className="max-w-[320px] px-3 py-3 align-top">
                    <div className="break-words">{formatCellValue(row[column.name])}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {status === "running" ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-emerald-400/20 bg-slate-950/75 backdrop-blur-sm">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-center text-sm text-emerald-100">
            <div className="font-medium">{overlayText ?? "Running query…"}</div>
            <div className="mt-2 text-xs text-emerald-50/90">Queries auto-stop after 10 seconds if the response hangs.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const QueryPage = () => {
  const metadataQuery = useQuery({
    queryKey: ["query-metadata"],
    queryFn: api.queryMetadata
  });
  const validateMutation = useMutation({
    mutationFn: (sql: string) => api.validateQuery(sql)
  });
  const runMutation = useMutation({
    mutationFn: (sql: string) => api.runQuery(sql)
  });

  const metadata = metadataQuery.data;
  const [builderState, setBuilderState] = useState<QueryBuilderState | null>(null);
  const [sql, setSql] = useState("");
  const [isCustomSql, setIsCustomSql] = useState(false);
  const [lastValidation, setLastValidation] = useState<QueryValidationResponse | null>(null);
  const [lastResult, setLastResult] = useState<QueryRunResponse | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [requestIssues, setRequestIssues] = useState<QueryValidationIssue[]>([]);

  useEffect(() => {
    if (!metadata || builderState) {
      return;
    }
    const initial = buildInitialState(metadata);
    setBuilderState(initial);
  }, [metadata, builderState]);

  const relation = useMemo(
    () => metadata?.relations.find((item) => item.name === builderState?.relation),
    [metadata, builderState?.relation]
  );

  useEffect(() => {
    if (!metadata || !builderState) {
      return;
    }
    const nextRelation = metadata.relations.find((item) => item.name === builderState.relation);
    if (!nextRelation) {
      return;
    }
    setBuilderState((current) =>
      current
        ? {
            ...current,
            columns: current.columns.filter((column) => nextRelation.columns.some((item) => item.name === column)),
            groupBy: current.groupBy.filter((column) => nextRelation.columns.some((item) => item.name === column)),
            aggregates: current.aggregates.filter((aggregate) => nextRelation.columns.some((item) => item.name === aggregate.column)),
            filters: current.filters.filter((filter) => nextRelation.columns.some((item) => item.name === filter.column)),
            sort: current.sort.filter((sort) => nextRelation.columns.some((item) => item.name === sort.column) || current.aggregates.some((aggregate) => (aggregate.alias?.trim() || `${aggregate.func.toLowerCase()}_${aggregate.column}`) === sort.column)),
            limit: Math.min(current.limit, nextRelation.maxLimit) || nextRelation.defaultLimit
          }
        : current
    );
  }, [metadata, builderState?.relation]);

  const generatedSql = useMemo(() => buildBuilderSql(metadata, builderState), [metadata, builderState]);
  const clientIssues = useMemo(() => frontendLint(sql), [sql]);
  const latestIssues = requestIssues.length > 0 ? requestIssues : lastValidation?.issues ?? [];
  const canRun = clientIssues.length === 0 && sql.trim().length > 0;
  const metadataIssues = useMemo(() => normalizeRequestIssues(metadataQuery.error), [metadataQuery.error]);

  useEffect(() => {
    if (!generatedSql) {
      return;
    }
    if (!isCustomSql || sql.trim().length === 0) {
      setSql(generatedSql);
    }
  }, [generatedSql, isCustomSql, sql]);

  const sortOptions = useMemo(() => {
    if (!relation || !builderState) {
      return [];
    }
    const aggregateAliases = builderState.aggregates.map((aggregate) => aggregate.alias?.trim() || `${aggregate.func.toLowerCase()}_${aggregate.column}`);
    return [...new Set([...relation.columns.filter((column) => column.sortable).map((column) => column.name), ...aggregateAliases])];
  }, [relation, builderState]);

  const setRelation = (relationName: string) => {
    if (!metadata) {
      return;
    }
    const nextRelation = metadata.relations.find((item) => item.name === relationName);
    if (!nextRelation) {
      return;
    }
    setBuilderState({
      relation: nextRelation.name,
      columns: nextRelation.defaultColumns,
      aggregates: [],
      filters: [],
      groupBy: [],
      sort: nextRelation.defaultColumns[0] ? [{ column: nextRelation.defaultColumns[0], direction: "desc" }] : [],
      limit: nextRelation.defaultLimit
    });
    setIsCustomSql(false);
  };

  const updateFilter = (id: string, patch: Partial<QueryBuilderFilter>) => {
    setBuilderState((current) =>
      current
        ? {
            ...current,
            filters: current.filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter))
          }
        : current
    );
  };

  const runValidation = async () => {
    setRequestStatus("validating");
    setRequestIssues([]);

    try {
      const result = await validateMutation.mutateAsync(sql);
      setLastValidation(result);
      setRequestStatus(result.ok ? "success" : "error");
      if (result.ok && result.normalizedSql) {
        setSql(result.normalizedSql);
      }
    } catch (error) {
      const issues = normalizeRequestIssues(error);
      setLastValidation({ ok: false, issues });
      setRequestIssues(issues);
      setRequestStatus(issues.some((issue) => issue.code === "QUERY_TIMEOUT") ? "timeout" : "error");
    }
  };

  const runQuery = async () => {
    setRequestStatus("running");
    setRequestIssues([]);

    try {
      const result = await runMutation.mutateAsync(sql);
      setLastResult(result);
      setLastValidation(result);
      setRequestStatus(result.ok ? "success" : result.issues.some((issue) => issue.code === "QUERY_TIMEOUT") ? "timeout" : "error");
      if (result.normalizedSql) {
        setSql(result.normalizedSql);
      }
    } catch (error) {
      const issues = normalizeRequestIssues(error);
      setLastValidation({ ok: false, issues });
      setRequestIssues(issues);
      setRequestStatus(issues.some((issue) => issue.code === "QUERY_TIMEOUT") ? "timeout" : "error");
    }
  };

  return (
    <AppShell
      title="Query"
      subtitle="Build safe read-only SQL against approved analytics relations. Use the guided builder, inspect the generated SQL, and run validated queries with enforced limits."
      badge={`${appEnv.demoLabel} • Read-only workspace`}
    >
      <SectionCard
        title="Safety Model"
        subtitle={metadata?.helpText.title ?? "Read-only query workspace"}
        actions={<span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">SELECT only</span>}
      >
        <p className="max-w-4xl text-sm leading-6 text-slate-300">
          {metadata?.helpText.body ??
            "The backend validates every query before execution. Comments, write statements, unsafe relations, and oversized limits are blocked server-side."}
        </p>
        {metadataQuery.isError ? <div className="mt-4"><QueryIssues issues={metadataIssues} /></div> : null}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard title="Query Builder" subtitle="Choose an approved relation, columns, filters, grouping, sort, and a capped row limit.">
          {metadataQuery.isError ? (
            <QueryIssues issues={metadataIssues} />
          ) : !metadata || !builderState || !relation ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
              Loading the approved query catalog…
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-300">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Relation</span>
                  <select
                    value={builderState.relation}
                    onChange={(event) => setRelation(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  >
                    {metadata.relations.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-300">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Limit</span>
                  <input
                    type="number"
                    min={1}
                    max={relation.maxLimit}
                    value={builderState.limit}
                    onChange={(event) =>
                      setBuilderState((current) =>
                        current
                          ? {
                              ...current,
                              limit: Math.max(1, Math.min(Number(event.target.value) || relation.defaultLimit, relation.maxLimit))
                            }
                          : current
                      )
                    }
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-slate-100 outline-none focus:border-emerald-400"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">Selectable columns</div>
                    <div className="mt-1 text-xs text-slate-400">{relation.description}</div>
                  </div>
                  <button
                    onClick={() =>
                      setBuilderState((current) =>
                        current
                          ? {
                              ...current,
                              columns: relation.defaultColumns,
                              groupBy: []
                            }
                          : current
                      )
                    }
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                  >
                    Reset columns
                  </button>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {relation.columns.map((column) => {
                    const checked = builderState.columns.includes(column.name);
                    return (
                      <label key={column.name} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                        <span>{column.label}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setBuilderState((current) =>
                              current
                                ? {
                                    ...current,
                                    columns: checked
                                      ? current.columns.filter((name) => name !== column.name)
                                      : [...current.columns, column.name]
                                  }
                                : current
                            )
                          }
                          className="h-4 w-4 rounded border-white/20 bg-transparent text-emerald-400"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-medium text-white">Aggregates</div>
                  <div className="mt-1 text-xs text-slate-400">Optional rollups for counts and telemetry summaries.</div>
                  <div className="mt-4 space-y-3">
                    {builderState.aggregates.map((aggregate, index) => (
                      <div key={`${aggregate.column}-${index}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <select
                          value={aggregate.func}
                          onChange={(event) =>
                            setBuilderState((current) =>
                              current
                                ? {
                                    ...current,
                                    aggregates: current.aggregates.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, func: event.target.value as typeof item.func } : item
                                    )
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                        >
                          {metadata.allowedAggregates.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <select
                          value={aggregate.column}
                          onChange={(event) =>
                            setBuilderState((current) =>
                              current
                                ? {
                                    ...current,
                                    aggregates: current.aggregates.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, column: event.target.value } : item
                                    )
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                        >
                          {relation.columns
                            .filter((column) => column.aggregates.length > 0)
                            .map((column) => (
                              <option key={column.name} value={column.name}>
                                {column.label}
                              </option>
                            ))}
                        </select>
                        <button
                          onClick={() =>
                            setBuilderState((current) =>
                              current
                                ? {
                                    ...current,
                                    aggregates: current.aggregates.filter((_, itemIndex) => itemIndex !== index)
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        setBuilderState((current) =>
                          current
                            ? {
                                ...current,
                                aggregates: [
                                  ...current.aggregates,
                                  {
                                    column: relation.columns.find((column) => column.aggregates.length > 0)?.name ?? relation.columns[0].name,
                                    func: "COUNT",
                                    alias: ""
                                  }
                                ]
                              }
                            : current
                        )
                      }
                      className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                    >
                      Add aggregate
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-medium text-white">Group by</div>
                  <div className="mt-1 text-xs text-slate-400">Used when you want aggregate values broken out by selected dimensions.</div>
                  <div className="mt-4 space-y-2">
                    {relation.columns
                      .filter((column) => column.groupable)
                      .map((column) => {
                        const checked = builderState.groupBy.includes(column.name);
                        return (
                          <label key={column.name} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                            <span>{column.label}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setBuilderState((current) =>
                                  current
                                    ? {
                                        ...current,
                                        groupBy: checked
                                          ? current.groupBy.filter((name) => name !== column.name)
                                          : [...current.groupBy, column.name]
                                      }
                                    : current
                                )
                              }
                              className="h-4 w-4 rounded border-white/20 bg-transparent text-emerald-400"
                            />
                          </label>
                        );
                      })}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">Filters</div>
                    <div className="mt-1 text-xs text-slate-400">Builder filters become safe SQL in the editor preview below.</div>
                  </div>
                  <button
                    onClick={() =>
                      setBuilderState((current) =>
                        current
                          ? {
                              ...current,
                              filters: [
                                ...current.filters,
                                {
                                  id: makeFilterId(),
                                  column: relation.columns[0].name,
                                  operator: relation.columns[0].filterOperators[0]
                                }
                              ]
                            }
                          : current
                      )
                    }
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                  >
                    Add filter
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {builderState.filters.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400">No filters yet.</div>
                  ) : (
                    builderState.filters.map((filter) => {
                      const column = relation.columns.find((item) => item.name === filter.column) ?? relation.columns[0];
                      return (
                        <div key={filter.id} className="grid gap-2 xl:grid-cols-[1.1fr_1fr_1fr_auto]">
                          <select
                            value={filter.column}
                            onChange={(event) => {
                              const nextColumn = relation.columns.find((item) => item.name === event.target.value) ?? relation.columns[0];
                              updateFilter(filter.id, { column: nextColumn.name, operator: nextColumn.filterOperators[0], value: "", secondValue: "" });
                            }}
                            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                          >
                            {relation.columns.map((item) => (
                              <option key={item.name} value={item.name}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                          <select
                            value={filter.operator}
                            onChange={(event) => updateFilter(filter.id, { operator: event.target.value as QueryOperator })}
                            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                          >
                            {column.filterOperators.map((operator) => (
                              <option key={operator} value={operator}>
                                {formatOperatorLabel(operator)}
                              </option>
                            ))}
                          </select>
                          <div className={classNames("grid gap-2", filter.operator === "BETWEEN" ? "grid-cols-2" : "grid-cols-1")}>
                            {filter.operator !== "IS NULL" && filter.operator !== "IS NOT NULL" ? (
                              <>
                                <input
                                  value={filter.value ?? ""}
                                  onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                                  placeholder={filter.operator === "IN" ? "value1, value2" : "Value"}
                                  className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                                />
                                {filter.operator === "BETWEEN" ? (
                                  <input
                                    value={filter.secondValue ?? ""}
                                    onChange={(event) => updateFilter(filter.id, { secondValue: event.target.value })}
                                    placeholder="And"
                                    className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                                  />
                                ) : null}
                              </>
                            ) : (
                              <div className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-sm text-slate-400">No value needed</div>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              setBuilderState((current) =>
                                current
                                  ? {
                                      ...current,
                                      filters: current.filters.filter((item) => item.id !== filter.id)
                                    }
                                  : current
                              )
                            }
                            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">Sort</div>
                    <div className="mt-1 text-xs text-slate-400">Sort on selected columns or aggregate aliases.</div>
                  </div>
                  <button
                    onClick={() =>
                      setBuilderState((current) =>
                        current
                          ? {
                              ...current,
                              sort: [...current.sort, { column: sortOptions[0] ?? relation.columns[0].name, direction: "desc" }]
                            }
                          : current
                      )
                    }
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                  >
                    Add sort
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {builderState.sort.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-400">No sort applied.</div>
                  ) : (
                    builderState.sort.map((sort, index) => (
                      <div key={`${sort.column}-${index}`} className="grid gap-2 md:grid-cols-[1fr_140px_auto]">
                        <select
                          value={sort.column}
                          onChange={(event) =>
                            setBuilderState((current) =>
                              current
                                ? {
                                    ...current,
                                    sort: current.sort.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, column: event.target.value } : item
                                    )
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                        >
                          {sortOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <select
                          value={sort.direction}
                          onChange={(event) =>
                            setBuilderState((current) =>
                              current
                                ? {
                                    ...current,
                                    sort: current.sort.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, direction: event.target.value as "asc" | "desc" } : item
                                    )
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                        >
                          <option value="asc">ASC</option>
                          <option value="desc">DESC</option>
                        </select>
                        <button
                          onClick={() =>
                            setBuilderState((current) =>
                              current
                                ? {
                                    ...current,
                                    sort: current.sort.filter((_, itemIndex) => itemIndex !== index)
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title="SQL Editor"
            subtitle="Inspect the generated SQL, tweak it manually when needed, and validate before running."
            actions={
              <div className="flex gap-2">
                <span
                  className={classNames(
                    "rounded-full border px-3 py-1 text-xs",
                    isCustomSql ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                  )}
                >
                  {isCustomSql ? "Custom SQL" : "Builder linked"}
                </span>
                <button
                  onClick={() => {
                    setIsCustomSql(false);
                    setSql(generatedSql);
                  }}
                  disabled={!generatedSql}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reset to builder SQL
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                Read-only SELECT queries only. The backend blocks comments, unsafe keywords, system catalogs, multi-statement SQL, and oversized limits.
              </div>
              <textarea
                value={sql}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSql(nextValue);
                  setIsCustomSql(nextValue !== generatedSql);
                }}
                spellCheck={false}
                className="min-h-[340px] w-full rounded-3xl border border-white/10 bg-slate-950/75 px-4 py-4 font-mono text-sm leading-6 text-slate-100 outline-none focus:border-emerald-400"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={runValidation}
                  disabled={requestStatus === "validating" || requestStatus === "running" || sql.trim().length === 0}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {requestStatus === "validating" ? "Validating…" : "Validate query"}
                </button>
                <button
                  onClick={runQuery}
                  disabled={!canRun || requestStatus === "running" || requestStatus === "validating"}
                  className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {requestStatus === "running" ? "Running…" : "Run query"}
                </button>
              </div>
              <QueryIssues issues={clientIssues} />
              {latestIssues.length > 0 && requestStatus !== "running" && requestStatus !== "validating" ? <QueryIssues issues={latestIssues} /> : null}
              {lastValidation?.ok ? (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  Validation passed. The backend will execute the normalized read-only query with a limit of {formatNumber(lastValidation.appliedLimit ?? 0, 0)} rows.
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Example Queries" subtitle="Load a starter query and then refine it with the builder or editor.">
            {!metadata ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
                Loading examples…
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {metadata.examples.map((example) => (
                  <button
                    key={example.id}
                    onClick={() => {
                      const nextState = applyExample(metadata, example.id);
                      if (nextState) {
                        setBuilderState(nextState);
                        setIsCustomSql(false);
                        setSql(buildBuilderSql(metadata, nextState));
                      } else {
                        setSql(example.sql);
                        setIsCustomSql(true);
                      }
                    }}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:bg-white/10"
                  >
                    <div className="text-sm font-medium text-white">{example.label}</div>
                    <div className="mt-1 text-xs text-slate-400">{example.description}</div>
                    <div className="mt-3 text-xs uppercase tracking-[0.18em] text-emerald-200">{example.relation}</div>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Results" subtitle="Validated query output appears here with row counts, timing, and the applied row cap.">
        <ResultsTable
          result={lastResult}
          status={requestStatus}
          overlayText={requestStatus === "running" ? "Running query…" : requestStatus === "validating" ? "Validating query…" : undefined}
        />
      </SectionCard>
    </AppShell>
  );
};
