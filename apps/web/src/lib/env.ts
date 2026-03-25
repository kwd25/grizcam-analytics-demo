export const appEnv = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "",
  exportsEnabled:
    import.meta.env.VITE_DEMO_EXPORTS_ENABLED === "true" || import.meta.env.VITE_ENABLE_EVENT_EXPORTS === "true",
  demoLabel: import.meta.env.VITE_DEMO_LABEL ?? "Synthetic data demo",
  appTitle: import.meta.env.VITE_APP_TITLE ?? "GrizCam Demo"
};
