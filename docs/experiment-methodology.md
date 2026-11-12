# SWARMNET Experiment Methodology & Evaluation Guide

This document describes the experimental methodology, mathematical metrics definitions, controlled benchmark conditions, and modeling assumptions used to evaluate the **SWARMNET** delay-tolerant routing protocol against traditional baseline routing.

---

## 1. Experimental Objectives

The purpose of the SWARMNET experimental framework is to provide empirical, reproducible evidence of routing behavior in a dynamic satellite constellation under four primary network challenges:

1. **Continuous Multi-Hop Delivery (`basic_delivery`):** Verifies that both algorithms correctly traverse multi-hop paths when connectivity is stable.
2. **Intermittent Contact Windows (`intermittent_contact`):** Evaluates store-carry-forward buffering during an extended ground-station blackout ($t=10\text{s}$ to $t=35\text{s}$), testing that packets are neither falsely dropped nor falsely reported delivered while partitioned.
3. **Dynamic Route Degradation (`route_disruption`):** Tests next-hop re-evaluation when a primary path severs and an alternate path opens ($t=15\text{s}$).
4. **Buffer Pressure & Overload (`buffer_pressure`):** Stresses constrained buffer capacities (16 KB) with rapid packet bursts, testing deterministic priority-based eviction and drop auditability.

---

## 2. Competing Routing Policies

Every experiment runs a fair, head-to-head comparison between two routing strategies over the exact same network topology, link events, traffic generation rate, and random seed:

### 2.1 Baseline Policy: Shortest Available Path (`baseline`)
* **Algorithm:** Dijkstra's algorithm computed over currently available directed links using link latency (`latency_ms`) as edge weights.
* **Store-and-Forward Rule:** If no path currently exists to the destination, the node buffers the packet (`BUFFER` with reason `NO_ROUTE`).
* **Inherent Weakness:** Short-sighted. It does not evaluate remaining contact window duration ($t_{\text{end}} - t$). If a link will sever in 10ms, it will still attempt a 500ms transmission across it, risking failed handoffs.

### 2.2 SWARMNET Policy: Autonomous Contact-Aware Routing (`swarmnet`)
* **Algorithm:** Autonomous local heuristic evaluation over all reachable candidate neighbors using a multi-factor objective function:
  $$\text{Score} = w_{\text{prog}} \cdot P + w_{\text{rel}} \cdot R + w_{\text{cont}} \cdot C - w_{\text{lat}} \cdot \hat{L} - w_{\text{cong}} \cdot \hat{Q} - w_{\text{eng}} \cdot E$$
* **Contact Feasibility Filtering:** Automatically rejects links whose contact end time occurs before transmission can complete ($t_{\text{transfer}} > t_{\text{end}} - t_{\text{current}}$).
* **Progress Assessment:** Rewards candidates moving closer to the destination geometrically or topologically, provided downstream connectivity exists.
* **Explainability:** Records every candidate neighbor's score components and outputs a human-readable justification for every forwarding or buffering decision.

---

## 3. Metric Definitions & Accounting Rules

All metrics are derived directly from discrete simulation events recorded in the `MetricsSummary` object:

### 3.1 Packet Delivery Ratio ($PDR$)
$$\text{Delivery Ratio} = \begin{cases} \frac{N_{\text{delivered}}}{N_{\text{generated}}} & \text{if } N_{\text{generated}} > 0 \\ 0.0 & \text{otherwise} \end{cases}$$
* **Rule:** Packets remaining buffered at simulation termination are classified as **Pending** ($N_{\text{pending}}$). They are **never** assumed to be delivered, nor are they falsely marked as dropped.

### 3.2 End-to-End Delivery Latency ($T_{\text{delay}}$)
For each delivered packet $i$:
$$T_{\text{delay}, i} = t_{\text{delivered}, i} - t_{\text{created}, i}$$
* **Mean Latency:** Arithmetic mean of all delivered packet transit times.
* **Median Latency:** 50th percentile of sorted delivery latencies.
* **P95 Latency:** 95th percentile of sorted delivery latencies, capturing worst-case tail delays caused by store-carry-forward buffering during link blackouts.

### 3.3 Packet Drops & Terminal Reasons
Packets are dropped only under explicit, auditable conditions:
* `BUFFER_FULL`: Incoming packet cannot be admitted because buffer capacity is exceeded and no lower-priority packet could be evicted.
* `TTL_EXPIRED`: Packet remained in a satellite buffer past its `expires_at` simulation timestamp.
* `HOP_LIMIT`: Packet reached `max_hops` without reaching the destination, mitigating persistent routing loops.

### 3.4 Mean Hop Count ($H$)
$$H = \frac{1}{N_{\text{delivered}}} \sum_{i=1}^{N_{\text{delivered}}} \text{hop\_count}_i$$

---

## 4. Controlled Experimental Variables

To guarantee scientific reproducibility, each run fixes the following variables:

| Variable | Description | Standard Value |
|---|---|---|
| **Random Seed** | Seeds link unreliability rolls, packet UUID generation, and transport jitter. | `42` |
| **Tick Resolution** | Discrete simulation time step. | `1.0` second |
| **Payload Size** | Fixed payload byte count for serialization calculation. | `4096` bytes (4 KB) |
| **Buffer Capacity** | Default storage per satellite node. | `1,048,576` bytes (1 MB) |
| **Constrained Buffer** | Buffer capacity under stress testing (`buffer_pressure`). | `16,384` bytes (16 KB) |
| **Routing Weights** | $w_{\text{prog}}=0.30$, $w_{\text{rel}}=0.20$, $w_{\text{cont}}=0.20$, $w_{\text{lat}}=0.15$, $w_{\text{cong}}=0.10$, $w_{\text{eng}}=0.05$ | Configured in scenario YAML |

---

## 5. Modeling Assumptions & Scientific Limitations

SWARMNET is an educational and research simulation prototype. The following limitations should be understood when reviewing results:

1. **Discrete-Event Tick Modeling:** Time advances in discrete integer seconds. Sub-second packet serialization delays are accurately scheduled and tracked, but continuous physics propagation is modeled as discrete intervals.
2. **Abstract Spatial Coordinates:** Satellites use 2D/3D Euclidean coordinates $(x, y, z)$ and scheduled contact windows rather than continuous SGP4 orbital mechanics with J2 perturbations.
3. **Transport Layer Representation:** Inter-satellite links are modeled by propagation delay and serialization delay ($t_{\text{serialize}} = \frac{\text{size} \times 8}{\text{bandwidth}}$) with reliability probability rolls, rather than full Linux network namespace packet-level TCP/IP stack emulation.
4. **Energy Modeling:** Battery depletion is computed on radio packet transmission; solar panels provide ambient trickle charging. Solar eclipse periods are modeled via scheduled availability rather than solar angle raytracing.

---

## 6. How to Reproduce Experiments

### Running via CLI
To execute the complete benchmark suite across all scenarios and generate JSON/CSV reports:

```bash
cd backend
python -m app.experiments.runner
```

Output files are automatically saved to `data/experiments/`:
* `data/experiments/latest_benchmark.json`
* `data/experiments/latest_benchmark.csv`

### Running via Web Dashboard
1. Open the dashboard at `http://localhost:3000`.
2. Navigate to the **Comparison** tab.
3. Select any scenario from the dropdown.
4. Click **"Execute Head-to-Head Benchmark"**.
5. View real-time delta KPIs and click **"Export Run (JSON)"** or **"Export Run (CSV)"**.
