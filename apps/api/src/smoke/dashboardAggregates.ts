import { defaultDashboardFilters } from "@grizcam/shared";
import { pool } from "../db.js";
import { getAnalyticsLab, getOverview } from "../queries/dashboard.js";

const fail = (message: string): never => {
  throw new Error(message);
};

const run = async () => {
  const [overview, analytics] = await Promise.all([
    getOverview(defaultDashboardFilters),
    getAnalyticsLab(defaultDashboardFilters)
  ]);

  if (!overview.cameraHealth.length) {
    fail("Expected overview cameraHealth to be non-empty");
  }

  if (!overview.notableEvents.length) {
    fail("Expected overview notableEvents to be non-empty");
  }

  if (!analytics.hourCategoryHeatmap.length) {
    fail("Expected analytics hourCategoryHeatmap to be non-empty");
  }

  if (!analytics.forecast.length) {
    fail("Expected analytics forecast to be non-empty");
  }

  console.log(
    JSON.stringify(
      {
        overview: {
          totalEvents: overview.kpis.totalEvents,
          cameraHealth: overview.cameraHealth.length,
          notableEvents: overview.notableEvents.length
        },
        analytics: {
          heatmap: analytics.hourCategoryHeatmap.length,
          anomalies: analytics.cameraAnomalies.length,
          forecast: analytics.forecast.length
        }
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
