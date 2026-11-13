import React, { useState } from "react";
import { ArrowClockwise, LinkBreak, Play, Wrench } from "@phosphor-icons/react";
import { useSession } from "../app/session";
import { PHASES, PHASE_LABEL, phaseTone } from "../lib/status";
import { StatusLabel } from "./ui";

/** The only simulation controls: Play, Reset, Solve (on anomaly), Sever Link. */
export const ControlBar: React.FC = () => {
  const { state, pending, connection, play, reset, solve, sever } = useSession();
  const satellites = state?.nodes.filter((node) => node.kind === "satellite").map((node) => node.id) ?? [];
  const [severChoice, setSeverTarget] = useState<string>("");
  // A new scenario may not contain the previous choice; fall back to the first satellite.
  const severTarget = satellites.includes(severChoice) ? severChoice : (satellites[0] ?? "");

  const controls = state?.controls;
  const phase = state?.phase ?? "IDLE";
  const busy = pending !== null;
  const offline = connection === "offline";
  const phaseIndex = PHASES.indexOf(phase);

  return (
    <div className="topbar-run">
      <ol className="phase-track" aria-label="Simulation phase">
        {PHASES.map((item, index) => (
          <li
            key={item}
            className="phase-step"
            data-state={index < phaseIndex ? "done" : index === phaseIndex ? "current" : "todo"}
            data-tone={index === phaseIndex ? phaseTone(item) : undefined}
            aria-current={index === phaseIndex ? "step" : undefined}
          >
            {item}
          </li>
        ))}
      </ol>

      <div className="topbar-controls">
        <span className="row-tight" aria-live="polite">
          <StatusLabel tone={offline ? "critical" : phaseTone(phase)}>{offline ? "Offline" : PHASE_LABEL[phase]}</StatusLabel>
          {state ? (
            <span className="chip" title={`Scenario ${state.scenario_id}, seed ${state.seed}`}>
              {state.scenario_id} · seed {state.seed}
            </span>
          ) : null}
        </span>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void play()}
          disabled={!controls?.play || busy || offline}
          aria-label="Play: start this scenario"
        >
          <Play aria-hidden="true" weight="fill" />
          Play
        </button>

        {controls?.solve ? (
          <button type="button" className="btn btn-solve" onClick={() => void solve()} disabled={busy}>
            <Wrench aria-hidden="true" weight="fill" />
            Solve
          </button>
        ) : null}

        <div className="btn-group" role="group" aria-label="Sever a satellite ground link">
          <label className="visually-hidden" htmlFor="sever-target">
            Satellite to sever
          </label>
          <select
            id="sever-target"
            className="select select-inline"
            value={severTarget}
            onChange={(event) => setSeverTarget(event.target.value)}
            disabled={!controls?.sever || busy}
          >
            {satellites.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => severTarget && void sever(severTarget)}
            disabled={!controls?.sever || busy || !severTarget}
            title="Cut the selected satellite's ground link"
          >
            <LinkBreak aria-hidden="true" />
            Sever link
          </button>
        </div>

        <button type="button" className="btn" onClick={() => void reset()} disabled={busy || offline}>
          <ArrowClockwise aria-hidden="true" />
          Reset
        </button>
      </div>
    </div>
  );
};
