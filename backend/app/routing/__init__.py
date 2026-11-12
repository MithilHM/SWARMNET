"""Routing policies factory and exports."""

from typing import Optional

from app.routing.base import RoutingPolicy
from app.routing.shortest_path import ShortestPathRoutingPolicy
from app.models.scenario import RoutingConfig


def get_routing_policy(
    routing_config: RoutingConfig,
    tick_seconds: Optional[float] = None,
) -> RoutingPolicy:
    policy_name = routing_config.policy.lower()
    if policy_name in ("baseline", "shortest_path", "shortest"):
        return ShortestPathRoutingPolicy()
    elif policy_name in ("swarmnet", "contact_aware"):
        from app.routing.swarmnet import SwarmnetRoutingPolicy

        # Agents act once per simulation tick.  The estimator uses this value
        # to align intermediate forwarding decisions, so it must match the
        # scenario's clock exactly.
        decision_interval = tick_seconds if tick_seconds is not None else 1.0
        return SwarmnetRoutingPolicy(
            weights=routing_config.weights,
            decision_interval_seconds=decision_interval,
        )
    else:
        return ShortestPathRoutingPolicy()
