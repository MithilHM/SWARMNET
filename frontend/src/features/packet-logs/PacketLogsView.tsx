import { useMemo, useState } from "react";
import { useSession } from "../../app/session";
import { Chip, EmptyState } from "../../components/ui";
import { formatBytes, simStamp } from "../../lib/format";
import { STATUS_LABEL, TAG_LABEL, statusTone, tagTone } from "../../lib/status";
import type { PacketLogStatus, PhaseTag, SimEvent } from "../../types";

type PhaseFilter = "all" | Exclude<PhaseTag, "idle">;
type StatusFilter = "all" | PacketLogStatus;

const PHASE_FILTERS: Array<{ key: PhaseFilter; label: string }> = [
  { key: "all", label: "All phases" },
  { key: "stable", label: "Stable" },
  { key: "degrading", label: "Degrading" },
  { key: "detected", label: "Detected" },
  { key: "dtn", label: "DTN" },
];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All statuses" },
  { key: "sent", label: "Sent" },
  { key: "lost", label: "Lost" },
  { key: "stored", label: "Stored" },
  { key: "forwarded", label: "Forwarded" },
  { key: "delivered", label: "Delivered" },
];

function rowTone(event: SimEvent): string | undefined {
  if (event.status === "lost") return "lost";
  if (event.status === "delivered" && event.tag === "dtn" && (event.hop_path?.length ?? 0) > 2) return "dtn";
  return undefined;
}

/** Live event log for the current run, streamed from the backend. */
export function PacketLogsView() {
  const { events, state } = useSession();
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const visible = useMemo(() => {
    const rows = events.filter((event) => {
      const isPacket = event.type === "packet";
      if (statusFilter !== "all" && (!isPacket || event.status !== statusFilter)) return false;
      if (phaseFilter !== "all" && event.tag !== phaseFilter) return false;
      return true;
    });
    return rows.reverse();
  }, [events, phaseFilter, statusFilter]);

  const counts = useMemo(() => {
    const next: Record<PacketLogStatus, number> = { sent: 0, lost: 0, stored: 0, forwarded: 0, delivered: 0 };
    for (const event of events) if (event.type === "packet" && event.status) next[event.status] += 1;
    return next;
  }, [events]);

  if (!state?.run_id) {
    return (
      <EmptyState
        title="No run yet"
        body="Press Play. Every packet the backend sends, loses, stores, forwards, and delivers appears here as it happens."
      />
    );
  }

  return (
    <div className="stack-sm tab-fill">
      <div className="row tiny muted">
        <span className="mono">{state.run_id}</span>
        <span className="grow" />
        <Chip tone="muted">{counts.sent} sent</Chip>
        <Chip tone="critical">{counts.lost} lost</Chip>
        <Chip tone="degraded">{counts.stored} stored</Chip>
        <Chip tone="muted">{counts.forwarded} fwd</Chip>
        <Chip tone="active">{counts.delivered} delivered</Chip>
      </div>

      <div className="filters" role="group" aria-label="Filter by phase">
        {PHASE_FILTERS.map((item) => (
          <button key={item.key} type="button" className="filter-btn" aria-pressed={phaseFilter === item.key} onClick={() => setPhaseFilter(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="filters" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((item) => (
          <button key={item.key} type="button" className="filter-btn" aria-pressed={statusFilter === item.key} onClick={() => setStatusFilter(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="table-wrap scroll-area tab-scroll">
        <table className="table table-log">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Packet</th>
              <th scope="col">Source</th>
              <th scope="col">Hop path</th>
              <th scope="col">Status</th>
              <th scope="col">Phase</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted tiny">
                  No events match these filters yet.
                </td>
              </tr>
            ) : null}
            {visible.map((event) =>
              event.type === "packet" && event.status ? (
                <tr key={event.seq} data-tone={rowTone(event)} title={event.message}>
                  <td className="cell-num">{simStamp(event.t)}</td>
                  <td className="cell-mono" title={event.size_bytes ? formatBytes(event.size_bytes) : undefined}>
                    {event.packet_id}
                  </td>
                  <td className="cell-mono">{event.source}</td>
                  <td className="cell-mono cell-path">
                    <HopPath event={event} />
                  </td>
                  <td>
                    <Chip tone={statusTone(event.status)}>{STATUS_LABEL[event.status]}</Chip>
                  </td>
                  <td>
                    <Chip tone={tagTone(event.tag)}>{TAG_LABEL[event.tag]}</Chip>
                  </td>
                </tr>
              ) : (
                <tr key={event.seq} className="row-system" data-tone={event.type === "anomaly_detected" ? "lost" : event.type === "run_resolved" ? "dtn" : undefined}>
                  <td className="cell-num">{simStamp(event.t)}</td>
                  <td colSpan={4}>{event.message}</td>
                  <td>
                    <Chip tone={tagTone(event.tag)}>{TAG_LABEL[event.tag]}</Chip>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HopPath({ event }: { event: SimEvent }) {
  const path = event.hop_path ?? [];
  return (
    <span className="hop-path">
      {path.map((node, index) => (
        <span key={`${node}-${index}`}>
          {index > 0 ? <span className="muted"> → </span> : null}
          <span className={event.status === "lost" && index === path.length - 1 ? "hop-broken" : undefined}>{node}</span>
        </span>
      ))}
    </span>
  );
}
