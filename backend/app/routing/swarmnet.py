"""SWARMNET contact-aware autonomous routing policy.

Each satellite evaluates its currently active neighbours using the shared
contact plan and asks two questions:

1. Can this neighbour reach the destination over a contact-feasible route,
   including contacts that have not opened yet?
2. If so, when would the packet actually arrive, and is that better than simply
   keeping the packet in the local store-and-forward buffer?

Candidates that cannot reach the destination are explicitly rejected instead of
being rewarded for geometric proximity.  A candidate whose predicted arrival is
later than waiting at the current node is only used to relieve local buffer
pressure; otherwise the packet stays in the local buffer.  A candidate that is
already full and whose onward route needs a contact window that has not opened
yet is also skipped while the local buffer has room: the receiver admits
arrivals before it drains, so forwarding would evict a stored packet.  That is
the behaviour that keeps packets out of dead-end partitions without refusing
useful moves into downstream storage before a blackout.
"""

from typing import Dict, List, Optional, Tuple

from app.routing.base import RoutingPolicy
from app.routing.path_estimator import (
    RouteEstimate,
    align_to_decision_time,
    empty_route,
    find_route,
)
from app.routing.scoring import compute_candidate_score
from app.models.scenario import RoutingWeights
from app.models.packet import Packet
from app.models.link import Link
from app.models.decision import (
    RouteDecision,
    DecisionAction,
    DecisionReasonCode,
    CandidateScore,
)
from app.simulation.topology import TopologyManager
from app.buffering.buffer import NodeBuffer


# When the local buffer is at least this full, a candidate that arrives later
# than waiting may still be used to move traffic off this node.
LOCAL_PRESSURE_RELIEF_THRESHOLD = 0.75


class SwarmnetRoutingPolicy(RoutingPolicy):
    def __init__(
        self,
        weights: Optional[RoutingWeights] = None,
        decision_interval_seconds: float = 1.0,
    ):
        self.weights = weights if weights is not None else RoutingWeights()
        self.decision_interval_seconds = max(1e-6, decision_interval_seconds)
        # Route estimates are topology-dependent and shared by every packet at
        # the same node during a tick.  Cache them for that tick only.
        self._cache_time: Optional[float] = None
        self._route_cache: Dict[
            Tuple[str, str, int, float, Tuple[str, ...]],
            Optional[RouteEstimate],
        ] = {}
        # Bytes already promised to a candidate during the current tick.  Node
        # buffer counters only synchronise at the end of a tick, so without
        # this a burst could over-commit the same downstream buffer.
        self._tick_reservations: Dict[str, int] = {}

    @property
    def name(self) -> str:
        return "swarmnet"

    def _reset_tick_state_if_needed(self, current_time: float) -> None:
        if self._cache_time is None or abs(self._cache_time - current_time) > 1e-9:
            self._route_cache.clear()
            self._tick_reservations.clear()
            self._cache_time = current_time

    def _estimate_route(
        self,
        topology: TopologyManager,
        source_id: str,
        destination_id: str,
        start_time: float,
        payload_size_bytes: int,
        blocked_nodes: frozenset[str],
    ) -> Optional[RouteEstimate]:
        if source_id == destination_id:
            return empty_route(destination_id, start_time)
        key = (
            source_id,
            destination_id,
            payload_size_bytes,
            round(start_time, 6),
            tuple(sorted(blocked_nodes)),
        )
        if key in self._route_cache:
            return self._route_cache[key]
        route = find_route(
            topology=topology,
            source_id=source_id,
            target_id=destination_id,
            current_time=start_time,
            payload_size_bytes=payload_size_bytes,
            decision_interval_seconds=self.decision_interval_seconds,
            allow_future_contacts=True,
            blocked_nodes=blocked_nodes,
        )
        self._route_cache[key] = route
        return route

    def _local_buffer_pressure(
        self,
        current_node_id: str,
        topology: TopologyManager,
        local_buffer: Optional[NodeBuffer],
    ) -> Tuple[float, int]:
        """Return (used/capacity, free bytes) for the current node."""
        if local_buffer is not None:
            used = local_buffer.used_bytes
            capacity = local_buffer.capacity_bytes
        else:
            satellite = topology.satellites.get(current_node_id)
            if satellite is None or satellite.buffer_capacity_bytes <= 0:
                return 0.0, 0
            used = satellite.buffer_used_bytes
            capacity = satellite.buffer_capacity_bytes
        pressure = min(1.0, used / max(1, capacity))
        return pressure, max(0, capacity - used)

    def evaluate_next_hop(
        self,
        current_node_id: str,
        packet: Packet,
        topology: TopologyManager,
        current_time: float,
        local_buffer: Optional[NodeBuffer] = None,
    ) -> RouteDecision:
        self._reset_tick_state_if_needed(current_time)

        outgoing_links = topology.get_outgoing_links(current_node_id, active_only=True)
        if not outgoing_links:
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=DecisionReasonCode.NO_ROUTE,
                decision_time=current_time,
                routing_policy=self.name,
                explanation=(
                    "No active outgoing links from this satellite; retaining packet "
                    "in the store-and-forward buffer until topology changes."
                ),
            )

        # Any node the packet has already traversed is excluded from route
        # estimates, so a candidate cannot be selected via a path that would
        # immediately need to revisit the packet's own history.  The current
        # node and destination are exempt from the reference search because the
        # packet is already here and the destination must remain reachable.
        blocked_for_reference = frozenset(
            node_id
            for node_id in packet.visited_node_ids
            if node_id not in (current_node_id, packet.destination_node_id)
        )
        # Candidate routes additionally block the current node so the packet
        # cannot be handed straight back where it came from.
        blocked_for_candidates = frozenset(
            set(packet.visited_node_ids) | {current_node_id}
        ) - {packet.destination_node_id}

        reference_route = self._estimate_route(
            topology=topology,
            source_id=current_node_id,
            destination_id=packet.destination_node_id,
            start_time=current_time,
            payload_size_bytes=packet.payload_size_bytes,
            blocked_nodes=blocked_for_reference,
        )

        local_pressure, local_free_bytes = self._local_buffer_pressure(
            current_node_id, topology, local_buffer
        )

        candidate_scores: Dict[str, CandidateScore] = {}
        feasible: List[Tuple[str, Link, RouteEstimate, float, float]] = []
        contact_blocked_count = 0
        dead_end_count = 0
        buffer_wait_blocked_count = 0

        for link in outgoing_links:
            candidate_id = link.target_node_id

            # Loop prevention: do not revisit an intermediate node.
            if (
                candidate_id in packet.visited_node_ids
                and candidate_id != packet.destination_node_id
            ):
                candidate_scores[candidate_id] = CandidateScore(
                    neighbor_id=candidate_id,
                    total_score=-100.0,
                    link_available=True,
                    reason="Node already visited in route history (loop prevention)",
                )
                continue

            first_hop_transfer = link.transfer_time_seconds(
                packet.payload_size_bytes
            )
            # Match the transport's arrival rounding.
            first_hop_arrival = round(current_time + first_hop_transfer, 4)
            if (
                link.contact_end_time is not None
                and first_hop_arrival > link.contact_end_time + 1e-9
            ):
                contact_blocked_count += 1
                candidate_scores[candidate_id] = CandidateScore(
                    neighbor_id=candidate_id,
                    total_score=-999.0,
                    link_available=link.is_available,
                    estimated_remaining_contact_sec=round(
                        max(0.0, link.contact_end_time - current_time), 4
                    ),
                    reason=(
                        "Contact window closes before the packet can be "
                        "serialised onto the link"
                    ),
                )
                continue

            # The receiving node can only make its next forwarding decision at
            # the next simulation tick.  Starting the downstream search at that
            # tick prevents selecting a route whose next contact closes in the
            # gap between arrival and the receiver's decision time.
            route_start_time = align_to_decision_time(
                first_hop_arrival, self.decision_interval_seconds
            )
            route = self._estimate_route(
                topology=topology,
                source_id=candidate_id,
                destination_id=packet.destination_node_id,
                start_time=route_start_time,
                payload_size_bytes=packet.payload_size_bytes,
                blocked_nodes=blocked_for_candidates,
            )

            if route is None:
                dead_end_count += 1
                candidate_scores[candidate_id] = CandidateScore(
                    neighbor_id=candidate_id,
                    total_score=-999.0,
                    link_available=link.is_available,
                    reason=(
                        "No contact-feasible path from this candidate to the "
                        "destination (dead-end partition)"
                    ),
                )
                continue

            # Direct delivery completes when the first hop lands.  For an
            # intermediate candidate, the downstream route starts at its
            # tick-aligned decision time.
            candidate_arrival = (
                first_hop_arrival
                if candidate_id == packet.destination_node_id
                else route.arrival_time
            )

            # If the candidate's buffer is already full and its onward route
            # needs a contact window that has not opened yet, admitting the
            # packet would evict an existing packet before the candidate can
            # drain.  Keep it locally while the local buffer has headroom.
            # The window-start test is relative to the sending node's time,
            # not the candidate's decision tick: a window that opens on that
            # tick still means the packet is stored before it can leave.
            if candidate_id != packet.destination_node_id:
                candidate_satellite = topology.satellites.get(candidate_id)
                if (
                    candidate_satellite is not None
                    and candidate_satellite.buffer_capacity_bytes > 0
                    and candidate_satellite.buffer_used_bytes
                    + packet.payload_size_bytes
                    > candidate_satellite.buffer_capacity_bytes
                    and route.first_window_start is not None
                    and route.first_window_start > current_time + 1e-9
                    and local_pressure < LOCAL_PRESSURE_RELIEF_THRESHOLD
                    and local_free_bytes >= packet.payload_size_bytes
                ):
                    buffer_wait_blocked_count += 1
                    candidate_scores[candidate_id] = CandidateScore(
                        neighbor_id=candidate_id,
                        total_score=-500.0,
                        link_available=link.is_available,
                        estimated_remaining_contact_sec=(
                            round(
                                max(
                                    0.0,
                                    link.contact_end_time - current_time,
                                ),
                                4,
                            )
                            if link.contact_end_time is not None
                            else None
                        ),
                        route_path=route.path,
                        estimated_path_latency_ms=round(
                            link.latency_ms + route.total_latency_ms, 4
                        ),
                        estimated_path_hops=1 + route.hop_count,
                        path_reliability=round(
                            link.reliability * route.reliability, 4
                        ),
                        reason=(
                            "Candidate buffer is full and cannot drain before "
                            "this packet would need storage; keeping packet "
                            "locally"
                        ),
                    )
                    continue

            feasible.append(
                (
                    candidate_id,
                    link,
                    route,
                    candidate_arrival,
                    link.latency_ms + route.total_latency_ms,
                )
            )

        # The reference route is the earliest arrival achievable from the
        # current node.  Candidates within one decision interval of it are
        # considered; gross detours are only used to relieve local pressure.
        if reference_route is not None:
            reference_arrival = reference_route.arrival_time
            acceptance_deadline = (
                reference_arrival + self.decision_interval_seconds
            )
        else:
            reference_arrival = None
            acceptance_deadline = None

        acceptable = [
            item
            for item in feasible
            if acceptance_deadline is None
            or item[3] <= acceptance_deadline + 1e-9
        ]
        pressure_relief = (
            local_pressure >= LOCAL_PRESSURE_RELIEF_THRESHOLD
            or local_free_bytes < packet.payload_size_bytes
        )
        selected_pool = acceptable
        if not selected_pool and feasible and pressure_relief:
            selected_pool = feasible

        if not feasible:
            reason_code = (
                DecisionReasonCode.CONTACT_ENDING
                if contact_blocked_count
                else DecisionReasonCode.NO_ROUTE
            )
            explanation_parts = [
                (
                    "No candidate currently offers a contact-feasible route to "
                    f"{packet.destination_node_id}."
                )
            ]
            if dead_end_count:
                explanation_parts.append(
                    f"{dead_end_count} candidate(s) lead into dead-end partitions "
                    "and were rejected."
                )
            if contact_blocked_count:
                explanation_parts.append(
                    (
                        "At least one path exists but its contacts cannot carry "
                        "the packet before closing."
                    )
                )
            if buffer_wait_blocked_count:
                explanation_parts.append(
                    f"{buffer_wait_blocked_count} candidate(s) had a full "
                    "buffer with no room for this packet."
                )
            explanation_parts.append(
                "Retaining packet in the store-and-forward buffer."
            )
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=reason_code,
                candidate_scores=candidate_scores,
                decision_time=current_time,
                routing_policy=self.name,
                explanation=" ".join(explanation_parts),
            )

        selected_ids = {item[0] for item in selected_pool}

        if not selected_pool:
            # A feasible route exists, but waiting at the current node is
            # predicted to deliver earlier and the local buffer still has room.
            for item in feasible:
                candidate_id = item[0]
                if candidate_id in candidate_scores:
                    continue
                candidate_scores[candidate_id] = CandidateScore(
                    neighbor_id=candidate_id,
                    total_score=-500.0,
                    link_available=item[1].is_available,
                    route_path=item[2].path,
                    estimated_path_latency_ms=round(
                        item[1].latency_ms + item[2].total_latency_ms, 4
                    ),
                    estimated_path_hops=1 + item[2].hop_count,
                    path_reliability=round(
                        item[1].reliability * item[2].reliability, 4
                    ),
                    reason=(
                        f"Predicted arrival {item[3]:.2f}s is later than "
                        f"staying at {current_node_id} "
                        f"({reference_arrival:.2f}s)" if reference_arrival is not None
                        else "Predicted arrival is later than staying at the current node"
                    ),
                )
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=DecisionReasonCode.NO_ROUTE,
                candidate_scores=candidate_scores,
                decision_time=current_time,
                routing_policy=self.name,
                explanation=(
                    "A contact-feasible route exists, but every candidate would "
                    f"deliver later than waiting at {current_node_id}"
                    + (
                        f" (best {reference_arrival:.2f}s vs candidate "
                        f"{min(item[3] for item in feasible):.2f}s)"
                        if reference_arrival is not None
                        else ""
                    )
                    + ". Retaining packet in the store-and-forward buffer."
                ),
            )

        max_path_latency = max(item[4] for item in feasible)

        best_candidate: Optional[str] = None
        best_route: Optional[RouteEstimate] = None
        best_score = float("-inf")
        best_latency = float("inf")
        best_arrival = float("inf")
        best_candidate_score: Optional[CandidateScore] = None
        selected_late_for_pressure = not acceptable and bool(selected_pool)

        for candidate_id, link, route, candidate_arrival, total_latency in feasible:
            reserved = self._tick_reservations.get(candidate_id, 0)
            score, cand_score = compute_candidate_score(
                current_node_id=current_node_id,
                candidate_node_id=candidate_id,
                destination_id=packet.destination_node_id,
                link=link,
                payload_size_bytes=packet.payload_size_bytes,
                current_time=current_time,
                topology=topology,
                weights=self.weights,
                route=route,
                candidate_arrival_time=candidate_arrival,
                reference_route=reference_route,
                max_path_latency_ms=max_path_latency,
                reserved_candidate_bytes=reserved,
            )
            if candidate_id not in selected_ids:
                cand_score = cand_score.model_copy(
                    update={
                        "reason": (
                            (cand_score.reason or "")
                            + "; not selected: predicted arrival is later than "
                            "waiting at the current node"
                        )
                    }
                )
            candidate_scores[candidate_id] = cand_score

            if candidate_id not in selected_ids:
                continue

            # Deterministic tie-break: higher score, then lower path latency,
            # then earlier arrival, then lexicographically smaller node id.
            if (
                score > best_score + 1e-12
                or (
                    abs(score - best_score) <= 1e-12
                    and total_latency < best_latency - 1e-12
                )
                or (
                    abs(score - best_score) <= 1e-12
                    and abs(total_latency - best_latency) <= 1e-12
                    and candidate_arrival < best_arrival - 1e-12
                )
                or (
                    abs(score - best_score) <= 1e-12
                    and abs(total_latency - best_latency) <= 1e-12
                    and abs(candidate_arrival - best_arrival) <= 1e-12
                    and best_candidate is not None
                    and candidate_id < best_candidate
                )
            ):
                best_score = score
                best_candidate = candidate_id
                best_route = route
                best_latency = total_latency
                best_arrival = candidate_arrival
                best_candidate_score = cand_score

        assert (
            best_candidate is not None
            and best_route is not None
            and best_candidate_score is not None
        )
        winning_score = best_candidate_score

        # Reserve the candidate's buffer for this tick.  Ground stations
        # terminate traffic and have no satellite buffer to reserve.
        if best_candidate in topology.satellites:
            self._tick_reservations[best_candidate] = (
                self._tick_reservations.get(best_candidate, 0)
                + packet.payload_size_bytes
            )

        route_sequence = " -> ".join([current_node_id, *best_route.path])
        if best_candidate == packet.destination_node_id:
            reason_code = DecisionReasonCode.DIRECT_DELIVERY
            explanation = (
                f"Direct contact to destination {packet.destination_node_id} is "
                f"active (score: {best_score:.3f}, "
                f"reliability: {winning_score.reliability_score:.2f}, "
                f"contact: {winning_score.contact_score:.2f}, "
                f"arrival: {best_arrival:.2f}s)."
            )
        else:
            reason_code = DecisionReasonCode.BEST_SCORE
            explanation = (
                f"Forwarding to {best_candidate} via {route_sequence} "
                f"(score: {best_score:.3f}, arrival: {best_arrival:.2f}s, "
                f"route latency: {best_route.total_latency_ms:.1f}ms, hops: "
                f"{best_route.hop_count + 1}, path reliability: "
                f"{winning_score.reliability_score:.2f}, contact: "
                f"{winning_score.contact_score:.2f}, progress: "
                f"{winning_score.progress_score:.2f})."
            )
            if selected_late_for_pressure:
                explanation += (
                    " This candidate arrives later than waiting but was chosen "
                    "to relieve local buffer pressure."
                )

        return RouteDecision(
            packet_id=packet.packet_id,
            satellite_id=current_node_id,
            chosen_next_hop_id=best_candidate,
            decision=DecisionAction.FORWARD,
            reason_code=reason_code,
            candidate_scores=candidate_scores,
            decision_time=current_time,
            routing_policy=self.name,
            explanation=explanation,
        )