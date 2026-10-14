"""Node models: Satellite and Ground Station."""

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class NodeStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class NodePosition(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    orbit_plane: Optional[int] = None
    orbit_index: Optional[int] = None


class SatelliteNode(BaseModel):
    satellite_id: str
    position: Optional[NodePosition] = None
    energy_percent: float = Field(default=100.0, ge=0.0, le=100.0)
    buffer_capacity_bytes: int = Field(default=1048576, ge=1024)  # 1MB default
    buffer_used_bytes: int = Field(default=0, ge=0)
    status: NodeStatus = NodeStatus.ACTIVE
    neighbors: List[str] = Field(default_factory=list)
    routing_table: Dict[str, Any] = Field(default_factory=dict)
    last_state_update: float = 0.0


class GroundStationNode(BaseModel):
    ground_station_id: str
    position: Optional[NodePosition] = None
    status: NodeStatus = NodeStatus.ACTIVE
    received_packet_ids: List[str] = Field(default_factory=list)
    total_bytes_received: int = Field(default=0, ge=0)
    last_contact_time: Optional[float] = None
