import {
  ChartBar,
  Cube,
  FloppyDisk,
  Path,
  SquaresFour,
  Stack,
} from "@phosphor-icons/react";
import type { ViewKey } from "../types";

export interface ViewDefinition {
  key: ViewKey;
  label: string;
  title: string;
  subtitle: string;
  icon: typeof Cube;
  shortcut: string;
}

export const VIEWS: ViewDefinition[] = [
  {
    key: "overview",
    label: "Overview",
    title: "Run overview",
    subtitle: "Delivery, buffering, and loss for the active simulation run.",
    icon: SquaresFour,
    shortcut: "1",
  },
  {
    key: "constellation",
    label: "Orbit",
    title: "Constellation",
    subtitle: "Schematic 3D view of nodes, contact links, and packets in flight.",
    icon: Cube,
    shortcut: "2",
  },
  {
    key: "packets",
    label: "Packets",
    title: "Packet ledger",
    subtitle: "Every generated packet, its current holder, and its route history.",
    icon: Stack,
    shortcut: "3",
  },
  {
    key: "routing",
    label: "Routing",
    title: "Routing decisions",
    subtitle: "Per-hop decisions with the scores behind each chosen next hop.",
    icon: Path,
    shortcut: "4",
  },
  {
    key: "experiments",
    label: "Compare",
    title: "Policy comparison",
    subtitle: "Run SWARMNET and baseline on one scenario and seed, then export.",
    icon: ChartBar,
    shortcut: "5",
  },
];

export const VIEW_BY_KEY = new Map(VIEWS.map((view) => [view.key, view]));

export const RunGlyph = FloppyDisk;