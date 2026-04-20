import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  QueryBuilderFilter,
  QueryBuilderState,
  QueryChatHistoryMessage,
  QueryFollowUpResponse,
  QueryLatestContext,
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
type ViewMode = "chat" | "manual";
type ComposerAction = "create-query" | "follow-up";

type CreateQueryChatMessage = {
  id: string;
  kind: "create-query";
  userIntentSummary: string;
  queryExplanation: string;
  sql: string;
  validation: QueryValidationResponse;
  result: QueryRunResponse | null;
  warning?: string;
};

type FollowUpChatMessage = {
  id: string;
  kind: "follow-up";
  answer: string;
  suggestedSql?: string;
  warning?: string;
};

type NoticeChatMessage = {
  id: string;
  kind: "notice";
  title: string;
  detail: string;
  tone: "danger" | "muted";
};

type UserChatMessage = {
  id: string;
  kind: "user";
  action: ComposerAction;
  text: string;
};

type ChatMessage = UserChatMessage | CreateQueryChatMessage | FollowUpChatMessage | NoticeChatMessage;

const AI_EXAMPLE_PROMPTS = [
  "what are the emptiest times of year",
  "top 10 busiest cameras in last 30 days",
  "show recent vehicle events"
];

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
const formatOperatorLabel = (value: string) => value.replace(/_/g, " ");
const makeFilterId = () => `filter-${Math.random().toString(36).slice(2, 10)}`;
const makeChatId = () => `msg-${Math.random().toString(36).slice(2, 10)}`;

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

const QueryIssues = ({ issues, tone = "danger" }: { issues?: QueryValidationIssue[]; tone?: "danger" | "muted" }) =>
  (issues?.length ?? 0) > 0 ? (
    <div
      className={classNames(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "danger" ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/5 text-slate-300"
      )}
    >
      <div className="font-medium">{tone === "danger" ? "Validation feedback" : "Workspace notes"}</div>
      <ul className="mt-2 space-y-1 text-sm">
        {issues?.map((issue, index) => (
          <li key={`${issue.code}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  ) : null;

const SelectionPills = ({ values, emptyLabel }: { values: string[]; emptyLabel: string }) => (
  <div className="flex flex-wrap gap-2">
    {values.length > 0 ? (
      values.map((value) => (
        <span key={value} className="rounded-full border border-white/10 bg-slate-950/60 px-2.5 py-1 text-xs text-slate-300">
          {value}
        </span>
      ))
    ) : (
      <span className="text-xs text-slate-500">{emptyLabel}</span>
    )}
  </div>
);

const MultiSelectDropdown = ({
  title,
  subtitle,
  values,
  options,
  onToggle,
  onReset,
  emptyLabel
}: {
  title: string;
  subtitle: string;
  values: string[];
  options: Array<{ name: string; label: string }>;
  onToggle: (name: string) => void;
  onReset?: () => void;
  emptyLabel: string;
}) => (
  <details className="group rounded-2xl border border-white/10 bg-white/5">
    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-0.5 text-[11px] text-slate-400">{subtitle}</div>
        <div className="mt-2">
          <SelectionPills values={values} emptyLabel={emptyLabel} />
        </div>
      </div>
      <div className="flex items-center gap-2 pl-3">
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-100">
          {values.length} selected
        </span>
        <span className="text-slate-400 transition group-open:rotate-180">v</span>
      </div>
    </summary>
    <div className="border-t border-white/10 px-3 py-3">
      <div className="mb-2 flex items-center justify-end">
        {onReset ? (
          <button
            onClick={onReset}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
          >
            Reset
          </button>
        ) : null}
      </div>
      <div className="grid max-h-64 gap-2 overflow-auto pr-1 md:grid-cols-2">
        {options.map((option) => {
          const checked = values.includes(option.name);
          return (
            <label
              key={option.name}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-950/40 px-3 py-2 text-sm text-slate-200"
            >
              <span className="truncate">{option.label}</span>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option.name)}
                className="h-4 w-4 rounded border-white/20 bg-transparent text-emerald-400"
              />
            </label>
          );
        })}
      </div>
    </div>
  </details>
);

const CompactBuilderSection = ({
  title,
  subtitle,
  summary,
  children,
  defaultOpen = false
}: {
  title: string;
  subtitle: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) => (
  <details className="group rounded-2xl border border-white/10 bg-white/5" open={defaultOpen}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-0.5 text-[11px] text-slate-400">{subtitle}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="max-w-[160px] truncate rounded-full border border-white/10 bg-slate-950/60 px-2.5 py-1 text-[11px] text-slate-300">
          {summary}
        </span>
        <span className="text-slate-400 transition group-open:rotate-180">v</span>
      </div>
    </summary>
    <div className="border-t border-white/10 px-3 py-3">{children}</div>
  </details>
);

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
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
    return <QueryIssues issues={result.issues ?? [{ code: "EXECUTION_ERROR", message: "The query failed without a structured error payload." }]} />;
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

const CodePanel = ({ title, code }: { title: string; code: string }) => (
  <div className="space-y-2">
    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</div>
    <pre className="overflow-auto rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-xs leading-6 text-slate-100">
      <code>{code}</code>
    </pre>
  </div>
);

const summarizeLatestQuery = (sql: string, validation: QueryValidationResponse | null, result: QueryRunResponse | null): QueryLatestContext | undefined => {
  if (!sql.trim() && !validation && !result) {
    return undefined;
  }

  return {
    sql: sql.trim() || undefined,
    validation: validation
      ? {
          ok: validation.ok,
          appliedLimit: validation.appliedLimit,
          issues: validation.issues.map((issue) => issue.message)
        }
      : undefined,
    result: result
      ? {
          rowCount: result.rowCount,
          durationMs: result.durationMs,
          appliedLimit: result.appliedLimit,
          columns: result.columns?.map((column) => column.name)
        }
      : undefined
  };
};

const buildFollowUpHistory = (messages: ChatMessage[]): QueryChatHistoryMessage[] =>
  messages
    .filter((message) => message.kind !== "notice")
    .map((message) => {
      if (message.kind === "user") {
        return {
          role: "user",
          content: `[${message.action}] ${message.text}`
        };
      }

      if (message.kind === "create-query") {
        const outcome = message.result?.ok ? `Query ran and returned ${message.result.rowCount ?? 0} rows.` : "Query did not complete successfully.";
        return {
          role: "assistant",
          content: `What I heard:\n${message.userIntentSummary}\n\nHow I approached it:\n${message.queryExplanation}\n\nGenerated SQL:\n${message.sql}\n\nValidation: ${message.validation.ok ? "passed" : "failed"}.\n${outcome}`
        };
      }

      return {
        role: "assistant",
        content: `${message.answer}${message.suggestedSql ? `\nSuggested SQL:\n${message.suggestedSql}` : ""}`
      };
    });

const renderInlineMarkdown = (text: string) => {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) =>
    /^`[^`]+`$/.test(part) ? (
      <code key={index} className="rounded bg-slate-950/70 px-1.5 py-0.5 text-[0.95em] text-sky-100">
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={index}>{part}</span>
    )
  );
};

const MarkdownMessage = ({ markdown }: { markdown: string }) => {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const blocks = normalized.length > 0 ? normalized.split(/\n\s*\n/) : [];

  return (
    <div className="space-y-3 text-sm leading-7 text-slate-200">
      {blocks.map((block, blockIndex) => {
        const trimmed = block.trim();
        if (/^```/.test(trimmed) && trimmed.endsWith("```")) {
          const code = trimmed.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
          return (
            <pre key={blockIndex} className="overflow-auto rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-xs leading-6 text-slate-100">
              <code>{code}</code>
            </pre>
          );
        }

        const lines = trimmed.split("\n");
        const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line.trim()));
        if (bulletLines.length === lines.length && bulletLines.length > 0) {
          return (
            <ul key={blockIndex} className="space-y-2 pl-5 text-slate-200">
              {bulletLines.map((line, lineIndex) => (
                <li key={lineIndex} className="list-disc">
                  {renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={blockIndex} className="whitespace-pre-wrap">
            {renderInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
};

const ModeSidebar = ({
  viewMode,
  onSelectMode,
  onPromptExample,
  latestQuery
}: {
  viewMode: ViewMode;
  onSelectMode: (mode: ViewMode) => void;
  onPromptExample: (prompt: string) => void;
  latestQuery: QueryLatestContext | undefined;
}) => (
  <aside className="panel h-full rounded-[24px] p-2.5 overflow-auto">
    <div className="mb-2.5">
      <h2 className="text-base font-semibold text-white">Query Workspace</h2>
      <p className="mt-1 text-[11px] leading-4 text-slate-400">Chat is the primary experience. Switch to Manual when you want the full builder and raw editor controls.</p>
    </div>
    <div className="space-y-2">
      {(["chat", "manual"] as ViewMode[]).map((mode) => (
        <button
          key={mode}
          onClick={() => onSelectMode(mode)}
          className={classNames(
            "w-full rounded-2xl border px-3 py-2 text-left transition",
            viewMode === mode
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          )}
        >
          <div className="text-sm font-medium leading-none">{mode === "chat" ? "Chat" : "Manual"}</div>
          <div className="mt-1 text-[11px] leading-4 text-current/80">
            {mode === "chat" ? "Ask for queries and follow up on results." : "Use the full builder, SQL editor, and export flow."}
          </div>
        </button>
      ))}
    </div>

    <div className="mt-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Example prompts</div>
      <div className="mt-2 space-y-2">
        {AI_EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptExample(prompt)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>

    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Latest query context</div>
      {latestQuery?.sql ? (
        <div className="mt-2 space-y-2 text-sm text-slate-300">
          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-[11px] leading-4 text-slate-200">
            Validation: {latestQuery.validation?.ok ? "passed" : "not yet valid"}
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-[11px] leading-4 text-slate-400">
            {latestQuery.result?.rowCount !== undefined
              ? `${formatNumber(latestQuery.result.rowCount, 0)} rows • ${formatNumber(latestQuery.result.durationMs ?? 0, 0)} ms`
              : "No executed result yet"}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No query has been generated yet.</p>
      )}
    </div>
  </aside>
);

const ChatTranscript = ({
  messages,
  isBusy,
  requestStatus,
  onUseSuggestedSql
}: {
  messages: ChatMessage[];
  isBusy: boolean;
  requestStatus: RequestStatus;
  onUseSuggestedSql: (sql: string) => void;
}) => (
  <div className="space-y-5 px-1 pb-2">
    {messages.length === 0 ? (
      <div className="rounded-3xl border border-dashed border-white/10 px-6 py-12 text-center">
        <div className="text-lg font-medium text-white">Ask for a query or follow up on the data</div>
        <p className="mt-2 text-sm text-slate-400">Use Create query to generate and run SQL. Use Follow up to ask about the data, schema, or how to refine the last query.</p>
      </div>
    ) : null}
    {messages.map((message) => {
      if (message.kind === "user") {
        return (
          <div key={message.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-[28px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/80">
                {message.action === "create-query" ? "Create query" : "Follow up"}
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-50">{message.text}</div>
            </div>
          </div>
        );
      }

      if (message.kind === "notice") {
        return (
          <div key={message.id} className="flex justify-start">
            <div className="max-w-[85%] rounded-[28px] border border-white/10 bg-white/5 px-4 py-3">
              <div className="text-sm font-medium text-white">{message.title}</div>
              <div className="mt-2 text-sm leading-6 text-slate-300">{message.detail}</div>
              <div className="mt-3">
                <QueryIssues issues={[{ code: "EXECUTION_ERROR", message: message.detail }]} tone={message.tone} />
              </div>
            </div>
          </div>
        );
      }

      if (message.kind === "follow-up") {
        return (
          <div key={message.id} className="flex justify-start">
            <div className="max-w-[92%] rounded-[28px] border border-white/10 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Follow up</div>
              <div className="mt-3">
                <MarkdownMessage markdown={message.answer} />
              </div>
              {message.warning ? (
                <div className="mt-3">
                  <QueryIssues issues={[{ code: "INVALID_QUERY", message: message.warning }]} tone="muted" />
                </div>
              ) : null}
              {message.suggestedSql ? (
                <div className="mt-4 space-y-3">
                  <CodePanel title="Suggested SQL draft" code={message.suggestedSql} />
                  <button
                    onClick={() => onUseSuggestedSql(message.suggestedSql!)}
                    className="rounded-xl border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs text-sky-100 transition hover:bg-sky-400/20"
                  >
                    Use in editor
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      }

      return (
        <div key={message.id} className="flex justify-start">
          <div className="max-w-[96%] space-y-5 rounded-[32px] border border-white/10 bg-white/5 px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-100">
                {message.validation.ok ? "Validation passed" : "Validation failed"}
              </span>
              {message.result?.ok ? (
                <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[11px] text-sky-100">
                  Query ran
                </span>
              ) : null}
              {message.result?.ok ? (
                <span className="text-xs text-slate-400">
                  {formatNumber(message.result.rowCount ?? 0, 0)} rows • {formatNumber(message.result.durationMs ?? 0, 0)} ms
                </span>
              ) : null}
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">What I heard</div>
                <div className="mt-2 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-sm leading-7 text-slate-200">
                  <MarkdownMessage markdown={message.userIntentSummary} />
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">How I approached it</div>
                <div className="mt-2 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-sm leading-7 text-slate-200">
                  <MarkdownMessage markdown={message.queryExplanation} />
                </div>
              </div>
            </div>
            <CodePanel title="Generated SQL" code={message.sql} />
            {message.warning ? <QueryIssues issues={[{ code: "INVALID_QUERY", message: message.warning }]} tone="muted" /> : null}
            {!message.validation.ok ? <QueryIssues issues={message.validation.issues} /> : null}
            {message.validation.ok ? (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                Validation passed. The normalized query is ready in Manual mode if you want to tweak it.
              </div>
            ) : null}
            {message.result ? (
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Query output</div>
                <ResultsTable result={message.result} status={requestStatus === "running" && isBusy ? "running" : "success"} />
              </div>
            ) : null}
          </div>
        </div>
      );
    })}
  </div>
);

const ChatWorkspace = ({
  messages,
  composerText,
  composerAction,
  onComposerTextChange,
  onComposerActionChange,
  onSubmit,
  onUseSuggestedSql,
  isBusy,
  error,
  requestStatus
}: {
  messages: ChatMessage[];
  composerText: string;
  composerAction: ComposerAction;
  onComposerTextChange: (value: string) => void;
  onComposerActionChange: (action: ComposerAction) => void;
  onSubmit: () => void;
  onUseSuggestedSql: (sql: string) => void;
  isBusy: boolean;
  error: string | null;
  requestStatus: RequestStatus;
}) => {
  const logRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    const node = logRef.current;
    if (!node || !shouldStickToBottomRef.current) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages, isBusy]);

  return (
    <>
      <SectionCard
        title="Query Chat"
        subtitle="Ask for a query or follow up with questions about the dataset, validation feedback, or how to refine the latest SQL."
        className="h-full min-h-0 overflow-hidden"
        contentClassName="flex min-h-0 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={logRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
              shouldStickToBottomRef.current = distanceFromBottom < 120;
            }}
            className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 pb-6"
          >
            <ChatTranscript messages={messages} isBusy={isBusy} requestStatus={requestStatus} onUseSuggestedSql={onUseSuggestedSql} />
          </div>
          <div className="mt-1.5 shrink-0 border-t border-white/10 pt-2">
            <div className="rounded-[24px] border border-white/10 bg-slate-950/90 p-2 shadow-[0_-12px_32px_rgba(2,6,23,0.22)]">
              <textarea
                value={composerText}
                onChange={(event) => onComposerTextChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder={composerAction === "create-query" ? "Ask for a query in plain English" : "Ask about the data, the query, or what a result means"}
                spellCheck={false}
                rows={2}
                className="max-h-20 min-h-[44px] w-full resize-none overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm leading-5 text-slate-100 outline-none transition focus:border-emerald-400"
              />
              <div className="mt-1.5 flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap gap-2">
                  {(["create-query", "follow-up"] as ComposerAction[]).map((action) => (
                    <button
                      key={action}
                      onClick={() => onComposerActionChange(action)}
                      className={classNames(
                        "rounded-full border px-3 py-1.5 text-xs font-medium leading-none transition",
                        composerAction === action
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      )}
                    >
                      {action === "create-query" ? "Create query" : "Follow up"}
                    </button>
                  ))}
                </div>
                <button
                  onClick={onSubmit}
                  disabled={isBusy || composerText.trim().length === 0}
                  className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? (composerAction === "create-query" ? "Working…" : "Thinking…") : composerAction === "create-query" ? "Send create query" : "Send follow up"}
                </button>
              </div>
              {error ? <div className="mt-2 text-xs text-rose-200">{error}</div> : null}
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  );
};

type ManualWorkspaceProps = {
  metadataQueryError: boolean;
  metadataIssues: QueryValidationIssue[];
  metadata?: QueryMetadataResponse;
  builderState: QueryBuilderState | null;
  relation?: QueryRelationMetadata;
  aggregateSummary: string;
  filterSummary: string;
  sortSummary: string;
  sortOptions: string[];
  setRelation: (relationName: string) => void;
  setBuilderState: Dispatch<SetStateAction<QueryBuilderState | null>>;
  updateFilter: (id: string, patch: Partial<QueryBuilderFilter>) => void;
  loadExample: (id: string, fallbackSql: string) => void;
  sql: string;
  generatedSql: string;
  setSql: (value: string) => void;
  isCustomSql: boolean;
  setIsCustomSql: (value: boolean) => void;
  lastGeneratedByAi: boolean;
  setLastGeneratedByAi: (value: boolean) => void;
  requestStatus: RequestStatus;
  runValidation: (nextSql?: string) => Promise<QueryValidationResponse>;
  runQuery: (nextSql?: string) => Promise<QueryRunResponse>;
  exportResults: () => Promise<void>;
  clientIssues: QueryValidationIssue[];
  latestIssues: QueryValidationIssue[];
  lastValidation: QueryValidationResponse | null;
  lastResult: QueryRunResponse | null;
  canRun: boolean;
  canExport: boolean;
  exportPending: boolean;
};

const ManualWorkspace = ({
  metadataQueryError,
  metadataIssues,
  metadata,
  builderState,
  relation,
  aggregateSummary,
  filterSummary,
  sortSummary,
  sortOptions,
  setRelation,
  setBuilderState,
  updateFilter,
  loadExample,
  sql,
  generatedSql,
  setSql,
  isCustomSql,
  setIsCustomSql,
  lastGeneratedByAi,
  setLastGeneratedByAi,
  requestStatus,
  runValidation,
  runQuery,
  exportResults,
  clientIssues,
  latestIssues,
  lastValidation,
  lastResult,
  canRun,
  canExport,
  exportPending
}: ManualWorkspaceProps) => (
  <>
    <SectionCard
      title="Manual Workspace"
      subtitle="Builder controls, direct SQL editing, and export remain available here."
      actions={<span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">SELECT only</span>}
    >
      <p className="max-w-4xl text-sm leading-6 text-slate-300">
        The backend still validates every query before execution. Generated SQL from Chat mode lands here automatically so you can inspect and tweak it.
      </p>
      {metadataQueryError ? (
        <div className="mt-4">
          <QueryIssues issues={metadataIssues} />
        </div>
      ) : null}
    </SectionCard>

    {metadata ? (
      <SectionCard title="Examples" subtitle="Load a known-safe sample into the builder or editor.">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {metadata.examples.map((example) => (
            <button
              key={example.id}
              onClick={() => loadExample(example.id, example.sql)}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left transition hover:bg-white/10"
            >
              <div className="text-sm font-medium text-white">{example.label}</div>
              <div className="mt-1 text-xs text-slate-400">{example.description}</div>
            </button>
          ))}
        </div>
      </SectionCard>
    ) : null}

    <div className="grid gap-4">
      <SectionCard
        title="Query Builder"
        subtitle="Choose a dataset, pick the fields you want, and narrow the results with filters, grouping, and sorting."
      >
        {metadataQueryError ? (
          <QueryIssues issues={metadataIssues} />
        ) : !metadata || !builderState || !relation ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
            Loading the approved query catalog…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_140px]">
              <label className="space-y-2 text-sm text-slate-300">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Relation</span>
                <select
                  value={builderState.relation}
                  onChange={(event) => setRelation(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
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
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </label>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <MultiSelectDropdown
                title="Selectable columns"
                subtitle={relation.description}
                values={builderState.columns}
                options={relation.columns.map((column) => ({ name: column.name, label: column.label }))}
                onToggle={(name) =>
                  setBuilderState((current) =>
                    current
                      ? {
                          ...current,
                          columns: current.columns.includes(name)
                            ? current.columns.filter((value) => value !== name)
                            : [...current.columns, name]
                        }
                      : current
                  )
                }
                onReset={() =>
                  setBuilderState((current) =>
                    current
                      ? {
                          ...current,
                          columns: relation.defaultColumns,
                          groupBy: current.groupBy.filter((column) => relation.defaultColumns.includes(column))
                        }
                      : current
                  )
                }
                emptyLabel="No columns selected yet."
              />

              <MultiSelectDropdown
                title="Group by"
                subtitle="Choose dimensions for aggregate breakouts."
                values={builderState.groupBy}
                options={relation.columns.filter((column) => column.groupable).map((column) => ({ name: column.name, label: column.label }))}
                onToggle={(name) =>
                  setBuilderState((current) =>
                    current
                      ? {
                          ...current,
                          groupBy: current.groupBy.includes(name)
                            ? current.groupBy.filter((value) => value !== name)
                            : [...current.groupBy, name]
                        }
                      : current
                  )
                }
                onReset={() =>
                  setBuilderState((current) =>
                    current
                      ? {
                          ...current,
                          groupBy: []
                        }
                      : current
                  )
                }
                emptyLabel="No grouping applied."
              />
            </div>

            <div className="grid gap-3 xl:grid-cols-3">
              <CompactBuilderSection title="Aggregates" subtitle="Optional rollups for metric summaries." summary={aggregateSummary}>
                <div className="space-y-2">
                  {builderState.aggregates.map((aggregate, index) => (
                    <div key={`${aggregate.column}-${index}`} className="grid gap-2 lg:grid-cols-[110px_minmax(0,1fr)_auto]">
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
                        className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
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
                        className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
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
                        X
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
                    className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/10"
                  >
                    Add aggregate
                  </button>
                </div>
              </CompactBuilderSection>

              <CompactBuilderSection title="Filters" subtitle="Safe row-level conditions." summary={filterSummary} defaultOpen={builderState.filters.length > 0}>
                <div className="mb-2 flex items-center justify-end">
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
                <div className="space-y-2">
                  {builderState.filters.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-xs text-slate-400">No filters yet.</div>
                  ) : (
                    builderState.filters.map((filter) => {
                      const column = relation.columns.find((item) => item.name === filter.column) ?? relation.columns[0];
                      return (
                        <div key={filter.id} className="grid gap-2 rounded-2xl border border-white/5 bg-slate-950/35 p-2.5">
                          <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_130px_auto]">
                            <select
                              value={filter.column}
                              onChange={(event) => {
                                const nextColumn = relation.columns.find((item) => item.name === event.target.value) ?? relation.columns[0];
                                updateFilter(filter.id, { column: nextColumn.name, operator: nextColumn.filterOperators[0], value: "", secondValue: "" });
                              }}
                              className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
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
                              className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                            >
                              {column.filterOperators.map((operator) => (
                                <option key={operator} value={operator}>
                                  {formatOperatorLabel(operator)}
                                </option>
                              ))}
                            </select>
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
                              X
                            </button>
                          </div>
                          <div className={classNames("grid gap-2", filter.operator === "BETWEEN" ? "md:grid-cols-2" : "grid-cols-1")}>
                            {filter.operator !== "IS NULL" && filter.operator !== "IS NOT NULL" ? (
                              <>
                                <input
                                  value={filter.value ?? ""}
                                  onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                                  placeholder={filter.operator === "IN" ? "value1, value2" : "Value"}
                                  className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                                />
                                {filter.operator === "BETWEEN" ? (
                                  <input
                                    value={filter.secondValue ?? ""}
                                    onChange={(event) => updateFilter(filter.id, { secondValue: event.target.value })}
                                    placeholder="And"
                                    className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
                                  />
                                ) : null}
                              </>
                            ) : (
                              <div className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-xs text-slate-400">No value needed</div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CompactBuilderSection>

              <CompactBuilderSection title="Sort" subtitle="Selected columns or aggregate aliases." summary={sortSummary} defaultOpen={builderState.sort.length > 0}>
                <div className="mb-2 flex items-center justify-end">
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
                <div className="space-y-2">
                  {builderState.sort.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-xs text-slate-400">No sort applied.</div>
                  ) : (
                    builderState.sort.map((sort, index) => (
                      <div key={`${sort.column}-${index}`} className="grid gap-2 rounded-2xl border border-white/5 bg-slate-950/35 p-2.5 xl:grid-cols-[minmax(0,1fr)_120px_auto]">
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
                          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
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
                          className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-emerald-400"
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
                          X
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </CompactBuilderSection>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="SQL Editor"
        subtitle="Write or edit a query, validate it, and run it when it looks right."
        actions={
          <div className="flex flex-wrap gap-2">
            {lastGeneratedByAi ? (
              <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs text-sky-100">Generated by AI</span>
            ) : null}
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
                setLastGeneratedByAi(false);
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
            Use read-only SELECT queries only. You can filter, group, join approved datasets, and work with CTEs or subqueries.
          </div>
          <textarea
            value={sql}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSql(nextValue);
              setIsCustomSql(nextValue !== generatedSql);
              if (lastGeneratedByAi && nextValue !== generatedSql) {
                setLastGeneratedByAi(true);
              }
            }}
            spellCheck={false}
            className="min-h-[320px] w-full rounded-3xl border border-white/10 bg-slate-950/75 px-4 py-4 font-mono text-sm leading-6 text-slate-100 outline-none focus:border-emerald-400"
          />
          <div className="text-xs text-slate-400">Generated SQL stays editable. You can inspect and tweak it before or after validation.</div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => void runValidation()}
              disabled={requestStatus === "validating" || requestStatus === "running" || sql.trim().length === 0}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {requestStatus === "validating" ? "Validating…" : "Validate query"}
            </button>
            <button
              onClick={() => void runQuery()}
              disabled={!canRun || requestStatus === "running" || requestStatus === "validating"}
              className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {requestStatus === "running" ? "Running…" : "Run query"}
            </button>
            <button
              onClick={() => void exportResults()}
              disabled={!canExport || exportPending}
              className="rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm font-medium text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exportPending ? "Exporting…" : "Export CSV"}
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

      <SectionCard
        title="Results"
        subtitle="Validated query output appears here with row counts, timing, and the applied row cap."
        actions={
          <button
            onClick={() => void exportResults()}
            disabled={!canExport || exportPending}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exportPending ? "Exporting…" : "Export CSV"}
          </button>
        }
      >
        <ResultsTable
          result={lastResult}
          status={requestStatus}
          overlayText={requestStatus === "running" ? "Running query…" : requestStatus === "validating" ? "Validating query…" : undefined}
        />
      </SectionCard>
    </div>
  </>
);

export const QueryPage = () => {
  const metadataQuery = useQuery({
    queryKey: ["query-metadata"],
    queryFn: api.queryMetadata
  });
  const generateSqlMutation = useMutation({
    mutationFn: (prompt: string) => api.generateQuerySql(prompt)
  });
  const followUpMutation = useMutation({
    mutationFn: api.queryFollowUp
  });
  const validateMutation = useMutation({
    mutationFn: (sql: string) => api.validateQuery(sql)
  });
  const runMutation = useMutation({
    mutationFn: (sql: string) => api.runQuery(sql)
  });
  const exportMutation = useMutation({
    mutationFn: (sql: string) => api.exportQuery(sql)
  });

  const metadata = metadataQuery.data;
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  const [composerAction, setComposerAction] = useState<ComposerAction>("create-query");
  const [composerText, setComposerText] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [builderState, setBuilderState] = useState<QueryBuilderState | null>(null);
  const [sql, setSql] = useState("");
  const [isCustomSql, setIsCustomSql] = useState(false);
  const [lastValidation, setLastValidation] = useState<QueryValidationResponse | null>(null);
  const [lastResult, setLastResult] = useState<QueryRunResponse | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [requestIssues, setRequestIssues] = useState<QueryValidationIssue[]>([]);
  const [lastGeneratedByAi, setLastGeneratedByAi] = useState(false);

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
            sort: current.sort.filter(
              (sort) =>
                nextRelation.columns.some((item) => item.name === sort.column) ||
                current.aggregates.some((aggregate) => (aggregate.alias?.trim() || `${aggregate.func.toLowerCase()}_${aggregate.column}`) === sort.column)
            ),
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
  const canExport = sql.trim().length > 0 && clientIssues.length === 0 && requestStatus !== "running" && requestStatus !== "validating";
  const aggregateSummary = builderState?.aggregates.length
    ? `${builderState.aggregates.length} aggregate${builderState.aggregates.length === 1 ? "" : "s"}`
    : "No aggregates";
  const filterSummary = builderState?.filters.length ? `${builderState.filters.length} filter${builderState.filters.length === 1 ? "" : "s"}` : "No filters";
  const sortSummary = builderState?.sort.length ? `${builderState.sort.length} sort rule${builderState.sort.length === 1 ? "" : "s"}` : "No sorting";
  const isBusy = requestStatus === "validating" || requestStatus === "running" || generateSqlMutation.isPending || followUpMutation.isPending;

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

  const latestQueryContext = useMemo(() => summarizeLatestQuery(sql, lastValidation, lastResult), [sql, lastValidation, lastResult]);

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
    setLastGeneratedByAi(false);
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

  const loadExample = (id: string, fallbackSql: string) => {
    if (!metadata) {
      return;
    }
    const nextState = applyExample(metadata, id);
    if (nextState) {
      setBuilderState(nextState);
      setIsCustomSql(false);
      setSql(buildBuilderSql(metadata, nextState));
      setLastGeneratedByAi(false);
      return;
    }

    setSql(fallbackSql);
    setIsCustomSql(true);
    setLastGeneratedByAi(false);
  };

  const runValidation = async (nextSql?: string) => {
    const targetSql = nextSql ?? sql;
    setRequestStatus("validating");
    setRequestIssues([]);

    try {
      const result = await validateMutation.mutateAsync(targetSql);
      setLastValidation(result);
      setRequestStatus(result.ok ? "success" : "error");
      if (result.ok && result.normalizedSql) {
        setSql(result.normalizedSql);
      }
      return result;
    } catch (error) {
      const issues = normalizeRequestIssues(error);
      setLastValidation({ ok: false, issues });
      setRequestIssues(issues);
      setRequestStatus(issues.some((issue) => issue.code === "QUERY_TIMEOUT") ? "timeout" : "error");
      return { ok: false, issues } satisfies QueryValidationResponse;
    }
  };

  const runQuery = async (nextSql?: string) => {
    const targetSql = nextSql ?? sql;
    setRequestStatus("running");
    setRequestIssues([]);

    try {
      const result = await runMutation.mutateAsync(targetSql);
      setLastResult(result);
      setLastValidation(result);
      setRequestStatus(result.ok ? "success" : result.issues.some((issue) => issue.code === "QUERY_TIMEOUT") ? "timeout" : "error");
      if (result.normalizedSql) {
        setSql(result.normalizedSql);
      }
      return result;
    } catch (error) {
      const issues = normalizeRequestIssues(error);
      setLastValidation({ ok: false, issues });
      setRequestIssues(issues);
      setRequestStatus(issues.some((issue) => issue.code === "QUERY_TIMEOUT") ? "timeout" : "error");
      return { ok: false, issues } as QueryRunResponse;
    }
  };

  const exportResults = async () => {
    setRequestIssues([]);

    try {
      const blob = await exportMutation.mutateAsync(sql);
      downloadBlob(blob, "grizcam-query-results.csv");
    } catch (error) {
      const issues = normalizeRequestIssues(error);
      setRequestIssues(issues);
      setRequestStatus(issues.some((issue) => issue.code === "QUERY_TIMEOUT") ? "timeout" : "error");
    }
  };

  const pushUserMessage = (action: ComposerAction, text: string) => {
    const message: UserChatMessage = { id: makeChatId(), kind: "user", action, text };
    setChatMessages((current) => [...current, message]);
    return message;
  };

  const pushNotice = (title: string, detail: string, tone: "danger" | "muted" = "danger") => {
    const message: NoticeChatMessage = { id: makeChatId(), kind: "notice", title, detail, tone };
    setChatMessages((current) => [...current, message]);
  };

  const handleCreateQuery = async (prompt: string) => {
    try {
      const generated = await generateSqlMutation.mutateAsync(prompt);
      const lintIssues = frontendLint(generated.sql);

      setSql(generated.sql);
      setIsCustomSql(true);
      setLastGeneratedByAi(true);

      if (lintIssues.length > 0) {
        const validation = { ok: false, issues: lintIssues } satisfies QueryValidationResponse;
        setLastValidation(validation);
        setRequestIssues(lintIssues);
        setChatMessages((current) => [
          ...current,
          {
            id: makeChatId(),
            kind: "create-query",
            userIntentSummary: generated.userIntentSummary,
            queryExplanation: generated.queryExplanation,
            sql: generated.sql,
            validation,
            result: null,
            warning: generated.warning
          }
        ]);
        return;
      }

      const validation = await runValidation(generated.sql);
      if (!validation.ok) {
        setChatMessages((current) => [
          ...current,
          {
            id: makeChatId(),
            kind: "create-query",
            userIntentSummary: generated.userIntentSummary,
            queryExplanation: generated.queryExplanation,
            sql: generated.sql,
            validation,
            result: null,
            warning: generated.warning
          }
        ]);
        return;
      }

      const runResult = await runQuery(validation.normalizedSql ?? generated.sql);
      setChatMessages((current) => [
        ...current,
        {
          id: makeChatId(),
          kind: "create-query",
          userIntentSummary: generated.userIntentSummary,
          queryExplanation: generated.queryExplanation,
          sql: validation.normalizedSql ?? generated.sql,
          validation,
          result: runResult,
          warning: generated.warning
        }
      ]);
    } catch (error) {
      const message =
        error instanceof QueryRequestError ? error.message : error instanceof Error ? error.message : "The create-query assistant failed unexpectedly.";
      setChatError(message);
      pushNotice("Create query failed", message, "danger");
    }
  };

  const handleFollowUp = async (prompt: string, historyMessages: ChatMessage[]) => {
    try {
      const result: QueryFollowUpResponse = await followUpMutation.mutateAsync({
        prompt,
        history: buildFollowUpHistory(historyMessages),
        latestQuery: latestQueryContext
      });

      setChatMessages((current) => [
        ...current,
        {
          id: makeChatId(),
          kind: "follow-up",
          answer: result.answer,
          suggestedSql: result.suggestedSql,
          warning: result.warning
        }
      ]);
    } catch (error) {
      const message =
        error instanceof QueryRequestError ? error.message : error instanceof Error ? error.message : "The follow-up assistant failed unexpectedly.";
      setChatError(message);
      pushNotice("Follow up failed", message, "danger");
    }
  };

  const submitComposer = async (forcedAction?: ComposerAction, forcedPrompt?: string) => {
    const action = forcedAction ?? composerAction;
    const prompt = (forcedPrompt ?? composerText).trim();
    if (!prompt) {
      setChatError("Enter a prompt to continue.");
      return;
    }

    setChatError(null);
    const userMessage = pushUserMessage(action, prompt);
    const nextHistory = [...chatMessages, userMessage];

    if (!forcedPrompt) {
      setComposerText("");
    }

    if (action === "create-query") {
      await handleCreateQuery(prompt);
      return;
    }

    await handleFollowUp(prompt, nextHistory);
  };

  const useSuggestedSql = (suggestedSql: string) => {
    setSql(suggestedSql);
    setIsCustomSql(true);
    setLastGeneratedByAi(false);
    setViewMode("manual");
  };

  return (
    <AppShell
      title="Query"
      subtitle="Chat-first query workspace for GrizCam analytics, with a manual builder mode when you need full control."
      badge={`${appEnv.demoLabel} • Read-only workspace`}
      viewportLayout
      mainClassName={viewMode === "chat" ? "flex min-h-0 flex-col overflow-hidden" : "min-h-0 overflow-y-auto pr-1"}
      asideClassName="overflow-y-auto"
      aside={
        <ModeSidebar
          viewMode={viewMode}
          onSelectMode={setViewMode}
          onPromptExample={(prompt) => {
            setViewMode("chat");
            setComposerAction("create-query");
            void submitComposer("create-query", prompt);
          }}
          latestQuery={latestQueryContext}
        />
      }
    >
      {viewMode === "chat" ? (
        <ChatWorkspace
          messages={chatMessages}
          composerText={composerText}
          composerAction={composerAction}
          onComposerTextChange={setComposerText}
          onComposerActionChange={setComposerAction}
          onSubmit={() => void submitComposer()}
          onUseSuggestedSql={useSuggestedSql}
          isBusy={isBusy}
          error={chatError}
          requestStatus={requestStatus}
        />
      ) : (
        <ManualWorkspace
          metadataQueryError={metadataQuery.isError}
          metadataIssues={metadataIssues}
          metadata={metadata}
          builderState={builderState}
          relation={relation}
          aggregateSummary={aggregateSummary}
          filterSummary={filterSummary}
          sortSummary={sortSummary}
          sortOptions={sortOptions}
          setRelation={setRelation}
          setBuilderState={setBuilderState}
          updateFilter={updateFilter}
          loadExample={loadExample}
          sql={sql}
          generatedSql={generatedSql}
          setSql={setSql}
          isCustomSql={isCustomSql}
          setIsCustomSql={setIsCustomSql}
          lastGeneratedByAi={lastGeneratedByAi}
          setLastGeneratedByAi={setLastGeneratedByAi}
          requestStatus={requestStatus}
          runValidation={runValidation}
          runQuery={runQuery}
          exportResults={exportResults}
          clientIssues={clientIssues}
          latestIssues={latestIssues}
          lastValidation={lastValidation}
          lastResult={lastResult}
          canRun={canRun}
          canExport={canExport}
          exportPending={exportMutation.isPending}
        />
      )}
    </AppShell>
  );
};
