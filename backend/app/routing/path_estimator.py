"""Contact-aware path estimation shared by routing policies.

The simulator owns the ground-truth topology: which links are active now and,
for scheduled contacts, when each active window opens and closes.  This module
exposes a deterministic earliest-arrival search that an agent can use to answer
two questions:

1. Can a candidate next hop *ever* carry this packet toward its destination
   without entering a dead-end partition?
2. If so, when would the packet actually arrive if it used that candidate,
   including any time spent waiting for a future scheduled contact?

The search models the fact that agents act on discrete simulation ticks.  An
intermediate node that receives a packet at t=9.03 cannot re-forward it until
the next tick at t=10, so a contact that closes at t=10 is not usable for the
onward hop.  Ignoring that detail caused packets to be handed into a node whose
last useful contact closed before the receiving node could act.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from typing import FrozenSet, List, Optional, Set

from app.simulation.topology import TopologyManager


@dataclass(frozen=True)
class RouteEstimate:
    """Result of a single-source earliest-arrival search."""

    path: List[str]
    link_ids: List[str]
    total_latency_ms: float
    hop_count: int
    reliability: float
    bottleneck_bandwidth_mbps: float
    # Absolute simulated time at which the packet reaches the target.
    arrival_time: float
    # Start of the contact window used by the first link of the route.  A
    # caller can compare this with its own current time to tell whether the
    # route needs a contact that has not opened yet, even when the receiver's
    # own decision tick falls inside that window.
    first_window_start: Optional[float] = None
    # Total time spent waiting at intermediate nodes for future contacts.
    waiting_seconds: float = 0.0
    # Smallest ratio of (usable contact time) to (twice the transfer time)
    # across the path.  1.0 means no scheduled contact limit was binding.
    min_contact_margin_ratio: float = 1.0
    # True when the route needed at least one link window that is not yet open.
    uses_future_contacts: bool = False


@dataclass(frozen=True)
class _Step:
    previous_node: str
    link_id: str
    departure_time: float
    arrival_time: float
    window_start: float
    window_end: float
    waiting_seconds: float


def empty_route(node_id: str, arrival_time: float) -> RouteEstimate:
    return RouteEstimate(
        path=[node_id],
        link_ids=[],
        total_latency_ms=0.0,
        hop_count=0,
        reliability=1.0,
        bottleneck_bandwidth_mbps=float("inf"),
        arrival_time=arrival_time,
        min_contact_margin_ratio=1.0,
        uses_future_contacts=False,
    )


def align_to_decision_time(time_value: float, decision_interval_seconds: float) -> float:
    """Return the first simulation tick at or after ``time_value``.

    A value already on a tick boundary stays put: the engine processes arrivals
    before forwarding within the same tick, so the packet can act immediately.
    """
    if decision_interval_seconds <= 0:
        return time_value
    ratio = time_value / decision_interval_seconds
    nearest = round(ratio)
    if abs(ratio - nearest) < 1e-9:
        return nearest * decision_interval_seconds
    return math.ceil(ratio) * decision_interval_seconds


def _usable_windows(
    topology: TopologyManager,
    link_id: str,
    current_time: float,
    allow_future_contacts: bool,
) -> List[tuple[float, float]]:
    """Return the contact windows this packet may use.

    Scheduled windows describe the contact plan.  The link's current runtime
    state is merged in so an operator-forced availability (or an immediate
    contact end) is never ignored in favour of a stale plan.
    """
    link = topology.links.get(link_id)
    if link is None:
        return []

    windows = list(topology.get_link_windows(link_id))
    if link.is_available:
        windows.append(
            (current_time, link.contact_end_time if link.contact_end_time is not None else float("inf"))
        )

    if not allow_future_contacts:
        # Only the currently open contact may be used.
        if not link.is_available:
            return []
        windows = [
            (current_time, link.contact_end_time if link.contact_end_time is not None else float("inf"))
        ]

    windows.sort(key=lambda window: window[0])
    return windows


def find_route(
    topology: TopologyManager,
    source_id: str,
    target_id: str,
    current_time: float,
    payload_size_bytes: int,
    *,
    decision_interval_seconds: float = 1.0,
    allow_future_contacts: bool = True,
    blocked_nodes: Optional[FrozenSet[str] | Set[str]] = None,
) -> Optional[RouteEstimate]:
    """Return the earliest-arrival route from ``source_id`` to ``target_id``.

    The source is assumed to make its decision at ``current_time``.  Every
    intermediate node is assumed to make its next decision at the next
    simulation tick after the packet arrives.  ``blocked_nodes`` prevents a
    route from revisiting nodes already present in the packet's history.
    """

    if source_id == target_id:
        return empty_route(source_id, current_time)

    blocked = frozenset(blocked_nodes or ())
    if source_id in blocked or target_id in blocked:
        return None

    # earliest_arrival[node] is absolute simulated time.
    earliest: dict[str, float] = {source_id: current_time}
    previous: dict[str, _Step] = {}
    queue: list[tuple[float, str]] = [(current_time, source_id)]

    while queue:
        arrival_at_node, node_id = heapq.heappop(queue)
        if arrival_at_node > earliest.get(node_id, float("inf")) + 1e-9:
            continue
        if node_id == target_id:
            break

        if node_id == source_id:
            earliest_departure = arrival_at_node
        else:
            earliest_departure = align_to_decision_time(
                arrival_at_node, decision_interval_seconds
            )

        for link in topology.get_outgoing_links(node_id, active_only=False):
            next_node = link.target_node_id
            if next_node in blocked:
                continue
            if not topology.is_node_active(next_node):
                continue

            transfer_sec = link.transfer_time_seconds(payload_size_bytes)
            windows = _usable_windows(
                topology,
                link.link_id,
                current_time,
                allow_future_contacts,
            )

            chosen = None
            for window_start, window_end in windows:
                departure = max(earliest_departure, window_start)
                # Match the transport's four-decimal arrival rounding so a
                # value that lands exactly on a tick boundary is not aligned a
                # whole tick later because of floating-point noise.
                arrival = round(departure + transfer_sec, 4)
                if arrival <= window_end + 1e-9:
                    chosen = (window_start, departure, arrival, window_end)
                    break

            if chosen is None:
                continue

            window_start, departure, arrival, window_end = chosen
            if arrival < earliest.get(next_node, float("inf")) - 1e-9:
                earliest[next_node] = arrival
                previous[next_node] = _Step(
                    previous_node=node_id,
                    link_id=link.link_id,
                    departure_time=departure,
                    arrival_time=arrival,
                    window_start=window_start,
                    window_end=window_end,
                    waiting_seconds=max(0.0, departure - earliest_departure),
                )
                heapq.heappush(queue, (arrival, next_node))

    if target_id not in earliest:
        return None

    # Reconstruct the route in forward order.
    path: List[str] = [target_id]
    steps: List[_Step] = []
    while path[-1] != source_id:
        step = previous[path[-1]]
        steps.append(step)
        path.append(step.previous_node)
    path.reverse()
    steps.reverse()

    total_latency_ms = 0.0
    reliability = 1.0
    bottleneck_bandwidth = float("inf")
    min_contact_margin = 1.0
    waiting_seconds = 0.0
    uses_future_contacts = False
    link_ids: List[str] = []

    for step, node_id in zip(steps, path[:-1]):
        link = topology.links[step.link_id]
        link_ids.append(step.link_id)
        total_latency_ms += link.latency_ms
        reliability *= link.reliability
        bottleneck_bandwidth = min(bottleneck_bandwidth, link.bandwidth_mbps)

        transfer_sec = link.transfer_time_seconds(payload_size_bytes)
        if step.window_end != float("inf"):
            usable = max(0.0, step.window_end - step.departure_time)
            margin = usable / max(0.001, transfer_sec * 2.0)
            min_contact_margin = min(min_contact_margin, min(1.0, margin))
        if step.departure_time > current_time + 1e-9:
            uses_future_contacts = True
        waiting_seconds += step.waiting_seconds

    return RouteEstimate(
        path=path,
        link_ids=link_ids,
        total_latency_ms=round(total_latency_ms, 4),
        hop_count=len(link_ids),
        reliability=round(reliability, 6),
        bottleneck_bandwidth_mbps=(
            bottleneck_bandwidth if bottleneck_bandwidth != float("inf") else 0.0
        ),
        arrival_time=round(earliest[target_id], 6),
        first_window_start=steps[0].window_start,
        waiting_seconds=round(waiting_seconds, 6),
        min_contact_margin_ratio=round(max(0.0, min_contact_margin), 6),
        uses_future_contacts=uses_future_contacts,
    )