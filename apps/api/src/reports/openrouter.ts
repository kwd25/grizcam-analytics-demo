import { operationalReportSchema, type OperationalReport, type ReportSnapshotSummary } from "@grizcam/shared";
import { ZodError } from "zod";
import { appConfig } from "../config.js";
import { ReportServiceError } from "./errors.js";

type OpenRouterChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
  finish_reason?: string | null;
  native_finish_reason?: string | null;
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
};

type OpenRouterResult = {
  content: string;
  finishReason: string | null;
  nativeFinishReason: string | null;
};

type OpenRouterRequestBody = {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
  max_tokens: number;
  response_format?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: typeof OPERATIONAL_REPORT_JSON_SCHEMA;
    };
  };
  plugins?: Array<{ id: string }>;
};

export type ReportGenerationResult = {
  report: OperationalReport;
  timingMs: {
    modelRequest: number;
    validation: number;
    snapshotBytes: number;
    promptChars: number;
    modelCalls: number;
  };
};

type ReportModelClient = {
  generateReport: (snapshot: ReportSnapshotSummary, options?: ReportGenerationOptions) => Promise<ReportGenerationResult>;
};

type ReportGenerationOptions = {
  requestId?: string;
  deadlineAtMs?: number;
};

type UnknownRecord = Record<string, unknown>;

const SYSTEM_PROMPT = `You are generating an operations briefing for GrizCam analytics.

Rules:
- Use only the supplied analytics snapshot.
- Do not invent root causes, external facts, or unavailable metrics.
- Separate direct observations from light inferences and recommendations.
- If evidence is limited, say so directly.
- Prefer concise operator / manager language over chatbot phrasing.
- Emphasize operational awareness, actionable recommendations, cautious trend interpretation, anomalies, risks, and opportunities.
- Keep all evidence grounded in the provided counts, percentages, and trend notes.
- Keep the report compact: 2-4 executive summary bullets, 2-6 key findings, 1-5 recommended actions, 0-5 risks/watchouts, and 0-5 open questions.
- Each key finding may include 1-3 evidence bullets.
- Return JSON only with exactly this shape:
{
  "headline": "string",
  "executive_summary": ["string", "string", "string"],
  "key_findings": [
    {
      "title": "string",
      "evidence": ["string", "string"],
      "confidence": "low|medium|high",
      "actionability": "string"
    }
  ],
  "recommended_actions": [
    {
      "priority": 1,
      "action": "string",
      "why": "string"
    }
  ],
  "risks_or_watchouts": [
    {
      "title": "string",
      "impact": "string",
      "suggested_followup": "string"
    }
  ],
  "open_questions": ["string"]
}
- Do not wrap the JSON in markdown fences.`;

const REPAIR_PROMPT = `Repair the prior response into valid JSON matching the required schema exactly.

Rules:
- Preserve the original meaning where possible.
- Use only the prior response.
- Output JSON only.
- Do not add markdown fences or commentary.`;

const STRICT_REPAIR_PROMPT = `Convert failed report model output into one valid JSON object matching the required schema exactly.

Rules:
- The first character of your response must be {.
- The last character of your response must be }.
- Output only JSON. No markdown, no code fences, no apologies, no explanations, no observations, no meta-commentary.
- Do not write phrases like "I notice", "Here is", "The issue is", or "I fixed".
- Preserve the original meaning where possible.
- Use only the supplied failed responses.
- If a required field is missing, fill it with concise operator-facing language grounded in the supplied failed responses.
- Required JSON shape:
{
  "headline": "string",
  "executive_summary": ["string"],
  "key_findings": [
    {
      "title": "string",
      "evidence": ["string"],
      "confidence": "low|medium|high",
      "actionability": "string"
    }
  ],
  "recommended_actions": [
    {
      "priority": 1,
      "action": "string",
      "why": "string"
    }
  ],
  "risks_or_watchouts": [
    {
      "title": "string",
      "impact": "string",
      "suggested_followup": "string"
    }
  ],
  "open_questions": ["string"]
}
- Array limits: executive_summary 1-4, key_findings 1-6, evidence 1-3 per finding, recommended_actions 1-5, risks_or_watchouts 0-5, open_questions 0-5.
- Confidence must be exactly one of low, medium, or high.
- Priority must be an integer from 1 to 5.`;

const OPERATIONAL_REPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "executive_summary", "key_findings", "recommended_actions", "risks_or_watchouts", "open_questions"],
  properties: {
    headline: { type: "string", minLength: 1, maxLength: 240 },
    executive_summary: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 320 }
    },
    key_findings: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "evidence", "confidence", "actionability"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 240 },
          evidence: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 1, maxLength: 320 }
          },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          actionability: { type: "string", minLength: 1, maxLength: 320 }
        }
      }
    },
    recommended_actions: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "action", "why"],
        properties: {
          priority: { type: "integer", minimum: 1, maximum: 5 },
          action: { type: "string", minLength: 1, maxLength: 240 },
          why: { type: "string", minLength: 1, maxLength: 320 }
        }
      }
    },
    risks_or_watchouts: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "impact", "suggested_followup"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 240 },
          impact: { type: "string", minLength: 1, maxLength: 320 },
          suggested_followup: { type: "string", minLength: 1, maxLength: 320 }
        }
      }
    },
    open_questions: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 240 }
    }
  }
} as const;

const extractOpenRouterResult = (payload: OpenRouterResponse): OpenRouterResult => {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") {
    return {
      content,
      finishReason: choice?.finish_reason ?? null,
      nativeFinishReason: choice?.native_finish_reason ?? null
    };
  }

  if (Array.isArray(content)) {
    return {
      content: content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim(),
      finishReason: choice?.finish_reason ?? null,
      nativeFinishReason: choice?.native_finish_reason ?? null
    };
  }

  return {
    content: "",
    finishReason: choice?.finish_reason ?? null,
    nativeFinishReason: choice?.native_finish_reason ?? null
  };
};

const stripJsonFences = (raw: string) =>
  raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const extractJsonObject = (raw: string) => {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (start < 0) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  if (start >= 0) {
    throw new Error("The report response did not contain a complete JSON object.");
  }

  throw new Error("The report response did not contain a JSON object.");
};

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const pathLabel = (path: Array<string | number | symbol>) => (path.length > 0 ? path.map(String).join(".") : "root");

const summarizeModelOutputError = (error: unknown) => {
  if (error instanceof ZodError) {
    const issuePreview = error.issues
      .slice(0, 5)
      .map((issue) => `${pathLabel(issue.path)}: ${issue.message}`)
      .join("; ");
    const suffix = error.issues.length > 5 ? `; ${error.issues.length - 5} more issue(s)` : "";
    return `The report model output did not match the required report schema (${error.issues.length} issue(s)): ${issuePreview}${suffix}.`;
  }

  return error instanceof Error ? error.message : "The report response was invalid.";
};

const limitArray = (record: UnknownRecord, key: string, maxLength: number, adjustments: Record<string, number>) => {
  const value = record[key];
  if (!Array.isArray(value) || value.length <= maxLength) {
    return value;
  }

  adjustments[key] = value.length - maxLength;
  return value.slice(0, maxLength);
};

const normalizePriority = (value: unknown, adjustments: Record<string, number>) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }

  const normalized = Math.min(5, Math.max(1, Math.trunc(value)));
  if (normalized !== value) {
    adjustments.recommended_actions_priority = (adjustments.recommended_actions_priority ?? 0) + 1;
  }
  return normalized;
};

const normalizeReportCandidate = (candidate: unknown) => {
  if (!isRecord(candidate)) {
    return { candidate, adjustments: {} as Record<string, number> };
  }

  const adjustments: Record<string, number> = {};
  const normalized: UnknownRecord = { ...candidate };

  normalized.executive_summary = limitArray(normalized, "executive_summary", 4, adjustments);
  normalized.recommended_actions = limitArray(normalized, "recommended_actions", 5, adjustments);
  normalized.risks_or_watchouts = limitArray(normalized, "risks_or_watchouts", 5, adjustments);
  normalized.open_questions = limitArray(normalized, "open_questions", 5, adjustments);

  if (Array.isArray(normalized.key_findings)) {
    const limitedFindings = limitArray(normalized, "key_findings", 6, adjustments);
    normalized.key_findings = Array.isArray(limitedFindings)
      ? limitedFindings.map((finding) => {
          if (!isRecord(finding)) {
            return finding;
          }
          const normalizedFinding: UnknownRecord = { ...finding };
          const evidence = limitArray(normalizedFinding, "evidence", 3, adjustments);
          normalizedFinding.evidence = evidence;
          return normalizedFinding;
        })
      : limitedFindings;
  }

  if (Array.isArray(normalized.recommended_actions)) {
    normalized.recommended_actions = normalized.recommended_actions.map((action) => {
      if (!isRecord(action)) {
        return action;
      }
      return {
        ...action,
        priority: normalizePriority(action.priority, adjustments)
      };
    });
  }

  return { candidate: normalized, adjustments };
};

type ReportModelPhase = "initial" | "repair" | "strict_repair";

const parseReport = (raw: string, context: { requestId?: string; phase: ReportModelPhase }): OperationalReport => {
  const parsed = JSON.parse(extractJsonObject(stripJsonFences(raw)));
  const normalized = normalizeReportCandidate(parsed);
  if (Object.keys(normalized.adjustments).length > 0) {
    console.log("reports.model.normalized", {
      requestId: context.requestId ?? null,
      phase: context.phase,
      adjustments: normalized.adjustments
    });
  }
  return operationalReportSchema.parse(normalized.candidate);
};

const isTruncatedFinishReason = (reason: string | null | undefined) => {
  const normalized = reason?.toLowerCase();
  return normalized === "length" || normalized === "max_tokens" || normalized === "max_completion_tokens" || normalized === "token_limit";
};

const buildOpenRouterBody = (
  messages: Array<{ role: "system" | "user"; content: string }>,
  useStructuredOutput: boolean
): OpenRouterRequestBody => {
  const body: OpenRouterRequestBody = {
    model: appConfig.openRouterModel,
    messages,
    temperature: 0.2,
    max_tokens: appConfig.reportMaxTokens
  };

  if (useStructuredOutput) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "operational_report",
        strict: true,
        schema: OPERATIONAL_REPORT_JSON_SCHEMA
      }
    };
    body.plugins = [{ id: "response-healing" }];
  }

  return body;
};

const isStructuredOutputUnsupported = (status: number, bodyPreview: string) => {
  if (status !== 400 && status !== 422) {
    return false;
  }

  const normalized = bodyPreview.toLowerCase();
  const mentionsStructuredOutput =
    normalized.includes("response_format") ||
    normalized.includes("json_schema") ||
    normalized.includes("format.schema") ||
    normalized.includes("output_config") ||
    normalized.includes("schema") ||
    normalized.includes("structured") ||
    normalized.includes("response-healing");
  const mentionsUnsupported =
    normalized.includes("unsupported") ||
    normalized.includes("not supported") ||
    normalized.includes("unrecognized") ||
    normalized.includes("invalid") ||
    normalized.includes("not available");

  return mentionsStructuredOutput && mentionsUnsupported;
};

const providerErrorForStatus = (status: number, bodyPreview: string) => {
  if (status === 401 || status === 403) {
    return {
      code: "REPORT_MODEL_AUTH_FAILED" as const,
      message: `OpenRouter rejected the configured API key or project permissions with HTTP ${status}.`
    };
  }

  if (status === 404) {
    return {
      code: "REPORT_MODEL_NOT_FOUND" as const,
      message: `The configured report model was not found by OpenRouter: ${appConfig.openRouterModel}.`
    };
  }

  if (status === 429) {
    return {
      code: "REPORT_MODEL_RATE_LIMITED" as const,
      message: "OpenRouter rate-limited report generation. Retry after capacity resets or raise the provider quota."
    };
  }

  if (status >= 500) {
    return {
      code: "REPORT_MODEL_PROVIDER_ERROR" as const,
      message: `OpenRouter returned HTTP ${status} while generating the report.`
    };
  }

  return {
    code: "REPORT_MODEL_BAD_REQUEST" as const,
    message: `OpenRouter rejected the report request with HTTP ${status}.${bodyPreview ? ` ${bodyPreview}` : ""}`
  };
};

const throwIfTruncated = (result: OpenRouterResult, phase: ReportModelPhase) => {
  if (!isTruncatedFinishReason(result.finishReason) && !isTruncatedFinishReason(result.nativeFinishReason)) {
    return;
  }

  throw new ReportServiceError(
    "REPORT_INVALID_MODEL_OUTPUT",
    `The report model response was truncated before valid JSON completed during ${phase} generation; increase REPORT_MAX_TOKENS or reduce output size.`,
    "validating_response"
  );
};

const remainingDeadlineMs = (deadlineAtMs?: number) => (deadlineAtMs ? deadlineAtMs - Date.now() : Number.POSITIVE_INFINITY);

const hasRepairTime = (deadlineAtMs?: number) => remainingDeadlineMs(deadlineAtMs) >= appConfig.reportRepairMinRemainingMs;

const getCallTimeoutMs = (deadlineAtMs?: number) => {
  const remainingMs = remainingDeadlineMs(deadlineAtMs);
  if (remainingMs <= 1_000) {
    throw new ReportServiceError(
      "REPORT_MODEL_TIMEOUT",
      "Report generation reached its server deadline before OpenRouter could be called.",
      "calling_model"
    );
  }

  return Math.max(1_000, Math.min(appConfig.reportModelTimeoutMs, Number.isFinite(remainingMs) ? remainingMs : appConfig.reportModelTimeoutMs));
};

const callOpenRouter = async (
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: ReportGenerationOptions & { phase: ReportModelPhase; promptChars: number; useStructuredOutput?: boolean }
) => {
  if (!appConfig.openRouterApiKey) {
    throw new ReportServiceError(
      "REPORT_MODEL_UNAVAILABLE",
      "Report generation is unavailable because OPENROUTER_API_KEY is not configured on the server.",
      "calling_model"
    );
  }

  if (!appConfig.openRouterModel.trim()) {
    throw new ReportServiceError(
      "REPORT_MODEL_BAD_REQUEST",
      "Report generation is unavailable because OPENROUTER_MODEL is empty on the server.",
      "calling_model"
    );
  }

  const controller = new AbortController();
  const timeoutMs = getCallTimeoutMs(options.deadlineAtMs);
  const startedAt = Date.now();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const useStructuredOutput = options.useStructuredOutput ?? true;

  console.log("reports.model.start", {
    requestId: options.requestId ?? null,
    phase: options.phase,
    model: appConfig.openRouterModel,
    timeoutMs,
    promptChars: options.promptChars,
    maxTokens: appConfig.reportMaxTokens,
    structuredOutput: useStructuredOutput,
    remainingDeadlineMs: Number.isFinite(remainingDeadlineMs(options.deadlineAtMs)) ? Math.max(0, remainingDeadlineMs(options.deadlineAtMs)) : null
  });

  let response: Response;
  try {
    response = await fetch(`${appConfig.openRouterBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appConfig.openRouterApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildOpenRouterBody(messages, useStructuredOutput)),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ReportServiceError(
        "REPORT_MODEL_TIMEOUT",
        `Report generation timed out after ${Math.round(timeoutMs / 1000)} seconds while waiting for OpenRouter during ${options.phase} generation.`,
        "calling_model"
      );
    }
    const message = error instanceof Error ? error.message : "Unknown OpenRouter connection failure.";
    throw new ReportServiceError("REPORT_MODEL_UNAVAILABLE", `Report generation could not connect to OpenRouter. ${message}`, "calling_model");
  }

  clearTimeout(timeoutId);
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const bodyPreview = text.slice(0, 400);
    console.error("reports.model.provider_error", {
      requestId: options.requestId ?? null,
      phase: options.phase,
      model: appConfig.openRouterModel,
      status: response.status,
      elapsedMs,
      structuredOutput: useStructuredOutput,
      bodyPreview
    });

    if (useStructuredOutput && isStructuredOutputUnsupported(response.status, bodyPreview)) {
      console.warn("reports.model.structured_output_fallback", {
        requestId: options.requestId ?? null,
        phase: options.phase,
        model: appConfig.openRouterModel,
        status: response.status,
        remainingDeadlineMs: Number.isFinite(remainingDeadlineMs(options.deadlineAtMs)) ? Math.max(0, remainingDeadlineMs(options.deadlineAtMs)) : null
      });
      return await callOpenRouter(messages, { ...options, useStructuredOutput: false });
    }

    const providerError = providerErrorForStatus(response.status, bodyPreview);
    throw new ReportServiceError(providerError.code, providerError.message, "calling_model");
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const result = extractOpenRouterResult(payload);

  console.log("reports.model.end", {
    requestId: options.requestId ?? null,
    phase: options.phase,
    model: appConfig.openRouterModel,
    elapsedMs,
    status: response.status,
    responseChars: result.content.length,
    finishReason: result.finishReason,
    nativeFinishReason: result.nativeFinishReason,
    structuredOutput: useStructuredOutput
  });

  return result;
};

const buildStrictRepairPrompt = (input: {
  originalResponse: string;
  repairedResponse: string;
  initialError: unknown;
  repairError: unknown;
}) => `Initial validation failure:
${summarizeModelOutputError(input.initialError)}

Repair validation failure:
${summarizeModelOutputError(input.repairError)}

Original response:
${input.originalResponse}

Failed repair response:
${input.repairedResponse}`;

export const createOpenRouterReportClient = (): ReportModelClient => ({
  async generateReport(snapshot, options = {}) {
    const snapshotJson = JSON.stringify(snapshot);
    const userPrompt = `Generate the operational briefing from this analytics snapshot.\n\n${snapshotJson}`;
    const timingMs = {
      modelRequest: 0,
      validation: 0,
      snapshotBytes: Buffer.byteLength(snapshotJson, "utf8"),
      promptChars: userPrompt.length,
      modelCalls: 0
    };

    const firstModelStartedAt = Date.now();
    timingMs.modelCalls += 1;
    const rawResult = await callOpenRouter([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ], { ...options, phase: "initial", promptChars: userPrompt.length });
    timingMs.modelRequest += Date.now() - firstModelStartedAt;

    const firstValidationStartedAt = Date.now();
    try {
      throwIfTruncated(rawResult, "initial");
      const report = parseReport(rawResult.content, { requestId: options.requestId, phase: "initial" });
      timingMs.validation += Date.now() - firstValidationStartedAt;
      return { report, timingMs };
    } catch (error) {
      timingMs.validation += Date.now() - firstValidationStartedAt;

      if (!hasRepairTime(options.deadlineAtMs)) {
        const message = summarizeModelOutputError(error);
        throw new ReportServiceError(
          "REPORT_INVALID_MODEL_OUTPUT",
          `The report model returned invalid report output and there was not enough time left to repair it safely before the server deadline. ${message}`,
          "validating_response"
        );
      }

      const repairPrompt = `Original response:\n${rawResult.content}`;
      const repairModelStartedAt = Date.now();
      timingMs.modelCalls += 1;
      const repairedResult = await callOpenRouter([
        { role: "system", content: REPAIR_PROMPT },
        {
          role: "user",
          content: repairPrompt
        }
      ], { ...options, phase: "repair", promptChars: repairPrompt.length });
      timingMs.modelRequest += Date.now() - repairModelStartedAt;

      const repairValidationStartedAt = Date.now();
      try {
        throwIfTruncated(repairedResult, "repair");
        const report = parseReport(repairedResult.content, { requestId: options.requestId, phase: "repair" });
        timingMs.validation += Date.now() - repairValidationStartedAt;
        return { report, timingMs };
      } catch (repairError) {
        timingMs.validation += Date.now() - repairValidationStartedAt;

        if (!hasRepairTime(options.deadlineAtMs)) {
          const message = summarizeModelOutputError(repairError);
          throw new ReportServiceError(
            "REPORT_INVALID_MODEL_OUTPUT",
            `The report model returned invalid report output after repair and there was not enough time left for a strict repair retry before the server deadline. ${message}`,
            "validating_response"
          );
        }

        const strictRepairPrompt = buildStrictRepairPrompt({
          originalResponse: rawResult.content,
          repairedResponse: repairedResult.content,
          initialError: error,
          repairError
        });
        const strictRepairModelStartedAt = Date.now();
        timingMs.modelCalls += 1;
        const strictRepairedResult = await callOpenRouter([
          { role: "system", content: STRICT_REPAIR_PROMPT },
          {
            role: "user",
            content: strictRepairPrompt
          }
        ], { ...options, phase: "strict_repair", promptChars: strictRepairPrompt.length });
        timingMs.modelRequest += Date.now() - strictRepairModelStartedAt;

        const strictRepairValidationStartedAt = Date.now();
        try {
          throwIfTruncated(strictRepairedResult, "strict_repair");
          const report = parseReport(strictRepairedResult.content, { requestId: options.requestId, phase: "strict_repair" });
          timingMs.validation += Date.now() - strictRepairValidationStartedAt;
          return { report, timingMs };
        } catch (strictRepairError) {
          timingMs.validation += Date.now() - strictRepairValidationStartedAt;
          const message = summarizeModelOutputError(strictRepairError);
          throw new ReportServiceError(
            "REPORT_INVALID_MODEL_OUTPUT",
            `The report model returned invalid report output after strict repair. ${message}`,
            "validating_response"
          );
        }
      }
    }
  }
});
