/**
 * Polygon operations for closed, simple polygons.
 *
 * Convention: a polygon is an array of vertices without a repeated closing
 * point. Positive signed area means counter clockwise orientation, which is the
 * normalised form used for spaces (ADR 0006).
 */

import { distance, sub } from './vec.js';
import { segmentIntersection, distanceToSegment } from './segment.js';

/** @typedef {import('./vec.js').Vec} Vec */
/** @typedef {Vec[]} Polygon */

/**
 * Signed area in square millimetres (shoelace). Positive = counter clockwise.
 * @param {Polygon} poly
 * @returns {number}
 */
export function signedArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * @param {Polygon} poly
 * @returns {number} absolute area in mm²
 */
export function area(poly) {
  return Math.abs(signedArea(poly));
}

/**
 * @param {Polygon} poly
 * @returns {boolean}
 */
export function isCounterClockwise(poly) {
  return signedArea(poly) > 0;
}

/**
 * Return the polygon in counter clockwise orientation.
 * @param {Polygon} poly
 * @returns {Polygon}
 */
export function normalizeOrientation(poly) {
  return isCounterClockwise(poly) ? poly : [...poly].reverse();
}

/**
 * @param {Polygon} poly
 * @returns {number} perimeter in mm
 */
export function perimeter(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    sum += distance(poly[i], poly[(i + 1) % poly.length]);
  }
  return sum;
}

/**
 * Area weighted centroid. For degenerate (zero area) polygons the vertex average
 * is returned so callers always get a usable point.
 * @param {Polygon} poly
 * @returns {Vec}
 */
export function centroid(poly) {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const sum = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / poly.length, y: sum.y / poly.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/**
 * Point in polygon test (ray casting), boundary counts as inside.
 * @param {Polygon} poly
 * @param {Vec} point
 * @param {number} [boundaryTolerance]
 * @returns {boolean}
 */
export function containsPoint(poly, point, boundaryTolerance = 0) {
  if (boundaryTolerance > 0) {
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (distanceToSegment({ a, b }, point) <= boundaryTolerance) return true;
    }
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const pi = poly[i];
    const pj = poly[j];
    const intersects = (pi.y > point.y) !== (pj.y > point.y)
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Strict interior test: on the boundary counts as outside.
 * Used by the wall contour clipper, where boundary-coincident edges must survive.
 * @param {Polygon} poly
 * @param {Vec} point
 * @param {number} [edgeTolerance]
 * @returns {boolean}
 */
export function containsPointStrict(poly, point, edgeTolerance = 0.001) {
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (distanceToSegment({ a, b }, point) <= edgeTolerance) return false;
  }
  return containsPoint(poly, point);
}

/**
 * @param {Polygon} poly
 * @returns {{min: Vec, max: Vec, width: number, height: number}}
 */
export function bounds(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY }, width: maxX - minX, height: maxY - minY };
}

/**
 * Detect self intersection. Adjacent edges are allowed to share their endpoint;
 * any other crossing or overlap makes the polygon invalid.
 * @param {Polygon} poly
 * @returns {{selfIntersects: boolean, at?: Vec, edges?: [number, number]}}
 */
export function checkSimple(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const s1 = { a: poly[i], b: poly[(i + 1) % n] };
    for (let j = i + 1; j < n; j += 1) {
      if (j === i) continue;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const s2 = { a: poly[j], b: poly[(j + 1) % n] };
      const hit = segmentIntersection(s1, s2, { includeEndpoints: !adjacent, epsilon: 1e-7 });
      if (hit) return { selfIntersects: true, at: hit.point, edges: [i, j] };
    }
  }
  return { selfIntersects: false };
}

/**
 * Remove consecutive duplicate and collinear vertices.
 * @param {Polygon} poly
 * @param {number} [tolerance]
 * @returns {Polygon}
 */
export function simplify(poly, tolerance = 0.5) {
  /** @type {Polygon} */
  const deduped = [];
  for (const p of poly) {
    const last = deduped[deduped.length - 1];
    if (!last || distance(last, p) > tolerance) deduped.push(p);
  }
  if (deduped.length > 1 && distance(deduped[0], deduped[deduped.length - 1]) <= tolerance) deduped.pop();
  if (deduped.length < 3) return deduped;

  /** @type {Polygon} */
  const out = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const prev = deduped[(i - 1 + deduped.length) % deduped.length];
    const cur = deduped[i];
    const next = deduped[(i + 1) % deduped.length];
    const d1 = sub(cur, prev);
    const d2 = sub(next, cur);
    const crossValue = d1.x * d2.y - d1.y * d2.x;
    const scaleValue = Math.max(1, Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y));
    if (Math.abs(crossValue) / scaleValue > tolerance / 1000) out.push(cur);
  }
  return out.length >= 3 ? out : deduped;
}

/**
 * Do two polygons overlap with more than a negligible area?
 *
 * Uses a sampling-free test: polygons overlap if any edge pair properly
 * intersects, or if one polygon's vertex lies strictly inside the other.
 * Sufficient for validation of simple room polygons; it is a detector, not a
 * boolean operation.
 * @param {Polygon} a
 * @param {Polygon} b
 * @returns {boolean}
 */
export function polygonsOverlap(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    const s1 = { a: a[i], b: a[(i + 1) % a.length] };
    for (let j = 0; j < b.length; j += 1) {
      const s2 = { a: b[j], b: b[(j + 1) % b.length] };
      if (segmentIntersection(s1, s2, { includeEndpoints: false, epsilon: 1e-7 })) return true;
    }
  }
  return a.some((p) => containsPointStrict(b, p, 0.5)) || b.some((p) => containsPointStrict(a, p, 0.5));
}

/**
 * A point well inside the polygon, suitable for placing a label.
 *
 * Grid based pole of inaccessibility: the sample point with the largest distance
 * to the boundary. Deterministic (fixed grid, fixed iteration order) and good
 * enough for L shaped rooms where the centroid can fall outside.
 * @param {Polygon} poly
 * @param {number} [resolution] samples per axis
 * @returns {Vec}
 */
export function labelPoint(poly, resolution = 24) {
  const c = centroid(poly);
  if (containsPoint(poly, c)) {
    const box = bounds(poly);
    // The centroid is fine unless the polygon is strongly non convex.
    const minEdge = minDistanceToBoundary(poly, c);
    if (minEdge > Math.min(box.width, box.height) * 0.12) return c;
  }
  const box = bounds(poly);
  /** @type {Vec} */
  let best = c;
  let bestDistance = -Infinity;
  for (let i = 0; i <= resolution; i += 1) {
    for (let j = 0; j <= resolution; j += 1) {
      const p = {
        x: box.min.x + (box.width * i) / resolution,
        y: box.min.y + (box.height * j) / resolution,
      };
      if (!containsPoint(poly, p)) continue;
      const d = minDistanceToBoundary(poly, p);
      if (d > bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * @param {Polygon} poly
 * @param {Vec} point
 * @returns {number}
 */
export function minDistanceToBoundary(poly, point) {
  let min = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const d = distanceToSegment({ a: poly[i], b: poly[(i + 1) % poly.length] }, point);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Edges of a polygon as segments, in vertex order.
 * @param {Polygon} poly
 * @returns {Array<{a: Vec, b: Vec}>}
 */
export function edges(poly) {
  return poly.map((p, i) => ({ a: p, b: poly[(i + 1) % poly.length] }));
}

/**
 * Clip an infinite line (given by two points) to the inside of a polygon.
 * Used for hatching and for stair step lines.
 *
 * @param {Polygon} poly
 * @param {Vec} a
 * @param {Vec} b
 * @returns {Array<{a: Vec, b: Vec}>} the pieces inside the polygon, ordered along a->b
 */
export function clipLineToPolygon(poly, a, b) {
  const direction = { x: b.x - a.x, y: b.y - a.y };
  const lengthSq = direction.x * direction.x + direction.y * direction.y;
  if (lengthSq === 0) return [];

  /** @type {number[]} */
  const params = [];
  const long = 1e6 / Math.sqrt(lengthSq);
  const far = { a: { x: a.x - direction.x * long, y: a.y - direction.y * long },
    b: { x: a.x + direction.x * long, y: a.y + direction.y * long } };

  for (let i = 0; i < poly.length; i += 1) {
    const edge = { a: poly[i], b: poly[(i + 1) % poly.length] };
    const hit = segmentIntersection(far, edge, { includeEndpoints: true, epsilon: 1e-9 });
    if (!hit) continue;
    const point = hit.point;
    params.push(((point.x - a.x) * direction.x + (point.y - a.y) * direction.y) / lengthSq);
  }
  if (params.length < 2) return [];
  params.sort((x, y) => x - y);

  /** @type {Array<{a: Vec, b: Vec}>} */
  const pieces = [];
  for (let i = 0; i < params.length - 1; i += 1) {
    const t0 = params[i];
    const t1 = params[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const midT = (t0 + t1) / 2;
    const mid = { x: a.x + direction.x * midT, y: a.y + direction.y * midT };
    if (!containsPoint(poly, mid)) continue;
    pieces.push({
      a: { x: a.x + direction.x * t0, y: a.y + direction.y * t0 },
      b: { x: a.x + direction.x * t1, y: a.y + direction.y * t1 },
    });
  }
  return pieces;
}

/**
 * Axis aligned rectangle as a counter clockwise polygon.
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Polygon}
 */
export function rectangle(x, y, width, height) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}
