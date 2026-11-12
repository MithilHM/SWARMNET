import { useCallback, useRef, useState } from "react";
import { ApiClient } from "../../api/client";
import type { SimulationSession } from "../../app/useSimulationSession";
import type { ComparisonResult } from "../../types";
import {
  formatBytes,
  formatCount,
  formatPercent,
  formatSeconds,
  formatSigned,
} from "../../lib/format";
import {
  EmptyState,
  KeyValues,
  Notice,
  Panel,
  SkeletonRows,
} from "../../components/ui";

interface ViewProps {
  session: SimulationSession;
}

interface MetricRow {
  label: string;
  baseline: string;
  swarmnet: string;
  delta: string;
}

function deltaText(value: number, digits: number, suffix = ""): string {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? "no change" : formatSigned(value, digits, suffix);
}

function deltaBytes(value: number): string {
  if (Math.abs(value) < 0.5) return "no change";
  return `${value > 0 ? "+" : "-"}${formatBytes(Math.abs(value))}`;
}

function buildRows(result: ComparisonResult): MetricRow[] {
  const baseline = result.baseline.metrics;
  const swarmnet = result.swarmnet.metrics;

  return [
    {
      label: "Generated",
      baseline: formatCount(baseline.packets_generated),
      swarmnet: formatCount(swarmnet.packets_generated),
      delta: deltaText(swarmnet.packets_generated - baseline.packets_generated, 0),
    },
    {
      label: "Delivered",
      baseline: formatCount(baseline.packets_delivered),
      swarmnet: formatCount(swarmnet.packets_delivered),
      delta: deltaText(swarmnet.packets_delivered - baseline.packets_delivered, 0),
    },
    {
      label: "Delivery ratio",
      baseline: formatPercent(baseline.delivery_ratio),
      swarmnet: formatPercent(swarmnet.delivery_ratio),
      delta: deltaText((swarmnet.delivery_ratio - baseline.delivery_ratio) * 100, 1, "%"),
    },
    {
      label: "Dropped",
      baseline: formatCount(baseline.packets_dropped),
      swarmnet: formatCount(swarmnet.packets_dropped),
      delta: deltaText(swarmnet.packets_dropped - baseline.packets_dropped, 0),
    },
    {
      label: "Expired",
      baseline: formatCount(baseline.packets_expired),
      swarmnet: formatCount(swarmnet.packets_expired),
      delta: deltaText(swarmnet.packets_expired - baseline.packets_expired, 0),
    },
    {
      label: "Pending or buffered",
      baseline: formatCount(baseline.packets_pending),
      swarmnet: formatCount(swarmnet.packets_pending),
      delta: deltaText(swarmnet.packets_pending - baseline.packets_pending, 0),
    },
    {
      label: "Mean delay",
      baseline: formatSeconds(baseline.mean_delay_seconds),
      swarmnet: formatSeconds(swarmnet.mean_delay_seconds),
      delta: deltaText(swarmnet.mean_delay_seconds - baseline.mean_delay_seconds, 2, "s"),
    },
    {
      label: "Median delay",
      baseline: formatSeconds(baseline.median_delay_seconds),
      swarmnet: formatSeconds(swarmnet.median_delay_seconds),
      delta: deltaText(swarmnet.median_delay_seconds - baseline.median_delay_seconds, 2, "s"),
    },
    {
      label: "95th percentile delay",
      baseline: formatSeconds(baseline.p95_delay_seconds),
      swarmnet: formatSeconds(swarmnet.p95_delay_seconds),
      delta: deltaText(swarmnet.p95_delay_seconds - baseline.p95_delay_seconds, 2, "s"),
    },
    {
      label: "Mean hop count",
      baseline: baseline.mean_hop_count.toFixed(2),
      swarmnet: swarmnet.mean_hop_count.toFixed(2),
      delta: deltaText(swarmnet.mean_hop_count - baseline.mean_hop_count, 2, " hops"),
    },
    {
      label: "Bytes delivered",
      baseline: formatBytes(baseline.total_bytes_delivered),
      swarmnet: formatBytes(swarmnet.total_bytes_delivered),
      delta: deltaBytes(swarmnet.total_bytes_delivered - baseline.total_bytes_delivered),
    },
    {
      label: "Route changes",
      baseline: formatCount(baseline.route_changes_count),
      swarmnet: formatCount(swarmnet.route_changes_count),
      delta: deltaText(swarmnet.route_changes_count - baseline.route_changes_count, 0),
    },
  ];
}

function ComparisonBasis({ session }: ViewProps) {
  const { scenario, seed } = session;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; data: ComparisonResult } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const requestId = useRef(0);

  const scenarioId = scenario?.id ?? "";
  const comparisonKey = `${scenarioId}:${seed}`;
  const loading = pendingKey === comparisonKey;
  const activeResult = result?.key === comparisonKey ? result.data : null;
  const activeError = error?.key === comparisonKey ? error.message : null;

  const runComparison = useCallback(async () => {
    if (!scenarioId) return;
    const requestKey = `${scenarioId}:${seed}`;
    const token = requestId.current + 1;
    requestId.current = token;
    setPendingKey(requestKey);
    setError(null);

    try {
      const next = await ApiClient.comparePolicies(scenarioId, seed);
      if (token === requestId.current) setResult({ key: requestKey, data: next });
    } catch (err) {
      if (token === requestId.current) {
        setError({
          key: requestKey,
          message: err instanceof Error ? err.message : "Comparison request failed.",
        });
      }
    } finally {
      if (token === requestId.current) setPendingKey(null);
    }
  }, [scenarioId, seed]);

  return (
    <div className="stack">
      <Panel
        title="Comparison basis"
        subtitle="Baseline and SWARMNET run the same scenario with the same seed."
      >
        <div className="grid grid-2">
          <div>
            <span className="tiny muted">Scenario</span>
            <p style={{ fontWeight: 600 }}>{scenario?.name ?? "No scenario loaded"}</p>
            <p className="tiny mono muted">{scenario?.id ?? "scenario not selected"}</p>
          </div>
          <div>
            <span className="tiny muted">Seed</span>
            <p className="mono" style={{ fontSize: "var(--text-lg)" }}>
              {seed}
            </p>
            <p className="tiny muted">Both policies receive this random seed.</p>
          </div>
        </div>

        <div className="divider" />

        <div className="spread">
          <p className="tiny muted" style={{ maxWidth: "48ch" }}>
            Baseline forwards along shortest paths. SWARMNET scores neighbors using contact, reliability, latency, and
            congestion signals. Only returned metrics are compared here.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void runComparison()}
            disabled={loading || !scenarioId}
          >
            {loading ? "Running both policies..." : "Run comparison"}
          </button>
        </div>

        {activeError ? (
          <Notice tone="error" title="Comparison failed">
            {activeError}
          </Notice>
        ) : null}
      </Panel>

      <div className="grid grid-main">
        <Panel
          title="Measured results"
          subtitle={
            activeResult
              ? `Produced for scenario ${activeResult.scenario_id}, seed ${activeResult.seed}.`
              : "Waiting for a comparison"
          }
        >
          {loading ? (
            <div className="stack-sm">
              <SkeletonRows rows={8} height={16} />
              <SkeletonRows rows={4} height={12} />
            </div>
          ) : activeResult ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Baseline</th>
                    <th>SWARMNET</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {buildRows(activeResult).map((row) => (
                    <tr key={row.label}>
                      <td className="cell-strong">{row.label}</td>
                      <td className="cell-num">{row.baseline}</td>
                      <td className="cell-num">{row.swarmnet}</td>
                      <td className={`cell-num${row.delta === "no change" ? " muted" : ""}`}>{row.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No comparison yet"
              body="Run both policies to compare generated and delivered packets, delivery ratio, drops, expiry, buffering, mean and tail delay, hop count, bytes delivered, and route changes."
            />
          )}
        </Panel>

        <div className="stack">
          <ExportsPanel session={session} />

          <Panel title="Reading the table">
            <KeyValues
              items={[
                { label: "Baseline", value: "Shortest-path forwarding" },
                { label: "SWARMNET", value: "Contact-aware forwarding" },
                { label: "Delta", value: "SWARMNET minus baseline" },
                { label: "Zero delta", value: "Reported as no change" },
              ]}
            />
            <p className="tiny muted">
              A delta is arithmetic only. The table does not label a result as a win unless the returned numbers support
              the direction.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ExportsPanel({ session }: ViewProps) {
  const run = session.run;

  return (
    <Panel title="Export active run" subtitle="JSON or CSV for the current run">
      {run ? (
        <>
          <div className="row">
            <a className="btn" href={ApiClient.getExportUrl(run.run_id, "json")} download>
              Download run JSON
            </a>
            <a className="btn" href={ApiClient.getExportUrl(run.run_id, "csv")} download>
              Download run CSV
            </a>
          </div>
          <p className="tiny mono muted truncate" title={run.run_id}>
            {run.run_id}
          </p>
        </>
      ) : (
        <>
          <div className="row">
            <button type="button" className="btn" disabled>
              Download run JSON
            </button>
            <button type="button" className="btn" disabled>
              Download run CSV
            </button>
          </div>
          <p className="tiny muted">Exports become available after a run is initialized.</p>
        </>
      )}
    </Panel>
  );
}

export const ExperimentsView = ({ session }: ViewProps) => <ComparisonBasis session={session} />;