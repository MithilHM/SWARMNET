"""SWARMNET FastAPI Application with REST endpoints and WebSocket live telemetry."""

import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router, run_manager

app = FastAPI(
    title="SWARMNET — Delay-Tolerant Satellite Network Simulator",
    version="0.1.0",
    description="Autonomous delay-tolerant networking layer for dynamic satellite constellations.",
)

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.websocket("/ws/runs/{run_id}")
async def websocket_run_endpoint(websocket: WebSocket, run_id: str):
    await websocket.accept()

    run_inst = run_manager.active_runs.get(run_id)
    if not run_inst:
        await websocket.send_json({"error": f"Active run '{run_id}' not found."})
        await websocket.close()
        return

    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    run_inst.event_subscribers.append(queue)

    try:
        # Send initial snapshot
        init_state = {
            "type": "initial_state",
            "run_id": run_id,
            "simulated_time": run_inst.engine.clock.simulated_time,
            "status": run_inst.status.value,
            "metrics": run_inst.engine.metrics.model_dump(),
            "topology": run_manager.get_topology(run_id),
        }
        await websocket.send_json(init_state)

        # Background task to send queue events to client
        async def send_events():
            while True:
                event = await queue.get()
                payload = {
                    "type": "event",
                    "event": event,
                    "simulated_time": run_inst.engine.clock.simulated_time,
                    "metrics": run_inst.engine.metrics.model_dump(),
                }
                await websocket.send_json(payload)
                queue.task_done()

        sender_task = asyncio.create_task(send_events())

        # Receive commands from client (e.g., {"action": "step", "ticks": 1})
        while True:
            data_text = await websocket.receive_text()
            try:
                msg = json.loads(data_text)
                action = msg.get("action")
                if action == "step":
                    ticks = msg.get("ticks", 1)
                    res = run_manager.step_run(run_id, ticks=ticks)
                    await websocket.send_json({
                        "type": "step_result",
                        "data": res,
                        "topology": run_manager.get_topology(run_id),
                    })
                elif action == "pause":
                    res = run_manager.pause_run(run_id)
                    await websocket.send_json({"type": "pause_result", "data": res})
                elif action == "resume":
                    res = run_manager.resume_run(run_id)
                    await websocket.send_json({"type": "resume_result", "data": res})
                elif action == "reset":
                    res = run_manager.reset_run(run_id)
                    await websocket.send_json({
                        "type": "reset_result",
                        "data": res,
                        "topology": run_manager.get_topology(run_id),
                    })
            except Exception as e:
                await websocket.send_json({"type": "error", "message": str(e)})

    except WebSocketDisconnect:
        pass
    finally:
        if queue in run_inst.event_subscribers:
            run_inst.event_subscribers.remove(queue)
        sender_task.cancel()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
