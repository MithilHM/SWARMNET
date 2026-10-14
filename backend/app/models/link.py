"""Link model and schedule definitions."""

from typing import Optional
from pydantic import BaseModel, Field


class LinkScheduleItem(BaseModel):
    start: float = Field(ge=0.0)
    end: float = Field(ge=0.0)
    available: bool = True
    latency_ms: Optional[float] = None
    bandwidth_mbps: Optional[float] = None
    reliability: Optional[float] = None


class Link(BaseModel):
    link_id: str
    source_node_id: str
    target_node_id: str
    is_available: bool = True
    latency_ms: float = Field(default=20.0, ge=0.1)
    bandwidth_mbps: float = Field(default=10.0, ge=0.01)
    reliability: float = Field(default=1.0, ge=0.0, le=1.0)
    contact_end_time: Optional[float] = None
    last_updated_at: float = 0.0
    failure_reason: Optional[str] = None

    def transfer_time_seconds(self, payload_size_bytes: int) -> float:
        """Calculate total transfer time in seconds (propagation + serialization)."""
        propagation_sec = self.latency_ms / 1000.0
        serialization_sec = (payload_size_bytes * 8.0) / (self.bandwidth_mbps * 1_000_000.0)
        return propagation_sec + serialization_sec
