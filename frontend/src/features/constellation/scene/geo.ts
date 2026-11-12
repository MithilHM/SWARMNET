import { LAND_RINGS } from "./landData";

export interface RingBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const BOUNDS: RingBounds[] = LAND_RINGS.map((ring) => {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const lon = ring[i];
    const lat = ring[i + 1];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
});

function pointInRing(lon: number, lat: number, ring: readonly number[]): boolean {
  let inside = false;
  const count = ring.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Schematic land test in plate carrée space. Display only, not geodesy. */
export function isLand(lon: number, lat: number): boolean {
  for (let index = 0; index < LAND_RINGS.length; index += 1) {
    const bounds = BOUNDS[index];
    if (lon < bounds.minLon || lon > bounds.maxLon || lat < bounds.minLat || lat > bounds.maxLat) continue;
    if (pointInRing(lon, lat, LAND_RINGS[index])) return true;
  }
  return false;
}

/** Convert spherical coordinates to a point on a sphere of the given radius. */
export function latLonToVector(
  latDeg: number,
  lonDeg: number,
  radius: number,
  target: { x: number; y: number; z: number },
): void {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  target.x = radius * cosLat * Math.cos(lon);
  target.y = radius * Math.sin(lat);
  target.z = -radius * cosLat * Math.sin(lon);
}

export function vectorToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const length = Math.hypot(x, y, z) || 1;
  const lat = (Math.asin(y / length) * 180) / Math.PI;
  const lon = (Math.atan2(-z, x) * 180) / Math.PI;
  return { lat, lon };
}