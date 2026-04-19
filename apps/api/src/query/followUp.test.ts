import assert from "node:assert/strict";
import test from "node:test";
import type { QueryFollowUpRequest } from "@grizcam/shared";
import { appConfig } from "../config.js";
import { answerQueryFollowUp } from "./followUp.js";

const sampleRequest: QueryFollowUpRequest = {
  prompt: "How would I narrow that to the last 7 days?",
  history: [
    { role: "user", content: "top 10 busiest cameras in last 30 days" },
    { role: "assistant", content: "Generated a query against daily_camera_summary and it validated successfully." }
  ],
  latestQuery: {
    sql: "select camera_name from daily_camera_summary limit 10",
    validation: { ok: true, appliedLimit: 10, issues: [] },
    result: { rowCount: 10, durationMs: 38, appliedLimit: 10, columns: ["camera_name"] }
  }
};

test("follow-up returns prose and sanitizes optional SQL", async () => {
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
                answer: "Add a date filter against the last 7 days.",
                suggestedSql: "```sql\nselect camera_name from daily_camera_summary where date >= current_date - interval '7 days' limit 10;\n```"
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const result = await answerQueryFollowUp(sampleRequest);
    assert.match(result.answer, /last 7 days/i);
    assert.equal(result.suggestedSql, "select camera_name from daily_camera_summary where date >= current_date - interval '7 days' limit 10");
  } finally {
    appConfig.openRouterApiKey = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test("follow-up drops invalid suggested SQL safely", async () => {
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
                answer: "You can refine the query by narrowing the date range.",
                suggestedSql: "delete from events"
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const result = await answerQueryFollowUp(sampleRequest);
    assert.equal(result.suggestedSql, undefined);
    assert.match(result.warning ?? "", /omitted/i);
  } finally {
    appConfig.openRouterApiKey = originalKey;
    globalThis.fetch = originalFetch;
  }
});
