# SWARMNET Demonstration Script & Presentation Guide

**Target Duration:** 5 minutes  
**Audience:** Evaluators, Professors, Students, and Networking Researchers  
**Theme:** Delay-Tolerant Internet for Dynamic LEO Satellite Constellations (UN SDG 9)

---

## Pre-Demo Checklist (30 seconds before presentation)

1. Ensure the backend is running:
   ```bash
   cd backend
   python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
2. Ensure the frontend is running:
   ```bash
   cd frontend
   npm run dev
   ```
3. Open your browser to `http://localhost:3000` (or `http://localhost:5173`).
4. Confirm the status pill in the top header displays **"API: ONLINE"** (green indicator).

---

## 5-Minute Live Demonstration Walkthrough

```text
  [00:00 - 00:45] Intro: The Space Internet Problem & Store-Carry-Forward
  [00:45 - 01:45] Demo 1: Multi-Hop Constellation Forwarding (basic_delivery)
  [01:45 - 02:45] Demo 2: Link Failure & Autonomous Rerouting (route_disruption)
  [02:45 - 03:45] Demo 3: Total Ground Blackout & Store-and-Forward (intermittent_contact)
  [03:45 - 04:30] Demo 4: High-Traffic Buffer Overload & Eviction (buffer_pressure)
  [04:30 - 05:00] Demo 5: Head-to-Head Comparison & Data Export
```

---

### Minute 1 (00:00 – 00:45) — Introduction & The Core Problem

**Spoken Narration:**
> *"Terrestrial internet protocols like TCP and BGP assume an unbroken physical path exists between sender and receiver. But in Low Earth Orbit (LEO), satellites travel at 27,000 km/h. Links break constantly, ground-station passes last only minutes, and network partitions are normal.
> 
> SWARMNET is an autonomous, delay-tolerant networking (DTN) layer. Instead of dropping data during disconnections, each satellite independently stores packets in bounded buffers, carries them along its orbit, and autonomously routes them when opportunities arise—without a centralized ground controller dictating every hop."*

---

### Minute 2 (00:45 – 01:45) — Multi-Hop Delivery (`basic_delivery`)

**Action on Screen:**
1. In the header bar, select **Scenario: `Basic Multi-Hop Delivery`**.
2. Select **Policy: `SWARMNET (Contact-Aware)`**.
3. Click **"New Run"**, then press **"Play"** (or press the `Spacebar`).
4. Switch to the **Topology** tab.

**What to Point Out:**
* Show the animated particle pulses traveling along active green links from `SAT-01` $\to$ `SAT-02` $\to$ `SAT-03` $\to$ `GROUND-01`.
* Switch to the **Packets** tab: click on any packet row to open the **Packet Audit Modal**. Show the exact hop-by-hop timeline with timestamps and transit latencies.
* Show the **Delivery Ratio** reaching **100%** on the top KPI card.

---

### Minute 3 (01:45 – 02:45) — Dynamic Link Failure & Rerouting (`route_disruption`)

**Action on Screen:**
1. Select **Scenario: `Route Disruption & Dynamic Rerouting`**.
2. Click **"New Run"** and click **"Play"**.
3. Watch the simulation clock advance.

**What to Point Out:**
* At **$t=10\text{s}$**, link `SAT-02` $\to$ `SAT-04` turns **dashed red** (severed).
* Open the **Routing Decisions** tab: point out how `SAT-01` inspects candidate neighbors. It identifies that `SAT-02` is now a dead end and refuses to trap packets there.
* At **$t=15\text{s}$**, the alternate contact window `SAT-01` $\to$ `SAT-03` turns **solid green** (link up).
* Watch `SAT-01` autonomously switch its forwarding decision to `SAT-03`, delivering the data safely to the ground station.

---

### Minute 4 (02:45 – 03:45) — Total Ground Blackout & Store-and-Forward (`intermittent_contact`)

**Action on Screen:**
1. Select **Scenario: `Intermittent Ground Contact`**.
2. Click **"New Run"** and click **"Play"** until $t=20\text{s}$, then click **"Pause"**.

**What to Point Out:**
* From **$t=10\text{s}$ to $t=35\text{s}$**, all downlink paths to `GROUND-01` are completely severed (ground blackout).
* Traffic was generated between $t=12\text{s}$ and $t=16\text{s}$.
* Point to the **Overview tab**: **Delivered: 0**, **Pending: 4**, **Dropped: 0**.
* Point to the **Topology tab**: notice the **radial buffer gauge** around `SAT-01` and `SAT-02` displaying active buffer occupancy. The satellites are holding the data in onboard storage!
* Now click **"Play"** (or step forward) past **$t=35\text{s}$**.
* At $t=35\text{s}$, the ground contact window restores. Instantly, all 4 buffered packets resume forwarding, traverse the downlink, and are delivered.
* Delivery ratio reaches **100%**.

---

### Minute 5 (03:45 – 05:00) — Buffer Eviction & Head-to-Head Comparison

**Action on Screen:**
1. Open the **Comparison** tab in the navigation bar.
2. Select **Scenario: `High-Traffic Buffer Pressure & Congestion`**.
3. Click **"Execute Head-to-Head Benchmark"**.

**What to Point Out:**
* The backend runs both **Baseline (Shortest Path)** and **SWARMNET** with the exact same seed (`42`).
* Review the comparative KPI cards:
  * **Delivery Ratio Delta:** Shows SWARMNET's performance differential.
  * **Latency & Dropped Packets:** Demonstrates that under 16 KB buffer pressure, low-priority packets are gracefully dropped with audited reasons (`BUFFER_FULL`), while high-priority packets are protected.
* Click **"Export Run (JSON)"** and **"Export Run (CSV)"** in the top-right corner to show download and data portability.

---

## Common Questions & Quick Answers for Evaluators

* **Q: Is this simulating real orbital physics?**  
  * *Answer:* No, SWARMNET uses abstract coordinates and deterministic contact schedules rather than SGP4 orbital propagation. This isolates and highlights the networking protocol behavior.

* **Q: What happens if a satellite buffer fills completely?**  
  * *Answer:* SWARMNET implements deterministic priority eviction: it drops the lowest-priority packet closest to TTL expiry and logs an auditable drop reason (`BUFFER_FULL`).

* **Q: How does SWARMNET prevent routing loops?**  
  * *Answer:* Each packet maintains an append-only `visited_node_ids` trace. Candidate neighbors that already appear in a packet's route history are penalized with a fatal score penalty ($-100.0$), preventing backtracking.
