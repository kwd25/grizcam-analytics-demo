export type ReportErrorCode =
  | "REPORT_INPUT_INVALID"
  | "REPORT_MODEL_AUTH_FAILED"
  | "REPORT_MODEL_BAD_REQUEST"
  | "REPORT_MODEL_NOT_FOUND"
  | "REPORT_MODEL_PROVIDER_ERROR"
  | "REPORT_MODEL_RATE_LIMITED"
  | "REPORT_MODEL_TIMEOUT"
  | "REPORT_MODEL_UNAVAILABLE"
  | "REPORT_INVALID_MODEL_OUTPUT"
  | "REPORT_STORAGE_UNAVAILABLE";

export class ReportServiceError extends Error {
  code: ReportErrorCode;
  phase: "calling_model" | "validating_response" | "error";

  constructor(code: ReportErrorCode, message: string, phase: "calling_model" | "validating_response" | "error" = "error") {
    super(message);
    this.name = "ReportServiceError";
    this.code = code;
    this.phase = phase;
  }
}

export const toReportServiceError = (error: unknown) => {
  if (error instanceof ReportServiceError) {
    return error;
  }

  if (error instanceof Error) {
    return new ReportServiceError("REPORT_MODEL_UNAVAILABLE", error.message, "error");
  }

  return new ReportServiceError("REPORT_MODEL_UNAVAILABLE", "Report generation failed.", "error");
};
