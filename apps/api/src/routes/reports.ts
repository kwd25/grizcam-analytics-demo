import { randomUUID } from "node:crypto";
import { Router } from "express";
import { triggerReportRequestSchema } from "@grizcam/shared";
import { toReportServiceError } from "../reports/errors.js";
import { getLatestReport, getReportStatus, getReportsHealth, triggerReportGeneration } from "../reports/service.js";
import { parseFilters } from "../utils/requests.js";

export const reportsRouter = Router();

reportsRouter.get("/health", async (_request, response) => {
  response.json(await getReportsHealth());
});

reportsRouter.get("/latest", async (request, response) => {
  response.json(await getLatestReport(parseFilters(request.query as Record<string, unknown>)));
});

reportsRouter.get("/status", async (request, response) => {
  response.json(await getReportStatus(parseFilters(request.query as Record<string, unknown>)));
});

reportsRouter.post("/generate", async (request, response) => {
  const requestId = randomUUID();
  const parsed = triggerReportRequestSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      status: "error",
      phase: "error",
      cacheKey: null,
      reportId: "unavailable",
      isExactMatch: false,
      report: null,
      reason: "The report request payload is invalid.",
      errorCode: "REPORT_INPUT_INVALID",
      requestId
    });
    return;
  }

  try {
    response.status(200).json(await triggerReportGeneration(parsed.data.filters, parsed.data.snapshot, parsed.data.force, requestId));
  } catch (error) {
    const reportError = toReportServiceError(error);
    console.error("reports.generate.route", {
      requestId,
      errorCode: reportError.code,
      phase: reportError.phase,
      message: reportError.message
    });
    response.status(200).json({
      status: "error",
      phase: reportError.phase,
      cacheKey: null,
      reportId: "unavailable",
      isExactMatch: false,
      report: null,
      reason: reportError.message,
      errorCode: reportError.code,
      requestId
    });
  }
});
