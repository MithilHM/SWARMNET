# SWARMNET Demonstration Script

**Target duration:** 3–4 minutes
**Theme:** Delay-tolerant networking for satellite constellations (UN SDG 9)

This is a simulation. Positions are schematic and playback is slowed 20× so that link latencies are visible.

## Before the demo

```bash
cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
cd frontend && npm run dev        # http://localhost:3000
```

The globe loads in `IDLE` with a freshly generated scenario: the seed and scenario id are in the top bar.

## Walkthrough

1. **IDLE (0:00).** Point out the satellites, ground stations, satellite-to-ground links, and inter-satellite links. Nothing moves yet.
2. **Play → STABLE (0:20).** For about two seconds packets flow directly to the ground; Packet Logs fills with `sent` / `delivered` rows tagged `stable`.
3. **DEGRADING (0:40).** One satellite's ground link starts to fail (the cause comes from the scenario: rain fade, low elevation, obstruction, interference, or pointing error). Red bursts mark lost packets; red `lost` rows appear in the log.
4. **DETECTED (1:00).** When the backend's rolling loss rate crosses the threshold the run pauses itself: red flash, red box around the satellite and its ground link, banner with loss % and probable cause. Show Routing (still direct-to-ground) and Comparison (direct-only already computed from a replay of this seed).
5. **Solve → SOLVING (1:40).** The satellite switches to DTN. Bundles hop over an ISL to the relay (green path, green box), are stored there, and are forwarded to the ground. Routing shows the old path struck through and the new path with relay scores.
6. **RESOLVED (2:20).** "N/N bundles delivered via SAT-X". Comparison is now final: direct-only loses packets; DTN recovers them at the cost of an extra hop and higher latency.
7. **Reset, then Sever Link (2:50).** Reset draws a new random scenario. Press Play, pick a satellite in the Sever Link control, and cut its ground link: the same detection → Solve → DTN flow follows on that satellite.

## Questions evaluators ask

* **Is the anomaly scripted?** The failure plan only changes link reliability. Packets are lost by seeded transport rolls, and detection fires only when the observed loss window crosses the threshold. A link that stays healthy is never flagged (`test_detection_is_driven_by_loss_not_time`).
* **Is the comparison real?** Yes. The direct-only column replays the same seed and operator actions with DTN disabled.
* **Can I reproduce a run?** `POST /api/session/play {"seed": <seed from the top bar>}` replays it event for event.
