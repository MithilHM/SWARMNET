"""Routing policies factory and exports."""

from typing import Optional
from app.routing.base import RoutingPolicy
from app.routing.shortest_path import ShortestPathRoutingPolicy
from app.models.scenario import RoutingConfig


def get_routing_policy(routing_config: RoutingConfig) -> RoutingPolicy:
    policy_name = routing_config.policy.lower()
    if policy_name in ("baseline", "shortest_path", "shortest"):
        return ShortestPathRoutingPolicy()
    elif policy_name in ("swarmnet", "contact_aware"):
        try:
            from app.routing.swarmnet import SwarmnetRoutingPolicy
            return SwarmnetRoutingPolicy(weights=routing_config.weights)
        except ImportError:
            return ShortestPathRoutingPolicy()
    else:
        return ShortestPathRoutingPolicy()
