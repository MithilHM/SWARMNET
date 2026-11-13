"""Single shared simulation session: wall-clock pacing, control actions, and live fan-out.

There is exactly one run on the backend at a time. Every client (globe, Packet
Logs, Routing, Comparison) reads the same ``SimulationSession`` through the
snapshot endpoint and the server-sent event stream, so all views stay in sync.

All mutation happens on the asyncio event loop (async route handlers and the
runner task), so no locking is needed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from typing import Any, AsyncIterator, Dict, List, Optional

from app.persistence.database import DatabaseManager
from app.simulation.flow_engine import (
    FlowEngine,
    Phase,
    SimulationActionError,
    comparison_from,
    new_run_id,
    run_counterfactual,
)
from app.simulation.scenario_generator import FlowScenario, generate_scenario

logger = logging.getLogger("swarmnet.session")

SUBSCRIBER_QUEUE_SIZE = 256


class SimulationSession:
    def __init__(self, db: Optional[DatabaseManager] = None, tick_wall_seconds: Optional[float] = None) -> None:
        self.db = db
        self._tick_wall_override = tick_wall_seconds
        self._subscribers: List[asyncio.Queue] = []
        self._task: Optional[asyncio.Task] = None
        self._version = 0
        self._cf_key: Optional[str] = None
        self._cf_engine: Optional[FlowEngine] = None
        self.started_wall: Optional[float] = None
        self._published_seq = 0
        self.engine = self._new_idle_engine(None)

    # ------------------------------------------------------------------ lifecycle
    def _new_idle_engine(self, seed: Optional[int]) -> FlowEngine:
        chosen = seed if seed is not None else secrets.randbelow(2**31 - 1)
        scenario = generate_scenario(chosen)
        logger.info("Staged scenario %s (seed %s)", scenario.scenario_id, chosen)
        return FlowEngine(scenario)

    @property
    def scenario(self) -> FlowScenario:
        return self.engine.scenario

    @property
    def tick_wall_seconds(self) -> float:
        if self._tick_wall_override is not None:
            return self._tick_wall_override
        return self.scenario.tick_seconds / self.scenario.time_scale

    async def play(self, seed: Optional[int] = None) -> Dict[str, Any]:
        if self.engine.phase != Phase.IDLE:
            raise SimulationActionError(f"Play is available only from IDLE (now {self.engine.phase.value}). Press Reset first.")
        if seed is not None and seed != self.scenario.seed:
            self.engine = self._new_idle_engine(seed)
        run_id = new_run_id()
        self.engine.start(run_id)
        self.started_wall = time.time()
        self._cf_key = None
        self._cf_engine = None
        logger.info("Run %s started: scenario %s seed %s", run_id, self.scenario.scenario_id, self.scenario.seed)
        self._publish_snapshot("play")
        self._start_runner()
        self._persist("running")
        return self.run_ref()

    async def solve(self) -> Dict[str, Any]:
        dtn = self.engine.solve()
        logger.info("Run %s solve: relay %s path %s", self.engine.run_id, dtn.get("relay_id"), dtn.get("path"))
        self._publish_frame(self._drain_new_events())
        self._start_runner()
        return dtn

    async def sever(self, satellite_id: str) -> Dict[str, Any]:
        self.engine.sever(satellite_id)
        logger.info("Run %s sever: %s", self.engine.run_id, satellite_id)
        self._cf_key = None
        self._publish_frame(self._drain_new_events())
        return {"satellite_id": satellite_id, "link_id": self.engine.target_link}

    async def reset(self) -> Dict[str, Any]:
        await self._stop_runner()
        if self.engine.run_id and self.engine.phase not in (Phase.IDLE, Phase.RESOLVED):
            self._persist("stopped")
        self.engine = self._new_idle_engine(None)
        self.started_wall = None
        self._cf_key = None
        self._cf_engine = None
        self._publish_snapshot("reset")
        return self.run_ref()

    async def shutdown(self) -> None:
        await self._stop_runner()

    def _start_runner(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop())

    async def _stop_runner(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run_loop(self) -> None:
        loop = asyncio.get_running_loop()
        interval = self.tick_wall_seconds
        next_at = loop.time()
        engine = self.engine
        try:
            while not engine.halted and engine is self.engine:
                events = engine.step()
                self._publish_frame(events)
                if engine.halted:
                    self._persist(engine.phase.value.lower())
                    break
                next_at += interval
                await asyncio.sleep(max(0.0, next_at - loop.time()))
        except asyncio.CancelledError:
            raise
        except Exception:  # surfaced in logs and to clients, never swallowed silently
            logger.exception("Simulation runner failed")
            self._broadcast({"type": "error", "message": "Simulation runner failed; see backend logs."})

    def _drain_new_events(self) -> List[Dict[str, Any]]:
        # Events are appended to engine.events; frames carry the ones not yet published.
        return [e for e in self.engine.events if e["seq"] > self._published_seq]

    # ------------------------------------------------------------------ views
    def run_ref(self) -> Dict[str, Any]:
        return {
            "run_id": self.engine.run_id,
            "seed": self.scenario.seed,
            "scenario_id": self.scenario.scenario_id,
            "phase": self.engine.phase.value,
        }

    def _comparison(self) -> Optional[Dict[str, Any]]:
        engine = self.engine
        if not engine.anomaly:
            return None
        quota = engine.affected_quota
        if quota is None:
            return comparison_from(engine, None)
        key = json.dumps([self.scenario.seed, engine.actions, quota])
        if key != self._cf_key:
            self._cf_engine = run_counterfactual(self.scenario, engine.actions, quota)
            self._cf_key = key
        return comparison_from(engine, self._cf_engine)

    def dynamic_state(self) -> Dict[str, Any]:
        engine = self.engine
        return {
            **self.run_ref(),
            "version": self._version,
            "sim_time": round(engine.now, 6),
            "time_scale": self.scenario.time_scale,
            "halted": engine.halted,
            "controls": {
                "play": engine.phase == Phase.IDLE,
                "solve": engine.phase == Phase.DETECTED,
                "sever": engine.phase in (Phase.STABLE, Phase.DEGRADING),
                "reset": True,
            },
            "nodes": engine.nodes_view(),
            "links": engine.links_view(),
            "in_flight": engine.in_flight_view(),
            "anomaly": engine.anomaly,
            "dtn": engine.dtn,
            "failure": {
                "satellite_id": engine.target_sat,
                "link_id": engine.target_link,
                "cause": engine.cause if engine.degrade_started_at is not None else None,
                "severed": engine.severed,
            },
            "routing": {
                "before": engine.routing_before,
                "current": engine.routing_table() if engine.phase != Phase.IDLE else None,
                "decisions": [d.model_dump() for d in engine.decisions],
            },
            "comparison": self._comparison(),
            "metrics": engine.metrics(),
        }

    def snapshot(self) -> Dict[str, Any]:
        return {
            **self.dynamic_state(),
            "scenario": self.scenario.model_dump(),
            "events": list(self.engine.events),
        }

    # ------------------------------------------------------------------ fan-out
    def _publish_snapshot(self, reason: str) -> None:
        self._version += 1
        self._published_seq = self.engine.events[-1]["seq"] if self.engine.events else 0
        self._broadcast({"type": "snapshot", "reason": reason, "state": self.snapshot()})

    def _publish_frame(self, events: List[Dict[str, Any]]) -> None:
        self._version += 1
        if events:
            self._published_seq = events[-1]["seq"]
        self._broadcast({"type": "frame", "state": self.dynamic_state(), "events": events})

    def _broadcast(self, message: Dict[str, Any]) -> None:
        payload = json.dumps(message, separators=(",", ":"))
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Slow client: drop its backlog and force a full resync.
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(json.dumps({"type": "snapshot", "reason": "resync", "state": self.snapshot()}))

    async def stream(self) -> AsyncIterator[str]:
        """Server-sent events: one snapshot on connect, then frames as the engine ticks."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
        self._subscribers.append(queue)
        try:
            yield f"event: message\ndata: {json.dumps({'type': 'snapshot', 'reason': 'connect', 'state': self.snapshot()})}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"event: message\ndata: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            if queue in self._subscribers:
                self._subscribers.remove(queue)

    def export(self) -> Dict[str, Any]:
        return {
            **self.snapshot(),
            "actions": list(self.engine.actions),
            "exported_at": time.time(),
        }

    # ------------------------------------------------------------------ persistence
    def _persist(self, status: str) -> None:
        if self.db is None or not self.engine.run_id:
            return
        try:
            self.db.save_run(
                run_id=self.engine.run_id,
                scenario_id=self.scenario.scenario_id,
                seed=self.scenario.seed,
                routing_policy="direct+dtn",
                started_at=self.started_wall or time.time(),
                simulated_duration=round(self.engine.now, 6),
                current_sim_time=round(self.engine.now, 6),
                status=status,
                config_snapshot={"scenario": self.scenario.model_dump(), "actions": self.engine.actions},
                metrics_summary={
                    "network": self.engine.metrics(),
                    "affected": self.engine.affected_stats(),
                    "anomaly": self.engine.anomaly,
                    "relay_id": self.engine.dtn.get("relay_id") if self.engine.dtn else None,
                },
            )
        except Exception:
            logger.exception("Failed to persist run %s", self.engine.run_id)
