import type { DynamicState, ScenarioInfo, SimEvent, StreamMessage } from "../types";

export type Connection = "connecting" | "live" | "offline";
export type PendingAction = null | "play" | "solve" | "sever" | "reset";

export interface SessionStoreState {
  connection: Connection;
  state: DynamicState | null;
  scenario: ScenarioInfo | null;
  events: SimEvent[];
  /** performance.now() when the latest state arrived; drives globe interpolation. */
  receivedAt: number;
  pending: PendingAction;
  error: string | null;
}

export const initialSessionState: SessionStoreState = {
  connection: "connecting",
  state: null,
  scenario: null,
  events: [],
  receivedAt: 0,
  pending: null,
  error: null,
};

export type SessionAction =
  | { type: "stream"; message: StreamMessage; at: number }
  | { type: "connection"; connection: Connection }
  | { type: "pending"; pending: PendingAction }
  | { type: "error"; error: string | null };

/**
 * One reducer for every view. Snapshots replace everything (play, reset,
 * reconnect); frames replace the dynamic state and append new events.
 */
export function sessionReducer(current: SessionStoreState, action: SessionAction): SessionStoreState {
  switch (action.type) {
    case "connection":
      return { ...current, connection: action.connection };
    case "pending":
      return { ...current, pending: action.pending };
    case "error":
      return { ...current, error: action.error };
    case "stream": {
      const message = action.message;
      if (message.type === "error") return { ...current, error: message.message };
      if (message.type === "snapshot") {
        const { scenario, events, ...dynamic } = message.state;
        return {
          ...current,
          connection: "live",
          state: dynamic,
          scenario,
          events: [...events],
          receivedAt: action.at,
        };
      }
      // frame
      if (current.state && message.state.run_id !== current.state.run_id) {
        // A frame from a different run can only mean we missed a snapshot; keep the
        // dynamic state so the globe stays truthful, and drop stale history.
        return { ...current, state: message.state, events: [...message.events], receivedAt: action.at };
      }
      const lastSeq = current.events.length ? current.events[current.events.length - 1].seq : 0;
      const fresh = message.events.filter((event) => event.seq > lastSeq);
      return {
        ...current,
        connection: "live",
        state: message.state,
        events: fresh.length ? [...current.events, ...fresh] : current.events,
        receivedAt: action.at,
      };
    }
    default:
      return current;
  }
}
