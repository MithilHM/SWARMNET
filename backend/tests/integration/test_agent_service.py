"""Integration tests for containerized agent endpoints and backend agent coordination."""

import pytest
from starlette.testclient import TestClient

from app.main import app as backend_app
from app.agents.agent_service import agent_app, state as agent_state, AgentState


@pytest.fixture
def backend_client():
    return TestClient(backend_app)


@pytest.fixture
def satellite_client():
    # Configure agent_state as satellite
    agent_state.node_id = "SAT-01"
    agent_state.node_type = "satellite"
    agent_state.reset()
    return TestClient(agent_app)


@pytest.fixture
def ground_client():
    # Configure agent_state as ground_station
    agent_state.node_id = "GROUND-01"
    agent_state.node_type = "ground_station"
    agent_state.buffer = None
    agent_state.reset()
    return TestClient(agent_app)


def test_agent_health_and_telemetry(satellite_client):
    res = satellite_client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["node_id"] == "SAT-01"
    assert data["node_type"] == "satellite"

    telem = satellite_client.get("/telemetry")
    assert telem.status_code == 200
    tdata = telem.json()
    assert tdata["buffer_capacity_bytes"] > 0
    assert tdata["buffer_used_bytes"] == 0


def test_satellite_receives_and_buffers_packet(satellite_client):
    pkt_data = {
        "packet_id": "PKT-TEST-001",
        "source_node_id": "SAT-SRC",
        "destination_node_id": "GROUND-01",
        "created_at": 10.0,
        "payload_size_bytes": 1024,
        "priority": "normal",
        "current_node_id": "SAT-SRC",
        "hop_count": 0,
        "max_hops": 10,
        "visited_node_ids": ["SAT-SRC"],
        "status": "created",
    }
    res = satellite_client.post(
        "/receive_packet",
        json={"packet": pkt_data, "link_id": "LINK-01", "simulated_time": 10.0},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "buffered"

    # Verify buffer contents
    buf_res = satellite_client.get("/buffer")
    assert buf_res.status_code == 200
    assert buf_res.json()["used_bytes"] == 1024
    assert len(buf_res.json()["packets"]) == 1

    # Verify duplicate suppression
    res_dup = satellite_client.post(
        "/receive_packet",
        json={"packet": pkt_data, "link_id": "LINK-01", "simulated_time": 11.0},
    )
    assert res_dup.status_code == 200
    assert res_dup.json()["status"] == "duplicate"


def test_ground_station_receives_delivery(ground_client):
    pkt_data = {
        "packet_id": "PKT-TEST-DELIVERY",
        "source_node_id": "SAT-01",
        "destination_node_id": "GROUND-01",
        "created_at": 5.0,
        "payload_size_bytes": 2048,
        "priority": "high",
        "current_node_id": "SAT-01",
        "hop_count": 1,
        "max_hops": 10,
        "visited_node_ids": ["SAT-01"],
        "status": "in_transit",
    }
    res = ground_client.post(
        "/receive_packet",
        json={"packet": pkt_data, "link_id": "LINK-GROUND", "simulated_time": 6.5},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "delivered"

    # Verify received list
    recv_res = ground_client.get("/received")
    assert recv_res.status_code == 200
    assert recv_res.json()["count"] == 1
    assert recv_res.json()["total_bytes_received"] == 2048


def test_backend_agent_registration_and_heartbeat(backend_client):
    # Register an agent
    reg_res = backend_client.post(
        "/api/agents/register",
        json={"node_id": "SAT-01", "node_type": "satellite", "url": "http://sat-01:8101"},
    )
    assert reg_res.status_code == 200
    assert reg_res.json()["status"] == "registered"

    # Heartbeat
    hb_res = backend_client.post(
        "/api/agents/heartbeat",
        json={"node_id": "SAT-01", "node_type": "satellite", "uptime": 12.5, "buffer_used_bytes": 1024},
    )
    assert hb_res.status_code == 200
    assert hb_res.json()["status"] == "ok"

    # List agents
    list_res = backend_client.get("/api/agents")
    assert list_res.status_code == 200
    agents = list_res.json()["agents"]
    assert len(agents) >= 1
    match = next(a for a in agents if a["node_id"] == "SAT-01")
    assert match["status"] == "healthy"
    assert match["buffer_used_bytes"] == 1024


def test_backend_get_node_details(backend_client):
    # Create run
    run_res = backend_client.post(
        "/api/runs",
        json={"scenario_id": "basic_delivery", "seed": 42},
    )
    assert run_res.status_code == 200
    run_id = run_res.json()["run_id"]

    # Satellite node details
    sat_res = backend_client.get(f"/api/runs/{run_id}/nodes/SAT-01")
    assert sat_res.status_code == 200
    sat_data = sat_res.json()
    assert sat_data["node_id"] == "SAT-01"
    assert sat_data["node_type"] == "satellite"
    assert "buffer_capacity_bytes" in sat_data
    assert "incident_links" in sat_data
    assert len(sat_data["incident_links"]) > 0

    # Ground station node details
    gs_res = backend_client.get(f"/api/runs/{run_id}/nodes/GROUND-01")
    assert gs_res.status_code == 200
    gs_data = gs_res.json()
    assert gs_data["node_id"] == "GROUND-01"
    assert gs_data["node_type"] == "ground_station"
    assert "total_bytes_received" in gs_data

    # Unknown node
    unk_res = backend_client.get(f"/api/runs/{run_id}/nodes/NONEXISTENT")
    assert unk_res.status_code == 404
