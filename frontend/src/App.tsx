import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "./components/Header";
import { Navigation, type TabKey } from "./components/Navigation";
import { OverviewTab } from "./components/OverviewTab";
import { TopologyTab } from "./components/TopologyTab";
import { PacketsTab } from "./components/PacketsTab";
import { RoutingDecisionsTab } from "./components/RoutingDecisionsTab";
import { ComparisonTab } from "./components/ComparisonTab";
import { ApiClient } from "./api/client";
import type {
  AgentInfo,
  Link,
  MetricsSummary,
  NodeDetailResponse,
  Packet,
  RouteDecision,
  ScenarioSummary,
  SimulationRun,
  TopologyData,
} from "./types";

export const App: React.FC = () => {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("basic_delivery");
  const [selectedPolicy, setSelectedPolicy] = useState<string>("swarmnet");
  const [seed, setSeed] = useState<number>(42);

  const [currentRun, setCurrentRun] = useState<SimulationRun | null>(null);
  const [topology, setTopology] = useState<TopologyData | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [decisions, setDecisions] = useState<RouteDecision[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [selectedNode, setSelectedNode] = useState<NodeDetailResponse | null>(null);
  const [selectedLink, setSelectedLink] = useState<Link | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [backendConnected, setBackendConnected] = useState<boolean>(true);

  const runIdRef = useRef<string | null>(null);
  runIdRef.current = currentRun?.run_id || null;

  // Refresh all runtime telemetry
  const refreshRunState = useCallback(async (runId: string) => {
    try {
      const [topData, metData, evtData, pktData, decData] = await Promise.all([
        ApiClient.getTopology(runId),
        ApiClient.getMetrics(runId),
        ApiClient.getEvents(runId, 50),
        ApiClient.getPackets(runId),
        ApiClient.getDecisions(runId, 50),
      ]);

      setTopology(topData);
      setMetrics(metData);
      setEvents(evtData.events || []);
      setPackets(pktData.packets || []);
      setDecisions(decData.decisions || []);
      setBackendConnected(true);
    } catch {
      setBackendConnected(false);
    }
  }, []);

  // Refresh registered container agents
  const refreshAgents = useCallback(async () => {
    try {
      const res = await ApiClient.getAgents();
      setAgents(res.agents || []);
    } catch {
      // ignore
    }
  }, []);

  // Initialize and load scenarios list
  useEffect(() => {
    async function loadInitial() {
      try {
        const scRes = await ApiClient.listScenarios();
        setScenarios(scRes.scenarios || []);
        if (scRes.scenarios && scRes.scenarios.length > 0) {
          setSelectedScenarioId(scRes.scenarios[0].id);
        }
        await refreshAgents();
      } catch {
        setBackendConnected(false);
      }
    }
    loadInitial();
  }, [refreshAgents]);

  // Handle run creation
  const handleCreateRun = async () => {
    setIsPlaying(false);
    try {
      const run = await ApiClient.createRun(selectedScenarioId, seed, selectedPolicy);
      setCurrentRun(run);
      await refreshRunState(run.run_id);
    } catch (err) {
      console.error("Failed to create simulation run:", err);
    }
  };

  // Step simulation forward
  const handleStep = async (ticks: number = 1) => {
    if (!currentRun) return;
    try {
      const stepRes = await ApiClient.stepRun(currentRun.run_id, ticks);
      setCurrentRun((prev) =>
        prev
          ? {
              ...prev,
              current_sim_time: stepRes.simulated_time,
              status: stepRes.has_ended ? "completed" : "running",
              metrics_summary: stepRes.metrics,
            }
          : null
      );
      if (stepRes.has_ended) {
        setIsPlaying(false);
      }
      await refreshRunState(currentRun.run_id);
      // If a node is currently selected, refresh its details
      if (selectedNode) {
        try {
          const updatedNode = await ApiClient.getNode(currentRun.run_id, selectedNode.node_id);
          setSelectedNode(updatedNode);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error("Failed to step simulation:", err);
    }
  };

  // Toggle Play / Pause
  const handleTogglePlay = async () => {
    if (!currentRun) return;
    if (isPlaying) {
      setIsPlaying(false);
      await ApiClient.pauseRun(currentRun.run_id);
      setCurrentRun((prev) => (prev ? { ...prev, status: "paused" } : null));
    } else {
      setIsPlaying(true);
      await ApiClient.resumeRun(currentRun.run_id);
      setCurrentRun((prev) => (prev ? { ...prev, status: "running" } : null));
    }
  };

  // Reset simulation
  const handleReset = async () => {
    if (!currentRun) return;
    setIsPlaying(false);
    try {
      const resetRes = await ApiClient.resetRun(currentRun.run_id);
      setCurrentRun((prev) =>
        prev
          ? {
              ...prev,
              current_sim_time: resetRes.simulated_time,
              status: "queued",
              metrics_summary: resetRes.metrics,
            }
          : null
      );
      setSelectedNode(null);
      setSelectedLink(null);
      await refreshRunState(currentRun.run_id);
    } catch (err) {
      console.error("Failed to reset simulation:", err);
    }
  };

  // Select Node for inspection
  const handleSelectNode = async (nodeId: string) => {
    if (!currentRun) return;
    setSelectedLink(null);
    try {
      const nodeData = await ApiClient.getNode(currentRun.run_id, nodeId);
      setSelectedNode(nodeData);
    } catch (err) {
      console.error("Failed to load node details:", err);
    }
  };

  // Select Link for inspection
  const handleSelectLink = (link: Link) => {
    setSelectedNode(null);
    setSelectedLink(link);
  };

  // Auto-play interval
  useEffect(() => {
    if (!isPlaying || !currentRun) return;
    const intervalMs = Math.max(250, 1000 / simSpeed);
    const interval = setInterval(() => {
      handleStep(1);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isPlaying, currentRun, simSpeed]);

  // Keyboard navigation shortcuts (PRD FR-9)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handleStep(1);
      } else if (e.code === "Escape") {
        setSelectedNode(null);
        setSelectedLink(null);
      } else if (e.key === "1") {
        setActiveTab("overview");
      } else if (e.key === "2") {
        setActiveTab("topology");
      } else if (e.key === "3") {
        setActiveTab("packets");
      } else if (e.key === "4") {
        setActiveTab("decisions");
      } else if (e.key === "5") {
        setActiveTab("comparison");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleTogglePlay, handleStep]);

  return (
    <div className="app-container" id="app-root">
      {/* Header with Sim Controls */}
      <Header
        currentRun={currentRun}
        scenarios={scenarios}
        selectedScenarioId={selectedScenarioId}
        onSelectScenario={setSelectedScenarioId}
        selectedPolicy={selectedPolicy}
        onSelectPolicy={setSelectedPolicy}
        seed={seed}
        onSeedChange={setSeed}
        onCreateRun={handleCreateRun}
        onStep={handleStep}
        onTogglePlay={handleTogglePlay}
        isPlaying={isPlaying}
        onReset={handleReset}
        backendConnected={backendConnected}
        simSpeed={simSpeed}
        onSimSpeedChange={setSimSpeed}
      />

      {/* View Navigation */}
      <Navigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        packetCount={packets.length}
        decisionCount={decisions.length}
      />

      {/* Main Tab Panels */}
      <main className="tab-content" id="main-content" role="main">
        {activeTab === "overview" && (
          <OverviewTab
            currentRun={currentRun}
            topology={topology}
            metrics={metrics}
            events={events}
            agents={agents}
            onNavigateToTopology={() => setActiveTab("topology")}
            onNavigateToComparison={() => setActiveTab("comparison")}
          />
        )}

        {activeTab === "topology" && (
          <TopologyTab
            topology={topology}
            selectedNode={selectedNode}
            selectedLink={selectedLink}
            onSelectNode={handleSelectNode}
            onSelectLink={handleSelectLink}
            onCloseDrawer={() => {
              setSelectedNode(null);
              setSelectedLink(null);
            }}
          />
        )}

        {activeTab === "packets" && <PacketsTab packets={packets} />}

        {activeTab === "decisions" && <RoutingDecisionsTab decisions={decisions} />}

        {activeTab === "comparison" && (
          <ComparisonTab
            currentRun={currentRun}
            scenarios={scenarios}
            selectedScenarioId={selectedScenarioId}
            seed={seed}
          />
        )}
      </main>
    </div>
  );
};

export default App;
