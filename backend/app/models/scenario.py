"""Scenario configuration models."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.models.link import LinkScheduleItem
from app.models.node import NodePosition
from app.models.packet import PacketPriority


class TrafficFlow(BaseModel):
    source: str
    destination: str
    packets_per_second: float = Field(default=1.0, ge=0.01)
    payload_size_bytes: int = Field(default=4096, ge=1)
    priority: PacketPriority = PacketPriority.NORMAL
    ttl_seconds: Optional[float] = Field(default=120.0, ge=1.0)
    max_hops: int = Field(default=20, ge=1)
    start_time: float = Field(default=0.0, ge=0.0)
    stop_time: Optional[float] = None
    packet_count_limit: Optional[int] = None


class LinkConfig(BaseModel):
    id: str
    source: str
    target: str
    latency_ms: float = Field(default=20.0, ge=0.1)
    bandwidth_mbps: float = Field(default=10.0, ge=0.01)
    reliability: float = Field(default=1.0, ge=0.0, le=1.0)
    symmetric: bool = True
    schedule: List[LinkScheduleItem] = Field(default_factory=list)


class SatelliteConfig(BaseModel):
    id: str
    position: Optional[NodePosition] = None
    buffer_capacity_bytes: int = 1048576
    energy_percent: float = 100.0


class GroundStationConfig(BaseModel):
    id: str
    position: Optional[NodePosition] = None


class NetworkConfig(BaseModel):
    satellites: List[SatelliteConfig] = Field(default_factory=list)
    ground_stations: List[GroundStationConfig] = Field(default_factory=list)
    default_buffer_capacity_bytes: int = 1048576


class RoutingWeights(BaseModel):
    progress: float = 0.30
    reliability: float = 0.20
    contact_feasibility: float = 0.20
    latency: float = 0.15
    congestion: float = 0.10
    energy: float = 0.05


class RoutingConfig(BaseModel):
    policy: str = "swarmnet"  # 'baseline' or 'swarmnet'
    weights: RoutingWeights = Field(default_factory=RoutingWeights)


class ScenarioMeta(BaseModel):
    id: str
    name: Optional[str] = None
    description: Optional[str] = None
    seed: int = 42
    duration_seconds: float = 60.0
    tick_seconds: float = 1.0


class ScenarioConfig(BaseModel):
    scenario: ScenarioMeta
    network: NetworkConfig
    traffic: List[TrafficFlow] = Field(default_factory=list)
    routing: RoutingConfig = Field(default_factory=RoutingConfig)
    links: List[LinkConfig] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
