import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { appConfig } from "../config.js";
import { withDashboardDiagnostics } from "./diagnostics.js";

const makeRequest = (query: Record<string, unknown> = {}, requestId = "test-request-id") =>
  ({
    query,
    header: (name: string) => (name.toLowerCase() === "x-request-id" ? requestId : undefined)
  }) as Request;

const makeResponse = () => {
  const state: {
    statusCode: number;
    headers: Record<string, string>;
    payload: unknown;
  } = {
    statusCode: 200,
    headers: {},
    payload: null
  };

  const response = {
    setHeader: (name: string, value: number | string | readonly string[]) => {
      state.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
      return response;
    },
    status: (statusCode: number) => {
      state.statusCode = statusCode;
      return response;
    },
    json: (payload: unknown) => {
      state.payload = payload;
      return response;
    }
  } as Response;

  return { response, state };
};

test("withDashboardDiagnostics returns successful payload with request id header", async () => {
  const { response, state } = makeResponse();
  const payload = { ok: true, rows: [1, 2, 3] };

  await withDashboardDiagnostics(makeRequest({ start_date: "2025-01-01" }), response, "test-route", async () => payload, (result) => ({
    rows: result.rows.length
  }));

  assert.equal(state.statusCode, 200);
  assert.equal(state.headers["x-request-id"], "test-request-id");
  assert.deepEqual(state.payload, payload);
});

test("withDashboardDiagnostics returns structured query errors", async () => {
  const { response, state } = makeResponse();
  const error = new Error('relation "events" does not exist') as Error & { code: string };
  error.code = "42P01";

  await withDashboardDiagnostics(makeRequest({ q: "camera" }), response, "overview", async () => {
    throw error;
  });

  assert.equal(state.statusCode, 500);
  assert.equal(state.headers["x-request-id"], "test-request-id");
  assert.deepEqual(state.payload, {
    error: "Dashboard query failed.",
    code: "DASHBOARD_QUERY_FAILED",
    route: "overview",
    requestId: "test-request-id",
    details: {
      message: 'relation "events" does not exist',
      sqlCode: "42P01",
      db: {
        connectionSource: appConfig.databaseConnectionSource,
        envPresence: appConfig.databaseEnvPresence
      }
    }
  });
});
