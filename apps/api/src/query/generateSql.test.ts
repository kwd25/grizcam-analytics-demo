import assert from "node:assert/strict";
import test from "node:test";
import { appConfig } from "../config.js";
import { GenerateSqlError, generateSqlFromPrompt, sanitizeGeneratedSql } from "./generateSql.js";

test("sanitizeGeneratedSql strips fences and trailing semicolon", () => {
  const sql = sanitizeGeneratedSql("```sql\nselect camera_name from dim_devices limit 5;\n```");
  assert.equal(sql, "select camera_name from dim_devices limit 5");
});

test("sanitizeGeneratedSql rejects empty output", () => {
  assert.throws(() => sanitizeGeneratedSql("```sql\n```"), GenerateSqlError);
});

test("sanitizeGeneratedSql rejects multi-statement output", () => {
  assert.throws(() => sanitizeGeneratedSql("select 1; select 2;"), /multiple statements/i);
});

test("sanitizeGeneratedSql rejects non-read-only output", () => {
  assert.throws(() => sanitizeGeneratedSql("delete from events"), /non-read-only/i);
});

test("generateSqlFromPrompt fails safely when key is missing", async () => {
  const original = appConfig.openRouterApiKey;
  appConfig.openRouterApiKey = "";

  await assert.rejects(generateSqlFromPrompt("top cameras"), /OPENROUTER_API_KEY/);

  appConfig.openRouterApiKey = original;
});

test("generateSqlFromPrompt sanitizes model output", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;

  appConfig.openRouterApiKey = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sql: "```sql\nselect camera_name from dim_devices order by camera_name asc limit 5;\n```",
                userIntentSummary: "You want a short list of cameras.",
                queryExplanation: "This query reads camera names from the device dimension and keeps the list small.",
                warning: "Results are limited to five rows."
              })
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  try {
    const result = await generateSqlFromPrompt("show cameras");
    assert.equal(result.model, "qwen/qwen3-coder-next");
    assert.equal(result.sql, "select camera_name from dim_devices order by camera_name asc limit 5");
    assert.equal(result.userIntentSummary, "You want a short list of cameras.");
    assert.equal(result.queryExplanation, "This query reads camera names from the device dimension and keeps the list small.");
    assert.equal(result.warning, "Results are limited to five rows.");
  } finally {
    appConfig.openRouterApiKey = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test("generateSqlFromPrompt rejects invalid JSON payloads", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;

  appConfig.openRouterApiKey = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "select camera_name from dim_devices limit 5" } }]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  try {
    await assert.rejects(generateSqlFromPrompt("show cameras"), /invalid SQL response payload/i);
  } finally {
    appConfig.openRouterApiKey = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test("generateSqlFromPrompt converts upstream failure into safe error", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;

  appConfig.openRouterApiKey = "test-key";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "bad gateway" } }), {
      status: 502,
      headers: { "content-type": "application/json" }
    });

  try {
    await assert.rejects(generateSqlFromPrompt("show recent vehicle events"), /unavailable right now/i);
  } finally {
    appConfig.openRouterApiKey = originalKey;
    globalThis.fetch = originalFetch;
  }
});
