"""REST + server-sent-event API for the single shared simulation session.

Endpoints
---------
GET  /health                     liveness
GET  /api/session                full state snapshot (scenario, events, routing, comparison)
GET  /api/session/stream         SSE: snapshot on connect, then one frame per engine tick
POST /api/session/play           start a run of the staged random scenario (optional {"seed": n})
POST /api/session/solve          switch the affected satellite to DTN (only when DETECTED)
POST /api/session/sever          {"satellite_id": "SAT-02"} cut that satellite's ground link
POST /api/session/reset          back to IDLE with a freshly generated scenario
GET  /api/session/export         JSON export of the current run (config, events, metrics)
POST /api/agents/register        containerized agent registration
POST /api/agents/heartbeat       containerized agent heartbeat
GET  /api/agents                 registered agents
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.registry import AgentRegistry
from app.simulation.flow_engine import SimulationActionError

router = APIRouter()
agent_registry = AgentRegistry()


def _session(request: Request):
    return request.app.state.session


class PlayRequest(BaseModel):
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1, description="Replay a specific seed.")


class SeverRequest(BaseModel):
    satellite_id: str = Field(min_length=1, max_length=32)


class AgentRegisterRequest(BaseModel):
    node_id: str
    node_type: str
    url: str


class AgentHeartbeatRequest(BaseModel):
    node_id: str
    node_type: str
    uptime: float = 0.0
    buffer_used_bytes: int = 0


@router.get("/health")
def health_check():
    return {"status": "ok", "app": "SWARMNET", "version": "0.2.0"}


@router.get("/api/session")
async def get_session(request: Request):
    return _session(request).snapshot()


@router.get("/api/session/stream")
async def stream_session(request: Request):
    session = _session(request)
    return StreamingResponse(
        session.stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/session/play")
async def play(request: Request, req: Optional[PlayRequest] = None):
    try:
        return await _session(request).play(seed=req.seed if req else None)
    except SimulationActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/api/session/solve")
async def solve(request: Request):
    try:
        return await _session(request).solve()
    except SimulationActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/api/session/sever")
async def sever(request: Request, req: SeverRequest):
    try:
        return await _session(request).sever(req.satellite_id)
    except SimulationActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/api/session/reset")
async def reset(request: Request):
    return await _session(request).reset()


@router.get("/api/session/export")
async def export(request: Request):
    import json

    session = _session(request)
    run_id = session.engine.run_id or "IDLE"
    return Response(
        content=json.dumps(session.export(), indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={run_id}_export.json"},
    )


@router.post("/api/agents/register")
def register_agent(req: AgentRegisterRequest):
    return agent_registry.register(node_id=req.node_id, node_type=req.node_type, url=req.url)


@router.post("/api/agents/heartbeat")
def heartbeat_agent(req: AgentHeartbeatRequest):
    return agent_registry.heartbeat(
        node_id=req.node_id, node_type=req.node_type, uptime=req.uptime, buffer_used_bytes=req.buffer_used_bytes
    )


@router.get("/api/agents")
def get_agents():
    return {"agents": agent_registry.list()}
