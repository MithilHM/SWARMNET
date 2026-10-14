"""Unit tests for SWARMNET domain models."""

import pytest
from app.models.node import SatelliteNode, GroundStationNode, NodeStatus, NodePosition
from app.models.link import Link
from app.models.packet import Packet, PacketPriority, PacketStatus, DropReason
from app.models.decision import RouteDecision, DecisionAction, DecisionReasonCode
from app.simulation.scenarios import ScenarioLoader


def test_satellite_model():
    sat = SatelliteNode(
        satellite_id="SAT-01",
        position=NodePosition(x=10.0, y=20.0),
        energy_percent=95.0,
        buffer_capacity_bytes=524288,
    )
    assert sat.satellite_id == "SAT-01"
    assert sat.energy_percent == 95.0
    assert sat.buffer_capacity_bytes == 524288
    assert sat.status == NodeStatus.ACTIVE
    assert sat.neighbors == []


def test_link_model_transfer_time():
    link = Link(
        link_id="SAT-01-SAT-02",
        source_node_id="SAT-01",
        target_node_id="SAT-02",
        latency_ms=20.0,
        bandwidth_mbps=10.0,
    )
    # 4096 bytes = 32768 bits
    # 10 Mbps = 10,000,000 bps
    # Serialization = 32768 / 10,000,000 = 0.0032768 s
    # Propagation = 20 / 1000 = 0.02 s
    # Total = 0.0232768 s
    total_time = link.transfer_time_seconds(4096)
    assert pytest.approx(total_time, rel=1e-3) == 0.0232768


def test_packet_expiry():
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=10.0,
        expires_at=50.0,
        current_node_id="SAT-01",
    )
    assert not pkt.is_expired(40.0)
    assert pkt.is_expired(50.0)
    assert pkt.is_expired(60.0)


def test_route_decision_model():
    decision = RouteDecision(
        packet_id="pkt-123",
        satellite_id="SAT-01",
        chosen_next_hop_id="SAT-02",
        decision=DecisionAction.FORWARD,
        reason_code=DecisionReasonCode.BEST_SCORE,
        decision_time=5.0,
        routing_policy="swarmnet",
    )
    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-02"
