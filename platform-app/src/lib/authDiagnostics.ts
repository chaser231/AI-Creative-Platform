type AuthDiagnosticDetails = Record<string, unknown>;

export type AuthDiagnosticEvent =
  | "session_status_changed"
  | "session_refresh_started"
  | "session_refresh_finished"
  | "session_refresh_failed"
  | "session_refresh_timeout"
  | "unauthenticated_redirect"
  | "unauthorized_response"
  | "auth_redirect_probe_started"
  | "auth_redirect_probe_result"
  | "auth_session_recovered"
  | "auth_session_unavailable"
  | "logout_started"
  | "trpc_context_resolved"
  | "trpc_unauthorized";

const STORAGE_KEY = "acp_auth_diagnostics";
const TAB_ID_KEY = "acp_auth_tab_id";
const MAX_EVENTS = 200;

function getTabId() {
  if (typeof window === "undefined") return "server";

  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  return tabId;
}

export function isAuthDiagnosticsEnabled() {
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.NEXT_PUBLIC_AUTH_DEBUG === "true") return true;
  if (process.env.AUTH_DEBUG === "true") return true;

  if (typeof window === "undefined") return false;
  return localStorage.getItem("acp_auth_debug") === "1";
}

function safeDetails(details: AuthDiagnosticDetails) {
  const redacted: AuthDiagnosticDetails = {};

  for (const [key, value] of Object.entries(details)) {
    if (/token|cookie|secret|password/i.test(key)) {
      redacted[key] = "[redacted]";
    } else if (value instanceof Error) {
      redacted[key] = value.message;
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

function persistClientEvent(payload: AuthDiagnosticDetails) {
  if (typeof window === "undefined") return;

  try {
    const current = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as AuthDiagnosticDetails[];
    current.push(payload);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current.slice(-MAX_EVENTS)));
  } catch {
    // Diagnostics must never break auth flow.
  }
}

export function logAuthDiagnostic(event: AuthDiagnosticEvent, details: AuthDiagnosticDetails = {}) {
  if (!isAuthDiagnosticsEnabled()) return;

  const payload = {
    event,
    ts: new Date().toISOString(),
    tabId: getTabId(),
    ...safeDetails(details),
  };

  persistClientEvent(payload);
  // eslint-disable-next-line no-console
  console.info("[auth]", event, payload);
}
