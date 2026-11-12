"""Interpretable multi-factor scoring functions for SWARMNET contact-aware routing.

The score is deliberately bounded and easy to inspect:

    score = w_progress   * progress
          + w_reliability * path_reliability
          + w_contact     * contact_feasibility
          - w_latency     * normalized_path_latency
          - w_congestion  * candidate_queue_pressure
          - w_energy      * candidate_energy_penalty

All components are normalised to [0, 1] so a change in one weight has a
predictable effect.  ``progress`` compares the candidate's predicted delivery
delay with the earliest arrival the current node could achieve on its own,
including any wait for future scheduled contacts.  Routing toward a
geometrically closer satellite that cannot reach the destination, or that can
only do so much later than simply waiting, is therefore not rewarded.
"""

from typing import Optional, Tuple

from app.models.scenario import RoutingWeights
from app.models.link import Link
from app.models.decision import CandidateScore
from app.simulation.topology import TopologyManager
from app.routing.path_estimator import RouteEstimate


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def compute_candidate_score(
    current_node_id: str,
    candidate_node_id: str,
    destination_id: str,
    link: Link,
    payload_size_bytes: int,
    current_time: float,
    topology: TopologyManager,
    weights: RoutingWeights,
    route: RouteEstimate,
    candidate_arrival_time: float,
    reference_route: Optional[RouteEstimate] = None,
    max_path_latency_ms: Optional[float] = None,
    reserved_candidate_bytes: int = 0,
) -> Tuple[float, CandidateScore]:
    """Score one contact-feasible candidate next hop.

    ``route`` is the future-contact-aware route from the candidate to the
    destination (empty for direct delivery).  ``candidate_arrival_time`` is the
    absolute time at which the packet would reach the destination through this
    candidate, including the first hop and any tick-aligned waiting.  The
    ``reference_route`` is the best route the packet could achieve by staying at
    the current node, used as the progress baseline.
    """

    transfer_duration = link.transfer_time_seconds(payload_size_bytes)
    if link.contact_end_time is not None:
        remaining_contact_sec: Optional[float] = max(
            0.0, link.contact_end_time - current_time
        )
    else:
        remaining_contact_sec = None

    # --- 1. Progress: compare predicted delivery delay with staying put.
    # The reference route is the earliest-arrival option from the current node,
    # so a candidate can never be meaningfully earlier.  Candidates that arrive
    # later than the reference receive a smaller progress score.
    candidate_delay = max(1e-6, candidate_arrival_time - current_time)
    if reference_route is not None:
        reference_delay = max(1e-6, reference_route.arrival_time - current_time)
    else:
        reference_delay = candidate_delay
    progress_score = _clamp(reference_delay / candidate_delay)
    if candidate_node_id == destination_id:
        progress_score = 1.0

    # --- 2. End-to-end reliability of the candidate's route.
    path_reliability = _clamp(link.reliability * route.reliability)

    # --- 3. Contact feasibility.  The path estimator already removed links
    # that cannot finish serialising this packet; this component additionally
    # rewards a healthy margin over the minimum required window on both the
    # first hop and the downstream route.
    contact_score = route.min_contact_margin_ratio
    if link.contact_end_time is not None:
        first_hop_margin = max(
            0.0, link.contact_end_time - current_time
        ) / max(0.001, transfer_duration * 2.0)
        contact_score = min(contact_score, first_hop_margin)
    contact_score = _clamp(contact_score, 0.1, 1.0)

    # --- 4. Normalised propagation latency penalty.  Waiting time is already
    # reflected in progress; this term keeps the preference for lower-latency
    # links among routes that arrive at similar times.
    total_path_latency_ms = link.latency_ms + route.total_latency_ms
    total_path_hops = 1 + route.hop_count
    latency_scale = max(
        200.0,
        max_path_latency_ms
        if max_path_latency_ms is not None
        else total_path_latency_ms,
    )
    norm_latency = _clamp(total_path_latency_ms / latency_scale)

    # --- 5. Queue pressure at the candidate after accepting this packet
    # (bounded 0..1).  Reservations made earlier in the same tick are included
    # because topology buffer counters only synchronise at the end of a tick.
    congestion_penalty = 0.0
    candidate_satellite = topology.satellites.get(candidate_node_id)
    if (
        candidate_satellite is not None
        and candidate_satellite.buffer_capacity_bytes > 0
    ):
        projected_bytes = (
            candidate_satellite.buffer_used_bytes
            + reserved_candidate_bytes
            + payload_size_bytes
        )
        congestion_penalty = _clamp(
            projected_bytes / candidate_satellite.buffer_capacity_bytes
        )

    # --- 6. Energy penalty at the candidate (or current node if the candidate
    # is a ground station without an energy model).
    energy_penalty = 0.0
    current_satellite = topology.satellites.get(current_node_id)
    if candidate_satellite is not None:
        energy_penalty = 1.0 - (candidate_satellite.energy_percent / 100.0)
    elif current_satellite is not None:
        energy_penalty = 1.0 - (current_satellite.energy_percent / 100.0)
    energy_penalty = _clamp(energy_penalty)

    total_score = (
        weights.progress * progress_score
        + weights.reliability * path_reliability
        + weights.contact_feasibility * contact_score
        - weights.latency * norm_latency
        - weights.congestion * congestion_penalty
        - weights.energy * energy_penalty
    )

    cs = CandidateScore(
        neighbor_id=candidate_node_id,
        total_score=round(total_score, 4),
        progress_score=round(progress_score, 4),
        reliability_score=round(path_reliability, 4),
        contact_score=round(contact_score, 4),
        latency_penalty=round(norm_latency, 4),
        congestion_penalty=round(congestion_penalty, 4),
        energy_penalty=round(energy_penalty, 4),
        link_available=link.is_available,
        estimated_remaining_contact_sec=(
            round(remaining_contact_sec, 4)
            if remaining_contact_sec is not None
            else None
        ),
        route_path=route.path,
        estimated_path_latency_ms=round(total_path_latency_ms, 4),
        estimated_path_hops=total_path_hops,
        path_reliability=round(path_reliability, 4),
        reason=(
            f"route={' -> '.join(route.path)}; "
            f"arrival={candidate_arrival_time:.2f}s, "
            f"wait={route.waiting_seconds:.2f}s; "
            f"progress={progress_score:.2f}, rel={path_reliability:.2f}, "
            f"contact={contact_score:.2f}, latency={total_path_latency_ms:.1f}ms"
        ),
    )

    return total_score, cs
