import React, { useEffect, useRef, useState } from "react";
import { ArrowsIn, ArrowsOut, CheckCircle, CornersOut, WarningOctagon } from "@phosphor-icons/react";
import { useSession } from "../../app/session";
import type { ConstellationScene } from "./scene/ConstellationScene";
import { Notice } from "../../components/ui";
import { formatPercent, pathLabel } from "../../lib/format";

/** Landing view: the globe. Everything drawn here comes from the backend session. */
export const ConstellationView: React.FC = () => {
  const { state, scenario, events, receivedAt, connection } = useSession();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ConstellationScene | null>(null);
  const pushedSeq = useRef(0);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [labels, setLabels] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const module = await import("./scene/ConstellationScene");
        if (cancelled || !stageRef.current) return;
        sceneRef.current = new module.ConstellationScene(stageRef.current, { onError: setSceneError });
        setSceneReady(true);
      } catch {
        if (!cancelled) setSceneError("The 3D view could not start. The tabs still show the full run.");
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneReady || !state || !scenario) return;
    sceneRef.current?.setInput({
      nodes: state.nodes,
      links: state.links,
      inFlight: state.in_flight,
      simTime: state.sim_time,
      receivedAt,
      halted: state.halted,
      timeScale: state.time_scale,
      tickSeconds: scenario.tick_seconds,
      anomaly: state.anomaly,
      dtn: state.dtn,
      scenarioId: state.scenario_id,
      phase: state.phase,
    });
  }, [receivedAt, scenario, sceneReady, state]);

  useEffect(() => {
    if (!sceneReady) return;
    const lastSeq = events.length ? events[events.length - 1].seq : 0;
    if (lastSeq < pushedSeq.current) pushedSeq.current = 0; // new run
    const fresh = events.filter((event) => event.seq > pushedSeq.current);
    if (fresh.length) sceneRef.current?.pushEvents(fresh);
    pushedSeq.current = lastSeq;
  }, [events, sceneReady]);

  useEffect(() => {
    sceneRef.current?.setLabels(labels);
  }, [labels, sceneReady]);

  const phase = state?.phase ?? "IDLE";
  const anomaly = state?.anomaly ?? null;
  const dtn = state?.dtn ?? null;
  const resolved = phase === "RESOLVED" ? [...events].reverse().find((event) => event.type === "run_resolved") : undefined;
  const satellites = state?.nodes.filter((node) => node.kind === "satellite").length ?? 0;
  const grounds = state?.nodes.filter((node) => node.kind === "ground").length ?? 0;
  const slowdown = state ? Math.round(1 / state.time_scale) : 0;

  return (
    <div className={`stage stage-main${phase === "DETECTED" ? " stage-alerting" : ""}`} data-phase={phase}>
      <div
        ref={stageRef}
        style={{ position: "absolute", inset: 0 }}
        role="img"
        aria-label={`Globe with ${satellites} satellites and ${grounds} ground stations. Phase ${phase}.`}
      />

      {phase === "DETECTED" ? <div className="stage-flash" aria-hidden="true" /> : null}

      <span className="stage-badge">
        Simulation · schematic{slowdown ? ` · slowed ${slowdown}×` : ""}
      </span>

      <div className="stage-toolbar" role="toolbar" aria-label="Camera">
        <button type="button" className="stage-tool" aria-pressed={labels} onClick={() => setLabels((value) => !value)}>
          Labels
        </button>
        <button type="button" className="stage-tool" onClick={() => sceneRef.current?.resetView()} title="Reset camera" aria-label="Reset camera">
          <CornersOut size={13} aria-hidden="true" />
        </button>
        <button type="button" className="stage-tool" onClick={() => sceneRef.current?.zoomBy(0.82)} title="Zoom in" aria-label="Zoom in">
          <ArrowsIn size={13} aria-hidden="true" />
        </button>
        <button type="button" className="stage-tool" onClick={() => sceneRef.current?.zoomBy(1.22)} title="Zoom out" aria-label="Zoom out">
          <ArrowsOut size={13} aria-hidden="true" />
        </button>
      </div>

      {anomaly && phase === "DETECTED" ? (
        <div className="stage-banner stage-banner-alert" role="alert">
          <WarningOctagon size={22} weight="fill" aria-hidden="true" />
          <div className="stage-banner-body">
            <strong>Anomaly detected · simulation paused</strong>
            <span>
              <b className="mono">{anomaly.satellite_id}</b> ground link <b className="mono">{anomaly.link_id}</b> ·{" "}
              {formatPercent(anomaly.loss_rate)} loss ({anomaly.window_losses}/{anomaly.window_size} recent transmissions,
              threshold {formatPercent(anomaly.threshold)})
            </span>
            <span>Probable cause: {anomaly.probable_cause}</span>
            <span className="stage-banner-hint">Press Solve to reroute {anomaly.satellite_id} over DTN.</span>
          </div>
        </div>
      ) : null}

      {phase === "SOLVING" && dtn ? (
        <div className="stage-banner stage-banner-dtn" role="status">
          <div className="stage-banner-body">
            <strong>DTN store-carry-forward active</strong>
            <span>
              {dtn.relay_id ? (
                <>
                  Bundles from <b className="mono">{dtn.satellite_id}</b> travel {pathLabel(dtn.path)}
                </>
              ) : (
                "No relay reachable; bundles held in storage."
              )}
            </span>
          </div>
        </div>
      ) : null}

      {resolved ? (
        <div className="stage-banner stage-banner-success" role="status">
          <CheckCircle size={22} weight="fill" aria-hidden="true" />
          <div className="stage-banner-body">
            <strong>{resolved.message}</strong>
            <span>Run complete. Press Reset for a new random scenario.</span>
          </div>
        </div>
      ) : null}

      {phase === "IDLE" && state ? (
        <div className="stage-banner stage-banner-idle" role="status">
          <div className="stage-banner-body">
            <strong>Ready</strong>
            <span>
              {satellites} satellites, {grounds} ground station{grounds === 1 ? "" : "s"}. Press Play to start.
            </span>
          </div>
        </div>
      ) : null}

      <div className="stage-legend">
        <span className="stage-legend-row">
          <span className="stage-swatch" style={{ borderTopColor: "var(--stage-link-active)" }} /> Active link
        </span>
        <span className="stage-legend-row">
          <span className="stage-swatch" style={{ borderTopColor: "var(--stage-link-degraded)", borderTopStyle: "dashed" }} /> Degraded
        </span>
        <span className="stage-legend-row">
          <span className="stage-swatch" style={{ borderTopColor: "var(--stage-alert)", borderTopStyle: "dashed" }} /> Broken (anomaly)
        </span>
        <span className="stage-legend-row">
          <span className="stage-swatch" style={{ borderTopColor: "var(--stage-dtn)", borderTopWidth: 3 }} /> DTN path
        </span>
        <span className="stage-legend-row">
          <span className="stage-dot" style={{ background: "var(--stage-packet)" }} /> Packet ·{" "}
          <span className="stage-dot" style={{ background: "var(--stage-dtn)" }} /> Bundle ·{" "}
          <span className="stage-dot" style={{ background: "var(--stage-alert)" }} /> Lost
        </span>
      </div>

      {!state ? (
        <div className="stage-fallback" style={{ position: "absolute", inset: 0 }}>
          <span className="tiny">{connection === "offline" ? "Backend unreachable. Start the API on port 8000." : "Connecting to the simulation…"}</span>
        </div>
      ) : null}

      {sceneError ? (
        <div className="stage-fallback" style={{ position: "absolute", inset: 0, padding: "var(--space-5)" }}>
          <Notice tone="warn" title="3D view unavailable">
            {sceneError}
          </Notice>
        </div>
      ) : null}
    </div>
  );
};
