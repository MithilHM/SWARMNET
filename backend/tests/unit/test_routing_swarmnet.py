"""Unit tests for SWARMNET contact-aware routing policy."""

import pytest
from app.routing.swarmnet import SwarmnetRoutingPolicy
from app.simulation.topology import TopologyManager
from app.models.node import SatelliteNode, GroundStationNode, NodeStatus
from app.models.link import Link
from app.models.packet import Packet
from app.models.decision import DecisionAction, DecisionReasonCode
from app.models.scenario import RoutingWeights


def test_swarmnet_prefers_contact_feasibility_over_ending_link():
    """When one link has contact ending in 0.001s, prefer the link with ample contact time."""
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-03", status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

    # Link to SAT-02 ends in 0.001s (cannot transfer 4096 bytes)
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=10.0,
            bandwidth_mbps=10.0,
            reliability=1.0,
            contact_end_time=0.001,
            is_available=True,
        )
    )
    # Link to SAT-03 has contact open for 50s
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-03",
            source_node_id="SAT-01",
            target_node_id="SAT-03",
            latency_ms=25.0,
            bandwidth_mbps=10.0,
            reliability=1.0,
            contact_end_time=50.0,
            is_available=True,
        )
    )

    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=4096,
        current_node_id="SAT-01",
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)
    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-03"
    assert decision.candidate_scores["SAT-02"].total_score < 0
    assert "explanation" in decision.model_dump()
    assert decision.explanation is not None


def test_swarmnet_avoids_low_reliability_link():
    """Prefer a high-reliability link over a degraded/low-reliability link."""
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-03", status=NodeStatus.ACTIVE))

    # Link to SAT-02 has poor reliability (0.2)
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=20.0,
            reliability=0.2,
            is_available=True,
        )
    )
    # Link to SAT-03 has excellent reliability (0.99)
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-03",
            source_node_id="SAT-01",
            target_node_id="SAT-03",
            latency_ms=25.0,
            reliability=0.99,
            is_available=True,
        )
    )

    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)
    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-03"
    assert (
        decision.candidate_scores["SAT-03"].total_score
        > decision.candidate_scores["SAT-02"].total_score
    )


def test_swarmnet_buffers_when_partitioned():
    """When no links are active, buffer the packet."""
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))

    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            is_available=False,
        )
    )

    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)
    assert decision.decision == DecisionAction.BUFFER
    assert decision.reason_code == DecisionReasonCode.NO_ROUTE
    assert decision.chosen_next_hop_id is None
