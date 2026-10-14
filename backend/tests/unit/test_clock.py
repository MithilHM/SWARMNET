"""Unit tests for discrete simulation clock."""

import pytest
from app.simulation.clock import SimulationClock


def test_clock_stepping():
    clock = SimulationClock(tick_seconds=1.0, max_duration=10.0)
    assert clock.simulated_time == 0.0
    assert not clock.has_ended()

    t = clock.step(3)
    assert t == 3.0
    assert clock.simulated_time == 3.0

    clock.step(7)
    assert clock.simulated_time == 10.0
    assert clock.has_ended()

    # Stepping further should not exceed max_duration
    clock.step(2)
    assert clock.simulated_time == 10.0


def test_clock_callbacks():
    clock = SimulationClock(tick_seconds=0.5, max_duration=5.0)
    ticks_seen = []
    clock.register_tick_callback(lambda t: ticks_seen.append(t))

    clock.step(4)
    assert ticks_seen == [0.5, 1.0, 1.5, 2.0]


def test_clock_reset():
    clock = SimulationClock(tick_seconds=1.0, max_duration=10.0)
    clock.start()
    clock.step(5)
    assert clock.simulated_time == 5.0
    clock.reset()
    assert clock.simulated_time == 0.0
    assert not clock.is_running
