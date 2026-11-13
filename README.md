# SWARMNET — Autonomous Delay-Tolerant Satellite Constellation Network

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

The app is one guided simulation. The globe is the landing view; three tabs sit beside it. Every packet, link state, routing change, and number comes from the backend simulation engine as an event. The frontend only renders those events.

**Flow (backend state machine).**

| Phase | What happens |
| --- | --- |
| `IDLE` | A freshly generated random scenario is drawn: 4–5 satellites, 1–2 ground stations, satellite-to-ground links, and inter-satellite links (ISLs). Nothing moves. |
| `STABLE` | After **Play**, about 2 s of nominal direct-to-ground traffic. |
| `DEGRADING` | The topology changes on one satellite's ground link (rain fade, low elevation, obstruction, interference, or pointing error, per the seeded scenario) and packets start to be lost. |
| `DETECTED` | The backend's rolling loss window on that link crosses the threshold (default: ≥ 50 % of the last 8 transmissions, at least 5 samples). The simulation pauses itself: red flash, red box around the satellite and its ground link, red dashed broken link, alert banner. **Solve** appears. |
| `SOLVING` | The affected satellite switches from direct-to-ground to DTN store-carry-forward. Its bundles, including custody copies of lost packets, cross an ISL to the best-scoring relay, are stored there, then forwarded to the ground. The DTN path is drawn in green. |
| `RESOLVED` | All bundles are delivered ("N/N bundles delivered via SAT-X"). Only **Reset** remains. |

**Controls.** Play, Reset, Solve (shown only while an anomaly is detected), and Sever Link, which cuts a chosen satellite's ground link during `STABLE` or `DEGRADING` and drives the same anomaly flow. Playback controls (pause, step, speed, timeline) do not exist; the backend paces simulated time.

**Tabs.**

| Tab | Content |
| --- | --- |
| **Packet Logs** | Live event log: simulated timestamp, packet id, source, hop path, status (sent / lost / stored / forwarded / delivered), and phase tag (stable / degrading / detected / DTN). Filter by phase or status. |
| **Routing** | Per-satellite routing table before the anomaly and live, protocol per satellite, the affected satellite's old and new path, and relay candidates with scores. |
| **Comparison** | The affected satellite under direct-to-ground only vs with DTN: delivery ratio, lost vs recovered, latency, hops, totals. Computed by the backend from this run. |

Each Play runs a new scenario that is a pure function of its seed. The seed and scenario id are shown in the top bar and returned by the API, so any run can be replayed with `POST /api/session/play {"seed": n}`. The comparison's direct-only column is a deterministic replay of the same seed and operator actions with Solve never pressed. Playback is slowed 20× (the badge on the globe says so) so that millisecond link latencies are visible.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/api/session` | Full snapshot: scenario, state, events, routing, comparison |
| `GET` | `/api/session/stream` | Server-sent events: a snapshot on connect, then one frame per engine tick |
| `POST` | `/api/session/play` | Start the staged scenario, or `{"seed": n}` to replay one; returns `run_id`, `seed`, `scenario_id` |
| `POST` | `/api/session/solve` | Switch the affected satellite to DTN (409 unless `DETECTED`) |
| `POST` | `/api/session/sever` | `{"satellite_id": "SAT-02"}` cuts that ground link (409 unless `STABLE`/`DEGRADING`) |
| `POST` | `/api/session/reset` | Back to `IDLE` with a newly generated scenario |
| `GET` | `/api/session/export` | JSON export of the run (config, seed, actions, events, metrics) |
| `POST`/`GET` | `/api/agents/*` | Containerized agent registration and heartbeats |

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

```bash
cd backend && pytest -q      # engine, scenario generation, session API, plus the original routing/buffering suites
cd frontend && npm test      # store, controls, tabs, globe geography
```

Guided-flow coverage:
* `tests/unit/test_flow_scenario.py`: scenario generation is deterministic per seed and varies across seeds (satellite count, failing satellite, failure pattern, latencies).
* `tests/unit/test_flow_engine.py`: state machine order, auto-pause on detection, detection driven by loss rather than time, manual sever override, DTN relay delivery (A → relay → ground), recovery of lost packets, counterfactual replay, and resolution across many seeds.
* `tests/integration/test_session_api.py`: full Play → DETECTED → Solve → RESOLVED → Reset through the API, phase gating (409s), seed replay, and the SSE stream.
* `frontend/src/**/*.test.ts(x)`: snapshot/frame merging and reset in the shared store, controls (Solve only on anomaly, no playback controls), and the three tabs rendering backend data.

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
