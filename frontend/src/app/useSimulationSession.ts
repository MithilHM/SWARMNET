import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient } from "../api/client";
import type {
  AgentInfo,
  BackendState,
  Link,
  MetricsSummary,
  NodeDetailResponse,
  Packet,
  RouteDecision,
  ScenarioSummary,
  SimulationRun,
  StreamMessage,
  StreamState,
  TopologyData,
  TopologyEvent,
} from "../types";

export type PendingAction = null | "initialize" | "step" | "play" | "pause" | "reset" | "node";

const EVENT_BUFFER = 60;

export function useSimulationSession() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [selectedPolicy, setSelectedPolicy] = useState<string>("swarmnet");
  const [seed, setSeed] = useState<number>(42);

  const [run, setRun] = useState<SimulationRun | null>(null);
  const [topology, setTopology] = useState<TopologyData | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [events, setEvents] = useState<TopologyEvent[]>([]);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [decisions, setDecisions] = useState<RouteDecision[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<NodeDetailResponse | null>(null);
  const [nodeError, setNodeError] = useState<string | null>(null);

  const [backend, setBackend] = useState<BackendState>("connecting");
  const [stream, setStream] = useState<StreamState>("idle");
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const runId = run?.run_id ?? null;
  const runIdRef = useRef<string | null>(runId);
  const selectedNodeRef = useRef<string | null>(selectedNodeId);
  const playingRef = useRef(playing);

  useEffect(() => {
    runIdRef.current = runId;
  }, [runId]);

  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const applyRunSnapshot = useCallback((next: SimulationRun | null) => {
    if (!next) {
      setRun(null);
      return;
    }
    setRun(next);
    if (next.metrics_summary) setMetrics(next.metrics_summary);
  }, []);

  const refreshTelemetry = useCallback(async (id: string) => {
    try {
      const [topData, metData, evtData, pktData, decData] = await Promise.all([
        ApiClient.getTopology(id),
        ApiClient.getMetrics(id),
        ApiClient.getEvents(id, EVENT_BUFFER),
        ApiClient.getPackets(id),
        ApiClient.getDecisions(id, EVENT_BUFFER),
      ]);
      setTopology(topData);
      setMetrics(metData);
      setEvents(evtData.events ?? []);
      setPackets(pktData.packets ?? []);
      setDecisions(decData.decisions ?? []);
      setBackend("online");
      setError(null);
      return true;
    } catch (err) {
      setBackend("offline");
      setError(err instanceof Error ? err.message : "Telemetry refresh failed.");
      return false;
    }
  }, []);

  const refreshNode = useCallback(async (id: string, nodeId: string) => {
    try {
      const detail = await ApiClient.getNode(id, nodeId);
      setNodeDetail(detail);
      setNodeError(null);
    } catch (err) {
      setNodeError(err instanceof Error ? err.message : "Node details unavailable.");
    }
  }, []);

  // Initial load: scenarios, agent registry, backend health.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [scenarioRes, health] = await Promise.all([ApiClient.listScenarios(), ApiClient.getHealth()]);
        if (cancelled) return;
        const list = scenarioRes.scenarios ?? [];
        setScenarios(list);
        setSelectedScenarioId((current) => current || list[0]?.id || "");
        setBackend(health.status === "ok" ? "online" : "degraded");
      } catch {
        if (!cancelled) {
          setBackend("offline");
          setError("Backend API unreachable. Start the FastAPI server on port 8000.");
        }
      }
      try {
        const agentRes = await ApiClient.getAgents();
        if (!cancelled) setAgents(agentRes.agents ?? []);
      } catch {
        // agent registry is optional (in-process mode has none)
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live telemetry stream. REST stays authoritative for stepping.
  useEffect(() => {
    if (!runId) return;
    let socket: WebSocket | null = null;
    let closed = false;
    // The socket is an external system: reflect its connection state immediately.
    // oxlint-disable-next-line react/set-state-in-effect
    setStream("connecting");
    const handleMessage = (message: StreamMessage) => {
      switch (message.type) {
        case "initial_state": {
          setTopology(message.topology);
          if (message.metrics) setMetrics(message.metrics);
          setBackend("online");
          setStream("live");
          break;
        }
        case "event": {
          if (message.metrics) setMetrics(message.metrics);
          if (message.event) {
            const incoming = message.event;
            setEvents((prev) => {
              const withoutDuplicate = prev.filter((item) => item.event_id !== incoming.event_id);
              return [incoming, ...withoutDuplicate].slice(0, EVENT_BUFFER);
            });
          }
          break;
        }
        case "step_result": {
          if (message.data?.metrics) setMetrics(message.data.metrics);
          if (message.topology) setTopology(message.topology);
          if (typeof message.data?.simulated_time === "number") {
            setRun((prev) =>
              prev
                ? {
                    ...prev,
                    current_sim_time: message.data.simulated_time,
                    status: message.data.has_ended ? "completed" : prev.status,
                  }
                : prev,
            );
          }
          break;
        }
        case "reset_result":
        case "pause_result":
        case "resume_result": {
          if (message.data?.metrics) setMetrics(message.data.metrics);
          if (message.topology) setTopology(message.topology);
          if (message.data?.simulated_time != null) {
            const time = message.data.simulated_time;
            setRun((prev) => (prev ? { ...prev, current_sim_time: time, status: message.data.status as SimulationRun["status"] } : prev));
          }
          break;
        }
        case "error": {
          setError(message.message);
          break;
        }
        default:
          break;
      }
    };

    try {
      socket = new WebSocket(ApiClient.streamUrl(runId));
      socket.onopen = () => {
        if (!closed) {
          setStream("live");
          setBackend((prev) => (prev === "offline" ? "online" : prev));
        }
      };
      socket.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data as string) as StreamMessage);
        } catch {
          // ignore malformed frames; REST refresh remains the fallback
        }
      };
      socket.onerror = () => {
        if (!closed) setStream("unavailable");
      };
      socket.onclose = () => {
        if (!closed) setStream("unavailable");
      };
    } catch {
      setStream("unavailable");
    }

    return () => {
      closed = true;
      if (socket) {
        socket.onmessage = null;
        socket.close();
      }
    };
  }, [runId]);

  const initializeRun = useCallback(async () => {
    if (!selectedScenarioId) return;
    setPending("initialize");
    setError(null);
    setPlaying(false);
    try {
      const created = await ApiClient.createRun(selectedScenarioId, seed, selectedPolicy);
      applyRunSnapshot(created);
      setSelectedNodeId(null);
      setSelectedLinkId(null);
      setNodeDetail(null);
      setEvents([]);
      await refreshTelemetry(created.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not initialize the run.");
      setBackend("offline");
    } finally {
      setPending(null);
    }
  }, [applyRunSnapshot, refreshTelemetry, seed, selectedPolicy, selectedScenarioId]);

  const step = useCallback(
    async (ticks: number = 1) => {
      const id = runIdRef.current;
      if (!id) return;
      setPending("step");
      try {
        const result = await ApiClient.stepRun(id, ticks);
        setRun((prev) =>
          prev
            ? {
                ...prev,
                current_sim_time: result.simulated_time,
                status: result.has_ended ? "completed" : prev.status === "queued" ? "running" : prev.status,
                metrics_summary: result.metrics ?? prev.metrics_summary,
              }
            : prev,
        );
        if (result.metrics) setMetrics(result.metrics);
        if (result.has_ended) setPlaying(false);
        await refreshTelemetry(id);
        const node = selectedNodeRef.current;
        if (node) await refreshNode(id, node);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Step failed.");
        setBackend("offline");
      } finally {
        setPending(null);
      }
    },
    [refreshNode, refreshTelemetry],
  );

  const togglePlay = useCallback(async () => {
    const id = runIdRef.current;
    if (!id) return;
    if (playingRef.current) {
      setPlaying(false);
      setPending("pause");
      try {
        await ApiClient.pauseRun(id);
        setRun((prev) => (prev ? { ...prev, status: "paused" } : prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Pause failed.");
      } finally {
        setPending(null);
      }
      return;
    }
    setPlaying(true);
    setPending("play");
    try {
      await ApiClient.resumeRun(id);
      setRun((prev) => (prev ? { ...prev, status: "running" } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resume failed.");
      setPlaying(false);
    } finally {
      setPending(null);
    }
  }, []);

  const reset = useCallback(async () => {
    const id = runIdRef.current;
    if (!id) return;
    setPlaying(false);
    setPending("reset");
    try {
      const result = await ApiClient.resetRun(id);
      setRun((prev) =>
        prev
          ? {
              ...prev,
              current_sim_time: result.simulated_time ?? 0,
              status: (result.status as SimulationRun["status"]) ?? "queued",
              metrics_summary: result.metrics ?? prev.metrics_summary,
            }
          : prev,
      );
      setSelectedNodeId(null);
      setSelectedLinkId(null);
      setNodeDetail(null);
      await refreshTelemetry(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setPending(null);
    }
  }, [refreshTelemetry]);

  const selectNode = useCallback(
    async (nodeId: string) => {
      const id = runIdRef.current;
      if (!id) return;
      setSelectedLinkId(null);
      setSelectedNodeId(nodeId);
      setPending("node");
      setNodeError(null);
      await refreshNode(id, nodeId);
      setPending(null);
    },
    [refreshNode],
  );

  const selectLink = useCallback((link: Link) => {
    setSelectedNodeId(null);
    setNodeDetail(null);
    setSelectedLinkId(link.link_id);
  }, []);

  const closeInspector = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedLinkId(null);
    setNodeDetail(null);
    setNodeError(null);
  }, []);

  // Playback loop: advance the simulation clock, then re-pull telemetry.
  useEffect(() => {
    if (!playing || !runId) return;
    const intervalMs = Math.max(250, Math.round(1000 / speed));
    const timer = window.setInterval(() => {
      void step(1);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, runId, speed, step]);

  const scenario = useMemo(
    () => scenarios.find((item) => item.id === selectedScenarioId) ?? null,
    [scenarios, selectedScenarioId],
  );

  const simTime = run?.current_sim_time ?? topology?.simulated_time ?? 0;
  const duration = run?.simulated_duration ?? scenario?.duration_seconds ?? 0;
  const status = run?.status ?? "queued";
  const progress = duration > 0 ? Math.min(1, simTime / duration) : 0;

  const selectedLink = useMemo<Link | null>(() => {
    if (!selectedLinkId || !topology) return null;
    return topology.links.find((link) => link.link_id === selectedLinkId) ?? null;
  }, [selectedLinkId, topology]);

  return {
    scenarios,
    scenario,
    selectedScenarioId,
    setSelectedScenarioId,
    selectedPolicy,
    setSelectedPolicy,
    seed,
    setSeed,
    run,
    runId,
    topology,
    metrics,
    events,
    packets,
    decisions,
    agents,
    backend,
    stream: runId ? stream : "idle",
    pending,
    error,
    setError,
    playing,
    speed,
    setSpeed,
    simTime,
    duration,
    status,
    progress,
    selectedNodeId,
    selectedLinkId,
    selectedLink,
    nodeDetail,
    nodeError,
    initializeRun,
    step,
    togglePlay,
    reset,
    refreshTelemetry,
    selectNode,
    selectLink,
    closeInspector,
  };
}

export type SimulationSession = ReturnType<typeof useSimulationSession>;