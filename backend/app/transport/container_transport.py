"""Container-compatible LinkTransport enforcing logical link availability over network calls."""

from typing import Any, Dict, List, Optional, Tuple
import httpx

from app.transport.base import LinkTransport
from app.models.packet import Packet
from app.models.link import Link
from app.simulation.topology import TopologyManager


class ContainerTransport(LinkTransport):
    """
    Facilitates inter-container packet transfers while enforcing logical link state.
    CRITICAL: Does NOT assume that sharing a Docker bridge implies a simulated satellite link is available.
    """

    def __init__(self, topology: TopologyManager, node_url_map: Optional[Dict[str, str]] = None):
        self.topology = topology
        self.node_url_map = node_url_map or {}
        self.client = httpx.Client(timeout=3.0)
        self._in_transit: List[Dict[str, Any]] = []
        self.total_transferred_bytes_by_link: Dict[str, int] = {}

    def register_node_url(self, node_id: str, url: str) -> None:
        self.node_url_map[node_id] = url

    def send_packet(
        self,
        packet: Packet,
        link: Link,
        current_time: float,
    ) -> bool:
        # Enforce simulated logical link availability
        current_link_state = self.topology.links.get(link.link_id)
        if not current_link_state or not current_link_state.is_available:
            return False

        target_url = self.node_url_map.get(link.target_node_id)
        if not target_url:
            return False

        # Attempt HTTP transfer to target container
        try:
            resp = self.client.post(
                f"{target_url}/receive_packet",
                json={
                    "packet": packet.model_dump(),
                    "link_id": link.link_id,
                    "simulated_time": current_time,
                },
            )
            if resp.status_code == 200:
                self.total_transferred_bytes_by_link[link.link_id] = (
                    self.total_transferred_bytes_by_link.get(link.link_id, 0)
                    + packet.payload_size_bytes
                )
                return True
            return False
        except Exception:
            return False

    def process_in_transit(
        self, current_time: float
    ) -> List[Tuple[Packet, str, bool, Optional[str]]]:
        # Container transport performs direct delivery upon HTTP confirmation
        return []

    def get_in_transit_packets(self) -> List[Dict[str, Any]]:
        return list(self._in_transit)

    def reset(self) -> None:
        self._in_transit.clear()
        self.total_transferred_bytes_by_link.clear()
