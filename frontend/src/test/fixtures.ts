import type { SessionApi } from "../app/session";
import type { DynamicState, ScenarioInfo, SimEvent, Snapshot } from "../types";

export const scenarioInfo: ScenarioInfo = {
  scenario_id: "SCN-TEST0001",
  seed: 42,
  time_scale: 0.05,
  tick_seconds: 0.0025,
  stable_duration_s: 0.1,
  detection: { window_size: 8, loss_threshold: 0.5, min_samples: 5 },
  post_solve_bundles: 2,
};

let seq = 0;
export function evt(partial: Partial<SimEvent>): SimEvent {
  seq += 1;
  return {
    seq,
    run_id: "RUN-TEST",
    t: 0.01 * seq,
    type: "packet",
    phase: "STABLE",
    tag: "stable",
    status: null,
    packet_id: null,
    size_bytes: null,
    source: null,
    target: null,
    hop_path: null,
    link_id: null,
    node_id: null,
    message: "",
    details: {},
    ...partial,
  };
}

export function resolvedEvents(): SimEvent[] {
  seq = 0;
  return [
    evt({ type: "run_started", message: "Run started" }),
    evt({ status: "sent", packet_id: "PKT-SAT-02-0001", source: "SAT-02", hop_path: ["SAT-02", "GROUND-01"], message: "sent" }),
    evt({ status: "delivered", packet_id: "PKT-SAT-02-0001", source: "SAT-02", hop_path: ["SAT-02", "GROUND-01"], message: "delivered" }),
    evt({ status: "lost", tag: "degrading", phase: "DEGRADING", packet_id: "PKT-SAT-02-0002", source: "SAT-02", hop_path: ["SAT-02", "GROUND-01"], link_id: "SAT-02-GROUND-01", message: "lost" }),
    evt({ type: "anomaly_detected", tag: "detected", phase: "DETECTED", message: "Anomaly on SAT-02-GROUND-01" }),
    evt({ status: "stored", tag: "dtn", phase: "SOLVING", packet_id: "PKT-SAT-02-0002", source: "SAT-02", hop_path: ["SAT-02"], message: "stored" }),
    evt({ status: "forwarded", tag: "dtn", phase: "SOLVING", packet_id: "PKT-SAT-02-0002", source: "SAT-02", hop_path: ["SAT-02", "SAT-03"], message: "forwarded" }),
    evt({ status: "delivered", tag: "dtn", phase: "SOLVING", packet_id: "PKT-SAT-02-0002", source: "SAT-02", hop_path: ["SAT-02", "SAT-03", "GROUND-01"], message: "delivered via SAT-03" }),
    evt({ type: "run_resolved", tag: "dtn", phase: "RESOLVED", message: "2/2 bundles delivered via SAT-03" }),
  ];
}

const routingRow = (id: string, protocol: "direct" | "dtn", path: string[]) => ({
  satellite_id: id,
  protocol,
  next_hop: path[1] ?? null,
  path,
  reason_code: protocol === "dtn" ? "BEST_SCORE" : "DIRECT_DELIVERY",
  note: "",
  ground_link_id: `${id}-GROUND-01`,
  ground_link_state: "active" as const,
  ground_link_reliability: 0.99,
  ground_link_loss_rate: 0,
  relay_for: [] as string[],
  stored_count: 0,
});

export function resolvedState(): DynamicState {
  return {
    run_id: "RUN-TEST",
    seed: 42,
    scenario_id: "SCN-TEST0001",
    phase: "RESOLVED",
    version: 10,
    sim_time: 0.4,
    time_scale: 0.05,
    halted: true,
    controls: { play: false, solve: false, sever: false, reset: true },
    nodes: [
      { id: "SAT-01", kind: "satellite", lat: 0, lon: 0, alt_km: 550, role: null, protocol: "direct" },
      { id: "SAT-02", kind: "satellite", lat: 0, lon: 10, alt_km: 550, role: "affected", protocol: "dtn" },
      { id: "SAT-03", kind: "satellite", lat: 0, lon: 20, alt_km: 550, role: "relay", protocol: "direct" },
      { id: "SAT-04", kind: "satellite", lat: 0, lon: 30, alt_km: 550, role: null, protocol: "direct" },
      { id: "GROUND-01", kind: "ground", lat: 5, lon: 15, alt_km: 0, role: null },
    ],
    links: [],
    in_flight: [],
    anomaly: {
      satellite_id: "SAT-02",
      link_id: "SAT-02-GROUND-01",
      ground_station_id: "GROUND-01",
      loss_rate: 0.625,
      window_losses: 5,
      window_size: 8,
      threshold: 0.5,
      probable_cause: "Rain fade at GROUND-01",
      detected_at: 0.25,
    },
    dtn: {
      satellite_id: "SAT-02",
      relay_id: "SAT-03",
      path: ["SAT-02", "SAT-03", "GROUND-01"],
      link_ids: ["SAT-02-SAT-03", "SAT-03-GROUND-01"],
      decision: {
        decision_id: "d1",
        satellite_id: "SAT-02",
        chosen_next_hop_id: "SAT-03",
        decision: "forward",
        reason_code: "BEST_SCORE",
        candidate_scores: {
          "SAT-03": {
            neighbor_id: "SAT-03",
            total_score: 0.91,
            reliability_score: 0.98,
            latency_penalty: 0.8,
            route_path: ["SAT-02", "SAT-03", "GROUND-01"],
            estimated_path_latency_ms: 40,
            estimated_path_hops: 2,
            path_reliability: 0.98,
            reason: "",
          },
          "SAT-01": {
            neighbor_id: "SAT-01",
            total_score: 0.7,
            reliability_score: 0.97,
            latency_penalty: 1,
            route_path: ["SAT-02", "SAT-01", "GROUND-01"],
            estimated_path_latency_ms: 50,
            estimated_path_hops: 2,
            path_reliability: 0.97,
            reason: "",
          },
        },
        decision_time: 0.25,
        routing_policy: "dtn",
        explanation: "Relay SAT-03 chosen",
      },
    },
    failure: { satellite_id: "SAT-02", link_id: "SAT-02-GROUND-01", cause: "Rain fade at GROUND-01", severed: false },
    routing: {
      before: [routingRow("SAT-01", "direct", ["SAT-01", "GROUND-01"]), routingRow("SAT-02", "direct", ["SAT-02", "GROUND-01"])],
      current: [routingRow("SAT-01", "direct", ["SAT-01", "GROUND-01"]), routingRow("SAT-02", "dtn", ["SAT-02", "SAT-03", "GROUND-01"])],
      decisions: [],
    },
    comparison: {
      satellite_id: "SAT-02",
      relay_id: "SAT-03",
      final: true,
      method: "replay",
      direct_only: {
        satellite_id: "SAT-02",
        total: 2,
        delivered: 1,
        lost: 1,
        unrecovered: 1,
        recovered: 0,
        delivery_ratio: 0.5,
        mean_latency_ms: 20,
        max_latency_ms: 20,
        mean_hops: 1,
        via_relay: 0,
      },
      with_dtn: {
        satellite_id: "SAT-02",
        total: 2,
        delivered: 2,
        lost: 1,
        unrecovered: 0,
        recovered: 1,
        delivery_ratio: 1,
        mean_latency_ms: 45,
        max_latency_ms: 70,
        mean_hops: 1.5,
        via_relay: 1,
      },
    },
    metrics: {
      packets_generated: 10,
      packets_delivered: 9,
      packets_lost_direct: 1,
      packets_unrecovered: 0,
      packets_stored: 0,
      packets_in_transit: 0,
      delivery_ratio: 0.9,
      mean_delay_ms: 30,
      p95_delay_ms: 70,
      mean_hop_count: 1.1,
      total_bytes_delivered: 40960,
    },
  };
}

export function idleState(): DynamicState {
  return {
    ...resolvedState(),
    run_id: null,
    phase: "IDLE",
    controls: { play: true, solve: false, sever: false, reset: true },
    anomaly: null,
    dtn: null,
    comparison: null,
    routing: { before: null, current: null, decisions: [] },
  };
}

export function snapshotOf(state: DynamicState, events: SimEvent[]): Snapshot {
  return { ...state, scenario: scenarioInfo, events };
}

export function sessionApi(overrides: Partial<SessionApi> = {}): SessionApi {
  return {
    connection: "live",
    state: resolvedState(),
    scenario: scenarioInfo,
    events: resolvedEvents(),
    receivedAt: 0,
    pending: null,
    error: null,
    play: async () => undefined,
    solve: async () => undefined,
    sever: async () => undefined,
    reset: async () => undefined,
    dismissError: () => undefined,
    ...overrides,
  };
}
