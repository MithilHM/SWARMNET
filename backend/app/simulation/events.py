"""Event scheduler for topology changes and dynamic link schedules."""

from typing import Any, Callable, Dict, List, Optional
from app.models.event import TopologyEvent, EventType
from app.models.link import LinkScheduleItem
from app.simulation.topology import TopologyManager


class ScheduledLinkEvent:
    def __init__(
        self,
        trigger_time: float,
        link_id: str,
        is_available: bool,
        latency_ms: Optional[float] = None,
        bandwidth_mbps: Optional[float] = None,
        reliability: Optional[float] = None,
        contact_end_time: Optional[float] = None,
        reason: Optional[str] = None,
    ):
        self.trigger_time = trigger_time
        self.link_id = link_id
        self.is_available = is_available
        self.latency_ms = latency_ms
        self.bandwidth_mbps = bandwidth_mbps
        self.reliability = reliability
        self.contact_end_time = contact_end_time
        self.reason = reason
        self.applied = False


class EventScheduler:
    def __init__(self, topology: TopologyManager):
        self.topology = topology
        self.events: List[ScheduledLinkEvent] = []
        self.event_history: List[TopologyEvent] = []
        self._listeners: List[Callable[[TopologyEvent], None]] = []

    def register_listener(self, listener: Callable[[TopologyEvent], None]) -> None:
        self._listeners.append(listener)

    def add_event(self, event: ScheduledLinkEvent) -> None:
        self.events.append(event)
        self.events.sort(key=lambda e: e.trigger_time)

    def schedule_from_link_schedules(
        self, link_id: str, schedules: List[LinkScheduleItem]
    ) -> None:
        """Translate link schedule start/end intervals into scheduled events."""
        for item in schedules:
            # Event at start of schedule window
            self.add_event(
                ScheduledLinkEvent(
                    trigger_time=item.start,
                    link_id=link_id,
                    is_available=item.available,
                    latency_ms=item.latency_ms,
                    bandwidth_mbps=item.bandwidth_mbps,
                    reliability=item.reliability,
                    contact_end_time=item.end if item.available else None,
                    reason=f"Scheduled contact window start [available={item.available}]",
                )
            )
            # If available, at end of window make it unavailable unless another schedule picks up
            if item.available:
                self.add_event(
                    ScheduledLinkEvent(
                        trigger_time=item.end,
                        link_id=link_id,
                        is_available=False,
                        reason="Scheduled contact window ended",
                    )
                )

    def process_time(self, current_time: float) -> List[TopologyEvent]:
        """Apply all events up to current_time and return emitted TopologyEvents."""
        emitted: List[TopologyEvent] = []
        for event in self.events:
            if not event.applied and event.trigger_time <= current_time:
                link = self.topology.links.get(event.link_id)
                if not link:
                    event.applied = True
                    continue

                prev_available = link.is_available
                updated_link = self.topology.update_link_state(
                    link_id=event.link_id,
                    is_available=event.is_available,
                    current_time=current_time,
                    latency_ms=event.latency_ms,
                    bandwidth_mbps=event.bandwidth_mbps,
                    reliability=event.reliability,
                    contact_end_time=event.contact_end_time,
                    failure_reason=event.reason if not event.is_available else None,
                )

                # Determine event type
                evt_type = None
                if event.is_available and not prev_available:
                    evt_type = EventType.LINK_UP
                elif not event.is_available and prev_available:
                    evt_type = EventType.LINK_DOWN
                elif event.is_available:
                    if event.reliability is not None and event.reliability < 0.8:
                        evt_type = EventType.LINK_DEGRADED
                    elif link.reliability < 0.8 and (event.reliability is None or event.reliability >= 0.8):
                        evt_type = EventType.LINK_RECOVERED

                event.applied = True
                if evt_type is None:
                    continue

                topo_event = TopologyEvent(
                    simulated_time=current_time,
                    event_type=evt_type,
                    link_id=event.link_id,
                    details={
                        "reason": event.reason,
                        "is_available": event.is_available,
                        "latency_ms": updated_link.latency_ms if updated_link else None,
                        "reliability": updated_link.reliability if updated_link else None,
                        "contact_end_time": updated_link.contact_end_time if updated_link else None,
                    },
                )
                emitted.append(topo_event)
                self.event_history.append(topo_event)

                for listener in self._listeners:
                    listener(topo_event)

        return emitted

    def reset(self) -> None:
        for event in self.events:
            event.applied = False
        self.event_history.clear()
