"""Delay-tolerant store-and-forward packet buffer with explicit capacity accounting."""

from typing import Dict, List, Optional, Tuple
from app.models.packet import Packet, PacketPriority, PacketStatus, DropReason, RouteHop
from app.buffering.deduplication import Deduplicator


PRIORITY_WEIGHT = {
    PacketPriority.LOW: 1,
    PacketPriority.NORMAL: 2,
    PacketPriority.HIGH: 3,
}


class NodeBuffer:
    def __init__(self, node_id: str, capacity_bytes: int = 1048576):
        self.node_id = node_id
        self.capacity_bytes = max(1024, capacity_bytes)
        self.used_bytes: int = 0
        self._packets: Dict[str, Packet] = {}
        self.deduplicator = Deduplicator()

    @property
    def packet_count(self) -> int:
        return len(self._packets)

    def admit(self, packet: Packet, current_time: float) -> Tuple[bool, Optional[str], List[Packet]]:
        """
        Attempt to admit a packet into the buffer.
        Returns (admitted: bool, reason: Optional[str], evicted_packets: List[Packet]).
        """
        # Expiry check
        if packet.is_expired(current_time):
            packet.status = PacketStatus.EXPIRED
            packet.drop_reason = DropReason.TTL_EXPIRED.value
            return False, DropReason.TTL_EXPIRED.value, []

        # Hop limit check
        if packet.hop_count >= packet.max_hops:
            packet.status = PacketStatus.DROPPED
            packet.drop_reason = DropReason.HOP_LIMIT.value
            return False, DropReason.HOP_LIMIT.value, []

        # Deduplication check
        if not self.deduplicator.mark_seen(packet.packet_id):
            packet.status = PacketStatus.DROPPED
            packet.drop_reason = DropReason.DUPLICATE.value
            return False, DropReason.DUPLICATE.value, []

        evicted: List[Packet] = []
        needed_bytes = (self.used_bytes + packet.payload_size_bytes) - self.capacity_bytes

        if needed_bytes > 0:
            # Need to evict lower priority or earlier expiring packets
            candidates = sorted(
                self._packets.values(),
                key=lambda p: (
                    PRIORITY_WEIGHT[p.priority],
                    p.expires_at if p.expires_at is not None else float("inf"),
                ),
            )

            freed_bytes = 0
            to_evict_ids = []

            for cand in candidates:
                # Only evict if candidate priority is strictly less or same priority but expires earlier
                cand_weight = PRIORITY_WEIGHT[cand.priority]
                new_weight = PRIORITY_WEIGHT[packet.priority]
                if cand_weight > new_weight:
                    break

                to_evict_ids.append(cand.packet_id)
                freed_bytes += cand.payload_size_bytes
                if freed_bytes >= needed_bytes:
                    break

            if freed_bytes < needed_bytes:
                # Cannot fit new packet
                packet.status = PacketStatus.DROPPED
                packet.drop_reason = DropReason.BUFFER_FULL.value
                return False, DropReason.BUFFER_FULL.value, []

            # Perform eviction
            for pid in to_evict_ids:
                evicted_pkt = self.remove(pid)
                if evicted_pkt:
                    evicted_pkt.status = PacketStatus.DROPPED
                    evicted_pkt.drop_reason = DropReason.BUFFER_FULL.value
                    evicted.append(evicted_pkt)

        # Admitted
        self._packets[packet.packet_id] = packet
        self.used_bytes += packet.payload_size_bytes
        packet.status = PacketStatus.BUFFERED
        packet.current_node_id = self.node_id

        # Record entering this node in route history if not already recorded
        if not packet.route_history or packet.route_history[-1].node_id != self.node_id:
            packet.route_history.append(
                RouteHop(
                    node_id=self.node_id,
                    entered_at=current_time,
                    action="buffered",
                )
            )

        return True, None, evicted

    def remove(self, packet_id: str) -> Optional[Packet]:
        """Remove packet from buffer and update used bytes."""
        if packet_id in self._packets:
            pkt = self._packets.pop(packet_id)
            self.used_bytes = max(0, self.used_bytes - pkt.payload_size_bytes)
            return pkt
        return None

    def peek(self, packet_id: str) -> Optional[Packet]:
        return self._packets.get(packet_id)

    def get_eligible_packets(self, current_time: float) -> List[Packet]:
        """Return non-expired packets ordered by priority (HIGH first), then earliest expiry."""
        eligible = [
            p for p in self._packets.values() if not p.is_expired(current_time)
        ]
        eligible.sort(
            key=lambda p: (
                -PRIORITY_WEIGHT[p.priority],
                p.expires_at if p.expires_at is not None else float("inf"),
                p.created_at,
            )
        )
        return eligible

    def expire_packets(self, current_time: float) -> List[Packet]:
        """Evict all expired packets from the buffer and return them."""
        expired_ids = [
            pid for pid, pkt in self._packets.items() if pkt.is_expired(current_time)
        ]
        expired_pkts: List[Packet] = []
        for pid in expired_ids:
            pkt = self.remove(pid)
            if pkt:
                pkt.status = PacketStatus.EXPIRED
                pkt.drop_reason = DropReason.TTL_EXPIRED.value
                expired_pkts.append(pkt)
        return expired_pkts

    def clear(self) -> None:
        self._packets.clear()
        self.used_bytes = 0
        self.deduplicator.reset()
