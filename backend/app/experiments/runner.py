"""Automated experiment runner executing controlled comparisons between Baseline and SWARMNET."""

import csv
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import time

from app.simulation.scenarios import ScenarioLoader
from app.simulation.engine import SimulationEngine
from app.models.scenario import ScenarioConfig


class ExperimentRunner:
    """Executes deterministic head-to-head policy evaluations across scenarios."""

    SCENARIOS = [
        "basic_delivery",
        "intermittent_contact",
        "route_disruption",
        "buffer_pressure",
    ]

    def __init__(self, output_dir: Optional[str] = None):
        if output_dir is None:
            self.output_dir = Path("data") / "experiments"
        else:
            self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run_scenario_with_policy(
        self, scenario_id: str, policy: str, seed: int = 42
    ) -> Dict[str, Any]:
        scenario = ScenarioLoader.load_scenario_by_id(scenario_id)
        if not scenario:
            raise ValueError(f"Scenario '{scenario_id}' not found.")

        scen_clone = scenario.model_copy(deep=True)
        scen_clone.scenario.seed = seed
        scen_clone.routing.policy = policy

        engine = SimulationEngine(scen_clone)
        while not engine.clock.has_ended():
            engine.step(1)

        metrics = engine.metrics.model_dump()
        return {
            "scenario_id": scenario_id,
            "scenario_name": scenario.scenario.name,
            "policy": policy,
            "seed": seed,
            "duration": scenario.scenario.duration_seconds,
            "metrics": metrics,
        }

    def run_head_to_head(self, scenario_id: str, seed: int = 42) -> Dict[str, Any]:
        baseline_res = self.run_scenario_with_policy(scenario_id, "baseline", seed)
        swarmnet_res = self.run_scenario_with_policy(scenario_id, "swarmnet", seed)

        b_metrics = baseline_res["metrics"]
        s_metrics = swarmnet_res["metrics"]

        comparison = {
            "scenario_id": scenario_id,
            "scenario_name": baseline_res["scenario_name"],
            "seed": seed,
            "baseline": b_metrics,
            "swarmnet": s_metrics,
            "delta": {
                "delivery_ratio_delta": round(s_metrics["delivery_ratio"] - b_metrics["delivery_ratio"], 4),
                "packets_delivered_delta": s_metrics["packets_delivered"] - b_metrics["packets_delivered"],
                "packets_dropped_delta": s_metrics["packets_dropped"] - b_metrics["packets_dropped"],
                "mean_delay_delta_sec": round(s_metrics["mean_delay_seconds"] - b_metrics["mean_delay_seconds"], 3),
                "p95_delay_delta_sec": round(s_metrics["p95_delay_seconds"] - b_metrics["p95_delay_seconds"], 3),
                "mean_hop_delta": round(s_metrics["mean_hop_count"] - b_metrics["mean_hop_count"], 2),
            },
        }
        return comparison

    def run_all(self, seed: int = 42) -> List[Dict[str, Any]]:
        results = []
        for scen_id in self.SCENARIOS:
            comp = self.run_head_to_head(scen_id, seed=seed)
            results.append(comp)

        self._export_json(results)
        self._export_csv(results)
        return results

    def _export_json(self, results: List[Dict[str, Any]]) -> str:
        timestamp = int(time.time())
        filepath = self.output_dir / f"benchmark_results_{timestamp}.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        # Also maintain a latest.json pointer
        latest_path = self.output_dir / "latest_benchmark.json"
        with open(latest_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        return str(filepath)

    def _export_csv(self, results: List[Dict[str, Any]]) -> str:
        timestamp = int(time.time())
        filepath = self.output_dir / f"benchmark_results_{timestamp}.csv"
        headers = [
            "Scenario ID",
            "Scenario Name",
            "Seed",
            "Policy",
            "Generated",
            "Delivered",
            "Pending",
            "Dropped",
            "Delivery Ratio",
            "Mean Delay (s)",
            "Median Delay (s)",
            "P95 Delay (s)",
            "Mean Hops",
            "Delivered Bytes",
        ]

        rows = []
        for item in results:
            sid = item["scenario_id"]
            sname = item["scenario_name"]
            seed = item["seed"]
            # Baseline row
            b = item["baseline"]
            rows.append([
                sid,
                sname,
                seed,
                "baseline",
                b["packets_generated"],
                b["packets_delivered"],
                b["packets_pending"],
                b["packets_dropped"],
                f"{b['delivery_ratio'] * 100:.1f}%",
                b["mean_delay_seconds"],
                b["median_delay_seconds"],
                b["p95_delay_seconds"],
                b["mean_hop_count"],
                b["total_bytes_delivered"],
            ])
            # SWARMNET row
            s = item["swarmnet"]
            rows.append([
                sid,
                sname,
                seed,
                "swarmnet",
                s["packets_generated"],
                s["packets_delivered"],
                s["packets_pending"],
                s["packets_dropped"],
                f"{s['delivery_ratio'] * 100:.1f}%",
                s["mean_delay_seconds"],
                s["median_delay_seconds"],
                s["p95_delay_seconds"],
                s["mean_hop_count"],
                s["total_bytes_delivered"],
            ])

        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(rows)

        latest_path = self.output_dir / "latest_benchmark.csv"
        with open(latest_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(rows)

        return str(filepath)


def print_comparison_table(results: List[Dict[str, Any]]):
    print("=" * 86)
    print(" SWARMNET vs. BASELINE — SYSTEMATIC EXPERIMENTAL EVALUATION")
    print("=" * 86)
    header = f"{'Scenario':<22} | {'Metric':<18} | {'Baseline':<12} | {'SWARMNET':<12} | {'Delta':<12}"
    print(header)
    print("-" * 86)

    for r in results:
        sname = r["scenario_id"]
        b = r["baseline"]
        s = r["swarmnet"]
        d = r["delta"]

        # Row 1: Delivery Ratio
        d_ratio_diff = f"{d['delivery_ratio_delta'] * 100:+.1f}%"
        print(f"{sname:<22} | {'Delivery Ratio':<18} | {b['delivery_ratio']*100:>10.1f}% | {s['delivery_ratio']*100:>10.1f}% | {d_ratio_diff:>12}")
        # Row 2: Packets Delivered
        b_del_gen = f"{b['packets_delivered']}/{b['packets_generated']}"
        s_del_gen = f"{s['packets_delivered']}/{s['packets_generated']}"
        d_pkts_diff = f"{d['packets_delivered_delta']:+d}"
        print(f"{'':<22} | {'Delivered / Gen':<18} | {b_del_gen:>12} | {s_del_gen:>12} | {d_pkts_diff:>12}")
        # Row 3: Mean Delay
        d_delay_diff = f"{d['mean_delay_delta_sec']:+.2f}s"
        print(f"{'':<22} | {'Mean Latency':<18} | {b['mean_delay_seconds']:>10.2f}s  | {s['mean_delay_seconds']:>10.2f}s  | {d_delay_diff:>12}")
        # Row 4: Dropped
        d_drop_diff = f"{d['packets_dropped_delta']:+d}"
        print(f"{'':<22} | {'Dropped Packets':<18} | {b['packets_dropped']:>12} | {s['packets_dropped']:>12} | {d_drop_diff:>12}")
        print("-" * 86)
    print("=" * 86)


if __name__ == "__main__":
    runner = ExperimentRunner()
    results = runner.run_all(seed=42)
    print_comparison_table(results)
