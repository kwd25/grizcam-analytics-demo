import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { appEnv } from "./lib/env";
import "./styles.css";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const OpsPage = lazy(() => import("./pages/OpsPage").then((module) => ({ default: module.OpsPage })));
const AnalyticsLabPage = lazy(() => import("./pages/AnalyticsLabPage").then((module) => ({ default: module.AnalyticsLabPage })));
const QueryPage = lazy(() => import("./pages/QueryPage").then((module) => ({ default: module.QueryPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));

const queryClient = new QueryClient();

document.title = appEnv.appTitle;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="min-h-screen px-4 py-6 text-slate-100">
              <div className="mx-auto max-w-[1800px]">
                <div className="panel rounded-[32px] px-5 py-10 text-center">
                  <div className="text-sm font-medium text-white">Loading dashboard…</div>
                  <div className="mt-2 text-sm text-slate-400">Preparing the selected workspace.</div>
                </div>
              </div>
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/ops" element={<OpsPage />} />
            <Route path="/analytics-lab" element={<AnalyticsLabPage />} />
            <Route path="/query" element={<QueryPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
