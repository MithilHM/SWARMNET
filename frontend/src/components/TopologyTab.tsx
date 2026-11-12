import React, { useState, useMemo } from "react";
import type {
  GroundStationNode,
  InTransitPacket,
  Link,
  NodeDetailResponse,
  Packet,
  RouteDecision,
  SatelliteNode,
  TopologyData,
} from "../types";

interface TopologyTabProps {
  topology: TopologyData | null;
  decisions?: RouteDecision[];
  packets?: Packet[];
  simulatedTime?: number;
  selectedNode: NodeDetailResponse | null;
  selectedLink: Link | null;
  onSelectNode: (nodeId: string) => void;
  onSelectLink: (link: Link) => void;
  onCloseDrawer: () => void;
}

export const TopologyTab: React.FC<TopologyTabProps> = ({
  topology,
  decisions = [],
  packets = [],
  simulatedTime = 0,
  selectedNode,
  selectedLink,
  onSelectNode,
  onSelectLink,
  onCloseDrawer,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

  // Normalize node positions into an 940x500 coordinate space with comfortable margins
  const nodeCoords = useMemo(() => {
    if (!topology) return new Map<string, { x: number; y: number }>();
    const coords = new Map<string, { x: number; y: number }>();

    const allNodes: Array<{ id: string; x: number; y: number }> = [];

    topology.satellites.forEach((sat) => {
      allNodes.push({
        id: sat.satellite_id,
        x: sat.position?.x ?? 0,
        y: sat.position?.y ?? 0,
      });
    });

    topology.ground_stations.forEach((gs) => {
      allNodes.push({
        id: gs.ground_station_id,
        x: gs.position?.x ?? 0,
        y: gs.position?.y ?? 0,
      });
    });

    if (allNodes.length === 0) return coords;

    // Find min and max bounds
    const minX = Math.min(...allNodes.map((n) => n.x));
    const maxX = Math.max(...allNodes.map((n) => n.x));
    const minY = Math.min(...allNodes.map((n) => n.y));
    const maxY = Math.max(...allNodes.map((n) => n.y));

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    // Map to canvas inner bounding box (120 to 820 horizontally, 120 to 380 vertically)
    // Providing ample margin above top node (SAT-02 at y=120) so badges never clip
    allNodes.forEach((n, idx) => {
      if (allNodes.length === 1) {
        coords.set(n.id, { x: 470, y: 250 });
        return;
      }
      let scaledY = 120 + ((n.y - minY) / spanY) * 260;
      if (spanY === 1) {
        scaledY = 250 + (idx % 2 === 1 ? 30 : -30);
      }
      const scaledX = 120 + ((n.x - minX) / spanX) * 700;
      coords.set(n.id, { x: scaledX, y: scaledY });
    });

    return coords;
  }, [topology]);

  const satellitesMap = useMemo(() => {
    const map = new Map<string, SatelliteNode>();
    topology?.satellites.forEach((s) => map.set(s.satellite_id, s));
    return map;
  }, [topology]);

  const groundMap = useMemo(() => {
    const map = new Map<string, GroundStationNode>();
    topology?.ground_stations.forEach((g) => map.set(g.ground_station_id, g));
    return map;
  }, [topology]);

  // Map of latest routing decision for each satellite
  const latestDecisionsMap = useMemo(() => {
    const map = new Map<string, RouteDecision>();
    if (!decisions) return map;
    decisions.forEach((dec) => {
      map.set(dec.satellite_id, dec);
    });
    return map;
  }, [decisions]);

  // Set of links that recently had forward activity (within last 10 simulated seconds)
  const activeForwardLinks = useMemo(() => {
    const active = new Set<string>();
    if (!decisions) return active;
    decisions.forEach((d) => {
      if (d.decision === "forward" && d.chosen_next_hop_id) {
        if (Math.abs(simulatedTime - d.decision_time) <= 12) {
          active.add(`${d.satellite_id}->${d.chosen_next_hop_id}`);
        }
      }
    });
    return active;
  }, [decisions, simulatedTime]);

  // In-transit packets currently moving across links
  const inTransitPackets = useMemo(() => {
    return (topology?.in_transit || []) as InTransitPacket[];
  }, [topology?.in_transit]);

  // Total delivered packets count across ground stations and packet events
  const totalDeliveredCount = useMemo(() => {
    let count = 0;
    topology?.ground_stations.forEach((gs) => {
      count += gs.received_packet_ids?.length || 0;
    });
    if (count === 0 && packets && packets.length > 0) {
      count = packets.filter((p) => p.status === "delivered").length;
    }
    return count;
  }, [topology, packets]);

  // Clean, deduplicated recent decisions for HUD feed
  const recentHUDDecisions = useMemo(() => {
    if (!decisions || decisions.length === 0) return [];
    const seen = new Set<string>();
    const unique: RouteDecision[] = [];

    // Scan backwards from latest
    for (let i = decisions.length - 1; i >= 0; i--) {
      const d = decisions[i];
      const key = `${d.satellite_id}-${d.decision}-${d.chosen_next_hop_id || "none"}-${d.reason_code}-${Math.round(d.decision_time)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(d);
      }
      if (unique.length >= 4) break;
    }
    return unique;
  }, [decisions]);

  if (!topology) {
    return (
      <div className="glass-card" style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
        No active topology. Initialize a simulation run in the header.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: selectedNode || selectedLink ? "1fr 380px" : "1fr", gap: "24px" }} id="topology-view">
      {/* Interactive Topology Graph Area */}
      <div className="glass-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Constellation Topology & Intermittent Link Matrix</h2>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Interactive view: Click satellites, ground stations, or links to inspect telemetry, queues, and contact windows.
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px", fontSize: "0.75rem" }}>
            <span style={{ color: "var(--color-sat)" }}>● Satellite ({topology.satellites.length})</span>
            <span style={{ color: "var(--color-ground)" }}>■ Ground Station ({topology.ground_stations.length})</span>
            <span style={{ color: "var(--color-link-active)" }}>— Active Link</span>
            <span style={{ color: "var(--color-link-degraded)" }}>- - Degraded Link</span>
            <span style={{ color: "var(--color-link-down)" }}>··· Down / Partition</span>
          </div>
        </div>

        {/* SVG Canvas Container */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "530px",
            background: "radial-gradient(ellipse at 50% 50%, rgba(15, 23, 42, 0.85) 0%, rgba(8, 12, 20, 0.98) 100%)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
          }}
        >
          <svg
            viewBox="0 0 940 500"
            style={{ width: "100%", height: "100%", display: "block" }}
            id="topology-canvas"
          >
            <defs>
              <linearGradient id="satGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#0284c7" />
              </linearGradient>
              <linearGradient id="groundGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
              <filter id="glowHeavy" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Links Layer */}
            {topology.links.map((link) => {
              const src = nodeCoords.get(link.source_node_id);
              const tgt = nodeCoords.get(link.target_node_id);
              if (!src || !tgt) return null;

              const isSelected = selectedLink?.link_id === link.link_id;
              const isHovered = hoveredLinkId === link.link_id;
              const isDown = !link.is_available;
              const isDegraded = link.is_available && link.reliability < 0.9;
              const hasRecentForward = activeForwardLinks.has(`${link.source_node_id}->${link.target_node_id}`);

              let strokeColor = "var(--color-link-active)";
              let strokeDash = "none";
              let strokeWidth = 2.5;

              if (isDown) {
                strokeColor = "#ef4444";
                strokeDash = "4 4";
                strokeWidth = 1.5;
              } else if (isDegraded) {
                strokeColor = "#f59e0b";
                strokeDash = "6 4";
                strokeWidth = 2;
              }

              if (isSelected || isHovered) {
                strokeWidth += 1.5;
              }

              const midX = (src.x + tgt.x) / 2;
              const midY = (src.y + tgt.y) / 2;
              const animDur = Math.max(0.9, link.latency_ms / 25);

              return (
                <g key={link.link_id} style={{ cursor: "pointer" }} onClick={() => onSelectLink(link)}>
                  {/* Hit-box */}
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke="transparent"
                    strokeWidth="16"
                    onMouseEnter={() => setHoveredLinkId(link.link_id)}
                    onMouseLeave={() => setHoveredLinkId(null)}
                  />

                  {/* Rendered link line */}
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDash}
                    strokeOpacity={isDown ? 0.35 : 0.85}
                    filter={!isDown ? "url(#glow)" : undefined}
                    className={!isDown && !isDegraded ? "link-flow" : undefined}
                  />

                  {/* Flow Particles & Comet Tail for active links */}
                  {!isDown && (
                    <g>
                      {/* Leading packet orb */}
                      <circle r="4" fill="#00f0ff" filter="url(#glow)">
                        <animateMotion
                          path={`M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`}
                          dur={`${animDur}s`}
                          repeatCount="indefinite"
                        />
                      </circle>
                      {/* Trailing particle 1 */}
                      <circle r="2.8" fill="#38bdf8" opacity="0.75">
                        <animateMotion
                          path={`M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`}
                          dur={`${animDur}s`}
                          begin="0.08s"
                          repeatCount="indefinite"
                        />
                      </circle>
                      {/* Trailing particle 2 */}
                      <circle r="1.8" fill="#0284c7" opacity="0.45">
                        <animateMotion
                          path={`M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`}
                          dur={`${animDur}s`}
                          begin="0.16s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    </g>
                  )}

                  {/* High Visibility Flying Packet Capsule for links with recent packet dispatch */}
                  {!isDown && hasRecentForward && (
                    <g>
                      <animateMotion
                        path={`M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`}
                        dur={`${Math.max(1.2, animDur * 1.1)}s`}
                        repeatCount="indefinite"
                      />
                      <g className="packet-capsule">
                        <rect
                          x="-20"
                          y="-10"
                          width="40"
                          height="20"
                          rx="6"
                          fill="#0284c7"
                          stroke="#38bdf8"
                          strokeWidth="1.8"
                          filter="url(#glow)"
                        />
                        <text
                          x="0"
                          y="3.5"
                          textAnchor="middle"
                          fontSize="8"
                          fill="#ffffff"
                          fontWeight="800"
                          fontFamily="var(--font-mono)"
                        >
                          📦 4KB
                        </text>
                      </g>
                    </g>
                  )}

                  {/* Midpoint badge for latency / DOWN status */}
                  <g transform={`translate(${midX}, ${midY})`}>
                    <rect
                      x="-26"
                      y="-10"
                      width="52"
                      height="20"
                      rx="4"
                      fill="#0f172a"
                      stroke={strokeColor}
                      strokeWidth="1"
                      fillOpacity="0.9"
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fontSize="9"
                      fill={isDown ? "#f87171" : "#94a3b8"}
                      fontFamily="var(--font-mono)"
                      fontWeight={isDown ? "700" : "500"}
                    >
                      {isDown ? "DOWN" : `${link.latency_ms}ms`}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* In-Transit Flying Packets from simulation transport */}
            {inTransitPackets.map((pkt) => {
              const src = nodeCoords.get(pkt.source);
              const tgt = nodeCoords.get(pkt.target);
              if (!src || !tgt) return null;

              const totalDur = Math.max(0.01, pkt.arrival_time - pkt.departure_time);
              const elapsed = (simulatedTime || topology.simulated_time) - pkt.departure_time;
              const fraction = Math.min(0.92, Math.max(0.08, elapsed / totalDur));
              const currentX = src.x + (tgt.x - src.x) * fraction;
              const currentY = src.y + (tgt.y - src.y) * fraction;

              return (
                <g
                  key={pkt.packet_id}
                  transform={`translate(${currentX}, ${currentY})`}
                  className="packet-capsule"
                  style={{ pointerEvents: "none" }}
                >
                  <rect
                    x="-20"
                    y="-11"
                    width="40"
                    height="22"
                    rx="6"
                    fill="#0284c7"
                    stroke="#38bdf8"
                    strokeWidth="1.8"
                    filter="url(#glow)"
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fontSize="8.5"
                    fill="#ffffff"
                    fontWeight="800"
                    fontFamily="var(--font-mono)"
                  >
                    📦 {(pkt.payload_size_bytes / 1024).toFixed(0)}KB
                  </text>
                </g>
              );
            })}

            {/* Nodes Layer */}
            {Array.from(nodeCoords.entries()).map(([nodeId, pos]) => {
              const isSat = satellitesMap.has(nodeId);
              const sat = satellitesMap.get(nodeId);
              const gs = groundMap.get(nodeId);

              const isSelected = selectedNode?.node_id === nodeId;
              const isHovered = hoveredNodeId === nodeId;
              const nodeRadius = isSat ? 22 : 24;

              // Buffer fill ratio for satellites
              const bufferRatio = sat ? Math.min(1, sat.buffer_used_bytes / (sat.buffer_capacity_bytes || 1)) : 0;
              const bufferUsedKB = sat ? ((sat.buffer_used_bytes || 0) / 1024).toFixed(0) : "0";

              // Delivered packets for ground station
              const deliveredAtGS = gs?.received_packet_ids?.length || 0;
              const effectiveDelivered = deliveredAtGS > 0 ? deliveredAtGS : totalDeliveredCount;

              // Latest routing decision
              const latestDec = isSat ? latestDecisionsMap.get(nodeId) : undefined;
              const isDecisionRecent = latestDec && Math.abs(simulatedTime - latestDec.decision_time) <= 12;
              const isForwarding = latestDec?.decision === "forward";
              const isBuffering = isSat && bufferRatio > 0;

              return (
                <g
                  key={nodeId}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectNode(nodeId)}
                  onMouseEnter={() => setHoveredNodeId(nodeId)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                >
                  {/* Ground Station Radar Ping Beacons (Dual Wave) */}
                  {!isSat && (
                    <>
                      <circle cx="0" cy="0" className="radar-ping" fill="none" stroke="#10b981" />
                      <circle cx="0" cy="0" className="radar-ping-secondary" fill="none" stroke="#34d399" />
                    </>
                  )}

                  {/* Satellite Store-and-Forward Buffer Rotation Ring */}
                  {isSat && isBuffering && (
                    <circle
                      cx="0"
                      cy="0"
                      r={nodeRadius + 7}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2"
                      strokeDasharray="6 6"
                      className="buffer-spin"
                      opacity="0.9"
                    />
                  )}

                  {/* Satellite Forwarding Energy Pulse Ring */}
                  {isSat && isDecisionRecent && isForwarding && (
                    <circle
                      cx="0"
                      cy="0"
                      r={nodeRadius + 6}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      opacity="0.85"
                    />
                  )}

                  {/* Selection / Hover aura */}
                  {(isSelected || isHovered) && (
                    <circle
                      r={nodeRadius + 12}
                      fill="none"
                      stroke={isSat ? "var(--color-sat)" : "var(--color-ground)"}
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      opacity="0.8"
                    />
                  )}

                  {/* Node Outer Orbit Ring for Satellite */}
                  {isSat && (
                    <circle
                      r={nodeRadius + 4}
                      fill="none"
                      stroke="rgba(56, 189, 248, 0.25)"
                      strokeWidth="1.5"
                    />
                  )}

                  {/* Node Body Circle */}
                  <circle
                    r={nodeRadius}
                    fill={isSat ? "url(#satGrad)" : "url(#groundGrad)"}
                    stroke={isSelected ? "#ffffff" : isSat ? "#38bdf8" : "#10b981"}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    filter="url(#glow)"
                  />

                  {/* Buffer occupancy meter ring (arc) for satellites */}
                  {isSat && bufferRatio > 0 && (
                    <circle
                      r={nodeRadius}
                      fill="none"
                      stroke={bufferRatio > 0.7 ? "#ef4444" : "#f59e0b"}
                      strokeWidth="3.5"
                      strokeDasharray={`${bufferRatio * (2 * Math.PI * nodeRadius)} ${2 * Math.PI * nodeRadius}`}
                      transform="rotate(-90)"
                    />
                  )}

                  {/* Icon representation inside node */}
                  {isSat ? (
                    <text
                      x="0"
                      y="-2"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9"
                      fontWeight="bold"
                    >
                      SAT
                    </text>
                  ) : (
                    <text
                      x="0"
                      y="-2"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9"
                      fontWeight="bold"
                    >
                      GND
                    </text>
                  )}

                  {/* Node ID label inside node */}
                  <text
                    x="0"
                    y="10"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="8"
                    fontFamily="var(--font-mono)"
                    fontWeight="600"
                  >
                    {nodeId.replace("SAT-", "").replace("GROUND-", "")}
                  </text>

                  {/* Below-node name label */}
                  <text
                    x="0"
                    y={nodeRadius + 16}
                    textAnchor="middle"
                    fill="var(--text-primary)"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {nodeId}
                  </text>

                  {/* Auxiliary status: buffer usage or delivered packets */}
                  <text
                    x="0"
                    y={nodeRadius + 28}
                    textAnchor="middle"
                    fill={isSat && bufferRatio > 0 ? "#fbbf24" : !isSat ? "#34d399" : "var(--text-muted)"}
                    fontSize="9.5"
                    fontFamily="var(--font-mono)"
                    fontWeight={isSat && bufferRatio > 0 || !isSat ? "700" : "normal"}
                  >
                    {isSat
                      ? `${bufferRatio > 0 ? `📦 ${bufferUsedKB}KB queued` : "Idle"}`
                      : `✓ ${effectiveDelivered} delivered`}
                  </text>

                  {/* Real-time Floating Decision Callout Banner */}
                  {isSat && isDecisionRecent && latestDec && (
                    <g transform={`translate(0, ${-nodeRadius - 20})`} className="decision-callout">
                      {/* Callout Background Pill */}
                      <rect
                        x="-54"
                        y="-12"
                        width="108"
                        height="20"
                        rx="10"
                        fill={
                          latestDec.decision === "forward"
                            ? "#064e3b"
                            : latestDec.decision === "buffer"
                            ? "#78350f"
                            : "#7f1d1d"
                        }
                        stroke={
                          latestDec.decision === "forward"
                            ? "#10b981"
                            : latestDec.decision === "buffer"
                            ? "#f59e0b"
                            : "#ef4444"
                        }
                        strokeWidth="1.5"
                        fillOpacity="0.95"
                      />
                      {/* Decision Text Label */}
                      <text
                        x="0"
                        y="2"
                        textAnchor="middle"
                        fontSize="8.5"
                        fill={
                          latestDec.decision === "forward"
                            ? "#6ee7b7"
                            : latestDec.decision === "buffer"
                            ? "#fde68a"
                            : "#fca5a5"
                        }
                        fontWeight="700"
                        fontFamily="var(--font-mono)"
                      >
                        {latestDec.decision === "forward"
                          ? `⚡ FWD ➔ ${latestDec.chosen_next_hop_id?.replace("SAT-", "S").replace("GROUND-", "G")}`
                          : latestDec.decision === "buffer"
                          ? `⏸ BUFFER`
                          : `❌ DROP`}
                      </text>
                      {/* Triangle Pointer downward to node */}
                      <polygon
                        points="-4,8 4,8 0,13"
                        fill={
                          latestDec.decision === "forward"
                            ? "#10b981"
                            : latestDec.decision === "buffer"
                            ? "#f59e0b"
                            : "#ef4444"
                        }
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Tactical In-Canvas Live Stream HUD (Bottom-Left) */}
          <div
            style={{
              position: "absolute",
              bottom: "16px",
              left: "16px",
              background: "rgba(15, 23, 42, 0.9)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              borderRadius: "8px",
              padding: "10px 14px",
              fontSize: "0.75rem",
              width: "330px",
              pointerEvents: "none",
              boxShadow: "0 6px 18px rgba(0,0,0,0.55)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "4px" }}>
              <span style={{ fontWeight: 700, color: "var(--accent-cyan)", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                LIVE TACTICAL STREAM
              </span>
              <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
                {inTransitPackets.length} in flight | {totalDeliveredCount} delivered
              </span>
            </div>

            {recentHUDDecisions.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.72rem" }}>
                Awaiting routing activity...
              </div>
            ) : (
              recentHUDDecisions.slice(0, 3).map((d) => (
                <div key={d.decision_id} style={{ display: "flex", justifyContent: "space-between", gap: "6px", fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
                  <span style={{ color: "#38bdf8", fontWeight: 600 }}>{d.satellite_id}:</span>
                  <span
                    style={{
                      color:
                        d.decision === "forward"
                          ? "#34d399"
                          : d.decision === "buffer"
                          ? "#fbbf24"
                          : "#f87171",
                      fontWeight: 600,
                    }}
                  >
                    {d.decision === "forward"
                      ? `FWD ➔ ${d.chosen_next_hop_id}`
                      : `${d.decision.toUpperCase()} (${d.reason_code})`}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>t={d.decision_time.toFixed(0)}s</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Legend bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
          <div>
            <strong>Interactive Instructions:</strong> Click on any satellite or ground station node to inspect queue buffers and route decisions. Click on links to inspect latency, bandwidth, and contact schedule.
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <span>Buffer Gauge: Amber Arc</span>
            <span>Link Pulse: Active Contact</span>
          </div>
        </div>
      </div>

      {/* Side Inspector Drawer */}
      {(selectedNode || selectedLink) && (
        <aside className="glass-card drawer" id="topology-inspector-drawer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "12px" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)" }}>
              {selectedNode ? `Node: ${selectedNode.node_id}` : `Link: ${selectedLink?.link_id}`}
            </h3>
            <button
              className="btn btn-outline"
              style={{ padding: "2px 8px", fontSize: "0.75rem" }}
              onClick={onCloseDrawer}
              title="Close drawer"
            >
              ✕
            </button>
          </div>

          {/* Node Inspector */}
          {selectedNode && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <span className={`badge ${selectedNode.node_type === "satellite" ? "badge-status-completed" : "badge-status-running"}`}>
                  {selectedNode.node_type.toUpperCase()}
                </span>
                <span className={`badge ${selectedNode.status === "active" ? "badge-status-running" : "badge-status-paused"}`}>
                  {selectedNode.status.toUpperCase()}
                </span>
              </div>

              {selectedNode.node_type === "satellite" ? (
                <>
                  {/* Buffer Usage */}
                  <div style={{ background: "rgba(0,0,0,0.3)", padding: "12px", borderRadius: "var(--radius-md)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Buffer Capacity Occupancy</span>
                      <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--accent-cyan)" }}>
                        {((selectedNode.buffer_used_bytes || 0) / 1024).toFixed(1)} KB /{" "}
                        {((selectedNode.buffer_capacity_bytes || 1048576) / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            ((selectedNode.buffer_used_bytes || 0) / (selectedNode.buffer_capacity_bytes || 1)) * 100
                          )}%`,
                          background: "linear-gradient(90deg, #38bdf8, #f59e0b)",
                        }}
                      />
                    </div>
                    <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Packets currently stored: <strong>{selectedNode.buffer_packet_count || 0}</strong>
                    </div>
                  </div>

                  {/* Energy Percent */}
                  <div style={{ background: "rgba(0,0,0,0.3)", padding: "12px", borderRadius: "var(--radius-md)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Energy Reserve</span>
                      <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--color-success)" }}>
                        {selectedNode.energy_percent?.toFixed(1) || "100.0"}%
                      </span>
                    </div>
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${selectedNode.energy_percent || 100}%`,
                          background: "var(--color-success)",
                        }}
                      />
                    </div>
                  </div>

                  {/* Reachable Neighbors */}
                  <div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "6px" }}>
                      Reachable Direct Neighbors:
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {selectedNode.neighbors && selectedNode.neighbors.length > 0 ? (
                        selectedNode.neighbors.map((nbr) => (
                          <button
                            key={nbr}
                            className="btn btn-outline"
                            style={{ fontSize: "0.75rem", padding: "3px 8px" }}
                            onClick={() => onSelectNode(nbr)}
                          >
                            {nbr}
                          </button>
                        ))
                      ) : (
                        <span style={{ color: "var(--color-danger)", fontSize: "0.75rem" }}>
                          No reachable contacts (Partitioned)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Queued Packets list */}
                  <div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "6px" }}>
                      Stored Packet Queue ({selectedNode.buffered_packets?.length || 0}):
                    </div>
                    <div style={{ maxHeight: "140px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                      {selectedNode.buffered_packets && selectedNode.buffered_packets.length > 0 ? (
                        selectedNode.buffered_packets.map((pkt) => (
                          <div
                            key={pkt.packet_id}
                            style={{
                              background: "rgba(0,0,0,0.25)",
                              padding: "6px 8px",
                              borderRadius: "var(--radius-sm)",
                              fontSize: "0.75rem",
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span className="font-mono" style={{ color: "var(--accent-cyan)" }}>
                              {pkt.packet_id}
                            </span>
                            <span style={{ color: "var(--text-muted)" }}>
                              → {pkt.destination_node_id} ({pkt.payload_size_bytes}B)
                            </span>
                          </div>
                        ))
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.75rem" }}>
                          Queue is currently empty.
                        </span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                /* Ground Station details */
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ background: "rgba(0,0,0,0.3)", padding: "12px", borderRadius: "var(--radius-md)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Total Delivered Packets</div>
                    <div className="kpi-value" style={{ color: "var(--color-success)", fontSize: "1.4rem" }}>
                      {selectedNode.received_packet_count || 0}
                    </div>
                  </div>
                  <div style={{ background: "rgba(0,0,0,0.3)", padding: "12px", borderRadius: "var(--radius-md)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Received Throughput</div>
                    <div className="font-mono" style={{ color: "var(--text-primary)" }}>
                      {(((selectedNode.total_bytes_received || 0) / 1024)).toFixed(2)} KB
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "6px" }}>
                      Last Contact Simulation Time:
                    </div>
                    <div className="font-mono" style={{ fontSize: "0.85rem", color: "var(--accent-blue)" }}>
                      {selectedNode.last_contact_time != null ? `T+${selectedNode.last_contact_time.toFixed(1)}s` : "Pending contact"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Link Inspector */}
          {selectedLink && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <span className={`badge ${selectedLink.is_available ? "badge-status-running" : "badge-status-paused"}`}>
                  {selectedLink.is_available ? "ACTIVE CONTACT" : "UNAVAILABLE"}
                </span>
                <span className="badge badge-sim">
                  {selectedLink.source_node_id} ➔ {selectedLink.target_node_id}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-md)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Latency</div>
                  <div className="font-mono" style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>
                    {selectedLink.latency_ms} ms
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-md)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Bandwidth</div>
                  <div className="font-mono" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {selectedLink.bandwidth_mbps} Mbps
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-md)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Reliability</div>
                  <div className="font-mono" style={{ color: "var(--color-success)", fontWeight: 600 }}>
                    {(selectedLink.reliability * 100).toFixed(0)}%
                  </div>
                </div>
                <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px", borderRadius: "var(--radius-md)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Contact Window End</div>
                  <div className="font-mono" style={{ color: "var(--accent-purple)", fontWeight: 600 }}>
                    {selectedLink.contact_end_time != null ? `T+${selectedLink.contact_end_time.toFixed(0)}s` : "Unscheduled"}
                  </div>
                </div>
              </div>

              {selectedLink.failure_reason && (
                <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239,68,68,0.3)", padding: "10px", borderRadius: "var(--radius-md)" }}>
                  <div style={{ color: "var(--color-danger)", fontSize: "0.75rem", fontWeight: 600 }}>Link Status Detail:</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>{selectedLink.failure_reason}</div>
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
};
