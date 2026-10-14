"""Standalone HTTP agent server for containerized satellite/ground-station deployment.

Each container runs this server with environment variables:
  - NODE_ID: e.g. "SAT-01" or "GROUND-01"
  - NODE_TYPE: "satellite" or "ground_station"
  - BACKEND_URL: URL of the central backend (e.g. "http://backend:8000")
  - PORT: port to listen on (default 8100)
  - BUFFER_CAPACITY_BYTES: satellite buffer capacity (default 1048576)
"""

import os
import time
import threading
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import httpx
import uvicorn

from app.models.packet import Packet, PacketStatus, RouteHop
from app.buffering.buffer import NodeBuffer
from app.buffering.deduplication import Deduplicator


NODE_ID = os.environ.get("NODE_ID", "AGENT-UNKNOWN")
NODE_TYPE = os.environ.get("NODE_TYPE", "satellite")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8000")
PORT = int(os.environ.get("PORT", "8100"))
BUFFER_CAPACITY = int(os.environ.get("BUFFER_CAPACITY_BYTES", "1048576"))

agent_app = FastAPI(
    title=f"SWARMNET Agent — {NODE_ID}",
    description=f"Containerized {NODE_TYPE} agent for node {NODE_ID}.",
)


class AgentState:
    """Mutable agent state for this container."""

    def __init__(self, node_id: str, node_type: str, buffer_capacity: int):
        self.node_id = node_id
        self.node_type = node_type
        self.started_at = time.time()
        self.heartbeat_count = 0
        self.last_heartbeat_at: Optional[float] = None

        if node_type == "satellite":
            self.buffer = NodeBuffer(node_id=node_id, capacity_bytes=buffer_capacity)
        else:
            self.buffer = None

        self.deduplicator = Deduplicator()
        self.received_packets: Dict[str, Dict[str, Any]] = {}
        self.total_bytes_received = 0
        self.packet_events: list = []

    def reset(self) -> None:
        if self.buffer:
            self.buffer.clear()
        self.deduplicator.reset()
        self.received_packets.clear()
        self.total_bytes_received = 0
        self.packet_events.clear()


state = AgentState(NODE_ID, NODE_TYPE, BUFFER_CAPACITY)


class ReceivePacketRequest(BaseModel):
    packet: Dict[str, Any]
    link_id: str
    simulated_time: float


class AgentTelemetry(BaseModel):
    node_id: str
    node_type: str
    uptime_seconds: float
    heartbeat_count: int
    buffer_used_bytes: int = 0
    buffer_capacity_bytes: int = 0
    buffer_packet_count: int = 0
    total_packets_received: int = 0
    total_bytes_received: int = 0


@agent_app.get("/health")
def health():
    return {
        "status": "ok",
        "node_id": state.node_id,
        "node_type": state.node_type,
        "uptime_seconds": round(time.time() - state.started_at, 1),
    }


@agent_app.get("/telemetry")
def telemetry():
    telem = AgentTelemetry(
        node_id=state.node_id,
        node_type=state.node_type,
        uptime_seconds=round(time.time() - state.started_at, 1),
        heartbeat_count=state.heartbeat_count,
        buffer_used_bytes=state.buffer.used_bytes if state.buffer else 0,
        buffer_capacity_bytes=state.buffer.capacity_bytes if state.buffer else 0,
        buffer_packet_count=state.buffer.packet_count if state.buffer else 0,
        total_packets_received=len(state.received_packets),
        total_bytes_received=state.total_bytes_received,
    )
    return telem.model_dump()


@agent_app.post("/receive_packet")
def receive_packet(req: ReceivePacketRequest):
    """Receive a packet from transport (called by backend or another agent container)."""
    pkt_data = req.packet
    pkt_id = pkt_data.get("packet_id", "")
    sim_time = req.simulated_time

    # Deduplication
    if not state.deduplicator.mark_seen(pkt_id):
        return {"status": "duplicate", "packet_id": pkt_id}

    if state.node_type == "ground_station":
        # Ground station: accept delivery
        state.received_packets[pkt_id] = {
            "packet_id": pkt_id,
            "received_at": sim_time,
            "link_id": req.link_id,
            "source": pkt_data.get("source_node_id"),
            "hop_count": pkt_data.get("hop_count", 0),
            "size_bytes": pkt_data.get("payload_size_bytes", 0),
        }
        state.total_bytes_received += pkt_data.get("payload_size_bytes", 0)
        state.packet_events.append({
            "type": "delivered",
            "packet_id": pkt_id,
            "time": sim_time,
        })
        return {"status": "delivered", "packet_id": pkt_id}
    else:
        # Satellite: admit into local buffer
        try:
            pkt = Packet.model_validate(pkt_data)
            pkt.current_node_id = state.node_id
            if state.buffer:
                admitted, reason, evicted = state.buffer.admit(pkt, sim_time)
                if admitted:
                    state.packet_events.append({
                        "type": "buffered",
                        "packet_id": pkt_id,
                        "time": sim_time,
                    })
                    return {"status": "buffered", "packet_id": pkt_id}
                else:
                    return {"status": "rejected", "packet_id": pkt_id, "reason": reason}
            else:
                return {"status": "error", "message": "No buffer on this node"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))


@agent_app.get("/buffer")
def get_buffer():
    """Return current buffer contents (satellite only)."""
    if not state.buffer:
        return {"packets": [], "used_bytes": 0, "capacity_bytes": 0}
    packets = [p.model_dump() for p in state.buffer.get_eligible_packets(float("inf"))]
    return {
        "node_id": state.node_id,
        "packets": packets,
        "used_bytes": state.buffer.used_bytes,
        "capacity_bytes": state.buffer.capacity_bytes,
        "packet_count": state.buffer.packet_count,
    }


@agent_app.get("/received")
def get_received():
    """Return received packets (ground station)."""
    return {
        "node_id": state.node_id,
        "packets": list(state.received_packets.values()),
        "total_bytes_received": state.total_bytes_received,
        "count": len(state.received_packets),
    }


@agent_app.get("/events")
def get_events():
    return {"node_id": state.node_id, "events": state.packet_events[-100:]}


@agent_app.post("/reset")
def reset_agent():
    state.reset()
    return {"status": "reset", "node_id": state.node_id}


def _register_with_backend():
    """Background registration with the central backend."""
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(
                f"{BACKEND_URL}/api/agents/register",
                json={
                    "node_id": state.node_id,
                    "node_type": state.node_type,
                    "url": f"http://{state.node_id.lower().replace('-', '_')}:{PORT}",
                },
            )
            if resp.status_code == 200:
                state.heartbeat_count += 1
                state.last_heartbeat_at = time.time()
    except Exception:
        pass


def _heartbeat_loop(interval: float = 15.0):
    """Periodically send heartbeat to backend."""
    while True:
        time.sleep(interval)
        try:
            with httpx.Client(timeout=5.0) as client:
                client.post(
                    f"{BACKEND_URL}/api/agents/heartbeat",
                    json={
                        "node_id": state.node_id,
                        "node_type": state.node_type,
                        "uptime": round(time.time() - state.started_at, 1),
                        "buffer_used_bytes": state.buffer.used_bytes if state.buffer else 0,
                    },
                )
                state.heartbeat_count += 1
                state.last_heartbeat_at = time.time()
        except Exception:
            pass


@agent_app.on_event("startup")
async def on_startup():
    # Register once, then start heartbeat thread
    threading.Thread(target=_register_with_backend, daemon=True).start()
    threading.Thread(target=_heartbeat_loop, args=(15.0,), daemon=True).start()


if __name__ == "__main__":
    uvicorn.run(
        "app.agents.agent_service:agent_app",
        host="0.0.0.0",
        port=PORT,
        log_level="info",
    )
