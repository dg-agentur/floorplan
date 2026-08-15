/**
 * Line and segment operations.
 * All inputs are {x, y} in millimetres.
 */

import { add, cross, dot, distance, length, normalize, scale, sub } from './vec.js';
import { TOLERANCE_MM } from '../model/constants.js';

/** @typedef {import('./vec.js').Vec} Vec */
/** @typedef {{a: Vec, b: Vec}} Segment */

/**
 * @param {Vec} a
 * @param {Vec} b
 * @returns {Segment}
 */
export function segment(a, b) {
  return { a, b };
}

/**
 * @param {Segment} s
 * @returns {Vec}
 */
export function direction(s) {
  return normalize(sub(s.b, s.a));
}

/**
 * @param {Segment} s
 * @returns {number}
 */
export function segmentLength(s) {
  return distance(s.a, s.b);
}

/**
 * Point at a distance along the segment, measured from a.
 * @param {Segment} s
 * @param {number} dist
 * @returns {Vec}
 */
export function pointAt(s, dist) {
  return add(s.a, scale(direction(s), dist));
}

/**
 * Orthogonal projection of a point onto the infinite line through the segment.
 * @param {Segment} s
 * @param {Vec} p
 * @returns {{point: Vec, t: number, distance: number}} t is the parameter along a->b in [0,1] for points inside
 */
export function projectPoint(s, p) {
  const ab = sub(s.b, s.a);
  const lenSq = dot(ab, ab);
  if (lenSq === 0) return { point: s.a, t: 0, distance: distance(p, s.a) };
  const t = dot(sub(p, s.a), ab) / lenSq;
  const point = add(s.a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}

/**
 * Distance from a point to the segment (not the infinite line).
 * @param {Segment} s
 * @param {Vec} p
 * @returns {number}
 */
export function distanceToSegment(s, p) {
  const { t } = projectPoint(s, p);
  const clamped = Math.max(0, Math.min(1, t));
  return distance(p, add(s.a, scale(sub(s.b, s.a), clamped)));
}

/**
 * @param {Segment} s
 * @param {Vec} p
 * @param {number} [tolerance]
 * @returns {boolean}
 */
export function isPointOnSegment(s, p, tolerance = TOLERANCE_MM) {
  return distanceToSegment(s, p) <= tolerance;
}

/**
 * Signed perpendicular distance from the infinite line through s to p.
 * Positive means p lies to the left of a->b.
 * @param {Segment} s
 * @param {Vec} p
 * @returns {number}
 */
export function signedDistanceToLine(s, p) {
  const ab = sub(s.b, s.a);
  const len = length(ab);
  if (len === 0) return distance(p, s.a);
  return cross(ab, sub(p, s.a)) / len;
}

/**
 * Intersection of two infinite lines.
 * @param {Segment} s1
 * @param {Segment} s2
 * @returns {Vec|null} null when parallel
 */
export function lineIntersection(s1, s2) {
  const d1 = sub(s1.b, s1.a);
  const d2 = sub(s2.b, s2.a);
  const denominator = cross(d1, d2);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = cross(sub(s2.a, s1.a), d2) / denominator;
  return add(s1.a, scale(d1, t));
}

/**
 * Intersection of two finite segments.
 * @param {Segment} s1
 * @param {Segment} s2
 * @param {{includeEndpoints?: boolean, epsilon?: number}} [options]
 * @returns {{point: Vec, t1: number, t2: number}|null}
 */
export function segmentIntersection(s1, s2, options = {}) {
  const epsilon = options.epsilon ?? 1e-9;
  const includeEndpoints = options.includeEndpoints ?? true;
  const d1 = sub(s1.b, s1.a);
  const d2 = sub(s2.b, s2.a);
  const denominator = cross(d1, d2);
  if (Math.abs(denominator) < epsilon) return null;
  const t1 = cross(sub(s2.a, s1.a), d2) / denominator;
  const t2 = cross(sub(s2.a, s1.a), d1) / denominator;
  const lo = includeEndpoints ? -epsilon : epsilon;
  const hi = includeEndpoints ? 1 + epsilon : 1 - epsilon;
  if (t1 < lo || t1 > hi || t2 < lo || t2 > hi) return null;
  return { point: add(s1.a, scale(d1, t1)), t1, t2 };
}

/**
 * Are two segments parallel within an angular tolerance?
 * @param {Segment} s1
 * @param {Segment} s2
 * @param {number} [toleranceDeg]
 * @returns {boolean}
 */
export function areParallel(s1, s2, toleranceDeg = 0.5) {
  const d1 = direction(s1);
  const d2 = direction(s2);
  const sin = Math.abs(cross(d1, d2));
  return sin <= Math.sin((toleranceDeg * Math.PI) / 180);
}

/**
 * Are two segments collinear (parallel and on the same infinite line)?
 * @param {Segment} s1
 * @param {Segment} s2
 * @param {number} [distanceTolerance]
 * @param {number} [angleTolerance]
 * @returns {boolean}
 */
export function areCollinear(s1, s2, distanceTolerance = TOLERANCE_MM, angleTolerance = 0.5) {
  if (!areParallel(s1, s2, angleTolerance)) return false;
  return Math.abs(signedDistanceToLine(s1, s2.a)) <= distanceTolerance
    && Math.abs(signedDistanceToLine(s1, s2.b)) <= distanceTolerance;
}

/**
 * Offset a segment sideways by a distance. Positive offsets move to the left of a->b.
 * @param {Segment} s
 * @param {number} offset
 * @returns {Segment}
 */
export function offsetSegment(s, offset) {
  const d = direction(s);
  const normal = { x: -d.y, y: d.x };
  const delta = scale(normal, offset);
  return { a: add(s.a, delta), b: add(s.b, delta) };
}
