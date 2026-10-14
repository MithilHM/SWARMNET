"""In-process LinkTransport enforcing bandwidth, serialization, propagation, and reliability."""

import random
from typing import Any, Dict, List, Optional, Tuple

from app.transport.base import LinkTransport
from app.models.packet import Packet, PacketStatus, RouteHop
from app.models.link import Link


class InTransitItem:
    def __init__(
        self,
        packet: Packet,
        link: Link,
        departure_time: float,
        arrival_time: float,
        will_succeed: bool,
    ):
        self.packet = packet
        self.link = link
        self.departure_time = departure_time
        self.arrival_time = arrival_time
        self.will_succeed = will_succeed


class InProcessTransport(LinkTransport):
    def __init__(self, rng: Optional[random.Random] = None):
        self.rng = rng if rng is not None else random.Random(42)
        self._in_transit: List[InTransitItem] = []
        self.total_transferred_bytes_by_link: Dict[str, int] = {}

    def send_packet(
        self,
        packet: Packet,
        link: Link,
        current_time: float,
    ) -> bool:
        if not link.is_available:
            return False

        duration = link.transfer_time_seconds(packet.payload_size_bytes)
        arrival_time = round(current_time + duration, 4)

        # Check contact window feasibility
        if link.contact_end_time is not None and arrival_time > link.contact_end_time:
            return False

        # Roll reliability
        roll = self.rng.random()
        will_succeed = roll <= link.reliability

        packet.status = PacketStatus.IN_TRANSIT
        self._in_transit.append(
            InTransitItem(
                packet=packet,
                link=link,
                departure_time=current_time,
                arrival_time=arrival_time,
                will_succeed=will_succeed,
            )
        )
        return True

    def process_in_transit(
        self, current_time: float
    ) -> List[Tuple[Packet, str, bool, Optional[str]]]:
        """
        Check for arrived packets.
        Returns list of (packet, target_node_id, success, link_id).
        """
        completed: List[Tuple[Packet, str, bool, Optional[str]]] = []
        still_in_transit: List[InTransitItem] = []

        for item in self._in_transit:
            if current_time >= item.arrival_time:
                link_id = item.link.link_id
                target_id = item.link.target_node_id

                if item.will_succeed:
                    # Update bytes transferred metric
                    self.total_transferred_bytes_by_link[link_id] = (
                        self.total_transferred_bytes_by_link.get(link_id, 0)
                        + item.packet.payload_size_bytes
                    )
                    # Update packet hop
                    item.packet.hop_count += 1
                    item.packet.current_node_id = target_id
                    if target_id not in item.packet.visited_node_ids:
                        item.packet.visited_node_ids.append(target_id)

                    item.packet.route_history.append(
                        RouteHop(
                            node_id=target_id,
                            entered_at=item.arrival_time,
                            link_id=link_id,
                            action="forward",
                        )
                    )
                    completed.append((item.packet, target_id, True, link_id))
                else:
                    # Transmission failed due to link unreliability
                    completed.append((item.packet, item.link.source_node_id, False, link_id))
            else:
                still_in_transit.append(item)

        self._in_transit = still_in_transit
        return completed

    def get_in_transit_packets(self) -> List[Dict[str, Any]]:
        return [
            {
                "packet_id": item.packet.packet_id,
                "link_id": item.link.link_id,
                "source": item.link.source_node_id,
                "target": item.link.target_node_id,
                "departure_time": item.departure_time,
                "arrival_time": item.arrival_time,
                "payload_size_bytes": item.packet.payload_size_bytes,
            }
            for item in self._in_transit
        ]

    def reset(self) -> None:
        self._in_transit.clear()
        self.total_transferred_bytes_by_link.clear()
