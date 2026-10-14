"""Unit tests for baseline shortest path routing policy."""

import pytest
from app.routing.shortest_path import ShortestPathRoutingPolicy
from app.simulation.topology import TopologyManager
from app.models.node import SatelliteNode, GroundStationNode, NodeStatus
from app.models.link import Link
from app.models.packet import Packet
from app.models.decision import DecisionAction, DecisionReasonCode


def test_baseline_direct_delivery():
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))
    topo.add_link(
        Link(
            link_id="SAT-01-GROUND-01",
            source_node_id="SAT-01",
            target_node_id="GROUND-01",
            latency_ms=25.0,
            is_available=True,
        )
    )

    router = ShortestPathRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)
    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "GROUND-01"
    assert decision.reason_code == DecisionReasonCode.DIRECT_DELIVERY


def test_baseline_multi_hop():
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

    # Path: SAT-01 -> SAT-02 (20ms) -> GROUND-01 (30ms)
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=20.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-02-GROUND-01",
            source_node_id="SAT-02",
            target_node_id="GROUND-01",
            latency_ms=30.0,
            is_available=True,
        )
    )

    router = ShortestPathRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)
    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-02"
    assert decision.reason_code == DecisionReasonCode.LOWEST_COST


def test_baseline_buffers_when_disconnected():
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

    # Link to SAT-02 is available, but SAT-02 to GROUND-01 is unavailable
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=20.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-02-GROUND-01",
            source_node_id="SAT-02",
            target_node_id="GROUND-01",
            latency_ms=30.0,
            is_available=False,  # DOWN
        )
    )

    router = ShortestPathRoutingPolicy()
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
