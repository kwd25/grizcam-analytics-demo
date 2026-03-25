import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { appConfig } from "./config.js";
import { dashboardRouter } from "./routes/dashboard.js";

const buildCorsOrigin = () => {
  if (!appConfig.isProduction) {
    return true;
  }

  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (appConfig.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"));
  };
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use(
    cors({
      origin: buildCorsOrigin()
    })
  );
  app.use(
    rateLimit({
      windowMs: appConfig.apiRateLimit.windowMs,
      max: appConfig.apiRateLimit.max,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", dashboardRouter);

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "Invalid request parameters", details: error.flatten() });
      return;
    }

    if (error instanceof Error && error.message === "Origin not allowed by CORS") {
      response.status(403).json({ error: "Origin not allowed" });
      return;
    }

    console.error(error);
    response.status(500).json({ error: "Internal server error" });
  });

  return app;
};

const app = createApp();

export default app;
