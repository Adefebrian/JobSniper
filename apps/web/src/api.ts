import type { ApiEnvelope, ConnectionName, Connections, DashboardData, JobAction, JobTarget, Outreach, OutboxAction, Profile, Source, TargetsQuery } from "./types.ts";

const API_BASE = "/api";

class ApiError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  let payload: ApiEnvelope<T>;
  try {
    payload = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new ApiError("INVALID_RESPONSE", `The API returned an invalid response for ${path}.`);
  }
  if (!payload.ok) throw new ApiError(payload.error.code, payload.error.message, payload.error.details);
  return payload.data;
}

export const getDashboard = () => request<DashboardData>("/dashboard");
export const getTargets = (query: TargetsQuery = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  });
  return request<JobTarget[]>(`/targets?${params.toString()}`);
};
export const getTarget = (id: string) => request<JobTarget>(`/targets/${encodeURIComponent(id)}`);
export const actOnTarget = (id: string, action: JobAction) => request<JobTarget>(`/targets/${encodeURIComponent(id)}/actions`, {
  method: "POST",
  body: JSON.stringify({ action }),
});
export const getOutreach = (tab?: string) => request<Outreach[]>(`/outreach${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`);
export const updateOutreach = (id: string, action: OutboxAction) => request<Outreach>(`/outreach/${encodeURIComponent(id)}/actions`, {
  method: "POST",
  body: JSON.stringify(action),
});
export const addCompanyDomain = (domain: string) => request<{ id: string; domain: string }>("/companies", {
  method: "POST",
  body: JSON.stringify({ domain }),
});
export const actOnCompany = (id: string, action: "force_crawl" | "pause" | "resume") => request<{ id: string }>(`/companies/${encodeURIComponent(id)}/actions`, {
  method: "POST",
  body: JSON.stringify({ action }),
});
export const actOnSource = (id: string, action: "approve" | "reject" | "pause" | "resume") => request<Source>(`/sources/${encodeURIComponent(id)}/actions`, {
  method: "POST",
  body: JSON.stringify({ action }),
});
export const addSource = (input: { name: string; url: string; method: string }) => request<Source>("/sources", {
  method: "POST",
  body: JSON.stringify(input),
});
export const getSettings = () => request<Profile>("/settings");
export const saveSettings = (settings: Profile) => request<Profile>("/settings", {
  method: "PUT",
  body: JSON.stringify(settings),
});
export const getConnections = () => request<Connections>("/connections");
export const saveConnection = (name: ConnectionName, value: string) => request<{ name: string; set: boolean }>(`/connections/${encodeURIComponent(name)}`, {
  method: "PUT",
  body: JSON.stringify({ value }),
});
export const GMAIL_CONNECT_URL = `${API_BASE}/gmail/connect`;
export const disconnectGmail = () => request<{ connected: boolean }>("/gmail/disconnect", { method: "POST" });
export const importProfileFile = (path: string) => request<unknown>("/profile/import-file", {
  method: "POST",
  body: JSON.stringify({ path }),
});
export const exportData = async (kind: "targets" | "outreach", format: "csv" | "xlsx") => {
  const response = await fetch(`${API_BASE}/export?kind=${kind}&format=${format}`, { credentials: "same-origin" });
  if (!response.ok) {
    let message = `Export failed with ${response.status}.`;
    try {
      const payload = await response.json() as ApiEnvelope<unknown>;
      if (!payload.ok) message = payload.error.message;
    } catch {}
    throw new ApiError("EXPORT_FAILED", message);
  }
  return response.blob();
};

export { ApiError };
