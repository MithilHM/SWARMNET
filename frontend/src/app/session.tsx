import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { ApiClient } from "../api/client";
import type { StreamMessage } from "../types";
import { initialSessionState, sessionReducer, type PendingAction, type SessionStoreState } from "./sessionStore";

export interface SessionApi extends SessionStoreState {
  play: () => Promise<void>;
  solve: () => Promise<void>;
  sever: (satelliteId: string) => Promise<void>;
  reset: () => Promise<void>;
  dismissError: () => void;
}

const SessionContext = createContext<SessionApi | null>(null);

/**
 * Owns the single EventSource for the backend session. Every view reads from
 * this one store, so the globe, Packet Logs, Routing, and Comparison always
 * describe the same run.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [store, dispatch] = useReducer(sessionReducer, initialSessionState);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      dispatch({ type: "connection", connection: "offline" });
      return;
    }
    const source = new EventSource(ApiClient.streamUrl);
    source.onmessage = (event) => {
      try {
        dispatch({ type: "stream", message: JSON.parse(event.data as string) as StreamMessage, at: performance.now() });
      } catch {
        // malformed frame: the next snapshot (sent on reconnect) restores state
      }
    };
    source.onerror = () => dispatch({ type: "connection", connection: "offline" });
    source.onopen = () => dispatch({ type: "connection", connection: "live" });
    return () => source.close();
  }, []);

  const run = useCallback(async (pending: PendingAction, action: () => Promise<unknown>) => {
    dispatch({ type: "pending", pending });
    dispatch({ type: "error", error: null });
    try {
      await action();
    } catch (err) {
      dispatch({ type: "error", error: err instanceof Error ? err.message : "Request failed." });
    } finally {
      dispatch({ type: "pending", pending: null });
    }
  }, []);

  const api = useMemo<SessionApi>(
    () => ({
      ...store,
      play: () => run("play", () => ApiClient.play()),
      solve: () => run("solve", () => ApiClient.solve()),
      sever: (satelliteId: string) => run("sever", () => ApiClient.sever(satelliteId)),
      reset: () => run("reset", () => ApiClient.reset()),
      dismissError: () => dispatch({ type: "error", error: null }),
    }),
    [run, store],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>.");
  return value;
}

/** Test helper: provide a fixed session value without a backend. */
export function SessionTestProvider({ value, children }: { value: SessionApi; children: React.ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
