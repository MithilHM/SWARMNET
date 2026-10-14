"""RunManager coordinating simulation execution, lifecycle, state queries, and policy comparisons."""

import asyncio
import copy
import io
import csv
import json
import time
import uuid
from typing import Any, Dict, List, Optional

from app.models.run import SimulationRun, RunStatus, MetricsSummary
from app.models.scenario import ScenarioConfig, RoutingConfig
from app.simulation.engine import SimulationEngine
from app.simulation.scenarios import ScenarioLoader
from app.persistence.database import DatabaseManager


class RunInstance:
    def __init__(self, run_id: str, engine: SimulationEngine, scenario: ScenarioConfig):
        self.run_id = run_id
        self.engine = engine
        self.scenario = scenario
        self.status = RunStatus.QUEUED
        self.started_at = time.time()
        self.background_task: Optional[asyncio.Task] = None
        self.event_subscribers: List[asyncio.Queue] = []

    def broadcast_event(self, event_data: dict) -> None:
        for queue in list(self.event_subscribers):
            try:
                queue.put_nowait(event_data)
            except asyncio.QueueFull:
                pass


class RunManager:
    def __init__(self, db: Optional[DatabaseManager] = None):
        self.db = db if db is not None else DatabaseManager()
        self.active_runs: Dict[str, RunInstance] = {}

    def create_run(
        self,
        scenario_id: str,
        seed: Optional[int] = None,
        routing_policy: Optional[str] = None,
        duration: Optional[float] = None,
    ) -> SimulationRun:
        scenario = ScenarioLoader.load_scenario_by_id(scenario_id)
        if not scenario:
            raise ValueError(f"Scenario '{scenario_id}' not found.")

        # Clone config so modifications do not pollute global definition
        scenario_clone = scenario.model_copy(deep=True)
        if seed is not None:
            scenario_clone.scenario.seed = seed
        if duration is not None:
            scenario_clone.scenario.duration_seconds = duration
        if routing_policy is not None:
            scenario_clone.routing.policy = routing_policy

        engine = SimulationEngine(scenario_clone)
        run_id = f"RUN-{scenario_id[:6]}-{uuid.uuid4().hex[:8]}"

        run_inst = RunInstance(run_id, engine, scenario_clone)
        self.active_runs[run_id] = run_inst

        # Register event forwarding
        def on_event(evt):
            run_inst.broadcast_event(evt.model_dump())

        engine.register_event_listener(on_event)

        # Save initial state in DB
        self._persist_run(run_inst)

        return SimulationRun(
            run_id=run_id,
            scenario_id=scenario_id,
            seed=scenario_clone.scenario.seed,
            routing_policy=scenario_clone.routing.policy,
            started_at=run_inst.started_at,
            simulated_duration=scenario_clone.scenario.duration_seconds,
            current_sim_time=0.0,
            status=run_inst.status,
            config_snapshot=scenario_clone.model_dump(),
            metrics_summary=engine.metrics,
        )

    def step_run(self, run_id: str, ticks: int = 1) -> Dict[str, Any]:
        inst = self.active_runs.get(run_id)
        if not inst:
            raise KeyError(f"Run '{run_id}' not found.")

        sim_time = inst.engine.step(ticks)
        if inst.engine.clock.has_ended():
            inst.status = RunStatus.COMPLETED
        else:
            inst.status = RunStatus.RUNNING

        self._persist_run(inst)
        return {
            "run_id": run_id,
            "simulated_time": sim_time,
            "has_ended": inst.engine.clock.has_ended(),
            "metrics": inst.engine.metrics.model_dump(),
        }

    def pause_run(self, run_id: str) -> Dict[str, Any]:
        inst = self.active_runs.get(run_id)
        if not inst:
            raise KeyError(f"Run '{run_id}' not found.")

        inst.engine.clock.pause()
        inst.status = RunStatus.PAUSED
        self._persist_run(inst)
        return {"run_id": run_id, "status": inst.status.value}

    def resume_run(self, run_id: str) -> Dict[str, Any]:
        inst = self.active_runs.get(run_id)
        if not inst:
            raise KeyError(f"Run '{run_id}' not found.")

        inst.engine.clock.resume()
        inst.status = RunStatus.RUNNING
        self._persist_run(inst)
        return {"run_id": run_id, "status": inst.status.value}

    def reset_run(self, run_id: str) -> Dict[str, Any]:
        inst = self.active_runs.get(run_id)
        if not inst:
            raise KeyError(f"Run '{run_id}' not found.")

        inst.engine.reset()
        inst.status = RunStatus.QUEUED
        self._persist_run(inst)
        return {
            "run_id": run_id,
            "status": inst.status.value,
            "simulated_time": 0.0,
            "metrics": inst.engine.metrics.model_dump(),
        }

    def get_run_info(self, run_id: str) -> Optional[Dict[str, Any]]:
        inst = self.active_runs.get(run_id)
        if inst:
            return {
                "run_id": run_id,
                "scenario_id": inst.scenario.scenario.id,
                "seed": inst.scenario.scenario.seed,
                "routing_policy": inst.scenario.routing.policy,
                "started_at": inst.started_at,
                "simulated_duration": inst.scenario.scenario.duration_seconds,
                "current_sim_time": inst.engine.clock.simulated_time,
                "status": inst.status.value,
                "config_snapshot": inst.scenario.model_dump(),
                "metrics_summary": inst.engine.metrics.model_dump(),
            }
        return self.db.get_run(run_id)

    def get_topology(self, run_id: str) -> Dict[str, Any]:
        inst = self.active_runs.get(run_id)
        if not inst:
            raise KeyError(f"Run '{run_id}' not found.")

        satellites = [
            sat.model_dump() for sat in inst.engine.topology.satellites.values()
        ]
        ground_stations = [
            gs.model_dump() for gs in inst.engine.topology.ground_stations.values()
        ]
        links = [
            link.model_dump() for link in inst.engine.topology.links.values()
        ]
        in_transit = inst.engine.transport.get_in_transit_packets()

        return {
            "run_id": run_id,
            "simulated_time": inst.engine.clock.simulated_time,
            "satellites": satellites,
            "ground_stations": ground_stations,
            "links": links,
            "in_transit": in_transit,
        }

    def get_metrics(self, run_id: str) -> Dict[str, Any]:
        inst = self.active_runs.get(run_id)
        if not inst:
            saved = self.db.get_run(run_id)
            if saved:
                return saved["metrics_summary"]
            raise KeyError(f"Run '{run_id}' not found.")

        return inst.engine.metrics.model_dump()

    def get_events(self, run_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        inst = self.active_runs.get(run_id)
        if not inst:
            return []
        events = inst.engine.event_scheduler.event_history[-limit:]
        return [e.model_dump() for e in events]

    def get_packets(self, run_id: str) -> Dict[str, Any]:
        inst = self.active_runs.get(run_id)
        if not inst:
            return {"packets": []}

        # Combine all packets known to engine
        packets_list = [p.model_dump() for p in inst.engine.all_packets.values()]
        return {
            "run_id": run_id,
            "simulated_time": inst.engine.clock.simulated_time,
            "packets": packets_list,
        }

    def get_decisions(self, run_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        inst = self.active_runs.get(run_id)
        if not inst:
            return []
        decisions = inst.engine.all_decisions[-limit:]
        return [d.model_dump() for d in decisions]

    def compare_policies(self, scenario_id: str, seed: int = 42) -> Dict[str, Any]:
        """Run identical scenario & seed with baseline vs swarmnet policies and return comparative metrics."""
        scenario_base = ScenarioLoader.load_scenario_by_id(scenario_id)
        if not scenario_base:
            raise ValueError(f"Scenario '{scenario_id}' not found.")

        # 1. Baseline run
        scen_baseline = scenario_base.model_copy(deep=True)
        scen_baseline.scenario.seed = seed
        scen_baseline.routing.policy = "baseline"
        engine_base = SimulationEngine(scen_baseline)
        while not engine_base.clock.has_ended():
            engine_base.step(1)

        # 2. SWARMNET run
        scen_swarm = scenario_base.model_copy(deep=True)
        scen_swarm.scenario.seed = seed
        scen_swarm.routing.policy = "swarmnet"
        engine_swarm = SimulationEngine(scen_swarm)
        while not engine_swarm.clock.has_ended():
            engine_swarm.step(1)

        exp_id = f"EXP-{scenario_id[:6]}-{uuid.uuid4().hex[:6]}"
        comparison = {
            "experiment_id": exp_id,
            "scenario_id": scenario_id,
            "seed": seed,
            "baseline": {
                "policy": "baseline",
                "metrics": engine_base.metrics.model_dump(),
            },
            "swarmnet": {
                "policy": "swarmnet",
                "metrics": engine_swarm.metrics.model_dump(),
            },
            "comparison_summary": {
                "delivery_ratio_diff": round(
                    engine_swarm.metrics.delivery_ratio - engine_base.metrics.delivery_ratio, 4
                ),
                "delivered_count_diff": (
                    engine_swarm.metrics.packets_delivered - engine_base.metrics.packets_delivered
                ),
                "mean_delay_diff": round(
                    engine_swarm.metrics.mean_delay_seconds - engine_base.metrics.mean_delay_seconds, 3
                ),
                "dropped_diff": (
                    engine_swarm.metrics.packets_dropped - engine_base.metrics.packets_dropped
                ),
            },
        }

        # Persist experiment
        self.db.save_experiment(
            experiment_id=exp_id,
            scenario_id=scenario_id,
            seed=seed,
            baseline_run_id=None,
            swarmnet_run_id=None,
            comparison=comparison,
        )

        return comparison

    def export_run(self, run_id: str, export_format: str = "json") -> str:
        info = self.get_run_info(run_id)
        if not info:
            raise KeyError(f"Run '{run_id}' not found.")

        if export_format.lower() == "csv":
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["Metric", "Value"])
            writer.writerow(["run_id", info["run_id"]])
            writer.writerow(["scenario_id", info["scenario_id"]])
            writer.writerow(["seed", info["seed"]])
            writer.writerow(["routing_policy", info["routing_policy"]])
            writer.writerow(["simulated_duration", info["simulated_duration"]])
            writer.writerow(["current_sim_time", info["current_sim_time"]])
            writer.writerow(["status", info["status"]])
            for k, v in info["metrics_summary"].items():
                if not isinstance(v, dict):
                    writer.writerow([k, v])
            return output.getvalue()
        else:
            return json.dumps(info, indent=2)

    def _persist_run(self, inst: RunInstance) -> None:
        self.db.save_run(
            run_id=inst.run_id,
            scenario_id=inst.scenario.scenario.id,
            seed=inst.scenario.scenario.seed,
            routing_policy=inst.scenario.routing.policy,
            started_at=inst.started_at,
            simulated_duration=inst.scenario.scenario.duration_seconds,
            current_sim_time=inst.engine.clock.simulated_time,
            status=inst.status.value,
            config_snapshot=inst.scenario.model_dump(),
            metrics_summary=inst.engine.metrics.model_dump(),
        )
