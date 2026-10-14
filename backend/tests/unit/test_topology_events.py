"""Unit tests for topology and scheduled event handling."""

import pytest
from app.simulation.scenarios import ScenarioLoader
from app.simulation.engine import SimulationEngine
from app.models.event import EventType


def test_intermittent_contact_events():
    scenario = ScenarioLoader.load_scenario_by_id("intermittent_contact")
    assert scenario is not None
    engine = SimulationEngine(scenario)

    # Initial state: SAT-02-GROUND-01 should be available at t=0
    link = engine.topology.links["SAT-02-GROUND-01"]
    assert link.is_available is True

    # Step to t=10s: link should go down
    engine.step(10)
    assert engine.clock.simulated_time == 10.0
    assert link.is_available is False

    # Check that LINK_DOWN was emitted
    down_events = [
        e for e in engine.event_scheduler.event_history
        if e.link_id == "SAT-02-GROUND-01" and e.event_type == EventType.LINK_DOWN
    ]
    assert len(down_events) >= 1
    assert down_events[0].simulated_time == 10.0

    # Step to t=35s: link should recover
    engine.step(25)  # now at t=35.0
    assert engine.clock.simulated_time == 35.0
    assert link.is_available is True

    up_events = [
        e for e in engine.event_scheduler.event_history
        if e.link_id == "SAT-02-GROUND-01" and e.event_type == EventType.LINK_UP
    ]
    assert len(up_events) >= 1
    assert up_events[0].simulated_time == 35.0
