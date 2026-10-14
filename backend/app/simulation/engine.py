"""Core discrete-event simulation engine integrating nodes, agents, routing, buffering, and transport."""

import random
from typing import Any, Callable, Dict, List, Optional

from app.models.scenario import ScenarioConfig
from app.models.node import SatelliteNode, GroundStationNode, NodeStatus
from app.models.link import Link
from app.models.packet import Packet, PacketStatus, DropReason
from app.models.event import TopologyEvent, EventType
from app.models.decision import RouteDecision
from app.models.run import MetricsSummary
from app.simulation.clock import SimulationClock
from app.simulation.topology import TopologyManager
from app.simulation.events import EventScheduler
from app.buffering.packet_factory import TrafficGenerator
from app.transport.in_process import InProcessTransport
from app.agents.satellite_agent import SatelliteAgent
from app.agents.ground_agent import GroundStationAgent
from app.routing import get_routing_policy


class SimulationEngine:
    def __init__(self, scenario: ScenarioConfig):
        self.scenario = scenario
        self.rng = random.Random(scenario.scenario.seed)
        self.clock = SimulationClock(
            tick_seconds=scenario.scenario.tick_seconds,
            max_duration=scenario.scenario.duration_seconds,
        )
        self.topology = TopologyManager()
        self.event_scheduler = EventScheduler(self.topology)
        self.transport = InProcessTransport(rng=random.Random(scenario.scenario.seed + 1))
        self.traffic_generator = TrafficGenerator(scenario.traffic)

        self.satellite_agents: Dict[str, SatelliteAgent] = {}
        self.ground_agents: Dict[str, GroundStationAgent] = {}
        self.all_decisions: List[RouteDecision] = []
        self.all_packets: Dict[str, Packet] = {}
        self.metrics = MetricsSummary()
        self._listeners: List[Callable[[TopologyEvent], None]] = []

        self._init_network()
        self.clock.register_tick_callback(self._on_tick)

    def register_event_listener(self, listener: Callable[[TopologyEvent], None]) -> None:
        self._listeners.append(listener)
        self.event_scheduler.register_listener(listener)

    def _emit_event(self, event: TopologyEvent) -> None:
        self.event_scheduler.event_history.append(event)
        for listener in self._listeners:
            listener(event)

    def _init_network(self) -> None:
        # Initialize satellite agents
        policy = get_routing_policy(self.scenario.routing)
        for sat_conf in self.scenario.network.satellites:
            sat = SatelliteNode(
                satellite_id=sat_conf.id,
                position=sat_conf.position,
                energy_percent=sat_conf.energy_percent,
                buffer_capacity_bytes=sat_conf.buffer_capacity_bytes,
                buffer_used_bytes=0,
                status=NodeStatus.ACTIVE,
            )
            self.topology.add_satellite(sat)
            agent = SatelliteAgent(
                satellite_id=sat_conf.id,
                buffer_capacity_bytes=sat_conf.buffer_capacity_bytes,
                routing_policy=policy,
            )
            self.satellite_agents[sat_conf.id] = agent

        # Initialize ground station agents
        for gs_conf in self.scenario.network.ground_stations:
            gs = GroundStationNode(
                ground_station_id=gs_conf.id,
                position=gs_conf.position,
                status=NodeStatus.ACTIVE,
            )
            self.topology.add_ground_station(gs)
            self.ground_agents[gs_conf.id] = GroundStationAgent(gs_conf.id)

        # Links
        for link_conf in self.scenario.links:
            init_avail = True
            init_contact_end = None
            if link_conf.schedule:
                matching = [s for s in link_conf.schedule if s.start <= 0.0 < s.end]
                if matching:
                    init_avail = matching[0].available
                    init_contact_end = matching[0].end if matching[0].available else None
                else:
                    init_avail = False

            forward_link = Link(
                link_id=link_conf.id,
                source_node_id=link_conf.source,
                target_node_id=link_conf.target,
                is_available=init_avail,
                latency_ms=link_conf.latency_ms,
                bandwidth_mbps=link_conf.bandwidth_mbps,
                reliability=link_conf.reliability,
                contact_end_time=init_contact_end,
                last_updated_at=0.0,
            )
            self.topology.add_link(forward_link)
            self.event_scheduler.schedule_from_link_schedules(
                forward_link.link_id, link_conf.schedule
            )

            if link_conf.symmetric:
                rev_id = f"{link_conf.target}-{link_conf.source}"
                rev_link = Link(
                    link_id=rev_id,
                    source_node_id=link_conf.target,
                    target_node_id=link_conf.source,
                    is_available=init_avail,
                    latency_ms=link_conf.latency_ms,
                    bandwidth_mbps=link_conf.bandwidth_mbps,
                    reliability=link_conf.reliability,
                    contact_end_time=init_contact_end,
                    last_updated_at=0.0,
                )
                self.topology.add_link(rev_link)
                self.event_scheduler.schedule_from_link_schedules(
                    rev_id, link_conf.schedule
                )

        self.topology.refresh_all_neighbors()

    def _on_tick(self, current_time: float) -> None:
        # 1. Apply scheduled topology events
        self.event_scheduler.process_time(current_time)

        # 2. Process in-transit packet arrivals
        arrived = self.transport.process_in_transit(current_time)
        for packet, target_id, success, link_id in arrived:
            if success:
                if target_id in self.ground_agents:
                    delivered = self.ground_agents[target_id].receive_packet(packet, current_time)
                    if delivered:
                        self.metrics.packets_delivered += 1
                        self.metrics.total_bytes_delivered += packet.payload_size_bytes
                        self._emit_event(
                            TopologyEvent(
                                simulated_time=current_time,
                                event_type=EventType.PACKET_DELIVERED,
                                link_id=link_id,
                                node_id=target_id,
                                packet_id=packet.packet_id,
                                details={
                                    "delay": current_time - packet.created_at,
                                    "hop_count": packet.hop_count,
                                },
                            )
                        )
                elif target_id in self.satellite_agents:
                    admitted, reason, evicted = self.satellite_agents[target_id].buffer.admit(
                        packet, current_time
                    )
                    if admitted:
                        self._emit_event(
                            TopologyEvent(
                                simulated_time=current_time,
                                event_type=EventType.PACKET_BUFFERED,
                                node_id=target_id,
                                packet_id=packet.packet_id,
                            )
                        )
                    else:
                        self._record_drop(packet, reason or "BUFFER_ADMISSION_REJECTED", target_id, current_time)
                    for ev_pkt in evicted:
                        self._record_drop(ev_pkt, DropReason.BUFFER_FULL.value, target_id, current_time)
            else:
                # Re-admit into source satellite buffer for retry
                if target_id in self.satellite_agents:
                    self.satellite_agents[target_id].buffer.admit(packet, current_time)

        # 3. Expire packets in satellite buffers
        for sat_id, agent in self.satellite_agents.items():
            expired = agent.buffer.expire_packets(current_time)
            for exp_pkt in expired:
                self.metrics.packets_expired += 1
                self._record_drop(exp_pkt, DropReason.TTL_EXPIRED.value, sat_id, current_time)

        # 4. Generate new traffic
        new_packets = self.traffic_generator.generate_packets_for_tick(current_time)
        for pkt in new_packets:
            self.all_packets[pkt.packet_id] = pkt
            self.metrics.packets_generated += 1
            self.metrics.total_bytes_generated += pkt.payload_size_bytes

            self._emit_event(
                TopologyEvent(
                    simulated_time=current_time,
                    event_type=EventType.PACKET_GENERATED,
                    node_id=pkt.source_node_id,
                    packet_id=pkt.packet_id,
                    details={"size": pkt.payload_size_bytes, "priority": pkt.priority.value},
                )
            )

            if pkt.source_node_id in self.satellite_agents:
                admitted, reason, evicted = self.satellite_agents[pkt.source_node_id].buffer.admit(
                    pkt, current_time
                )
                if admitted:
                    self._emit_event(
                        TopologyEvent(
                            simulated_time=current_time,
                            event_type=EventType.PACKET_BUFFERED,
                            node_id=pkt.source_node_id,
                            packet_id=pkt.packet_id,
                        )
                    )
                else:
                    self._record_drop(pkt, reason or "SOURCE_BUFFER_REJECTED", pkt.source_node_id, current_time)

                for ev_pkt in evicted:
                    self._record_drop(ev_pkt, DropReason.BUFFER_FULL.value, pkt.source_node_id, current_time)

        # 5. Autonomous forwarding decisions
        for sat_id, agent in self.satellite_agents.items():
            decisions = agent.evaluate_and_dispatch(self.topology, self.transport, current_time)
            for dec in decisions:
                self.all_decisions.append(dec)
                if dec.chosen_next_hop_id:
                    self._emit_event(
                        TopologyEvent(
                            simulated_time=current_time,
                            event_type=EventType.ROUTING_DECISION,
                            node_id=sat_id,
                            packet_id=dec.packet_id,
                            details={
                                "next_hop": dec.chosen_next_hop_id,
                                "action": dec.decision.value,
                                "reason": dec.reason_code.value,
                            },
                        )
                    )

        # 6. Synchronize satellite buffer state with topology nodes
        for sat_id, agent in self.satellite_agents.items():
            if sat_id in self.topology.satellites:
                self.topology.satellites[sat_id].buffer_used_bytes = agent.buffer.used_bytes

        # 7. Update metrics summary
        self._update_metrics_summary()

    def _record_drop(self, packet: Packet, reason: str, node_id: str, current_time: float) -> None:
        self.metrics.packets_dropped += 1
        self.metrics.packets_dropped_by_reason[reason] = (
            self.metrics.packets_dropped_by_reason.get(reason, 0) + 1
        )
        self._emit_event(
            TopologyEvent(
                simulated_time=current_time,
                event_type=EventType.PACKET_DROPPED,
                node_id=node_id,
                packet_id=packet.packet_id,
                details={"reason": reason},
            )
        )

    def _update_metrics_summary(self) -> None:
        # Buffer occupancy
        occupancy: Dict[str, int] = {}
        total_buffered = 0
        for sat_id, agent in self.satellite_agents.items():
            occupancy[sat_id] = agent.buffer.used_bytes
            total_buffered += agent.buffer.packet_count
        self.metrics.buffer_occupancy_by_node = occupancy
        self.metrics.packets_pending = total_buffered
        self.metrics.packets_in_transit = len(self.transport._in_transit)

        # Delivery ratio
        if self.metrics.packets_generated > 0:
            self.metrics.delivery_ratio = round(
                self.metrics.packets_delivered / self.metrics.packets_generated, 4
            )
        else:
            self.metrics.delivery_ratio = 0.0

        # Delays
        all_delays: List[float] = []
        all_hops: List[int] = []
        for gs in self.ground_agents.values():
            all_delays.extend(gs.delivered_delays)
            for pkt in gs.received_packets.values():
                all_hops.append(pkt.hop_count)

        if all_delays:
            sorted_delays = sorted(all_delays)
            self.metrics.mean_delay_seconds = round(sum(sorted_delays) / len(sorted_delays), 3)
            mid = len(sorted_delays) // 2
            self.metrics.median_delay_seconds = round(
                (sorted_delays[mid] if len(sorted_delays) % 2 != 0 else (sorted_delays[mid - 1] + sorted_delays[mid]) / 2.0),
                3,
            )
            p95_idx = int(0.95 * len(sorted_delays))
            self.metrics.p95_delay_seconds = round(sorted_delays[min(p95_idx, len(sorted_delays) - 1)], 3)
        else:
            self.metrics.mean_delay_seconds = 0.0
            self.metrics.median_delay_seconds = 0.0
            self.metrics.p95_delay_seconds = 0.0

        if all_hops:
            self.metrics.mean_hop_count = round(sum(all_hops) / len(all_hops), 2)
        else:
            self.metrics.mean_hop_count = 0.0

        self.metrics.link_transferred_bytes = dict(self.transport.total_transferred_bytes_by_link)

    def step(self, num_ticks: int = 1) -> float:
        return self.clock.step(num_ticks)

    def reset(self) -> None:
        self.rng = random.Random(self.scenario.scenario.seed)
        self.clock.reset()
        self.topology = TopologyManager()
        self.event_scheduler = EventScheduler(self.topology)
        self.transport = InProcessTransport(rng=random.Random(self.scenario.scenario.seed + 1))
        self.traffic_generator.reset()
        self.satellite_agents.clear()
        self.ground_agents.clear()
        self.all_decisions.clear()
        self.all_packets.clear()
        self.metrics = MetricsSummary()
        self._init_network()
        self.clock.register_tick_callback(self._on_tick)
