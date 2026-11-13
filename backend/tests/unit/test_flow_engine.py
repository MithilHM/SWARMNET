"""State machine, detection trigger, and DTN relay delivery for the guided flow engine."""

import pytest

from app.models.packet import PacketStatus
from app.simulation.flow_engine import (
    FlowEngine,
    Phase,
    SimulationActionError,
    comparison_from,
    run_counterfactual,
)
from app.simulation.scenario_generator import generate_scenario


def run_until_halt(engine: FlowEngine, max_ticks: int = 40000) -> None:
    for _ in range(max_ticks):
        if engine.halted:
            return
        engine.step()
    raise AssertionError(f"engine did not halt (phase {engine.phase})")


def started(seed: int) -> FlowEngine:
    engine = FlowEngine(generate_scenario(seed))
    engine.start("RUN-TEST")
    return engine


def test_idle_until_started():
    engine = FlowEngine(generate_scenario(7))
    assert engine.phase == Phase.IDLE
    assert engine.halted
    assert engine.step() == []
    assert engine.events == []


def test_stable_then_degrading_then_detected_and_paused():
    engine = started(7)
    assert engine.phase == Phase.STABLE
    stable = engine.scenario.stable_duration_s
    while engine.phase == Phase.STABLE:
        engine.step()
    assert engine.now == pytest.approx(stable, abs=engine.dt)
    assert engine.phase == Phase.DEGRADING
    # nominal traffic was delivered during STABLE
    assert any(e["status"] == "delivered" and e["tag"] == "stable" for e in engine.events)

    run_until_halt(engine)
    assert engine.phase == Phase.DETECTED
    anomaly = engine.anomaly
    assert anomaly["loss_rate"] >= engine.scenario.detection.loss_threshold
    assert anomaly["window_size"] >= engine.scenario.detection.min_samples
    assert anomaly["link_id"] == engine.scenario.failure.link_id
    assert anomaly["probable_cause"] == engine.scenario.failure.cause
    # paused: further steps produce nothing and the clock does not move
    frozen_events, frozen_time = len(engine.events), engine.now
    for _ in range(50):
        assert engine.step() == []
    assert len(engine.events) == frozen_events
    assert engine.now == frozen_time


def test_detection_is_driven_by_loss_not_time():
    scenario = generate_scenario(11)
    # Keep the target link healthy: the degradation pattern bottoms out at 1.0.
    scenario.failure.floor_reliability = 1.0
    scenario.failure.pattern = "ramp"
    for link in scenario.links:
        link.reliability = 1.0
    engine = FlowEngine(scenario)
    engine.start()
    for _ in range(4000):  # 10 simulated seconds, far beyond any detection time
        engine.step()
    assert engine.phase == Phase.DEGRADING
    assert engine.anomaly is None


def test_detection_fires_exactly_when_window_crosses_threshold():
    engine = started(21)
    while engine.phase == Phase.STABLE:
        engine.step()
    sat = engine.sat_ids[0]
    engine.sever(sat)
    link_id = engine.target_link
    run_until_halt(engine)
    assert engine.anomaly["link_id"] == link_id
    lost_events = [e for e in engine.events if e["status"] == "lost" and e["link_id"] == link_id]
    det = engine.scenario.detection
    window = list(engine.windows[link_id])
    assert sum(window) / len(window) >= det.loss_threshold
    # one fewer loss would not have crossed the threshold
    assert (sum(window) - 1) / len(window) < det.loss_threshold or len(window) == det.min_samples
    assert len(lost_events) >= 1


def test_solve_relays_bundles_through_peer_to_ground():
    engine = started(3)
    run_until_halt(engine)
    affected = engine.anomaly["satellite_id"]
    gs = engine.home_gs[affected]
    with pytest.raises(SimulationActionError):
        engine.sever(affected)  # not allowed once detected
    dtn = engine.solve()
    relay = dtn["relay_id"]
    assert relay != affected
    assert dtn["path"][0] == affected and dtn["path"][-1] == engine.home_gs[relay]
    assert engine.ground_link_of(relay).is_available
    assert engine.protocol[affected] == "dtn"

    run_until_halt(engine)
    assert engine.phase == Phase.RESOLVED
    own = engine.affected_packets()
    assert len(own) == engine.affected_quota
    assert all(p.status == PacketStatus.DELIVERED for p in own)

    dtn_deliveries = [e for e in engine.events if e["status"] == "delivered" and e["source"] == affected and e["tag"] == "dtn"]
    assert dtn_deliveries, "expected deliveries after the DTN switch"
    for event in dtn_deliveries:
        assert event["hop_path"][0] == affected
        assert relay in event["hop_path"]
        assert event["hop_path"][-1] == engine.home_gs[relay]
    stored_at_relay = [e for e in engine.events if e["status"] == "stored" and e["node_id"] == relay]
    assert stored_at_relay, "relay must store bundles before forwarding"
    # nothing reached the ground over the broken direct link after the switch
    switch_seq = next(e["seq"] for e in engine.events if e["type"] == "protocol_switch")
    assert not any(
        e["seq"] > switch_seq and e["status"] == "delivered" and e["hop_path"] == [affected, gs] for e in engine.events
    )
    final = engine.events[-1]
    assert final["type"] == "run_resolved"
    assert final["message"] == f"{len(own)}/{len(own)} bundles delivered via {relay}"


def test_lost_packets_are_recovered_by_dtn():
    engine = started(5)
    run_until_halt(engine)
    engine.solve()
    run_until_halt(engine)
    stats = engine.affected_stats()
    assert stats["lost"] >= 1
    assert stats["recovered"] == stats["lost"]
    assert stats["delivery_ratio"] == 1.0


def test_controls_are_phase_gated():
    engine = FlowEngine(generate_scenario(9))
    with pytest.raises(SimulationActionError):
        engine.solve()
    with pytest.raises(SimulationActionError):
        engine.sever("SAT-01")
    engine.start()
    with pytest.raises(SimulationActionError):
        engine.start()
    with pytest.raises(SimulationActionError):
        engine.solve()
    with pytest.raises(SimulationActionError):
        engine.sever("SAT-99")


def test_manual_sever_overrides_the_planned_failure():
    for seed in range(6):
        engine = started(seed)
        planned = engine.scenario.failure.satellite_id
        other = next(s for s in engine.sat_ids if s != planned)
        engine.step()
        engine.sever(other)
        assert engine.phase == Phase.DEGRADING
        run_until_halt(engine)
        assert engine.anomaly["satellite_id"] == other
        assert "severed" in engine.anomaly["probable_cause"].lower()
        engine.solve()
        run_until_halt(engine)
        assert engine.phase == Phase.RESOLVED


def test_sever_during_degrading_restores_previous_link():
    engine = started(13)
    while engine.phase == Phase.STABLE:
        engine.step()
    planned_link = engine.target_link
    other = next(s for s in engine.sat_ids if s != engine.target_sat)
    engine.sever(other)
    restored = engine.links[planned_link]
    assert restored.is_available and restored.reliability == engine.baseline_reliability[planned_link]
    assert any(e["type"] == "link_recovered" and e["link_id"] == planned_link for e in engine.events)


def test_full_run_is_deterministic_per_seed():
    def trace(seed: int):
        engine = started(seed)
        run_until_halt(engine)
        engine.solve()
        run_until_halt(engine)
        return [(e["t"], e["type"], e["status"], e["packet_id"], e["link_id"]) for e in engine.events]

    assert trace(17) == trace(17)
    assert trace(17) != trace(18)


def test_counterfactual_matches_live_run_until_detection_and_loses_packets():
    engine = started(4)
    run_until_halt(engine)
    detected_at = engine.anomaly["detected_at"]
    engine.solve()
    run_until_halt(engine)
    cf = run_counterfactual(engine.scenario, engine.actions, engine.affected_quota)
    live_before = [(e["t"], e["status"], e["packet_id"]) for e in engine.events if e["type"] == "packet" and e["t"] < detected_at]
    cf_before = [(e["t"], e["status"], e["packet_id"]) for e in cf.events if e["type"] == "packet" and e["t"] < detected_at]
    assert live_before == cf_before

    comparison = comparison_from(engine, cf)
    direct, dtn = comparison["direct_only"], comparison["with_dtn"]
    assert direct["total"] == dtn["total"] == engine.affected_quota
    assert direct["recovered"] == 0
    assert direct["delivery_ratio"] < dtn["delivery_ratio"] == 1.0
    assert direct["lost"] >= dtn["lost"]
    assert comparison["final"] is True


def test_every_seed_reaches_resolution():
    for seed in range(100, 130):
        engine = started(seed)
        run_until_halt(engine)
        assert engine.phase == Phase.DETECTED, seed
        engine.solve()
        run_until_halt(engine)
        assert engine.phase == Phase.RESOLVED, seed
