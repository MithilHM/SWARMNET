#!/usr/bin/env python
"""Convenience script to run the systematic SWARMNET benchmark evaluation."""

import sys
from pathlib import Path

# Add backend to sys.path
backend_path = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from app.experiments.runner import ExperimentRunner, print_comparison_table

if __name__ == "__main__":
    runner = ExperimentRunner()
    results = runner.run_all(seed=42)
    print_comparison_table(results)
