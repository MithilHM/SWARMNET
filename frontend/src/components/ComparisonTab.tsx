import React, { useState } from "react";
import type { ComparisonResult, ScenarioSummary, SimulationRun } from "../types";
import { ApiClient } from "../api/client";

interface ComparisonTabProps {
  currentRun: SimulationRun | null;
  scenarios: ScenarioSummary[];
  selectedScenarioId: string;
  seed: number;
}

export const ComparisonTab: React.FC<ComparisonTabProps> = ({
  currentRun,
  scenarios,
  selectedScenarioId,
  seed,
}) => {
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scenarioName = scenarios.find((s) => s.id === selectedScenarioId)?.name || selectedScenarioId;

  const handleRunComparison = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await ApiClient.comparePolicies(selectedScenarioId, seed);
      setComparison(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to execute comparative benchmark.");
    } finally {
      setIsLoading(false);
    }
  };

  const currentRunId = currentRun?.run_id;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }} id="comparison-tab-view">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Comparative Routing Evaluation & Export</h2>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Execute controlled benchmarks on <strong>{scenarioName}</strong> (Seed: {seed}): SWARMNET (Contact-Aware) vs. Baseline (Shortest-Path).
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {currentRunId && (
            <>
              <a
                href={ApiClient.getExportUrl(currentRunId, "json")}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline"
                style={{ fontSize: "0.8rem", textDecoration: "none" }}
              >
                Export Run (JSON)
              </a>
              <a
                href={ApiClient.getExportUrl(currentRunId, "csv")}
                target="_blank"
                rel="noreferrer"
                className="btn btn-outline"
                style={{ fontSize: "0.8rem", textDecoration: "none" }}
              >
                Export Run (CSV)
              </a>
            </>
          )}

          <button
            id="btn-run-benchmark"
            className="btn btn-primary"
            onClick={handleRunComparison}
            disabled={isLoading}
          >
            {isLoading ? "Running Simulation..." : "Execute Head-to-Head Benchmark"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", padding: "12px", borderRadius: "var(--radius-md)", color: "#f87171", fontSize: "0.85rem" }}>
          Benchmark Error: {error}
        </div>
      )}

      {comparison ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Comparative KPI Deltas */}
          <div className="kpi-grid">
            {/* Delivery Ratio Delta */}
            <div className="glass-card kpi-card">
              <div className="kpi-label">Delivery Ratio Delta</div>
              <div
                className="kpi-value"
                style={{
                  color:
                    comparison.comparison_summary.delivery_ratio_diff >= 0
                      ? "var(--color-success)"
                      : "var(--color-danger)",
                }}
              >
                {comparison.comparison_summary.delivery_ratio_diff >= 0 ? "+" : ""}
                {(comparison.comparison_summary.delivery_ratio_diff * 100).toFixed(1)}%
              </div>
              <div className="kpi-detail">
                SWARMNET vs. Baseline
              </div>
            </div>

            {/* Delivered Count Delta */}
            <div className="glass-card kpi-card kpi-card-success">
              <div className="kpi-label">Packets Delivered Delta</div>
              <div
                className="kpi-value"
                style={{
                  color:
                    comparison.comparison_summary.delivered_count_diff >= 0
                      ? "var(--color-success)"
                      : "var(--color-danger)",
                }}
              >
                {comparison.comparison_summary.delivered_count_diff >= 0 ? "+" : ""}
                {comparison.comparison_summary.delivered_count_diff} pkts
              </div>
              <div className="kpi-detail">
                Net gain in successfully delivered packets
              </div>
            </div>

            {/* Delay Delta */}
            <div className="glass-card kpi-card kpi-card-purple">
              <div className="kpi-label">Mean Latency Delta</div>
              <div
                className="kpi-value"
                style={{
                  color:
                    comparison.comparison_summary.mean_delay_diff <= 0
                      ? "var(--color-success)"
                      : "var(--color-warning)",
                }}
              >
                {comparison.comparison_summary.mean_delay_diff >= 0 ? "+" : ""}
                {comparison.comparison_summary.mean_delay_diff.toFixed(2)}s
              </div>
              <div className="kpi-detail">
                Transit delay difference for delivered data
              </div>
            </div>

            {/* Dropped Delta */}
            <div className="glass-card kpi-card kpi-card-danger">
              <div className="kpi-label">Dropped Packets Delta</div>
              <div
                className="kpi-value"
                style={{
                  color:
                    comparison.comparison_summary.dropped_diff <= 0
                      ? "var(--color-success)"
                      : "var(--color-danger)",
                }}
              >
                {comparison.comparison_summary.dropped_diff >= 0 ? "+" : ""}
                {comparison.comparison_summary.dropped_diff} pkts
              </div>
              <div className="kpi-detail">
                Fewer packet drops under SWARMNET
              </div>
            </div>
          </div>

          {/* Side-by-Side Detailed Metrics Table */}
          <div className="glass-card" style={{ padding: "20px" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px" }}>
              Side-by-Side Performance Comparison (Scenario: {comparison.scenario_id}, Seed: {comparison.seed})
            </h3>
            <div className="data-table-container">
              <table className="data-table" id="comparison-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ color: "var(--text-muted)" }}>Baseline (Shortest-Path)</th>
                    <th style={{ color: "var(--accent-cyan)" }}>SWARMNET (Contact-Aware)</th>
                    <th>Observed Delta</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Packets Generated</td>
                    <td className="font-mono">{comparison.baseline.metrics.packets_generated}</td>
                    <td className="font-mono">{comparison.swarmnet.metrics.packets_generated}</td>
                    <td className="font-mono">Equal (0)</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Packets Delivered</td>
                    <td className="font-mono">{comparison.baseline.metrics.packets_delivered}</td>
                    <td className="font-mono" style={{ color: "var(--color-success)", fontWeight: 600 }}>
                      {comparison.swarmnet.metrics.packets_delivered}
                    </td>
                    <td className="font-mono" style={{ color: "var(--color-success)" }}>
                      +{comparison.comparison_summary.delivered_count_diff}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Delivery Ratio</td>
                    <td className="font-mono">{(comparison.baseline.metrics.delivery_ratio * 100).toFixed(1)}%</td>
                    <td className="font-mono" style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                      {(comparison.swarmnet.metrics.delivery_ratio * 100).toFixed(1)}%
                    </td>
                    <td className="font-mono" style={{ color: "var(--accent-cyan)" }}>
                      {(comparison.comparison_summary.delivery_ratio_diff * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Packets Dropped</td>
                    <td className="font-mono">{comparison.baseline.metrics.packets_dropped}</td>
                    <td className="font-mono">{comparison.swarmnet.metrics.packets_dropped}</td>
                    <td className="font-mono">{comparison.comparison_summary.dropped_diff}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Packets Expired</td>
                    <td className="font-mono">{comparison.baseline.metrics.packets_expired}</td>
                    <td className="font-mono">{comparison.swarmnet.metrics.packets_expired}</td>
                    <td className="font-mono">
                      {comparison.swarmnet.metrics.packets_expired - comparison.baseline.metrics.packets_expired}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Mean End-to-End Delay</td>
                    <td className="font-mono">{comparison.baseline.metrics.mean_delay_seconds.toFixed(2)}s</td>
                    <td className="font-mono">{comparison.swarmnet.metrics.mean_delay_seconds.toFixed(2)}s</td>
                    <td className="font-mono">{comparison.comparison_summary.mean_delay_diff.toFixed(2)}s</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Median Delay</td>
                    <td className="font-mono">{comparison.baseline.metrics.median_delay_seconds.toFixed(2)}s</td>
                    <td className="font-mono">{comparison.swarmnet.metrics.median_delay_seconds.toFixed(2)}s</td>
                    <td className="font-mono">
                      {(comparison.swarmnet.metrics.median_delay_seconds - comparison.baseline.metrics.median_delay_seconds).toFixed(2)}s
                    </td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Mean Hop Count</td>
                    <td className="font-mono">{comparison.baseline.metrics.mean_hop_count.toFixed(1)}</td>
                    <td className="font-mono">{comparison.swarmnet.metrics.mean_hop_count.toFixed(1)}</td>
                    <td className="font-mono">
                      {(comparison.swarmnet.metrics.mean_hop_count - comparison.baseline.metrics.mean_hop_count).toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Delivered Data Volume</td>
                    <td className="font-mono">
                      {(comparison.baseline.metrics.total_bytes_delivered / 1024).toFixed(1)} KB
                    </td>
                    <td className="font-mono" style={{ color: "var(--accent-cyan)" }}>
                      {(comparison.swarmnet.metrics.total_bytes_delivered / 1024).toFixed(1)} KB
                    </td>
                    <td className="font-mono">
                      {((comparison.swarmnet.metrics.total_bytes_delivered - comparison.baseline.metrics.total_bytes_delivered) / 1024).toFixed(1)} KB
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="glass-card"
          style={{
            padding: "40px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            No comparison data loaded for scenario <strong>{selectedScenarioId}</strong>.
          </div>
          <button className="btn btn-primary" onClick={handleRunComparison} disabled={isLoading}>
            {isLoading ? "Running Simulation..." : "Click to Run Comparative Benchmark"}
          </button>
        </div>
      )}
    </div>
  );
};
