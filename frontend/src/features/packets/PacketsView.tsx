import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Chip, EmptyState, KeyValues, Panel, StatusLabel } from "../../components/ui";
import type { SimulationSession } from "../../app/useSimulationSession";
import type { Packet, PacketStatus } from "../../types";
import { PACKET_STATUS_LABEL, PRIORITY_LABEL, packetStatusTone, priorityTone } from "../../lib/status";
import { formatBytes } from "../../lib/format";

type StatusFilter = PacketStatus | "all";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "created", label: "Created" },
  { key: "buffered", label: "Buffered" },
  { key: "in_transit", label: "In transit" },
  { key: "delivered", label: "Delivered" },
  { key: "dropped", label: "Dropped" },
  { key: "expired", label: "Expired" },
];

function stamp(seconds: number): string {
  return `T+${seconds.toFixed(1)}s`;
}

function ageSeconds(packet: Packet, simTime: number): { value: number; label: string } {
  if (packet.status === "delivered" && packet.delivery_time != null) {
    return { value: Math.max(0, packet.delivery_time - packet.created_at), label: "Delivery delay" };
  }
  return { value: Math.max(0, simTime - packet.created_at), label: "Age" };
}

export function PacketsView({ session }: { session: SimulationSession }) {
  const { packets, simTime, run } = session;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const next: Record<StatusFilter, number> = {
      all: packets.length,
      created: 0,
      buffered: 0,
      in_transit: 0,
      delivered: 0,
      dropped: 0,
      expired: 0,
    };
    for (const packet of packets) next[packet.status] += 1;
    return next;
  }, [packets]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return packets.filter((packet) => {
      if (statusFilter !== "all" && packet.status !== statusFilter) return false;
      if (!needle) return true;
      return [
        packet.packet_id,
        packet.source_node_id,
        packet.destination_node_id,
        packet.current_node_id,
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [packets, statusFilter, query]);

  const selected = useMemo(
    () => packets.find((packet) => packet.packet_id === selectedId) ?? null,
    [packets, selectedId],
  );

  if (!run) {
    return (
      <Panel title="Packets" subtitle="Packet ledger">
        <EmptyState
          title="No run initialized"
          body="Initialize a run from the top bar to load packet telemetry. Counts, routes, and delivery times appear once the API returns packets for the run."
        />
      </Panel>
    );
  }

  const clearFilters = () => {
    setStatusFilter("all");
    setQuery("");
  };

  return (
    <div className={selected ? "split" : undefined}>
      <Panel
        title="Packets"
        subtitle={`${visible.length} of ${packets.length} packets shown`}
        footer={`Counts reflect the current API payload (${packets.length} packets). Packets that have not been delivered are reported as buffered or in transit, not dropped.`}
      >
        <div className="spread">
          <div className="filters" role="group" aria-label="Filter packets by status">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="filter-btn"
                aria-pressed={statusFilter === item.key}
                onClick={() => setStatusFilter(item.key)}
              >
                {item.label}
                <span className="badge-count" style={{ marginLeft: 4 }}>
                  {counts[item.key]}
                </span>
              </button>
            ))}
          </div>

          <label className="field" style={{ minWidth: 220 }}>
            <span className="field-label">Search</span>
            <input
              className="input"
              type="search"
              aria-label="Search packets"
              placeholder="Packet id, source, destination, or holder"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {visible.length === 0 ? (
          packets.length === 0 ? (
            <EmptyState
              title="No packets yet"
              body="The API has not returned any packets for this run. Step the simulation to generate traffic."
            />
          ) : (
            <EmptyState
              title="No packets match"
              body="No packet matches this status filter and search. Clear the filters to see the full ledger."
              action={
                <button type="button" className="btn btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            />
          )
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Packet</th>
                  <th>Status</th>
                  <th>Route</th>
                  <th>Current holder</th>
                  <th>Priority</th>
                  <th>Payload</th>
                  <th>Hops</th>
                  <th>Age / delay</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((packet) => {
                  const age = ageSeconds(packet, simTime);
                  return (
                    <tr
                      key={packet.packet_id}
                      data-clickable="true"
                      data-selected={packet.packet_id === selectedId}
                      onClick={() => setSelectedId(packet.packet_id)}
                    >
                      <td className="cell-mono">{packet.packet_id}</td>
                      <td>
                        <Chip tone={packetStatusTone(packet.status)}>
                          {PACKET_STATUS_LABEL[packet.status]}
                        </Chip>
                      </td>
                      <td className="cell-mono">
                        {packet.source_node_id} <span aria-hidden="true">→</span>{" "}
                        {packet.destination_node_id}
                      </td>
                      <td className="cell-strong">{packet.current_node_id}</td>
                      <td>
                        <StatusLabel tone={priorityTone(packet.priority)}>
                          {PRIORITY_LABEL[packet.priority]}
                        </StatusLabel>
                      </td>
                      <td className="cell-num">{formatBytes(packet.payload_size_bytes)}</td>
                      <td className="cell-num">
                        {packet.hop_count} / {packet.max_hops}
                      </td>
                      <td className="cell-num" title={age.label}>
                        {age.value.toFixed(1)}s
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(packet.packet_id);
                          }}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected ? (
        <PacketInspector packet={selected} simTime={simTime} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}

function PacketInspector({
  packet,
  simTime,
  onClose,
}: {
  packet: Packet;
  simTime: number;
  onClose: () => void;
}) {
  const age = ageSeconds(packet, simTime);
  const summary: Array<{ label: string; value: ReactNode }> = [
    {
      label: "Status",
      value: <Chip tone={packetStatusTone(packet.status)}>{PACKET_STATUS_LABEL[packet.status]}</Chip>,
    },
    { label: "Created", value: <span className="mono">{stamp(packet.created_at)}</span> },
    {
      label: "Expires",
      value: <span className="mono">{packet.expires_at != null ? stamp(packet.expires_at) : "no expiry"}</span>,
    },
    {
      label: "Delivered",
      value: <span className="mono">{packet.delivery_time != null ? stamp(packet.delivery_time) : "pending"}</span>,
    },
    { label: "Payload", value: <span className="mono">{formatBytes(packet.payload_size_bytes)}</span> },
    {
      label: "Priority",
      value: <StatusLabel tone={priorityTone(packet.priority)}>{PRIORITY_LABEL[packet.priority]}</StatusLabel>,
    },
    { label: "Hops", value: <span className="mono">{packet.hop_count} / {packet.max_hops}</span> },
    { label: age.label, value: <span className="mono">{age.value.toFixed(1)}s</span> },
  ];
  if (packet.drop_reason) {
    summary.push({ label: "Drop reason", value: packet.drop_reason });
  }

  return (
    <Panel
      title={packet.packet_id}
      subtitle="Packet detail"
      actions={
        <button type="button" className="btn btn-sm btn-quiet" onClick={onClose}>
          Close
        </button>
      }
      footer="All timestamps are simulated seconds from the start of the run."
    >
      <KeyValues items={summary} />

      <div className="stack-sm">
        <h3 className="panel-title">Route history</h3>
        {packet.route_history.length === 0 ? (
          <p className="tiny muted">No hops recorded. The packet has not left its origin.</p>
        ) : (
          <ol className="stack-sm">
            {packet.route_history.map((hop, index) => (
              <li key={`${hop.node_id}-${hop.arrived_at}-${index}`} className="stack-sm" style={{ gap: 2 }}>
                <div className="spread">
                  <span className="row-tight">
                    <span className="badge-count">{String(index + 1).padStart(2, "0")}</span>
                    <span className="mono">{hop.node_id}</span>
                  </span>
                  <span className="tiny muted">
                    {hop.link_id ? `link ${hop.link_id}` : "origin"}
                  </span>
                </div>
                <div className="tiny muted mono">
                  Arrived {stamp(hop.arrived_at)}
                  {hop.departed_at != null ? `, departed ${stamp(hop.departed_at)}` : ", held"}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="stack-sm">
        <h3 className="panel-title">Visited nodes</h3>
        {packet.visited_node_ids.length === 0 ? (
          <p className="tiny muted">No nodes recorded yet.</p>
        ) : (
          <div className="row">
            {packet.visited_node_ids.map((nodeId) => (
              <span key={nodeId} className="chip">
                {nodeId}
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}