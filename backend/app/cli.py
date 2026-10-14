"""Command line interface for deterministic topology simulation."""

import argparse
import sys
from pathlib import Path

# Add backend to sys.path if not present
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.simulation.scenarios import ScenarioLoader
from app.simulation.engine import SimulationEngine


def main():
    parser = argparse.ArgumentParser(description="SWARMNET Deterministic Simulator CLI")
    parser.add_argument(
        "--scenario",
        type=str,
        default="intermittent_contact",
        help="Scenario ID (e.g., basic_delivery, intermittent_contact, route_disruption)",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=None,
        help="Override simulation duration in seconds",
    )
    parser.add_argument(
        "--step",
        type=int,
        default=5,
        help="Ticks per printed output interval",
    )
    args = parser.parse_args()

    scenario_config = ScenarioLoader.load_scenario_by_id(args.scenario)
    if not scenario_config:
        # Try loading directly as path
        if Path(args.scenario).exists():
            scenario_config = ScenarioLoader.load_from_yaml(args.scenario)
        else:
            print(f"Error: Scenario '{args.scenario}' not found.")
            sys.exit(1)

    if args.duration is not None:
        scenario_config.scenario.duration_seconds = args.duration

    engine = SimulationEngine(scenario_config)
    print(f"==================================================")
    print(f" SWARMNET Topology Simulation: {scenario_config.scenario.name}")
    print(f" Scenario ID : {scenario_config.scenario.id}")
    print(f" Seed        : {scenario_config.scenario.seed}")
    print(f" Duration    : {scenario_config.scenario.duration_seconds}s (tick={scenario_config.scenario.tick_seconds}s)")
    print(f" Satellites  : {len(scenario_config.network.satellites)}")
    print(f" Ground Stns : {len(scenario_config.network.ground_stations)}")
    print(f" Links       : {len(scenario_config.links)}")
    print(f"==================================================\n")

    while not engine.clock.has_ended():
        engine.step(args.step)
        t = engine.clock.simulated_time
        active_links = [
            f"{lnk.source_node_id}->{lnk.target_node_id}"
            for lnk in engine.topology.links.values()
            if lnk.is_available
        ]
        recent_events = [
            f"[{e.event_type.value}] {e.link_id}"
            for e in engine.event_scheduler.event_history
            if e.simulated_time == t
        ]
        event_str = f" | Events: {', '.join(recent_events)}" if recent_events else ""
        print(f"t={t:5.1f}s | Active links ({len(active_links)}): {', '.join(active_links[:5])}{'...' if len(active_links) > 5 else ''}{event_str}")

    print("\nSimulation complete. Total events recorded:", len(engine.event_scheduler.event_history))


if __name__ == "__main__":
    main()
