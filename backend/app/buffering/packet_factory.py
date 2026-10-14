"""Traffic generator for producing packets according to scenario configuration."""

from typing import Dict, List
import uuid

from app.models.scenario import TrafficFlow
from app.models.packet import Packet, PacketPriority, PacketStatus, RouteHop


class TrafficGenerator:
    def __init__(self, traffic_flows: List[TrafficFlow]):
        self.flows = traffic_flows
        # Track packets generated per flow index: flow_idx -> count
        self._flow_generated_counts: Dict[int, int] = {i: 0 for i in range(len(traffic_flows))}
        self._last_generation_time: Dict[int, float] = {i: -1.0 for i in range(len(traffic_flows))}

    def generate_packets_for_tick(self, current_time: float) -> List[Packet]:
        new_packets: List[Packet] = []

        for idx, flow in enumerate(self.flows):
            if current_time < flow.start_time:
                continue
            if flow.stop_time is not None and current_time > flow.stop_time:
                continue
            if flow.packet_count_limit is not None and self._flow_generated_counts[idx] >= flow.packet_count_limit:
                continue

            # Interval between packets = 1.0 / packets_per_second
            interval = 1.0 / max(0.01, flow.packets_per_second)
            last_time = self._last_generation_time[idx]

            # Check if interval elapsed or first generation
            if last_time < 0.0 or (current_time - last_time) >= (interval - 1e-6):
                # Calculate how many packets to generate in this tick window
                if last_time < 0.0:
                    packets_to_make = 1
                else:
                    packets_to_make = int((current_time - last_time) / interval)
                    packets_to_make = max(1, packets_to_make)

                # Cap by limit
                if flow.packet_count_limit is not None:
                    remaining = flow.packet_count_limit - self._flow_generated_counts[idx]
                    packets_to_make = min(packets_to_make, remaining)

                for _ in range(packets_to_make):
                    pkt_id = f"PKT-{flow.source}-{self._flow_generated_counts[idx] + 1:04d}-{uuid.uuid4().hex[:6]}"
                    expires_at = (
                        current_time + flow.ttl_seconds
                        if flow.ttl_seconds is not None
                        else None
                    )
                    pkt = Packet(
                        packet_id=pkt_id,
                        source_node_id=flow.source,
                        destination_node_id=flow.destination,
                        created_at=current_time,
                        expires_at=expires_at,
                        payload_size_bytes=flow.payload_size_bytes,
                        priority=flow.priority,
                        current_node_id=flow.source,
                        hop_count=0,
                        max_hops=flow.max_hops,
                        visited_node_ids=[flow.source],
                        status=PacketStatus.CREATED,
                        route_history=[
                            RouteHop(
                                node_id=flow.source,
                                entered_at=current_time,
                                action="created",
                            )
                        ],
                    )
                    self._flow_generated_counts[idx] += 1
                    new_packets.append(pkt)

                self._last_generation_time[idx] = current_time

        return new_packets

    def reset(self) -> None:
        self._flow_generated_counts = {i: 0 for i in range(len(self.flows))}
        self._last_generation_time = {i: -1.0 for i in range(len(self.flows))}
