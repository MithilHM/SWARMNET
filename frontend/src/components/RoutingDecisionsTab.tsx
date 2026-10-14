import React, { useState } from "react";
import type { RouteDecision } from "../types";

interface RoutingDecisionsTabProps {
  decisions: RouteDecision[];
}

export const RoutingDecisionsTab: React.FC<RoutingDecisionsTabProps> = ({ decisions }) => {
  const [selectedDecision, setSelectedDecision] = useState<RouteDecision | null>(null);
  const [filterAction, setFilterAction] = useState<string>("all");

  const filteredDecisions = decisions.filter((d) => {
    if (filterAction === "all") return true;
    return d.decision === filterAction;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }} id="routing-decisions-view">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Autonomous Routing Decisions & Scoring Engine</h2>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Inspect local forwarding decisions made by satellite agents without central controller intervention.
          </div>
        </div>

        {/* Action Filters */}
        <div className="filter-pills">
          {(["all", "forward", "buffer", "drop"] as const).map((act) => (
            <button
              key={act}
              className={`filter-pill ${filterAction === act ? "active" : ""}`}
              onClick={() => setFilterAction(act)}
            >
              {act.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Decisions Table */}
      <div className="glass-card" style={{ padding: "16px" }}>
        <div className="data-table-container">
          <table className="data-table" id="decisions-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Satellite</th>
                <th>Packet ID</th>
                <th>Action</th>
                <th>Chosen Next Hop</th>
                <th>Reason Code</th>
                <th>Policy</th>
                <th>Candidate Scores</th>
              </tr>
            </thead>
            <tbody>
              {filteredDecisions.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                    No decisions recorded yet. Start or step the simulation to observe decisions.
                  </td>
                </tr>
              ) : (
                filteredDecisions.slice(-50).reverse().map((dec) => {
                  let badgeClass = "badge-status-completed";
                  if (dec.decision === "forward") badgeClass = "badge-status-running";
                  else if (dec.decision === "buffer") badgeClass = "badge-status-paused";
                  else if (dec.decision === "drop") badgeClass = "btn-danger";

                  const candidateCount = Object.keys(dec.candidate_scores || {}).length;

                  return (
                    <tr
                      key={dec.decision_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedDecision(dec)}
                    >
                      <td className="font-mono">T+{dec.decision_time.toFixed(1)}s</td>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{dec.satellite_id}</td>
                      <td className="font-mono" style={{ color: "var(--accent-cyan)", fontSize: "0.8rem" }}>
                        {dec.packet_id}
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`} style={{ fontSize: "0.7rem" }}>
                          {dec.decision.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: dec.chosen_next_hop_id ? "var(--color-success)" : "var(--text-muted)" }}>
                        {dec.chosen_next_hop_id || "None (Stored)"}
                      </td>
                      <td>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.75rem",
                            background: "rgba(0,0,0,0.3)",
                            padding: "2px 6px",
                            borderRadius: "var(--radius-sm)",
                            color: "var(--accent-blue)",
                          }}
                        >
                          {dec.reason_code}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{dec.routing_policy}</td>
                      <td>
                        <button
                          className="btn btn-outline"
                          style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDecision(dec);
                          }}
                        >
                          {candidateCount} candidates →
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

      {/* Decision Detail Modal */}
      {selectedDecision && (
        <div className="modal-overlay" onClick={() => setSelectedDecision(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent-cyan)" }}>
                  Decision Detail: {selectedDecision.decision_id}
                </h3>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Evaluated at node {selectedDecision.satellite_id} (T+{selectedDecision.decision_time.toFixed(1)}s)
                </div>
              </div>
              <button
                className="btn btn-outline"
                style={{ padding: "4px 10px" }}
                onClick={() => setSelectedDecision(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.85rem" }}>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Chosen Action</div>
                  <div style={{ fontWeight: 600, color: "var(--accent-cyan)" }}>
                    {selectedDecision.decision.toUpperCase()}
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Chosen Next Hop</div>
                  <div style={{ fontWeight: 600, color: "var(--color-success)" }}>
                    {selectedDecision.chosen_next_hop_id || "None (Retained in Buffer)"}
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Reason Code</div>
                  <div className="font-mono" style={{ color: "var(--accent-blue)" }}>
                    {selectedDecision.reason_code}
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Routing Policy</div>
                  <div>{selectedDecision.routing_policy}</div>
                </div>
              </div>

              {/* Candidate Scores Evaluation */}
              <div>
                <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "8px" }}>
                  Candidate Neighbor Scores:
                </h4>
                {selectedDecision.candidate_scores && Object.keys(selectedDecision.candidate_scores).length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {Object.entries(selectedDecision.candidate_scores).map(([cand, score]) => {
                      const isChosen = cand === selectedDecision.chosen_next_hop_id;
                      return (
                        <div
                          key={cand}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: isChosen ? "rgba(16, 185, 129, 0.15)" : "rgba(0,0,0,0.25)",
                            border: `1px solid ${isChosen ? "rgba(16, 185, 129, 0.4)" : "var(--border-subtle)"}`,
                            borderRadius: "var(--radius-sm)",
                            fontSize: "0.85rem",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontWeight: 600, color: isChosen ? "var(--color-success)" : "var(--text-primary)" }}>
                              {cand}
                            </span>
                            {isChosen && <span className="badge badge-status-running" style={{ fontSize: "0.65rem" }}>Selected Hop</span>}
                          </div>
                          <div className="font-mono" style={{ color: isChosen ? "var(--color-success)" : "var(--text-secondary)" }}>
                            Score: {typeof score === "number" ? score.toFixed(4) : String(score)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.8rem" }}>
                    No viable neighbor candidates reachable during evaluation. Stored in buffer.
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setSelectedDecision(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
