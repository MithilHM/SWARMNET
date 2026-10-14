"""Integration tests verifying end-to-end multi-hop delivery and delay-tolerant store-carry-forward."""

import pytest
from app.simulation.scenarios import ScenarioLoader
from app.simulation.engine import SimulationEngine
from app.models.scenario import RoutingConfig


def test_basic_multi_hop_delivery():
    scenario = ScenarioLoader.load_scenario_by_id("basic_delivery")
    assert scenario is not None
    # Force baseline policy to verify Phase 3 baseline
    scenario.routing = RoutingConfig(policy="baseline")
    engine = SimulationEngine(scenario)

    while not engine.clock.has_ended():
        engine.step(1)

    # All generated packets should reach GROUND-01
    assert engine.metrics.packets_generated == 5
    assert engine.metrics.packets_delivered == 5
    assert engine.metrics.delivery_ratio == 1.0
    assert engine.metrics.mean_hop_count > 1.0  # Must traverse multiple hops
    assert len(engine.ground_agents["GROUND-01"].received_packets) == 5


def test_intermittent_contact_store_carry_forward():
    scenario = ScenarioLoader.load_scenario_by_id("intermittent_contact")
    assert scenario is not None
    scenario.routing = RoutingConfig(policy="baseline")
    engine = SimulationEngine(scenario)

    # Traffic is generated between t=12 and t=16.
    # The SAT-02-GROUND-01 link is down between t=10 and t=35.
    # At t=25, all generated packets should be buffered at SAT-01 or SAT-02, and 0 delivered to GROUND-01.
    while engine.clock.simulated_time < 25.0:
        engine.step(1)

    assert engine.metrics.packets_generated == 4
    assert engine.metrics.packets_delivered == 0
    # Packets must be buffered in the constellation
    assert engine.metrics.packets_pending == 4

    # Now step past t=35 to t=45 when link is restored
    while engine.clock.simulated_time < 45.0:
        engine.step(1)

    # Buffered packets must now resume forwarding and reach GROUND-01
    assert engine.metrics.packets_delivered == 4
    assert engine.metrics.delivery_ratio == 1.0
    assert engine.metrics.packets_pending == 0


def test_route_disruption_swarmnet():
    scenario = ScenarioLoader.load_scenario_by_id("route_disruption")
    assert scenario is not None
    assert scenario.routing.policy == "swarmnet"
    engine = SimulationEngine(scenario)

    while not engine.clock.has_ended():
        engine.step(1)

    # Deliveries must occur and packets must survive the disruptions
    assert engine.metrics.packets_generated > 0
    assert engine.metrics.packets_delivered > 0
    assert engine.metrics.delivery_ratio >= 0.8
    assert engine.metrics.packets_pending > 0
    # Decisions must include BEST_SCORE
    swarmnet_decisions = [
        d for d in engine.all_decisions if d.routing_policy == "swarmnet"
    ]
    assert len(swarmnet_decisions) > 0
