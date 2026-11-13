"""Guided-flow simulation engine: direct-to-ground traffic, anomaly detection, DTN recovery.

The engine is a deterministic, tick-based state machine:

    IDLE -> STABLE -> DEGRADING -> DETECTED (halted) -> SOLVING -> RESOLVED (halted)

* Simulated time advances only through ``step()``; wall-clock pacing lives in
  ``app.simulation.session`` (PRD 13.1).
* Every state change is recorded as an event. The frontend renders these
  events and never invents state of its own.
* Loss is injected on one satellite-to-ground link (by the seeded failure plan
  or by a manual sever). Detection is driven only by the rolling loss rate of
  observed transmissions on each ground link, never by a timer.
* After ``solve()`` the affected satellite switches from direct-to-ground to
  delay-tolerant store-carry-forward: bundles are held in its buffer, forwarded
  over inter-satellite links (ISLs) to a relay that still has a healthy ground
  link, stored there, and forwarded to the ground station. Custody moves only
  when a handoff succeeds (at-least-once semantics, PRD FR-4.6).

Transfer semantics: the sender keeps its copy until the transport reports the
handoff outcome. Under the direct protocol a failed transmission is reported as
``lost`` and is not retried (there is no store-and-forward), but the source still
holds the custody copy. When DTN is enabled those copies are re-bundled; any
that are later delivered are counted as ``recovered``.
"""

from __future__ import annotations

import random
import uuid
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

from app.agents.ground_agent import GroundStationAgent
from app.buffering.buffer import NodeBuffer
from app.models.decision import CandidateScore, DecisionAction, DecisionReasonCode, RouteDecision
from app.models.link import Link
from app.models.packet import DropReason, Packet, PacketStatus, RouteHop
from app.simulation.scenario_generator import FlowScenario, destination, link_id_for

EPS = 1e-9
MAX_DRIFT_DEG = 8.0
# Relay selection weights (documented in docs/architecture.md).
RELAY_W_RELIABILITY = 0.7
RELAY_W_LATENCY = 0.3
RELAY_HOP_PENALTY = 0.05
RELAY_MIN_GROUND_RELIABILITY = 0.9


class Phase(str, Enum):
    IDLE = "IDLE"
    STABLE = "STABLE"
    DEGRADING = "DEGRADING"
    DETECTED = "DETECTED"
    SOLVING = "SOLVING"
    RESOLVED = "RESOLVED"


PHASE_TAG: Dict[Phase, str] = {
    Phase.IDLE: "idle",
    Phase.STABLE: "stable",
    Phase.DEGRADING: "degrading",
    Phase.DETECTED: "detected",
    Phase.SOLVING: "dtn",
    Phase.RESOLVED: "dtn",
}


class SimulationActionError(Exception):
    """Raised when a control action is not valid in the current phase."""


@dataclass
class InFlight:
    packet_id: str
    link_id: str
    source: str
    target: str
    depart: float
    arrive: float
    mode: str  # "direct" | "dtn"


class FlowEngine:
    def __init__(
        self,
        scenario: FlowScenario,
        *,
        dtn_enabled: bool = True,
        run_id: Optional[str] = None,
        affected_quota: Optional[int] = None,
    ) -> None:
        self.scenario = scenario
        self.dtn_enabled = dtn_enabled
        self.run_id = run_id
        self.rng = random.Random((scenario.seed * 7919) ^ 0x5EED)
        self.dt = scenario.tick_seconds

        self.tick = 0
        self.now = 0.0
        self.phase = Phase.IDLE
        self.halted = True
        self.events: List[Dict[str, Any]] = []
        self._seq = 0

        self.sat_ids = [s.id for s in scenario.satellites]
        self.gs_ids = [g.id for g in scenario.ground_stations]
        self.sat_spec = {s.id: s for s in scenario.satellites}
        self.home_gs = {s.id: s.ground_station_id for s in scenario.satellites}

        self.links: Dict[str, Link] = {}
        self.link_kind: Dict[str, str] = {}
        self.baseline_reliability: Dict[str, float] = {}
        for spec in scenario.links:
            self.links[spec.link_id] = Link(
                link_id=spec.link_id,
                source_node_id=spec.source,
                target_node_id=spec.target,
                is_available=True,
                latency_ms=spec.latency_ms,
                bandwidth_mbps=spec.bandwidth_mbps,
                reliability=spec.reliability,
            )
            self.link_kind[spec.link_id] = spec.kind
            self.baseline_reliability[spec.link_id] = spec.reliability

        self.positions: Dict[str, Tuple[float, float, float]] = {}
        for sat in scenario.satellites:
            self.positions[sat.id] = (sat.lat, sat.lon, sat.alt_km)
        for gs in scenario.ground_stations:
            self.positions[gs.id] = (gs.lat, gs.lon, 0.0)

        self.buffers = {
            sid: NodeBuffer(node_id=sid, capacity_bytes=scenario.buffer_capacity_bytes) for sid in self.sat_ids
        }
        self.ground = {gid: GroundStationAgent(gid) for gid in self.gs_ids}
        self.packets: Dict[str, Packet] = {}
        self.packet_dtn: Dict[str, bool] = {}
        self.protocol: Dict[str, str] = {sid: "direct" for sid in self.sat_ids}
        self.in_flight: List[InFlight] = []
        self.in_flight_ids: Set[str] = set()
        self.lost_custody: Dict[str, Set[str]] = {sid: set() for sid in self.sat_ids}
        self.direct_lost_ids: Set[str] = set()
        self.tx_free_at: Dict[Tuple[str, str], float] = {}
        self.next_gen_at: Dict[str, float] = {
            sid: round(0.004 + index * 0.003, 6) for index, sid in enumerate(self.sat_ids)
        }
        self.gen_count: Dict[str, int] = {sid: 0 for sid in self.sat_ids}

        det = scenario.detection
        self.windows: Dict[str, Deque[bool]] = {
            lid: deque(maxlen=det.window_size) for lid, kind in self.link_kind.items() if kind == "ground"
        }

        # Failure state. A manual sever overrides the seeded plan.
        self.target_sat = scenario.failure.satellite_id
        self.target_link = scenario.failure.link_id
        self.cause = scenario.failure.cause
        self.severed = False
        self.degrade_started_at: Optional[float] = None
        self._last_reported_reliability: Optional[float] = None
        self.actions: List[Dict[str, Any]] = []

        self.anomaly: Optional[Dict[str, Any]] = None
        self.dtn: Optional[Dict[str, Any]] = None
        self.affected_quota: Optional[int] = None
        self._cf_quota = affected_quota
        self.decisions: List[RouteDecision] = []
        self.routing_before: Optional[List[Dict[str, Any]]] = None

    # ------------------------------------------------------------------ helpers
    @property
    def affected_sat(self) -> str:
        return self.anomaly["satellite_id"] if self.anomaly else self.target_sat

    def ground_link_of(self, sat_id: str) -> Link:
        return self.links[link_id_for(sat_id, self.home_gs[sat_id])]

    def isl_between(self, a: str, b: str) -> Optional[Link]:
        return self.links.get(link_id_for(a, b)) or self.links.get(link_id_for(b, a))

    def isl_neighbors(self, sat_id: str) -> List[str]:
        out: List[str] = []
        for lid, kind in self.link_kind.items():
            if kind != "isl":
                continue
            link = self.links[lid]
            if link.source_node_id == sat_id:
                out.append(link.target_node_id)
            elif link.target_node_id == sat_id:
                out.append(link.source_node_id)
        return sorted(out)

    def _emit(
        self,
        event_type: str,
        message: str,
        *,
        status: Optional[str] = None,
        packet: Optional[Packet] = None,
        source: Optional[str] = None,
        target: Optional[str] = None,
        hop_path: Optional[List[str]] = None,
        link_id: Optional[str] = None,
        node_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        self._seq += 1
        event = {
            "seq": self._seq,
            "run_id": self.run_id,
            "t": round(self.now, 6),
            "type": event_type,
            "phase": self.phase.value,
            "tag": PHASE_TAG[self.phase],
            "status": status,
            "packet_id": packet.packet_id if packet else None,
            "size_bytes": packet.payload_size_bytes if packet else None,
            "source": source,
            "target": target,
            "hop_path": hop_path,
            "link_id": link_id,
            "node_id": node_id,
            "message": message,
            "details": details or {},
        }
        self.events.append(event)
        return event

    def _set_phase(self, phase: Phase, message: str) -> None:
        previous = self.phase
        self.phase = phase
        self._emit("phase_change", message, details={"from": previous.value, "to": phase.value})

    # ------------------------------------------------------------------ controls
    def start(self, run_id: Optional[str] = None) -> None:
        if self.phase != Phase.IDLE:
            raise SimulationActionError(f"Cannot start from {self.phase.value}.")
        if run_id:
            self.run_id = run_id
        self.phase = Phase.STABLE
        self.halted = False
        for sid in self.sat_ids:
            gs = self.home_gs[sid]
            link = self.ground_link_of(sid)
            self.decisions.append(
                RouteDecision(
                    packet_id="ALL",
                    satellite_id=sid,
                    chosen_next_hop_id=gs,
                    decision=DecisionAction.FORWARD,
                    reason_code=DecisionReasonCode.DIRECT_DELIVERY,
                    candidate_scores={
                        gs: CandidateScore(
                            neighbor_id=gs,
                            total_score=round(link.reliability, 4),
                            reliability_score=link.reliability,
                            route_path=[sid, gs],
                            estimated_path_latency_ms=link.latency_ms,
                            estimated_path_hops=1,
                            path_reliability=link.reliability,
                            reason="Ground station in direct contact",
                        )
                    },
                    decision_time=0.0,
                    routing_policy="direct",
                    explanation=f"{sid} downlinks directly to {gs} over {link.link_id}.",
                )
            )
        self.routing_before = self.routing_table()
        self._emit(
            "run_started",
            f"Run started: {len(self.sat_ids)} satellites, {len(self.gs_ids)} ground station(s). "
            "All satellites route direct-to-ground.",
            details={"seed": self.scenario.seed, "scenario_id": self.scenario.scenario_id},
        )
        self._emit("phase_change", "STABLE: nominal direct-to-ground traffic", details={"from": "IDLE", "to": "STABLE"})

    def sever(self, sat_id: str) -> None:
        if self.phase not in (Phase.STABLE, Phase.DEGRADING):
            raise SimulationActionError(f"Sever Link is available only while STABLE or DEGRADING (now {self.phase.value}).")
        if sat_id not in self.sat_ids:
            raise SimulationActionError(f"Unknown satellite '{sat_id}'.")
        if self.severed and sat_id == self.target_sat:
            raise SimulationActionError(f"The {sat_id} ground link is already severed.")

        # Restore the previously targeted link if it had started degrading.
        if self.degrade_started_at is not None and sat_id != self.target_sat:
            old = self.links[self.target_link]
            old.is_available = True
            old.reliability = self.baseline_reliability[old.link_id]
            old.failure_reason = None
            old.last_updated_at = self.now
            self.windows[old.link_id].clear()
            self._emit(
                "link_recovered",
                f"{old.link_id} restored: manual sever moved the failure to {sat_id}",
                link_id=old.link_id,
                node_id=self.target_sat,
                details={"reliability": old.reliability},
            )

        self.target_sat = sat_id
        self.target_link = self.ground_link_of(sat_id).link_id
        self.cause = f"Link severed manually: operator cut {sat_id} to {self.home_gs[sat_id]}"
        self.severed = True
        link = self.links[self.target_link]
        link.is_available = False
        link.reliability = 0.0
        link.failure_reason = self.cause
        link.last_updated_at = self.now
        self.actions.append({"tick": self.tick, "action": "sever", "satellite_id": sat_id})
        self._emit(
            "link_severed",
            f"{link.link_id} severed by operator",
            link_id=link.link_id,
            node_id=sat_id,
            source=sat_id,
            target=self.home_gs[sat_id],
            details={"reliability": 0.0, "cause": self.cause},
        )
        if self.phase == Phase.STABLE:
            self.degrade_started_at = self.now
            self._set_phase(Phase.DEGRADING, f"DEGRADING: {link.link_id} severed")
        else:
            self.degrade_started_at = self.degrade_started_at if self.degrade_started_at is not None else self.now

    def solve(self) -> Dict[str, Any]:
        if self.phase != Phase.DETECTED or not self.anomaly:
            raise SimulationActionError(f"Solve is available only after an anomaly is DETECTED (now {self.phase.value}).")
        sat = self.anomaly["satellite_id"]
        old_path = [sat, self.home_gs[sat]]
        self.phase = Phase.SOLVING
        self.halted = False
        self.protocol[sat] = "dtn"
        decision, relay_id = self._select_relay(sat)
        self.decisions.append(decision)
        if relay_id is None:
            self.dtn = {"satellite_id": sat, "relay_id": None, "path": None, "link_ids": [], "decision": decision.model_dump()}
            self._emit("phase_change", "SOLVING: no reachable relay, bundles held in storage", details={"from": "DETECTED", "to": "SOLVING"})
            return self.dtn

        best = decision.candidate_scores[relay_id]
        path = list(best.route_path or [])
        self.dtn = {
            "satellite_id": sat,
            "relay_id": relay_id,
            "path": path,
            "link_ids": [self._link_for_hop(a, b).link_id for a, b in zip(path, path[1:])],
            "decision": decision.model_dump(),
            "switched_at": round(self.now, 6),
        }
        self._emit("phase_change", f"SOLVING: {sat} switching to delay-tolerant networking", details={"from": "DETECTED", "to": "SOLVING"})
        self._emit(
            "protocol_switch",
            f"{sat} protocol: direct-to-ground -> DTN store-carry-forward",
            node_id=sat,
            details={"from": "direct", "to": "dtn"},
        )
        self._emit(
            "route_change",
            f"{sat} route {' -> '.join(old_path)} replaced by {' -> '.join(path)} (relay {relay_id})",
            node_id=sat,
            hop_path=path,
            details={
                "old_path": old_path,
                "new_path": path,
                "relay_id": relay_id,
                "score": best.total_score,
                "path_reliability": best.path_reliability,
                "path_latency_ms": best.estimated_path_latency_ms,
            },
        )

        # Re-bundle everything the affected satellite still holds, including
        # the custody copies of packets lost on the broken direct link.
        for pid in sorted(self._held_by(sat), key=lambda p: self.packets[p].created_at):
            pkt = self.packets[pid]
            recovered = pid in self.lost_custody[sat]
            self.packet_dtn[pid] = True
            pkt.status = PacketStatus.BUFFERED
            pkt.drop_reason = None
            self._emit(
                "packet",
                f"{pid} {'recovered from custody and ' if recovered else ''}stored as DTN bundle at {sat}",
                status="stored",
                packet=pkt,
                source=pkt.source_node_id,
                target=path[1],
                hop_path=list(pkt.visited_node_ids),
                node_id=sat,
                details={"recovered": recovered},
            )
        self.lost_custody[sat].clear()
        return self.dtn

    def _held_by(self, sat_id: str) -> List[str]:
        return [p.packet_id for p in self.buffers[sat_id].get_eligible_packets(float("-inf"))]

    def _link_for_hop(self, a: str, b: str) -> Link:
        if b in self.ground:
            return self.links[link_id_for(a, b)]
        link = self.isl_between(a, b)
        assert link is not None, f"no link {a}-{b}"
        return link

    def _select_relay(self, sat: str) -> Tuple[RouteDecision, Optional[str]]:
        """Pick the best ISL path to a satellite with a healthy ground link.

        score = 0.7 * path_reliability + 0.3 * (1 - latency / max_latency) - 0.05 * extra_hops
        """
        candidates: List[Tuple[str, List[str], float, float]] = []
        frontier: List[List[str]] = [[sat]]
        seen = {sat}
        while frontier:
            path = frontier.pop(0)
            node = path[-1]
            for nb in self.isl_neighbors(node):
                if nb in seen:
                    continue
                isl = self.isl_between(node, nb)
                if not isl or not isl.is_available:
                    continue
                seen.add(nb)
                new_path = path + [nb]
                ground = self.ground_link_of(nb)
                if ground.is_available and ground.reliability >= RELAY_MIN_GROUND_RELIABILITY:
                    full = new_path + [self.home_gs[nb]]
                    rel = 1.0
                    lat = 0.0
                    for a, b in zip(full, full[1:]):
                        hop = self._link_for_hop(a, b)
                        rel *= hop.reliability
                        lat += hop.latency_ms
                    candidates.append((nb, full, rel, lat))
                if len(new_path) < 4:
                    frontier.append(new_path)

        if not candidates:
            return RouteDecision(
                packet_id="ALL",
                satellite_id=sat,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=DecisionReasonCode.NO_ROUTE,
                decision_time=round(self.now, 6),
                routing_policy="dtn",
                explanation="No ISL path reaches a satellite with a healthy ground link; bundles stay stored.",
            ), None

        max_lat = max(c[3] for c in candidates) or 1.0
        scores: Dict[str, CandidateScore] = {}
        for relay, full, rel, lat in candidates:
            extra_hops = len(full) - 3
            latency_norm = lat / max_lat
            total = RELAY_W_RELIABILITY * rel + RELAY_W_LATENCY * (1 - latency_norm) - RELAY_HOP_PENALTY * extra_hops
            scores[relay] = CandidateScore(
                neighbor_id=full[1],
                total_score=round(total, 4),
                reliability_score=round(rel, 4),
                latency_penalty=round(latency_norm, 4),
                route_path=full,
                estimated_path_latency_ms=round(lat, 1),
                estimated_path_hops=len(full) - 1,
                path_reliability=round(rel, 4),
                reason=f"{relay} has a healthy ground link to {self.home_gs[relay]}",
            )
        best_relay = sorted(scores, key=lambda r: (-scores[r].total_score, r))[0]
        best = scores[best_relay]
        return RouteDecision(
            packet_id="ALL",
            satellite_id=sat,
            chosen_next_hop_id=best.neighbor_id,
            decision=DecisionAction.FORWARD,
            reason_code=DecisionReasonCode.BEST_SCORE,
            candidate_scores=scores,
            decision_time=round(self.now, 6),
            routing_policy="dtn",
            explanation=(
                f"Relay {best_relay} chosen: path {' -> '.join(best.route_path or [])}, "
                f"reliability {best.path_reliability:.3f}, latency {best.estimated_path_latency_ms} ms."
            ),
        ), best_relay

    # ------------------------------------------------------------------ stepping
    def step(self) -> List[Dict[str, Any]]:
        """Advance one tick. Returns the events produced in this tick."""
        if self.halted:
            return []
        start = len(self.events)
        self._apply_actions_for_tick()
        self.tick += 1
        t = round(self.tick * self.dt, 6)

        due = sorted((f for f in self.in_flight if f.arrive <= t + EPS), key=lambda f: (f.arrive, f.packet_id))
        for flight in due:
            self.now = flight.arrive
            self._complete(flight)
            if self.halted:
                return self.events[start:]

        self.now = t
        if self.phase == Phase.STABLE and t >= self.scenario.stable_duration_s - EPS:
            self._begin_auto_degradation()
        self._apply_link_dynamics()
        self._generate()
        self._dispatch()
        self._check_resolved()
        return self.events[start:]

    def _apply_actions_for_tick(self) -> None:
        """Hook for counterfactual replays: apply recorded actions at the same tick."""
        replay = getattr(self, "_replay_actions", None)
        if not replay:
            return
        while replay and replay[0]["tick"] == self.tick:
            action = replay.pop(0)
            if action["action"] == "sever" and self.phase in (Phase.STABLE, Phase.DEGRADING):
                self.sever(action["satellite_id"])

    def _begin_auto_degradation(self) -> None:
        if self.severed or self.degrade_started_at is not None:
            return
        self.degrade_started_at = self.now
        link = self.links[self.target_link]
        link.failure_reason = self.cause
        self._set_phase(Phase.DEGRADING, f"DEGRADING: topology change on {link.link_id}")
        self._emit(
            "link_degraded",
            f"{link.link_id} degrading: {self.cause}",
            link_id=link.link_id,
            node_id=self.target_sat,
            source=self.target_sat,
            target=self.home_gs[self.target_sat],
            details={"reliability": link.reliability, "cause": self.cause, "pattern": self.scenario.failure.pattern},
        )
        self._last_reported_reliability = link.reliability

    def _degraded_reliability(self, elapsed: float) -> float:
        plan = self.scenario.failure
        r0 = self.baseline_reliability[plan.link_id]
        floor = plan.floor_reliability
        ramp = plan.ramp_seconds
        if plan.pattern == "ramp":
            return r0 - (r0 - floor) * min(1.0, elapsed / ramp)
        if plan.pattern == "burst":
            if elapsed < ramp / 2:
                return 0.4
            return floor
        # flapping: alternate good/bad with a shrinking good level, then settle low
        if elapsed >= ramp * 2:
            return floor
        bad = int(elapsed / plan.flap_period_seconds) % 2 == 1
        good_level = max(floor, 0.85 - 0.6 * (elapsed / (ramp * 2)))
        return floor if bad else good_level

    def _apply_link_dynamics(self) -> None:
        if self.degrade_started_at is None or self.severed:
            return
        # Live runs freeze the broken link once detected; the no-DTN replay keeps degrading.
        if not (self.phase == Phase.DEGRADING or (self.phase == Phase.DETECTED and not self.dtn_enabled)):
            return
        elapsed = self.now - self.degrade_started_at
        link = self.links[self.target_link]
        reliability = round(max(0.0, min(1.0, self._degraded_reliability(elapsed))), 3)
        link.reliability = reliability
        link.last_updated_at = self.now
        if self._last_reported_reliability is None or abs(reliability - self._last_reported_reliability) >= 0.1:
            self._last_reported_reliability = reliability
            self._emit(
                "link_degraded",
                f"{link.link_id} reliability {reliability:.2f}",
                link_id=link.link_id,
                node_id=self.target_sat,
                details={"reliability": reliability, "cause": self.cause},
            )

        plan = self.scenario.failure
        if plan.drift_deg_per_s and self.target_sat == plan.satellite_id:
            spec = self.sat_spec[self.target_sat]
            distance = min(MAX_DRIFT_DEG, plan.drift_deg_per_s * elapsed)
            lat, lon = destination(spec.lat, spec.lon, plan.drift_bearing_deg, distance)
            self.positions[self.target_sat] = (lat, lon, spec.alt_km)

    def _may_generate(self, sat: str) -> bool:
        if self.phase in (Phase.IDLE, Phase.RESOLVED):
            return False
        if self.phase == Phase.DETECTED and self.dtn_enabled:
            return False
        quota = self.affected_quota
        affected = self.affected_sat
        if quota is not None:
            if sat == affected:
                return self.gen_count[sat] < quota
            return self.gen_count[affected] < quota
        return True

    def _generate(self) -> None:
        for sat in self.sat_ids:
            if not self._may_generate(sat):
                continue
            if self.next_gen_at[sat] > self.now + EPS:
                continue
            spec = self.sat_spec[sat]
            index = self.gen_count[sat]
            created = self.next_gen_at[sat]
            self.next_gen_at[sat] = round(created + spec.traffic_interval_s, 6)
            self.gen_count[sat] = index + 1
            gs = self.home_gs[sat]
            pkt = Packet(
                packet_id=f"PKT-{sat}-{index + 1:04d}",
                source_node_id=sat,
                destination_node_id=gs,
                created_at=round(created, 6),
                expires_at=None,
                payload_size_bytes=spec.payload_sizes[index % len(spec.payload_sizes)],
                current_node_id=sat,
                visited_node_ids=[sat],
                route_history=[RouteHop(node_id=sat, entered_at=round(created, 6), action="created")],
            )
            admitted, reason, _ = self.buffers[sat].admit(pkt, self.now)
            self.packets[pkt.packet_id] = pkt
            self.packet_dtn[pkt.packet_id] = self.protocol[sat] == "dtn"
            if not admitted:
                pkt.status = PacketStatus.DROPPED
                pkt.drop_reason = reason
                self._emit("packet", f"{pkt.packet_id} rejected at {sat}: {reason}", status="lost", packet=pkt,
                           source=sat, target=gs, hop_path=[sat], node_id=sat, details={"reason": reason})
                continue
            if self.packet_dtn[pkt.packet_id]:
                self._emit(
                    "packet",
                    f"{pkt.packet_id} created and stored as DTN bundle at {sat}",
                    status="stored",
                    packet=pkt,
                    source=sat,
                    target=self.dtn["path"][1] if self.dtn and self.dtn.get("path") else None,
                    hop_path=[sat],
                    node_id=sat,
                )

    def _next_hop(self, sat: str, pid: str) -> Tuple[Optional[Link], str]:
        if self.packet_dtn.get(pid):
            if not self.dtn or not self.dtn.get("path"):
                return None, "dtn"
            path = self.dtn["path"]
            if sat not in path[:-1]:
                return None, "dtn"
            nxt = path[path.index(sat) + 1]
            return self._link_for_hop(sat, nxt), "dtn"
        return self.ground_link_of(sat), "direct"

    def _dispatch(self) -> None:
        if self.phase == Phase.DETECTED and self.dtn_enabled:
            return
        for sat in self.sat_ids:
            for pkt in self.buffers[sat].get_eligible_packets(self.now):
                pid = pkt.packet_id
                if pid in self.in_flight_ids or pid in self.lost_custody[sat]:
                    continue
                link, mode = self._next_hop(sat, pid)
                if link is None:
                    continue
                key = (link.link_id, sat)
                if self.tx_free_at.get(key, -1.0) > self.now + EPS:
                    continue
                if mode == "dtn" and not link.is_available:
                    continue  # DTN holds the bundle until the contact is usable
                target = link.target_node_id if link.source_node_id == sat else link.source_node_id
                serialization = (pkt.payload_size_bytes * 8.0) / (link.bandwidth_mbps * 1_000_000.0)
                arrive = round(self.now + serialization + link.latency_ms / 1000.0, 6)
                self.tx_free_at[key] = self.now + serialization
                flight = InFlight(pid, link.link_id, sat, target, round(self.now, 6), arrive, mode)
                self.in_flight.append(flight)
                self.in_flight_ids.add(pid)
                pkt.status = PacketStatus.IN_TRANSIT
                path = list(pkt.visited_node_ids) + [target]
                if mode == "direct":
                    msg = f"{pid} sent {sat} -> {target} over {link.link_id}"
                    status = "sent"
                else:
                    msg = f"{pid} forwarded {sat} -> {target} over {link.link_id} (DTN)"
                    status = "forwarded"
                self._emit("packet", msg, status=status, packet=pkt, source=pkt.source_node_id, target=target,
                           hop_path=path, link_id=link.link_id, node_id=sat,
                           details={"mode": mode, "depart": flight.depart, "arrive": flight.arrive})

    def _complete(self, flight: InFlight) -> None:
        self.in_flight.remove(flight)
        self.in_flight_ids.discard(flight.packet_id)
        pkt = self.packets[flight.packet_id]
        link = self.links[flight.link_id]
        roll = self.rng.random()
        success = link.is_available and roll < link.reliability
        sender = flight.source
        path = list(pkt.visited_node_ids) + [flight.target]

        if success:
            self.buffers[sender].remove(pkt.packet_id)
            pkt.hop_count += 1
            if flight.target not in pkt.visited_node_ids:
                pkt.visited_node_ids.append(flight.target)
            if flight.target in self.ground:
                self.ground[flight.target].receive_packet(pkt, self.now)
                via = pkt.visited_node_ids[-2] if len(pkt.visited_node_ids) >= 3 else None
                self._emit(
                    "packet",
                    f"{pkt.packet_id} delivered to {flight.target}" + (f" via {via} (DTN)" if flight.mode == "dtn" else ""),
                    status="delivered",
                    packet=pkt,
                    source=pkt.source_node_id,
                    target=flight.target,
                    hop_path=list(pkt.visited_node_ids),
                    link_id=link.link_id,
                    node_id=flight.target,
                    details={
                        "mode": flight.mode,
                        "latency_ms": round((self.now - pkt.created_at) * 1000.0, 2),
                        "hops": pkt.hop_count,
                        "recovered": pkt.packet_id in self.direct_lost_ids,
                    },
                )
            else:
                pkt.route_history.append(RouteHop(node_id=flight.target, entered_at=self.now, link_id=link.link_id, action="forward"))
                admitted, reason, _ = self.buffers[flight.target].admit(pkt, self.now)
                if admitted:
                    self._emit("packet", f"{pkt.packet_id} stored at relay {flight.target} (custody accepted)",
                               status="stored", packet=pkt, source=pkt.source_node_id, target=flight.target,
                               hop_path=list(pkt.visited_node_ids), link_id=link.link_id, node_id=flight.target,
                               details={"mode": "dtn", "custody": True})
                else:
                    pkt.status = PacketStatus.DROPPED
                    pkt.drop_reason = reason
                    self._emit("packet", f"{pkt.packet_id} refused by {flight.target}: {reason}", status="lost",
                               packet=pkt, source=pkt.source_node_id, target=flight.target, hop_path=path,
                               link_id=link.link_id, node_id=flight.target, details={"reason": reason})
        elif flight.mode == "direct":
            pkt.status = PacketStatus.DROPPED
            pkt.drop_reason = DropReason.LINK_FAILURE.value
            self.lost_custody[sender].add(pkt.packet_id)
            self.direct_lost_ids.add(pkt.packet_id)
            reason = link.failure_reason or "transmission failed"
            self._emit("packet", f"{pkt.packet_id} lost on {link.link_id}", status="lost", packet=pkt,
                       source=pkt.source_node_id, target=flight.target, hop_path=path, link_id=link.link_id,
                       node_id=sender, details={"mode": "direct", "reason": reason, "reliability": link.reliability})
            if self.protocol[sender] == "dtn":
                # Sent before the protocol switch; the custody copy joins the DTN queue at once.
                self.lost_custody[sender].discard(pkt.packet_id)
                self.packet_dtn[pkt.packet_id] = True
                pkt.status = PacketStatus.BUFFERED
                pkt.drop_reason = None
                self._emit("packet", f"{pkt.packet_id} recovered from custody and stored as DTN bundle at {sender}",
                           status="stored", packet=pkt, source=pkt.source_node_id,
                           target=self.dtn["path"][1] if self.dtn and self.dtn.get("path") else None,
                           hop_path=list(pkt.visited_node_ids), node_id=sender, details={"recovered": True})
        else:
            # DTN handoff failed: custody stays with the sender, which retries.
            pkt.status = PacketStatus.BUFFERED
            self._emit("packet", f"{pkt.packet_id} handoff to {flight.target} failed; custody retained at {sender}",
                       status="stored", packet=pkt, source=pkt.source_node_id, target=flight.target,
                       hop_path=list(pkt.visited_node_ids), link_id=link.link_id, node_id=sender,
                       details={"mode": "dtn", "retry": True})

        if flight.mode == "direct" and link.link_id in self.windows:
            self.windows[link.link_id].append(not success)
            self._check_detection(link.link_id)

    def _check_detection(self, link_id: str) -> None:
        if self.anomaly is not None or self.phase not in (Phase.STABLE, Phase.DEGRADING):
            return
        det = self.scenario.detection
        window = self.windows[link_id]
        if len(window) < det.min_samples:
            return
        losses = sum(1 for lost in window if lost)
        rate = losses / len(window)
        if rate < det.loss_threshold:
            return
        link = self.links[link_id]
        sat = link.source_node_id
        cause = link.failure_reason or "Unexplained loss on the downlink"
        self.anomaly = {
            "satellite_id": sat,
            "link_id": link_id,
            "ground_station_id": link.target_node_id,
            "loss_rate": round(rate, 4),
            "window_losses": losses,
            "window_size": len(window),
            "threshold": det.loss_threshold,
            "probable_cause": cause,
            "detected_at": round(self.now, 6),
            "packets_generated_before": self.gen_count[sat],
        }
        previous = self.phase
        self.phase = Phase.DETECTED
        self._emit(
            "anomaly_detected",
            f"Anomaly on {link_id}: {losses}/{len(window)} recent transmissions lost ({rate:.0%}). Probable cause: {cause}",
            link_id=link_id,
            node_id=sat,
            source=sat,
            target=link.target_node_id,
            details=dict(self.anomaly),
        )
        if self.dtn_enabled:
            # The bundle count is fixed now: what was generated so far plus the post-solve tail.
            self.affected_quota = self.gen_count[sat] + self.scenario.post_solve_bundles
            self.halted = True
            self._emit("phase_change", "DETECTED: simulation paused, awaiting Solve", details={"from": previous.value, "to": "DETECTED"})
        elif self._cf_quota is not None:
            self.affected_quota = self._cf_quota

    def affected_packets(self) -> List[Packet]:
        sat = self.affected_sat
        return [p for p in self.packets.values() if p.source_node_id == sat]

    def _check_resolved(self) -> None:
        if self.phase != Phase.SOLVING or self.affected_quota is None:
            return
        sat = self.affected_sat
        if self.gen_count[sat] < self.affected_quota:
            return
        own = self.affected_packets()
        delivered = sum(1 for p in own if p.status == PacketStatus.DELIVERED)
        if delivered < len(own) or self.in_flight:
            return
        relay = self.dtn["relay_id"] if self.dtn else None
        self.phase = Phase.RESOLVED
        self.halted = True
        self._emit(
            "run_resolved",
            f"{delivered}/{len(own)} bundles delivered via {relay}",
            node_id=relay,
            details={"delivered": delivered, "total": len(own), "relay_id": relay, "satellite_id": sat},
        )

    # ------------------------------------------------------------------ views
    def link_state(self, link: Link) -> str:
        if not link.is_available:
            return "down"
        if link.reliability < 0.8:
            return "degraded"
        return "active"

    def window_loss(self, link_id: str) -> Optional[float]:
        window = self.windows.get(link_id)
        if not window:
            return None
        return round(sum(1 for lost in window if lost) / len(window), 4)

    def links_view(self) -> List[Dict[str, Any]]:
        anomaly_link = self.anomaly["link_id"] if self.anomaly else None
        dtn_links = set(self.dtn.get("link_ids") or []) if self.dtn else set()
        out = []
        for lid, link in self.links.items():
            role = "anomaly" if lid == anomaly_link else "dtn" if lid in dtn_links else None
            out.append(
                {
                    **link.model_dump(),
                    "kind": self.link_kind[lid],
                    "state": self.link_state(link),
                    "loss_rate": self.window_loss(lid),
                    "role": role,
                }
            )
        return out

    def nodes_view(self) -> List[Dict[str, Any]]:
        affected = self.anomaly["satellite_id"] if self.anomaly else None
        relay = self.dtn.get("relay_id") if self.dtn else None
        out = []
        for sid in self.sat_ids:
            lat, lon, alt = self.positions[sid]
            buf = self.buffers[sid]
            out.append(
                {
                    "id": sid,
                    "kind": "satellite",
                    "lat": lat,
                    "lon": lon,
                    "alt_km": alt,
                    "ground_station_id": self.home_gs[sid],
                    "protocol": self.protocol[sid],
                    "buffer_used_bytes": buf.used_bytes,
                    "buffer_capacity_bytes": buf.capacity_bytes,
                    "stored_count": buf.packet_count,
                    "role": "affected" if sid == affected else "relay" if sid == relay else None,
                }
            )
        for gid in self.gs_ids:
            lat, lon, _ = self.positions[gid]
            agent = self.ground[gid]
            out.append(
                {
                    "id": gid,
                    "kind": "ground",
                    "lat": lat,
                    "lon": lon,
                    "alt_km": 0.0,
                    "received_count": len(agent.received_packets),
                    "bytes_received": agent.total_bytes_received,
                    "role": None,
                }
            )
        return out

    def in_flight_view(self) -> List[Dict[str, Any]]:
        return [
            {
                "packet_id": f.packet_id,
                "link_id": f.link_id,
                "source": f.source,
                "target": f.target,
                "depart": f.depart,
                "arrive": f.arrive,
                "mode": f.mode,
            }
            for f in sorted(self.in_flight, key=lambda item: item.depart)
        ]

    def routing_table(self) -> List[Dict[str, Any]]:
        rows = []
        relay_for: Dict[str, List[str]] = {}
        if self.dtn and self.dtn.get("relay_id"):
            relay_for.setdefault(self.dtn["relay_id"], []).append(self.dtn["satellite_id"])
        for sid in self.sat_ids:
            ground = self.ground_link_of(sid)
            if self.protocol[sid] == "dtn":
                path = list(self.dtn["path"]) if self.dtn and self.dtn.get("path") else [sid]
                next_hop = path[1] if len(path) > 1 else None
                reason = "BEST_SCORE" if next_hop else "NO_ROUTE"
                note = "Store-carry-forward over ISL" if next_hop else "Bundles held in storage"
            else:
                path = [sid, self.home_gs[sid]]
                next_hop = self.home_gs[sid]
                reason = "DIRECT_DELIVERY"
                note = "Direct downlink"
            rows.append(
                {
                    "satellite_id": sid,
                    "protocol": self.protocol[sid],
                    "next_hop": next_hop,
                    "path": path,
                    "reason_code": reason,
                    "note": note,
                    "ground_link_id": ground.link_id,
                    "ground_link_state": self.link_state(ground),
                    "ground_link_reliability": ground.reliability,
                    "ground_link_loss_rate": self.window_loss(ground.link_id),
                    "relay_for": relay_for.get(sid, []),
                    "stored_count": self.buffers[sid].packet_count,
                }
            )
        return rows

    def affected_stats(self) -> Optional[Dict[str, Any]]:
        if not self.anomaly:
            return None
        own = self.affected_packets()
        delivered = [p for p in own if p.status == PacketStatus.DELIVERED]
        lost_direct = sum(1 for p in own if p.packet_id in self.direct_lost_ids)
        recovered = sum(1 for p in delivered if p.packet_id in self.direct_lost_ids)
        still_lost = sum(1 for p in own if p.status == PacketStatus.DROPPED)
        latencies = [(p.delivery_time - p.created_at) * 1000.0 for p in delivered if p.delivery_time is not None]
        hops = [p.hop_count for p in delivered]
        total = len(own)
        return {
            "satellite_id": self.affected_sat,
            "total": total,
            "delivered": len(delivered),
            "lost": lost_direct,
            "unrecovered": still_lost,
            "recovered": recovered,
            "delivery_ratio": round(len(delivered) / total, 4) if total else 0.0,
            "mean_latency_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
            "max_latency_ms": round(max(latencies), 2) if latencies else None,
            "mean_hops": round(sum(hops) / len(hops), 2) if hops else None,
            "via_relay": sum(1 for p in delivered if p.hop_count >= 2),
        }

    def metrics(self) -> Dict[str, Any]:
        generated = len(self.packets)
        delivered = [p for p in self.packets.values() if p.status == PacketStatus.DELIVERED]
        delays = sorted((p.delivery_time - p.created_at) * 1000.0 for p in delivered if p.delivery_time is not None)
        stored = sum(b.packet_count for b in self.buffers.values())
        lost_now = sum(1 for p in self.packets.values() if p.status == PacketStatus.DROPPED)
        return {
            "packets_generated": generated,
            "packets_delivered": len(delivered),
            "packets_lost_direct": len(self.direct_lost_ids),
            "packets_unrecovered": lost_now,
            "packets_stored": stored,
            "packets_in_transit": len(self.in_flight),
            "delivery_ratio": round(len(delivered) / generated, 4) if generated else 0.0,
            "mean_delay_ms": round(sum(delays) / len(delays), 2) if delays else 0.0,
            "p95_delay_ms": round(delays[min(len(delays) - 1, int(0.95 * len(delays)))], 2) if delays else 0.0,
            "mean_hop_count": round(sum(p.hop_count for p in delivered) / len(delivered), 2) if delivered else 0.0,
            "total_bytes_delivered": sum(p.payload_size_bytes for p in delivered),
        }


def new_run_id() -> str:
    return f"RUN-{uuid.uuid4().hex[:10].upper()}"


def run_counterfactual(scenario: FlowScenario, actions: List[Dict[str, Any]], quota: int, max_ticks: int = 40000) -> FlowEngine:
    """Replay the same seed and operator actions with DTN disabled.

    The replay is identical to the live run up to the detection point (same
    seed, same actions at the same ticks). After that it keeps the affected
    satellite on direct-to-ground until it has generated ``quota`` packets,
    the same bundle count the live run delivered via DTN.
    """
    engine = FlowEngine(scenario, dtn_enabled=False, affected_quota=quota)
    engine._replay_actions = [dict(a) for a in sorted(actions, key=lambda a: a["tick"])]  # type: ignore[attr-defined]
    engine.start()
    for _ in range(max_ticks):
        engine.step()
        if engine.anomaly is None:
            continue
        sat = engine.affected_sat
        if engine.gen_count[sat] < quota:
            continue
        pending = [pid for pid in engine._held_by(sat) if pid not in engine.lost_custody[sat]]
        if not pending and not engine.in_flight:
            break
    return engine


def comparison_from(live: FlowEngine, counterfactual: Optional[FlowEngine]) -> Optional[Dict[str, Any]]:
    with_dtn = live.affected_stats()
    if with_dtn is None:
        return None
    direct = counterfactual.affected_stats() if counterfactual else None
    return {
        "satellite_id": with_dtn["satellite_id"],
        "relay_id": live.dtn.get("relay_id") if live.dtn else None,
        "final": live.phase == Phase.RESOLVED,
        "direct_only": direct,
        "with_dtn": with_dtn,
        "method": (
            "Direct-only is a deterministic replay of this run's seed and operator actions with "
            "Solve never pressed: the affected satellite keeps transmitting over its broken ground "
            "link until it has sent the same number of packets. With-DTN is the live run."
        ),
    }
