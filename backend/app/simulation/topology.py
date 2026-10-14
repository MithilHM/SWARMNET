"""Topology manager for nodes and dynamic links."""

from typing import Dict, List, Optional, Set, Tuple
from app.models.node import SatelliteNode, GroundStationNode, NodeStatus
from app.models.link import Link


class TopologyManager:
    def __init__(self):
        self.satellites: Dict[str, SatelliteNode] = {}
        self.ground_stations: Dict[str, GroundStationNode] = {}
        # Keyed by link_id
        self.links: Dict[str, Link] = {}
        # Adjacency index: source_id -> list of link_ids
        self._out_links: Dict[str, List[str]] = {}

    def add_satellite(self, sat: SatelliteNode) -> None:
        self.satellites[sat.satellite_id] = sat
        if sat.satellite_id not in self._out_links:
            self._out_links[sat.satellite_id] = []

    def add_ground_station(self, gs: GroundStationNode) -> None:
        self.ground_stations[gs.ground_station_id] = gs
        if gs.ground_station_id not in self._out_links:
            self._out_links[gs.ground_station_id] = []

    def add_link(self, link: Link) -> None:
        self.links[link.link_id] = link
        if link.source_node_id not in self._out_links:
            self._out_links[link.source_node_id] = []
        if link.link_id not in self._out_links[link.source_node_id]:
            self._out_links[link.source_node_id].append(link.link_id)
        self._update_node_neighbors(link.source_node_id)

    def get_node_type(self, node_id: str) -> Optional[str]:
        if node_id in self.satellites:
            return "satellite"
        if node_id in self.ground_stations:
            return "ground_station"
        return None

    def get_outgoing_links(self, node_id: str, active_only: bool = True) -> List[Link]:
        link_ids = self._out_links.get(node_id, [])
        links = [self.links[lid] for lid in link_ids if lid in self.links]
        if active_only:
            return [
                lnk for lnk in links 
                if lnk.is_available and self._is_target_active(lnk.target_node_id)
            ]
        return links

    def get_link_between(self, source_id: str, target_id: str, active_only: bool = True) -> Optional[Link]:
        for link in self.get_outgoing_links(source_id, active_only=active_only):
            if link.target_node_id == target_id:
                return link
        return None

    def _is_target_active(self, target_id: str) -> bool:
        if target_id in self.satellites:
            return self.satellites[target_id].status == NodeStatus.ACTIVE
        if target_id in self.ground_stations:
            return self.ground_stations[target_id].status == NodeStatus.ACTIVE
        return False

    def update_link_state(
        self,
        link_id: str,
        is_available: bool,
        current_time: float,
        latency_ms: Optional[float] = None,
        bandwidth_mbps: Optional[float] = None,
        reliability: Optional[float] = None,
        contact_end_time: Optional[float] = None,
        failure_reason: Optional[str] = None,
    ) -> Optional[Link]:
        link = self.links.get(link_id)
        if not link:
            return None

        link.is_available = is_available
        link.last_updated_at = current_time
        if latency_ms is not None:
            link.latency_ms = latency_ms
        if bandwidth_mbps is not None:
            link.bandwidth_mbps = bandwidth_mbps
        if reliability is not None:
            link.reliability = reliability
        if contact_end_time is not None:
            link.contact_end_time = contact_end_time
        link.failure_reason = failure_reason

        self._update_node_neighbors(link.source_node_id)
        return link

    def _update_node_neighbors(self, node_id: str) -> None:
        if node_id in self.satellites:
            active_links = self.get_outgoing_links(node_id, active_only=True)
            self.satellites[node_id].neighbors = [lnk.target_node_id for lnk in active_links]

    def refresh_all_neighbors(self) -> None:
        for node_id in self.satellites:
            self._update_node_neighbors(node_id)
