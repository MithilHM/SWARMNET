"""Interpretable multi-factor scoring functions for SWARMNET contact-aware routing."""

from typing import Optional, Tuple
from app.models.scenario import RoutingWeights
from app.models.link import Link
from app.models.node import SatelliteNode, GroundStationNode
from app.models.decision import CandidateScore
from app.simulation.topology import TopologyManager


def compute_candidate_score(
    current_node_id: str,
    candidate_node_id: str,
    destination_id: str,
    link: Link,
    payload_size_bytes: int,
    current_time: float,
    topology: TopologyManager,
    weights: RoutingWeights,
) -> Tuple[float, CandidateScore]:
    """
    Compute multi-factor score for a candidate neighbor:
    score = w_prog * progress + w_rel * reliability + w_cont * contact_feasibility
            - w_lat * norm_latency - w_cong * norm_congestion - w_eng * energy_penalty
    """
    # 1. Transfer duration calculation
    transfer_duration = link.transfer_time_seconds(payload_size_bytes)
    arrival_time = current_time + transfer_duration

    # 2. Contact feasibility
    contact_score = 1.0
    rem_contact_sec = None
    if link.contact_end_time is not None:
        rem_contact_sec = max(0.0, link.contact_end_time - current_time)
        if arrival_time > link.contact_end_time:
            # Transfer cannot complete before contact window closes!
            contact_score = -1.0
        else:
            # Scale feasibility based on margin beyond bare minimum transfer time
            margin_ratio = rem_contact_sec / max(0.001, (transfer_duration * 2.0))
            contact_score = min(1.0, max(0.1, margin_ratio))

    # If contact is impossible, return negative score
    if contact_score < 0:
        cs = CandidateScore(
            neighbor_id=candidate_node_id,
            total_score=-999.0,
            contact_score=0.0,
            link_available=False,
            estimated_remaining_contact_sec=rem_contact_sec,
            reason="Contact window ends before packet transfer can complete",
        )
        return -999.0, cs

    # 3. Progress toward destination
    if candidate_node_id == destination_id:
        progress_score = 1.0
    else:
        # Check if candidate has direct active link to destination or path
        candidate_to_dest = topology.get_link_between(
            candidate_node_id, destination_id, active_only=True
        )
        if candidate_to_dest and candidate_to_dest.is_available:
            progress_score = 0.8
        else:
            # Estimate progress based on position or active neighbor reachability
            cand_links = topology.get_outgoing_links(candidate_node_id, active_only=True)
            if any(l.target_node_id == destination_id for l in cand_links):
                progress_score = 0.7
            elif len(cand_links) > 1:
                progress_score = 0.5
            elif len(cand_links) == 1:
                progress_score = 0.3
            else:
                progress_score = 0.1

    # 4. Reliability
    reliability_score = max(0.0, min(1.0, link.reliability))

    # 5. Normalized latency penalty (0.0 to 1.0, 200ms baseline scale)
    norm_latency = min(1.0, link.latency_ms / 200.0)

    # 6. Congestion penalty
    congestion_penalty = 0.0
    cand_sat = topology.satellites.get(candidate_node_id)
    if cand_sat and cand_sat.buffer_capacity_bytes > 0:
        congestion_penalty = cand_sat.buffer_used_bytes / cand_sat.buffer_capacity_bytes
        congestion_penalty = min(1.0, max(0.0, congestion_penalty))

    # 7. Energy penalty
    energy_penalty = 0.0
    curr_sat = topology.satellites.get(current_node_id)
    if curr_sat:
        energy_penalty = 1.0 - (curr_sat.energy_percent / 100.0)
        energy_penalty = min(1.0, max(0.0, energy_penalty))

    # Multi-factor score
    total_score = (
        weights.progress * progress_score
        + weights.reliability * reliability_score
        + weights.contact_feasibility * contact_score
        - weights.latency * norm_latency
        - weights.congestion * congestion_penalty
        - weights.energy * energy_penalty
    )

    candidate_score_obj = CandidateScore(
        neighbor_id=candidate_node_id,
        total_score=round(total_score, 4),
        progress_score=round(progress_score, 4),
        reliability_score=round(reliability_score, 4),
        contact_score=round(contact_score, 4),
        latency_penalty=round(norm_latency, 4),
        congestion_penalty=round(congestion_penalty, 4),
        energy_penalty=round(energy_penalty, 4),
        link_available=link.is_available,
        estimated_remaining_contact_sec=rem_contact_sec,
        reason=(
            f"progress={progress_score:.2f}, rel={reliability_score:.2f}, "
            f"contact={contact_score:.2f}, lat_pen={norm_latency:.2f}"
        ),
    )

    return total_score, candidate_score_obj
