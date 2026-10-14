"""Satellite agent making autonomous next-hop routing and store-and-forward buffering decisions."""

from typing import List, Optional
from app.buffering.buffer import NodeBuffer
from app.routing.base import RoutingPolicy
from app.transport.base import LinkTransport
from app.simulation.topology import TopologyManager
from app.models.decision import RouteDecision, DecisionAction
from app.models.packet import Packet


class SatelliteAgent:
    def __init__(
        self,
        satellite_id: str,
        buffer_capacity_bytes: int,
        routing_policy: RoutingPolicy,
    ):
        self.satellite_id = satellite_id
        self.buffer = NodeBuffer(node_id=satellite_id, capacity_bytes=buffer_capacity_bytes)
        self.routing_policy = routing_policy
        self.recent_decisions: List[RouteDecision] = []
        self.total_decisions_count: int = 0

    def evaluate_and_dispatch(
        self,
        topology: TopologyManager,
        transport: LinkTransport,
        current_time: float,
    ) -> List[RouteDecision]:
        """
        Evaluate eligible buffered packets and attempt dispatch over valid links.
        Returns list of made routing decisions.
        """
        decisions: List[RouteDecision] = []
        eligible_packets = self.buffer.get_eligible_packets(current_time)

        for pkt in eligible_packets:
            decision = self.routing_policy.evaluate_next_hop(
                current_node_id=self.satellite_id,
                packet=pkt,
                topology=topology,
                current_time=current_time,
                local_buffer=self.buffer,
            )
            decisions.append(decision)
            self.recent_decisions.append(decision)
            if len(self.recent_decisions) > 50:
                self.recent_decisions.pop(0)
            self.total_decisions_count += 1

            if decision.decision == DecisionAction.FORWARD and decision.chosen_next_hop_id:
                link = topology.get_link_between(
                    self.satellite_id, decision.chosen_next_hop_id, active_only=True
                )
                if link and link.is_available:
                    # Remove from local buffer and pass to transport
                    removed = self.buffer.remove(pkt.packet_id)
                    if removed:
                        scheduled = transport.send_packet(removed, link, current_time)
                        if not scheduled:
                            # Re-admit into buffer if transfer couldn't be scheduled
                            self.buffer.admit(removed, current_time)
                else:
                    # Link unavailable or changed before dispatch, retain in buffer
                    pass
            elif decision.decision == DecisionAction.DROP:
                self.buffer.remove(pkt.packet_id)

        return decisions

    def reset(self) -> None:
        self.buffer.clear()
        self.recent_decisions.clear()
        self.total_decisions_count = 0
