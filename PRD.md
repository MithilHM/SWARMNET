# SWARMNET — Product Requirements Document (PRD)

**Product:** SWARMNET  
**Version:** 1.0  
**Status:** Implementation-ready specification  
**Project theme:** Delay-Tolerant Internet for Satellite Constellations  
**SDG alignment:** SDG 9 — Industry, Innovation & Infrastructure  
**Primary audience:** An agentic coding IDE implementing the project end to end  
**Delivery model:** Software-only, reproducible simulation; no real satellites or physical radio hardware required

---

## 1. Executive Summary

SWARMNET is a software prototype of an autonomous, delay-tolerant networking layer for satellite constellations whose topology changes over time. Satellites are represented as isolated Docker containers running lightweight Python agents. A constellation simulator changes which links are available and updates link properties such as latency, bandwidth, reliability, and expected remaining contact duration.

Each satellite makes its own next-hop forwarding decisions using locally available link and routing information. When a destination cannot currently be reached, the satellite stores packets in a persistent local buffer and forwards them when a useful contact becomes available. The ground station receives delivered packets and exposes network telemetry; it is an observer and endpoint, not a central controller that dictates every forwarding decision.

The project must demonstrate that routing and delivery continue to work despite changing links, temporary partitions, link failures, and delayed ground-station contact. It must also compare SWARMNET's routing policy against a simple baseline and report measurable outcomes.

**Core product statement:** Simulate a changing satellite constellation and demonstrate autonomous, store-carry-forward packet delivery over intermittent links.

---

## 2. Problem Statement

Traditional network routing generally assumes that usable paths exist often enough for timely end-to-end forwarding. In a satellite constellation, links can appear and disappear as satellites move, contact windows may be short, bandwidth is constrained, and a path to a ground station may not currently exist.

A conventional immediate-forwarding approach may drop data or repeatedly attempt unavailable routes. SWARMNET instead treats disconnection as an expected network condition:

1. Generate a packet at a satellite.
2. Select a currently useful next hop using link and routing intelligence.
3. Forward the packet when a link is available and resources permit.
4. Store the packet when no suitable contact exists.
5. Re-evaluate forwarding opportunities as the topology changes.
6. Deliver the packet to a ground station when a route/contact becomes available.

The implementation is a simulation and educational/research prototype. It must not claim to be flight-qualified, orbital-physics accurate, or suitable for deployment on real spacecraft.

---

## 3. Product Goals

### 3.1 Must achieve

- Model a constellation of configurable satellite nodes and one or more ground stations.
- Simulate time-varying links without restarting Docker containers.
- Give each satellite an independent agent, local routing state, telemetry, and persistent store-and-forward buffer.
- Implement delay-tolerant packet delivery across intermittent links.
- Recompute forwarding decisions as link availability and quality change.
- Support packet expiry, hop limits, duplicate suppression, buffer capacity limits, and link failures.
- Provide a live dashboard showing topology, links, packets, buffers, routing decisions, and delivery metrics.
- Run reproducibly using documented commands and a single local development setup.
- Include automated tests and a scripted demonstration scenario.
- Compare the SWARMNET policy with at least one baseline using measurable metrics.

### 3.2 Nice to have, after the core is stable

- Multiple routing strategies selectable at runtime.
- Configurable energy consumption and energy-aware routing.
- Contact-window prediction based on simulator schedules.
- Scenario editor and downloadable experiment results.
- Larger-scale performance testing (e.g., 100–500 simulated satellites).
- Optional network emulation using Linux traffic-control tools, only if it remains portable and does not compromise the core simulator.

### 3.3 Explicit non-goals

- Connecting to real satellites, radio equipment, or live space networks.
- Accurate orbital mechanics or high-fidelity orbital propagation in the first version.
- A production-grade interplanetary networking implementation.
- Blockchain, cryptocurrency, or token functionality.
- A central controller making every next-hop decision.
- Restarting or creating containers every time a link appears or disappears.
- Claiming the system is flight-ready or security-certified.
- Building a complex microservices platform before the simulator and routing engine work.

---

## 4. Users and Primary Use Cases

### Primary user
A student, researcher, or evaluator who wants to observe and compare routing strategies in a dynamic, intermittently connected satellite network.

### User stories

1. **Configure a constellation:** As a user, I can choose the number of satellites, ground stations, traffic sources, and simulation duration.
2. **Observe dynamic links:** As a user, I can see links appear, degrade, and disappear as simulated time advances.
3. **Send data through the constellation:** As a user, I can generate packets at a satellite and watch them move through multiple hops.
4. **Survive a partition:** As a user, I can disconnect the source from all useful routes and see packets remain buffered rather than immediately being discarded.
5. **Resume delivery:** As a user, I can restore or introduce a contact opportunity and observe buffered packets being forwarded.
6. **Understand routing decisions:** As a user, I can inspect why a satellite chose a particular next hop or decided to wait.
7. **Compare algorithms:** As a user, I can run the same scenario with SWARMNET and a baseline and compare delivery ratio, latency, drops, hops, and buffer occupancy.
8. **Reproduce results:** As a user, I can run a predefined scenario with a fixed random seed and obtain comparable results.

---

## 5. Scope and Acceptance Criteria

The project is considered complete only when the following end-to-end path works:

**Start environment → create constellation → advance simulation → generate packets → change topology → make local routing decisions → buffer when disconnected → resume forwarding → deliver to ground → view metrics → export results.**

### Acceptance criteria

- `docker compose up --build` starts the documented development stack without manual container-by-container setup.
- A health/status endpoint or equivalent indicates that the backend and agents are ready.
- The demo scenario runs from a documented command or UI action.
- At least one packet traverses multiple satellite hops and reaches a ground station.
- During a deliberate network partition, packets are retained in a satellite buffer and are not falsely reported as delivered.
- When a scheduled contact returns, eligible buffered packets can resume forwarding and reach the ground station.
- A link failure causes affected satellites to stop selecting that link for new forwarding decisions.
- Duplicate packet deliveries are suppressed at the destination.
- Expired packets and buffer overflow are accounted for explicitly in metrics.
- The dashboard updates without requiring a full page reload.
- The baseline and SWARMNET can be run against the same scenario and seed.
- Unit and integration tests pass using documented commands.
- A clean checkout can be installed and run by following only the README.

---

## 6. System Architecture

### 6.1 Logical architecture

```text
                         SWARMNET
                            |
        +-------------------+-------------------+
        |                                       |
  Simulation / API                         Web Dashboard
        |                                       |
  Topology Simulator <-------------------- Telemetry API
        |
  Dynamic Link State + Scenario Clock
        |
  +-----+------------+------------+------------------+
  |                  |            |                  |
SAT-01 Agent     SAT-02 Agent  SAT-03 Agent      Ground Agent
  |                  |            |                  |
Local routes      Local routes  Local routes      Receive/store
Packet buffer     Packet buffer Packet buffer     delivered packets
  +------------------+------------+------------------+
                     |
              Link / Packet Transport
```

### 6.2 Architectural principles

- **Satellite autonomy:** A satellite decides locally using its current neighbor/link state and locally available route/contact information. No central component dictates every hop.
- **Simulation authority vs. forwarding authority:** The simulator owns the ground truth for simulated time and which links physically exist in the model. Agents own forwarding choices and local queues.
- **Control/telemetry separation:** The backend can coordinate scenarios and aggregate metrics, but it must not secretly route packets on behalf of satellites.
- **Determinism:** A scenario seed and simulation clock should make runs reproducible.
- **Transport abstraction:** Routing logic must not depend directly on Docker networking details. Use a `LinkTransport` interface so in-process simulation can be used for fast tests and container-based transport can be used for the demo.
- **Incremental complexity:** Build a correct discrete-event/in-process simulator first; then integrate containerized agents. Avoid debugging routing, Docker networking, and UI simultaneously.

### 6.3 Recommended implementation stack

Use these defaults unless a genuine compatibility issue requires a documented alternative:

- **Language:** Python 3.11+
- **Backend/API:** FastAPI + Uvicorn
- **Validation/configuration:** Pydantic
- **Core simulation:** Python discrete-event or tick-based engine with an injectable clock and seeded randomness
- **Agent communication:** HTTP/JSON for control and telemetry; packet transport through a clearly defined internal transport adapter. WebSocket may be used for live dashboard updates.
- **Containerization:** Docker + Docker Compose
- **Frontend:** React + TypeScript + Vite
- **UI styling:** Tailwind CSS or a simple consistent CSS system
- **Topology visualization:** React Flow or Cytoscape.js; choose one and avoid duplicating graph libraries
- **Charts:** Recharts or an equivalent lightweight chart library
- **Testing:** pytest for backend; frontend test tooling if added; integration tests for the end-to-end demo
- **Persistence:** SQLite for run metadata and experiment results in the prototype; per-agent packet buffers persisted to local files or SQLite volumes. Keep the storage interface replaceable.
- **Lint/format:** Ruff for Python; ESLint/Prettier for frontend

Do not add Kafka, Kubernetes, Redis, a distributed database, or a large message broker to the first version. They are unnecessary for proving the core routing concept.

---

## 7. Core Domain Model

Use typed models and a clear separation between simulation state, network state, and packet state.

### 7.1 Satellite

Required fields:

- `satellite_id: str`
- `position`: optional abstract 2D/3D coordinates for visualization; not required to represent real orbital coordinates
- `energy_percent: float` in `[0, 100]`
- `buffer_capacity_bytes: int`
- `buffer_used_bytes: int`
- `status: active | disabled`
- `neighbors`: current directly reachable neighbors, derived from active links
- `routing_table`: local route/contact estimates, recalculated as information changes
- `last_state_update`: simulation timestamp

### 7.2 Ground station

Required fields:

- `ground_station_id: str`
- `status: active | disabled`
- `received_packet_ids: set/list` or a persistent deduplication index
- `total_bytes_received`
- `last_contact_time`

Treat the ground station as a destination/endpoint and telemetry observer, not as a central routing controller.

### 7.3 Link

Required fields:

- `link_id: str`
- `source_node_id: str`
- `target_node_id: str`
- `is_available: bool`
- `latency_ms: float`
- `bandwidth_mbps: float`
- `reliability: float` in `[0, 1]`
- `contact_end_time: float | null`
- `last_updated_at: float`
- `failure_reason: str | null`

Support directed links in the data model, even if default scenarios create symmetric links. A link may be unavailable because of a scheduled contact window, a simulated failure, or disabled endpoints.

### 7.4 Packet

Required fields:

- `packet_id: str` (globally unique)
- `source_node_id: str`
- `destination_node_id: str`
- `created_at: float` (simulation time)
- `expires_at: float | null`
- `payload_size_bytes: int`
- `priority: low | normal | high`
- `current_node_id: str`
- `hop_count: int`
- `max_hops: int`
- `visited_node_ids: list[str]` or an equivalent loop-prevention structure
- `status: created | buffered | in_transit | delivered | dropped | expired`
- `drop_reason: str | null`
- `delivery_time: float | null`
- `route_history: list[RouteHop]`

Keep packet payloads lightweight in the prototype; packet metadata and a generated payload-size value are sufficient. Avoid sending large real files in the first version.

### 7.5 Route decision

Each routing decision should record:

- `decision_id`
- `packet_id`
- `satellite_id`
- `chosen_next_hop_id: str | null`
- `decision: forward | buffer | drop`
- `reason_code`
- `candidate_scores` or candidate explanation data
- `decision_time`
- `routing_policy`

Possible reason codes include `LOWEST_COST`, `CONTACT_ENDING`, `LINK_UNAVAILABLE`, `NO_ROUTE`, `BUFFER_FULL`, `PACKET_EXPIRED`, `HOP_LIMIT`, `DUPLICATE`, and `ENERGY_CONSTRAINT`.

### 7.6 Simulation run

Required fields:

- `run_id`
- `scenario_id`
- `seed`
- `routing_policy`
- `started_at`
- `simulated_duration`
- `status: queued | running | completed | failed | stopped`
- `config_snapshot`
- `metrics_summary`

---

## 8. Functional Requirements

### FR-1: Scenario configuration

The user must be able to select or load a scenario containing:

- Satellite count
- Ground station count
- Initial node/link layout
- Link schedules or topology events
- Link latency, bandwidth, reliability, and contact duration
- Traffic generation rate, source, destination, packet size, priority, and expiry
- Simulation duration and time-step/tick configuration
- Random seed
- Routing policy
- Optional energy and buffer constraints

Provide at least three bundled scenarios:

1. **Basic delivery:** A stable multi-hop route exists; packets should reach the ground station.
2. **Intermittent contact:** No route exists for a period; packets must be buffered and delivered after contact returns.
3. **Route disruption:** The currently preferred path fails or becomes poor; the source should choose an alternate route when one is available.

### FR-2: Topology simulation

The simulator must:

- Maintain simulation time independently of wall-clock time.
- Apply scheduled link-up, link-down, degradation, and recovery events.
- Update link attributes as events occur.
- Notify affected agents or make the latest link state available to them.
- Emit topology events for the dashboard and metrics recorder.
- Support pause, resume, step, and reset operations.
- Support a fixed seed for stochastic reliability/failure events.
- Never restart Docker containers just to simulate link changes.

Start with a deterministic, discrete-event or tick-based model. Real orbital propagation is out of scope. Optional orbital-like movement can be represented by abstract coordinates and scheduled contact windows.

### FR-3: Satellite agent

Each satellite agent must:

- Maintain its own node identity, local buffer, local neighbor/link state, and route estimates.
- Receive topology/link updates relevant to the satellite.
- Make local forwarding decisions.
- Forward a packet only when the selected link is available and capacity allows it.
- Buffer a packet if no viable next hop is currently available.
- Retry eligible buffered packets when state changes or a scheduled retry occurs.
- Avoid forwarding loops using hop limits, visited nodes, or equivalent safe logic.
- Record every forwarding, buffering, delivery, expiry, and drop decision.
- Expose health and telemetry information.
- Continue to function if the ground station is temporarily unreachable.

### FR-4: Delay-tolerant store-and-forward

Implement store-carry-forward behavior:

1. Accept a packet into the local buffer if capacity allows.
2. If the destination is directly reachable, attempt delivery.
3. Otherwise select a useful next hop based on local route/contact information.
4. If no useful link is available, retain the packet in the buffer.
5. When a link becomes available or relevant state changes, re-evaluate eligible buffered packets.
6. Remove a packet from the sending buffer only after transport confirms successful handoff, or implement an explicit in-flight state with retry/acknowledgement semantics.
7. Suppress duplicates using packet IDs and deduplication records.
8. Drop or expire packets only according to explicit policy and record the reason.

Define packet ownership carefully. A packet must not disappear when a transfer fails. The implementation must state whether transfer semantics are at-least-once with deduplication or another model; use **at-least-once handoff with destination/intermediate duplicate suppression** for the initial prototype.

### FR-5: Routing engine

Implement a policy interface so algorithms can be compared without changing agents or transport code.

Required policies:

**A. Baseline — shortest available path**
- Compute a path over currently available links using latency as the primary edge cost.
- If no path exists, buffer.
- Recompute when topology changes.
- This baseline is intentionally simple and does not claim to predict future contacts.

**B. SWARMNET — contact-aware forwarding**
- Evaluate feasible next hops using current link availability, latency, bandwidth, reliability, estimated remaining contact duration, and optional energy.
- Prefer neighbors that make progress toward a destination/contact opportunity and are unlikely to lose contact before a packet can be handed off.
- Avoid immediate backtracking and loops.
- If no neighbor is currently useful, buffer instead of blindly forwarding.
- Re-evaluate when new contact/link information arrives.
- Expose the score components and reason for every decision.

Keep the score interpretable and configurable. A suggested first scoring model is:

`score = w_progress * progress + w_reliability * reliability + w_contact * contact_feasibility - w_latency * normalized_latency - w_congestion * normalized_queue_pressure - w_energy * energy_penalty`

Where:
- `progress` estimates whether the candidate is closer to a known destination/contact opportunity, or improves the estimated route cost.
- `contact_feasibility` rewards a contact window long enough to transfer the packet, including latency and serialization time.
- `normalized_latency`, `normalized_queue_pressure`, and `energy_penalty` are scaled to comparable ranges.
- Weights are configurable and must be documented.

Do not pretend a heuristic is mathematically optimal. Keep the first implementation deterministic and easy to test. If a metric is unknown, use a documented default and lower confidence rather than silently inventing certainty.

### FR-6: Link capacity and transfer timing

- Calculate packet serialization time from payload size and bandwidth.
- Do not transmit over a link that is unavailable.
- Do not start a transfer if the contact window is clearly too short for the transfer model to complete.
- Model propagation/processing latency separately from serialization time where practical.
- Enforce a link's bandwidth through a simple queue or capacity scheduler.
- Keep the initial implementation simple; no need for packet-level TCP/IP emulation.

### FR-7: Buffer management

- Enforce per-satellite buffer capacity.
- Track bytes and packet counts in buffers.
- Support a deterministic eviction/drop policy when full, such as drop-lowest-priority/earliest-expiry first. Document the exact ordering.
- Expire packets when simulation time exceeds `expires_at`.
- Prevent duplicate copies from consuming unlimited buffer capacity.
- Report every overflow/expiry/drop with a reason.

### FR-8: Telemetry and metrics

At minimum, calculate:

- Packets generated
- Packets delivered
- Packets dropped, by reason
- Packets expired
- Delivery ratio
- Mean, median, and p95 end-to-end delivery delay for delivered packets
- Mean hop count for delivered packets
- Total bytes delivered
- Buffer occupancy by satellite over time
- Link utilization or transferred bytes by link
- Routing decisions by policy and reason
- Time spent buffered
- Number of route changes / next-hop changes
- Energy consumed, if energy modeling is enabled

Definitions must be explicit:
- `delivery_ratio = delivered_packets / generated_packets`, with a safe zero-packet case.
- End-to-end delay is `delivery_time - created_at`.
- A packet not delivered by the end of a run is not counted as delivered; report it as pending/buffered separately rather than automatically treating it as dropped.
- State whether results are packet-weighted or byte-weighted.

### FR-9: Dashboard

The dashboard should contain these views:

1. **Overview**
   - Run status, elapsed simulated time, node count, active links, packets generated/delivered/pending/dropped, delivery ratio, average delay.
2. **Topology**
   - Graph view with satellite and ground-station nodes.
   - Active links visually distinguishable from unavailable/degraded links.
   - Node selection opens details such as energy, buffer occupancy, neighbors, and recent decisions.
   - Link selection shows latency, bandwidth, reliability, availability, and contact end time.
3. **Packet flow**
   - Recent packet events and route history.
   - Clear indication of buffered, in-transit, delivered, expired, and dropped packets.
4. **Routing decisions**
   - Show candidate next hops, score components, chosen action, and reason.
5. **Metrics**
   - Time-series charts for delivery, delay, buffer occupancy, active links, and drops.
   - Side-by-side comparison between policies for the same scenario and seed.
6. **Scenario controls**
   - Start, pause, resume, step, reset.
   - Select scenario, policy, seed, and simulation speed.

The UI must display an explicit “simulation” label. Avoid misleading representations that imply live orbital telemetry.

### FR-10: API and live updates

Provide a documented REST API. Exact route names may vary if the API remains consistent and documented.

Suggested endpoints:

- `GET /health`
- `GET /api/scenarios`
- `GET /api/scenarios/{scenario_id}`
- `POST /api/runs` — create/start a run
- `GET /api/runs/{run_id}`
- `POST /api/runs/{run_id}/pause`
- `POST /api/runs/{run_id}/resume`
- `POST /api/runs/{run_id}/step`
- `POST /api/runs/{run_id}/reset`
- `GET /api/runs/{run_id}/topology`
- `GET /api/runs/{run_id}/metrics`
- `GET /api/runs/{run_id}/events`
- `GET /api/runs/{run_id}/packets`
- `GET /api/runs/{run_id}/nodes/{node_id}`
- `GET /api/runs/{run_id}/decisions`
- `POST /api/experiments/compare`
- `GET /api/runs/{run_id}/export`

Use WebSocket or server-sent events for live telemetry if practical. Include clear API schemas and error responses. Validate all user-provided scenario settings.

### FR-11: Experiment comparison and export

- Run a selected scenario with a fixed seed under the baseline policy and SWARMNET policy.
- Use equivalent traffic and topology events for a fair comparison.
- Present side-by-side metrics and clearly label the policies.
- Export a JSON or CSV report with run configuration, seed, metrics, and summary.
- Do not hardcode results or promise SWARMNET will outperform the baseline in every scenario.
- Include enough metadata to reproduce each experiment.

---

## 9. Non-Functional Requirements

### Reliability
- No packet may be silently lost by internal state transitions.
- Every packet terminal state must be auditable.
- Failures should be surfaced in logs and run status.

### Performance
- The in-process simulator should support a target of 100 satellites for the standard demo on a typical developer laptop.
- Aim for a 500-satellite stress scenario as a stretch goal, not a hard requirement.
- UI rendering must remain responsive while simulation events arrive.
- Avoid one network request per packet per animation frame; batch telemetry updates.

### Reproducibility
- Seed all random processes.
- Save the full scenario configuration with each run.
- Separate simulated time from wall-clock time.
- Provide a deterministic test mode.

### Maintainability
- Use type hints, Pydantic models, focused modules, and clear interfaces.
- Avoid giant single-file implementations.
- Keep routing algorithms independently testable.
- Add docstrings for non-obvious algorithms and explain score normalization.

### Security and safety
- Bind development services to local interfaces by default.
- Do not execute user-supplied code from scenarios.
- Validate scenario input and limit node/packet counts to prevent accidental resource exhaustion.
- Do not store secrets in the repository.
- Clearly state that this is a simulator and not a safety-certified flight system.

### Accessibility and usability
- Provide readable labels, tooltips, legends, and empty/error states.
- Do not rely on color alone to distinguish link/packet states.
- Ensure core controls are keyboard-accessible.

---

## 10. Suggested Repository Structure

Adapt as needed, but preserve the separation of responsibilities.

```text
swarmnet/
├── README.md
├── PRD.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── Makefile
├── docs/
│   ├── architecture.md
│   ├── routing-algorithms.md
│   ├── api.md
│   ├── experiment-methodology.md
│   └── demo-script.md
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── models/
│   │   ├── simulation/
│   │   │   ├── clock.py
│   │   │   ├── engine.py
│   │   │   ├── topology.py
│   │   │   ├── events.py
│   │   │   └── scenarios.py
│   │   ├── routing/
│   │   │   ├── base.py
│   │   │   ├── shortest_path.py
│   │   │   ├── swarmnet.py
│   │   │   └── scoring.py
│   │   ├── agents/
│   │   │   ├── satellite_agent.py
│   │   │   └── ground_agent.py
│   │   ├── transport/
│   │   │   ├── base.py
│   │   │   ├── in_process.py
│   │   │   └── container_transport.py
│   │   ├── buffering/
│   │   ├── telemetry/
│   │   ├── persistence/
│   │   └── config.py
│   └── tests/
│       ├── unit/
│       ├── integration/
│       └── scenarios/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── topology/
│   │   │   ├── packets/
│   │   │   ├── routing/
│   │   │   ├── metrics/
│   │   │   └── scenarios/
│   │   ├── api/
│   │   └── types/
│   └── tests/
├── scenarios/
│   ├── basic_delivery.yaml
│   ├── intermittent_contact.yaml
│   └── route_disruption.yaml
├── scripts/
│   ├── dev.sh
│   ├── run_demo.sh
│   └── run_experiment.sh
└── data/
    └── .gitkeep
```

Do not create every directory as an empty placeholder at the start. Create files when their phase requires them.

---

## 11. Phased End-to-End Implementation Plan

**Critical instruction to the coding agent:** Implement the phases in order. Finish each phase with working code, tests, and a short update before starting the next. Do not generate the entire application in one pass. Do not skip tests or replace real functionality with mocked success states. Keep the application runnable at the end of every phase.

### Phase 0 — Repository inspection and implementation plan

**Goal:** Establish the repository baseline before editing.

Tasks:
- Inspect the existing repository and identify existing code, tools, and conventions.
- If the repository is empty, scaffold the structure described above.
- Create `PRD.md` from this specification if it is not already present.
- Write `docs/architecture.md` with component responsibilities and key data flows.
- Record chosen dependency versions and development commands.
- Identify platform assumptions and Docker requirements.
- Do not delete or overwrite unrelated user files.

Exit criteria:
- Architecture and phase plan are documented.
- Repository structure is agreed and minimal.
- No feature implementation is claimed complete yet.

### Phase 1 — Domain models and deterministic core simulator

**Goal:** Simulate nodes, links, time, and topology events without Docker or UI complexity.

Tasks:
- Implement typed models for satellites, ground stations, links, packets, topology events, route decisions, and simulation runs.
- Implement a simulation clock with pause, resume, step, and reset semantics.
- Implement topology state and scheduled link-up, link-down, degradation, and recovery events.
- Implement seeded randomness where needed.
- Load the three bundled scenarios.
- Provide a small CLI or script that prints simulation time, active links, and applied events.

Tests:
- Model validation tests.
- Simulation clock tests.
- Scheduled events apply at the correct simulated time.
- Repeated runs with the same seed produce identical event sequences.
- Reset restores the initial scenario state.

Exit criteria:
- A documented command runs a deterministic topology scenario.
- No Docker or frontend is required for this phase.

### Phase 2 — Packet lifecycle and store-and-forward buffers

**Goal:** Correctly manage packet state and delay-tolerant storage.

Tasks:
- Implement packet generation and unique IDs.
- Implement buffer admission, occupancy accounting, priority/expiry behavior, and overflow policy.
- Implement packet expiry and hop-limit enforcement.
- Implement duplicate suppression.
- Implement safe packet transfer/acknowledgement semantics so failed transfers do not silently lose packets.
- Record route history and packet lifecycle events.
- Ensure all terminal outcomes include explicit reasons.

Tests:
- Packet accepted when capacity is available.
- Buffer-full behavior follows the documented policy.
- Expired packets are not forwarded.
- Duplicate packets are not delivered twice.
- A failed handoff preserves a recoverable copy.
- Hop limit and loop-prevention rules work.
- Buffer byte counts remain consistent after every transition.

Exit criteria:
- Unit tests prove packet lifecycle correctness.
- A disconnected node retains eligible packets in its buffer.

### Phase 3 — Routing interface and baseline algorithm

**Goal:** Make packets move through available links using a simple baseline.

Tasks:
- Define a routing policy interface independent of agents and transport.
- Implement shortest-available-path routing using latency as the edge cost.
- Implement next-hop selection and route invalidation/recomputation after topology changes.
- Implement a simple in-process link transport that enforces link availability, bandwidth, serialization delay, and latency.
- Implement forwarding retries triggered by topology changes and scheduled simulation events.
- Add structured decision logs.

Tests:
- Packet follows a valid shortest-latency path.
- No unavailable link is used.
- No-route condition results in buffering, not false delivery.
- Link failure triggers a new route or buffering.
- Link capacity and contact window constraints are respected.

Exit criteria:
- The basic-delivery scenario sends a packet over multiple hops to a ground station.
- The intermittent-contact scenario buffers packets until connectivity returns.

### Phase 4 — SWARMNET contact-aware routing

**Goal:** Implement the project's core differentiator: local, contact-aware next-hop selection.

Tasks:
- Implement candidate-neighbor filtering.
- Implement interpretable scoring using route progress, reliability, contact feasibility, latency, queue pressure, and optional energy.
- Include transfer time when determining whether a contact window is feasible.
- Prevent loops and immediate backtracking unless a documented exception is justified.
- Support buffering when no neighbor is currently useful.
- Record candidate scores, selected next hop, and human-readable reason.
- Expose routing weights in scenario configuration.
- Ensure unknown values have explicit defaults and are not silently fabricated.

Tests:
- A feasible reliable route is preferred over a route whose contact ends too soon.
- The algorithm avoids an unavailable or low-quality link when a viable alternative exists.
- A disconnected satellite buffers packets.
- A newly available contact triggers reevaluation.
- Decisions are deterministic for identical state and configuration.
- A test verifies that every decision includes an explanation.

Exit criteria:
- Route-disruption scenario switches to an alternate route when appropriate.
- Routing decisions can be inspected and explained.
- Baseline and SWARMNET use the same packet and transport interfaces.

### Phase 5 — API, run management, and persistence

**Goal:** Expose the simulator through a usable backend API.

Tasks:
- Implement FastAPI application and health endpoint.
- Implement scenario listing/loading and run creation.
- Implement run lifecycle controls: start, pause, resume, step, reset, stop if supported.
- Implement endpoints for topology, nodes, links, packets, events, routing decisions, and metrics.
- Add WebSocket or server-sent events for live updates.
- Persist run metadata, configuration snapshots, and experiment summaries using SQLite.
- Persist packet buffers where needed so an agent restart does not silently erase queued packets.
- Add validation and consistent error responses.
- Add API documentation and sample requests.

Tests:
- API schema and validation tests.
- Invalid scenario configuration returns a useful client error.
- Run controls have correct state transitions.
- Live event stream publishes topology and packet events.
- Saved run configuration can be retrieved.

Exit criteria:
- All core functions can be exercised without directly importing internal Python modules.
- API docs are accessible from the running backend.

### Phase 6 — Containerized satellite and ground agents

**Goal:** Demonstrate that agents can run as isolated Docker services while topology changes remain simulated state changes.

Tasks:
- Build a Docker image for the satellite agent and ground-station agent.
- Create Docker Compose services for the backend and a small initial set of satellite agents plus ground station.
- Give every agent a unique identity through environment/configuration.
- Implement health checks and graceful shutdown.
- Implement agent registration/heartbeat and telemetry reporting.
- Implement the `LinkTransport` abstraction with a container-compatible adapter.
- Enforce logical link availability in the transport layer. Do not assume that sharing a Docker bridge means a simulated satellite link is currently available.
- Keep link-up/link-down changes inside the simulator; never restart containers for ordinary topology changes.
- Ensure the in-process transport remains available for fast deterministic tests.
- Make the number of satellite services configurable where feasible. If Compose cannot practically generate arbitrary service counts, document the scaling approach and use the in-process simulator for 100+ node scenarios.

Tests:
- `docker compose config` succeeds.
- Containers become healthy.
- Agents register with unique IDs.
- A logical unavailable link blocks transfer even if containers can reach one another at the Docker-network level.
- Container restart does not corrupt persisted buffers, or the documented prototype limitation is explicit.
- End-to-end packet delivery works across multiple containerized agents.

Exit criteria:
- A small constellation works through Docker Compose.
- Link changes do not require container restarts.
- The README explains containerized demo mode versus high-scale in-process simulation mode.

### Phase 7 — Frontend dashboard

**Goal:** Build a clear real-time visual explanation of the network.

Tasks:
- Create a React + TypeScript frontend.
- Implement API client and typed response models.
- Build Overview, Topology, Packet Flow, Routing Decisions, Metrics, and Scenario Controls views.
- Show active, degraded, and unavailable links using visual state plus text/legend.
- Show node buffer occupancy, energy if enabled, neighbors, and recent decisions.
- Animate packet movement only when supported by actual packet events; do not invent UI-only packet motion.
- Handle loading, empty, disconnected, and error states.
- Keep live updates batched and rendering efficient.
- Make controls functional and connected to backend state.

Tests:
- Build and type-check frontend.
- API errors render meaningful UI states.
- Scenario controls call the correct backend endpoints.
- Dashboard metrics match API data for a fixture/run.
- Basic keyboard accessibility for controls.

Exit criteria:
- A user can start a scenario, watch topology changes, inspect a packet, and view delivery metrics entirely through the UI.

### Phase 8 — Experiments, baselines, and reproducible reports

**Goal:** Produce credible evidence of how the routing policies behave.

Tasks:
- Implement experiment runner for the same scenario and seed under each policy.
- Ensure each policy sees equivalent traffic and topology events.
- Calculate metrics defined in FR-8.
- Generate JSON and CSV exports.
- Add a comparison view to the dashboard.
- Include at least:
  1. Basic delivery
  2. Intermittent contact
  3. Route disruption
  4. Buffer pressure / congestion
- Add a methodology document with metric definitions, limitations, and reproducibility instructions.
- Avoid hardcoded benchmark claims. Display actual results from executed runs.

Tests:
- Metric calculations on known synthetic cases.
- Zero-packet and zero-delivery edge cases.
- Same seed reproduces the same topology and traffic events.
- Exported values match API metrics.
- Experiment runs are isolated and do not share mutable packet/buffer state.

Exit criteria:
- A user can compare the two policies and export reproducible results.

### Phase 9 — Hardening, documentation, and final demo

**Goal:** Make the project reliable to install, demonstrate, and evaluate.

Tasks:
- Run all backend, frontend, integration, and container checks.
- Fix correctness issues before visual polish.
- Add structured logging and useful failure messages.
- Add resource limits and sensible scenario validation.
- Verify clean startup, reset, pause/resume, and shutdown.
- Write a concise architecture guide and routing-algorithm explanation.
- Write a 3–5 minute demo script showing:
  1. A normal multi-hop delivery
  2. A link failure and route change
  3. A full partition where packets are buffered
  4. A contact returning and buffered packets being delivered
  5. A policy comparison and metrics export
- Document limitations and future research directions honestly.

Exit criteria:
- All required commands work from a clean checkout.
- Tests pass.
- The demo can be run without editing source code.
- The project does not make unsupported claims about real orbital deployment.

---

## 12. Required Demo Scenario

Create a deterministic scenario that proves the core behavior clearly.

Example topology:

```text
SAT-01 ---- SAT-02 ---- SAT-04 ---- GROUND-01
   \                       /
    \---- SAT-03 --------/
```

Example event schedule (simulation seconds):

- `t=0`: Route through SAT-02 is available; generate packets at SAT-01.
- `t=10`: Degrade the SAT-02 to SAT-04 link.
- `t=15`: Make an alternate SAT-01 → SAT-03 → SAT-04 route available.
- `t=25`: Disable all useful links from the source-side partition; new packets must be buffered.
- `t=40`: Restore a contact path toward GROUND-01.
- `t=60`: End the run and report delivered, buffered/pending, expired, and dropped packets.

These values are example defaults, not hardcoded logic. The scenario file must define them so users can edit them. Ensure event ordering and packet transfer timing make the demonstration deterministic.

The UI should make the story legible: show a topology event timeline, packet state transitions, and the reason for each route change.

---

## 13. Algorithm and Modeling Guidance

### 13.1 Use simulation time, not sleeps, for core logic

Core algorithm tests should advance a simulated clock explicitly. Avoid real `time.sleep()` calls in routing and packet lifecycle logic. Wall-clock pacing belongs only in the runner/UI playback layer.

### 13.2 Separate path estimation from next-hop action

A satellite may have an estimate of a path without having a currently usable next hop. The router must not confuse “a path may exist later” with “a transfer can happen now.” If no currently feasible next hop exists, buffer and retry when the state changes.

### 13.3 Keep transport semantics explicit

Define when a transfer starts, when it completes, when the receiver acknowledges it, and when the sender removes its copy. Simulated bandwidth and latency must affect delivery timing rather than being decorative fields.

### 13.4 Do not overbuild orbital mechanics

The first release uses scheduled contacts and abstract node positions. If orbital-style movement is later added, isolate it behind a contact-plan/topology-event generator so routing and buffering do not depend on a particular orbit library.

### 13.5 Do not use an LLM to make packet-level routing decisions

Routing should be deterministic, fast, testable, and inspectable. The dashboard may explain decisions using structured reason fields. An LLM is not required for the project and must not be on the packet-forwarding critical path.

---

## 14. Engineering Standards and Definition of Done

Every feature is done only when all relevant items are satisfied:

- Implementation is real and connected to the application.
- Unit tests cover normal behavior and edge cases.
- Integration tests cover component interactions.
- Types and validation are in place.
- Errors are surfaced instead of silently ignored.
- Logs and telemetry make behavior inspectable.
- Documentation and configuration examples are updated.
- No hardcoded mock results are presented as real simulation output.
- Existing functionality remains working.
- The feature can be demonstrated with documented commands.

### Required commands

Provide equivalents of these commands in the Makefile or README:

```bash
make setup
make test
make lint
make run-backend
make run-frontend
make demo
make experiment
make docker-up
make docker-down
```

If Make is not suitable on a target platform, provide equivalent Python/npm/Docker commands.

---

## 15. Configuration Example

Use a validated YAML or JSON configuration format. Example YAML:

```yaml
scenario:
  id: intermittent_contact
  seed: 42
  duration_seconds: 60
  tick_seconds: 1

network:
  satellites: 5
  ground_stations: 1
  default_buffer_capacity_bytes: 1048576

traffic:
  - source: SAT-01
    destination: GROUND-01
    packets_per_second: 1
    payload_size_bytes: 4096
    priority: normal
    ttl_seconds: 120
    max_hops: 20

routing:
  policy: swarmnet
  weights:
    progress: 0.30
    reliability: 0.20
    contact_feasibility: 0.20
    latency: 0.15
    congestion: 0.10
    energy: 0.05

links:
  - id: SAT-01-SAT-02
    source: SAT-01
    target: SAT-02
    latency_ms: 40
    bandwidth_mbps: 10
    reliability: 0.95
    schedule:
      - start: 0
        end: 25
        available: true
      - start: 25
        end: 40
        available: false
      - start: 40
        end: 60
        available: true
```

The schema may evolve, but it must be validated and documented. Do not silently accept invalid weights, negative bandwidth, impossible time windows, or unknown node IDs.

---

## 16. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Trying to implement Docker, UI, routing, and simulation at once | Follow phases and keep a working in-process simulator first |
| Treating Docker network connectivity as satellite link availability | Enforce logical link state in a transport adapter |
| Packets disappearing during failed transfers | Define acknowledgement/ownership semantics and test failure cases |
| Routing loops | Use hop limits, visited nodes, duplicate suppression, and loop-focused tests |
| Unrealistic or unexplainable routing scores | Normalize features, document weights, log score components, test known cases |
| Dashboard showing invented packet motion | Render only events reported by the simulation |
| Large topology overwhelms the UI | Batch telemetry and separate simulation scale from visualization detail |
| Non-reproducible results | Seed randomness and save full run configuration |
| Overclaiming scientific validity | State modeling assumptions and limitations in docs and UI |
| Container count does not scale to hundreds of nodes | Use in-process agents for scale tests; containerize a small representative constellation |

---

## 17. Deliverables

The completed repository must contain:

1. A working deterministic topology and packet simulator.
2. A baseline shortest-available-path router.
3. The SWARMNET contact-aware routing policy.
4. Store-and-forward buffering, packet expiry, deduplication, and overflow handling.
5. FastAPI backend and documented API.
6. Docker Compose demonstration with satellite agents and ground station.
7. React dashboard with topology, packet flow, routing explanations, and metrics.
8. Three or more reproducible scenarios.
9. Automated unit, integration, and API tests.
10. Policy comparison runner and JSON/CSV exports.
11. `README.md` with setup, commands, architecture, troubleshooting, and demo instructions.
12. `docs/experiment-methodology.md` with metric definitions and modeling limitations.
13. `docs/demo-script.md` with the final demonstration sequence.

---

## 18. Instructions to the Agentic Coding IDE

Treat this PRD as the source of truth. Work autonomously, but preserve the phase gates.

1. Inspect the repository before making changes.
2. Produce a short checklist for the current phase.
3. Implement only that phase's scope.
4. Run its tests and relevant lint/type checks.
5. Fix failures before proceeding.
6. Update documentation and the project checklist.
7. Report files changed, commands executed, test results, known limitations, and the next phase.
8. Continue into the next phase automatically after the current phase passes, unless blocked by a real external dependency or destructive decision.
9. Never claim a test passed unless it was actually run and its exit status checked.
10. Never replace core routing, buffering, transport, metrics, or dashboard functionality with TODOs, static screenshots, fake data, or hardcoded success responses.
11. If a design choice is unspecified, choose the simplest maintainable option consistent with this PRD and document the choice rather than stopping for routine approval.
12. Ask the user only when a real blocker requires credentials, external access, a destructive action, or a decision that cannot safely be inferred.
13. Keep the repository runnable at the end of every phase.
14. Do not skip ahead to frontend polish before the packet simulator and routing tests pass.
15. At the end, provide a final report with implemented features, architecture, commands, test evidence, experiment results, and limitations.

### Final completion checklist

- [ ] Clean setup works
- [ ] Deterministic simulation works
- [ ] Dynamic link events work without container restarts
- [ ] Packets buffer during disconnection
- [ ] Packets resume forwarding after contact returns
- [ ] Multi-hop delivery reaches a ground station
- [ ] Baseline routing works
- [ ] SWARMNET contact-aware routing works and explains decisions
- [ ] Packet expiry, duplicate suppression, hop limits, and buffer limits work
- [ ] Docker Compose demo works
- [ ] Dashboard reflects actual backend state
- [ ] Metrics are computed from real simulation events
- [ ] Same scenario/seed is reproducible
- [ ] Policy comparison and exports work
- [ ] Tests and lint/type checks pass
- [ ] README and demo instructions are complete
- [ ] Limitations are documented honestly

---

## 19. Project Success Definition

SWARMNET succeeds as a prototype if a reviewer can start the application, observe a constellation changing over simulated time, see autonomous next-hop decisions change when links degrade or disappear, verify that packets are buffered during disconnection, watch them resume forwarding when a contact returns, and compare the resulting delivery metrics against a baseline.

The core achievement is not the number of Docker containers or the visual animation. It is the tested networking behavior: **autonomous forwarding + dynamic topology + delay-tolerant store-and-forward + reproducible evaluation**.
