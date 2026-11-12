import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsOut, CornersOut, Eye } from "@phosphor-icons/react";
import type { SimulationSession } from "../../app/useSimulationSession";
import type { ConstellationScene, SceneData, SceneNode, SceneOptions } from "./scene/ConstellationScene";
import { EmptyState, KeyValues, Meter, Notice, Panel, SkeletonRows, StatusLabel, Chip } from "../../components/ui";
import { formatBytes, formatPercent, formatReliability, formatSeconds, linkState, shortNodeId } from "../../lib/format";
import {
  DECISION_LABEL,
  LINK_STATE_LABEL,
  PACKET_STATUS_LABEL,
  decisionTone,
  linkStateTone,
  policyLabel,
  runStatusTone,
  RUN_STATUS_LABEL,
} from "../../lib/status";

const RECENT_WINDOW_SECONDS = 12;

export const ConstellationView: React.FC<{ session: SimulationSession }> = ({ session }) => {
  const {
    topology,
    metrics,
    decisions,
    simTime,
    playing,
    speed,
    run,
    status,
    selectedNodeId,
    selectedLinkId,
    selectedLink,
    nodeDetail,
    nodeError,
    pending,
    selectNode,
    selectLink,
    closeInspector,
  } = session;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ConstellationScene | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [options, setOptions] = useState<SceneOptions>({ labels: true, links: true, packets: true, orbits: true });

  const sceneData = useMemo<SceneData>(() => {
    const nodes: SceneNode[] = [];
    if (topology) {
      const recentByNode = new Map<string, SceneNode["recent"]>();
      for (const decision of decisions) {
        if (Math.abs(simTime - decision.decision_time) > RECENT_WINDOW_SECONDS) continue;
        if (!recentByNode.has(decision.satellite_id)) recentByNode.set(decision.satellite_id, decision.decision);
      }
      for (const satellite of topology.satellites) {
        const capacity = satellite.buffer_capacity_bytes || 1;
        nodes.push({
          id: satellite.satellite_id,
          kind: "satellite",
          status: satellite.status,
          bufferRatio: Math.min(1, (satellite.buffer_used_bytes || 0) / capacity),
          recent: recentByNode.get(satellite.satellite_id) ?? null,
        });
      }
      for (const ground of topology.ground_stations) {
        nodes.push({
          id: ground.ground_station_id,
          kind: "ground",
          status: ground.status,
          bufferRatio: 0,
          recent: null,
        });
      }
    }

    return {
      seed: run?.seed ?? 42,
      nodes,
      links: (topology?.links ?? []).map((link) => ({
        id: link.link_id,
        source: link.source_node_id,
        target: link.target_node_id,
        state: linkState(link),
      })),
      packets: (topology?.in_transit ?? []).map((packet) => ({
        id: packet.packet_id,
        linkId: packet.link_id,
        source: packet.source,
        target: packet.target,
        departure: packet.departure_time,
        arrival: packet.arrival_time,
      })),
    };
  }, [decisions, run?.seed, simTime, topology]);

  // Create the renderer once, after the stage element exists.
  useEffect(() => {
    let cancelled = false;
    const container = stageRef.current;
    if (!container) return;

    (async () => {
      try {
        const module = await import("./scene/ConstellationScene");
        if (cancelled || !stageRef.current) return;
        const scene = new module.ConstellationScene(stageRef.current, {
          onSelectNode: (nodeId) => void selectNode(nodeId),
          onSelectLink: (linkId) => {
            const link = topology?.links.find((item) => item.link_id === linkId);
            if (link) selectLink(link);
          },
          onSelectNone: () => closeInspector(),
          onHover: (target) => setHoverLabel(target ? (target.kind === "node" ? shortNodeId(target.id) : target.id) : null),
          onError: (message) => setSceneError(message),
        });
        sceneRef.current = scene;
        setSceneReady(true);
      } catch {
        if (!cancelled) setSceneError("The 3D view could not start. Use the object list below to inspect the run.");
      }
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // Scene lifetime is tied to the stage element only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sceneReady) return;
    sceneRef.current?.setData(sceneData);
  }, [sceneData, sceneReady]);

  useEffect(() => {
    if (!sceneReady) return;
    sceneRef.current?.setTime(simTime, playing, speed);
  }, [playing, sceneReady, simTime, speed]);

  useEffect(() => {
    if (!sceneReady) return;
    sceneRef.current?.setSelection({
      kind: selectedNodeId ? "node" : selectedLinkId ? "link" : "none",
      id: selectedNodeId ?? selectedLinkId ?? null,
    });
  }, [sceneReady, selectedLinkId, selectedNodeId]);

  useEffect(() => {
    if (!sceneReady) return;
    sceneRef.current?.setOptions(options);
  }, [options, sceneReady]);

  const toggle = useCallback((key: keyof SceneOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (!topology) {
    return (
      <Panel title="Constellation" subtitle="Schematic orbital view of the simulated constellation.">
        <EmptyState
          title="No run is active"
          body="Initialize a run from the bar above. The globe then shows the scenario's satellites, ground stations, contact links, and packets in flight. Positions are illustrative and not to scale."
        />
      </Panel>
    );
  }

  const bufferedBytes = metrics
    ? Object.values(metrics.buffer_occupancy_by_node ?? {}).reduce((total, value) => total + value, 0)
    : 0;

  return (
    <div className="stack">
      <div className="split">
        <div className="stack" style={{ gap: "var(--space-3)" }}>
          <div className="stage" style={{ height: "min(66vh, 640px)" }}>
            <div
              ref={stageRef}
              style={{ position: "absolute", inset: 0 }}
              role="img"
              aria-label={`Schematic three dimensional view of ${sceneData.nodes.length} nodes and ${sceneData.links.length} links. Use the object list for keyboard access.`}
            />

            <span className="stage-badge">Simulation · schematic, not to scale</span>

            <div className="stage-toolbar" role="toolbar" aria-label="Scene layers">
              <button type="button" className="stage-tool" aria-pressed={options.orbits} onClick={() => toggle("orbits")}>
                Orbits
              </button>
              <button type="button" className="stage-tool" aria-pressed={options.links} onClick={() => toggle("links")}>
                Links
              </button>
              <button type="button" className="stage-tool" aria-pressed={options.packets} onClick={() => toggle("packets")}>
                Packets
              </button>
              <button type="button" className="stage-tool" aria-pressed={options.labels} onClick={() => toggle("labels")}>
                Labels
              </button>
              <button type="button" className="stage-tool" onClick={() => sceneRef.current?.resetView()} title="Reset camera">
                <CornersOut size={13} aria-hidden="true" />
              </button>
              <button type="button" className="stage-tool" onClick={() => sceneRef.current?.zoomBy(0.82)} title="Zoom in">
                <ArrowsOut size={13} aria-hidden="true" />
              </button>
              <button type="button" className="stage-tool" onClick={() => sceneRef.current?.zoomBy(1.22)} title="Zoom out">
                <Eye size={13} aria-hidden="true" />
              </button>
            </div>

            <div className="stage-legend">
              <span className="stage-legend-row">
                <span className="stage-swatch" style={{ borderTopColor: "var(--stage-link-active)" }} /> Active contact
              </span>
              <span className="stage-legend-row">
                <span className="stage-swatch" style={{ borderTopColor: "var(--stage-link-degraded)", borderTopStyle: "dashed" }} />{" "}
                Degraded
              </span>
              <span className="stage-legend-row">
                <span className="stage-swatch" style={{ borderTopColor: "var(--stage-link-down)", borderTopStyle: "dotted" }} />{" "}
                Unavailable
              </span>
              <span className="stage-legend-row">
                <span
                  className="stage-swatch"
                  style={{ borderTopColor: "var(--stage-satellite)", borderTopWidth: 3, width: 8, borderRadius: 2 }}
                />{" "}
                Satellite
              </span>
              <span className="stage-legend-row">
                <span className="stage-swatch" style={{ borderTopColor: "var(--stage-accent)", borderTopWidth: 3, width: 8 }} />{" "}
                Ground station
              </span>
            </div>

            {hoverLabel ? <span className="stage-hint">Hover: {hoverLabel}</span> : <span className="stage-hint">Drag to orbit · scroll to zoom · click to inspect</span>}

            {!sceneReady && !sceneError ? (
              <div className="stage-fallback" style={{ position: "absolute", inset: 0 }}>
                <span className="tiny">Starting 3D view…</span>
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

          <div className="row tiny muted">
            <span>
              Orbit paths and globe anchors are derived from the run seed. Network state, contact windows, and packet
              positions come from the simulation.
            </span>
            <span className="grow" />
            <span className="mono">{sceneData.nodes.length} nodes</span>
            <span className="mono">{sceneData.links.length} links</span>
            <span className="mono">{sceneData.packets.length} in flight</span>
          </div>
        </div>

        <div className="stack" style={{ gap: "var(--space-3)" }}>
          {selectedLink ? (
            <Panel
              title={selectedLink.link_id}
              subtitle={`${selectedLink.source_node_id} to ${selectedLink.target_node_id}`}
              actions={
                <button type="button" className="btn btn-sm btn-quiet" onClick={closeInspector}>
                  Close
                </button>
              }
            >
              <div className="row">
                <StatusLabel tone={linkStateTone(linkState(selectedLink))}>
                  {LINK_STATE_LABEL[linkState(selectedLink)]}
                </StatusLabel>
                <span className="chip">Directed link</span>
              </div>
              <KeyValues
                items={[
                  { label: "Latency", value: `${selectedLink.latency_ms} ms` },
                  { label: "Bandwidth", value: `${selectedLink.bandwidth_mbps} Mbps` },
                  { label: "Reliability", value: formatReliability(selectedLink.reliability) },
                  {
                    label: "Contact ends",
                    value: selectedLink.contact_end_time != null ? `T+${selectedLink.contact_end_time.toFixed(0)}s` : "Unscheduled",
                  },
                  {
                    label: "Transferred",
                    value: formatBytes(metrics?.link_transferred_bytes?.[selectedLink.link_id] ?? 0),
                  },
                ]}
              />
              {selectedLink.failure_reason ? (
                <Notice tone="warn" title="Reported reason">
                  {selectedLink.failure_reason}
                </Notice>
              ) : null}
            </Panel>
          ) : null}

          {selectedNodeId && !selectedLink ? (
            <Panel
              title={selectedNodeId}
              subtitle={nodeDetail ? `${nodeDetail.node_type === "satellite" ? "Satellite" : "Ground station"} detail` : "Loading node detail"}
              actions={
                <button type="button" className="btn btn-sm btn-quiet" onClick={closeInspector}>
                  Close
                </button>
              }
            >
              {nodeError ? <Notice tone="error">{nodeError}</Notice> : null}
              {!nodeDetail && pending === "node" ? <SkeletonRows rows={5} /> : null}

              {nodeDetail && nodeDetail.node_type === "satellite" ? (
                <>
                  <div className="row">
                    <StatusLabel tone={nodeDetail.status === "active" ? "active" : "down"}>
                      {nodeDetail.status === "active" ? "Active" : "Disabled"}
                    </StatusLabel>
                    <Chip tone="degraded">{formatBytes(nodeDetail.buffer_used_bytes ?? 0)} buffered</Chip>
                  </div>

                  <div className="stack-sm">
                    <div className="spread tiny">
                      <span className="muted">Buffer</span>
                      <span className="mono">
                        {formatBytes(nodeDetail.buffer_used_bytes ?? 0)} / {formatBytes(nodeDetail.buffer_capacity_bytes ?? 0)}
                      </span>
                    </div>
                    <Meter
                      value={nodeDetail.buffer_used_bytes ?? 0}
                      max={nodeDetail.buffer_capacity_bytes ?? 1}
                      level={
                        (nodeDetail.buffer_used_bytes ?? 0) / (nodeDetail.buffer_capacity_bytes || 1) > 0.85
                          ? "crit"
                          : (nodeDetail.buffer_used_bytes ?? 0) / (nodeDetail.buffer_capacity_bytes || 1) > 0.5
                            ? "warn"
                            : "ok"
                      }
                      label="Buffer occupancy"
                    />
                  </div>

                  <KeyValues
                    items={[
                      { label: "Energy", value: formatPercent((nodeDetail.energy_percent ?? 0) / 100, 0) },
                      { label: "Stored packets", value: String(nodeDetail.buffer_packet_count ?? 0) },
                    ]}
                  />

                  <div className="stack-sm">
                    <span className="field-label">Reachable neighbours</span>
                    {nodeDetail.neighbors && nodeDetail.neighbors.length > 0 ? (
                      <div className="row">
                        {nodeDetail.neighbors.map((neighbor) => (
                          <button
                            key={neighbor}
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void selectNode(neighbor)}
                          >
                            {neighbor}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="tiny muted">No usable contacts. Stored packets stay in the buffer.</p>
                    )}
                  </div>

                  <div className="stack-sm">
                    <span className="field-label">Stored packets ({nodeDetail.buffered_packets?.length ?? 0})</span>
                    {nodeDetail.buffered_packets && nodeDetail.buffered_packets.length > 0 ? (
                      <ul className="stack-sm">
                        {nodeDetail.buffered_packets.slice(0, 8).map((packet) => (
                          <li key={packet.packet_id} className="spread tiny">
                            <span className="mono">{packet.packet_id}</span>
                            <span className="muted">
                              to {packet.destination_node_id} · {formatBytes(packet.payload_size_bytes)} ·{" "}
                              {PACKET_STATUS_LABEL[packet.status]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="tiny muted">Queue is empty.</p>
                    )}
                  </div>

                  <div className="stack-sm">
                    <span className="field-label">Recent decisions</span>
                    {nodeDetail.recent_decisions && nodeDetail.recent_decisions.length > 0 ? (
                      <ul className="stack-sm">
                        {nodeDetail.recent_decisions
                          .slice(-5)
                          .reverse()
                          .map((decision) => (
                            <li key={decision.decision_id} className="spread tiny">
                              <span className="row-tight">
                                <StatusLabel tone={decisionTone(decision.decision)} dot={false}>
                                  {DECISION_LABEL[decision.decision]}
                                </StatusLabel>
                                <span className="mono muted">{decision.reason_code}</span>
                              </span>
                              <span className="mono muted">T+{decision.decision_time.toFixed(0)}s</span>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="tiny muted">No decisions recorded for this node yet.</p>
                    )}
                  </div>
                </>
              ) : null}

              {nodeDetail && nodeDetail.node_type === "ground_station" ? (
                <>
                  <div className="row">
                    <StatusLabel tone={nodeDetail.status === "active" ? "active" : "down"}>
                      {nodeDetail.status === "active" ? "Receiving" : "Disabled"}
                    </StatusLabel>
                  </div>
                  <KeyValues
                    items={[
                      { label: "Delivered packets", value: String(nodeDetail.received_packet_count ?? 0) },
                      { label: "Bytes received", value: formatBytes(nodeDetail.total_bytes_received ?? 0) },
                      {
                        label: "Last contact",
                        value: nodeDetail.last_contact_time != null ? `T+${nodeDetail.last_contact_time.toFixed(1)}s` : "None yet",
                      },
                    ]}
                  />
                  {nodeDetail.received_packets && nodeDetail.received_packets.length > 0 ? (
                    <div className="stack-sm">
                      <span className="field-label">Recently received</span>
                      <ul className="stack-sm">
                        {nodeDetail.received_packets.slice(-6).reverse().map((packet) => (
                          <li key={packet.packet_id} className="spread tiny">
                            <span className="mono">{packet.packet_id}</span>
                            <span className="muted">
                              {formatBytes(packet.payload_size_bytes)} ·{" "}
                              {packet.delivery_time != null ? formatSeconds(packet.delivery_time - packet.created_at) : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </Panel>
          ) : null}

          {!selectedNodeId && !selectedLink ? (
            <Panel title="Inspector" subtitle="Select a satellite, ground station, or link.">
              <KeyValues
                items={[
                  { label: "Run", value: run ? `${run.run_id.slice(0, 8)}…` : "—" },
                  { label: "Policy", value: policyLabel(run?.routing_policy) },
                  { label: "Clock", value: `T+${simTime.toFixed(1)}s` },
                  { label: "Status", value: RUN_STATUS_LABEL[status] },
                  { label: "Buffered", value: formatBytes(bufferedBytes) },
                  { label: "Active links", value: `${topology.links.filter((link) => link.is_available).length} of ${topology.links.length}` },
                ]}
              />
              <p className="tiny muted">
                Selection also drives the keyboard-accessible object list below, so every inspection works without a
                pointer.
              </p>
            </Panel>
          ) : null}

          <Panel title="Object list" subtitle="Keyboard-accessible alternative to the 3D view.">
            <div className="stack-sm">
              <span className="field-label">Satellites</span>
              <div className="row">
                {topology.satellites.map((satellite) => (
                  <button
                    key={satellite.satellite_id}
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={selectedNodeId === satellite.satellite_id}
                    onClick={() => void selectNode(satellite.satellite_id)}
                  >
                    {satellite.satellite_id}
                  </button>
                ))}
              </div>
            </div>
            <div className="stack-sm">
              <span className="field-label">Ground stations</span>
              <div className="row">
                {topology.ground_stations.map((ground) => (
                  <button
                    key={ground.ground_station_id}
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={selectedNodeId === ground.ground_station_id}
                    onClick={() => void selectNode(ground.ground_station_id)}
                  >
                    {ground.ground_station_id}
                  </button>
                ))}
              </div>
            </div>
            <div className="stack-sm">
              <span className="field-label">Links</span>
              <div className="row">
                {topology.links.map((link) => (
                  <button
                    key={link.link_id}
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={selectedLinkId === link.link_id}
                    onClick={() => selectLink(link)}
                    title={`${LINK_STATE_LABEL[linkState(link)]} · ${link.latency_ms} ms`}
                  >
                    {shortNodeId(link.source_node_id)}→{shortNodeId(link.target_node_id)}
                  </button>
                ))}
              </div>
            </div>
            <p className="tiny muted">
              {packetsInFlightLabel(sceneData.packets.length)}
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid grid-3">
        <Panel title="Packets in flight" subtitle="Derived from transport handoffs, not from link activity.">
          {sceneData.packets.length === 0 ? (
            <p className="tiny muted">No packet is mid-transfer at this simulated time.</p>
          ) : (
            <ul className="stack-sm">
              {sceneData.packets.slice(0, 6).map((packet) => (
                <li key={packet.id} className="spread tiny">
                  <span className="mono">{packet.id}</span>
                  <span className="muted">
                    {shortNodeId(packet.source)}→{shortNodeId(packet.target)} ·{" "}
                    {formatSeconds(Math.max(0, packet.arrival - simTime), 1)} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Contact quality" subtitle="Active links with the lowest reliability first.">
          {topology.links.filter((link) => link.is_available).length === 0 ? (
            <p className="tiny muted">Every modeled link is unavailable at this time.</p>
          ) : (
            <ul className="stack-sm">
              {[...topology.links]
                .filter((link) => link.is_available)
                .sort((a, b) => a.reliability - b.reliability)
                .slice(0, 6)
                .map((link) => (
                  <li key={link.link_id} className="spread tiny">
                    <span className="row-tight">
                      <StatusLabel tone={linkStateTone(linkState(link))} dot={false}>
                        {LINK_STATE_LABEL[linkState(link)]}
                      </StatusLabel>
                      <span className="mono">
                        {shortNodeId(link.source_node_id)}→{shortNodeId(link.target_node_id)}
                      </span>
                    </span>
                    <span className="mono muted">{formatReliability(link.reliability)}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        <Panel title="Run" subtitle="Simulation time drives the schematic motion.">
          <KeyValues
            items={[
              { label: "Status", value: <StatusLabel tone={runStatusTone(status)}>{RUN_STATUS_LABEL[status]}</StatusLabel> },
              { label: "Scenario", value: run?.scenario_id ?? "—" },
              { label: "Seed", value: String(run?.seed ?? 42) },
              { label: "In transit", value: String(metrics?.packets_in_transit ?? sceneData.packets.length) },
              { label: "Buffered", value: String(metrics?.packets_pending ?? 0) },
            ]}
          />
          <p className="tiny muted">
            Packets only move between nodes when the simulation reports a handoff. Link glow is never used as a stand-in
            for traffic.
          </p>
        </Panel>
      </div>

      {sceneError ? null : (
        <p className="tiny muted">
          Globe outlines derived from Natural Earth 1:110m (public domain). Orbits and ground anchors are illustrative,
          not orbital mechanics.
        </p>
      )}
    </div>
  );
};

function packetsInFlightLabel(count: number): string {
  if (count === 0) return "0 packets mid-transfer";
  return `${count} packet${count === 1 ? "" : "s"} mid-transfer`;
}