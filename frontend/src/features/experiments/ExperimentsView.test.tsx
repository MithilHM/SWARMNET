import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient } from "../../api/client";
import { ExperimentsView } from "./ExperimentsView";
import { makeSession, sampleComparison, sampleRun } from "../../test/fixtures";

describe("ExperimentsView", () => {
  it("explains what the comparison measures before it runs", () => {
    render(<ExperimentsView session={makeSession()} />);
    expect(screen.getByText("No comparison yet")).toBeInTheDocument();
    expect(screen.getByText("Both policies receive this random seed.")).toBeInTheDocument();
  });

  it("runs both policies and renders the measured deltas", async () => {
    const user = userEvent.setup();
    const compare = vi.spyOn(ApiClient, "comparePolicies").mockResolvedValue(sampleComparison);
    render(<ExperimentsView session={makeSession()} />);

    await user.click(screen.getByRole("button", { name: "Run comparison" }));

    await waitFor(() => expect(screen.getByText("Delivery ratio")).toBeInTheDocument());
    expect(compare).toHaveBeenCalledWith("basic_delivery", 42);
    expect(screen.getByText("Produced for scenario basic_delivery, seed 42.")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("70.0%")).toBeInTheDocument();
    expect(screen.getByText("+20.0%")).toBeInTheDocument();
    expect(screen.getByText("+8")).toBeInTheDocument();
  });

  it("surfaces comparison failures without dropping the form", async () => {
    const user = userEvent.setup();
    vi.spyOn(ApiClient, "comparePolicies").mockRejectedValue(new Error("HTTP 500: comparison exploded"));
    render(<ExperimentsView session={makeSession()} />);

    await user.click(screen.getByRole("button", { name: "Run comparison" }));
    await waitFor(() => expect(screen.getByText("HTTP 500: comparison exploded")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Run comparison" })).toBeEnabled();
  });

  it("links exports for the active run and explains the disabled state otherwise", () => {
    const { unmount } = render(<ExperimentsView session={makeSession({ run: sampleRun })} />);
    const jsonLink = screen.getByRole("link", { name: "Download run JSON" });
    const csvLink = screen.getByRole("link", { name: "Download run CSV" });
    expect(jsonLink).toHaveAttribute("href", expect.stringContaining("format=json"));
    expect(csvLink).toHaveAttribute("href", expect.stringContaining("format=csv"));
    unmount();

    render(<ExperimentsView session={makeSession()} />);
    expect(screen.getByRole("button", { name: "Download run JSON" })).toBeDisabled();
    expect(screen.getByText("Exports become available after a run is initialized.")).toBeInTheDocument();
  });
});
