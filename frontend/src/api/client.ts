import type {
  AgentInfo,
  ComparisonResult,
  MetricsSummary,
  NodeDetailResponse,
  Packet,
  RouteDecision,
  ScenarioSummary,
  SimulationRun,
  TopologyData,
  TopologyEvent,
} from "../types";

const BASE_URL = "";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    let errMessage = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const errData = await res.json();
      if (errData && errData.detail) {
        errMessage = typeof errData.detail === "string" ? errData.detail : JSON.stringify(errData.detail);
      }
    } catch {
      // response was not JSON; keep the status message
    }
    throw new Error(errMessage);
  }
  return (await res.json()) as T;
}

export interface StepResult {
  run_id: string;
  simulated_time: number;
  has_ended: boolean;
  metrics: MetricsSummary;
}

export interface LifecycleResult {
  run_id: string;
  status: string;
  simulated_time?: number;
  metrics?: MetricsSummary;
}

export const ApiClient = {
  async getHealth(): Promise<{ status: string; app: string; version: string }> {
    return fetchJson<{ status: string; app: string; version: string }>("/health");
  },

  async listScenarios(): Promise<{ scenarios: ScenarioSummary[] }> {
    return fetchJson<{ scenarios: ScenarioSummary[] }>("/api/scenarios");
  },

  async getScenario(scenarioId: string): Promise<Record<string, unknown>> {
    return fetchJson<Record<string, unknown>>(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
  },

  async createRun(
    scenarioId: string,
    seed: number = 42,
    routingPolicy: string = "swarmnet",
    duration?: number,
  ): Promise<SimulationRun> {
    return fetchJson<SimulationRun>("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        scenario_id: scenarioId,
        seed,
        routing_policy: routingPolicy,
        duration,
      }),
    });
  },

  async getRun(runId: string): Promise<SimulationRun> {
    return fetchJson<SimulationRun>(`/api/runs/${encodeURIComponent(runId)}`);
  },

  async stepRun(runId: string, ticks: number = 1): Promise<StepResult> {
    return fetchJson<StepResult>(`/api/runs/${encodeURIComponent(runId)}/step`, {
      method: "POST",
      body: JSON.stringify({ ticks }),
    });
  },

  async pauseRun(runId: string): Promise<LifecycleResult> {
    return fetchJson<LifecycleResult>(`/api/runs/${encodeURIComponent(runId)}/pause`, { method: "POST" });
  },

  async resumeRun(runId: string): Promise<LifecycleResult> {
    return fetchJson<LifecycleResult>(`/api/runs/${encodeURIComponent(runId)}/resume`, { method: "POST" });
  },

  async resetRun(runId: string): Promise<LifecycleResult> {
    return fetchJson<LifecycleResult>(`/api/runs/${encodeURIComponent(runId)}/reset`, { method: "POST" });
  },

  async getTopology(runId: string): Promise<TopologyData> {
    return fetchJson<TopologyData>(`/api/runs/${encodeURIComponent(runId)}/topology`);
  },

  async getMetrics(runId: string): Promise<MetricsSummary> {
    return fetchJson<MetricsSummary>(`/api/runs/${encodeURIComponent(runId)}/metrics`);
  },

  async getEvents(
    runId: string,
    limit: number = 50,
  ): Promise<{ events: TopologyEvent[] }> {
    return fetchJson<{ events: TopologyEvent[] }>(
      `/api/runs/${encodeURIComponent(runId)}/events?limit=${limit}`,
    );
  },

  async getPackets(runId: string): Promise<{ run_id: string; simulated_time: number; packets: Packet[] }> {
    return fetchJson<{ run_id: string; simulated_time: number; packets: Packet[] }>(
      `/api/runs/${encodeURIComponent(runId)}/packets`,
    );
  },

  async getDecisions(runId: string, limit: number = 50): Promise<{ decisions: RouteDecision[] }> {
    return fetchJson<{ decisions: RouteDecision[] }>(
      `/api/runs/${encodeURIComponent(runId)}/decisions?limit=${limit}`,
    );
  },

  async getNode(runId: string, nodeId: string): Promise<NodeDetailResponse> {
    return fetchJson<NodeDetailResponse>(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}`,
    );
  },

  async comparePolicies(scenarioId: string, seed: number = 42): Promise<ComparisonResult> {
    return fetchJson<ComparisonResult>("/api/experiments/compare", {
      method: "POST",
      body: JSON.stringify({ scenario_id: scenarioId, seed }),
    });
  },

  getExportUrl(runId: string, format: "json" | "csv" = "json"): string {
    return `${BASE_URL}/api/runs/${encodeURIComponent(runId)}/export?format=${format}`;
  },

  async getAgents(): Promise<{ agents: AgentInfo[] }> {
    return fetchJson<{ agents: AgentInfo[] }>("/api/agents");
  },

  /** WebSocket endpoint for live run telemetry, proxied by Vite in development and nginx in containers. */
  streamUrl(runId: string): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws/runs/${encodeURIComponent(runId)}`;
  },
};