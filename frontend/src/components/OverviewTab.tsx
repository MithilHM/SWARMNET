import React from "react";
import type { MetricsSummary, SimulationRun, TopologyData, AgentInfo } from "../types";

interface OverviewTabProps {
  currentRun: SimulationRun | null;
  topology: TopologyData | null;
  metrics: MetricsSummary | null;
  events: Array<Record<string, unknown>>;
  agents: AgentInfo[];
  onNavigateToTopology: () => void;
  onNavigateToComparison: () => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  currentRun,
  topology,
  metrics,
  events,
  agents,
  onNavigateToTopology,
  onNavigateToComparison,
}) => {
  const deliveryRatio = metrics ? (metrics.delivery_ratio * 100).toFixed(1) : "0.0";
  const delivered = metrics ? metrics.packets_delivered : 0;
  const generated = metrics ? metrics.packets_generated : 0;
  const dropped = metrics ? metrics.packets_dropped : 0;
  const expired = metrics ? metrics.packets_expired : 0;
  const meanDelay = metrics ? metrics.mean_delay_seconds.toFixed(2) : "0.00";
  const bytesDelivered = metrics ? (metrics.total_bytes_delivered / 1024).toFixed(1) : "0.0";

  const activeLinks = topology ? topology.links.filter((l) => l.is_available).length : 0;
  const totalLinks = topology ? topology.links.length : 0;
  const satCount = topology ? topology.satellites.length : 0;
  const gsCount = topology ? topology.ground_stations.length : 0;
  const inTransitCount = topology ? topology.in_transit.length : 0;

  // Calculate total buffered packets across nodes
  const totalBuffered = metrics
    ? Object.values(metrics.buffer_occupancy_by_node || {}).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }} id="overview-tab-view">
      {/* KPI Cards Grid */}
      <div className="kpi-grid">
        {/* Delivery Ratio */}
        <div className="glass-card kpi-card">
          <div className="kpi-label">Delivery Ratio</div>
          <div className="kpi-value" style={{ color: "var(--accent-cyan)" }}>
            {deliveryRatio}%
          </div>
          <div className="progress-bar-bg" style={{ marginTop: "4px" }}>
            <div
              className="progress-bar-fill"
              style={{
                width: `${deliveryRatio}%`,
                background: "linear-gradient(90deg, #0ea5e9, #00f0ff)",
              }}
            />
          </div>
          <div className="kpi-detail">
            {delivered} of {generated} packets delivered
          </div>
        </div>

        {/* Packets Delivered */}
        <div className="glass-card kpi-card kpi-card-success">
          <div className="kpi-label">Delivered Data</div>
          <div className="kpi-value" style={{ color: "var(--color-success)" }}>
            {delivered} <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>pkts</span>
          </div>
          <div className="kpi-detail">
            {bytesDelivered} KB total throughput
          </div>
        </div>

        {/* End to End Latency */}
        <div className="glass-card kpi-card kpi-card-purple">
          <div className="kpi-label">Mean End-to-End Delay</div>
          <div className="kpi-value" style={{ color: "var(--accent-purple)" }}>
            {meanDelay} <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>s</span>
          </div>
          <div className="kpi-detail">
            Delivered packet travel time
          </div>
        </div>

        {/* Buffering & In-Transit */}
        <div className="glass-card kpi-card kpi-card-warning">
          <div className="kpi-label">Buffered / In-Flight</div>
          <div className="kpi-value" style={{ color: "var(--color-warning)" }}>
            {totalBuffered > 0 ? (totalBuffered / 1024).toFixed(0) : "0"}{" "}
            <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>KB / {inTransitCount} flt</span>
          </div>
          <div className="kpi-detail">
            Delay-tolerant buffer occupancy
          </div>
        </div>

        {/* Drops & Expiry */}
        <div className="glass-card kpi-card kpi-card-danger">
          <div className="kpi-label">Loss / Expirations</div>
          <div className="kpi-value" style={{ color: dropped + expired > 0 ? "var(--color-danger)" : "var(--text-muted)" }}>
            {dropped + expired}
          </div>
          <div className="kpi-detail">
            {dropped} dropped · {expired} expired
          </div>
        </div>

        {/* Active Topology State */}
        <div className="glass-card kpi-card">
          <div className="kpi-label">Topology Links</div>
          <div className="kpi-value" style={{ color: "var(--accent-blue)" }}>
            {activeLinks} / {totalLinks}
          </div>
          <div className="kpi-detail">
            {satCount} Satellites · {gsCount} Ground
          </div>
        </div>
      </div>

      {/* Main Overview Panels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: "24px" }}>
        {/* Constellation Status & Quick Actions */}
        <div className="glass-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>Active Scenario Configuration</h2>
            <button className="btn btn-outline" style={{ fontSize: "0.75rem", padding: "4px 8px" }} onClick={onNavigateToTopology}>
              View Topology Graph →
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "0.85rem" }}>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "var(--radius-md)" }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Scenario ID</div>
              <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{currentRun?.scenario_id || "N/A"}</div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "var(--radius-md)" }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Routing Policy</div>
              <div style={{ fontWeight: 600, color: "var(--accent-cyan)" }}>
                {currentRun?.routing_policy === "swarmnet" ? "SWARMNET Contact-Aware" : "Baseline Shortest-Path"}
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "var(--radius-md)" }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Simulated Clock</div>
              <div className="font-mono">{currentRun?.current_sim_time.toFixed(1)}s elapsed</div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "var(--radius-md)" }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Stochastic Seed</div>
              <div className="font-mono">{currentRun?.seed ?? 42} (Deterministic)</div>
            </div>
          </div>

          {/* Quick link to compare */}
          <div
            style={{
              marginTop: "8px",
              padding: "12px",
              background: "rgba(14, 165, 233, 0.08)",
              border: "1px solid rgba(14, 165, 233, 0.2)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--accent-blue)" }}>
                Comparative Policy Benchmark
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Evaluate SWARMNET vs Baseline under identical traffic and link schedules.
              </div>
            </div>
            <button className="btn btn-primary" style={{ fontSize: "0.8rem", padding: "6px 12px" }} onClick={onNavigateToComparison}>
              Run Benchmark
            </button>
          </div>

          {/* Container Agents Status */}
          {agents && agents.length > 0 && (
            <div style={{ marginTop: "12px" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "8px" }}>
                Registered Isolated Agents ({agents.length})
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {agents.map((ag) => (
                  <span
                    key={ag.node_id}
                    className="badge"
                    style={{
                      background: "rgba(16, 185, 129, 0.1)",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      color: "var(--color-success)",
                      fontSize: "0.7rem",
                    }}
                  >
                    <span className="badge-dot" />
                    {ag.node_id} ({ag.node_type})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Live Simulation Event Stream */}
        <div className="glass-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>Simulation Event Stream</h2>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {events.length} events logged
            </span>
          </div>

          <div
            style={{
              maxHeight: "320px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {events.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontStyle: "italic", padding: "16px 0" }}>
                No events recorded yet. Click &quot;Run&quot; or &quot;+1s&quot; to advance simulation.
              </div>
            ) : (
              events.slice(-15).reverse().map((evt, idx) => {
                const eventType = String(evt.event_type || evt.type || "event");
                const time = typeof evt.scheduled_time === "number" ? evt.scheduled_time.toFixed(1) : "0.0";
                const isDown = eventType.includes("down") || eventType.includes("drop");
                const isUp = eventType.includes("up") || eventType.includes("deliver");

                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "rgba(0,0,0,0.25)",
                      borderRadius: "var(--radius-sm)",
                      borderLeft: `3px solid ${
                        isDown ? "var(--color-danger)" : isUp ? "var(--color-success)" : "var(--accent-blue)"
                      }`,
                      fontSize: "0.8rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="font-mono" style={{ color: "var(--accent-cyan)", fontSize: "0.75rem" }}>
                        T+{time}s
                      </span>
                      <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                        {eventType.toUpperCase()}
                      </span>
                      {Boolean(evt.target_id) && (
                        <span style={{ color: "var(--text-muted)" }}>({String(evt.target_id)})</span>
                      )}
                    </div>
                    {Boolean(evt.description) && (
                      <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {String(evt.description)}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
