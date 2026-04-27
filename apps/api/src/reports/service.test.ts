import assert from "node:assert/strict";
import test from "node:test";
import { buildReportSnapshot, type DashboardFilters, type OperationalReport, type ReportSnapshotSummary } from "@grizcam/shared";
import { appConfig } from "../config.js";
import { createOpenRouterReportClient } from "./openrouter.js";
import { ReportServiceError } from "./errors.js";
import { hashReportSnapshot } from "./snapshot.js";
import { selectLatestReportView, triggerReportGeneration } from "./service.js";
import type { StoredReportRow } from "./storage.js";

const filters: DashboardFilters = {
  camera_name: ["North Ridge", "South Ridge"],
  mac: [],
  start_date: "2025-01-01",
  end_date: "2025-01-31",
  time_of_day_bucket: [],
  subject_category: [],
  subject_class: [],
  q: "",
  min_lux: undefined,
  max_lux: undefined,
  min_temperature: undefined,
  max_temperature: undefined,
  min_heat_level: undefined,
  max_heat_level: undefined
};

const validReport: OperationalReport = {
  headline: "Operational conditions are mixed, with pipeline health holding but camera risk concentrated in a few assets.",
  executive_summary: [
    "Wildlife activity remains the dominant traffic pattern in this slice.",
    "A small set of cameras account for most operational risk and anomaly pressure.",
    "Recommendations should focus on camera checks before broader interpretation."
  ],
  key_findings: [
    {
      title: "Pipeline conversion is mostly intact",
      evidence: ["Upload and AI completion remain above warning thresholds.", "Drop-off is concentrated in later stages."],
      confidence: "high",
      actionability: "Monitor, but prioritize device remediation before platform changes."
    },
    {
      title: "A few cameras drive most risk",
      evidence: ["Alerting cameras have lower health scores than the rest of the fleet.", "Recent anomaly signals are clustered."],
      confidence: "medium",
      actionability: "Inspect the lowest-health cameras first."
    }
  ],
  recommended_actions: [
    {
      priority: 1,
      action: "Inspect low-health cameras",
      why: "That is the fastest path to reducing stale reporting and power-related blind spots."
    }
  ],
  risks_or_watchouts: [
    {
      title: "Telemetry completeness limits confidence",
      impact: "Power interpretation may miss some true low-voltage cases.",
      suggested_followup: "Cross-check cameras with missing telemetry before escalating replacements."
    }
  ],
  open_questions: ["Are the top anomaly cameras also the ones with the most recent coverage gaps?"]
};

type CapturedOpenRouterRequest = {
  messages?: Array<{ content?: string }>;
  max_tokens?: number;
  response_format?: {
    type?: string;
    json_schema?: {
      name?: string;
      strict?: boolean;
      schema?: {
        required?: string[];
      };
    };
  };
  plugins?: Array<{ id?: string }>;
};

const snapshot: ReportSnapshotSummary = {
  filterKey: "abc",
  filters,
  dateRange: { startDate: "2025-01-01", endDate: "2025-01-31" },
  overviewMetrics: [{ label: "Grouped events", value: 120, note: "Distinct grouped events in the current slice." }],
  overviewHighlights: [{ name: "Grouped event volume", value: 120, detail: "120 grouped events across 8 active cameras." }],
  pipeline: [{ label: "Captured groups", value: 120, note: "Distinct grouped events in the current slice." }],
  opsHighlights: [{ name: "Cameras with alerts", value: 2, detail: "2 cameras are flagged with non-healthy status." }],
  topCameras: [{ name: "North Ridge", value: 40, detail: "40 grouped events." }],
  atRiskCameras: [{ name: "South Ridge", value: 71.2, detail: "avg voltage 11.20v", status: "warning" }],
  advancedHighlights: [{ name: "South Ridge forecast gap", value: -44.1, detail: "Actual 4 vs expected 7.2." }],
  notableShifts: [{ name: "North Ridge • wildlife", value: 8.4, detail: "Recent share 60% vs baseline 51%." }],
  anomalies: [{ name: "South Ridge forecast delta", value: -44.1, detail: "Actual 4 vs expected 7.2." }],
  trends: [{ label: "Wildlife activity", direction: "up", deltaPct: 12.3, note: "Recent wildlife grouped-event volume versus baseline." }],
  dataQualityCaveats: ["Voltage coverage is 62.5%, so power recommendations may understate blind spots."],
  narrativeContext: ["1 stale cameras detected: At least one camera has not reported recently."]
};

const makeRow = (overrides: Partial<StoredReportRow> = {}): StoredReportRow => ({
  id: "report-1",
  normalizedFilterKey: "filters-1",
  snapshotHash: "hash-1",
  promptVersion: "v1",
  model: "anthropic/claude-sonnet-4.6",
  filters,
  jobStatus: "ready",
  phase: "ready",
  generatedAt: "2025-01-31T12:00:00.000Z",
  updatedAt: "2025-01-31T12:00:00.000Z",
  startedAt: "2025-01-31T11:59:00.000Z",
  completedAt: "2025-01-31T12:00:00.000Z",
  error: null,
  report: validReport,
  snapshot,
  debug: { lastErrorCode: null, lastErrorMessage: null, timingMs: { total: 1000 } },
  ...overrides
});

test("buildReportSnapshot selects compact operator-focused signals", () => {
  const assembled = buildReportSnapshot(
    filters,
    {
      kpis: {
        totalEvents: 120,
        activeCameras: 8,
        wildlifeSharePct: 72,
        humanSharePct: 11,
        aiProcessedPct: 93,
        jsonProcessedPct: 95,
        uploadSuccessPct: 97,
        avgUploadLagSeconds: 620,
        avgProcessingLagSeconds: 840,
        camerasWithAlerts: 2,
        avgVoltage: 11.8,
        lowLightSharePct: 41
      },
      cameraHealth: [
        {
          cameraName: "North Ridge",
          lastSeen: "2025-01-31T06:00:00",
          lastSeenHoursAgo: 4,
          totalEvents: 40,
          aiProcessedPct: 95,
          jsonProcessedPct: 97,
          uploadSuccessPct: 99,
          avgUploadLagSeconds: 400,
          avgAiLagSeconds: 200,
          avgProcessingLagSeconds: 620,
          avgVoltage: 12.1,
          healthScore: 94,
          anomalyScore: 8,
          status: "healthy",
          alertReason: null
        },
        {
          cameraName: "South Ridge",
          lastSeen: "2025-01-28T06:00:00",
          lastSeenHoursAgo: 76,
          totalEvents: 18,
          aiProcessedPct: 70,
          jsonProcessedPct: 79,
          uploadSuccessPct: 74,
          avgUploadLagSeconds: 1800,
          avgAiLagSeconds: 1200,
          avgProcessingLagSeconds: 3600,
          avgVoltage: 11.2,
          healthScore: 62,
          anomalyScore: 71.2,
          status: "warning",
          alertReason: "Not reporting recently."
        }
      ],
      processingFunnel: [
        { stage: "captured", count: 120 },
        { stage: "uploaded", count: 110 },
        { stage: "json_processed", count: 106 },
        { stage: "ai_processed", count: 99 }
      ],
      lagTrend: [
        { date: "2025-01-01", avgUploadLagSeconds: 400, avgAiLagSeconds: 250, avgProcessingLagSeconds: 650 },
        { date: "2025-01-02", avgUploadLagSeconds: 420, avgAiLagSeconds: 260, avgProcessingLagSeconds: 880 }
      ],
      staleCameras: [{ cameraName: "South Ridge", lastSeen: "2025-01-28T06:00:00", lastSeenHoursAgo: 76, status: "warning", anomalyScore: 71.2 }],
      categoryDistribution: [
        { category: "wildlife", count: 90 },
        { category: "human", count: 30 }
      ],
      categoryTrend: [
        { date: "2025-01-01", wildlife: 20, human: 5, vehicle: 1, emptyScene: 2, unknown: 0 },
        { date: "2025-01-02", wildlife: 25, human: 3, vehicle: 0, emptyScene: 1, unknown: 0 }
      ],
      topCameras: [
        { cameraName: "North Ridge", count: 40 },
        { cameraName: "South Ridge", count: 18 }
      ],
      hourlyActivity: [],
      burstDistribution: [],
      notableEvents: [{ anomalyScore: 35 } as never, { anomalyScore: 75 } as never],
      voltageTrend: [
        { date: "2025-01-01", cameraName: "North Ridge", avgVoltage: 12.1 },
        { date: "2025-01-02", cameraName: "South Ridge", avgVoltage: 11.2 }
      ],
      lightSplit: [],
      temperatureTrend: [
        { date: "2025-01-01", avgTemperature: 38, avgHeatLevel: 21 },
        { date: "2025-01-02", avgTemperature: 41, avgHeatLevel: 23 }
      ],
      insights: [{ title: "1 stale camera detected", detail: "At least one camera has not reported recently.", tone: "warning" }]
    },
    {
      hourCategoryHeatmap: [],
      cameraCategoryHeatmap: [],
      dailySeasonality: [],
      burstBehavior: [],
      diversityByCamera: [],
      humanWildlifeRatioByCamera: [],
      environmentalContext: [],
      cameraAnomalies: [],
      anomalyTimeline: [],
      forecast: [],
      cameraForecast: [],
      cameraForecastLeaders: [{ cameraName: "South Ridge", date: "2025-01-02", actual: 4, expected: 7.2, delta: -3.2, residualPct: -44.1 }],
      novelEvents: [{ cameraName: "North Ridge", category: "wildlife", hour: 22, currentCount: 6, baselineDailyAvg: 2, comboCount: 9, categoryHourCount: 12, shiftPct: 8.4, noveltyScore: 82, narrative: "North Ridge is showing unusual wildlife activity." }],
      noveltyTimelineDaily: [],
      categoryShiftMatrix: [{ cameraName: "North Ridge", category: "wildlife", recentSharePct: 60, baselineSharePct: 51.6, shiftPct: 8.4, lift: 1.16, recentCount: 30, baselineCount: 22 }],
      advancedInsights: [{ title: "South Ridge is quieter than expected", detail: "Actual activity is 44.1% below expected.", tone: "info" }],
      cameraClusters: [],
      dataQuality: {
        missingAnalysisRatePct: 12,
        parseSuccessPct: 88,
        fieldCompleteness: [
          { field: "analysis", completenessPct: 90 },
          { field: "voltage", completenessPct: 62.5 },
          { field: "temperature", completenessPct: 71 }
        ],
        suspiciousValueCounts: [{ label: "Suspicious numeric values", count: 3 }],
        pipelineConsistency: [{ label: "AI processed without summary", count: 1 }]
      }
    }
  );

  assert.equal(assembled.topCameras.length, 2);
  assert.equal(assembled.atRiskCameras[0]?.name, "South Ridge");
  assert.ok(assembled.overviewHighlights.length > 0);
  assert.deepEqual(assembled.overviewHighlights.slice(1, 3), [
    { name: "wildlife mix", value: 90, detail: "90 grouped events, 75% share in this slice." },
    { name: "human mix", value: 30, detail: "30 grouped events, 25% share in this slice." }
  ]);
  assert.ok(assembled.opsHighlights.length > 0);
  assert.ok(assembled.advancedHighlights.length > 0);
  assert.ok(assembled.dataQualityCaveats.some((item) => item.includes("Voltage coverage")));
  assert.ok(assembled.narrativeContext.some((item) => item.includes("stale camera")));
  assert.ok(JSON.stringify(assembled).length < 12_000);
  assert.ok(!JSON.stringify(assembled).includes("image_blob_url"));
});

test("hashReportSnapshot is stable for equivalent snapshots", () => {
  const hashA = hashReportSnapshot(snapshot, "v1", "anthropic/claude-sonnet-4.6");
  const hashB = hashReportSnapshot(
    {
      ...snapshot,
      filters: {
        ...snapshot.filters,
        camera_name: [...snapshot.filters.camera_name].reverse()
      }
    },
    "v1",
    "anthropic/claude-sonnet-4.6"
  );

  assert.equal(hashA, hashB);
});

test("selectLatestReportView prefers latest ready report", () => {
  const latest = makeRow();
  const view = selectLatestReportView({ latestByFilter: latest, staleReady: null });
  assert.equal(view.status, "ready");
  assert.equal(view.latest?.phase, "ready");
});

test("selectLatestReportView returns stale content while a newer job refreshes", () => {
  const generating = makeRow({ id: "refreshing", jobStatus: "generating", phase: "calling_model", report: null });
  const staleReady = makeRow({ id: "stale-ready" });
  const view = selectLatestReportView({ latestByFilter: generating, staleReady });
  assert.equal(view.status, "stale");
  assert.equal(view.stale?.id, "stale-ready");
  assert.equal(view.latest?.isRefreshing, true);
  assert.equal(view.phase, "calling_model");
});

test("report client repairs malformed JSON once", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;
  const originalMaxTokens = appConfig.reportMaxTokens;
  let calls = 0;
  const requestBodies: CapturedOpenRouterRequest[] = [];

  appConfig.openRouterApiKey = "test-key";
  appConfig.reportMaxTokens = 1234;
  globalThis.fetch = async (_url, init) => {
    calls += 1;

    const body =
      calls === 1
        ? { choices: [{ message: { content: "{\"headline\":\"Broken\"" } }] }
        : { choices: [{ message: { content: JSON.stringify(validReport) } }] };

    if (requestBodies.length === 0) {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as CapturedOpenRouterRequest);
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const client = createOpenRouterReportClient();
    const result = await client.generateReport(snapshot);
    assert.equal(result.report.headline, validReport.headline);
    assert.ok(result.timingMs.modelRequest >= 0);
    assert.equal(result.timingMs.snapshotBytes, Buffer.byteLength(JSON.stringify(snapshot), "utf8"));
    const firstRequestBody = requestBodies[0];
    assert.ok(firstRequestBody);
    assert.equal(result.timingMs.promptChars, firstRequestBody.messages?.[1]?.content?.length);
    assert.equal(firstRequestBody.max_tokens, 1234);
    assert.equal(firstRequestBody.response_format?.type, "json_schema");
    assert.equal(firstRequestBody.response_format?.json_schema?.name, "operational_report");
    assert.equal(firstRequestBody.response_format?.json_schema?.strict, true);
    assert.ok(firstRequestBody.response_format?.json_schema?.schema?.required?.includes("key_findings"));
    assert.ok(firstRequestBody.plugins?.some((plugin) => plugin.id === "response-healing"));
    assert.ok(!firstRequestBody.messages?.[1]?.content?.includes("\n  \"filterKey\""));
    assert.equal(calls, 2);
  } finally {
    appConfig.openRouterApiKey = originalKey;
    appConfig.reportMaxTokens = originalMaxTokens;
    globalThis.fetch = originalFetch;
  }
});

test("report client identifies truncated model JSON", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;
  const originalMaxTokens = appConfig.reportMaxTokens;

  assert.ok(appConfig.reportMaxTokens >= 3500);
  appConfig.openRouterApiKey = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "length",
            native_finish_reason: "max_tokens",
            message: { content: "{\"headline\":\"Truncated\",\"executive_summary\":[\"one\"" }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  try {
    const client = createOpenRouterReportClient();
    await assert.rejects(
      () => client.generateReport(snapshot, { requestId: "truncated-test", deadlineAtMs: Date.now() + 5_000 }),
      (error) =>
        error instanceof ReportServiceError &&
        error.code === "REPORT_INVALID_MODEL_OUTPUT" &&
        error.message.includes("truncated before valid JSON completed")
    );
  } finally {
    appConfig.openRouterApiKey = originalKey;
    appConfig.reportMaxTokens = originalMaxTokens;
    globalThis.fetch = originalFetch;
  }
});

test("report client times out within the model deadline", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;
  const originalTimeout = appConfig.reportModelTimeoutMs;

  appConfig.openRouterApiKey = "test-key";
  appConfig.reportModelTimeoutMs = 10;
  globalThis.fetch = async (_url, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });

  try {
    const client = createOpenRouterReportClient();
    await assert.rejects(
      () => client.generateReport(snapshot, { requestId: "timeout-test", deadlineAtMs: Date.now() + 5_000 }),
      (error) =>
        error instanceof ReportServiceError &&
        error.code === "REPORT_MODEL_TIMEOUT" &&
        error.message.includes("timed out after")
    );
  } finally {
    appConfig.openRouterApiKey = originalKey;
    appConfig.reportModelTimeoutMs = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("report client skips repair when the server deadline is too close", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;
  const originalRepairMinRemaining = appConfig.reportRepairMinRemainingMs;
  let calls = 0;

  appConfig.openRouterApiKey = "test-key";
  appConfig.reportRepairMinRemainingMs = 8_000;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"headline\":\"Broken\"" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const client = createOpenRouterReportClient();
    await assert.rejects(
      () => client.generateReport(snapshot, { requestId: "repair-skip-test", deadlineAtMs: Date.now() + 2_000 }),
      (error) =>
        error instanceof ReportServiceError &&
        error.code === "REPORT_INVALID_MODEL_OUTPUT" &&
        error.message.includes("not enough time left")
    );
    assert.equal(calls, 1);
  } finally {
    appConfig.openRouterApiKey = originalKey;
    appConfig.reportRepairMinRemainingMs = originalRepairMinRemaining;
    globalThis.fetch = originalFetch;
  }
});

test("manual generation returns an ephemeral report when persistent storage is unavailable", async () => {
  const originalKey = appConfig.openRouterApiKey;
  const originalFetch = globalThis.fetch;
  const originalReportsState = globalThis.__grizcamReportsStoreState;

  appConfig.openRouterApiKey = "test-key";
  globalThis.__grizcamReportsStoreState = {
    configured: false,
    connectionSource: "unconfigured",
    connected: false,
    databaseStatus: "disabled",
    readOnly: null,
    schemaReady: false,
    failureReason: "Reports storage is unavailable in this test."
  };
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validReport) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

  try {
    const result = await triggerReportGeneration(filters, snapshot, true, "ephemeral-test");
    assert.equal(result.status, "ready");
    assert.equal(result.report?.sourceMode, "ephemeral");
    assert.equal(result.requestId, "ephemeral-test");
  } finally {
    appConfig.openRouterApiKey = originalKey;
    globalThis.__grizcamReportsStoreState = originalReportsState;
    globalThis.fetch = originalFetch;
  }
});
