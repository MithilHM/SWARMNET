"""Ground station agent acting as endpoint receiver and telemetry observer."""

from typing import Dict, List, Optional
from app.models.packet import Packet, PacketStatus, RouteHop
from app.buffering.deduplication import Deduplicator


class GroundStationAgent:
    def __init__(self, ground_station_id: str):
        self.ground_station_id = ground_station_id
        self.received_packets: Dict[str, Packet] = {}
        self.delivered_delays: List[float] = []
        self.total_bytes_received: int = 0
        self.last_contact_time: Optional[float] = None
        self.deduplicator = Deduplicator()

    def receive_packet(self, packet: Packet, current_time: float) -> bool:
        """Receive delivered packet, deduplicate, and record telemetry."""
        if not self.deduplicator.mark_seen(packet.packet_id):
            return False  # Duplicate delivery suppressed

        packet.status = PacketStatus.DELIVERED
        packet.delivery_time = current_time
        packet.current_node_id = self.ground_station_id
        packet.route_history.append(
            RouteHop(
                node_id=self.ground_station_id,
                entered_at=current_time,
                action="delivered",
            )
        )

        delay = current_time - packet.created_at
        self.delivered_delays.append(delay)
        self.total_bytes_received += packet.payload_size_bytes
        self.last_contact_time = current_time
        self.received_packets[packet.packet_id] = packet
        return True

    def reset(self) -> None:
        self.received_packets.clear()
        self.delivered_delays.clear()
        self.total_bytes_received = 0
        self.last_contact_time = None
        self.deduplicator.reset()
