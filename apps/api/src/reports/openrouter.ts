import { operationalReportSchema, type OperationalReport, type ReportSnapshotSummary } from "@grizcam/shared";
import { appConfig } from "../config.js";

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
  };
};

type ReportModelClient = {
  generateReport: (snapshot: ReportSnapshotSummary) => Promise<ReportGenerationResult>;
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

const callOpenRouter = async (messages: Array<{ role: "system" | "user"; content: string }>) => {
  if (!appConfig.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  }

  const response = await fetch(`${appConfig.openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appConfig.openRouterApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: appConfig.openRouterModel,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("OpenRouter report generation failed", {
      model: appConfig.openRouterModel,
      status: response.status,
      bodyPreview: text.slice(0, 400)
    });
    throw new Error("The report generation service is unavailable right now.");
  }

  return extractMessageContent((await response.json()) as OpenRouterResponse);
};

export const createOpenRouterReportClient = (): ReportModelClient => ({
  async generateReport(snapshot) {
    const timingMs = {
      modelRequest: 0,
      validation: 0
    };
    const userPrompt = `Generate the operational briefing from this analytics snapshot.\n\n${JSON.stringify(snapshot, null, 2)}`;

    const firstModelStartedAt = Date.now();
    const raw = await callOpenRouter([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]);
    timingMs.modelRequest += Date.now() - firstModelStartedAt;

    const firstValidationStartedAt = Date.now();
    try {
      const report = parseReport(raw);
      timingMs.validation += Date.now() - firstValidationStartedAt;
      return { report, timingMs };
    } catch (error) {
      timingMs.validation += Date.now() - firstValidationStartedAt;

      const repairModelStartedAt = Date.now();
      const repaired = await callOpenRouter([
        { role: "system", content: REPAIR_PROMPT },
        {
          role: "user",
          content: `Snapshot:\n${JSON.stringify(snapshot, null, 2)}\n\nOriginal response:\n${raw}`
        }
      ]);
      timingMs.modelRequest += Date.now() - repairModelStartedAt;

      const repairValidationStartedAt = Date.now();
      try {
        const report = parseReport(repaired);
        timingMs.validation += Date.now() - repairValidationStartedAt;
        return { report, timingMs };
      } catch {
        timingMs.validation += Date.now() - repairValidationStartedAt;
        const message = error instanceof Error ? error.message : "The report response was invalid.";
        throw new Error(`The report model returned invalid JSON after repair. ${message}`);
      }
    }
  }
});
