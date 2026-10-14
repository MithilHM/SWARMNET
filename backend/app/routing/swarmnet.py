"""SWARMNET Contact-Aware autonomous routing policy."""

from typing import Dict, Optional

from app.routing.base import RoutingPolicy
from app.routing.scoring import compute_candidate_score
from app.models.scenario import RoutingWeights
from app.models.packet import Packet
from app.models.decision import (
    RouteDecision,
    DecisionAction,
    DecisionReasonCode,
    CandidateScore,
)
from app.simulation.topology import TopologyManager
from app.buffering.buffer import NodeBuffer


class SwarmnetRoutingPolicy(RoutingPolicy):
    def __init__(self, weights: Optional[RoutingWeights] = None):
        self.weights = weights if weights is not None else RoutingWeights()

    @property
    def name(self) -> str:
        return "swarmnet"

    def evaluate_next_hop(
        self,
        current_node_id: str,
        packet: Packet,
        topology: TopologyManager,
        current_time: float,
        local_buffer: Optional[NodeBuffer] = None,
    ) -> RouteDecision:
        # Check direct link to destination first
        direct_link = topology.get_link_between(
            current_node_id, packet.destination_node_id, active_only=True
        )
        if direct_link and direct_link.is_available:
            score, cand_score = compute_candidate_score(
                current_node_id=current_node_id,
                candidate_node_id=packet.destination_node_id,
                destination_id=packet.destination_node_id,
                link=direct_link,
                payload_size_bytes=packet.payload_size_bytes,
                current_time=current_time,
                topology=topology,
                weights=self.weights,
            )
            if score > 0:
                return RouteDecision(
                    packet_id=packet.packet_id,
                    satellite_id=current_node_id,
                    chosen_next_hop_id=packet.destination_node_id,
                    decision=DecisionAction.FORWARD,
                    reason_code=DecisionReasonCode.DIRECT_DELIVERY,
                    candidate_scores={packet.destination_node_id: cand_score},
                    decision_time=current_time,
                    routing_policy=self.name,
                    explanation=(
                        f"Direct contact to destination {packet.destination_node_id} is active "
                        f"(score: {score:.3f}, reliability: {direct_link.reliability:.2f})."
                    ),
                )

        # Get all outgoing active links
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
                explanation="No active outgoing links from current satellite; buffering packet in store-and-forward queue.",
            )

        candidate_scores: Dict[str, CandidateScore] = {}
        best_candidate: Optional[str] = None
        best_score = float("-inf")
        contact_ending_count = 0

        for link in outgoing_links:
            cand_id = link.target_node_id

            # Loop & backtracking prevention
            if cand_id in packet.visited_node_ids and cand_id != packet.destination_node_id:
                candidate_scores[cand_id] = CandidateScore(
                    neighbor_id=cand_id,
                    total_score=-100.0,
                    link_available=True,
                    reason="Node already visited in route history (loop prevention)",
                )
                continue

            score, cand_score = compute_candidate_score(
                current_node_id=current_node_id,
                candidate_node_id=cand_id,
                destination_id=packet.destination_node_id,
                link=link,
                payload_size_bytes=packet.payload_size_bytes,
                current_time=current_time,
                topology=topology,
                weights=self.weights,
            )
            candidate_scores[cand_id] = cand_score

            if score <= -500:
                contact_ending_count += 1
                continue

            if score > best_score:
                best_score = score
                best_candidate = cand_id

        # If no candidate scored above threshold or all links infeasible
        if best_candidate is None or best_score <= 0.0:
            reason = (
                DecisionReasonCode.CONTACT_ENDING
                if contact_ending_count > 0
                else DecisionReasonCode.NO_ROUTE
            )
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=reason,
                candidate_scores=candidate_scores,
                decision_time=current_time,
                routing_policy=self.name,
                explanation=(
                    f"No candidate provides viable forward progress (best score: {best_score:.3f}). "
                    f"Retaining packet in store-and-forward buffer until topology changes."
                ),
            )

        winning_score = candidate_scores[best_candidate]
        explanation = (
            f"Forwarding to {best_candidate} (score: {best_score:.3f}, "
            f"progress: {winning_score.progress_score:.2f}, "
            f"reliability: {winning_score.reliability_score:.2f}, "
            f"contact: {winning_score.contact_score:.2f})."
        )

        return RouteDecision(
            packet_id=packet.packet_id,
            satellite_id=current_node_id,
            chosen_next_hop_id=best_candidate,
            decision=DecisionAction.FORWARD,
            reason_code=DecisionReasonCode.BEST_SCORE,
            candidate_scores=candidate_scores,
            decision_time=current_time,
            routing_policy=self.name,
            explanation=explanation,
        )
