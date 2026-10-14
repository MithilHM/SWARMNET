"""Abstract base class for link packet transport."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple
from app.models.packet import Packet
from app.models.link import Link


class LinkTransport(ABC):
    @abstractmethod
    def send_packet(
        self,
        packet: Packet,
        link: Link,
        current_time: float,
    ) -> bool:
        """
        Accept packet for transmission over link starting at current_time.
        Returns True if transmission was successfully scheduled, False otherwise.
        """
        pass

    @abstractmethod
    def process_in_transit(
        self, current_time: float
    ) -> List[Tuple[Packet, str, bool, Optional[str]]]:
        """
        Process packets in transit.
        Returns list of tuples: (packet, target_node_id, success, link_id).
        """
        pass

    @abstractmethod
    def get_in_transit_packets(self) -> List[Dict[str, Any]]:
        """Return telemetry data for all packets currently in transit."""
        pass

    @abstractmethod
    def reset(self) -> None:
        pass
