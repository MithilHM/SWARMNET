import * as THREE from "three";
import { GLOBE_RADIUS } from "./globe";
import { latLonToVector } from "./geo";
import { nodeOrdinal } from "../../../lib/format";

export interface OrbitElement {
  nodeId: string;
  radius: number;
  inclination: number;
  nodeLongitude: number;
  phase: number;
  rate: number;
}

export interface AnchorElement {
  nodeId: string;
  lat: number;
  lon: number;
}

export interface ConstellationLayout {
  satellites: Map<string, OrbitElement>;
  anchors: Map<string, AnchorElement>;
  seed: number;
}

function hashSeed(seed: number, value: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic schematic placement. Real scenarios carry only abstract x/y
 * coordinates, so orbital planes and phases are derived from the run seed.
 */
export function buildLayout(
  seed: number,
  satelliteIds: string[],
  groundStationIds: string[],
  positions: Map<string, { x: number; y: number }>,
): ConstellationLayout {
  const satellites = new Map<string, OrbitElement>();
  const anchors = new Map<string, AnchorElement>();

  satelliteIds.forEach((nodeId, index) => {
    const random = mulberry32(hashSeed(seed, nodeId));
    const ordinal = nodeOrdinal(nodeId);
    const hinted = positions.get(nodeId);
    // Abstract scenario y is used only as a stable hint for the orbital plane.
    const planeHint = hinted ? (hinted.y % 180) / 180 : index / Math.max(1, satelliteIds.length);
    const radius = 1.16 + random() * 0.2 + (ordinal ? ((ordinal - 1) % 3) * 0.04 : 0);
    const inclination = THREE.MathUtils.degToRad(-62 + planeHint * 124 + (random() - 0.5) * 16);
    const nodeLongitude = random() * Math.PI * 2;
    const phase = random() * Math.PI * 2;
    const rate = 0.16 + random() * 0.12;

    satellites.set(nodeId, { nodeId, radius, inclination, nodeLongitude, phase, rate });
  });

  groundStationIds.forEach((nodeId, index) => {
    const random = mulberry32(hashSeed(seed, `${nodeId}-ground`));
    const hinted = positions.get(nodeId);
    const lat = hinted ? THREE.MathUtils.clamp((hinted.y % 120) - 60, -58, 58) : -46 + random() * 92;
    const lon = hinted ? ((hinted.x * 1.7) % 360) - 180 : -180 + ((index * 47 + random() * 40) % 360);
    anchors.set(nodeId, { nodeId, lat, lon });
  });

  return { satellites, anchors, seed };
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const tiltAxis = new THREE.Vector3(1, 0, 0);
const spinAxis = new THREE.Vector3(0, 1, 0);

/** Position on a circular, inclined orbit at simulation time t. */
export function orbitPosition(element: OrbitElement, time: number, target: THREE.Vector3): THREE.Vector3 {
  const angle = element.phase + element.rate * time;
  scratchA.set(Math.cos(angle) * element.radius, 0, Math.sin(angle) * element.radius);
  quaternion.setFromAxisAngle(tiltAxis, element.inclination);
  scratchA.applyQuaternion(quaternion);
  quaternion.setFromAxisAngle(spinAxis, element.nodeLongitude);
  scratchA.applyQuaternion(quaternion);
  return target.copy(scratchA);
}

/** Full ring for the orbit path, for the guide layer. */
export function orbitRingPoints(element: OrbitElement, segments = 160): Float32Array {
  const points = new Float32Array((segments + 1) * 3);
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    scratchB.set(Math.cos(angle) * element.radius, 0, Math.sin(angle) * element.radius);
    quaternion.setFromAxisAngle(tiltAxis, element.inclination);
    scratchB.applyQuaternion(quaternion);
    quaternion.setFromAxisAngle(spinAxis, element.nodeLongitude);
    scratchB.applyQuaternion(quaternion);
    points[index * 3] = scratchB.x;
    points[index * 3 + 1] = scratchB.y;
    points[index * 3 + 2] = scratchB.z;
  }
  return points;
}

export function anchorPosition(anchor: AnchorElement, target: THREE.Vector3): THREE.Vector3 {
  const scratch = { x: 0, y: 0, z: 0 };
  latLonToVector(anchor.lat, anchor.lon, GLOBE_RADIUS * 1.012, scratch);
  return target.set(scratch.x, scratch.y, scratch.z);
}

/** Arc between two points, bowed away from the globe centre. */
export function arcCurve(from: THREE.Vector3, to: THREE.Vector3, lift = 0.16): THREE.QuadraticBezierCurve3 {
  const distance = from.distanceTo(to);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const bulge = 1 + lift + Math.min(0.42, distance * 0.16);
  mid.normalize().multiplyScalar(GLOBE_RADIUS * bulge);
  return new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone());
}