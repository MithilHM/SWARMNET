import React from "react";

export type TabKey = "overview" | "topology" | "packets" | "decisions" | "comparison";

interface NavigationProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  packetCount: number;
  decisionCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  packetCount,
  decisionCount,
}) => {
  return (
    <nav className="nav-tabs" id="main-nav-tabs" aria-label="Main Navigation">
      <button
        id="tab-overview"
        className={`nav-tab ${activeTab === "overview" ? "active" : ""}`}
        onClick={() => onTabChange("overview")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Overview
      </button>

      <button
        id="tab-topology"
        className={`nav-tab ${activeTab === "topology" ? "active" : ""}`}
        onClick={() => onTabChange("topology")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Topology & Dynamic Links
      </button>

      <button
        id="tab-packets"
        className={`nav-tab ${activeTab === "packets" ? "active" : ""}`}
        onClick={() => onTabChange("packets")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        Packet Flow
        {packetCount > 0 && (
          <span style={{ fontSize: "0.7rem", background: "rgba(255,255,255,0.12)", padding: "1px 6px", borderRadius: "var(--radius-full)" }}>
            {packetCount}
          </span>
        )}
      </button>

      <button
        id="tab-decisions"
        className={`nav-tab ${activeTab === "decisions" ? "active" : ""}`}
        onClick={() => onTabChange("decisions")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
        Routing Decisions
        {decisionCount > 0 && (
          <span style={{ fontSize: "0.7rem", background: "rgba(255,255,255,0.12)", padding: "1px 6px", borderRadius: "var(--radius-full)" }}>
            {decisionCount}
          </span>
        )}
      </button>

      <button
        id="tab-comparison"
        className={`nav-tab ${activeTab === "comparison" ? "active" : ""}`}
        onClick={() => onTabChange("comparison")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Policy Comparison & Reports
      </button>
    </nav>
  );
};
