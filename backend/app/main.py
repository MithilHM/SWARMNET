"""SWARMNET FastAPI application: one shared simulation session, REST controls, SSE stream."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.persistence.database import DatabaseManager
from app.simulation.session import SimulationSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = None if os.environ.get("SWARMNET_NO_DB") == "1" else DatabaseManager()
    app.state.session = SimulationSession(db=db)
    yield
    await app.state.session.shutdown()


app = FastAPI(
    title="SWARMNET — Delay-Tolerant Satellite Network Simulator",
    version="0.2.0",
    description="Guided simulation: direct-to-ground traffic, link anomaly detection, DTN store-carry-forward recovery.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
