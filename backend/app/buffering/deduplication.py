"""Deduplication tracker to suppress duplicate packet processing."""

from typing import Set


class Deduplicator:
    def __init__(self):
        self._seen_packet_ids: Set[str] = set()

    def has_seen(self, packet_id: str) -> bool:
        return packet_id in self._seen_packet_ids

    def mark_seen(self, packet_id: str) -> bool:
        """Mark packet as seen. Returns True if newly seen, False if already present."""
        if packet_id in self._seen_packet_ids:
            return False
        self._seen_packet_ids.add(packet_id)
        return True

    def reset(self) -> None:
        self._seen_packet_ids.clear()
