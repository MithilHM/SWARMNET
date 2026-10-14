"""Topology and network event models."""

import uuid
from enum import Enum
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class EventType(str, Enum):
    LINK_UP = "link_up"
    LINK_DOWN = "link_down"
    LINK_DEGRADED = "link_degraded"
    LINK_RECOVERED = "link_recovered"
    PACKET_GENERATED = "packet_generated"
    PACKET_FORWARDED = "packet_forwarded"
    PACKET_BUFFERED = "packet_buffered"
    PACKET_IN_TRANSIT = "packet_in_transit"
    PACKET_DELIVERED = "packet_delivered"
    PACKET_DROPPED = "packet_dropped"
    PACKET_EXPIRED = "packet_expired"
    ROUTING_DECISION = "routing_decision"


class TopologyEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    simulated_time: float
    event_type: EventType
    link_id: Optional[str] = None
    node_id: Optional[str] = None
    packet_id: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)
