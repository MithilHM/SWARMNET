"""Registry of containerized agents (PRD Phase 6): registration and heartbeats."""

import time
from typing import Any, Dict, List

UNRESPONSIVE_AFTER_SECONDS = 30


class AgentRegistry:
    def __init__(self) -> None:
        self.agents: Dict[str, Dict[str, Any]] = {}

    def register(self, node_id: str, node_type: str, url: str) -> Dict[str, Any]:
        now = time.time()
        self.agents[node_id] = {
            "node_id": node_id,
            "node_type": node_type,
            "url": url,
            "registered_at": now,
            "last_heartbeat_at": now,
            "heartbeat_count": 1,
            "status": "healthy",
            "buffer_used_bytes": 0,
        }
        return {"status": "registered", "node_id": node_id}

    def heartbeat(self, node_id: str, node_type: str, uptime: float, buffer_used_bytes: int = 0) -> Dict[str, Any]:
        now = time.time()
        agent = self.agents.get(node_id)
        if agent is None:
            agent = {
                "node_id": node_id,
                "node_type": node_type,
                "url": f"http://{node_id.lower().replace('-', '_')}:8100",
                "registered_at": now,
                "heartbeat_count": 0,
            }
            self.agents[node_id] = agent
        agent["last_heartbeat_at"] = now
        agent["heartbeat_count"] = agent.get("heartbeat_count", 0) + 1
        agent["uptime"] = uptime
        agent["buffer_used_bytes"] = buffer_used_bytes
        agent["status"] = "healthy"
        return {"status": "ok", "node_id": node_id}

    def list(self) -> List[Dict[str, Any]]:
        now = time.time()
        for agent in self.agents.values():
            if now - agent.get("last_heartbeat_at", 0) > UNRESPONSIVE_AFTER_SECONDS:
                agent["status"] = "unresponsive"
        return list(self.agents.values())
