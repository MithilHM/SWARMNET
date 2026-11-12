import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoutingView } from "./RoutingView";
import { makeSession, sampleDecisions, sampleRun } from "../../test/fixtures";

describe("RoutingView", () => {
  it("asks for a run before showing decisions", () => {
    render(<RoutingView session={makeSession()} />);
    expect(screen.getByText("No run initialized")).toBeInTheDocument();
  });

  it("orders decisions newest first with stable tie breaks", () => {
    render(<RoutingView session={makeSession({ run: sampleRun, decisions: sampleDecisions })} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("PKT-0002")).toBeInTheDocument();
    expect(within(rows[1]).getByText("PKT-0003")).toBeInTheDocument();
    expect(within(rows[2]).getByText("PKT-0001")).toBeInTheDocument();
  });

  it("filters decisions by action and search", async () => {
    const user = userEvent.setup();
    render(<RoutingView session={makeSession({ run: sampleRun, decisions: sampleDecisions })} />);

    expect(screen.getByRole("button", { name: /^Forward\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Drop\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Buffer\s*0$/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Drop\s*1$/ }));
    expect(screen.getByText("buffer_full")).toBeInTheDocument();
    expect(screen.queryByText("PKT-0002")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^All\s*3$/ }));
    await user.type(screen.getByLabelText("Search decisions"), "pkt-0002");
    expect(screen.getByText("PKT-0002")).toBeInTheDocument();
    expect(screen.queryByText("PKT-0001")).not.toBeInTheDocument();
  });

  it("explains candidate scores and marks the chosen next hop", async () => {
    const user = userEvent.setup();
    render(<RoutingView session={makeSession({ run: sampleRun, decisions: sampleDecisions })} />);

    const row = screen.getByText("PKT-0002").closest("tr");
    await user.click(within(row as HTMLElement).getByRole("button", { name: /candidates/ }));

    expect(screen.getByText("Candidate scores")).toBeInTheDocument();
    expect(screen.getByText("Chosen")).toBeInTheDocument();
    expect(screen.getByText("Latency penalty")).toBeInTheDocument();
    expect(screen.getByText("0.120")).toBeInTheDocument();
    expect(screen.getByText("Score reported as a single value.")).toBeInTheDocument();
    expect(screen.getByText("GROUND-01 offers the strongest contact window.")).toBeInTheDocument();
  });

  it("reports when no decisions exist yet", () => {
    render(<RoutingView session={makeSession({ run: sampleRun, decisions: [] })} />);
    expect(screen.getByText("No routing decisions yet")).toBeInTheDocument();
  });
});
