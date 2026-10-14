"""Routing decision domain models."""

import uuid
from enum import Enum
from typing import Dict, Optional
from pydantic import BaseModel, Field


class DecisionAction(str, Enum):
    FORWARD = "forward"
    BUFFER = "buffer"
    DROP = "drop"


class DecisionReasonCode(str, Enum):
    DIRECT_DELIVERY = "DIRECT_DELIVERY"
    LOWEST_COST = "LOWEST_COST"
    BEST_SCORE = "BEST_SCORE"
    CONTACT_ENDING = "CONTACT_ENDING"
    LINK_UNAVAILABLE = "LINK_UNAVAILABLE"
    NO_ROUTE = "NO_ROUTE"
    BUFFER_FULL = "BUFFER_FULL"
    PACKET_EXPIRED = "PACKET_EXPIRED"
    HOP_LIMIT = "HOP_LIMIT"
    DUPLICATE = "DUPLICATE"
    ENERGY_CONSTRAINT = "ENERGY_CONSTRAINT"


class CandidateScore(BaseModel):
    neighbor_id: str
    total_score: float
    progress_score: float = 0.0
    reliability_score: float = 0.0
    contact_score: float = 0.0
    latency_penalty: float = 0.0
    congestion_penalty: float = 0.0
    energy_penalty: float = 0.0
    link_available: bool = True
    estimated_remaining_contact_sec: Optional[float] = None
    reason: Optional[str] = None


class RouteDecision(BaseModel):
    decision_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    packet_id: str
    satellite_id: str
    chosen_next_hop_id: Optional[str] = None
    decision: DecisionAction
    reason_code: DecisionReasonCode
    candidate_scores: Dict[str, CandidateScore] = Field(default_factory=dict)
    decision_time: float
    routing_policy: str
    explanation: Optional[str] = None
