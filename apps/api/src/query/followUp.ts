import type { QueryFollowUpRequest, QueryFollowUpResponse } from "@grizcam/shared";
import { appConfig } from "../config.js";
import { GenerateSqlError, sanitizeGeneratedSql } from "./generateSql.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPENROUTER_MODEL = "qwen/qwen3-coder-next";
const BRIEFING_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../DB_SCHEMA_BRIEFING.md");

const FOLLOW_UP_SYSTEM_PROMPT = `You are a GrizCam analytics query expert embedded in the query workspace.

You help users understand the GrizCam dataset, explain query behavior, diagnose validation failures, and suggest safe refinements.

Rules:
- Ground every answer in the supplied GrizCam schema briefing and the explicit latest-query context.
- Never invent tables, columns, functions, relationships, or data facts.
- Never claim a query was executed unless the context explicitly says it was.
- Write in plain language for non-technical readers.
- Use short, clean markdown-friendly prose with helpful paragraph breaks and brief bullet lists when useful.
- Be concise, practical, and data-focused.
- Explain what happened, why it matters, and what to do next.
- Prefer everyday wording over SQL jargon unless the technical detail is needed to be accurate.
- If you mention a technical concept, explain it in a friendly sentence.
- Be explicit when you are inferring something from the available context.
- If useful, you may propose an optional revised SQL draft, but do not imply it has been run.
- Any suggested SQL must be exactly one read-only PostgreSQL SELECT/WITH statement using only the real GrizCam schema.
- Advanced analytical SQL is allowed, including window functions and ordered-set aggregates, when appropriate.
- Return JSON only with this shape:
  {"answer":"string","suggestedSql":"optional string","warning":"optional string"}
- Do not wrap the JSON in markdown fences.`;

type OpenRouterChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
};

let briefingCache: string | null = null;

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
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
};

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

const coerceFollowUpResponse = (raw: string): QueryFollowUpResponse => {
  const cleaned = extractJsonObject(stripJsonFences(raw));

  try {
    const parsed = JSON.parse(cleaned) as { answer?: unknown; suggestedSql?: unknown; warning?: unknown };
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : cleaned;
    const warning = typeof parsed.warning === "string" && parsed.warning.trim() ? parsed.warning.trim() : undefined;

    if (typeof parsed.suggestedSql === "string" && parsed.suggestedSql.trim()) {
      try {
        return {
          answer,
          suggestedSql: sanitizeGeneratedSql(parsed.suggestedSql),
          warning
        };
      } catch {
        return {
          answer,
          warning: warning ?? "A suggested SQL draft was omitted because it did not meet workspace safety rules."
        };
      }
    }

    return { answer, warning };
  } catch {
    return {
      answer:
        cleaned && !cleaned.trim().startsWith("{")
          ? cleaned
          : "I couldn't format that answer cleanly, but I can try again or suggest a simpler follow-up question."
    };
  }
};

export const answerQueryFollowUp = async (request: QueryFollowUpRequest): Promise<QueryFollowUpResponse> => {
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
          content: `${FOLLOW_UP_SYSTEM_PROMPT}\n\nSchema briefing:\n${briefing}`
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Answer the user's follow-up using the provided conversation and latest query context.",
            prompt: request.prompt,
            history: request.history,
            latestQuery: request.latestQuery ?? null
          })
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("OpenRouter follow-up failed", {
      model: OPENROUTER_MODEL,
      status: response.status,
      promptLength: request.prompt.length,
      historyCount: request.history.length,
      durationMs: Date.now() - startedAt,
      bodyPreview: text.slice(0, 400)
    });
    throw new GenerateSqlError("The follow-up assistant is unavailable right now.", 502);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const result = coerceFollowUpResponse(extractMessageContent(payload));

  console.log("OpenRouter follow-up succeeded", {
    model: OPENROUTER_MODEL,
    promptLength: request.prompt.length,
    historyCount: request.history.length,
    durationMs: Date.now() - startedAt,
    hasSuggestedSql: Boolean(result.suggestedSql)
  });

  return {
    ...result,
    model: OPENROUTER_MODEL
  };
};
