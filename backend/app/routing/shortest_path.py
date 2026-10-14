"""Baseline routing policy: Shortest available path using edge latency."""

from typing import Dict, Optional
import networkx as nx

from app.routing.base import RoutingPolicy
from app.models.packet import Packet
from app.models.decision import (
    RouteDecision,
    DecisionAction,
    DecisionReasonCode,
    CandidateScore,
)
from app.simulation.topology import TopologyManager
from app.buffering.buffer import NodeBuffer


class ShortestPathRoutingPolicy(RoutingPolicy):
    @property
    def name(self) -> str:
        return "baseline"

    def evaluate_next_hop(
        self,
        current_node_id: str,
        packet: Packet,
        topology: TopologyManager,
        current_time: float,
        local_buffer: Optional[NodeBuffer] = None,
    ) -> RouteDecision:
        # Check direct contact to destination
        direct_link = topology.get_link_between(
            current_node_id, packet.destination_node_id, active_only=True
        )
        if direct_link and direct_link.is_available:
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=packet.destination_node_id,
                decision=DecisionAction.FORWARD,
                reason_code=DecisionReasonCode.DIRECT_DELIVERY,
                candidate_scores={
                    packet.destination_node_id: CandidateScore(
                        neighbor_id=packet.destination_node_id,
                        total_score=direct_link.latency_ms,
                        link_available=True,
                        reason="Direct link to destination available",
                    )
                },
                decision_time=current_time,
                routing_policy=self.name,
                explanation=f"Direct link to destination {packet.destination_node_id} is active (latency: {direct_link.latency_ms}ms).",
            )

        # Build active directed graph
        graph = nx.DiGraph()
        for link_id, link in topology.links.items():
            if link.is_available and topology._is_target_active(link.target_node_id):
                graph.add_edge(
                    link.source_node_id,
                    link.target_node_id,
                    weight=link.latency_ms,
                    link=link,
                )

        if not graph.has_node(current_node_id) or not graph.has_node(packet.destination_node_id):
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=DecisionReasonCode.NO_ROUTE,
                decision_time=current_time,
                routing_policy=self.name,
                explanation="No active route to destination found; buffering packet.",
            )

        try:
            path = nx.shortest_path(
                graph,
                source=current_node_id,
                target=packet.destination_node_id,
                weight="weight",
            )
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=DecisionReasonCode.NO_ROUTE,
                decision_time=current_time,
                routing_policy=self.name,
                explanation="No connected path currently exists over available links; buffering.",
            )

        if len(path) < 2:
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=DecisionReasonCode.NO_ROUTE,
                decision_time=current_time,
                routing_policy=self.name,
                explanation="Path resolved to current node; buffering.",
            )

        next_hop = path[1]

        # Prevent immediate loop
        if next_hop in packet.visited_node_ids and next_hop != packet.destination_node_id:
            return RouteDecision(
                packet_id=packet.packet_id,
                satellite_id=current_node_id,
                chosen_next_hop_id=None,
                decision=DecisionAction.BUFFER,
                reason_code=DecisionReasonCode.NO_ROUTE,
                decision_time=current_time,
                routing_policy=self.name,
                explanation=f"Shortest path next-hop {next_hop} already visited; avoiding loop.",
            )

        link_to_next = topology.get_link_between(current_node_id, next_hop, active_only=True)
        path_cost = nx.shortest_path_length(
            graph, source=current_node_id, target=packet.destination_node_id, weight="weight"
        )

        candidate_scores: Dict[str, CandidateScore] = {
            next_hop: CandidateScore(
                neighbor_id=next_hop,
                total_score=path_cost,
                latency_penalty=path_cost,
                link_available=True,
                reason=f"Lowest latency path to destination (total path latency: {path_cost:.1f}ms)",
            )
        }

        return RouteDecision(
            packet_id=packet.packet_id,
            satellite_id=current_node_id,
            chosen_next_hop_id=next_hop,
            decision=DecisionAction.FORWARD,
            reason_code=DecisionReasonCode.LOWEST_COST,
            candidate_scores=candidate_scores,
            decision_time=current_time,
            routing_policy=self.name,
            explanation=f"Selected {next_hop} along shortest latency path ({' -> '.join(path)}, {path_cost:.1f}ms).",
        )
