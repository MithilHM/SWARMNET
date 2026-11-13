import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ControlBar } from "./ControlBar";
import { SessionTestProvider } from "../app/session";
import { idleState, resolvedState, sessionApi } from "../test/fixtures";

describe("ControlBar", () => {
  it("offers only Play, Reset and Sever Link in IDLE (no Solve, no playback controls)", () => {
    render(
      <SessionTestProvider value={sessionApi({ state: idleState(), events: [] })}>
        <ControlBar />
      </SessionTestProvider>,
    );
    expect(screen.getByRole("button", { name: /play/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /reset/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /sever link/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /solve/i })).toBeNull();
    for (const removed of [/pause/i, /speed/i, /shuffle/i, /\+1s/i, /\+5s/i, /step/i]) {
      expect(screen.queryByRole("button", { name: removed })).toBeNull();
      expect(screen.queryByLabelText(removed)).toBeNull();
    }
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows Solve only when the backend reports an anomaly", async () => {
    const solve = vi.fn(async () => undefined);
    const detected = { ...resolvedState(), phase: "DETECTED" as const, controls: { play: false, solve: true, sever: false, reset: true } };
    render(
      <SessionTestProvider value={sessionApi({ state: detected, solve })}>
        <ControlBar />
      </SessionTestProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /solve/i }));
    expect(solve).toHaveBeenCalledOnce();
  });

  it("severs the selected satellite while the run is live", async () => {
    const sever = vi.fn(async () => undefined);
    const stable = { ...idleState(), run_id: "RUN-1", phase: "STABLE" as const, controls: { play: false, solve: false, sever: true, reset: true } };
    render(
      <SessionTestProvider value={sessionApi({ state: stable, sever })}>
        <ControlBar />
      </SessionTestProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText(/satellite to sever/i), "SAT-03");
    await userEvent.click(screen.getByRole("button", { name: /sever link/i }));
    expect(sever).toHaveBeenCalledWith("SAT-03");
  });
});
