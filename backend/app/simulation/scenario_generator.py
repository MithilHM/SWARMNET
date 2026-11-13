"""Seeded scenario generation for the guided anomaly -> DTN flow.

``generate_scenario(seed)`` is a pure function: the same seed always yields the
same constellation, link properties, traffic plan, and failure plan. Nothing in
here reads the clock or global random state.

Positions are schematic (latitude/longitude/altitude for display only). This is
not orbital mechanics; see PRD section 13.4.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from typing import Any, Dict, List, Tuple

from pydantic import BaseModel, Field

# Simulated seconds per wall-clock second. The run is played back in slow
# motion so millisecond-scale link latencies are visible on the globe.
TIME_SCALE = 0.05
# Simulated seconds advanced per engine tick (50 ms wall at TIME_SCALE).
TICK_SECONDS = 0.0025
# Normal traffic before the topology change: ~2 wall seconds.
STABLE_DURATION_SECONDS = 0.1

# Candidate ground-station sites (lat, lon). Display only.
GROUND_SITES: List[Tuple[float, float]] = [
    (64.8, -147.7),
    (78.2, 15.4),
    (35.4, -116.9),
    (40.4, -4.2),
    (-35.4, 149.0),
    (13.0, 77.6),
    (-25.9, 27.7),
    (1.35, 103.8),
    (-33.1, -70.7),
    (52.2, 4.4),
    (19.8, -155.5),
    (-15.9, -47.9),
]

# (cause template, loss pattern). {sat} and {gs} are filled in per scenario.
FAILURE_MODES: List[Tuple[str, str]] = [
    ("Rain fade at {gs}: downlink SNR margin collapsing", "ramp"),
    ("Low elevation: {sat} is setting below the {gs} horizon mask", "ramp"),
    ("Terrain obstruction on the {sat} to {gs} line of sight", "burst"),
    ("RF interference in the {gs} downlink band", "flapping"),
    ("Antenna pointing error on {sat}", "burst"),
]


class GroundStationSpec(BaseModel):
    id: str
    lat: float
    lon: float


class SatelliteSpec(BaseModel):
    id: str
    lat: float
    lon: float
    alt_km: float
    ground_station_id: str
    traffic_interval_s: float
    payload_sizes: List[int]


class LinkSpec(BaseModel):
    link_id: str
    kind: str  # "ground" (satellite to ground station) or "isl" (inter-satellite)
    source: str
    target: str
    latency_ms: float
    bandwidth_mbps: float
    reliability: float


class FailurePlan(BaseModel):
    satellite_id: str
    link_id: str
    ground_station_id: str
    cause: str
    pattern: str  # ramp | burst | flapping
    floor_reliability: float
    ramp_seconds: float
    flap_period_seconds: float
    drift_deg_per_s: float  # schematic drift of the affected satellite (orbital cause only)
    drift_bearing_deg: float


class DetectionConfig(BaseModel):
    window_size: int = 8
    loss_threshold: float = 0.5
    min_samples: int = 5


class FlowScenario(BaseModel):
    scenario_id: str
    seed: int
    time_scale: float = TIME_SCALE
    tick_seconds: float = TICK_SECONDS
    stable_duration_s: float = STABLE_DURATION_SECONDS
    satellites: List[SatelliteSpec]
    ground_stations: List[GroundStationSpec]
    links: List[LinkSpec]
    failure: FailurePlan
    detection: DetectionConfig = Field(default_factory=DetectionConfig)
    post_solve_bundles: int
    buffer_capacity_bytes: int = 262144


def _destination(lat: float, lon: float, bearing_deg: float, distance_deg: float) -> Tuple[float, float]:
    """Great-circle destination point (spherical earth, degrees in/out)."""
    phi1 = math.radians(lat)
    lam1 = math.radians(lon)
    theta = math.radians(bearing_deg)
    delta = math.radians(distance_deg)
    phi2 = math.asin(
        math.sin(phi1) * math.cos(delta) + math.cos(phi1) * math.sin(delta) * math.cos(theta)
    )
    lam2 = lam1 + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(phi1),
        math.cos(delta) - math.sin(phi1) * math.sin(phi2),
    )
    lon2 = (math.degrees(lam2) + 540.0) % 360.0 - 180.0
    return round(math.degrees(phi2), 3), round(lon2, 3)


def link_id_for(source: str, target: str) -> str:
    return f"{source}-{target}"


def generate_scenario(seed: int) -> FlowScenario:
    """Build a complete scenario from ``seed``. Pure and deterministic."""
    rng = random.Random(seed)

    sat_count = rng.choice([4, 5])
    gs_count = rng.choice([1, 2])

    # Ground track for the satellite chain.
    anchor_lat, anchor_lon = rng.choice(GROUND_SITES)
    bearing = rng.uniform(0.0, 360.0)
    spacing = rng.uniform(9.0, 13.0)
    cross_track = rng.uniform(3.0, 7.0) * rng.choice([-1.0, 1.0])
    track_lat, track_lon = _destination(anchor_lat, anchor_lon, bearing + 90.0, cross_track)

    half = (sat_count - 1) / 2.0
    along = [(index - half) * spacing for index in range(sat_count)]

    # Ground stations sit under the chain; with two stations, each serves one half.
    if gs_count == 1:
        gs_along = [rng.uniform(-0.25, 0.25) * spacing]
    else:
        quarter = half * spacing / 2.0
        gs_along = [-quarter + rng.uniform(-2.0, 2.0), quarter + rng.uniform(-2.0, 2.0)]

    ground_stations: List[GroundStationSpec] = []
    for index, offset in enumerate(gs_along):
        lat, lon = _destination(anchor_lat, anchor_lon, bearing, offset)
        ground_stations.append(GroundStationSpec(id=f"GROUND-{index + 1:02d}", lat=lat, lon=lon))

    satellites: List[SatelliteSpec] = []
    for index, offset in enumerate(along):
        lat, lon = _destination(track_lat, track_lon, bearing, offset)
        nearest = min(range(gs_count), key=lambda g: abs(gs_along[g] - offset))
        satellites.append(
            SatelliteSpec(
                id=f"SAT-{index + 1:02d}",
                lat=lat,
                lon=lon,
                alt_km=round(rng.uniform(520.0, 600.0), 1),
                ground_station_id=ground_stations[nearest].id,
                traffic_interval_s=round(rng.uniform(0.022, 0.04), 4),
                payload_sizes=[rng.choice([1024, 2048, 4096, 6144, 8192]) for _ in range(6)],
            )
        )

    links: List[LinkSpec] = []
    for sat in satellites:
        links.append(
            LinkSpec(
                link_id=link_id_for(sat.id, sat.ground_station_id),
                kind="ground",
                source=sat.id,
                target=sat.ground_station_id,
                latency_ms=round(rng.uniform(18.0, 42.0), 1),
                bandwidth_mbps=float(rng.choice([5, 8, 10, 12, 20])),
                reliability=round(rng.uniform(0.985, 0.999), 3),
            )
        )
    for left, right in zip(satellites, satellites[1:]):
        links.append(
            LinkSpec(
                link_id=link_id_for(left.id, right.id),
                kind="isl",
                source=left.id,
                target=right.id,
                latency_ms=round(rng.uniform(6.0, 18.0), 1),
                bandwidth_mbps=float(rng.choice([20, 30, 40, 50])),
                reliability=round(rng.uniform(0.99, 0.999), 3),
            )
        )

    affected = rng.choice(satellites)
    cause_template, pattern = rng.choice(FAILURE_MODES)
    cause = cause_template.format(sat=affected.id, gs=affected.ground_station_id)
    is_orbital = "horizon" in cause_template
    failure = FailurePlan(
        satellite_id=affected.id,
        link_id=link_id_for(affected.id, affected.ground_station_id),
        ground_station_id=affected.ground_station_id,
        cause=cause,
        pattern=pattern,
        floor_reliability=round(rng.uniform(0.04, 0.15), 3),
        ramp_seconds=round(rng.uniform(0.07, 0.14), 4),
        flap_period_seconds=round(rng.uniform(0.02, 0.035), 4),
        drift_deg_per_s=round(rng.uniform(25.0, 40.0), 2) if is_orbital else 0.0,
        drift_bearing_deg=round((bearing + rng.choice([0.0, 180.0])) % 360.0, 2),
    )

    body: Dict[str, Any] = {
        "seed": seed,
        "satellites": [s.model_dump() for s in satellites],
        "ground_stations": [g.model_dump() for g in ground_stations],
        "links": [link.model_dump() for link in links],
        "failure": failure.model_dump(),
    }
    digest = hashlib.sha1(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()[:8]

    return FlowScenario(
        scenario_id=f"SCN-{digest.upper()}",
        seed=seed,
        satellites=satellites,
        ground_stations=ground_stations,
        links=links,
        failure=failure,
        post_solve_bundles=rng.randint(2, 4),
    )


def destination(lat: float, lon: float, bearing_deg: float, distance_deg: float) -> Tuple[float, float]:
    """Public wrapper used by the engine for schematic drift."""
    return _destination(lat, lon, bearing_deg, distance_deg)
