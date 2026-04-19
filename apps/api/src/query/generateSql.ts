import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GenerateSqlResponse } from "@grizcam/shared";
import { appConfig } from "../config.js";

const OPENROUTER_MODEL = "qwen/qwen3-coder-next";
const BRIEFING_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../DB_SCHEMA_BRIEFING.md");

const SYSTEM_PROMPT = `You generate SQL for the GrizCam analytics app.

Rules:
- Output PostgreSQL only.
- Generate exactly one read-only statement.
- Only use the real GrizCam schema and columns from the supplied briefing.
- Never invent tables, columns, functions, or semantics not present in the briefing.
- Prefer daily_camera_summary for trend, KPI, seasonality, and camera-comparison questions.
- Prefer events for detailed event inspection and recent event listings.
- Join tables on mac when a join is needed.
- Avoid SELECT * on events. Always name event columns explicitly.
- Advanced analytical SQL is allowed, including window functions and ordered-set aggregates, when they fit the question.
- Keep syntax simple and validator-friendly for a restricted read-only SQL workspace.
- Use SELECT or WITH only.
- Avoid schema-qualified references unless the briefing explicitly requires them.
- Avoid ORDER BY aliases if compatibility is uncertain; prefer repeating the expression or ordering by base columns.
- Prefer explicit LIMIT clauses that stay reasonably small.
- Never produce write, DDL, transaction, admin, or multi-statement SQL.
- Write explanations in plain language for non-technical users.
- Keep explanation text polished, brief, and suitable for a general audience.
- Return JSON only with this shape:
  {"sql":"string","userIntentSummary":"string","queryExplanation":"string","warning":"optional string"}
- The sql field must contain the only executable SQL statement.
- userIntentSummary should briefly restate what the user is asking for.
- queryExplanation should briefly explain how the query answers that request and why the chosen table(s) fit.
- Do not wrap the JSON in markdown fences.`;

let briefingCache: string | null = null;

type OpenRouterChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
};

type OpenRouterResponse = {
  id?: string;
  choices?: OpenRouterChoice[];
};

type GeneratedSqlPayload = {
  sql?: unknown;
  userIntentSummary?: unknown;
  queryExplanation?: unknown;
  warning?: unknown;
};

export class GenerateSqlError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "GenerateSqlError";
    this.statusCode = statusCode;
  }
}

const stripJsonFences = (raw: string) =>
  raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const extractJsonObject = (raw: string) => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return raw.slice(start, end + 1);
  }
  return raw;
};

const getBriefing = async () => {
  if (briefingCache) {
    return briefingCache;
  }

  briefingCache = await readFile(BRIEFING_PATH, "utf8");
  return briefingCache;
};

const extractMessageContent = (payload: OpenRouterResponse) => {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
};

export const sanitizeGeneratedSql = (raw: string) => {
  const withoutFences = raw
    .replace(/^```(?:sql|postgresql)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const singleLine = withoutFences.trim();
  const withoutTrailingSemicolon = singleLine.replace(/;\s*$/, "").trim();

  if (!withoutTrailingSemicolon) {
    throw new GenerateSqlError("The AI helper returned an empty SQL response.", 502);
  }

  if (withoutTrailingSemicolon.includes(";")) {
    throw new GenerateSqlError("The AI helper returned multiple statements, which are not allowed.", 502);
  }

  if (!/^\s*(select|with)\b/i.test(withoutTrailingSemicolon)) {
    throw new GenerateSqlError("The AI helper returned a non-read-only SQL statement.", 502);
  }

  return withoutTrailingSemicolon;
};

const sanitizeExplanation = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const cleaned = value.replace(/\r\n/g, "\n").trim();
  return cleaned || fallback;
};

const coerceGenerateSqlResponse = (raw: string): GenerateSqlResponse => {
  const cleaned = extractJsonObject(stripJsonFences(raw));

  let parsed: GeneratedSqlPayload;
  try {
    parsed = JSON.parse(cleaned) as GeneratedSqlPayload;
  } catch {
    throw new GenerateSqlError("The AI helper returned an invalid SQL response payload.", 502);
  }

  return {
    sql: sanitizeGeneratedSql(typeof parsed.sql === "string" ? parsed.sql : ""),
    userIntentSummary: sanitizeExplanation(
      parsed.userIntentSummary,
      "This request asks for a read-only query built from the GrizCam dataset."
    ),
    queryExplanation: sanitizeExplanation(
      parsed.queryExplanation,
      "This query uses the GrizCam schema to answer the request in a read-only way."
    ),
    warning: typeof parsed.warning === "string" && parsed.warning.trim() ? parsed.warning.trim() : undefined
  };
};

export const generateSqlFromPrompt = async (prompt: string) => {
  if (!appConfig.openRouterApiKey) {
    throw new GenerateSqlError("OPENROUTER_API_KEY is not configured on the server.", 503);
  }

  const startedAt = Date.now();
  const briefing = await getBriefing();

  const response = await fetch(`${appConfig.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appConfig.openRouterApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\n\nSchema briefing:\n${briefing}`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("OpenRouter SQL generation failed", {
      model: OPENROUTER_MODEL,
      status: response.status,
      promptLength: prompt.length,
      durationMs: Date.now() - startedAt,
      bodyPreview: text.slice(0, 400)
    });
    throw new GenerateSqlError("The AI SQL generation service is unavailable right now.", 502);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const result = coerceGenerateSqlResponse(extractMessageContent(payload));

  console.log("OpenRouter SQL generation succeeded", {
    model: OPENROUTER_MODEL,
    promptLength: prompt.length,
    sqlLength: result.sql.length,
    durationMs: Date.now() - startedAt
  });

  return {
    ...result,
    model: OPENROUTER_MODEL
  };
};
