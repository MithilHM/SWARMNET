"""Satellite agent making autonomous next-hop routing and store-and-forward buffering decisions."""

from typing import Dict, List, Optional, Tuple
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
        # Track last logged decision state per packet to suppress identical repeated buffer logs
        self._last_logged_decision: Dict[str, Tuple[str, str]] = {}

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

            action_val = decision.decision.value if hasattr(decision.decision, "value") else str(decision.decision)
            reason_val = decision.reason_code.value if hasattr(decision.reason_code, "value") else str(decision.reason_code)
            curr_state = (action_val, reason_val)
            prev_state = self._last_logged_decision.get(pkt.packet_id)

            should_record = True
            if decision.decision == DecisionAction.BUFFER and prev_state == curr_state:
                should_record = False

            if should_record:
                decisions.append(decision)
                self.recent_decisions.append(decision)
                if len(self.recent_decisions) > 50:
                    self.recent_decisions.pop(0)
                self.total_decisions_count += 1
                self._last_logged_decision[pkt.packet_id] = curr_state

            if decision.decision == DecisionAction.FORWARD and decision.chosen_next_hop_id:
                self._last_logged_decision.pop(pkt.packet_id, None)
                link = topology.get_link_between(
                    self.satellite_id, decision.chosen_next_hop_id, active_only=True
                )
                if link and link.is_available:
                    # Remove from local buffer and pass to transport
                    removed = self.buffer.remove(pkt.packet_id)
                    if removed:
                        scheduled = transport.send_packet(removed, link, current_time)
                        if scheduled:
                            # Radio transmission energy cost: ~1.4% per 4KB packet
                            topo_sat = topology.satellites.get(self.satellite_id)
                            if topo_sat:
                                cost = round(0.35 * (removed.payload_size_bytes / 1024.0), 2)
                                topo_sat.energy_percent = max(0.0, round(topo_sat.energy_percent - cost, 2))
                        else:
                            # The transport refused to schedule the handoff
                            # (contact closed or link queue full).  Restore the
                            # owned copy without duplicate suppression; a
                            # re-admit would mark the packet DUPLICATE and drop
                            # it silently.
                            self.buffer.restore(removed, current_time)
                else:
                    # Link unavailable or changed before dispatch, retain in buffer
                    pass
            elif decision.decision == DecisionAction.DROP:
                self._last_logged_decision.pop(pkt.packet_id, None)
                self.buffer.remove(pkt.packet_id)

        return decisions

    def reset(self) -> None:
        self.buffer.clear()
        self.recent_decisions.clear()
        self.total_decisions_count = 0
        self._last_logged_decision.clear()
