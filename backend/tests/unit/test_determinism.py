"""Unit tests verifying reproducibility and determinism."""

import pytest
from app.simulation.scenarios import ScenarioLoader
from app.simulation.engine import SimulationEngine


def test_simulation_determinism():
    scenario1 = ScenarioLoader.load_scenario_by_id("route_disruption")
    scenario2 = ScenarioLoader.load_scenario_by_id("route_disruption")

    engine1 = SimulationEngine(scenario1)
    engine2 = SimulationEngine(scenario2)

    # Step both engines to completion
    while not engine1.clock.has_ended():
        engine1.step(1)
        engine2.step(1)

    # Both must have identical simulated time
    assert engine1.clock.simulated_time == engine2.clock.simulated_time

    # Both must have identical event sequences
    events1 = [(e.simulated_time, e.event_type, e.link_id) for e in engine1.event_scheduler.event_history]
    events2 = [(e.simulated_time, e.event_type, e.link_id) for e in engine2.event_scheduler.event_history]
    assert events1 == events2
    assert len(events1) > 0


def test_simulation_reset():
    scenario = ScenarioLoader.load_scenario_by_id("route_disruption")
    engine = SimulationEngine(scenario)

    engine.step(20)
    assert engine.clock.simulated_time == 20.0
    events_before = list(engine.event_scheduler.event_history)

    engine.reset()
    assert engine.clock.simulated_time == 0.0
    assert len(engine.event_scheduler.event_history) == 0

    engine.step(20)
    events_after = list(engine.event_scheduler.event_history)
    assert len(events_before) == len(events_after)
