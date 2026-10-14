"""Unit tests for ContainerTransport and logical link isolation."""

from unittest.mock import MagicMock, patch
import pytest

from app.models.link import Link
from app.models.node import SatelliteNode, GroundStationNode
from app.models.packet import Packet
from app.simulation.topology import TopologyManager
from app.transport.container_transport import ContainerTransport


def test_logical_link_isolation_blocks_unavailable_link():
    """Verify logical link availability is enforced even if network path exists."""
    topo = TopologyManager()
    sat1 = SatelliteNode(satellite_id="SAT-01")
    sat2 = SatelliteNode(satellite_id="SAT-02")
    topo.add_satellite(sat1)
    topo.add_satellite(sat2)

    link = Link(
        link_id="SAT-01-SAT-02",
        source_node_id="SAT-01",
        target_node_id="SAT-02",
        is_available=False,  # Logically down
        latency_ms=25.0,
        bandwidth_mbps=10.0,
    )
    topo.add_link(link)

    transport = ContainerTransport(topology=topo)
    transport.register_node_url("SAT-02", "http://sat-02:8102")

    packet = Packet(
        packet_id="PKT-001",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        current_node_id="SAT-01",
        created_at=0.0,
        payload_size_bytes=1024,
    )

    # Should return False without even making an HTTP request because link is logically unavailable
    with patch.object(transport.client, "post") as mock_post:
        success = transport.send_packet(packet, link, current_time=1.0)
        assert success is False
        mock_post.assert_not_called()


def test_logical_link_allows_transfer_when_available():
    """Verify transport initiates transfer when logical link is available."""
    topo = TopologyManager()
    sat1 = SatelliteNode(satellite_id="SAT-01")
    sat2 = SatelliteNode(satellite_id="SAT-02")
    topo.add_satellite(sat1)
    topo.add_satellite(sat2)

    link = Link(
        link_id="SAT-01-SAT-02",
        source_node_id="SAT-01",
        target_node_id="SAT-02",
        is_available=True,  # Logically active
        latency_ms=25.0,
        bandwidth_mbps=10.0,
    )
    topo.add_link(link)

    transport = ContainerTransport(topology=topo)
    transport.register_node_url("SAT-02", "http://sat-02:8102")

    packet = Packet(
        packet_id="PKT-002",
        source_node_id="SAT-01",
        destination_node_id="GROUND-01",
        current_node_id="SAT-01",
        created_at=0.0,
        payload_size_bytes=2048,
    )

    mock_response = MagicMock()
    mock_response.status_code = 200

    with patch.object(transport.client, "post", return_value=mock_response) as mock_post:
        success = transport.send_packet(packet, link, current_time=2.0)
        assert success is True
        mock_post.assert_called_once()
        assert transport.total_transferred_bytes_by_link["SAT-01-SAT-02"] == 2048
