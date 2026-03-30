import { Router } from "express";
import { appConfig } from "../config.js";
import { pool } from "../db.js";
import {
  getComposition,
  getDailyActivity,
  getDaySummary,
  getDevices,
  getEvents,
  getEventsCsv,
  getFilterOptions,
  getHourlyHeatmap,
  getKpis,
  getMonthlyActivityByCategory,
  getSubjectByCamera,
  getTimeOfDayComposition
} from "../queries/dashboard.js";
import { parseEventQuery, parseFilters } from "../utils/requests.js";

export const dashboardRouter = Router();

dashboardRouter.get("/health", async (_request, response) => {
  try {
    await pool.query("select 1");
    response.json({ ok: true, database: "ok", environment: appConfig.environment });
  } catch {
    response.status(503).json({ ok: false, database: "unavailable", environment: appConfig.environment });
  }
});

dashboardRouter.get("/devices", async (_request, response) => {
  response.json(await getDevices());
});

dashboardRouter.get("/filters/options", async (_request, response) => {
  response.json(await getFilterOptions());
});

dashboardRouter.get("/kpis", async (request, response) => {
  response.json(await getKpis(parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/charts/daily-activity", async (request, response) => {
  response.json(await getDailyActivity(parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/charts/hourly-heatmap", async (request, response) => {
  response.json(await getHourlyHeatmap(parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/charts/time-of-day-composition", async (request, response) => {
  response.json(await getTimeOfDayComposition(parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/charts/subject-by-camera", async (request, response) => {
  response.json(await getSubjectByCamera(parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/charts/monthly-activity-by-category", async (request, response) => {
  response.json(await getMonthlyActivityByCategory(parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/charts/composition", async (request, response) => {
  response.json(await getComposition(parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/day/:date/summary", async (request, response) => {
  response.json(await getDaySummary(request.params.date, parseFilters(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/events", async (request, response) => {
  response.json(await getEvents(parseEventQuery(request.query as Record<string, unknown>)));
});

dashboardRouter.get("/events/export", async (request, response) => {
  if (!appConfig.exportsEnabled) {
    response.status(404).json({ error: "Export is disabled for this demo deployment" });
    return;
  }

  const csv = await getEventsCsv(parseEventQuery(request.query as Record<string, unknown>));
  response.setHeader("content-type", "text/csv; charset=utf-8");
  response.setHeader("content-disposition", 'attachment; filename="grizcam-events.csv"');
  response.send(csv);
});
