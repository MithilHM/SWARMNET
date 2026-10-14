import React, { useState, useMemo } from "react";
import type { Packet } from "../types";

interface PacketsTabProps {
  packets: Packet[];
}

export const PacketsTab: React.FC<PacketsTabProps> = ({ packets }) => {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPacket, setSelectedPacket] = useState<Packet | null>(null);

  const filteredPackets = useMemo(() => {
    if (statusFilter === "all") return packets;
    return packets.filter((p) => p.status === statusFilter);
  }, [packets, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: packets.length,
      delivered: 0,
      buffered: 0,
      in_transit: 0,
      dropped: 0,
      expired: 0,
    };
    packets.forEach((p) => {
      if (counts[p.status] !== undefined) {
        counts[p.status]++;
      }
    });
    return counts;
  }, [packets]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }} id="packets-tab-view">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Constellation Packet Tracking & Audit Log</h2>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Inspect delay-tolerant packet lifecycles, store-and-forward transit hops, and terminal states.
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="filter-pills">
          {(["all", "delivered", "buffered", "in_transit", "dropped", "expired"] as const).map((st) => (
            <button
              key={st}
              className={`filter-pill ${statusFilter === st ? "active" : ""}`}
              onClick={() => setStatusFilter(st)}
            >
              {st.replace("_", " ").toUpperCase()} ({statusCounts[st] || 0})
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      <div className="glass-card" style={{ padding: "16px" }}>
        <div className="data-table-container">
          <table className="data-table" id="packet-table">
            <thead>
              <tr>
                <th>Packet ID</th>
                <th>Status</th>
                <th>Source</th>
                <th>Current Node</th>
                <th>Destination</th>
                <th>Priority</th>
                <th>Payload</th>
                <th>Hops</th>
                <th>Created</th>
                <th>Delay</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPackets.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                    No packets match the current filter.
                  </td>
                </tr>
              ) : (
                filteredPackets.map((pkt) => {
                  let badgeClass = "badge-status-queued";
                  if (pkt.status === "delivered") badgeClass = "badge-status-running";
                  else if (pkt.status === "in_transit") badgeClass = "badge-status-completed";
                  else if (pkt.status === "buffered") badgeClass = "badge-status-paused";
                  else if (pkt.status === "dropped" || pkt.status === "expired") badgeClass = "btn-danger";

                  const delay =
                    pkt.delivery_time != null
                      ? `${(pkt.delivery_time - pkt.created_at).toFixed(2)}s`
                      : "—";

                  return (
                    <tr key={pkt.packet_id}>
                      <td className="font-mono" style={{ color: "var(--accent-cyan)", fontWeight: 500 }}>
                        {pkt.packet_id}
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`} style={{ fontSize: "0.7rem" }}>
                          {pkt.status.toUpperCase()}
                        </span>
                      </td>
                      <td>{pkt.source_node_id}</td>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{pkt.current_node_id}</td>
                      <td>{pkt.destination_node_id}</td>
                      <td>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color:
                              pkt.priority === "high"
                                ? "var(--color-danger)"
                                : pkt.priority === "normal"
                                ? "var(--accent-blue)"
                                : "var(--text-muted)",
                          }}
                        >
                          {pkt.priority.toUpperCase()}
                        </span>
                      </td>
                      <td className="font-mono">{pkt.payload_size_bytes} B</td>
                      <td className="font-mono">
                        {pkt.hop_count} / {pkt.max_hops}
                      </td>
                      <td className="font-mono">T+{pkt.created_at.toFixed(1)}s</td>
                      <td className="font-mono" style={{ color: pkt.delivery_time ? "var(--color-success)" : "inherit" }}>
                        {delay}
                      </td>
                      <td>
                        <button
                          className="btn btn-outline"
                          style={{ fontSize: "0.75rem", padding: "3px 8px" }}
                          onClick={() => setSelectedPacket(pkt)}
                        >
                          Audit History
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Packet Audit Modal */}
      {selectedPacket && (
        <div className="modal-overlay" onClick={() => setSelectedPacket(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent-cyan)" }}>
                  Audit History: {selectedPacket.packet_id}
                </h3>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {selectedPacket.source_node_id} ➔ {selectedPacket.destination_node_id}
                </div>
              </div>
              <button
                className="btn btn-outline"
                style={{ padding: "4px 10px" }}
                onClick={() => setSelectedPacket(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Summary Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", fontSize: "0.8rem" }}>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "8px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)" }}>Current Status</div>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{selectedPacket.status.toUpperCase()}</div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "8px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)" }}>Hop Count</div>
                  <div className="font-mono">
                    {selectedPacket.hop_count} of {selectedPacket.max_hops}
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "8px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)" }}>Payload Size</div>
                  <div className="font-mono">{selectedPacket.payload_size_bytes} Bytes</div>
                </div>
              </div>

              {/* Terminal reason if dropped */}
              {selectedPacket.drop_reason && (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    padding: "10px",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <div style={{ color: "var(--color-danger)", fontWeight: 600, fontSize: "0.8rem" }}>
                    Drop/Expiry Cause:
                  </div>
                  <div style={{ color: "var(--text-primary)", fontSize: "0.85rem" }}>
                    {selectedPacket.drop_reason}
                  </div>
                </div>
              )}

              {/* Hops Timeline */}
              <div>
                <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "8px" }}>
                  Hop-by-Hop Route Transitions ({selectedPacket.route_history?.length || 0})
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {selectedPacket.route_history && selectedPacket.route_history.length > 0 ? (
                    selectedPacket.route_history.map((hop, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          background: "rgba(0,0,0,0.25)",
                          borderLeft: "3px solid var(--accent-cyan)",
                          borderRadius: "var(--radius-sm)",
                          fontSize: "0.8rem",
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                            Hop {idx + 1}: {hop.node_id}
                          </span>
                          {hop.link_id && (
                            <span style={{ color: "var(--text-muted)", marginLeft: "8px" }}>
                              via {hop.link_id}
                            </span>
                          )}
                        </div>
                        <div className="font-mono" style={{ color: "var(--accent-blue)" }}>
                          Arrived: T+{hop.arrived_at.toFixed(1)}s
                          {hop.departed_at != null && ` | Departed: T+${hop.departed_at.toFixed(1)}s`}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.8rem" }}>
                      No hops recorded yet (packet buffered at origin).
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setSelectedPacket(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
