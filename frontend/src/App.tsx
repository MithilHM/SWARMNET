import React, { useState } from "react";
import { ChartBar, ListBullets, Path, Planet } from "@phosphor-icons/react";
import { SessionProvider, useSession } from "./app/session";
import { ControlBar } from "./components/ControlBar";
import { Notice } from "./components/ui";
import { ConstellationView } from "./features/constellation/ConstellationView";
import { PacketLogsView } from "./features/packet-logs/PacketLogsView";
import { RoutingView } from "./features/routing/RoutingView";
import { ComparisonView } from "./features/comparison/ComparisonView";

type TabKey = "logs" | "routing" | "comparison";

const TABS: Array<{ key: TabKey; label: string; icon: typeof Path }> = [
  { key: "logs", label: "Packet Logs", icon: ListBullets },
  { key: "routing", label: "Routing", icon: Path },
  { key: "comparison", label: "Comparison", icon: ChartBar },
];

function Workbench() {
  const { error, dismissError } = useSession();
  const [tab, setTab] = useState<TabKey>("logs");

  return (
    <div className="shell shell-single">
      <a className="skip-link" href="#run-tabs">
        Skip to run details
      </a>
      <header className="topbar">
        <div className="topbar-title">
          <strong>
            <Planet size={18} weight="duotone" aria-hidden="true" style={{ display: "inline", verticalAlign: "-3px", color: "var(--accent)" }} />{" "}
            SWARMNET
          </strong>
          <span>Delay-tolerant constellation lab · simulation</span>
        </div>
        <ControlBar />
      </header>

      {error ? (
        <div className="workbench-notice">
          <Notice tone="error" title="Request failed">
            <span className="row">
              <span>{error}</span>
              <button type="button" className="btn btn-sm" onClick={dismissError}>
                Dismiss
              </button>
            </span>
          </Notice>
        </div>
      ) : null}

      <main className="workbench">
        <section className="workbench-globe" aria-label="Constellation globe">
          <ConstellationView />
        </section>

        <aside className="panel workbench-tabs" id="run-tabs" aria-label="Run details">
          <div className="tabs" role="tablist" aria-label="Run details">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  id={`tab-${item.key}`}
                  aria-selected={tab === item.key}
                  aria-controls={`tabpanel-${item.key}`}
                  className="tab"
                  onClick={() => setTab(item.key)}
                >
                  <Icon aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="tab-panel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "logs" ? <PacketLogsView /> : tab === "routing" ? <RoutingView /> : <ComparisonView />}
          </div>
        </aside>
      </main>
    </div>
  );
}

export const App: React.FC = () => (
  <SessionProvider>
    <Workbench />
  </SessionProvider>
);

export default App;
