"""Unit tests for SWARMNET contact-aware routing policy."""

import pytest
from app.routing.swarmnet import SwarmnetRoutingPolicy
from app.simulation.topology import TopologyManager
from app.models.node import SatelliteNode, GroundStationNode, NodeStatus
from app.models.link import Link, LinkScheduleItem
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
    # Both candidates need a real downstream route for the comparison to be
    # meaningful; otherwise neither can deliver and both are correctly rejected.
    for candidate in ("SAT-02", "SAT-03"):
        topo.add_link(
            Link(
                link_id=f"{candidate}-GROUND-01",
                source_node_id=candidate,
                target_node_id="GROUND-01",
                latency_ms=20.0,
                bandwidth_mbps=10.0,
                reliability=1.0,
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
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

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
    for candidate in ("SAT-02", "SAT-03"):
        topo.add_link(
            Link(
                link_id=f"{candidate}-GROUND-01",
                source_node_id=candidate,
                target_node_id="GROUND-01",
                latency_ms=20.0,
                reliability=1.0,
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


def test_swarmnet_avoids_low_energy_satellite():
    """When one candidate satellite has depleted battery (15%), prefer the candidate with healthy battery (95%)."""
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", energy_percent=15.0, status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-03", energy_percent=95.0, status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

    # Identical links to both SAT-02 and SAT-03
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=20.0,
            reliability=1.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-03",
            source_node_id="SAT-01",
            target_node_id="SAT-03",
            latency_ms=20.0,
            reliability=1.0,
            is_available=True,
        )
    )
    for candidate in ("SAT-02", "SAT-03"):
        topo.add_link(
            Link(
                link_id=f"{candidate}-GROUND-01",
                source_node_id=candidate,
                target_node_id="GROUND-01",
                latency_ms=20.0,
                reliability=1.0,
                is_available=True,
            )
        )

    weights = RoutingWeights(progress=0.2, reliability=0.2, contact_feasibility=0.2, latency=0.1, energy=0.3)
    router = SwarmnetRoutingPolicy(weights=weights)
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)
    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-03"
    assert decision.candidate_scores["SAT-02"].energy_penalty > decision.candidate_scores["SAT-03"].energy_penalty


def test_swarmnet_rejects_dead_end_candidate():
    """A geometrically closer neighbour with no route to the destination must not win."""
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-03", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-04", status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

    # SAT-02 is very close but its onward link to the destination is down.
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=5.0,
            reliability=1.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-02-SAT-04",
            source_node_id="SAT-02",
            target_node_id="SAT-04",
            latency_ms=5.0,
            reliability=1.0,
            is_available=False,
        )
    )
    # SAT-03 is the only usable route.
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-03",
            source_node_id="SAT-01",
            target_node_id="SAT-03",
            latency_ms=40.0,
            reliability=1.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-03-GROUND-01",
            source_node_id="SAT-03",
            target_node_id="GROUND-01",
            latency_ms=30.0,
            reliability=1.0,
            is_available=True,
        )
    )

    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
        visited_node_ids=["SAT-01"],
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)

    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-03"
    assert decision.candidate_scores["SAT-02"].total_score < 0
    assert "dead-end" in (decision.candidate_scores["SAT-02"].reason or "")


def test_swarmnet_buffers_when_all_candidates_are_dead_ends():
    """Having active neighbours is not enough: buffer when none can reach the destination."""
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-03", status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=10.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-03",
            source_node_id="SAT-01",
            target_node_id="SAT-03",
            latency_ms=10.0,
            is_available=True,
        )
    )
    # Neither neighbour can reach the ground station.

    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
        visited_node_ids=["SAT-01"],
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)

    assert decision.decision == DecisionAction.BUFFER
    assert decision.reason_code == DecisionReasonCode.NO_ROUTE
    assert decision.chosen_next_hop_id is None


def _build_full_relay_with_delayed_downlink(*, downlink_open: bool) -> TopologyManager:
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(
        SatelliteNode(
            satellite_id="SAT-04",
            buffer_capacity_bytes=4096,
            buffer_used_bytes=4096,
            status=NodeStatus.ACTIVE,
        )
    )
    topo.add_ground_station(
        GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE)
    )
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-04",
            source_node_id="SAT-01",
            target_node_id="SAT-04",
            latency_ms=25.0,
            bandwidth_mbps=5.0,
            reliability=1.0,
            is_available=True,
        )
    )
    downlink = Link(
        link_id="SAT-04-GROUND-01",
        source_node_id="SAT-04",
        target_node_id="GROUND-01",
        latency_ms=40.0,
        bandwidth_mbps=10.0,
        reliability=1.0,
        is_available=downlink_open,
        contact_end_time=60.0 if downlink_open else None,
    )
    topo.add_link(downlink)
    topo.set_link_windows(
        downlink.link_id,
        (
            [LinkScheduleItem(start=0.0, end=60.0, available=True)]
            if downlink_open
            else [
                LinkScheduleItem(start=0.0, end=5.0, available=True),
                LinkScheduleItem(start=20.0, end=60.0, available=True),
            ]
        ),
    )
    return topo


def test_swarmnet_keeps_packet_when_full_relay_waits_for_future_contact():
    """Forwarding into a full relay whose contact has not opened evicts a packet."""
    topo = _build_full_relay_with_delayed_downlink(downlink_open=False)
    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=4096,
        current_node_id="SAT-01",
        visited_node_ids=["SAT-01"],
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=6.0)

    assert decision.decision == DecisionAction.BUFFER
    assert decision.chosen_next_hop_id is None
    assert decision.candidate_scores["SAT-04"].total_score == -500.0
    assert "buffer is full" in (decision.candidate_scores["SAT-04"].reason or "")


def test_swarmnet_forwards_into_full_relay_when_contact_is_open():
    """A full relay that can drain now should not be skipped; holding would build a source backlog."""
    topo = _build_full_relay_with_delayed_downlink(downlink_open=True)
    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        payload_size_bytes=4096,
        current_node_id="SAT-01",
        visited_node_ids=["SAT-01"],
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=6.0)

    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-04"


def test_swarmnet_prefers_reachable_route_over_fast_contact_closing_soon():
    """Prefer a reachable stable route over a faster path whose contact is about to close."""
    topo = TopologyManager()
    topo.add_satellite(SatelliteNode(satellite_id="SAT-01", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-02", status=NodeStatus.ACTIVE))
    topo.add_satellite(SatelliteNode(satellite_id="SAT-03", status=NodeStatus.ACTIVE))
    topo.add_ground_station(GroundStationNode(ground_station_id="GROUND-01", status=NodeStatus.ACTIVE))

    # Fast first hop but the next contact closes before the packet can finish.
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-02",
            source_node_id="SAT-01",
            target_node_id="SAT-02",
            latency_ms=5.0,
            reliability=1.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-02-GROUND-01",
            source_node_id="SAT-02",
            target_node_id="GROUND-01",
            latency_ms=5.0,
            reliability=1.0,
            contact_end_time=0.001,
            is_available=True,
        )
    )
    # Slower, stable route.
    topo.add_link(
        Link(
            link_id="SAT-01-SAT-03",
            source_node_id="SAT-01",
            target_node_id="SAT-03",
            latency_ms=40.0,
            reliability=1.0,
            is_available=True,
        )
    )
    topo.add_link(
        Link(
            link_id="SAT-03-GROUND-01",
            source_node_id="SAT-03",
            target_node_id="GROUND-01",
            latency_ms=30.0,
            reliability=1.0,
            contact_end_time=60.0,
            is_available=True,
        )
    )

    router = SwarmnetRoutingPolicy()
    pkt = Packet(
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        created_at=0.0,
        current_node_id="SAT-01",
        visited_node_ids=["SAT-01"],
    )

    decision = router.evaluate_next_hop("SAT-01", pkt, topo, current_time=0.0)

    assert decision.decision == DecisionAction.FORWARD
    assert decision.chosen_next_hop_id == "SAT-03"
    assert decision.candidate_scores["SAT-02"].total_score < 0

