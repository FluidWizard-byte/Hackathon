import { describe, expect, it } from "vitest";
import {
  centroid,
  distance,
  findZoneForPoint,
  nearestWorkers,
  pointInPolygon,
  type Point,
  type Worker,
} from "./geometry";

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("geometry", () => {
  it("treats points on polygon edges as inside", () => {
    expect(pointInPolygon({ x: 5, y: 0 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, square)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 5 }, square)).toBe(false);
  });

  it("handles concave polygons", () => {
    const concave: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 6, y: 10 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ];

    expect(pointInPolygon({ x: 3, y: 2 }, concave)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 7 }, concave)).toBe(false);
  });

  it("calculates polygon centroids and distances", () => {
    expect(centroid(square)).toEqual({ x: 5, y: 5 });
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("finds the first zone containing a point", () => {
    const zones = [
      { id: "outside", polygon: square },
      { id: "inside", polygon: [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }] },
    ];

    expect(findZoneForPoint({ x: 5, y: 5 }, zones)?.id).toBe("outside");
    expect(findZoneForPoint({ x: 20, y: 20 }, zones)).toBeUndefined();
  });

  it("excludes the subject, inactive and off-shift workers", () => {
    const subject: Worker = { id: "subject", x: 0, y: 0, active: true, onShift: true };
    const workers: Worker[] = [
      subject,
      { id: "inactive", x: 1, y: 0, active: false, onShift: true },
      { id: "off-shift", x: 2, y: 0, active: true, onShift: false },
      { id: "near", x: 3, y: 0, active: true, onShift: true },
    ];

    expect(nearestWorkers(subject, workers, 10).map((worker) => worker.id)).toEqual(["near"]);
  });

  it("preserves input order for ties and returns fewer than n workers", () => {
    const subject: Worker = { id: "subject", x: 0, y: 0, active: true, onShift: true };
    const workers: Worker[] = [
      { id: "first", x: 1, y: 0, active: true, onShift: true },
      { id: "second", x: 0, y: 1, active: true, onShift: true },
    ];

    expect(nearestWorkers(subject, workers, 5).map((worker) => worker.id)).toEqual(["first", "second"]);
  });
});
