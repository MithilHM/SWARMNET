import { describe, expect, it } from "vitest";
import { initialSessionState, sessionReducer } from "./sessionStore";
import { evt, idleState, resolvedEvents, resolvedState, snapshotOf } from "../test/fixtures";

describe("sessionReducer", () => {
  it("replaces everything on a snapshot", () => {
    const events = resolvedEvents();
    const next = sessionReducer(initialSessionState, {
      type: "stream",
      message: { type: "snapshot", reason: "connect", state: snapshotOf(resolvedState(), events) },
      at: 5,
    });
    expect(next.connection).toBe("live");
    expect(next.state?.phase).toBe("RESOLVED");
    expect(next.scenario?.scenario_id).toBe("SCN-TEST0001");
    expect(next.events).toHaveLength(events.length);
    expect(next.receivedAt).toBe(5);
  });

  it("appends only new events from frames, in order", () => {
    const events = resolvedEvents().slice(0, 3);
    let store = sessionReducer(initialSessionState, {
      type: "stream",
      message: { type: "snapshot", reason: "play", state: snapshotOf(resolvedState(), events) },
      at: 1,
    });
    const extra = evt({ status: "sent", packet_id: "PKT-X" });
    store = sessionReducer(store, {
      type: "stream",
      message: { type: "frame", state: resolvedState(), events: [events[2], extra] },
      at: 2,
    });
    expect(store.events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq), extra.seq]);
  });

  it("reset snapshot wipes the previous run for every view", () => {
    let store = sessionReducer(initialSessionState, {
      type: "stream",
      message: { type: "snapshot", reason: "play", state: snapshotOf(resolvedState(), resolvedEvents()) },
      at: 1,
    });
    store = sessionReducer(store, {
      type: "stream",
      message: { type: "snapshot", reason: "reset", state: snapshotOf(idleState(), []) },
      at: 2,
    });
    expect(store.state?.phase).toBe("IDLE");
    expect(store.state?.anomaly).toBeNull();
    expect(store.state?.comparison).toBeNull();
    expect(store.events).toEqual([]);
  });
});
