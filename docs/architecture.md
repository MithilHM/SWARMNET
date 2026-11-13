# SWARMNET System Architecture

## 1. System Overview

SWARMNET is an autonomous, delay-tolerant networking (DTN) layer simulator designed for dynamic satellite constellations with time-varying topologies, intermittent links, and variable link quality.

The platform demonstrates how satellite nodes can independently buffer, forward, and deliver packets to one or more ground stations using a store-carry-forward mechanism without requiring a centralized routing controller.

```
                             +------------------------+
                             |    Dashboard / UI      |
                             | (React + Vite + Flow)  |
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

## 2. Component Responsibilities

### 2.1 Simulation Engine (`backend/app/simulation/`)
- **Clock (`clock.py`):** Maintains discrete simulated time ticks, independent of wall-clock time. Supports pause, resume, step, and reset.
- **Topology Manager (`topology.py`):** Holds the ground-truth state of nodes (satellites and ground stations) and directed links. Links have dynamic attributes: availability, latency (ms), bandwidth (Mbps), reliability (0.0-1.0), and scheduled contact end time. It also stores each link's contact plan as sorted available windows, which the routing layer uses to estimate future connectivity.
- **Event Scheduler (`events.py`):** Applies deterministic scheduled events (link-up, link-down, link-degradation, recovery) at specific simulation timestamps.
- **Scenario Loader (`scenarios.py`):** Validates and loads YAML scenario specifications including nodes, links, traffic streams, and event schedules.

### 2.2 Packet Lifecycle & Buffering (`backend/app/buffering/`, `models/`)
- **Packets (`models/packet.py`):** Unique UUID, source, destination, creation time, expiry time (TTL), payload size, priority, hop count, max hops, visited nodes list, and status (`created`, `buffered`, `in_transit`, `delivered`, `dropped`, `expired`).
- **Local Buffer (`buffering/buffer.py`):** Each satellite maintains an isolated, capacity-bounded storage buffer. When capacity is exceeded, an eviction policy (e.g. drop lowest priority / earliest expiry first) drops packets with explicit accounting.
- **Duplicate Suppression:** Both intermediate forwarders and the ground station track delivered/processed packet IDs to prevent duplicate loops or multiple accounting.

### 2.3 Routing Engine (`backend/app/routing/`)
- **Routing Policy Interface (`base.py`):** Defines `evaluate_next_hop(node_id, packet, topology, local_state)` returning a `RouteDecision` with action (`forward`, `buffer`, `drop`), target next hop, reason code, and candidate scores.
- **Baseline Policy (`shortest_path.py`):** Shortest available path using Dijkstra based on latency over currently active links. Buffers if no currently connected route exists.
- **SWARMNET Policy (`swarmnet.py`, `scoring.py`):** Autonomous contact-aware heuristic scoring evaluated locally over candidate neighbors:
  $$\text{Score} = w_{\text{prog}} \cdot \text{Progress} + w_{\text{rel}} \cdot \text{Reliability} + w_{\text{cont}} \cdot \text{ContactFeasibility} - w_{\text{lat}} \cdot \hat{L} - w_{\text{cong}} \cdot \hat{Q} - w_{\text{eng}} \cdot E$$
  - **Future-contact path estimation (`path_estimator.py`):** Deterministic earliest-arrival Dijkstra over currently active links plus scheduled future contact windows. Intermediate nodes are assumed to act on the next simulation tick, so a contact that closes between arrival and the receiver's decision is not treated as usable.
  - **Reference-route comparison:** The packet's earliest possible arrival from its current node is computed first. A candidate that cannot reach the destination is rejected as a dead end; one that arrives materially later is retained only to relieve local buffer pressure.
  - **Score components:** Progress compares the candidate's predicted delivery time with the reference route; reliability is the product of link reliabilities along the predicted path; contact feasibility uses the tightest remaining window margin; latency and congestion are normalized path costs.
  - **Buffer-aware backpressure:** If a candidate's buffer is full and its onward route needs a contact window that has not opened yet, the packet is kept locally while the current buffer has room. This avoids evicting a stored packet at the receiver, whose admissions are processed before it drains.
  - **Explainability:** Every candidate's score components, predicted path, arrival time, and rejection reason are recorded in the decision.
- **Failed-handoff recovery:** The transport reports a refused handoff to the sender. The sender restores its owned packet with `NodeBuffer.restore()` rather than re-admitting it, because re-admission would trigger duplicate suppression and silently lose the packet.

### 2.4 Transport Layer (`backend/app/transport/`)
- **LinkTransport Interface (`base.py`):** Decouples forwarding decision from physical/network transfer.
- **In-Process Transport (`in_process.py`):** Schedules in-transit packets based on propagation latency and serialization delay ($t_{\text{serialize}} = \frac{\text{payload\_bytes} \times 8}{\text{bandwidth\_bps}}$), respecting link reliability and availability.
- **Container Transport (`container_transport.py`):** Facilitates inter-container HTTP/JSON transfers between isolated Docker agent services while verifying simulated link availability.

### 2.5 Agents (`backend/app/agents/`)
- **Satellite Agent (`satellite_agent.py`):** Represents an autonomous satellite. Maintains local state (buffer, perceived link state, telemetry) and executes routing decisions on each tick or event.
- **Ground Station Agent (`ground_agent.py`):** Endpoint destination. Ingests delivered packets, records end-to-end delay, deduplicates, and exposes delivered packet telemetry.

### 2.6 Persistence & API (`backend/app/persistence/`, `api/`)
- **SQLite Storage:** Persists simulation run metadata, metrics summaries, and experiment comparison records.
- **FastAPI Service:** Exposes one shared simulation session (`/api/session`, `/play`, `/solve`, `/sever`, `/reset`, `/export`) and a server-sent event stream (`/api/session/stream`). See the README API table.

### 2.7 Guided anomaly to DTN flow (`backend/app/simulation/scenario_generator.py`, `flow_engine.py`, `session.py`)
- **Scenario generator:** `generate_scenario(seed)` is a pure function producing 4–5 satellites on a schematic ground track, 1–2 ground stations, one ground link per satellite, ISLs between neighbouring satellites, a traffic plan, and a failure plan (target satellite, cause, loss pattern: ramp, burst, or flapping).
- **Flow engine:** a deterministic tick-based state machine `IDLE → STABLE → DEGRADING → DETECTED → SOLVING → RESOLVED`. Packets are real `Packet` objects with ids, paths, statuses, and timestamps; links are `Link` objects whose reliability the failure plan or a manual sever changes. Every transmission outcome on a ground link feeds a rolling window; detection fires only when the window's loss rate crosses the threshold, and the engine then halts.
- **DTN switch:** `solve()` scores ISL paths to satellites with a healthy ground link (`0.7 × path reliability + 0.3 × (1 − latency / worst latency) − 0.05 × extra hops`), switches the affected satellite's protocol to DTN, and re-bundles everything it holds, including custody copies of packets lost on the direct link. Custody moves hop by hop only on a successful handoff (at-least-once with duplicate suppression).
- **Comparison:** the direct-to-ground-only column replays the same seed and operator actions with DTN disabled, until the affected satellite has sent the same number of packets.
- **Session:** one run on the backend. An asyncio task paces ticks against the wall clock (simulation slowed 20×) and fans out snapshots and frames over SSE. The frontend holds one store fed by that stream, so the globe and all tabs show the same run.

---

## 3. Data Flow & Packet State Machine

```
   [ Packet Generated ]
            |
            v
   [ Buffer Admission ] ----(Buffer Full & Cannot Evict)----> [ DROPPED (BUFFER_FULL) ]
            |
            v
   [ Route Evaluation ]
      |          |
      |          +--(Expired)-------------------------------> [ EXPIRED (TTL_EXCEEDED) ]
      |          +--(Hop limit reached)---------------------> [ DROPPED (HOP_LIMIT) ]
      |
      +--(No useful link / partition)-----------------------> [ BUFFERED (STORE-CARRY) ]
      |                                                             |
      |                                                             v (link restored / retry)
      +<------------------------------------------------------------+
      |
      v (Next hop chosen)
   [ Link Capacity & Feasibility Check ]
      |
      v
   [ IN_TRANSIT (LinkTransport) ]
      |
      +--(Link dropped / transmission failure)--------------> [ Retry in sender buffer ]
      |
      v (Arrival at target)
   [ Target Node Reception ]
      |
      +--(Target is Ground Station)-------------------------> [ DELIVERED (SUCCESS) ]
      |                                                             |
      |                                                             v
      |                                                       [ Deduplication ]
      v (Target is next satellite)
   [ Re-enter Buffer at Target Node ]
```

---

## 4. Platform Assumptions & Requirements

- **Python Version:** 3.11+ (running on 3.12).
- **Node.js:** v18+ (running v22).
- **Docker & Compose:** v20+ with Compose v2.
- **Host OS:** Windows (PowerShell) / Linux / macOS.
- **Network Mode:** Local loopback bindings `127.0.0.1` by default; isolated Docker bridge network for multi-container demonstration.
