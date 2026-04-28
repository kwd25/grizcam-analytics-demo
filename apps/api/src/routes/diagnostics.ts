import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { appConfig } from "../config.js";

type SafeQueryValue = string | string[] | number | boolean | null;
type RouteSummary = Record<string, string | number | boolean | null>;

type PgErrorShape = {
  code?: string;
  message: string;
};

const MAX_LOG_QUERY_VALUE_LENGTH = 160;
const MAX_ERROR_MESSAGE_LENGTH = 320;

const getRequestId = (request: Request) => {
  const header = request.header("x-request-id") ?? request.header("x-vercel-id");
  return header && header.trim().length > 0 ? header.trim() : randomUUID();
};

const truncate = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit)}...` : value);

const sanitizeQueryValue = (value: unknown): SafeQueryValue => {
  if (Array.isArray(value)) {
    return value.map((item) => truncate(String(item), MAX_LOG_QUERY_VALUE_LENGTH));
  }

  if (typeof value === "string") {
    return truncate(value, MAX_LOG_QUERY_VALUE_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  return truncate(String(value), MAX_LOG_QUERY_VALUE_LENGTH);
};

const sanitizeQuery = (query: Request["query"]) =>
  Object.fromEntries(Object.entries(query).map(([key, value]) => [key, sanitizeQueryValue(value)]));

const isPgError = (error: unknown): error is PgErrorShape => {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === undefined || typeof maybeCode === "string";
};

const formatErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return truncate(error.message, MAX_ERROR_MESSAGE_LENGTH);
  }

  return "Unknown route failure.";
};

const buildDbDiagnostics = () => ({
  connectionSource: appConfig.databaseConnectionSource,
  envPresence: appConfig.databaseEnvPresence
});

export const withDashboardDiagnostics = async <T>(
  request: Request,
  response: Response,
  route: string,
  handler: () => Promise<T>,
  summarize: (result: T) => RouteSummary = () => ({})
) => {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const baseLog = {
    requestId,
    route,
    query: sanitizeQuery(request.query),
    db: buildDbDiagnostics()
  };

  try {
    const result = await handler();
    const elapsedMs = Date.now() - startedAt;
    console.log("dashboard.route.success", {
      ...baseLog,
      elapsedMs,
      summary: summarize(result)
    });
    response.setHeader("x-request-id", requestId);
    response.json(result);
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;

    if (error instanceof ZodError) {
      console.warn("dashboard.route.invalid_request", {
        ...baseLog,
        elapsedMs,
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      });
      response.setHeader("x-request-id", requestId);
      response.status(400).json({
        error: "Invalid dashboard request parameters.",
        code: "DASHBOARD_REQUEST_INVALID",
        route,
        requestId,
        details: error.flatten()
      });
      return;
    }

    const pgError = isPgError(error) ? error : null;
    const message = formatErrorMessage(error);
    console.error("dashboard.route.error", {
      ...baseLog,
      elapsedMs,
      errorName: error instanceof Error ? error.name : "UnknownError",
      sqlCode: pgError?.code ?? null,
      message
    });
    response.setHeader("x-request-id", requestId);
    response.status(500).json({
      error: "Dashboard query failed.",
      code: pgError?.code ? "DASHBOARD_QUERY_FAILED" : "DASHBOARD_ROUTE_FAILED",
      route,
      requestId,
      details: {
        message,
        sqlCode: pgError?.code ?? null,
        db: buildDbDiagnostics()
      }
    });
  }
};
