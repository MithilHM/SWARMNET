import { useMemo, useState } from "react";
import { Chip, EmptyState, KeyValues, Panel } from "../../components/ui";
import type { SimulationSession } from "../../app/useSimulationSession";
import type { CandidateScoreBreakdown, RouteDecision } from "../../types";
import { DECISION_LABEL, decisionTone, policyLabel } from "../../lib/status";

type DecisionFilter = "all" | RouteDecision["decision"];

const FILTERS: Array<{ key: DecisionFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "forward", label: "Forward" },
  { key: "buffer", label: "Buffer" },
  { key: "drop", label: "Drop" },
];

const DECISION_ORDER: Record<RouteDecision["decision"], number> = {
  forward: 0,
  drop: 1,
  buffer: 2,
};

const MAX_ROWS = 80;

interface NormalizedCandidate {
  id: string;
  total: number | null;
  progress: number | null;
  reliability: number | null;
  contact: number | null;
  latencyPenalty: number | null;
  congestionPenalty: number | null;
  energyPenalty: number | null;
  linkAvailable: boolean | null;
}

function stamp(seconds: number): string {
  return `T+${seconds.toFixed(1)}s`;
}

function normalizeCandidate(id: string, value: CandidateScoreBreakdown | number): NormalizedCandidate {
  if (typeof value === "number") {
    return {
      id,
      total: value,
      progress: null,
      reliability: null,
      contact: null,
      latencyPenalty: null,
      congestionPenalty: null,
      energyPenalty: null,
      linkAvailable: null,
    };
  }
  return {
    id,
    total: value.total_score ?? null,
    progress: value.progress_score ?? null,
    reliability: value.reliability_score ?? null,
    contact: value.contact_score ?? null,
    latencyPenalty: value.latency_penalty ?? null,
    congestionPenalty: value.congestion_penalty ?? null,
    energyPenalty: value.energy_penalty ?? null,
    linkAvailable: value.link_available ?? null,
  };
}

function scoreText(value: number | null, penalty = false): string {
  if (value == null) return "n/a";
  return (penalty ? Math.abs(value) : value).toFixed(3);
}

function ScoreCell({
  label,
  value,
  penalty = false,
}: {
  label: string;
  value: number | null;
  penalty?: boolean;
}) {
  return (
    <div className="stack-sm" style={{ gap: 0 }}>
      <span className="tiny muted">{label}</span>
      <span className="mono tiny">{scoreText(value, penalty)}</span>
    </div>
  );
}

export function RoutingView({ session }: { session: SimulationSession }) {
  const { decisions, run } = session;
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const next: Record<DecisionFilter, number> = { all: decisions.length, forward: 0, buffer: 0, drop: 0 };
    for (const decision of decisions) next[decision.decision] += 1;
    return next;
  }, [decisions]);

  const sorted = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = decisions.filter((decision) => {
      if (decisionFilter !== "all" && decision.decision !== decisionFilter) return false;
      if (!needle) return true;
      return [
        decision.satellite_id,
        decision.packet_id,
        decision.reason_code,
        decision.routing_policy,
        decision.chosen_next_hop_id ?? "",
      ].some((value) => value.toLowerCase().includes(needle));
    });
    return filtered.sort((a, b) => {
      const timeDelta = b.decision_time - a.decision_time;
      if (Math.abs(timeDelta) > 1e-9) return timeDelta;
      const orderDelta = DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision];
      if (orderDelta !== 0) return orderDelta;
      return a.decision_id.localeCompare(b.decision_id);
    });
  }, [decisions, decisionFilter, query]);

  const visible = sorted.slice(0, MAX_ROWS);
  const selected = useMemo(
    () => decisions.find((decision) => decision.decision_id === selectedId) ?? null,
    [decisions, selectedId],
  );

  if (!run) {
    return (
      <Panel title="Decisions" subtitle="Routing decision ledger">
        <EmptyState
          title="No run initialized"
          body="Initialize a run from the top bar to load routing decisions. Decisions appear once satellites start evaluating neighbors and forwarding packets."
        />
      </Panel>
    );
  }

  const clearFilters = () => {
    setDecisionFilter("all");
    setQuery("");
  };

  const footerNote =
    sorted.length > MAX_ROWS
      ? `Showing the ${MAX_ROWS} most recent of ${sorted.length} matching decisions (${decisions.length} total in this run).`
      : `${sorted.length} matching of ${decisions.length} total decisions. Newest first.`;

  return (
    <div className={selected ? "split" : undefined}>
      <Panel
        title="Decisions"
        subtitle={`${visible.length} of ${sorted.length} matching decisions`}
        footer={footerNote}
      >
        <div className="spread">
          <div className="filters" role="group" aria-label="Filter decisions by action">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="filter-btn"
                aria-pressed={decisionFilter === item.key}
                onClick={() => setDecisionFilter(item.key)}
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
              aria-label="Search decisions"
              placeholder="Satellite, packet, reason, policy, or next hop"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        {visible.length === 0 ? (
          decisions.length === 0 ? (
            <EmptyState
              title="No routing decisions yet"
              body="The API has not returned any routing decisions for this run. Step the simulation so satellites can evaluate neighbors and forward packets."
            />
          ) : (
            <EmptyState
              title="No decisions match"
              body="No decision matches this action filter and search. Clear the filters to see the full ledger."
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
                  <th>Time</th>
                  <th>Satellite</th>
                  <th>Packet</th>
                  <th>Decision</th>
                  <th>Next hop</th>
                  <th>Reason</th>
                  <th>Policy</th>
                  <th>Candidates</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((decision) => {
                  const candidateCount = Object.keys(decision.candidate_scores ?? {}).length;
                  return (
                    <tr
                      key={decision.decision_id}
                      data-clickable="true"
                      data-selected={decision.decision_id === selectedId}
                      onClick={() => setSelectedId(decision.decision_id)}
                    >
                      <td className="cell-num">{stamp(decision.decision_time)}</td>
                      <td className="cell-strong">{decision.satellite_id}</td>
                      <td className="cell-mono">{decision.packet_id}</td>
                      <td>
                        <Chip tone={decisionTone(decision.decision)}>
                          {DECISION_LABEL[decision.decision]}
                        </Chip>
                      </td>
                      <td>
                        {decision.chosen_next_hop_id ? (
                          <span className="mono">{decision.chosen_next_hop_id}</span>
                        ) : (
                          <span className="muted">held in buffer</span>
                        )}
                      </td>
                      <td className="cell-mono">{decision.reason_code}</td>
                      <td className="tiny">{policyLabel(decision.routing_policy)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(decision.decision_id);
                          }}
                        >
                          {candidateCount} candidates
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
        <DecisionInspector decision={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}

function DecisionInspector({ decision, onClose }: { decision: RouteDecision; onClose: () => void }) {
  const candidates = useMemo(() => {
    const scores: Record<string, CandidateScoreBreakdown | number> = decision.candidate_scores ?? {};
    return Object.entries(scores)
      .map(([id, value]) => normalizeCandidate(id, value))
      .sort((a, b) => {
        if (a.total == null && b.total == null) return a.id.localeCompare(b.id);
        if (a.total == null) return 1;
        if (b.total == null) return -1;
        if (b.total !== a.total) return b.total - a.total;
        return a.id.localeCompare(b.id);
      });
  }, [decision]);

  return (
    <Panel
      title={decision.decision_id}
      subtitle="Decision detail"
      actions={
        <button type="button" className="btn btn-sm btn-quiet" onClick={onClose}>
          Close
        </button>
      }
      footer="Scores are unitless. Higher total score wins and penalties subtract from the total."
    >
      <div className="spread">
        <Chip tone={decisionTone(decision.decision)}>{DECISION_LABEL[decision.decision]}</Chip>
        <span className="mono tiny">{stamp(decision.decision_time)}</span>
      </div>

      <KeyValues
        items={[
          { label: "Action", value: DECISION_LABEL[decision.decision] },
          {
            label: "Next hop",
            value: decision.chosen_next_hop_id ? (
              <span className="mono">{decision.chosen_next_hop_id}</span>
            ) : (
              "Held in buffer"
            ),
          },
          { label: "Reason", value: <span className="mono">{decision.reason_code}</span> },
          { label: "Policy", value: policyLabel(decision.routing_policy) },
          { label: "Packet", value: <span className="mono">{decision.packet_id}</span> },
          { label: "Satellite", value: <span className="mono">{decision.satellite_id}</span> },
        ]}
      />

      {decision.explanation ? (
        <div className="stack-sm">
          <h3 className="panel-title">Explanation</h3>
          <p className="tiny">{decision.explanation}</p>
        </div>
      ) : null}

      <div className="stack-sm">
        <div className="spread">
          <h3 className="panel-title">Candidate scores</h3>
          <span className="badge-count">{candidates.length} candidates</span>
        </div>
        <p className="tiny muted">
          Higher total score wins. Penalties are shown as positive magnitudes and are subtracted from the score.
        </p>

        {candidates.length === 0 ? (
          <p className="tiny muted">No candidate scores were recorded for this decision.</p>
        ) : (
          <ul className="stack-sm">
            {candidates.map((candidate) => {
              const chosen = candidate.id === decision.chosen_next_hop_id;
              const hasBreakdown =
                candidate.progress != null ||
                candidate.reliability != null ||
                candidate.contact != null ||
                candidate.latencyPenalty != null ||
                candidate.congestionPenalty != null ||
                candidate.energyPenalty != null;

              return (
                <li
                  key={candidate.id}
                  className="surface-sunken stack-sm"
                  style={{ padding: "var(--space-2)" }}
                >
                  <div className="spread">
                    <span className="row-tight">
                      <span className="mono">{candidate.id}</span>
                      {chosen ? <Chip tone="active">Chosen</Chip> : null}
                      {candidate.linkAvailable === false ? (
                        <span className="tiny muted">link unavailable</span>
                      ) : null}
                    </span>
                    <span className="mono tiny">total {scoreText(candidate.total)}</span>
                  </div>

                  {hasBreakdown ? (
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" }}
                    >
                      <ScoreCell label="Progress" value={candidate.progress} />
                      <ScoreCell label="Reliability" value={candidate.reliability} />
                      <ScoreCell label="Contact" value={candidate.contact} />
                      <ScoreCell label="Latency penalty" value={candidate.latencyPenalty} penalty />
                      <ScoreCell label="Congestion penalty" value={candidate.congestionPenalty} penalty />
                      <ScoreCell label="Energy penalty" value={candidate.energyPenalty} penalty />
                    </div>
                  ) : (
                    <p className="tiny muted">Score reported as a single value.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}