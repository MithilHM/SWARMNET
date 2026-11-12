import { describe, expect, it } from "vitest";
import { isLand, latLonToVector, vectorToLatLon } from "./geo";

describe("schematic globe geography", () => {
  it("classifies well-known coordinates as land or ocean", () => {
    expect(isLand(0, 0)).toBe(false);
    expect(isLand(-140, 0)).toBe(false);
    expect(isLand(20, 0)).toBe(true);
    expect(isLand(-60, -10)).toBe(true);
    expect(isLand(10, 50)).toBe(true);
    expect(isLand(135, -25)).toBe(true);
  });

  it("places lat/lon on the sphere at the requested radius", () => {
    const point = { x: 0, y: 0, z: 0 };
    latLonToVector(0, 0, 2, point);
    expect(Math.hypot(point.x, point.y, point.z)).toBeCloseTo(2, 5);
    expect(point.x).toBeCloseTo(2, 5);
    expect(point.y).toBeCloseTo(0, 5);

    latLonToVector(90, 0, 1, point);
    expect(point.y).toBeCloseTo(1, 5);
  });

  it("round-trips spherical coordinates", () => {
    const point = { x: 0, y: 0, z: 0 };
    latLonToVector(37.5, -122.25, 1.4, point);
    const { lat, lon } = vectorToLatLon(point.x, point.y, point.z);
    expect(lat).toBeCloseTo(37.5, 4);
    expect(lon).toBeCloseTo(-122.25, 4);
  });
});
