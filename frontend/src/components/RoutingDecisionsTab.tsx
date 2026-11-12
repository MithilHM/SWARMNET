import React, { useState, useMemo } from "react";
import type { RouteDecision } from "../types";

interface RoutingDecisionsTabProps {
  decisions: RouteDecision[];
}

export const RoutingDecisionsTab: React.FC<RoutingDecisionsTabProps> = ({ decisions }) => {
  const [selectedDecision, setSelectedDecision] = useState<RouteDecision | null>(null);
  const [filterAction, setFilterAction] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Action counts for filter tabs
  const counts = useMemo(() => {
    let fwd = 0;
    let buf = 0;
    let drop = 0;
    decisions.forEach((d) => {
      if (d.decision === "forward") fwd++;
      else if (d.decision === "buffer") buf++;
      else if (d.decision === "drop") drop++;
    });
    return { all: decisions.length, forward: fwd, buffer: buf, drop };
  }, [decisions]);

  // Filter and sort decisions
  const sortedDecisions = useMemo(() => {
    // 1. Filter by action
    let result = decisions.filter((d) => {
      if (filterAction === "all") return true;
      return d.decision === filterAction;
    });

    // 2. Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (d) =>
          d.satellite_id.toLowerCase().includes(q) ||
          d.packet_id.toLowerCase().includes(q) ||
          (d.chosen_next_hop_id && d.chosen_next_hop_id.toLowerCase().includes(q)) ||
          d.reason_code.toLowerCase().includes(q) ||
          d.routing_policy.toLowerCase().includes(q)
      );
    }

    // 3. Smart Sort:
    // Primary: decision_time DESCENDING (latest decisions at the very top)
    // Secondary: FORWARD > DROP > BUFFER for identical timestamps (highlight active transmissions)
    // Tertiary: ID or natural order
    const actionPriority: Record<string, number> = { forward: 3, drop: 2, buffer: 1 };

    return [...result].sort((a, b) => {
      const timeDiff = b.decision_time - a.decision_time;
      if (Math.abs(timeDiff) > 0.001) {
        return timeDiff;
      }
      const prioA = actionPriority[a.decision] || 0;
      const prioB = actionPriority[b.decision] || 0;
      if (prioB !== prioA) {
        return prioB - prioA;
      }
      return (b.decision_id || "").localeCompare(a.decision_id || "");
    });
  }, [decisions, filterAction, searchQuery]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }} id="routing-decisions-view">
      {/* Header and Filter Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Autonomous Routing Decisions & Scoring Engine</h2>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Inspect decentralized routing decisions made by satellite agents. Latest forwarding events appear at the top.
          </div>
        </div>

        {/* Action Filters & Search */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Quick Search */}
          <input
            type="text"
            className="input-field"
            placeholder="Search satellite, packet ID, reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "240px", fontSize: "0.8rem", padding: "6px 12px" }}
          />

          {/* Action Filter Pills */}
          <div className="filter-pills">
            <button
              className={`filter-pill ${filterAction === "all" ? "active" : ""}`}
              onClick={() => setFilterAction("all")}
            >
              ALL ({counts.all})
            </button>
            <button
              className={`filter-pill ${filterAction === "forward" ? "active" : ""}`}
              onClick={() => setFilterAction("forward")}
              style={{ color: filterAction === "forward" ? "#10b981" : undefined }}
            >
              ⚡ FORWARD ({counts.forward})
            </button>
            <button
              className={`filter-pill ${filterAction === "buffer" ? "active" : ""}`}
              onClick={() => setFilterAction("buffer")}
              style={{ color: filterAction === "buffer" ? "#f59e0b" : undefined }}
            >
              ⏸ BUFFER ({counts.buffer})
            </button>
            <button
              className={`filter-pill ${filterAction === "drop" ? "active" : ""}`}
              onClick={() => setFilterAction("drop")}
              style={{ color: filterAction === "drop" ? "#ef4444" : undefined }}
            >
              ❌ DROP ({counts.drop})
            </button>
          </div>
        </div>
      </div>

      {/* Decisions Table */}
      <div className="glass-card" style={{ padding: "16px" }}>
        <div className="data-table-container">
          <table className="data-table" id="decisions-table">
            <thead>
              <tr>
                <th style={{ width: "95px" }}>Time</th>
                <th style={{ width: "110px" }}>Satellite</th>
                <th>Packet ID</th>
                <th style={{ width: "110px" }}>Action</th>
                <th>Chosen Next Hop</th>
                <th>Reason Code</th>
                <th>Policy</th>
                <th style={{ width: "140px" }}>Candidate Scores</th>
              </tr>
            </thead>
            <tbody>
              {sortedDecisions.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                    {decisions.length === 0
                      ? "No decisions recorded yet. Start or step the simulation to observe decisions."
                      : "No routing decisions matched your filter criteria."}
                  </td>
                </tr>
              ) : (
                sortedDecisions.slice(0, 60).map((dec) => {
                  const isForward = dec.decision === "forward";
                  const isBuffer = dec.decision === "buffer";
                  const isDrop = dec.decision === "drop";

                  let badgeBg = "rgba(16, 185, 129, 0.15)";
                  let badgeColor = "#34d399";
                  let badgeBorder = "rgba(16, 185, 129, 0.35)";
                  let actionIcon = "⚡";

                  if (isBuffer) {
                    badgeBg = "rgba(245, 158, 11, 0.15)";
                    badgeColor = "#fbbf24";
                    badgeBorder = "rgba(245, 158, 11, 0.35)";
                    actionIcon = "⏸";
                  } else if (isDrop) {
                    badgeBg = "rgba(239, 68, 68, 0.15)";
                    badgeColor = "#f87171";
                    badgeBorder = "rgba(239, 68, 68, 0.35)";
                    actionIcon = "❌";
                  }

                  const candidateCount = Object.keys(dec.candidate_scores || {}).length;

                  return (
                    <tr
                      key={dec.decision_id}
                      style={{
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                        background: isForward ? "rgba(16, 185, 129, 0.03)" : undefined,
                      }}
                      onClick={() => setSelectedDecision(dec)}
                    >
                      <td className="font-mono" style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                        T+{dec.decision_time.toFixed(1)}s
                      </td>
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                        <span style={{ color: "var(--color-sat)", marginRight: "4px" }}>🛰️</span>
                        {dec.satellite_id}
                      </td>
                      <td className="font-mono" style={{ color: "var(--text-primary)", fontSize: "0.8rem" }}>
                        {dec.packet_id}
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "3px 8px",
                            borderRadius: "12px",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            letterSpacing: "0.03em",
                            background: badgeBg,
                            color: badgeColor,
                            border: `1px solid ${badgeBorder}`,
                          }}
                        >
                          <span>{actionIcon}</span>
                          <span>{dec.decision.toUpperCase()}</span>
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {dec.chosen_next_hop_id ? (
                          <span style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <span>➔</span>
                            <span>{dec.chosen_next_hop_id}</span>
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.82rem", fontStyle: "italic" }}>
                            Stored in Queue
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.75rem",
                            background: "rgba(0,0,0,0.35)",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-sm)",
                            color: isForward ? "var(--accent-cyan)" : isBuffer ? "#fbbf24" : "#f87171",
                            border: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          {dec.reason_code}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{dec.routing_policy}</td>
                      <td>
                        <button
                          className="btn btn-outline"
                          style={{ fontSize: "0.72rem", padding: "3px 8px" }}
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
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent-cyan)" }}>
                  Decision Detail: {selectedDecision.decision_id}
                </h3>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Autonomous routing decision made by {selectedDecision.satellite_id} at T+{selectedDecision.decision_time.toFixed(1)}s
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

            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.85rem" }}>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Action Chosen</div>
                  <div style={{ fontWeight: 700, color: selectedDecision.decision === "forward" ? "#34d399" : "#fbbf24" }}>
                    {selectedDecision.decision.toUpperCase()}
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Chosen Next Hop</div>
                  <div style={{ fontWeight: 700, color: selectedDecision.chosen_next_hop_id ? "#34d399" : "var(--text-muted)" }}>
                    {selectedDecision.chosen_next_hop_id || "None (Stored in Local Buffer)"}
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Reason Code</div>
                  <div className="font-mono" style={{ color: "var(--accent-blue)", fontWeight: 600 }}>
                    {selectedDecision.reason_code}
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Packet ID</div>
                  <div className="font-mono" style={{ fontSize: "0.75rem", color: "var(--accent-cyan)" }}>
                    {selectedDecision.packet_id}
                  </div>
                </div>
              </div>

              {/* Explanation text */}
              {selectedDecision.explanation && (
                <div
                  style={{
                    background: "rgba(56, 189, 248, 0.08)",
                    border: "1px solid rgba(56, 189, 248, 0.2)",
                    borderRadius: "var(--radius-sm)",
                    padding: "10px 12px",
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.45,
                  }}
                >
                  <strong style={{ color: "var(--accent-cyan)", display: "block", marginBottom: "4px" }}>
                    Engine Scoring Rationale:
                  </strong>
                  {selectedDecision.explanation}
                </div>
              )}

              {/* Candidate Scores Evaluation */}
              <div>
                <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "8px" }}>
                  Candidate Neighbor Scores:
                </h4>
                {selectedDecision.candidate_scores && Object.keys(selectedDecision.candidate_scores).length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {Object.entries(selectedDecision.candidate_scores).map(([cand, scoreObj]) => {
                      const isChosen = cand === selectedDecision.chosen_next_hop_id;
                      const isNumber = typeof scoreObj === "number";
                      const totalScore = isNumber ? scoreObj : (scoreObj as any).composite_score ?? 0;

                      return (
                        <div
                          key={cand}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            padding: "10px 12px",
                            background: isChosen ? "rgba(16, 185, 129, 0.12)" : "rgba(0,0,0,0.25)",
                            border: `1px solid ${isChosen ? "rgba(16, 185, 129, 0.45)" : "var(--border-subtle)"}`,
                            borderRadius: "var(--radius-sm)",
                            fontSize: "0.85rem",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontWeight: 700, color: isChosen ? "#34d399" : "var(--text-primary)" }}>
                                {cand}
                              </span>
                              {isChosen && (
                                <span className="badge badge-status-running" style={{ fontSize: "0.65rem", padding: "1px 6px" }}>
                                  ✓ WINNING CANDIDATE
                                </span>
                              )}
                            </div>
                            <div className="font-mono" style={{ fontWeight: 700, color: isChosen ? "#34d399" : "var(--text-secondary)" }}>
                              Score: {totalScore.toFixed(4)}
                            </div>
                          </div>

                          {/* Detailed multi-criteria breakdown if available */}
                          {!isNumber && (
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(4, 1fr)",
                                gap: "6px",
                                marginTop: "4px",
                                fontSize: "0.72rem",
                                color: "var(--text-muted)",
                                background: "rgba(0,0,0,0.2)",
                                padding: "6px 8px",
                                borderRadius: "4px",
                              }}
                            >
                              <div>
                                Progress: <span style={{ color: "var(--text-primary)" }}>{(scoreObj as any).progress_score?.toFixed(2) ?? "—"}</span>
                              </div>
                              <div>
                                Reliability: <span style={{ color: "var(--text-primary)" }}>{(scoreObj as any).reliability_score?.toFixed(2) ?? "—"}</span>
                              </div>
                              <div>
                                Contact: <span style={{ color: "var(--text-primary)" }}>{(scoreObj as any).contact_score?.toFixed(2) ?? "—"}</span>
                              </div>
                              <div>
                                Latency: <span style={{ color: "var(--text-primary)" }}>{(scoreObj as any).latency_score?.toFixed(2) ?? "—"}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.8rem", padding: "8px 0" }}>
                    No viable candidate links available during evaluation. Packet retained safely in satellite store-and-forward buffer.
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
