import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PacketsView } from "./PacketsView";
import { makeSession, samplePackets, sampleRun } from "../../test/fixtures";

describe("PacketsView", () => {
  it("asks for a run before showing the ledger", () => {
    render(<PacketsView session={makeSession()} />);
    expect(screen.getByText("No run initialized")).toBeInTheDocument();
  });

  it("renders every packet with status counts", () => {
    render(
      <PacketsView
        session={makeSession({
          run: sampleRun,
          simTime: 30,
          packets: samplePackets,
        })}
      />,
    );

    expect(screen.getByText("3 of 3 packets shown")).toBeInTheDocument();
    expect(screen.getByText("PKT-0001")).toBeInTheDocument();
    expect(screen.getByText("PKT-0002")).toBeInTheDocument();
    expect(screen.getByText("PKT-0003")).toBeInTheDocument();

    const allFilter = screen.getByRole("button", { name: /^All\s*3$/ });
    expect(allFilter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Delivered\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Dropped\s*1$/ })).toBeInTheDocument();
  });

  it("filters by status and search, then restores the full ledger", async () => {
    const user = userEvent.setup();
    render(
      <PacketsView session={makeSession({ run: sampleRun, simTime: 30, packets: samplePackets })} />,
    );

    await user.click(screen.getByRole("button", { name: /^Buffered\s*1$/ }));
    expect(screen.getByText("PKT-0002")).toBeInTheDocument();
    expect(screen.queryByText("PKT-0001")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^All\s*3$/ }));
    await user.type(screen.getByLabelText("Search packets"), "sat-02");
    expect(screen.queryByText("PKT-0001")).not.toBeInTheDocument();
    expect(screen.getByText("PKT-0002")).toBeInTheDocument();
    expect(screen.queryByText("PKT-0003")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search packets"));
    await user.type(screen.getByLabelText("Search packets"), "no-such-packet");
    expect(screen.getByText("No packets match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("3 of 3 packets shown")).toBeInTheDocument();
  });

  it("opens the hop-by-hop inspector for a selected packet", async () => {
    const user = userEvent.setup();
    render(
      <PacketsView session={makeSession({ run: sampleRun, simTime: 30, packets: samplePackets })} />,
    );

    const row = screen.getByText("PKT-0001").closest("tr");
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Inspect" }));

    expect(screen.getByText("Route history")).toBeInTheDocument();
    expect(screen.getByText("Delivery delay")).toBeInTheDocument();
    expect(screen.getByText(/Arrived T\+18\.0s/)).toBeInTheDocument();
    expect(screen.getByText("Visited nodes")).toBeInTheDocument();
    expect(screen.getByText("link L-SAT01-SAT02")).toBeInTheDocument();
  });

  it("shows the drop reason for failed packets", async () => {
    const user = userEvent.setup();
    render(
      <PacketsView session={makeSession({ run: sampleRun, simTime: 30, packets: samplePackets })} />,
    );

    const row = screen.getByText("PKT-0003").closest("tr");
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Inspect" }));
    expect(screen.getByText("Drop reason")).toBeInTheDocument();
    expect(screen.getByText("buffer_full")).toBeInTheDocument();
  });
});
