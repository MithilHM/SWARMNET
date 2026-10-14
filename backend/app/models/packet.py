"""Packet and RouteHop domain models."""

import uuid
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class PacketPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class PacketStatus(str, Enum):
    CREATED = "created"
    BUFFERED = "buffered"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    DROPPED = "dropped"
    EXPIRED = "expired"


class DropReason(str, Enum):
    BUFFER_FULL = "BUFFER_FULL"
    HOP_LIMIT = "HOP_LIMIT"
    TTL_EXPIRED = "TTL_EXPIRED"
    NO_ROUTE = "NO_ROUTE"
    LINK_FAILURE = "LINK_FAILURE"
    DUPLICATE = "DUPLICATE"


class RouteHop(BaseModel):
    node_id: str
    entered_at: float
    departed_at: Optional[float] = None
    link_id: Optional[str] = None
    action: str = "forward"  # e.g., 'created', 'forward', 'buffered', 'delivered'


class Packet(BaseModel):
    packet_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_node_id: str
    destination_node_id: str
    created_at: float
    expires_at: Optional[float] = None
    payload_size_bytes: int = Field(default=4096, ge=1)
    priority: PacketPriority = PacketPriority.NORMAL
    current_node_id: str
    hop_count: int = 0
    max_hops: int = Field(default=20, ge=1)
    visited_node_ids: List[str] = Field(default_factory=list)
    status: PacketStatus = PacketStatus.CREATED
    drop_reason: Optional[str] = None
    delivery_time: Optional[float] = None
    route_history: List[RouteHop] = Field(default_factory=list)
    time_spent_buffered: float = 0.0

    def is_expired(self, current_sim_time: float) -> bool:
        if self.expires_at is not None and current_sim_time >= self.expires_at:
            return True
        return False
