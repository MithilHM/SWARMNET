"""Simulation run and metrics summary models."""

import uuid
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class MetricsSummary(BaseModel):
    packets_generated: int = 0
    packets_delivered: int = 0
    packets_dropped: int = 0
    packets_dropped_by_reason: Dict[str, int] = Field(default_factory=dict)
    packets_expired: int = 0
    packets_pending: int = 0
    packets_in_transit: int = 0
    delivery_ratio: float = 0.0
    mean_delay_seconds: float = 0.0
    median_delay_seconds: float = 0.0
    p95_delay_seconds: float = 0.0
    mean_hop_count: float = 0.0
    total_bytes_generated: int = 0
    total_bytes_delivered: int = 0
    mean_time_buffered_seconds: float = 0.0
    route_changes_count: int = 0
    buffer_occupancy_by_node: Dict[str, int] = Field(default_factory=dict)
    link_transferred_bytes: Dict[str, int] = Field(default_factory=dict)


class SimulationRun(BaseModel):
    run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    scenario_id: str
    seed: int = 42
    routing_policy: str = "swarmnet"
    started_at: float = 0.0
    simulated_duration: float = 60.0
    current_sim_time: float = 0.0
    status: RunStatus = RunStatus.QUEUED
    config_snapshot: Dict[str, Any] = Field(default_factory=dict)
    metrics_summary: MetricsSummary = Field(default_factory=MetricsSummary)
    error_message: Optional[str] = None
