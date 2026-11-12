import type { SimulationSession } from "../../app/useSimulationSession";
import type {
  AgentInfo,
  MetricsSummary,
  SimulationRun,
  TopologyData,
  TopologyEvent,
} from "../../types";
import {
  bufferLevel,
  formatBytes,
  formatCount,
  formatPercent,
  formatSeconds,
  formatSimTime,
} from "../../lib/format";
import {
  RUN_STATUS_LABEL,
  eventLabel,
  eventTone,
  policyLabel,
  runStatusTone,
} from "../../lib/status";
import {
  Chip,
  EmptyState,
  Figure,
  KeyValues,
  Meter,
  Notice,
  Panel,
  SkeletonRows,
  StatusLabel,
} from "../../components/ui";

interface ViewProps {
  session: SimulationSession;
}

const BACKEND_COPY: Record<
  SimulationSession["backend"],
  { tone: "active" | "degraded" | "critical"; label: string }
> = {
  online: { tone: "active", label: "Reachable" },
  connecting: { tone: "degraded", label: "Connecting" },
  degraded: { tone: "degraded", label: "Limited" },
  offline: { tone: "critical", label: "Unreachable" },
};

function BackendNotice() {
  return (
    <Notice tone="error" title="Backend unreachable">
      Start the FastAPI server on port 8000, then reload the page. Telemetry already loaded stays visible.
    </Notice>
  );
}

function RunSkeleton() {
  return (
    <Panel title="Preparing run" subtitle="Initializing the discrete-event simulation">
      <div className="grid grid-main">
        <div className="stack">
          <SkeletonRows rows={6} height={18} />
          <div className="divider" />
          <SkeletonRows rows={3} height={14} />
        </div>
        <SkeletonRows rows={5} height={14} />
      </div>
    </Panel>
  );
}

function NoRunView({ session }: ViewProps) {
  const { scenario, seed, selectedPolicy, backend, pending, initializeRun } = session;
  const readiness = BACKEND_COPY[backend];
  const initializing = pending === "initialize";
  const canStart = Boolean(scenario) && backend !== "offline";

  return (
    <div className="stack">
      {backend === "offline" ? <BackendNotice /> : null}
      <div className="grid grid-main">
        <Panel title="Scenario brief" subtitle={scenario ? scenario.id : "No scenario selected"}>
          {scenario ? (
            <>
              <div>
                <h2 style={{ fontSize: "var(--text-2xl)", letterSpacing: "-0.02em" }}>{scenario.name}</h2>
                <p className="muted" style={{ marginTop: "var(--space-2)", maxWidth: "62ch" }}>
                  {scenario.description}
                </p>
              </div>
              <div className="grid grid-3">
                <Figure label="Satellites" value={formatCount(scenario.satellites_count)} note="nodes" />
                <Figure label="Ground stations" value={formatCount(scenario.ground_stations_count)} note="downlinks" />
                <Figure label="Links" value={formatCount(scenario.links_count)} note="contacts" />
              </div>
              <div className="divider" />
              <KeyValues
                items={[
                  { label: "Duration", value: formatSimTime(scenario.duration_seconds) },
                  { label: "Policy", value: policyLabel(selectedPolicy) },
                  { label: "Seed", value: <span className="mono">{seed}</span> },
                  { label: "Simulation", value: "Discrete-event, deterministic for this seed" },
                ]}
              />
            </>
          ) : (
            <EmptyState
              title="No scenario loaded"
              body="The scenario catalog is empty. Start the backend and reload to load the available scenarios."
            />
          )}
        </Panel>

        <div className="stack">
          <Panel title="Start a run">
            <p className="muted">
              The run is a discrete-event simulation. Packets, links, buffers, and delivery figures are simulated.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void initializeRun()}
              disabled={!canStart || initializing}
            >
              {initializing ? "Initializing run..." : "Initialize run"}
            </button>
            <p className="tiny muted">
              {scenario
                ? "Initializing creates a queued run. Advance the clock from the run bar."
                : "Choose a scenario before initializing."}
            </p>
          </Panel>
          <Panel title="Backend readiness">
            <div className="spread">
              <span className="muted">REST API</span>
              <StatusLabel tone={readiness.tone}>{readiness.label}</StatusLabel>
            </div>
            <div className="divider" />
            {backend === "offline" ? (
              <Notice tone="error" title="Recovery hint">
                Start the FastAPI server on port 8000, then reload the page. Existing telemetry stays visible until then.
              </Notice>
            ) : (
              <p className="tiny muted">
                {backend === "connecting"
                  ? "Checking the health endpoint."
                  : backend === "degraded"
                    ? "The backend responded, but some checks were limited."
                    : "Health check passed. Scenario and agent data loaded."}
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function DeliveryPanel({ metrics, noPackets }: { metrics: MetricsSummary; noPackets: boolean }) {
  const droppedReasons = Object.entries(metrics.packets_dropped_by_reason)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <Panel title="Delivery" subtitle={noPackets ? "No packets generated yet" : "Delivered against generated"}>
      {noPackets ? (
        <Notice tone="info" title="No packets generated yet">
          Delivery ratio and delay figures populate after the first packet is generated. A zero delivery ratio is not a
          failure here.
        </Notice>
      ) : (
        <div className="row" style={{ alignItems: "flex-end", gap: "var(--space-4)" }}>
          <Figure
            label="Delivery ratio"
            value={formatPercent(metrics.delivery_ratio)}
            note={`${formatCount(metrics.packets_delivered)} delivered of ${formatCount(metrics.packets_generated)} generated`}
            tone={metrics.delivery_ratio >= 0.8 ? "active" : metrics.delivery_ratio >= 0.5 ? "degraded" : "critical"}
          />
          <div className="grow stack-sm">
            <Meter
              value={metrics.packets_delivered}
              max={Math.max(1, metrics.packets_generated)}
              level={metrics.delivery_ratio >= 0.8 ? "ok" : metrics.delivery_ratio >= 0.5 ? "warn" : "crit"}
              label="Delivered packets against generated packets"
            />
            <div className="spread tiny muted">
              <span>Delivered {formatCount(metrics.packets_delivered)}</span>
              <span>Generated {formatCount(metrics.packets_generated)}</span>
            </div>
          </div>
        </div>
      )}
      <div className="divider" />
      <div className="grid grid-3">
        <Figure label="Dropped" value={formatCount(metrics.packets_dropped)} note="packets" />
        <Figure label="Expired" value={formatCount(metrics.packets_expired)} note="packets" />
        <Figure label="Pending or buffered" value={formatCount(metrics.packets_pending)} note="packets" />
        <Figure label="In transit" value={formatCount(metrics.packets_in_transit)} note="packets" />
      </div>
      {droppedReasons.length > 0 ? (
        <>
          <div className="divider" />
          <div className="stack-sm">
            <span className="tiny muted">Drop reasons</span>
            <div className="row">
              {droppedReasons.map(([reason, count]) => (
                <Chip key={reason} tone="critical" title={`${reason}: ${count}`}>
                  {reason} {formatCount(count)}
                </Chip>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function DelayPanel({ metrics }: { metrics: MetricsSummary }) {
  return (
    <Panel title="Delay and route cost" subtitle="Per delivered packet where available">
      <div className="grid grid-3">
        <Figure label="Mean delay" value={formatSeconds(metrics.mean_delay_seconds)} />
        <Figure label="Median delay" value={formatSeconds(metrics.median_delay_seconds)} />
        <Figure label="95th percentile" value={formatSeconds(metrics.p95_delay_seconds)} />
      </div>
      <div className="divider" />
      <KeyValues
        items={[
          { label: "Mean hops", value: metrics.mean_hop_count.toFixed(2) },
          { label: "Bytes delivered", value: formatBytes(metrics.total_bytes_delivered) },
          { label: "Route changes", value: formatCount(metrics.route_changes_count) },
          { label: "Mean buffered", value: formatSeconds(metrics.mean_time_buffered_seconds) },
        ]}
      />
      <div className="divider" />
      <p className="tiny muted">
        {metrics.delivered_delay_records && metrics.delivered_delay_records.length > 0
          ? `${formatCount(metrics.delivered_delay_records.length)} per-delivered-packet delay records are available in the API response.`
          : "No per-delivered-packet delay records are available for this run yet."}
      </p>
    </Panel>
  );
}

function TopologyPanel({ metrics, topology }: { metrics: MetricsSummary; topology: TopologyData | null }) {
  const satellites = topology?.satellites ?? [];
  const satelliteById = new Map(satellites.map((satellite) => [satellite.satellite_id, satellite]));
  const activeLinks = topology ? topology.links.filter((link) => link.is_available).length : 0;
  const bufferRows = Object.entries(metrics.buffer_occupancy_by_node)
    .filter(([nodeId]) => satelliteById.has(nodeId))
    .map(([nodeId, used]) => ({ nodeId, used, capacity: satelliteById.get(nodeId)?.buffer_capacity_bytes ?? 0 }))
    .sort((a, b) => b.used - a.used)
    .slice(0, 5);

  return (
    <Panel title="Topology" subtitle="Contact graph and satellite buffers for this run">
      <div className="grid grid-3">
        <Figure
          label="Links available"
          value={topology ? `${formatCount(activeLinks)} / ${formatCount(topology.links.length)}` : "Not loaded"}
          note="available / total"
        />
        <Figure label="Satellites" value={topology ? formatCount(satellites.length) : "Not loaded"} note="nodes" />
        <Figure
          label="Ground stations"
          value={topology ? formatCount(topology.ground_stations.length) : "Not loaded"}
          note="downlinks"
        />
      </div>
      <div className="divider" />
      <div className="stack-sm">
        <div className="spread">
          <span className="tiny muted">Satellite buffer occupancy</span>
          <span className="tiny muted">Top 5 by used bytes</span>
        </div>
        {bufferRows.length > 0 ? (
          bufferRows.map((row) => (
            <div key={row.nodeId} className="stack-sm">
              <div className="spread">
                <span className="tiny">{row.nodeId}</span>
                <span className="tiny mono muted">
                  {formatBytes(row.used)} / {formatBytes(row.capacity)}
                </span>
              </div>
              <Meter
                value={row.used}
                max={Math.max(1, row.capacity)}
                level={bufferLevel(row.used, row.capacity)}
                label={`${row.nodeId} buffer occupancy`}
              />
            </div>
          ))
        ) : (
          <p className="tiny muted">
            No satellite buffer occupancy is reported. Load topology telemetry to resolve node names and capacities.
          </p>
        )}
      </div>
    </Panel>
  );
}

function MetadataPanel({ run }: { run: SimulationRun }) {
  return (
    <Panel title="Run metadata" subtitle="Scenario, policy, and simulated clock">
      <KeyValues
        items={[
          { label: "Scenario", value: run.scenario_id },
          { label: "Policy", value: policyLabel(run.routing_policy) },
          { label: "Seed", value: <span className="mono">{run.seed}</span> },
          {
            label: "Run id",
            value: (
              <span className="mono truncate" title={run.run_id} style={{ display: "block" }}>
                {run.run_id}
              </span>
            ),
          },
          {
            label: "Clock",
            value: `T+${run.current_sim_time.toFixed(1)} s of ${formatSimTime(run.simulated_duration)}`,
          },
          {
            label: "Status",
            value: <StatusLabel tone={runStatusTone(run.status)}>{RUN_STATUS_LABEL[run.status]}</StatusLabel>,
          },
        ]}
      />
    </Panel>
  );
}

function EventsPanel({ events }: { events: TopologyEvent[] }) {
  const recent = [...events].sort((a, b) => b.simulated_time - a.simulated_time).slice(0, 12);
  return (
    <Panel title="Recent simulation events" subtitle="Newest first">
      {recent.length > 0 ? (
        <ol className="stack-sm" style={{ gap: 0 }}>
          {recent.map((event, index) => (
            <li
              key={event.event_id ?? `${event.simulated_time}-${index}`}
              style={{
                padding: "var(--space-2) 0",
                borderTop: index === 0 ? undefined : "1px solid var(--line)",
              }}
            >
              <div className="spread">
                <div className="row-tight">
                  <StatusLabel tone={eventTone(event.event_type)}>{eventLabel(event.event_type)}</StatusLabel>
                  {event.node_id ? <Chip title="Node">{event.node_id}</Chip> : null}
                  {event.link_id ? <Chip title="Link">{event.link_id}</Chip> : null}
                  {event.packet_id ? <Chip title="Packet">{event.packet_id}</Chip> : null}
                </div>
                <span className="tiny mono muted nowrap">T+{event.simulated_time.toFixed(1)}s</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="No events yet"
          body="Events appear as the simulation advances. Link changes, packet hops, drops, and routing decisions are recorded here."
        />
      )}
    </Panel>
  );
}

function AgentsPanel({ agents }: { agents: AgentInfo[] }) {
  return (
    <Panel title="Registered agents" subtitle="Container registry for this backend">
      {agents.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Type</th>
                <th>Status</th>
                <th>Heartbeats</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.node_id}>
                  <td className="cell-mono">{agent.node_id}</td>
                  <td className="tiny">{agent.node_type}</td>
                  <td>
                    <StatusLabel tone={agent.status === "active" ? "active" : "muted"}>{agent.status}</StatusLabel>
                  </td>
                  <td className="cell-num">{formatCount(agent.heartbeat_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No container agents registered"
          body="In-process mode registers no container agents. The simulation still runs entirely inside the backend process."
        />
      )}
    </Panel>
  );
}

function ActiveRunView({ session, loading }: ViewProps & { loading: boolean }) {
  const run = session.run;
  if (!run) return null;
  const metrics = session.metrics ?? run.metrics_summary;

  return (
    <div className="stack">
      {session.backend === "offline" ? <BackendNotice /> : null}
      {loading ? (
        <Panel title="Updating summary" subtitle="Waiting for the next step result">
          <div className="grid grid-main">
            <SkeletonRows rows={7} height={18} />
            <SkeletonRows rows={5} height={14} />
          </div>
        </Panel>
      ) : (
        <div className="grid grid-main">
          <div className="stack">
            <DeliveryPanel metrics={metrics} noPackets={metrics.packets_generated === 0} />
            <DelayPanel metrics={metrics} />
          </div>
          <div className="stack">
            <TopologyPanel metrics={metrics} topology={session.topology} />
            <MetadataPanel run={run} />
          </div>
        </div>
      )}
      <div className="grid grid-main">
        <EventsPanel events={session.events} />
        <AgentsPanel agents={session.agents} />
      </div>
    </div>
  );
}

export const OverviewView = ({ session }: ViewProps) => {
  const loading = session.pending === "initialize" || session.pending === "step";
  if (!session.run) return loading ? <RunSkeleton /> : <NoRunView session={session} />;
  return <ActiveRunView session={session} loading={loading} />;
};