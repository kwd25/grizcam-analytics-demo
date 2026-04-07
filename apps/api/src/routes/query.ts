import { z } from "zod";
import { Router } from "express";
import { getQueryMetadata } from "../query/catalog.js";
import { runSafeQuery, validateQuerySql } from "../query/service.js";

const queryRequestSchema = z.object({
  sql: z.string().min(1).max(12_000)
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
