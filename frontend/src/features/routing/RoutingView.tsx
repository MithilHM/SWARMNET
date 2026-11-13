import { useSession } from "../../app/session";
import { Chip, EmptyState, KeyValues, StatusLabel } from "../../components/ui";
import { formatNumber, formatPercent, pathLabel, simStamp } from "../../lib/format";
import { LINK_STATE_LABEL, PROTOCOL_LABEL, linkStateTone } from "../../lib/status";
import type { RoutingRow } from "../../types";

/** Routing state from the backend for the current run: before the anomaly and live. */
export function RoutingView() {
  const { state, events } = useSession();
  if (!state) return <EmptyState title="Connecting…" />;

  const current = state.routing.current;
  const before = state.routing.before;
  const dtn = state.dtn;
  const anomaly = state.anomaly;
  const affected = anomaly?.satellite_id ?? null;
  const routeEvents = events.filter((event) => event.type === "route_change" || event.type === "protocol_switch" || event.type === "anomaly_detected");

  if (!current || !before) {
    return (
      <div className="stack-sm">
        <EmptyState
          title="No routes yet"
          body="Press Play. Every satellite starts on direct-to-ground routing; the table updates live when the backend switches a satellite to DTN."
        />
      </div>
    );
  }

  const oldRow = affected ? before.find((row) => row.satellite_id === affected) : undefined;
  const newRow = affected ? current.find((row) => row.satellite_id === affected) : undefined;
  const candidates = dtn?.decision?.candidate_scores ? Object.entries(dtn.decision.candidate_scores) : [];

  return (
    <div className="stack tab-scroll scroll-area">
      <section className="stack-sm" aria-labelledby="routing-live">
        <h3 id="routing-live" className="section-title">
          Routing table · live
        </h3>
        <RoutingTable rows={current} highlight={affected} relay={dtn?.relay_id ?? null} />
      </section>

      {affected && oldRow && newRow ? (
        <section className="stack-sm route-compare" aria-labelledby="routing-affected">
          <h3 id="routing-affected" className="section-title">
            {affected}: old path vs new path
          </h3>
          <div className="route-diff">
            <div className="route-diff-col" data-tone="lost">
              <span className="field-label">Before · {PROTOCOL_LABEL[oldRow.protocol]}</span>
              <span className="mono">{pathLabel(oldRow.path)}</span>
              <span className="tiny muted">via {oldRow.ground_link_id}</span>
            </div>
            <div className="route-diff-col" data-tone={newRow.protocol === "dtn" ? "dtn" : undefined}>
              <span className="field-label">Now · {PROTOCOL_LABEL[newRow.protocol]}</span>
              <span className="mono">{pathLabel(newRow.path)}</span>
              <span className="tiny muted">
                {newRow.protocol === "dtn" ? `relay ${dtn?.relay_id ?? "—"}` : "awaiting Solve"}
              </span>
            </div>
          </div>
          {dtn?.decision ? (
            <KeyValues
              items={[
                { label: "Relay chosen", value: <b className="mono">{dtn.relay_id ?? "none"}</b> },
                { label: "Reason", value: <span className="mono">{dtn.decision.reason_code}</span> },
                { label: "Decided at", value: simStamp(dtn.decision.decision_time) },
                { label: "Explanation", value: dtn.decision.explanation ?? "—" },
              ]}
            />
          ) : (
            <p className="tiny muted">Relay selection runs when Solve is pressed.</p>
          )}
          {candidates.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Relay candidates and scores</caption>
                <thead>
                  <tr>
                    <th scope="col">Relay</th>
                    <th scope="col">Path</th>
                    <th scope="col">Reliability</th>
                    <th scope="col">Latency</th>
                    <th scope="col">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates
                    .sort((a, b) => b[1].total_score - a[1].total_score)
                    .map(([relay, score]) => (
                      <tr key={relay} data-tone={relay === dtn?.relay_id ? "dtn" : undefined}>
                        <td className="cell-mono">
                          {relay}
                          {relay === dtn?.relay_id ? " ✓" : ""}
                        </td>
                        <td className="cell-mono">{pathLabel(score.route_path)}</td>
                        <td className="cell-num">{formatNumber(score.path_reliability, 3)}</td>
                        <td className="cell-num">{formatNumber(score.estimated_path_latency_ms, 1)} ms</td>
                        <td className="cell-num">{formatNumber(score.total_score, 3)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="tiny muted">Score = 0.7 × path reliability + 0.3 × (1 − latency / worst latency) − 0.05 × extra hops.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="stack-sm" aria-labelledby="routing-before">
        <h3 id="routing-before" className="section-title">
          Routing table · before the anomaly
        </h3>
        <RoutingTable rows={before} highlight={affected} relay={null} />
      </section>

      {routeEvents.length > 0 ? (
        <section className="stack-sm" aria-labelledby="routing-changes">
          <h3 id="routing-changes" className="section-title">
            Route changes
          </h3>
          <ul className="stack-sm">
            {routeEvents.map((event) => (
              <li key={event.seq} className="spread tiny">
                <span>{event.message}</span>
                <span className="mono muted">{simStamp(event.t)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RoutingTable({ rows, highlight, relay }: { rows: RoutingRow[]; highlight: string | null; relay: string | null }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Satellite</th>
            <th scope="col">Protocol</th>
            <th scope="col">Path</th>
            <th scope="col">Ground link</th>
            <th scope="col">Stored</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.satellite_id}
              data-tone={row.satellite_id === highlight ? (row.protocol === "dtn" ? "dtn" : "lost") : row.satellite_id === relay ? "dtn" : undefined}
            >
              <td className="cell-mono cell-strong">
                {row.satellite_id}
                {row.relay_for.length ? <span className="muted"> · relay for {row.relay_for.join(", ")}</span> : null}
              </td>
              <td>
                <Chip tone={row.protocol === "dtn" ? "active" : "muted"}>{row.protocol === "dtn" ? "DTN" : "Direct"}</Chip>
              </td>
              <td className="cell-mono">{pathLabel(row.path)}</td>
              <td>
                <StatusLabel tone={linkStateTone(row.ground_link_state)}>
                  {LINK_STATE_LABEL[row.ground_link_state]}
                </StatusLabel>
                <span className="tiny muted mono">
                  {" "}
                  rel {formatNumber(row.ground_link_reliability, 2)}
                  {row.ground_link_loss_rate != null ? ` · loss ${formatPercent(row.ground_link_loss_rate)}` : ""}
                </span>
              </td>
              <td className="cell-num">{row.stored_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
