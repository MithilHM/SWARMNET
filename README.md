# SWARMNET — Autonomous Delay-Tolerant Satellite Constellation Network

[![Tests](https://img.shields.io/badge/tests-71%20passed-success)](https://github.com/)
[![React](https://img.shields.io/badge/Frontend-React%2019%20%7C%20TypeScript%20%7C%20Three.js-blue)](https://vitejs.dev/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%7C%20Uvicorn-green)](https://fastapi.tiangolo.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose%20v2-2496ED)](https://www.docker.com/)
[![SDG 9](https://img.shields.io/badge/SDG%209-Industry%2C%20Innovation%20%26%20Infrastructure-orange)](https://sdgs.un.org/goals/goal9)

**SWARMNET** is an autonomous, delay-tolerant networking (DTN) layer simulator engineered for dynamic satellite constellations whose topologies change over time.

Traditional internet routing protocols (such as TCP/IP, OSPF, and BGP) assume an unbroken end-to-end path exists at the moment data is dispatched. In Low Earth Orbit (LEO) satellite constellations, satellites travel at ~27,000 km/h, links break as orbital geometries shift, ground-station passes last only minutes, and network partitions are an expected reality.

SWARMNET solves this with **autonomous, store-carry-forward packet routing**:
1. When a destination or ground station cannot be reached, the satellite **stores** the packet in a bounded local buffer.
2. The satellite **carries** the data through its orbit.
3. When contact opportunities emerge, the satellite **evaluates** candidate neighbors using multi-factor contact-aware intelligence and **forwards** the data.
4. Each satellite makes its own next-hop decisions locally without relying on a central mission-control controller to dictate every hop.

---

## Architecture Overview

```text
                             +------------------------+
                             |    Dashboard / UI      |
                             | (React + Vite + Three) |
                             +-----------+------------+
                                         ^
                                         | REST / WebSocket
                                         v
                             +------------------------+
                             |   FastAPI Orchestrator |
                             | & Telemetry Aggregator |
                             +-----------+------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
                       v                                   v
             +-------------------+               +-------------------+
             | Topology & Clock  |               | SQLite Run Store  |
             | Simulation Engine |               | & Metric Recorder |
             +---------+---------+               +-------------------+
                       |
        +--------------+--------------+
        |                             |
        v                             v
+----------------+            +----------------+
| Satellite Node | <========> | Satellite Node | ... ====> [ Ground Station ]
| (Local Router, |   Link     | (Local Router, |  Link     (Receiver, Store,
|  Buffer, State)| Transport  |  Buffer, State)| Transport  Telemetry)
+----------------+            +----------------+
```

---

## Key Features

* **Autonomous Multi-Factor Routing (`swarmnet`):**  
  Forwarding decisions evaluate predicted delivery progress, path reliability, contact window feasibility, normalized propagation latency, queue congestion, and battery levels:
  $$\text{Score} = w_{\text{prog}} \cdot P + w_{\text{rel}} \cdot R + w_{\text{cont}} \cdot C - w_{\text{lat}} \cdot \hat{L} - w_{\text{cong}} \cdot \hat{Q} - w_{\text{eng}} \cdot E$$
* **Future-Contact Path Estimation:**
  A deterministic earliest-arrival search runs over active links and scheduled future contact windows, including tick-aligned forwarding at intermediate nodes. Candidates that lead into a dead-end partition, or that would arrive later than waiting at the current node, are rejected or used only to relieve local buffer pressure.
* **Contact Window Feasibility Check:**  
  Automatically rejects links that will sever before packet transmission can complete ($t_{\text{transfer}} > t_{\text{end}} - t_{\text{current}}$), preventing failed handoffs. Failed transport handoffs restore the sender's buffered copy without duplicate suppression.
* **Buffer-Aware Backpressure:**
  A full relay whose onward contact has not opened yet is skipped while the current node still has room, avoiding eviction of a stored packet. Transit and buffer counters are published mid-tick so decisions see current load.
* **Deterministic Baseline Router (`baseline`):**  
  Implements shortest-available-path Dijkstra routing over active links based on latency, enabling controlled head-to-head benchmarking.
* **Capacity-Bounded Storage & Eviction:**  
  Enforces per-node byte limits (`buffer_capacity_bytes`) and deterministic priority eviction (`LOW < NORMAL < HIGH`) with auditable drop reasons (`BUFFER_FULL`, `TTL_EXPIRED`, `HOP_LIMIT`).
* **Link Serialization Queuing:**  
  Simulates physical link capacity and transmission delay ($t_{\text{serialize}} = \frac{\text{size} \times 8}{\text{bandwidth}}$) with FIFO link queues.
* **Interactive React Workspace:**
  A field-atlas style application shell with five workspaces: run overview, a schematic Three.js constellation globe, a packet ledger with hop history, a routing decision audit with candidate score breakdowns, and a same-seed policy comparison with JSON/CSV export. Live run telemetry streams over WebSocket while REST stays authoritative for stepping.
* **Dual Execution Modes:**  
  * **In-Process Mode:** High-speed deterministic execution for simulation and unit testing.
  * **Container Mode:** Multi-container deployment where isolated Docker containers run standalone satellite agents.

---

## Interface

The frontend is a simulation workbench, not a live mission-control feed. Every number, link state, packet position, and routing decision comes from the backend run.

| Workspace | What it answers |
| --- | --- |
| **Overview** | Delivery ratio, loss reasons, delay distribution, buffering, topology load, run metadata, recent events, registered agents. |
| **Constellation** | Schematic 3D globe with satellites, ground anchors, contact links, and packets in flight. Click any node or link for its detail. |
| **Packets** | Every generated packet, its current holder, status, hop count, age or delivery delay, and full route history. |
| **Routing** | Per-hop decisions with the candidate scores that produced them, including penalties and the chosen next hop. |
| **Compare** | Runs baseline and SWARMNET on the same scenario and seed, then reports measured deltas and exports the active run. |

**3D constellation.** The globe is a faceted icosphere with land outlines derived from Natural Earth 1:110m (public domain). Orbital planes, phases, and ground anchors are derived deterministically from the run seed because scenarios carry only abstract coordinates. Motion is illustrative and not to scale; network state is not. Packets move only when the transport layer reports a handoff, and unavailable links are drawn dashed rather than animated. The scene is lazy-loaded, supports reduced motion, falls back to a keyboard-accessible object list when WebGL is unavailable, and never blocks the rest of the workspace.

**Controls.** Initialize a run from the top bar, then run or pause playback, advance by one or five simulated seconds, reset, and choose a playback speed. Keyboard shortcuts: `1` to `5` switch workspaces, `Space` toggles playback, `Right Arrow` advances one second, and `Escape` clears the active inspector.

---

## Quick Start

### Prerequisites
* **Python:** 3.11+ (verified on 3.12)
* **Node.js:** v18+ (verified on v22)
* **Docker & Compose:** v20+ (optional, for multi-container demo)

---

### Option A: Local Development (Fastest)

#### 1. Start Backend API
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
* Backend API: `http://127.0.0.1:8000`
* Interactive API Documentation (Swagger): `http://127.0.0.1:8000/docs`

#### 2. Start Frontend Dashboard
```bash
cd frontend
npm install
npm run dev
```
* Dashboard URL: `http://localhost:3000` (or `http://localhost:5173`)

#### 3. One-Click Convenience Launchers
* **Windows:** Double-click or run `scripts\run_demo.bat`
* **Linux / macOS:** Run `chmod +x scripts/run_demo.sh && ./scripts/run_demo.sh`

---

### Option B: Docker Compose Deployment

Run the complete constellation stack with isolated satellite and ground station containers:

```bash
docker compose up --build
```

Services started:
* `backend`: FastAPI orchestrator on port `8000`
* `sat-01` to `sat-04`: Isolated satellite HTTP agents on ports `8101`–`8104`
* `ground-01`: Ground station endpoint on port `8105`
* `frontend`: Nginx serving the React production build on port `3000`

To tear down:
```bash
docker compose down
```

---

## Bundled Scenarios

SWARMNET includes 4 reproducible scenarios in the `scenarios/` directory:

| Scenario | Name | Key Challenge Tested |
|---|---|---|
| `basic_delivery.yaml` | Basic Multi-Hop Delivery | Stable multi-hop link propagation ($SAT_1 \to SAT_2 \to SAT_3 \to Ground$). |
| `intermittent_contact.yaml` | Intermittent Ground Contact | Total downlink blackout ($t=10\text{s}$ to $35\text{s}$). Packets must be held in satellite buffers and resume forwarding at $t=35\text{s}$. |
| `route_disruption.yaml` | Route Disruption & Rerouting | Primary route severs at $t=10\text{s}$; alternate route opens at $t=15\text{s}$. Tests autonomous dynamic rerouting. |
| `buffer_pressure.yaml` | High-Traffic Buffer Congestion | Constrained 16 KB buffers with packet bursts. Demonstrates priority eviction and drop auditability. |

---

## Systematic Evaluation: SWARMNET vs. Baseline

To run the automated comparative benchmark runner across all 4 scenarios with identical random seeds:

```bash
python scripts/run_experiments.py
```

### Benchmark Results Table (Seed: 42)

```text
======================================================================================
 SWARMNET vs. BASELINE — SYSTEMATIC EXPERIMENTAL EVALUATION
======================================================================================
Scenario               | Metric             | Baseline     | SWARMNET     | Delta       
--------------------------------------------------------------------------------------
basic_delivery         | Delivery Ratio     |      100.0% |      100.0% |        +0.0%
                       | Delivered / Gen    |          5/5 |          5/5 |           +0
                       | Mean Latency       |       3.00s  |       3.00s  |       +0.00s
                       | Dropped Packets    |            0 |            0 |           +0
--------------------------------------------------------------------------------------
intermittent_contact   | Delivery Ratio     |      100.0% |      100.0% |        +0.0%
                       | Delivered / Gen    |          4/4 |          4/4 |           +0
                       | Mean Latency       |      23.50s  |      22.50s  |       -1.00s
                       | Dropped Packets    |            0 |            0 |           +0
--------------------------------------------------------------------------------------
route_disruption       | Delivery Ratio     |       93.3% |      100.0% |        +6.7%
                       | Delivered / Gen    |        14/15 |        15/15 |           +1
                       | Mean Latency       |       7.29s  |       7.00s  |       -0.29s
                       | Dropped Packets    |            0 |            0 |           +0
--------------------------------------------------------------------------------------
buffer_pressure        | Delivery Ratio     |      100.0% |      100.0% |        +0.0%
                       | Delivered / Gen    |        30/30 |        30/30 |           +0
                       | Mean Latency       |       5.03s  |       5.00s  |       -0.03s
                       | Dropped Packets    |            0 |            0 |           +0
--------------------------------------------------------------------------------------
======================================================================================
```

Results are automatically exported to:
* `data/experiments/latest_benchmark.json`
* `data/experiments/latest_benchmark.csv`

### Seed Robustness Sweep (Seeds 0–100)

Each scenario was also run head-to-head for every seed in `0..100` with identical topology, traffic, and link events:

| Scenario | Seeds with SWARMNET ahead | Seeds tied | Seeds with SWARMNET behind |
|---|---:|---:|---:|
| `basic_delivery` | 0 | 101 | 0 |
| `intermittent_contact` | 0 | 101 | 0 |
| `route_disruption` | 97 | 4 | 0 |
| `buffer_pressure` | 3 | 98 | 0 |

Across 404 paired runs there were **zero delivery regressions** (SWARMNET never delivered fewer packets than the baseline). `intermittent_contact` ties on delivery with 1.00 s lower mean latency in every seed; `route_disruption` is strictly ahead in 97 of 101 seeds. The remaining `buffer_pressure` differences are within one tick of mean latency, not delivery count. This sweep is a robustness check, not a claim that SWARMNET dominates every possible network.

---

## Automated Test Suite

Run the backend suite (43 unit, integration, and scenario tests):

```bash
cd backend
pytest -v
```

Run the frontend suite (28 component, formatting, and geography tests):

```bash
cd frontend
npm test
```

Test coverage includes:
* `test_models.py`: Pydantic schema validation for packets, links, nodes, and events.
* `test_clock.py`: Virtual clock stepping, pausing, resuming, and callback dispatch.
* `test_buffering.py`: Buffer capacity bounds, priority eviction, and TTL expiration.
* `test_routing_baseline.py`: Shortest path routing and partition buffering.
* `test_routing_swarmnet.py`: Multi-factor candidate scoring and contact feasibility filtering.
* `test_determinism.py`: Identical seed reproducibility.
* `test_container_transport.py`: Logical link enforcement over network transports.
* `test_api.py`: FastAPI routes, runs, stepping, topology, and comparison endpoints.
* `test_scenario_delivery.py`: Full end-to-end multi-hop delivery across scenarios.
* `frontend/src/**/*.test.tsx`: Workspace rendering, filtering, inspectors, comparison flow, and export links.
* `frontend/src/**/*.test.ts`: Formatting helpers, link and buffer classification, and globe geography.

---

## Documentation Index

* [`PRD.md`](PRD.md): Complete Product Requirements Document.
* [`docs/architecture.md`](docs/architecture.md): System architecture, component responsibilities, and data flows.
* [`docs/experiment-methodology.md`](docs/experiment-methodology.md): Formal metric definitions, controlled variables, and scientific assumptions.
* [`docs/demo-script.md`](docs/demo-script.md): 5-minute guided presentation walkthrough.
* [`docs/implementation_checklist.md`](docs/implementation_checklist.md): Phase-by-phase implementation tracking.

---

## Modeling Assumptions & Limitations

1. **Simulation Scope:** This software is an educational and research prototype. It does not claim to be flight-ready or orbital-physics certified.
2. **Abstract Coordinates:** Satellites use 2D/3D Euclidean coordinates and schedule tables rather than continuous SGP4/SDP4 orbital perturbation models.
3. **Transport Layer:** Packet serialization and propagation are modeled with discrete event scheduling rather than low-level kernel TAP/TUN devices.
