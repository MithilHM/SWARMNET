export type NodeStatus = "active" | "disabled";

export interface NodePosition {
  x: number;
  y: number;
  z?: number;
  orbit_plane?: number;
  orbit_index?: number;
}

export interface SatelliteNode {
  satellite_id: string;
  position?: NodePosition;
  energy_percent: number;
  buffer_capacity_bytes: number;
  buffer_used_bytes: number;
  status: NodeStatus;
  neighbors: string[];
  routing_table?: Record<string, unknown>;
  last_state_update: number;
}

export interface GroundStationNode {
  ground_station_id: string;
  position?: NodePosition;
  status: NodeStatus;
  received_packet_ids: string[];
  total_bytes_received: number;
  last_contact_time?: number | null;
}

export interface Link {
  link_id: string;
  source_node_id: string;
  target_node_id: string;
  is_available: boolean;
  latency_ms: number;
  bandwidth_mbps: number;
  reliability: number;
  contact_end_time?: number | null;
  last_updated_at: number;
  failure_reason?: string | null;
}

export type PacketPriority = "low" | "normal" | "high";

export type PacketStatus =
  | "created"
  | "buffered"
  | "in_transit"
  | "delivered"
  | "dropped"
  | "expired";

export interface RouteHop {
  node_id: string;
  arrived_at: number;
  departed_at?: number | null;
  link_id?: string | null;
}

export interface Packet {
  packet_id: string;
  source_node_id: string;
  destination_node_id: string;
  created_at: number;
  expires_at?: number | null;
  payload_size_bytes: number;
  priority: PacketPriority;
  current_node_id: string;
  hop_count: number;
  max_hops: number;
  visited_node_ids: string[];
  status: PacketStatus;
  drop_reason?: string | null;
  delivery_time?: number | null;
  route_history: RouteHop[];
}

export interface RouteDecision {
  decision_id: string;
  packet_id: string;
  satellite_id: string;
  chosen_next_hop_id?: string | null;
  decision: "forward" | "buffer" | "drop";
  reason_code: string;
  candidate_scores: Record<string, number>;
  decision_time: number;
  routing_policy: string;
}

export interface MetricsSummary {
  packets_generated: number;
  packets_delivered: number;
  packets_dropped: number;
  packets_expired: number;
  delivery_ratio: number;
  mean_delay_seconds: number;
  median_delay_seconds: number;
  p95_delay_seconds: number;
  mean_hop_count: number;
  total_bytes_delivered: number;
  buffer_occupancy_by_node: Record<string, number>;
  dropped_by_reason: Record<string, number>;
  delivered_delay_records?: number[];
}

export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export interface SimulationRun {
  run_id: string;
  scenario_id: string;
  seed: number;
  routing_policy: string;
  started_at: number;
  simulated_duration: number;
  current_sim_time: number;
  status: RunStatus;
  config_snapshot?: Record<string, unknown>;
  metrics_summary: MetricsSummary;
}

export interface TopologyData {
  run_id: string;
  simulated_time: number;
  satellites: SatelliteNode[];
  ground_stations: GroundStationNode[];
  links: Link[];
  in_transit: unknown[];
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  duration_seconds: number;
  satellites_count: number;
  ground_stations_count: number;
  links_count: number;
}

export interface ComparisonResult {
  experiment_id: string;
  scenario_id: string;
  seed: number;
  baseline: {
    policy: string;
    metrics: MetricsSummary;
  };
  swarmnet: {
    policy: string;
    metrics: MetricsSummary;
  };
  comparison_summary: {
    delivery_ratio_diff: number;
    delivered_count_diff: number;
    mean_delay_diff: number;
    dropped_diff: number;
  };
}

export interface AgentInfo {
  node_id: string;
  node_type: string;
  url: string;
  status: string;
  heartbeat_count: number;
  uptime?: number;
  buffer_used_bytes?: number;
}

export interface NodeDetailResponse {
  run_id: string;
  node_id: string;
  node_type: "satellite" | "ground_station";
  status: string;
  position?: NodePosition;
  energy_percent?: number;
  buffer_capacity_bytes?: number;
  buffer_used_bytes?: number;
  buffer_packet_count?: number;
  buffered_packets?: Packet[];
  neighbors?: string[];
  incident_links: Link[];
  recent_decisions?: RouteDecision[];
  total_bytes_received?: number;
  received_packet_count?: number;
  received_packets?: Packet[];
  last_contact_time?: number | null;
  last_state_update?: number;
}
