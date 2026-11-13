import type { LinkState, PacketLogStatus, Phase, PhaseTag, Protocol } from "../types";

export type Tone = "active" | "degraded" | "down" | "critical" | "muted";

export const PHASES: Phase[] = ["IDLE", "STABLE", "DEGRADING", "DETECTED", "SOLVING", "RESOLVED"];

export const PHASE_LABEL: Record<Phase, string> = {
  IDLE: "Idle",
  STABLE: "Stable",
  DEGRADING: "Degrading",
  DETECTED: "Detected · paused",
  SOLVING: "Solving · DTN",
  RESOLVED: "Resolved",
};

export function phaseTone(phase: Phase): Tone {
  switch (phase) {
    case "STABLE":
    case "RESOLVED":
    case "SOLVING":
      return "active";
    case "DEGRADING":
      return "degraded";
    case "DETECTED":
      return "critical";
    default:
      return "muted";
  }
}

export const TAG_LABEL: Record<PhaseTag, string> = {
  idle: "idle",
  stable: "stable",
  degrading: "degrading",
  detected: "detected",
  dtn: "DTN",
};

export function tagTone(tag: PhaseTag): Tone {
  return tag === "stable" || tag === "dtn" ? "active" : tag === "degrading" ? "degraded" : tag === "detected" ? "critical" : "muted";
}

export const STATUS_LABEL: Record<PacketLogStatus, string> = {
  sent: "Sent",
  lost: "Lost",
  stored: "Stored",
  forwarded: "Forwarded",
  delivered: "Delivered",
};

export function statusTone(status: PacketLogStatus): Tone {
  switch (status) {
    case "delivered":
      return "active";
    case "lost":
      return "critical";
    case "stored":
      return "degraded";
    default:
      return "muted";
  }
}

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  direct: "Direct-to-ground",
  dtn: "DTN store-carry-forward",
};

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  active: "Active",
  degraded: "Degraded",
  down: "Unavailable",
};

export function linkStateTone(state: LinkState): Tone {
  return state === "active" ? "active" : state === "degraded" ? "degraded" : "down";
}
