import { z } from "zod";
import { Router } from "express";
import { getQueryMetadata } from "../query/catalog.js";
import { answerQueryFollowUp } from "../query/followUp.js";
import { GenerateSqlError, generateSqlFromPrompt } from "../query/generateSql.js";
import { exportSafeQueryCsv, runSafeQuery, validateQuerySql } from "../query/service.js";

const queryRequestSchema = z.object({
  sql: z.string().min(1).max(12_000)
});

const generateSqlRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1_000)
});

const followUpRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(4_000)
    })
  ),
  latestQuery: z
    .object({
      sql: z.string().optional(),
      validation: z
        .object({
          ok: z.boolean(),
          appliedLimit: z.number().optional(),
          issues: z.array(z.string())
        })
        .optional(),
      result: z
        .object({
          rowCount: z.number().optional(),
          durationMs: z.number().optional(),
          appliedLimit: z.number().optional(),
          columns: z.array(z.string()).optional()
        })
        .optional()
    })
    .optional()
});

const queryExportSchema = queryRequestSchema.extend({
  format: z.enum(["csv"]).default("csv")
});

export const queryRouter = Router();

queryRouter.get("/metadata", (_request, response) => {
  response.json(getQueryMetadata());
});

queryRouter.post("/generate-sql", async (request, response) => {
  const { prompt } = generateSqlRequestSchema.parse(request.body);

  try {
    const result = await generateSqlFromPrompt(prompt);
    response.json(result);
  } catch (error) {
    if (error instanceof GenerateSqlError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
});

queryRouter.post("/follow-up", async (request, response) => {
  const payload = followUpRequestSchema.parse(request.body);

  try {
    const result = await answerQueryFollowUp(payload);
    response.json(result);
  } catch (error) {
    if (error instanceof GenerateSqlError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
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
