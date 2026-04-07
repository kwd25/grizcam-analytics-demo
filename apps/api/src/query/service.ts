import type {
  QueryResultColumn,
  QueryRunResponse,
  QueryValidationIssue,
  QueryValidationResponse
} from "@grizcam/shared";
import type { FieldDef, PoolClient } from "pg";
import { parse, toSql, type Expr, type From, type FromTable, type SelectFromStatement, type SelectStatement, type Statement } from "pgsql-ast-parser";
import { pool } from "../db.js";
import { queryCatalog } from "./catalog.js";

type ValidationContext = {
  issues: QueryValidationIssue[];
  relationAliases: Map<string, Set<string>>;
  activeRelations: Set<string>;
  relationLimits: number[];
  ctes: Map<string, Set<string>>;
  selectAliases: Set<string>;
};

type ValidatedQuery = {
  ok: boolean;
  issues: QueryValidationIssue[];
  normalizedSql?: string;
  appliedLimit?: number;
};

const STATEMENT_TIMEOUT_MS = 5_000;
const MAX_SQL_LENGTH = 12_000;
const DISALLOWED_KEYWORDS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|refresh|vacuum|analyze|do|begin|commit|rollback|call|execute|prepare|deallocate|listen|notify)\b/i;

const pushIssue = (issues: QueryValidationIssue[], code: QueryValidationIssue["code"], message: string) => {
  issues.push({ code, message });
};

const normalizeIdentifier = (value: string) => value.replace(/^"+|"+$/g, "").toLowerCase();

const getRelationByName = (name: string) => queryCatalog.relationMap.get(normalizeIdentifier(name));

const inferSelectedColumnName = (expr: Expr, index: number) => {
  if ("alias" in expr && typeof expr.alias === "object" && expr.alias?.name) {
    return expr.alias.name;
  }

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
    if (inner.type !== "select") {
      return new Set();
    }
    return collectColumnNames(inner);
  }

  if (statement.type !== "select") {
    return new Set();
  }

  return new Set((statement.columns ?? []).map((column, index) => column.alias?.name ?? inferSelectedColumnName(column.expr, index)));
};

const hasComments = (sql: string) => /--|\/\*/.test(sql);

const hasMultipleStatements = (sql: string) => {
  const trimmed = sql.trim();
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  return withoutTrailingSemicolon.includes(";");
};

const getLimitValue = (statement: SelectStatement) => {
  if (statement.type === "with" || statement.type === "with recursive") {
    return getLimitValue(statement.in as SelectStatement);
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

const applyLimit = (statement: SelectStatement, limit: number): SelectStatement => {
  if (statement.type === "with") {
    return { ...statement, in: applyLimit(statement.in as SelectStatement, limit) };
  }

  if (statement.type === "with recursive") {
    return { ...statement, in: applyLimit(statement.in as SelectStatement, limit) };
  }

  if (statement.type !== "select") {
    return statement;
  }

  return {
    ...statement,
    limit: {
      ...statement.limit,
      limit: { type: "integer", value: limit }
    }
  };
};

const resolveSource = (from: From, context: ValidationContext): { alias: string; columns: Set<string>; relationName: string | null } | null => {
  if (from.type === "statement" || from.type === "call") {
    pushIssue(context.issues, "JOIN_NOT_ALLOWED", "Subqueries, table functions, and joins are not supported in Query v1.");
    return null;
  }

  return resolveTable(from, context);
};

const resolveTable = (from: FromTable, context: ValidationContext) => {
  if (from.join) {
    pushIssue(context.issues, "JOIN_NOT_ALLOWED", "Joins are not supported in Query v1. Query a single approved relation at a time.");
    return null;
  }

  const relation = normalizeIdentifier(from.name.name);
  if (from.name.schema && from.name.schema !== "public") {
    pushIssue(context.issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${from.name.schema}" is not available from the query workspace.`);
    return null;
  }

  if (relation === "information_schema" || relation === "pg_catalog") {
    pushIssue(context.issues, "SYSTEM_SCHEMA_BLOCKED", `Relation "${relation}" is blocked in the query workspace.`);
    return null;
  }

  const cteColumns = context.ctes.get(relation);
  if (cteColumns) {
    return {
      alias: normalizeIdentifier(from.name.alias ?? relation),
      columns: cteColumns,
      relationName: null
    };
  }

  const relationMetadata = getRelationByName(relation);
  if (!relationMetadata) {
    pushIssue(context.issues, "RELATION_NOT_ALLOWED", `Relation "${relation}" is not approved for querying.`);
    return null;
  }

  context.activeRelations.add(relationMetadata.name);
  context.relationLimits.push(relationMetadata.maxLimit);

  return {
    alias: normalizeIdentifier(from.name.alias ?? relationMetadata.name),
    columns: new Set(relationMetadata.columns.map((column) => column.name)),
    relationName: relationMetadata.name
  };
};

const validateColumnRef = (expr: Extract<Expr, { type: "ref" }>, context: ValidationContext) => {
  const columnName = normalizeIdentifier(String(expr.name));

  if (expr.name === "*") {
    if ([...context.activeRelations].includes("events")) {
      pushIssue(context.issues, "SELECT_ALL_NOT_ALLOWED", 'SELECT * is not allowed for "events". Choose explicit columns instead.');
    }
    return;
  }

  if (expr.table?.schema && expr.table.schema !== "public") {
    pushIssue(context.issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${expr.table.schema}" is blocked in the query workspace.`);
    return;
  }

  if (expr.table) {
    const alias = normalizeIdentifier(expr.table.name);
    const columns = context.relationAliases.get(alias);
    if (!columns) {
      pushIssue(context.issues, "RELATION_NOT_ALLOWED", `Relation alias "${alias}" is not available in this query.`);
      return;
    }
    if (!columns.has(columnName)) {
      pushIssue(context.issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not allowed on "${alias}".`);
    }
    return;
  }

  const matchingAliases = [...context.relationAliases.values()].filter((columns) => columns.has(columnName));
  if (matchingAliases.length === 0 && !context.selectAliases.has(columnName)) {
    pushIssue(context.issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not approved for this query.`);
  }
};

const validateExpr = (expr: Expr, context: ValidationContext) => {
  switch (expr.type) {
    case "ref":
      validateColumnRef(expr, context);
      return;
    case "call": {
      const functionName = normalizeIdentifier(expr.function.name);
      if (!queryCatalog.allowedFunctions.has(functionName)) {
        pushIssue(context.issues, "FUNCTION_NOT_ALLOWED", `Function "${functionName}" is not allowed in the query workspace.`);
      }
      if (expr.over || expr.withinGroup || expr.filter) {
        pushIssue(context.issues, "FUNCTION_NOT_ALLOWED", `Advanced function syntax is not allowed for "${functionName}".`);
      }
      expr.args.forEach((arg) => {
        if (functionName === "count" && arg.type === "ref" && arg.name === "*") {
          return;
        }
        validateExpr(arg, context);
      });
      expr.orderBy?.forEach((orderBy) => validateExpr(orderBy.by, context));
      return;
    }
    case "binary":
      validateExpr(expr.left, context);
      validateExpr(expr.right, context);
      return;
    case "unary":
      validateExpr(expr.operand, context);
      return;
    case "ternary":
      validateExpr(expr.value, context);
      validateExpr(expr.lo, context);
      validateExpr(expr.hi, context);
      return;
    case "cast":
      validateExpr(expr.operand, context);
      return;
    case "case":
      expr.value && validateExpr(expr.value, context);
      expr.whens.forEach((when) => {
        validateExpr(when.when, context);
        validateExpr(when.value, context);
      });
      expr.else && validateExpr(expr.else, context);
      return;
    case "extract":
      validateExpr(expr.from, context);
      return;
    case "list":
    case "array":
      expr.expressions.forEach((item) => validateExpr(item, context));
      return;
    case "overlay":
      validateExpr(expr.value, context);
      validateExpr(expr.placing, context);
      validateExpr(expr.from, context);
      expr.for && validateExpr(expr.for, context);
      return;
    case "substring":
      validateExpr(expr.value, context);
      expr.from && validateExpr(expr.from, context);
      expr.for && validateExpr(expr.for, context);
      return;
    case "arrayIndex":
      validateExpr(expr.array, context);
      validateExpr(expr.index, context);
      return;
    case "select":
    case "with":
    case "with recursive":
    case "union":
    case "union all":
    case "array select":
    case "member":
      pushIssue(context.issues, "INVALID_QUERY", "Nested queries and JSON-style member access are not supported in Query v1.");
      return;
    default:
      return;
  }
};

const validateSelectStatement = (statement: SelectStatement, parentCtes: Map<string, Set<string>>): ValidationContext => {
  const context: ValidationContext = {
    issues: [],
    relationAliases: new Map(),
    activeRelations: new Set(),
    relationLimits: [],
    ctes: new Map(parentCtes),
    selectAliases: new Set()
  };

  if (statement.type === "with") {
    for (const binding of statement.bind) {
      if (binding.statement.type !== "select") {
        pushIssue(context.issues, "NON_SELECT_NOT_ALLOWED", `CTE "${binding.alias.name}" must contain a SELECT statement.`);
        continue;
      }
      const bindingContext = validateSelectStatement(binding.statement, context.ctes);
      context.issues.push(...bindingContext.issues);
      context.ctes.set(normalizeIdentifier(binding.alias.name), collectColumnNames(binding.statement));
      bindingContext.activeRelations.forEach((relation) => context.activeRelations.add(relation));
      context.relationLimits.push(...bindingContext.relationLimits);
    }

    if (statement.in.type !== "select") {
      pushIssue(context.issues, "NON_SELECT_NOT_ALLOWED", "The final statement after WITH must be a SELECT.");
      return context;
    }

    const innerContext = validateSelectStatement(statement.in, context.ctes);
    context.issues.push(...innerContext.issues);
    innerContext.activeRelations.forEach((relation) => context.activeRelations.add(relation));
    context.relationLimits.push(...innerContext.relationLimits);
    return context;
  }

  if (statement.type === "with recursive" || statement.type === "union" || statement.type === "union all" || statement.type === "values") {
    pushIssue(context.issues, "INVALID_QUERY", "Recursive CTEs, UNION queries, and VALUES queries are not supported in Query v1.");
    return context;
  }

  if (statement.type !== "select") {
    pushIssue(context.issues, "NON_SELECT_NOT_ALLOWED", "Only SELECT queries are allowed in the query workspace.");
    return context;
  }

  const selectStatement: SelectFromStatement = statement;

  if (selectStatement.for || selectStatement.skip) {
    pushIssue(context.issues, "INVALID_QUERY", "Locking clauses are not allowed in the query workspace.");
  }

  const sources = selectStatement.from ?? [];
  if (sources.length !== 1) {
    pushIssue(context.issues, "RELATION_NOT_ALLOWED", "Query v1 supports exactly one approved source relation per query.");
  }

  sources.forEach((source: From) => {
    const resolved = resolveSource(source, context);
    if (!resolved) {
      return;
    }
    context.relationAliases.set(resolved.alias, resolved.columns);
    if (resolved.relationName) {
      context.relationAliases.set(resolved.relationName, resolved.columns);
    }
  });

  const columns = selectStatement.columns ?? [];
  if (columns.length === 0) {
    pushIssue(context.issues, "INVALID_QUERY", "SELECT queries must choose at least one column.");
  }

  columns.forEach((column, index) => {
    context.selectAliases.add(normalizeIdentifier(column.alias?.name ?? inferSelectedColumnName(column.expr, index)));
    validateExpr(column.expr, context);
  });
  selectStatement.where && validateExpr(selectStatement.where, context);
  selectStatement.groupBy?.forEach((expr: Expr) => validateExpr(expr, context));
  selectStatement.having && validateExpr(selectStatement.having, context);
  selectStatement.orderBy?.forEach((orderBy) => validateExpr(orderBy.by, context));

  return context;
};

const validateParsedStatement = (statement: Statement): ValidatedQuery => {
  const issues: QueryValidationIssue[] = [];

  if (statement.type !== "select" && statement.type !== "with") {
    pushIssue(issues, "NON_SELECT_NOT_ALLOWED", "Only SELECT queries are allowed in the query workspace.");
    return { ok: false, issues };
  }

  const context = validateSelectStatement(statement, new Map());
  issues.push(...context.issues);

  const limitValue = getLimitValue(statement);
  const maxLimit = context.relationLimits.length > 0 ? Math.min(...context.relationLimits) : queryCatalog.maxLimit;
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

  const appliedLimit = limitValue ?? (context.relationLimits.length > 0 ? Math.min(queryCatalog.defaultLimit, maxLimit) : queryCatalog.defaultLimit);
  const normalizedSql = toSql.statement(limitValue === null ? applyLimit(statement, appliedLimit) : statement);

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

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const dbClient = client;
    await dbClient.query("begin read only");
    await dbClient.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    const startedAt = Date.now();
    const result = await dbClient.query(validation.normalizedSql);
    const durationMs = Date.now() - startedAt;
    await dbClient.query("rollback");

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
    if (client) {
      try {
        await client.query("rollback");
      } catch {
        // ignore rollback failures after query errors
      }
    }

    const rawMessage = error instanceof Error ? error.message : "Query execution failed.";
    const lowerMessage = rawMessage.toLowerCase();
    const timedOut = /statement timeout|canceling statement due to statement timeout/.test(lowerMessage);
    const connectionIssue =
      !client ||
      /connection|econnrefused|connect|terminating connection|remaining connection slots|timeout expired|database system is starting up/.test(
        lowerMessage
      );

    const code = timedOut ? "QUERY_TIMEOUT" : "EXECUTION_ERROR";
    const message = timedOut
      ? `The query took too long and was stopped after ${STATEMENT_TIMEOUT_MS / 1000} seconds. Try adding filters or lowering the limit.`
      : connectionIssue
        ? "The query service could not reach the database. Please retry in a moment."
        : rawMessage;

    return {
      ok: false,
      normalizedSql: validation.normalizedSql,
      appliedLimit: validation.appliedLimit,
      issues: [{ code, message }]
    };
  } finally {
    client?.release();
  }
};
