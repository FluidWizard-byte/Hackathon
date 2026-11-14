export interface Point {
  x: number;
  y: number;
}

export type Polygon = readonly Point[];

export interface Zone {
  id: string;
  polygon: Polygon;
}

export interface Worker extends Point {
  id: string;
  active: boolean;
  onShift: boolean;
}

const EPSILON = 1e-9;

function isPointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross =
    (point.x - start.x) * (end.y - start.y) -
    (point.y - start.y) * (end.x - start.x);
  if (Math.abs(cross) > EPSILON) return false;

  return (
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  );
}

export function pointInPolygon(point: Point, polygon: Polygon): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];

    if (isPointOnSegment(point, previousPoint, currentPoint)) return true;

    const crossesScanline =
      (currentPoint.y > point.y) !== (previousPoint.y > point.y);
    if (!crossesScanline) continue;

    const intersectionX =
      ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
        (previousPoint.y - currentPoint.y) +
      currentPoint.x;
    if (point.x < intersectionX) inside = !inside;
  }

  return inside;
}

export function centroid(polygon: Polygon): Point {
  if (polygon.length === 0) return { x: 0, y: 0 };

  let twiceArea = 0;
  let xSum = 0;
  let ySum = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    xSum += (current.x + next.x) * cross;
    ySum += (current.y + next.y) * cross;
  }

  if (Math.abs(twiceArea) <= EPSILON) {
    return {
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
    };
  }

  return {
    x: xSum / (3 * twiceArea),
    y: ySum / (3 * twiceArea),
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function findZoneForPoint(point: Point, zones: readonly Zone[]): Zone | undefined {
  return zones.find((zone) => pointInPolygon(point, zone.polygon));
}

export function nearestWorkers(subject: Worker, workers: readonly Worker[], n: number): Worker[] {
  if (n <= 0) return [];

  return workers
    .filter((worker) => worker.id !== subject.id && worker.active && worker.onShift)
    .map((worker, index) => ({ worker, index, distance: distance(subject, worker) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, n)
    .map(({ worker }) => worker);
}
