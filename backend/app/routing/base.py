"""Abstract base routing policy interface."""

from abc import ABC, abstractmethod
from typing import Optional

from app.models.packet import Packet
from app.models.decision import RouteDecision
from app.simulation.topology import TopologyManager
from app.buffering.buffer import NodeBuffer


class RoutingPolicy(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """Name of the routing policy (e.g. 'baseline', 'swarmnet')."""
        pass

    @abstractmethod
    def evaluate_next_hop(
        self,
        current_node_id: str,
        packet: Packet,
        topology: TopologyManager,
        current_time: float,
        local_buffer: Optional[NodeBuffer] = None,
    ) -> RouteDecision:
        """
        Evaluate forwarding options for a packet at current_node_id.
        Returns a RouteDecision detailing whether to forward, buffer, or drop,
        along with the chosen next hop and structured explanations.
        """
        pass
