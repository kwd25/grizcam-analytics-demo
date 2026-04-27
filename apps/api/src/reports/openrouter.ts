import { operationalReportSchema, type OperationalReport, type ReportSnapshotSummary } from "@grizcam/shared";
import { appConfig } from "../config.js";
import { ReportServiceError } from "./errors.js";

type OpenRouterChoice = {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
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

const SYSTEM_PROMPT = `You are generating an operations briefing for GrizCam analytics.

Rules:
- Use only the supplied analytics snapshot.
- Do not invent root causes, external facts, or unavailable metrics.
- Separate direct observations from light inferences and recommendations.
- If evidence is limited, say so directly.
- Prefer concise operator / manager language over chatbot phrasing.
- Emphasize operational awareness, actionable recommendations, cautious trend interpretation, anomalies, risks, and opportunities.
- Keep all evidence grounded in the provided counts, percentages, and trend notes.
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
- Use only the supplied snapshot and prior response.
- Output JSON only.
- Do not add markdown fences or commentary.`;

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

const parseReport = (raw: string): OperationalReport => {
  const parsed = JSON.parse(extractJsonObject(stripJsonFences(raw)));
  return operationalReportSchema.parse(parsed);
};

const remainingDeadlineMs = (deadlineAtMs?: number) => (deadlineAtMs ? deadlineAtMs - Date.now() : Number.POSITIVE_INFINITY);

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
  options: ReportGenerationOptions & { phase: "initial" | "repair"; promptChars: number }
) => {
  if (!appConfig.openRouterApiKey) {
    throw new ReportServiceError(
      "REPORT_MODEL_UNAVAILABLE",
      "Report generation is unavailable because OPENROUTER_API_KEY is not configured on the server.",
      "calling_model"
    );
  }

  const controller = new AbortController();
  const timeoutMs = getCallTimeoutMs(options.deadlineAtMs);
  const startedAt = Date.now();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  console.log("reports.model.start", {
    requestId: options.requestId ?? null,
    phase: options.phase,
    model: appConfig.openRouterModel,
    timeoutMs,
    promptChars: options.promptChars,
    maxTokens: appConfig.reportMaxTokens,
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
      body: JSON.stringify({
        model: appConfig.openRouterModel,
        messages,
        temperature: 0.2,
        max_tokens: appConfig.reportMaxTokens
      }),
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
    console.error("OpenRouter report generation failed", {
      model: appConfig.openRouterModel,
      status: response.status,
      bodyPreview: text.slice(0, 400)
    });
    throw new ReportServiceError("REPORT_MODEL_UNAVAILABLE", "The report generation service is unavailable right now.", "calling_model");
  }

  console.log("reports.model.end", {
    requestId: options.requestId ?? null,
    phase: options.phase,
    model: appConfig.openRouterModel,
    elapsedMs,
    status: response.status
  });

  return extractMessageContent((await response.json()) as OpenRouterResponse);
};

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
    const raw = await callOpenRouter([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ], { ...options, phase: "initial", promptChars: userPrompt.length });
    timingMs.modelRequest += Date.now() - firstModelStartedAt;

    const firstValidationStartedAt = Date.now();
    try {
      const report = parseReport(raw);
      timingMs.validation += Date.now() - firstValidationStartedAt;
      return { report, timingMs };
    } catch (error) {
      timingMs.validation += Date.now() - firstValidationStartedAt;

      if (remainingDeadlineMs(options.deadlineAtMs) < appConfig.reportRepairMinRemainingMs) {
        const message = error instanceof Error ? error.message : "The report response was invalid.";
        throw new ReportServiceError(
          "REPORT_INVALID_MODEL_OUTPUT",
          `The report model returned invalid JSON and there was not enough time left to repair it safely before the server deadline. ${message}`,
          "validating_response"
        );
      }

      const repairPrompt = `Snapshot:\n${snapshotJson}\n\nOriginal response:\n${raw}`;
      const repairModelStartedAt = Date.now();
      timingMs.modelCalls += 1;
      const repaired = await callOpenRouter([
        { role: "system", content: REPAIR_PROMPT },
        {
          role: "user",
          content: repairPrompt
        }
      ], { ...options, phase: "repair", promptChars: repairPrompt.length });
      timingMs.modelRequest += Date.now() - repairModelStartedAt;

      const repairValidationStartedAt = Date.now();
      try {
        const report = parseReport(repaired);
        timingMs.validation += Date.now() - repairValidationStartedAt;
        return { report, timingMs };
      } catch {
        timingMs.validation += Date.now() - repairValidationStartedAt;
        const message = error instanceof Error ? error.message : "The report response was invalid.";
        throw new ReportServiceError(
          "REPORT_INVALID_MODEL_OUTPUT",
          `The report model returned invalid JSON after repair. ${message}`,
          "validating_response"
        );
      }
    }
  }
});
