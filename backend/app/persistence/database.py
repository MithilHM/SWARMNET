"""SQLite persistence for simulation runs and experiment comparisons."""

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional
import time


class DatabaseManager:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            # Default to data/swarmnet.db
            db_dir = Path("data")
            db_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = str(db_dir / "swarmnet.db")
        else:
            self.db_path = db_path
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)

        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    scenario_id TEXT NOT NULL,
                    seed INTEGER NOT NULL,
                    routing_policy TEXT NOT NULL,
                    started_at REAL NOT NULL,
                    simulated_duration REAL NOT NULL,
                    current_sim_time REAL NOT NULL,
                    status TEXT NOT NULL,
                    config_snapshot_json TEXT NOT NULL,
                    metrics_summary_json TEXT NOT NULL,
                    created_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS experiments (
                    experiment_id TEXT PRIMARY KEY,
                    scenario_id TEXT NOT NULL,
                    seed INTEGER NOT NULL,
                    baseline_run_id TEXT,
                    swarmnet_run_id TEXT,
                    comparison_json TEXT NOT NULL,
                    created_at REAL NOT NULL
                )
                """
            )
            conn.commit()

    def save_run(
        self,
        run_id: str,
        scenario_id: str,
        seed: int,
        routing_policy: str,
        started_at: float,
        simulated_duration: float,
        current_sim_time: float,
        status: str,
        config_snapshot: Dict[str, Any],
        metrics_summary: Dict[str, Any],
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO runs (
                    run_id, scenario_id, seed, routing_policy,
                    started_at, simulated_duration, current_sim_time,
                    status, config_snapshot_json, metrics_summary_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    scenario_id,
                    seed,
                    routing_policy,
                    started_at,
                    simulated_duration,
                    current_sim_time,
                    status,
                    json.dumps(config_snapshot),
                    json.dumps(metrics_summary),
                    time.time(),
                ),
            )
            conn.commit()

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "run_id": row["run_id"],
                "scenario_id": row["scenario_id"],
                "seed": row["seed"],
                "routing_policy": row["routing_policy"],
                "started_at": row["started_at"],
                "simulated_duration": row["simulated_duration"],
                "current_sim_time": row["current_sim_time"],
                "status": row["status"],
                "config_snapshot": json.loads(row["config_snapshot_json"]),
                "metrics_summary": json.loads(row["metrics_summary_json"]),
                "created_at": row["created_at"],
            }

    def list_runs(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
            )
            rows = cursor.fetchall()
            return [
                {
                    "run_id": r["run_id"],
                    "scenario_id": r["scenario_id"],
                    "seed": r["seed"],
                    "routing_policy": r["routing_policy"],
                    "current_sim_time": r["current_sim_time"],
                    "status": r["status"],
                    "metrics_summary": json.loads(r["metrics_summary_json"]),
                    "created_at": r["created_at"],
                }
                for r in rows
            ]

    def save_experiment(
        self,
        experiment_id: str,
        scenario_id: str,
        seed: int,
        baseline_run_id: str,
        swarmnet_run_id: str,
        comparison: Dict[str, Any],
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO experiments (
                    experiment_id, scenario_id, seed, baseline_run_id,
                    swarmnet_run_id, comparison_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    experiment_id,
                    scenario_id,
                    seed,
                    baseline_run_id,
                    swarmnet_run_id,
                    json.dumps(comparison),
                    time.time(),
                ),
            )
            conn.commit()

    def get_experiment(self, experiment_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM experiments WHERE experiment_id = ?", (experiment_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "experiment_id": row["experiment_id"],
                "scenario_id": row["scenario_id"],
                "seed": row["seed"],
                "baseline_run_id": row["baseline_run_id"],
                "swarmnet_run_id": row["swarmnet_run_id"],
                "comparison": json.loads(row["comparison_json"]),
                "created_at": row["created_at"],
            }
