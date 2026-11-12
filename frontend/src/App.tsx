import React, { useCallback, useEffect, useState } from "react";
import { Planet } from "@phosphor-icons/react";
import { useSimulationSession } from "./app/useSimulationSession";
import { VIEWS, VIEW_BY_KEY } from "./app/views";
import type { ViewKey } from "./types";
import { RunBar } from "./components/RunBar";
import { Notice } from "./components/ui";
import { OverviewView } from "./features/overview/OverviewView";
import { ConstellationView } from "./features/constellation/ConstellationView";
import { PacketsView } from "./features/packets/PacketsView";
import { RoutingView } from "./features/routing/RoutingView";
import { ExperimentsView } from "./features/experiments/ExperimentsView";

const SHORTCUT_MAP = new Map<string, ViewKey>(VIEWS.map((view) => [view.shortcut, view.key]));

export const App: React.FC = () => {
  const session = useSimulationSession();
  const [view, setView] = useState<ViewKey>("overview");

  const {
    scenarios,
    selectedScenarioId,
    setSelectedScenarioId,
    selectedPolicy,
    setSelectedPolicy,
    seed,
    setSeed,
    run,
    pending,
    error,
    setError,
    initializeRun,
    togglePlay,
    step,
    closeInspector,
    playing,
  } = session;

  const activeView = VIEW_BY_KEY.get(view) ?? VIEWS[0];
  const initializing = pending === "initialize";

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const shortcut = SHORTCUT_MAP.get(event.key);
      if (shortcut) {
        event.preventDefault();
        setView(shortcut);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlay();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        void step(1);
      } else if (event.code === "Escape") {
        closeInspector();
      }
    },
    [closeInspector, step, togglePlay],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const renderView = () => {
    switch (view) {
      case "constellation":
        return <ConstellationView session={session} />;
      case "packets":
        return <PacketsView session={session} />;
      case "routing":
        return <RoutingView session={session} />;
      case "experiments":
        return <ExperimentsView session={session} />;
      case "overview":
      default:
        return <OverviewView session={session} />;
    }
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="rail">
        <div className="rail-brand" title="SWARMNET">
          <Planet size={21} weight="duotone" aria-hidden="true" />
          <span className="visually-hidden">SWARMNET</span>
        </div>

        <nav className="rail-nav" aria-label="Workspaces">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            const current = item.key === view;
            return (
              <button
                key={item.key}
                type="button"
                className="rail-link"
                aria-current={current ? "page" : undefined}
                onClick={() => setView(item.key)}
                title={`${item.title} (${item.shortcut})`}
              >
                <Icon aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="rail-foot">
          <span className="chip" title="Discrete-event simulation, not live telemetry">
            SIM
          </span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <strong>SWARMNET</strong>
            <span>Delay-tolerant constellation lab</span>
          </div>
          <RunBar session={session} />
        </header>

        <div className="content">
          <div className="content-head">
            <div>
              <h1 className="content-title">{activeView.title}</h1>
              <p className="content-sub">{activeView.subtitle}</p>
            </div>

            <div className="content-actions">
              <label className="field" style={{ minWidth: 170 }}>
                <span className="field-label">Scenario</span>
                <select
                  className="select"
                  value={selectedScenarioId}
                  onChange={(event) => setSelectedScenarioId(event.target.value)}
                >
                  {scenarios.length === 0 ? <option value="">No scenarios loaded</option> : null}
                  {scenarios.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field" style={{ minWidth: 150 }}>
                <span className="field-label">Policy</span>
                <select
                  className="select"
                  value={selectedPolicy}
                  onChange={(event) => setSelectedPolicy(event.target.value)}
                >
                  <option value="swarmnet">SWARMNET (contact-aware)</option>
                  <option value="baseline">Baseline (shortest path)</option>
                </select>
              </label>

              <label className="field" style={{ width: 88 }}>
                <span className="field-label">Seed</span>
                <input
                  className="input input-mono"
                  type="number"
                  value={seed}
                  min={0}
                  onChange={(event) => setSeed(Number.parseInt(event.target.value, 10) || 0)}
                />
              </label>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void initializeRun()}
                disabled={initializing || !selectedScenarioId}
              >
                {initializing ? "Initializing…" : run ? "Start new run" : "Initialize run"}
              </button>
            </div>
          </div>

          {error ? (
            <div style={{ marginBottom: "var(--space-4)" }}>
              <Notice tone="error" title="Simulation error">
                <span className="row">
                  <span>{error}</span>
                  <button type="button" className="btn btn-sm" onClick={() => setError(null)}>
                    Dismiss
                  </button>
                </span>
              </Notice>
            </div>
          ) : null}

          {playing ? (
            <p className="tiny muted" style={{ marginBottom: "var(--space-3)" }}>
              Playback running. Controls stay live; Space pauses, Right Arrow advances one second.
            </p>
          ) : null}

          {renderView()}
        </div>
      </div>
    </div>
  );
};

export default App;