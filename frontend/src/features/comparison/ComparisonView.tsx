import type { ReactNode } from "react";
import { useSession } from "../../app/session";
import { Chip, EmptyState, KeyValues, Meter } from "../../components/ui";
import { ApiClient } from "../../api/client";
import { formatBytes, formatMs, formatNumber, formatPercent } from "../../lib/format";
import type { AffectedStats } from "../../types";

interface Row {
  label: string;
  direct: ReactNode;
  dtn: ReactNode;
}

/** Direct-to-ground only vs with DTN, for the affected satellite, computed by the backend from this run. */
export function ComparisonView() {
  const { state } = useSession();
  if (!state) return <EmptyState title="Connecting…" />;
  const comparison = state.comparison;

  if (!comparison) {
    return (
      <EmptyState
        title={state.run_id ? "Waiting for an anomaly" : "No run yet"}
        body="The comparison is built by the backend from this run once an anomaly is detected: the affected satellite under direct-to-ground only versus with DTN store-carry-forward."
      />
    );
  }

  const direct = comparison.direct_only;
  const dtn = comparison.with_dtn;
  const value = (stats: AffectedStats | null, pick: (s: AffectedStats) => ReactNode) => (stats ? pick(stats) : "—");
  const rows: Row[] = [
    {
      label: "Delivery ratio",
      direct: value(direct, (s) => <Ratio ratio={s.delivery_ratio} />),
      dtn: <Ratio ratio={dtn.delivery_ratio} />,
    },
    { label: "Delivered", direct: value(direct, (s) => `${s.delivered} / ${s.total}`), dtn: `${dtn.delivered} / ${dtn.total}` },
    { label: "Lost on direct link", direct: value(direct, (s) => s.lost), dtn: dtn.lost },
    { label: "Recovered via DTN", direct: value(direct, (s) => s.recovered), dtn: dtn.recovered },
    { label: "Never delivered", direct: value(direct, (s) => s.unrecovered), dtn: dtn.unrecovered },
    { label: "Mean latency", direct: value(direct, (s) => formatMs(s.mean_latency_ms)), dtn: formatMs(dtn.mean_latency_ms) },
    { label: "Worst latency", direct: value(direct, (s) => formatMs(s.max_latency_ms)), dtn: formatMs(dtn.max_latency_ms) },
    { label: "Mean hops", direct: value(direct, (s) => formatNumber(s.mean_hops, 2)), dtn: formatNumber(dtn.mean_hops, 2) },
    { label: "Delivered via relay", direct: value(direct, (s) => s.via_relay), dtn: dtn.via_relay },
  ];
  const metrics = state.metrics;

  return (
    <div className="stack tab-scroll scroll-area">
      <div className="row">
        <span className="mono cell-strong">{comparison.satellite_id}</span>
        {comparison.relay_id ? <Chip tone="active">relay {comparison.relay_id}</Chip> : null}
        <Chip tone={comparison.final ? "active" : "degraded"}>{comparison.final ? "Final" : "Live"}</Chip>
        <span className="grow" />
        <span className="tiny muted mono">
          {state.scenario_id} · seed {state.seed}
        </span>
      </div>

      <div className="table-wrap">
        <table className="table table-compare">
          <thead>
            <tr>
              <th scope="col">{comparison.satellite_id}</th>
              <th scope="col">Direct-to-ground only</th>
              <th scope="col">With DTN</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="cell-label">
                  {row.label}
                </th>
                <td className="cell-num">{row.direct}</td>
                <td className="cell-num">{row.dtn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!comparison.final ? (
        <p className="tiny muted">
          With-DTN figures are live and settle when the run is resolved. Latency excludes the pause, because simulated time
          stops while the run waits for Solve.
        </p>
      ) : (
        <p className="tiny muted">Latency excludes the pause: simulated time stops while the run waits for Solve.</p>
      )}
      <p className="tiny muted">{comparison.method}</p>

      <section className="stack-sm" aria-labelledby="network-totals">
        <h3 id="network-totals" className="section-title">
          Whole network, this run
        </h3>
        <KeyValues
          items={[
            { label: "Generated", value: metrics.packets_generated },
            { label: "Delivered", value: `${metrics.packets_delivered} (${formatPercent(metrics.delivery_ratio)})` },
            { label: "Lost on direct links", value: metrics.packets_lost_direct },
            { label: "Stored now", value: metrics.packets_stored },
            { label: "Mean / p95 delay", value: `${formatMs(metrics.mean_delay_ms)} / ${formatMs(metrics.p95_delay_ms)}` },
            { label: "Bytes delivered", value: formatBytes(metrics.total_bytes_delivered) },
          ]}
        />
        <a className="btn btn-sm" style={{ alignSelf: "flex-start" }} href={ApiClient.exportUrl} download>
          Export run (JSON)
        </a>
      </section>
    </div>
  );
}

function Ratio({ ratio }: { ratio: number }) {
  return (
    <span className="ratio">
      <span>{formatPercent(ratio)}</span>
      <Meter value={ratio} max={1} level={ratio >= 0.95 ? "ok" : ratio >= 0.7 ? "warn" : "crit"} label="Delivery ratio" />
    </span>
  );
}
