import type { RunRef, Snapshot } from "../types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && body.detail) message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      // not JSON; keep the status line
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Control actions. Their effects arrive through the event stream, not the responses. */
export const ApiClient = {
  snapshot: () => request<Snapshot>("/api/session"),
  play: (seed?: number) =>
    request<RunRef>("/api/session/play", { method: "POST", body: JSON.stringify(seed != null ? { seed } : {}) }),
  solve: () => request<Record<string, unknown>>("/api/session/solve", { method: "POST" }),
  sever: (satelliteId: string) =>
    request<Record<string, unknown>>("/api/session/sever", {
      method: "POST",
      body: JSON.stringify({ satellite_id: satelliteId }),
    }),
  reset: () => request<RunRef>("/api/session/reset", { method: "POST" }),
  streamUrl: "/api/session/stream",
  exportUrl: "/api/session/export",
};
