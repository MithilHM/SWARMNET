"""Integration tests for FastAPI REST endpoints and persistence."""

import pytest
from starlette.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "SWARMNET"


def test_list_and_get_scenarios():
    response = client.get("/api/scenarios")
    assert response.status_code == 200
    data = response.json()
    assert "scenarios" in data
    assert len(data["scenarios"]) >= 3
    scenario_ids = [s["id"] for s in data["scenarios"]]
    assert "basic_delivery" in scenario_ids
    assert "intermittent_contact" in scenario_ids
    assert "route_disruption" in scenario_ids

    # Get specific scenario
    res_detail = client.get("/api/scenarios/basic_delivery")
    assert res_detail.status_code == 200
    scen_data = res_detail.json()
    assert scen_data["scenario"]["id"] == "basic_delivery"


def test_run_lifecycle_and_stepping():
    # 1. Create run
    create_res = client.post(
        "/api/runs",
        json={"scenario_id": "intermittent_contact", "seed": 100, "duration": 30.0},
    )
    assert create_res.status_code == 200
    run_data = create_res.json()
    run_id = run_data["run_id"]
    assert run_id.startswith("RUN-")

    # 2. Query run info
    info_res = client.get(f"/api/runs/{run_id}")
    assert info_res.status_code == 200
    assert info_res.json()["run_id"] == run_id

    # 3. Query topology
    topo_res = client.get(f"/api/runs/{run_id}/topology")
    assert topo_res.status_code == 200
    topo = topo_res.json()
    assert len(topo["satellites"]) > 0
    assert len(topo["links"]) > 0

    # 4. Step run
    step_res = client.post(f"/api/runs/{run_id}/step", json={"ticks": 5})
    assert step_res.status_code == 200
    step_data = step_res.json()
    assert step_data["simulated_time"] == 5.0
    assert "metrics" in step_data

    # 5. Check metrics endpoint
    metrics_res = client.get(f"/api/runs/{run_id}/metrics")
    assert metrics_res.status_code == 200
    assert "delivery_ratio" in metrics_res.json()

    # 6. Check export
    export_json = client.get(f"/api/runs/{run_id}/export?format=json")
    assert export_json.status_code == 200
    assert export_json.headers["content-type"].startswith("application/json")

    export_csv = client.get(f"/api/runs/{run_id}/export?format=csv")
    assert export_csv.status_code == 200
    assert "text/csv" in export_csv.headers["content-type"]
    assert "Metric,Value" in export_csv.text


def test_compare_experiment_endpoint():
    response = client.post(
        "/api/experiments/compare",
        json={"scenario_id": "route_disruption", "seed": 42},
    )
    assert response.status_code == 200
    data = response.json()
    assert "experiment_id" in data
    assert "baseline" in data
    assert "swarmnet" in data
    assert "comparison_summary" in data
    assert data["baseline"]["policy"] == "baseline"
    assert data["swarmnet"]["policy"] == "swarmnet"
