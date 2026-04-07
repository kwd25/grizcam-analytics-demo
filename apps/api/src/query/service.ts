import type {
  QueryResultColumn,
  QueryRunResponse,
  QueryValidationIssue,
  QueryValidationResponse
} from "@grizcam/shared";
import type { FieldDef, PoolClient, QueryResult } from "pg";
import { astVisitor, parse, toSql, type Expr, type SelectStatement, type Statement } from "pgsql-ast-parser";
import { pool } from "../db.js";
import { queryCatalog } from "./catalog.js";

type ValidationFacts = {
  issues: QueryValidationIssue[];
  activeRelations: Set<string>;
  relationLimits: number[];
};

type ValidatedQuery = {
  ok: boolean;
  issues: QueryValidationIssue[];
  normalizedSql?: string;
  appliedLimit?: number;
};

const STATEMENT_TIMEOUT_MS = 5_000;
const MAX_SQL_LENGTH = 20_000;
const DISALLOWED_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|refresh|vacuum|analyze|do|begin|commit|rollback|call|execute|prepare|deallocate|listen|notify)\b/i;

const pushIssue = (issues: QueryValidationIssue[], code: QueryValidationIssue["code"], message: string) => {
  if (!issues.some((issue) => issue.code === code && issue.message === message)) {
    issues.push({ code, message });
  }
};

const normalizeIdentifier = (value: string) => value.replace(/^"+|"+$/g, "").toLowerCase();

const getRelationByName = (name: string) => queryCatalog.relationMap.get(normalizeIdentifier(name));

const inferSelectedColumnName = (expr: Expr, index: number) => {
  switch (expr.type) {
    case "ref":
      return expr.name === "*" ? `column_${index + 1}` : expr.name;
    case "call":
      return expr.function.name;
    case "cast":
      return inferSelectedColumnName(expr.operand, index);
    default:
      return `column_${index + 1}`;
  }
};

const collectColumnNames = (statement: SelectStatement): Set<string> => {
  if (statement.type === "with" || statement.type === "with recursive") {
    const inner = statement.in;
    if (inner.type === "select" || inner.type === "union" || inner.type === "union all") {
      return collectColumnNames(inner);
    }
    return new Set();
  }

  if (statement.type === "union" || statement.type === "union all") {
    return collectColumnNames(statement.left);
  }

  if (statement.type !== "select") {
    return new Set();
  }

  return new Set((statement.columns ?? []).map((column, index) => normalizeIdentifier(column.alias?.name ?? inferSelectedColumnName(column.expr, index))));
};

const hasComments = (sql: string) => /--|\/\*/.test(sql);

const hasMultipleStatements = (sql: string) => {
  const trimmed = sql.trim();
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  return withoutTrailingSemicolon.includes(";");
};

const getTopLevelLimitValue = (statement: SelectStatement): number | null => {
  if (statement.type === "with" || statement.type === "with recursive") {
    const inner = statement.in;
    return inner.type === "select" ? getTopLevelLimitValue(inner) : null;
  }

  if (statement.type !== "select") {
    return null;
  }

  const limitExpr = statement.limit?.limit;
  if (!limitExpr) {
    return null;
  }

  if (limitExpr.type === "integer" || limitExpr.type === "numeric") {
    return Number(limitExpr.value);
  }

  return Number.NaN;
};

const wrapWithLimit = (sql: string, limit: number) => `select * from (${sql}) as "__grizcam_limited" limit ${limit}`;

const buildValidationFacts = (statement: SelectStatement): ValidationFacts => {
  const issues: QueryValidationIssue[] = [];
  const activeRelations = new Set<string>();
  const relationLimits: number[] = [];
  const cteColumns = new Map<string, Set<string>>();
  const allApprovedColumns = new Set<string>();

  queryCatalog.relations.forEach((relation) => {
    relation.columns.forEach((column) => allApprovedColumns.add(column.name));
  });

  const registerRelation = (relationName: string) => {
    const relation = getRelationByName(relationName);
    if (!relation) {
      pushIssue(issues, "RELATION_NOT_ALLOWED", `Relation "${relationName}" is not approved for querying.`);
      return;
    }
    activeRelations.add(relation.name);
    relationLimits.push(relation.maxLimit);
  };

  const visitor = astVisitor((visit) => ({
    statement: (current) => {
      if (current.type === "with recursive") {
        pushIssue(issues, "INVALID_QUERY", "Recursive CTEs are not allowed in the query workspace.");
        return;
      }

      if (current.type === "with") {
        current.bind.forEach((binding) => {
          if (
            binding.statement.type !== "select" &&
            binding.statement.type !== "union" &&
            binding.statement.type !== "union all" &&
            binding.statement.type !== "with"
          ) {
            pushIssue(issues, "NON_SELECT_NOT_ALLOWED", `CTE "${binding.alias.name}" must contain a read-only SELECT query.`);
            return;
          }
          cteColumns.set(normalizeIdentifier(binding.alias.name), collectColumnNames(binding.statement as SelectStatement));
          visit.super().statement(binding.statement as Statement);
        });
        visit.super().statement(current.in as Statement);
        return;
      }

      if (current.type !== "select" && current.type !== "union" && current.type !== "union all") {
        pushIssue(issues, "NON_SELECT_NOT_ALLOWED", "Only read-only SELECT statements are allowed in the query workspace.");
        return;
      }

      visit.super().statement(current);
    },
    tableRef: (table) => {
      if (table.schema && table.schema !== "public") {
        pushIssue(issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${table.schema}" is blocked in the query workspace.`);
        return;
      }

      const relationName = normalizeIdentifier(table.name);
      if (relationName === "information_schema" || relationName === "pg_catalog") {
        pushIssue(issues, "SYSTEM_SCHEMA_BLOCKED", `Relation "${relationName}" is blocked in the query workspace.`);
        return;
      }

      if (cteColumns.has(relationName)) {
        return;
      }

      registerRelation(relationName);
    },
    ref: (ref) => {
      if (ref.name === "*") {
        if (activeRelations.has("events") && !ref.table) {
          pushIssue(issues, "SELECT_ALL_NOT_ALLOWED", 'SELECT * is not allowed for "events". Choose explicit columns instead.');
        }
        if (ref.table && normalizeIdentifier(ref.table.name) === "events") {
          pushIssue(issues, "SELECT_ALL_NOT_ALLOWED", 'SELECT * is not allowed for "events". Choose explicit columns instead.');
        }
        return;
      }

      const columnName = normalizeIdentifier(String(ref.name));
      if (ref.table?.schema && ref.table.schema !== "public") {
        pushIssue(issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${ref.table.schema}" is blocked in the query workspace.`);
        return;
      }

      if (ref.table) {
        const tableName = normalizeIdentifier(ref.table.name);
        if (cteColumns.has(tableName)) {
          const columns = cteColumns.get(tableName)!;
          if (columns.size > 0 && !columns.has(columnName)) {
            pushIssue(issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not available on "${tableName}".`);
          }
          return;
        }

        const relation = getRelationByName(tableName);
        if (relation) {
          if (!relation.columns.some((column) => column.name === columnName)) {
            pushIssue(issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not allowed on "${tableName}".`);
          }
          return;
        }

        // Alias-qualified refs are allowed as long as the underlying base relations pass whitelist validation.
        return;
      }

      if (!allApprovedColumns.has(columnName) && ![...cteColumns.values()].some((columns) => columns.has(columnName))) {
        pushIssue(issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not approved for this query.`);
      }
    },
    call: (call) => {
      const functionName = normalizeIdentifier(call.function.name);
      if (!queryCatalog.allowedFunctions.has(functionName)) {
        pushIssue(issues, "FUNCTION_NOT_ALLOWED", `Function "${functionName}" is not allowed in the query workspace.`);
      }
      if (call.over || call.withinGroup) {
        pushIssue(issues, "FUNCTION_NOT_ALLOWED", `Window and within-group syntax is not allowed for "${functionName}".`);
      }
      visit.super().call(call);
    }
  }));

  visitor.statement(statement as Statement);

  return {
    issues,
    activeRelations,
    relationLimits
  };
};

const validateParsedStatement = (statement: Statement): ValidatedQuery => {
  const issues: QueryValidationIssue[] = [];

  if (statement.type !== "select" && statement.type !== "with" && statement.type !== "union" && statement.type !== "union all") {
    pushIssue(issues, "NON_SELECT_NOT_ALLOWED", "Only read-only SELECT statements are allowed in the query workspace.");
    return { ok: false, issues };
  }

  const facts = buildValidationFacts(statement as SelectStatement);
  issues.push(...facts.issues);

  const limitValue = getTopLevelLimitValue(statement as SelectStatement);
  const maxLimit = facts.relationLimits.length > 0 ? Math.min(...facts.relationLimits) : queryCatalog.maxLimit;

  if (limitValue !== null) {
    if (!Number.isFinite(limitValue) || limitValue <= 0) {
      pushIssue(issues, "INVALID_LIMIT", "LIMIT must be a positive integer.");
    } else if (limitValue > maxLimit) {
      pushIssue(issues, "LIMIT_TOO_HIGH", `LIMIT ${limitValue} exceeds the maximum allowed row cap of ${maxLimit}.`);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const appliedLimit = limitValue ?? (facts.relationLimits.length > 0 ? Math.min(queryCatalog.defaultLimit, maxLimit) : queryCatalog.defaultLimit);
  const baseSql = toSql.statement(statement as SelectStatement);
  const normalizedSql = limitValue === null ? wrapWithLimit(baseSql, appliedLimit) : baseSql;

  return {
    ok: true,
    issues: [],
    normalizedSql,
    appliedLimit
  };
};

export const validateQuerySql = (sql: string): QueryValidationResponse => {
  const trimmed = sql.trim();
  const issues: QueryValidationIssue[] = [];

  if (!trimmed) {
    pushIssue(issues, "EMPTY_QUERY", "Enter a SELECT query to continue.");
    return { ok: false, issues };
  }

  if (trimmed.length > MAX_SQL_LENGTH) {
    pushIssue(issues, "INVALID_QUERY", "Query text is too long for the demo workspace.");
  }

  if (hasComments(trimmed)) {
    pushIssue(issues, "COMMENT_NOT_ALLOWED", "SQL comments are not allowed in the query workspace.");
  }

  if (hasMultipleStatements(trimmed)) {
    pushIssue(issues, "MULTI_STATEMENT_NOT_ALLOWED", "Only one SQL statement can be executed at a time.");
  }

  if (DISALLOWED_KEYWORDS.test(trimmed)) {
    pushIssue(issues, "UNSAFE_KEYWORD", "Only read-only analytical SELECT syntax is allowed.");
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  try {
    const statements = parse(trimmed.replace(/;\s*$/, ""));
    if (statements.length !== 1) {
      return {
        ok: false,
        issues: [{ code: "MULTI_STATEMENT_NOT_ALLOWED", message: "Only one SQL statement can be executed at a time." }]
      };
    }

    return validateParsedStatement(statements[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The SQL could not be parsed.";
    return {
      ok: false,
      issues: [{ code: "INVALID_QUERY", message }]
    };
  }
};

const mapColumns = (columnNames: string[]): QueryResultColumn[] =>
  columnNames.map((name) => ({
    name,
    label: name.replace(/_/g, " ")
  }));

const escapeCsvCell = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const buildCsv = (fields: FieldDef[], rows: Array<Record<string, unknown>>) => {
  const header = fields.map((field) => escapeCsvCell(field.name)).join(",");
  const lines = rows.map((row) => fields.map((field) => escapeCsvCell(row[field.name])).join(","));
  return [header, ...lines].join("\n");
};

const executeValidatedSql = async (normalizedSql: string): Promise<QueryResult<Record<string, unknown>>> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("begin read only");
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query<Record<string, unknown>>(normalizedSql);
    await client.query("rollback");
    return result;
  } finally {
    if (client) {
      try {
        await client.query("rollback");
      } catch {
        // ignore cleanup failures
      }
      client.release();
    }
  }
};

const normalizeExecutionError = (error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : "Query execution failed.";
  const lowerMessage = rawMessage.toLowerCase();
  const timedOut = /statement timeout|canceling statement due to statement timeout/.test(lowerMessage);
  const connectionIssue =
    /connection|econnrefused|connect|terminating connection|remaining connection slots|timeout expired|database system is starting up/.test(
      lowerMessage
    );

  return {
    code: timedOut ? "QUERY_TIMEOUT" : "EXECUTION_ERROR",
    message: timedOut
      ? `The query took too long and was stopped after ${STATEMENT_TIMEOUT_MS / 1000} seconds. Try adding filters or lowering the limit.`
      : connectionIssue
        ? "The query service could not reach the database. Please retry in a moment."
        : rawMessage
  } as QueryValidationIssue;
};

export const runSafeQuery = async (sql: string): Promise<QueryRunResponse> => {
  const validation = validateQuerySql(sql);
  if (!validation.ok || !validation.normalizedSql) {
    return {
      ok: false,
      normalizedSql: validation.normalizedSql,
      appliedLimit: validation.appliedLimit,
      issues: validation.issues
    };
  }

  try {
    const startedAt = Date.now();
    const result = await executeValidatedSql(validation.normalizedSql);
    const durationMs = Date.now() - startedAt;

    return {
      ok: true,
      normalizedSql: validation.normalizedSql,
      appliedLimit: validation.appliedLimit,
      durationMs,
      rowCount: result.rowCount ?? result.rows.length,
      columns: mapColumns(result.fields.map((field: FieldDef) => field.name)),
      rows: result.rows as Array<Record<string, unknown>>,
      issues: []
    };
  } catch (error) {
    return {
      ok: false,
      normalizedSql: validation.normalizedSql,
      appliedLimit: validation.appliedLimit,
      issues: [normalizeExecutionError(error)]
    };
  }
};

export const exportSafeQueryCsv = async (sql: string) => {
  const validation = validateQuerySql(sql);
  if (!validation.ok || !validation.normalizedSql) {
    return {
      ok: false as const,
      validation
    };
  }

  try {
    const result = await executeValidatedSql(validation.normalizedSql);
    return {
      ok: true as const,
      csv: buildCsv(result.fields, result.rows as Array<Record<string, unknown>>),
      appliedLimit: validation.appliedLimit
    };
  } catch (error) {
    return {
      ok: false as const,
      validation: {
        ok: false,
        normalizedSql: validation.normalizedSql,
        appliedLimit: validation.appliedLimit,
        issues: [normalizeExecutionError(error)]
      }
    };
  }
};
