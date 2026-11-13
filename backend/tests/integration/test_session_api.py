"""API + shared-session flow: play, auto-pause on detection, solve, resolve, reset, SSE."""

import asyncio
import json
import os
import time

os.environ["SWARMNET_NO_DB"] = "1"

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.simulation.session import SimulationSession


@pytest.fixture
def client():
    with TestClient(app) as c:
        # Fast pacing for tests: no wall-clock delay between ticks.
        app.state.session = SimulationSession(db=None, tick_wall_seconds=0.0)
        yield c


def wait_for_phase(client: TestClient, phase: str, timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = client.get("/api/session").json()
        if state["phase"] == phase:
            return state
        time.sleep(0.02)
    raise AssertionError(f"phase {phase} not reached; last {state['phase']}")


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200 and res.json()["status"] == "ok"


def test_idle_snapshot_has_drawn_network_and_no_motion(client):
    state = client.get("/api/session").json()
    assert state["phase"] == "IDLE"
    assert state["run_id"] is None
    assert 4 <= len([n for n in state["nodes"] if n["kind"] == "satellite"]) <= 5
    assert 1 <= len([n for n in state["nodes"] if n["kind"] == "ground"]) <= 2
    assert state["in_flight"] == []
    assert state["events"] == []
    assert state["controls"] == {"play": True, "solve": False, "sever": False, "reset": True}


def test_full_flow_through_api(client):
    res = client.post("/api/session/play")
    assert res.status_code == 200
    ref = res.json()
    assert ref["phase"] == "STABLE" and ref["seed"] is not None and ref["scenario_id"].startswith("SCN-")

    assert client.post("/api/session/play").status_code == 409

    detected = wait_for_phase(client, "DETECTED")
    assert detected["controls"]["solve"] is True
    assert detected["anomaly"]["loss_rate"] >= detected["scenario"]["detection"]["loss_threshold"]
    assert detected["comparison"]["direct_only"] is not None
    anomaly_link = next(l for l in detected["links"] if l["link_id"] == detected["anomaly"]["link_id"])
    assert anomaly_link["role"] == "anomaly"
    # paused: the clock does not advance
    time.sleep(0.2)
    assert client.get("/api/session").json()["sim_time"] == detected["sim_time"]

    assert client.post("/api/session/sever", json={"satellite_id": "SAT-01"}).status_code == 409
    solve = client.post("/api/session/solve")
    assert solve.status_code == 200
    relay = solve.json()["relay_id"]

    resolved = wait_for_phase(client, "RESOLVED")
    assert resolved["dtn"]["relay_id"] == relay
    affected = resolved["anomaly"]["satellite_id"]
    roles = {n["id"]: n["role"] for n in resolved["nodes"]}
    assert roles[affected] == "affected" and roles[relay] == "relay"
    current = {row["satellite_id"]: row for row in resolved["routing"]["current"]}
    before = {row["satellite_id"]: row for row in resolved["routing"]["before"]}
    assert before[affected]["protocol"] == "direct" and current[affected]["protocol"] == "dtn"
    assert current[affected]["path"][1] == relay or relay in current[affected]["path"]
    comparison = resolved["comparison"]
    assert comparison["final"] is True
    assert comparison["with_dtn"]["delivery_ratio"] == 1.0
    assert resolved["events"][-1]["type"] == "run_resolved"
    assert resolved["controls"] == {"play": False, "solve": False, "sever": False, "reset": True}

    assert client.post("/api/session/play").status_code == 409
    reset = client.post("/api/session/reset").json()
    assert reset["phase"] == "IDLE" and reset["run_id"] is None
    after = client.get("/api/session").json()
    assert after["events"] == [] and after["anomaly"] is None and after["comparison"] is None


def test_play_with_seed_is_reproducible(client):
    client.post("/api/session/play", json={"seed": 4242})
    first = wait_for_phase(client, "DETECTED")
    client.post("/api/session/reset")
    client.post("/api/session/play", json={"seed": 4242})
    second = wait_for_phase(client, "DETECTED")
    assert first["scenario_id"] == second["scenario_id"]
    assert first["anomaly"] == second["anomaly"]
    strip = lambda evs: [(e["t"], e["type"], e["status"], e["packet_id"]) for e in evs]  # noqa: E731
    assert strip(first["events"]) == strip(second["events"])
    assert first["run_id"] != second["run_id"]


def test_reset_stages_a_new_random_scenario(client):
    seeds = set()
    for _ in range(4):
        seeds.add(client.post("/api/session/reset").json()["seed"])
    assert len(seeds) == 4


def test_sever_validation(client):
    app.state.session = SimulationSession(db=None, tick_wall_seconds=0.05)  # real pacing: sever lands mid-STABLE
    assert client.post("/api/session/sever", json={"satellite_id": "SAT-01"}).status_code == 409  # IDLE
    client.post("/api/session/play", json={"seed": 77})
    assert client.post("/api/session/sever", json={"satellite_id": "SAT-99"}).status_code == 409
    res = client.post("/api/session/sever", json={"satellite_id": "SAT-02"})
    assert res.status_code == 200
    detected = wait_for_phase(client, "DETECTED")
    assert detected["anomaly"]["satellite_id"] == "SAT-02"


def test_stream_sends_snapshot_then_live_frames():
    # Starlette's TestClient buffers whole bodies, so drive the SSE generator directly.
    async def scenario():
        session = SimulationSession(db=None, tick_wall_seconds=0.0)
        stream = session.stream()
        first = json.loads((await stream.__anext__()).split("data: ", 1)[1])
        await session.play(seed=99)
        messages = []
        while len(messages) < 30:
            chunk = await asyncio.wait_for(stream.__anext__(), timeout=5)
            if chunk.startswith("event: message"):
                messages.append(json.loads(chunk.split("data: ", 1)[1]))
        await session.shutdown()
        await stream.aclose()
        return first, messages

    first, messages = asyncio.run(scenario())
    assert first["type"] == "snapshot" and first["state"]["phase"] == "IDLE"
    assert messages[0]["type"] == "snapshot" and messages[0]["reason"] == "play"
    frames = [m for m in messages if m["type"] == "frame"]
    assert frames, "expected tick frames after play"
    seqs = [e["seq"] for m in frames for e in m["events"]]
    assert seqs == sorted(seqs) and len(seqs) == len(set(seqs))
    assert all(m["state"]["seed"] == 99 for m in frames)


def test_export(client):
    client.post("/api/session/play", json={"seed": 5})
    wait_for_phase(client, "DETECTED")
    res = client.get("/api/session/export")
    assert res.status_code == 200
    body = res.json()
    assert body["seed"] == 5 and body["scenario"]["seed"] == 5 and body["events"]
