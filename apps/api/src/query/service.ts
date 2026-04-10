import type {
  QueryResultColumn,
  QueryRunResponse,
  QueryValidationIssue,
  QueryValidationResponse
} from "@grizcam/shared";
import type { FieldDef, PoolClient, QueryResult } from "pg";
import { parse, toSql, type Expr, type SelectStatement, type Statement } from "pgsql-ast-parser";
import { pool } from "../db.js";
import { queryCatalog } from "./catalog.js";

type ValidationFacts = {
  issues: QueryValidationIssue[];
  activeRelations: Set<string>;
  relationLimits: number[];
};

type SelectProjection = {
  index: number;
  alias: string | null;
  outputName: string;
  expr: Expr;
  referenceNames: string[];
};

type ValidationState = ValidationFacts & {
  cteColumns: Map<string, Set<string>>;
  allApprovedColumns: Set<string>;
};

type ExprValidationOptions = {
  orderByAliases?: Map<string, SelectProjection>;
  resolvingAliases?: Set<string>;
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

const isReadOnlySelectStatement = (statement: Statement): statement is SelectStatement =>
  statement.type === "select" || statement.type === "with" || statement.type === "union" || statement.type === "union all";

const extractSelectProjections = (statement: SelectStatement): SelectProjection[] => {
  if (statement.type === "with" || statement.type === "with recursive") {
    const inner = statement.in;
    if (isReadOnlySelectStatement(inner)) {
      return extractSelectProjections(inner);
    }
    return [];
  }

  if (statement.type === "union" || statement.type === "union all") {
    return extractSelectProjections(statement.left);
  }

  if (statement.type !== "select") {
    return [];
  }

  return (statement.columns ?? []).map((column, index) => {
    const alias = column.alias?.name ? normalizeIdentifier(column.alias.name) : null;
    const outputName = normalizeIdentifier(column.alias?.name ?? inferSelectedColumnName(column.expr, index));
    const referenceNames = alias
      ? [alias]
      : column.expr.type === "ref"
        ? []
        : [outputName];

    return {
      index: index + 1,
      alias,
      outputName,
      expr: column.expr,
      referenceNames
    };
  });
};

const collectColumnNames = (statement: SelectStatement): Set<string> => {
  return new Set(extractSelectProjections(statement).map((projection) => projection.outputName));
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
  const state: ValidationState = {
    issues: [],
    activeRelations: new Set<string>(),
    relationLimits: [],
    cteColumns: new Map<string, Set<string>>(),
    allApprovedColumns: new Set<string>()
  };

  queryCatalog.relations.forEach((relation) => {
    relation.columns.forEach((column) => state.allApprovedColumns.add(column.name));
  });

  const registerRelation = (relationName: string) => {
    const relation = getRelationByName(relationName);
    if (!relation) {
      pushIssue(state.issues, "RELATION_NOT_ALLOWED", `Relation "${relationName}" is not approved for querying.`);
      return;
    }
    state.activeRelations.add(relation.name);
    state.relationLimits.push(relation.maxLimit);
  };

  const validateRef = (expr: Extract<Expr, { type: "ref" }>, options?: ExprValidationOptions) => {
    if (expr.name === "*") {
      return;
    }

    const columnName = normalizeIdentifier(String(expr.name));

    if (!expr.table && options?.orderByAliases?.has(columnName)) {
      const seenAliases = options.resolvingAliases ?? new Set<string>();
      if (seenAliases.has(columnName)) {
        pushIssue(state.issues, "INVALID_QUERY", `ORDER BY alias "${columnName}" resolves recursively.`);
        return;
      }

      const projection = options.orderByAliases.get(columnName)!;
      seenAliases.add(columnName);
      validateExpr(projection.expr, {
        orderByAliases: options.orderByAliases,
        resolvingAliases: seenAliases
      });
      seenAliases.delete(columnName);
      return;
    }

    if (expr.table?.schema && expr.table.schema !== "public") {
      pushIssue(state.issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${expr.table.schema}" is blocked in the query workspace.`);
      return;
    }

    if (expr.table) {
      const tableName = normalizeIdentifier(expr.table.name);
      if (state.cteColumns.has(tableName)) {
        const columns = state.cteColumns.get(tableName)!;
        if (columns.size > 0 && !columns.has(columnName)) {
          pushIssue(state.issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not available on "${tableName}".`);
        }
        return;
      }

      const relation = getRelationByName(tableName);
      if (relation) {
        if (!relation.columns.some((column) => column.name === columnName)) {
          pushIssue(state.issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not allowed on "${tableName}".`);
        }
        return;
      }

      // Alias-qualified refs are allowed as long as the underlying base relations pass whitelist validation.
      return;
    }

    if (!state.allApprovedColumns.has(columnName) && ![...state.cteColumns.values()].some((columns) => columns.has(columnName))) {
      pushIssue(state.issues, "COLUMN_NOT_ALLOWED", `Column "${columnName}" is not approved for this query.`);
    }
  };

  const validateOrderBy = (orderBy: NonNullable<Extract<SelectStatement, { type: "select" }>["orderBy"]>, projections: SelectProjection[]) => {
    const projectionMap = new Map<string, SelectProjection>();
    projections.forEach((projection) => {
      projection.referenceNames.forEach((referenceName) => {
        if (!projectionMap.has(referenceName)) {
          projectionMap.set(referenceName, projection);
        }
      });
    });

    orderBy.forEach((entry) => {
      const by = entry.by;
      if (by.type === "integer" || by.type === "numeric") {
        const position = Number(by.value);
        if (!Number.isInteger(position) || position < 1 || position > projections.length) {
          pushIssue(state.issues, "INVALID_QUERY", `ORDER BY position ${position} is not in select list.`);
        }
        return;
      }

      validateExpr(by, {
        orderByAliases: projectionMap,
        resolvingAliases: new Set<string>()
      });
    });
  };

  const validateFromItem = (fromItem: NonNullable<Extract<SelectStatement, { type: "select" }>["from"]>[number]) => {
    if (fromItem.type === "table") {
      const table = fromItem.name;
      if (table.schema && table.schema !== "public") {
        pushIssue(state.issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${table.schema}" is blocked in the query workspace.`);
      } else {
        const relationName = normalizeIdentifier(table.name);
        if (relationName === "information_schema" || relationName === "pg_catalog") {
          pushIssue(state.issues, "SYSTEM_SCHEMA_BLOCKED", `Relation "${relationName}" is blocked in the query workspace.`);
        } else if (!state.cteColumns.has(relationName)) {
          registerRelation(relationName);
        }
      }

      if (fromItem.join?.on) {
        validateExpr(fromItem.join.on);
      }
      return;
    }

    if (fromItem.type === "statement") {
      validateStatement(fromItem.statement as Statement);
      if (fromItem.join?.on) {
        validateExpr(fromItem.join.on);
      }
      return;
    }

    validateExpr(fromItem);
    if (fromItem.join?.on) {
      validateExpr(fromItem.join.on);
    }
  };

  const validateProjectionExpr = (projection: SelectProjection) => {
    const expr = projection.expr;
    validateExpr(expr);
  };

  function validateExpr(expr: Expr, options?: ExprValidationOptions): void {
    switch (expr.type) {
      case "ref":
        validateRef(expr, options);
        return;
      case "call": {
        if (expr.function.schema && expr.function.schema !== "public") {
          pushIssue(state.issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${expr.function.schema}" is blocked in the query workspace.`);
        }

        const functionName = normalizeIdentifier(expr.function.name);
        if (!queryCatalog.allowedFunctions.has(functionName)) {
          pushIssue(state.issues, "FUNCTION_NOT_ALLOWED", `Function "${functionName}" is not allowed in the query workspace.`);
        }
        if (expr.over || expr.withinGroup) {
          pushIssue(state.issues, "FUNCTION_NOT_ALLOWED", `Window and within-group syntax is not allowed for "${functionName}".`);
        }

        expr.args.forEach((arg) => validateExpr(arg));
        expr.orderBy?.forEach((entry) => validateExpr(entry.by));
        if (expr.filter) {
          validateExpr(expr.filter);
        }
        return;
      }
      case "binary":
        if (expr.opSchema && expr.opSchema !== "public") {
          pushIssue(state.issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${expr.opSchema}" is blocked in the query workspace.`);
        }
        validateExpr(expr.left, options);
        validateExpr(expr.right, options);
        return;
      case "unary":
        if (expr.opSchema && expr.opSchema !== "public") {
          pushIssue(state.issues, "SYSTEM_SCHEMA_BLOCKED", `Schema "${expr.opSchema}" is blocked in the query workspace.`);
        }
        validateExpr(expr.operand, options);
        return;
      case "cast":
        validateExpr(expr.operand, options);
        return;
      case "ternary":
        validateExpr(expr.value, options);
        validateExpr(expr.lo, options);
        validateExpr(expr.hi, options);
        return;
      case "member":
        validateExpr(expr.operand, options);
        return;
      case "extract":
        validateExpr(expr.from, options);
        return;
      case "list":
      case "array":
        expr.expressions.forEach((entry) => validateExpr(entry, options));
        return;
      case "array select":
        validateStatement(expr.select as Statement);
        return;
      case "arrayIndex":
        validateExpr(expr.array, options);
        validateExpr(expr.index, options);
        return;
      case "overlay":
        validateExpr(expr.value, options);
        validateExpr(expr.placing, options);
        validateExpr(expr.from, options);
        if (expr.for) {
          validateExpr(expr.for, options);
        }
        return;
      case "substring":
        validateExpr(expr.value, options);
        if (expr.from) {
          validateExpr(expr.from, options);
        }
        if (expr.for) {
          validateExpr(expr.for, options);
        }
        return;
      case "case":
        if (expr.value) {
          validateExpr(expr.value, options);
        }
        expr.whens.forEach((item) => {
          validateExpr(item.when, options);
          validateExpr(item.value, options);
        });
        if (expr.else) {
          validateExpr(expr.else, options);
        }
        return;
      case "select":
      case "with":
      case "union":
      case "union all":
      case "with recursive":
        validateStatement(expr as Statement);
        return;
      case "parameter":
      case "null":
      case "integer":
      case "default":
      case "numeric":
      case "string":
      case "boolean":
      case "constant":
      case "keyword":
        return;
    }
  }

  function validateStatement(current: Statement): void {
    if (current.type === "with recursive") {
      pushIssue(state.issues, "INVALID_QUERY", "Recursive CTEs are not allowed in the query workspace.");
      return;
    }

    if (current.type === "with") {
      current.bind.forEach((binding) => {
        if (!isReadOnlySelectStatement(binding.statement as Statement)) {
          pushIssue(state.issues, "NON_SELECT_NOT_ALLOWED", `CTE "${binding.alias.name}" must contain a read-only SELECT query.`);
          return;
        }

        state.cteColumns.set(normalizeIdentifier(binding.alias.name), collectColumnNames(binding.statement as SelectStatement));
        validateStatement(binding.statement as Statement);
      });

      validateStatement(current.in as Statement);
      return;
    }

    if (current.type === "union" || current.type === "union all") {
      validateStatement(current.left as Statement);
      validateStatement(current.right as Statement);
      return;
    }

    if (current.type !== "select") {
      pushIssue(state.issues, "NON_SELECT_NOT_ALLOWED", "Only read-only SELECT statements are allowed in the query workspace.");
      return;
    }

    const projections = extractSelectProjections(current);

    current.from?.forEach((fromItem) => validateFromItem(fromItem));
    projections.forEach(validateProjectionExpr);
    if (current.where) {
      validateExpr(current.where);
    }
    current.groupBy?.forEach((expr) => validateExpr(expr));
    if (current.having) {
      validateExpr(current.having);
    }
    if (Array.isArray(current.distinct)) {
      current.distinct.forEach((expr) => validateExpr(expr));
    }
    if (current.limit?.limit) {
      validateExpr(current.limit.limit);
    }
    if (current.limit?.offset) {
      validateExpr(current.limit.offset);
    }
    if (current.orderBy) {
      validateOrderBy(current.orderBy, projections);
    }
  }

  validateStatement(statement as Statement);

  return {
    issues: state.issues,
    activeRelations: state.activeRelations,
    relationLimits: state.relationLimits
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
