"""Unit tests for buffer admission, capacity accounting, priority eviction, and deduplication."""

import pytest
from app.buffering.buffer import NodeBuffer
from app.buffering.deduplication import Deduplicator
from app.models.packet import Packet, PacketPriority, PacketStatus, DropReason


def test_buffer_admission_and_accounting():
    buffer = NodeBuffer(node_id="SAT-01", capacity_bytes=10000)
    assert buffer.used_bytes == 0
    assert buffer.packet_count == 0

    pkt1 = Packet(
        packet_id="pkt-1",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=3000,
        current_node_id="SAT-01",
    )
    admitted, reason, evicted = buffer.admit(pkt1, current_time=0.0)
    assert admitted is True
    assert reason is None
    assert len(evicted) == 0
    assert buffer.used_bytes == 3000
    assert buffer.packet_count == 1
    assert pkt1.status == PacketStatus.BUFFERED

    pkt2 = Packet(
        packet_id="pkt-2",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=4000,
        current_node_id="SAT-01",
    )
    admitted, reason, evicted = buffer.admit(pkt2, current_time=0.0)
    assert admitted is True
    assert buffer.used_bytes == 7000
    assert buffer.packet_count == 2

    removed = buffer.remove("pkt-1")
    assert removed is not None
    assert removed.packet_id == "pkt-1"
    assert buffer.used_bytes == 4000
    assert buffer.packet_count == 1


def test_buffer_deduplication():
    buffer = NodeBuffer(node_id="SAT-01", capacity_bytes=10000)
    pkt = Packet(
        packet_id="pkt-dup",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=1000,
        current_node_id="SAT-01",
    )
    admitted1, _, _ = buffer.admit(pkt, current_time=0.0)
    assert admitted1 is True

    # Same packet ID attempted again
    admitted2, reason, _ = buffer.admit(pkt, current_time=1.0)
    assert admitted2 is False
    assert reason == DropReason.DUPLICATE.value
    assert pkt.drop_reason == DropReason.DUPLICATE.value


def test_buffer_priority_eviction():
    # Buffer capacity 5000 bytes
    buffer = NodeBuffer(node_id="SAT-01", capacity_bytes=5000)

    # Admit LOW priority packet of 3000 bytes
    pkt_low = Packet(
        packet_id="pkt-low",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=3000,
        priority=PacketPriority.LOW,
        current_node_id="SAT-01",
    )
    admitted, _, _ = buffer.admit(pkt_low, current_time=0.0)
    assert admitted is True
    assert buffer.used_bytes == 3000

    # Admit HIGH priority packet of 3000 bytes -> exceeds 5000 bytes, should evict pkt-low
    pkt_high = Packet(
        packet_id="pkt-high",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=3000,
        priority=PacketPriority.HIGH,
        current_node_id="SAT-01",
    )
    admitted, reason, evicted = buffer.admit(pkt_high, current_time=0.0)
    assert admitted is True
    assert len(evicted) == 1
    assert evicted[0].packet_id == "pkt-low"
    assert evicted[0].status == PacketStatus.DROPPED
    assert evicted[0].drop_reason == DropReason.BUFFER_FULL.value
    assert buffer.used_bytes == 3000
    assert buffer.peek("pkt-low") is None
    assert buffer.peek("pkt-high") is not None


def test_buffer_drop_when_cannot_evict():
    # Buffer capacity 3000 bytes
    buffer = NodeBuffer(node_id="SAT-01", capacity_bytes=3000)

    # Existing HIGH priority packet of 2000 bytes
    pkt_high = Packet(
        packet_id="pkt-high",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=2000,
        priority=PacketPriority.HIGH,
        current_node_id="SAT-01",
    )
    buffer.admit(pkt_high, current_time=0.0)

    # Incoming LOW priority packet of 2000 bytes -> cannot evict HIGH priority
    pkt_low = Packet(
        packet_id="pkt-low",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=2000,
        priority=PacketPriority.LOW,
        current_node_id="SAT-01",
    )
    admitted, reason, evicted = buffer.admit(pkt_low, current_time=0.0)
    assert admitted is False
    assert reason == DropReason.BUFFER_FULL.value
    assert pkt_low.status == PacketStatus.DROPPED
    assert len(evicted) == 0
    assert buffer.used_bytes == 2000


def test_buffer_expiry_check():
    buffer = NodeBuffer(node_id="SAT-01", capacity_bytes=10000)

    pkt = Packet(
        packet_id="pkt-exp",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        expires_at=10.0,
        payload_size_bytes=1000,
        current_node_id="SAT-01",
    )
    buffer.admit(pkt, current_time=0.0)
    assert buffer.used_bytes == 1000

    # At t=5, packet not expired
    expired = buffer.expire_packets(current_time=5.0)
    assert len(expired) == 0
    assert buffer.used_bytes == 1000

    # At t=10, packet expires
    expired = buffer.expire_packets(current_time=10.0)
    assert len(expired) == 1
    assert expired[0].packet_id == "pkt-exp"
    assert expired[0].status == PacketStatus.EXPIRED
    assert expired[0].drop_reason == DropReason.TTL_EXPIRED.value
    assert buffer.used_bytes == 0


def test_buffer_hop_limit():
    buffer = NodeBuffer(node_id="SAT-01", capacity_bytes=10000)

    pkt = Packet(
        packet_id="pkt-hop",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=1000,
        current_node_id="SAT-01",
        hop_count=5,
        max_hops=5,
    )
    admitted, reason, _ = buffer.admit(pkt, current_time=0.0)
    assert admitted is False
    assert reason == DropReason.HOP_LIMIT.value
    assert pkt.status == PacketStatus.DROPPED
    assert pkt.drop_reason == DropReason.HOP_LIMIT.value
