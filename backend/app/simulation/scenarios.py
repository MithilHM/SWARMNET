"""Scenario loader and bundled scenario factory."""

import os
from pathlib import Path
from typing import Dict, List, Optional
import yaml

from app.models.scenario import (
    ScenarioConfig,
    ScenarioMeta,
    NetworkConfig,
    SatelliteConfig,
    GroundStationConfig,
    LinkConfig,
    TrafficFlow,
    RoutingConfig,
    RoutingWeights,
)
from app.models.link import LinkScheduleItem
from app.models.node import NodePosition
from app.models.packet import PacketPriority


class ScenarioLoader:
    @staticmethod
    def load_from_yaml(file_path: str) -> ScenarioConfig:
        with open(file_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return ScenarioLoader.load_from_dict(data)

    @staticmethod
    def load_from_dict(data: dict) -> ScenarioConfig:
        # Handle cases where network.satellites or network.ground_stations are given as an int
        net_data = data.get("network", {})
        if isinstance(net_data.get("satellites"), int):
            count = net_data["satellites"]
            net_data["satellites"] = [
                {"id": f"SAT-{i+1:02d}", "position": {"x": 100 * (i + 1), "y": 150}}
                for i in range(count)
            ]
        if isinstance(net_data.get("ground_stations"), int):
            count = net_data["ground_stations"]
            net_data["ground_stations"] = [
                {"id": f"GROUND-{i+1:02d}", "position": {"x": 500, "y": 150}}
                for i in range(count)
            ]
        return ScenarioConfig.model_validate(data)

    @staticmethod
    def get_bundled_scenarios_dir() -> Path:
        # Check standard scenarios/ path relative to project root or workspace
        candidates = [
            Path("scenarios"),
            Path("../scenarios"),
            Path(__file__).parent.parent.parent.parent / "scenarios",
        ]
        for p in candidates:
            if p.exists() and p.is_dir():
                return p
        return Path("scenarios")

    @staticmethod
    def list_available_scenarios() -> List[str]:
        scenarios_dir = ScenarioLoader.get_bundled_scenarios_dir()
        if not scenarios_dir.exists():
            return []
        return [
            f.stem for f in scenarios_dir.glob("*.yaml")
        ]

    @staticmethod
    def load_scenario_by_id(scenario_id: str) -> Optional[ScenarioConfig]:
        scenarios_dir = ScenarioLoader.get_bundled_scenarios_dir()
        file_path = scenarios_dir / f"{scenario_id}.yaml"
        if not file_path.exists():
            return None
        return ScenarioLoader.load_from_yaml(str(file_path))
