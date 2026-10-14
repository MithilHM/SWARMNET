"""Simulation clock for deterministic discrete time tracking."""

from typing import Callable, List, Optional


class SimulationClock:
    def __init__(self, tick_seconds: float = 1.0, max_duration: float = 60.0):
        self.tick_seconds: float = max(0.001, tick_seconds)
        self.max_duration: float = max_duration
        self.simulated_time: float = 0.0
        self.is_running: bool = False
        self._tick_callbacks: List[Callable[[float], None]] = []

    def register_tick_callback(self, callback: Callable[[float], None]) -> None:
        """Register a callback invoked after every simulation tick."""
        self._tick_callbacks.append(callback)

    def start(self) -> None:
        self.is_running = True

    def pause(self) -> None:
        self.is_running = False

    def resume(self) -> None:
        if not self.has_ended():
            self.is_running = True

    def reset(self) -> None:
        self.simulated_time = 0.0
        self.is_running = False

    def has_ended(self) -> bool:
        return self.simulated_time >= self.max_duration

    def step(self, num_ticks: int = 1) -> float:
        """Advance the simulation by a fixed number of ticks and trigger callbacks."""
        for _ in range(num_ticks):
            if self.has_ended():
                self.is_running = False
                break
            # Rounding to prevent floating-point drift
            self.simulated_time = round(self.simulated_time + self.tick_seconds, 6)
            for cb in self._tick_callbacks:
                cb(self.simulated_time)

        return self.simulated_time
