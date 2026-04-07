import { z } from "zod";
import { Router } from "express";
import { getQueryMetadata } from "../query/catalog.js";
import { exportSafeQueryCsv, runSafeQuery, validateQuerySql } from "../query/service.js";

const queryRequestSchema = z.object({
  sql: z.string().min(1).max(12_000)
});

const queryExportSchema = queryRequestSchema.extend({
  format: z.enum(["csv"]).default("csv")
});

export const queryRouter = Router();

queryRouter.get("/metadata", (_request, response) => {
  response.json(getQueryMetadata());
});

queryRouter.post("/validate", (request, response) => {
  const { sql } = queryRequestSchema.parse(request.body);
  const result = validateQuerySql(sql);
  response.status(result.ok ? 200 : 400).json(result);
});

queryRouter.post("/run", async (request, response) => {
  const { sql } = queryRequestSchema.parse(request.body);
  const result = await runSafeQuery(sql);
  response.status(result.ok ? 200 : 400).json(result);
});

queryRouter.post("/export", async (request, response) => {
  const { sql } = queryExportSchema.parse(request.body);
  const result = await exportSafeQueryCsv(sql);

  if (!result.ok) {
    response.status(400).json(result.validation);
    return;
  }

  response.setHeader("content-type", "text/csv; charset=utf-8");
  response.setHeader("content-disposition", 'attachment; filename="grizcam-query-results.csv"');
  response.send(result.csv);
});
