import React from "react";
import {
  ArrowClockwise,
  CaretRight,
  Pause,
  Play,
  SkipForward,
  Warning,
} from "@phosphor-icons/react";
import type { SimulationSession } from "../app/useSimulationSession";
import { RUN_STATUS_LABEL, runStatusTone } from "../lib/status";
import { formatSeconds } from "../lib/format";
import { StatusLabel } from "./ui";

const SPEEDS = [0.5, 1, 2, 4];

export const RunBar: React.FC<{ session: SimulationSession }> = ({ session }) => {
  const {
    run,
    status,
    simTime,
    duration,
    progress,
    playing,
    speed,
    setSpeed,
    pending,
    backend,
    stream,
    togglePlay,
    step,
    reset,
  } = session;

  const noRun = !run;
  const finished = status === "completed";
  const busy = pending === "step" || pending === "play" || pending === "pause" || pending === "reset";
  const disabled = noRun || busy;
  const connection = noRun
    ? backend === "offline"
      ? ({ tone: "critical", label: "Offline" } as const)
      : ({ tone: "active", label: "API online" } as const)
    : backend === "online"
      ? stream === "live"
        ? ({ tone: "active", label: "Live" } as const)
        : ({ tone: "degraded", label: "Polling" } as const)
      : backend === "degraded"
        ? ({ tone: "degraded", label: "Limited" } as const)
        : ({ tone: "critical", label: "Offline" } as const);

  return (
    <div className="topbar-run">
      <div className="row-tight" aria-live="polite">
        <StatusLabel tone={runStatusTone(status)}>{RUN_STATUS_LABEL[status]}</StatusLabel>
        <span className="chip">{run ? run.routing_policy.toUpperCase() : "NO RUN"}</span>
      </div>

      <div className="clock">
        <b>
          T+{simTime.toFixed(1)}s
          <span className="muted" style={{ fontWeight: 400 }}>
            {" "}
            / {formatSeconds(duration, 0)}
          </span>
        </b>
        <div
          className="meter"
          style={{ width: 132, marginTop: 4 }}
          role="progressbar"
          aria-label="Simulation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div className="meter-fill" style={{ width: `${progress * 100}%`, background: "var(--accent)" }} />
        </div>
      </div>

      <div className="topbar-controls">
        <div className="btn-group" role="group" aria-label="Simulation stepping">
          <button
            type="button"
            className={`btn ${playing ? "" : "btn-primary"}`}
            onClick={() => void togglePlay()}
            disabled={disabled || finished}
            aria-label={playing ? "Pause simulation" : "Resume simulation"}
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {playing ? "Pause" : "Run"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void step(1)}
            disabled={disabled || finished}
            aria-label="Advance one second"
          >
            <SkipForward aria-hidden="true" />
            +1s
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void step(5)}
            disabled={disabled || finished}
            aria-label="Advance five seconds"
          >
            +5s
          </button>
        </div>

        <button type="button" className="btn" onClick={() => void reset()} disabled={noRun || busy}>
          <ArrowClockwise aria-hidden="true" />
          Reset
        </button>

        <label className="field" style={{ minWidth: 74 }}>
          <span className="field-label">Speed</span>
          <select
            className="select"
            value={speed}
            onChange={(event) => setSpeed(Number.parseFloat(event.target.value))}
            aria-label="Playback speed multiplier"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value.toFixed(1)}x
              </option>
            ))}
          </select>
        </label>

        <span className="row-tight tiny muted" title="Backend and live event stream status">
          {backend === "offline" ? (
            <Warning aria-hidden="true" />
          ) : (
            <CaretRight aria-hidden="true" style={{ opacity: backend === "online" ? 1 : 0.4 }} />
          )}
          <StatusLabel
            tone={connection.tone}
            title={noRun ? `REST ${backend}` : `REST ${backend} · stream ${stream}`}
          >
            {connection.label}
          </StatusLabel>
        </span>
      </div>
    </div>
  );
};