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
- **Topology Manager (`topology.py`):** Holds the ground-truth state of nodes (satellites and ground stations) and directed links. Links have dynamic attributes: availability, latency (ms), bandwidth (Mbps), reliability (0.0-1.0), and scheduled contact end time.
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
  - Filters out unviable neighbors (backtracking, loop hazards, contact duration shorter than serialization + latency).
  - Selects highest positive score or buffers if no neighbor provides progress/feasibility.

### 2.4 Transport Layer (`backend/app/transport/`)
- **LinkTransport Interface (`base.py`):** Decouples forwarding decision from physical/network transfer.
- **In-Process Transport (`in_process.py`):** Schedules in-transit packets based on propagation latency and serialization delay ($t_{\text{serialize}} = \frac{\text{payload\_bytes} \times 8}{\text{bandwidth\_bps}}$), respecting link reliability and availability.
- **Container Transport (`container_transport.py`):** Facilitates inter-container HTTP/JSON transfers between isolated Docker agent services while verifying simulated link availability.

### 2.5 Agents (`backend/app/agents/`)
- **Satellite Agent (`satellite_agent.py`):** Represents an autonomous satellite. Maintains local state (buffer, perceived link state, telemetry) and executes routing decisions on each tick or event.
- **Ground Station Agent (`ground_agent.py`):** Endpoint destination. Ingests delivered packets, records end-to-end delay, deduplicates, and exposes delivered packet telemetry.

### 2.6 Persistence & API (`backend/app/persistence/`, `api/`)
- **SQLite Storage:** Persists simulation run metadata, metrics summaries, and experiment comparison records.
- **FastAPI Service:** Exposes REST endpoints (`/api/scenarios`, `/api/runs`, `/api/experiments`, etc.) and a WebSocket stream (`/ws/runs/{run_id}`) for live telemetry.

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
