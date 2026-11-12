import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverviewView } from "./OverviewView";
import { makeSession, sampleMetrics, sampleRun, sampleTopology } from "../../test/fixtures";

describe("OverviewView", () => {
  it("presents the scenario brief and starts a run on request", async () => {
    const user = userEvent.setup();
    const initializeRun = vi.fn(async () => undefined);
    render(<OverviewView session={makeSession({ initializeRun })} />);

    expect(screen.getByText("Basic delivery")).toBeInTheDocument();
    expect(screen.getByText("Two satellites and one ground station with a scheduled contact window.")).toBeInTheDocument();
    expect(screen.getByText("Discrete-event, deterministic for this seed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Initialize run" }));
    expect(initializeRun).toHaveBeenCalledTimes(1);
  });

  it("summarises delivery, loss, delay, and run metadata", () => {
    render(
      <OverviewView
        session={makeSession({
          run: sampleRun,
          metrics: sampleMetrics,
          topology: sampleTopology,
          simTime: 30,
        })}
      />,
    );

    expect(screen.getByText("70.0%")).toBeInTheDocument();
    expect(screen.getByText("28 delivered of 40 generated")).toBeInTheDocument();
    expect(screen.getByText("ttl_exceeded 3")).toBeInTheDocument();
    expect(screen.getByText("buffer_full 1")).toBeInTheDocument();
    expect(screen.getByText("12.50s")).toBeInTheDocument();
    expect(screen.getByText("24.25s")).toBeInTheDocument();
    expect(screen.getByText("T+30.0 s of 2m 00s")).toBeInTheDocument();
    expect(screen.getByText("SWARMNET")).toBeInTheDocument();
    expect(screen.getByText("run-1234-abcd")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("shows buffer pressure for the busiest satellites", () => {
    render(
      <OverviewView
        session={makeSession({
          run: sampleRun,
          metrics: sampleMetrics,
          topology: sampleTopology,
        })}
      />,
    );

    expect(screen.getByText("SAT-01")).toBeInTheDocument();
    expect(screen.getByText("2.00 KB / 1.00 KB")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "SAT-01 buffer occupancy" })).toBeInTheDocument();
  });

  it("does not present zero delivery as a failure before packets exist", () => {
    render(
      <OverviewView
        session={makeSession({
          run: sampleRun,
          metrics: { ...sampleMetrics, packets_generated: 0, packets_delivered: 0, delivery_ratio: 0 },
          topology: sampleTopology,
        })}
      />,
    );

    expect(screen.getAllByText("No packets generated yet").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("states that in-process mode has no container agents", () => {
    render(
      <OverviewView
        session={makeSession({ run: sampleRun, metrics: sampleMetrics, topology: sampleTopology })}
      />,
    );
    expect(screen.getByText("No container agents registered")).toBeInTheDocument();
  });
});
