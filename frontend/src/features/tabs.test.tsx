import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionTestProvider } from "../app/session";
import { PacketLogsView } from "./packet-logs/PacketLogsView";
import { RoutingView } from "./routing/RoutingView";
import { ComparisonView } from "./comparison/ComparisonView";
import { idleState, sessionApi } from "../test/fixtures";

function withSession(node: React.ReactNode, overrides = {}) {
  return render(<SessionTestProvider value={sessionApi(overrides)}>{node}</SessionTestProvider>);
}

describe("Packet Logs", () => {
  it("lists backend events with lost rows in red and DTN deliveries highlighted", () => {
    withSession(<PacketLogsView />);
    const rows = screen.getAllByRole("row");
    const lost = rows.find((row) => row.getAttribute("data-tone") === "lost" && within(row).queryByText("Lost"));
    const dtn = rows.find((row) => row.getAttribute("data-tone") === "dtn" && within(row).queryByText("Delivered"));
    expect(lost).toBeTruthy();
    expect(dtn).toBeTruthy();
    expect(within(dtn!).getByText("SAT-03")).toBeInTheDocument();
  });

  it("filters by status and by phase", async () => {
    withSession(<PacketLogsView />);
    await userEvent.click(screen.getByRole("button", { name: "Lost" }));
    const body = screen.getAllByRole("rowgroup")[1];
    expect(within(body).getAllByRole("row")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "All statuses" }));
    await userEvent.click(screen.getByRole("button", { name: "DTN" }));
    for (const row of within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row")) {
      expect(within(row).getByText("DTN")).toBeInTheDocument();
    }
  });

  it("is empty before a run", () => {
    withSession(<PacketLogsView />, { state: idleState(), events: [] });
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });
});

describe("Routing", () => {
  it("shows the affected satellite's old and new path and the chosen relay", () => {
    withSession(<RoutingView />);
    expect(screen.getByText(/SAT-02: old path vs new path/i)).toBeInTheDocument();
    expect(screen.getAllByText("SAT-02 → GROUND-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SAT-02 → SAT-03 → GROUND-01").length).toBeGreaterThan(0);
    expect(screen.getByText("SAT-03 ✓")).toBeInTheDocument();
  });
});

describe("Comparison", () => {
  it("compares direct-only against DTN from the backend numbers", () => {
    withSession(<ComparisonView />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Direct-to-ground only")).toBeInTheDocument();
    expect(within(table).getByText("With DTN")).toBeInTheDocument();
    expect(within(table).getByText("50%")).toBeInTheDocument();
    expect(within(table).getByText("100%")).toBeInTheDocument();
    expect(within(table).getByText("2 / 2")).toBeInTheDocument();
  });

  it("waits for an anomaly before comparing", () => {
    withSession(<ComparisonView />, { state: idleState(), events: [] });
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });
});
