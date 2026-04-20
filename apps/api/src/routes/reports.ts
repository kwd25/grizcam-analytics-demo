import { Router } from "express";
import { triggerReportRequestSchema } from "@grizcam/shared";
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
  const payload = triggerReportRequestSchema.parse(request.body);
  response.status(202).json(await triggerReportGeneration(payload.filters, payload.force));
});
