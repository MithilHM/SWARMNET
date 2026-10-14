import React from "react";
import type { RunStatus, ScenarioSummary, SimulationRun } from "../types";

interface HeaderProps {
  currentRun: SimulationRun | null;
  scenarios: ScenarioSummary[];
  selectedScenarioId: string;
  onSelectScenario: (id: string) => void;
  selectedPolicy: string;
  onSelectPolicy: (policy: string) => void;
  seed: number;
  onSeedChange: (seed: number) => void;
  onCreateRun: () => void;
  onStep: (ticks: number) => void;
  onTogglePlay: () => void;
  isPlaying: boolean;
  onReset: () => void;
  backendConnected: boolean;
  simSpeed: number;
  onSimSpeedChange: (speed: number) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRun,
  scenarios,
  selectedScenarioId,
  onSelectScenario,
  selectedPolicy,
  onSelectPolicy,
  seed,
  onSeedChange,
  onCreateRun,
  onStep,
  onTogglePlay,
  isPlaying,
  onReset,
  backendConnected,
  simSpeed,
  onSimSpeedChange,
}) => {
  const status: RunStatus = currentRun ? currentRun.status : "queued";
  const simTime = currentRun ? currentRun.current_sim_time : 0;
  const maxDuration = currentRun ? currentRun.simulated_duration : 60;

  return (
    <header className="app-header" id="app-header">
      <div className="header-brand">
        <div className="header-logo" title="SWARMNET Constellation Network">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
            <path d="m4.93 4.93 2.12 2.12m9.9 9.9 2.12 2.12M4.93 19.07l2.12-2.12m9.9-9.9 2.12-2.12" />
          </svg>
        </div>
        <div className="header-title-wrap">
          <h1>
            SWARMNET
            <span className="badge badge-sim" id="simulation-badge" title="Discrete-event simulation environment">
              Simulation
            </span>
          </h1>
          <div className="header-subtitle">Delay-Tolerant Satellite Constellation Routing</div>
        </div>
      </div>

      <div className="header-controls">
        {/* Scenario Config */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label htmlFor="scenario-select" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Scenario:
          </label>
          <select
            id="scenario-select"
            className="select-input"
            value={selectedScenarioId}
            onChange={(e) => onSelectScenario(e.target.value)}
          >
            {scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name || sc.id}
              </option>
            ))}
          </select>
        </div>

        {/* Policy Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label htmlFor="policy-select" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Policy:
          </label>
          <select
            id="policy-select"
            className="select-input"
            value={selectedPolicy}
            onChange={(e) => onSelectPolicy(e.target.value)}
          >
            <option value="swarmnet">SWARMNET (Contact-Aware)</option>
            <option value="baseline">Baseline (Shortest Path)</option>
          </select>
        </div>

        {/* Seed */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label htmlFor="seed-input" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Seed:
          </label>
          <input
            id="seed-input"
            type="number"
            className="text-input"
            style={{ width: "65px" }}
            value={seed}
            onChange={(e) => onSeedChange(parseInt(e.target.value) || 0)}
          />
        </div>

        {/* Init/Start Run */}
        <button id="btn-create-run" className="btn btn-outline" onClick={onCreateRun}>
          Initialize Run
        </button>

        {/* Clock & Status Readout */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(0,0,0,0.3)",
            padding: "4px 10px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span className={`badge badge-status-${status}`}>
            <span className="badge-dot" />
            {status}
          </span>
          <span className="font-mono" style={{ fontSize: "0.85rem", color: "var(--accent-cyan)" }}>
            T+{simTime.toFixed(0)}s / {maxDuration}s
          </span>
        </div>

        {/* Sim Step / Play Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            id="btn-play-pause"
            className={`btn ${isPlaying ? "btn-danger" : "btn-primary"}`}
            onClick={onTogglePlay}
            disabled={!currentRun || status === "completed"}
            title={isPlaying ? "Pause simulation" : "Play simulation"}
          >
            {isPlaying ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                Pause
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                Run
              </>
            )}
          </button>

          <button
            id="btn-step-1"
            className="btn btn-outline"
            onClick={() => onStep(1)}
            disabled={!currentRun || isPlaying || status === "completed"}
            title="Step 1 second forward"
          >
            +1s
          </button>

          <button
            id="btn-step-5"
            className="btn btn-outline"
            onClick={() => onStep(5)}
            disabled={!currentRun || isPlaying || status === "completed"}
            title="Step 5 seconds forward"
          >
            +5s
          </button>

          <button
            id="btn-reset"
            className="btn btn-outline"
            onClick={onReset}
            disabled={!currentRun}
            title="Reset simulation to initial state"
          >
            Reset
          </button>
        </div>

        {/* Speed Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <label htmlFor="speed-select" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Speed:
          </label>
          <select
            id="speed-select"
            className="select-input"
            value={simSpeed}
            onChange={(e) => onSimSpeedChange(parseFloat(e.target.value))}
            style={{ width: "65px", padding: "4px 8px" }}
          >
            <option value="0.5">0.5x</option>
            <option value="1">1.0x</option>
            <option value="2">2.0x</option>
            <option value="4">4.0x</option>
          </select>
        </div>

        {/* Backend Connectivity Status */}
        <div
          title={backendConnected ? "Backend API Online" : "Backend Disconnected"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "0.75rem",
            color: backendConnected ? "var(--color-success)" : "var(--color-danger)",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: backendConnected ? "var(--color-success)" : "var(--color-danger)",
              boxShadow: backendConnected ? "0 0 6px var(--color-success)" : "none",
            }}
          />
          {backendConnected ? "Connected" : "Offline"}
        </div>
      </div>
    </header>
  );
};
