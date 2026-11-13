/** Wire types for the single shared simulation session (backend: app/simulation/session.py). */

export type Phase = "IDLE" | "STABLE" | "DEGRADING" | "DETECTED" | "SOLVING" | "RESOLVED";
export type PhaseTag = "idle" | "stable" | "degrading" | "detected" | "dtn";
export type PacketLogStatus = "sent" | "lost" | "stored" | "forwarded" | "delivered";
export type Protocol = "direct" | "dtn";
export type LinkState = "active" | "degraded" | "down";

export interface SimEvent {
  seq: number;
  run_id: string | null;
  /** Simulated seconds since Play. */
  t: number;
  type:
    | "run_started"
    | "phase_change"
    | "packet"
    | "link_degraded"
    | "link_severed"
    | "link_recovered"
    | "anomaly_detected"
    | "protocol_switch"
    | "route_change"
    | "run_resolved";
  phase: Phase;
  tag: PhaseTag;
  status: PacketLogStatus | null;
  packet_id: string | null;
  size_bytes: number | null;
  source: string | null;
  target: string | null;
  hop_path: string[] | null;
  link_id: string | null;
  node_id: string | null;
  message: string;
  details: Record<string, unknown>;
}

export interface SessionNode {
  id: string;
  kind: "satellite" | "ground";
  lat: number;
  lon: number;
  alt_km: number;
  role: "affected" | "relay" | null;
  ground_station_id?: string;
  protocol?: Protocol;
  buffer_used_bytes?: number;
  buffer_capacity_bytes?: number;
  stored_count?: number;
  received_count?: number;
  bytes_received?: number;
}

export interface SessionLink {
  link_id: string;
  kind: "ground" | "isl";
  source_node_id: string;
  target_node_id: string;
  is_available: boolean;
  latency_ms: number;
  bandwidth_mbps: number;
  reliability: number;
  failure_reason: string | null;
  state: LinkState;
  loss_rate: number | null;
  role: "anomaly" | "dtn" | null;
}

export interface InFlightPacket {
  packet_id: string;
  link_id: string;
  source: string;
  target: string;
  depart: number;
  arrive: number;
  mode: "direct" | "dtn";
}

export interface Anomaly {
  satellite_id: string;
  link_id: string;
  ground_station_id: string;
  loss_rate: number;
  window_losses: number;
  window_size: number;
  threshold: number;
  probable_cause: string;
  detected_at: number;
}

export interface CandidateScore {
  neighbor_id: string;
  total_score: number;
  reliability_score: number;
  latency_penalty: number;
  route_path: string[] | null;
  estimated_path_latency_ms: number | null;
  estimated_path_hops: number | null;
  path_reliability: number | null;
  reason: string | null;
}

export interface RouteDecision {
  decision_id: string;
  satellite_id: string;
  chosen_next_hop_id: string | null;
  decision: "forward" | "buffer" | "drop";
  reason_code: string;
  candidate_scores: Record<string, CandidateScore>;
  decision_time: number;
  routing_policy: string;
  explanation: string | null;
}

export interface DtnState {
  satellite_id: string;
  relay_id: string | null;
  path: string[] | null;
  link_ids: string[];
  decision: RouteDecision;
  switched_at?: number;
}

export interface RoutingRow {
  satellite_id: string;
  protocol: Protocol;
  next_hop: string | null;
  path: string[];
  reason_code: string;
  note: string;
  ground_link_id: string;
  ground_link_state: LinkState;
  ground_link_reliability: number;
  ground_link_loss_rate: number | null;
  relay_for: string[];
  stored_count: number;
}

export interface AffectedStats {
  satellite_id: string;
  total: number;
  delivered: number;
  lost: number;
  unrecovered: number;
  recovered: number;
  delivery_ratio: number;
  mean_latency_ms: number | null;
  max_latency_ms: number | null;
  mean_hops: number | null;
  via_relay: number;
}

export interface Comparison {
  satellite_id: string;
  relay_id: string | null;
  final: boolean;
  direct_only: AffectedStats | null;
  with_dtn: AffectedStats;
  method: string;
}

export interface NetworkMetrics {
  packets_generated: number;
  packets_delivered: number;
  packets_lost_direct: number;
  packets_unrecovered: number;
  packets_stored: number;
  packets_in_transit: number;
  delivery_ratio: number;
  mean_delay_ms: number;
  p95_delay_ms: number;
  mean_hop_count: number;
  total_bytes_delivered: number;
}

export interface Controls {
  play: boolean;
  solve: boolean;
  sever: boolean;
  reset: boolean;
}

export interface DynamicState {
  run_id: string | null;
  seed: number;
  scenario_id: string;
  phase: Phase;
  version: number;
  sim_time: number;
  time_scale: number;
  halted: boolean;
  controls: Controls;
  nodes: SessionNode[];
  links: SessionLink[];
  in_flight: InFlightPacket[];
  anomaly: Anomaly | null;
  dtn: DtnState | null;
  failure: { satellite_id: string; link_id: string; cause: string | null; severed: boolean };
  routing: { before: RoutingRow[] | null; current: RoutingRow[] | null; decisions: RouteDecision[] };
  comparison: Comparison | null;
  metrics: NetworkMetrics;
}

export interface ScenarioInfo {
  scenario_id: string;
  seed: number;
  time_scale: number;
  tick_seconds: number;
  stable_duration_s: number;
  detection: { window_size: number; loss_threshold: number; min_samples: number };
  post_solve_bundles: number;
}

export interface Snapshot extends DynamicState {
  scenario: ScenarioInfo;
  events: SimEvent[];
}

export type StreamMessage =
  | { type: "snapshot"; reason: string; state: Snapshot }
  | { type: "frame"; state: DynamicState; events: SimEvent[] }
  | { type: "error"; message: string };

export interface RunRef {
  run_id: string | null;
  seed: number;
  scenario_id: string;
  phase: Phase;
}
