"""FastAPI REST routes for SWARMNET simulation."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.simulation.scenarios import ScenarioLoader
from app.simulation.run_manager import RunManager

router = APIRouter()
run_manager = RunManager()


class CreateRunRequest(BaseModel):
    scenario_id: str
    seed: Optional[int] = None
    routing_policy: Optional[str] = None
    duration: Optional[float] = None


class StepRunRequest(BaseModel):
    ticks: int = Field(default=1, ge=1, le=100)


class CompareExperimentRequest(BaseModel):
    scenario_id: str
    seed: int = 42


@router.get("/health")
def health_check():
    return {"status": "ok", "app": "SWARMNET", "version": "0.1.0"}


@router.get("/api/scenarios")
def list_scenarios():
    scenario_ids = ScenarioLoader.list_available_scenarios()
    scenarios = []
    for sid in scenario_ids:
        cfg = ScenarioLoader.load_scenario_by_id(sid)
        if cfg:
            scenarios.append({
                "id": cfg.scenario.id,
                "name": cfg.scenario.name,
                "description": cfg.scenario.description,
                "duration_seconds": cfg.scenario.duration_seconds,
                "satellites_count": len(cfg.network.satellites),
                "ground_stations_count": len(cfg.network.ground_stations),
                "links_count": len(cfg.links),
            })
    return {"scenarios": scenarios}


@router.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    cfg = ScenarioLoader.load_scenario_by_id(scenario_id)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Scenario '{scenario_id}' not found.")
    return cfg.model_dump()


@router.post("/api/runs")
def create_run(req: CreateRunRequest):
    try:
        run = run_manager.create_run(
            scenario_id=req.scenario_id,
            seed=req.seed,
            routing_policy=req.routing_policy,
            duration=req.duration,
        )
        return run.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/api/runs")
def list_runs(limit: int = 50):
    return {"runs": run_manager.db.list_runs(limit=limit)}


@router.get("/api/runs/{run_id}")
def get_run(run_id: str):
    info = run_manager.get_run_info(run_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found.")
    return info


@router.post("/api/runs/{run_id}/step")
def step_run(run_id: str, req: StepRunRequest = StepRunRequest()):
    try:
        return run_manager.step_run(run_id, ticks=req.ticks)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/runs/{run_id}/pause")
def pause_run(run_id: str):
    try:
        return run_manager.pause_run(run_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/runs/{run_id}/resume")
def resume_run(run_id: str):
    try:
        return run_manager.resume_run(run_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/runs/{run_id}/reset")
def reset_run(run_id: str):
    try:
        return run_manager.reset_run(run_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/api/runs/{run_id}/topology")
def get_topology(run_id: str):
    try:
        return run_manager.get_topology(run_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/api/runs/{run_id}/metrics")
def get_metrics(run_id: str):
    try:
        return run_manager.get_metrics(run_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/api/runs/{run_id}/events")
def get_events(run_id: str, limit: int = 100):
    return {"events": run_manager.get_events(run_id, limit=limit)}


@router.get("/api/runs/{run_id}/packets")
def get_packets(run_id: str):
    return run_manager.get_packets(run_id)


@router.get("/api/runs/{run_id}/decisions")
def get_decisions(run_id: str, limit: int = 50):
    return {"decisions": run_manager.get_decisions(run_id, limit=limit)}


@router.get("/api/runs/{run_id}/export")
def export_run(run_id: str, format: str = Query("json", pattern="^(json|csv)$")):
    try:
        content = run_manager.export_run(run_id, export_format=format)
        media_type = "text/csv" if format == "csv" else "application/json"
        filename = f"{run_id}_export.{format}"
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/api/experiments/compare")
def compare_policies(req: CompareExperimentRequest):
    try:
        return run_manager.compare_policies(scenario_id=req.scenario_id, seed=req.seed)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
