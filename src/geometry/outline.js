/**
 * Union outline of a set of polygons, without a full boolean library.
 *
 * Every polygon edge is split at its intersections with the other polygons. A
 * resulting piece belongs to the outline of the union exactly when one side of
 * it is inside the union and the other is outside. Interior edges — two abutting
 * wall bodies, a mitred corner shared by two walls — have solid material on both
 * sides and drop out automatically.
 *
 * Deterministic: edges are processed in input order and split parameters are
 * sorted numerically.
 */

import { add, distance, normalize, scale, sub } from './vec.js';
import { segmentIntersection } from './segment.js';
import { containsPoint, edges as polygonEdges } from './polygon.js';

/** @typedef {import('./vec.js').Vec} Vec */
/** @typedef {{a: Vec, b: Vec}} Seg */

/** How far to step sideways when testing which side of an edge is solid. */
const PROBE_MM = 0.05;
/** Pieces shorter than this are dropped as numerical noise. */
const MIN_PIECE_MM = 0.2;

/**
 * @param {Vec[][]} polygons
 * @returns {Seg[]} outline segments in deterministic order
 */
export function unionOutline(polygons) {
  /** @type {Seg[]} */
  const result = [];
  if (polygons.length === 0) return result;

  const allEdges = polygons.map((poly) => polygonEdges(poly));

  for (let pi = 0; pi < polygons.length; pi += 1) {
    for (const edge of allEdges[pi]) {
      const len = distance(edge.a, edge.b);
      if (len < MIN_PIECE_MM) continue;
      const dir = normalize(sub(edge.b, edge.a));
      const normal = { x: -dir.y, y: dir.x };

      /** @type {number[]} */
      const cuts = [0, 1];
      for (let qi = 0; qi < polygons.length; qi += 1) {
        if (qi === pi) continue;
        for (const other of allEdges[qi]) {
          const hit = segmentIntersection(edge, other, { includeEndpoints: true, epsilon: 1e-9 });
          if (hit && hit.t1 > 0 && hit.t1 < 1) cuts.push(hit.t1);
        }
      }
      cuts.sort((a, b) => a - b);

      for (let k = 0; k < cuts.length - 1; k += 1) {
        const t0 = cuts[k];
        const t1 = cuts[k + 1];
        if ((t1 - t0) * len < MIN_PIECE_MM) continue;
        const midT = (t0 + t1) / 2;
        const mid = add(edge.a, scale(sub(edge.b, edge.a), midT));
        const left = add(mid, scale(normal, PROBE_MM));
        const right = sub(mid, scale(normal, PROBE_MM));
        const leftInside = isInsideAny(polygons, left);
        const rightInside = isInsideAny(polygons, right);
        if (leftInside === rightInside) continue; // interior edge or numerical artefact
        result.push({
          a: add(edge.a, scale(sub(edge.b, edge.a), t0)),
          b: add(edge.a, scale(sub(edge.b, edge.a), t1)),
        });
      }
    }
  }

  return mergeCollinear(result);
}

/**
 * @param {Vec[][]} polygons
 * @param {Vec} point
 * @returns {boolean}
 */
function isInsideAny(polygons, point) {
  for (const poly of polygons) {
    if (containsPoint(poly, point)) return true;
  }
  return false;
}

/**
 * Join consecutive collinear pieces so the SVG stays compact and stable.
 * @param {Seg[]} segments
 * @returns {Seg[]}
 */
export function mergeCollinear(segments) {
  /** @type {Seg[]} */
  const out = [];
  for (const seg of segments) {
    const previous = out[out.length - 1];
    if (previous && distance(previous.b, seg.a) < 1e-6 && isCollinear(previous, seg)) {
      out[out.length - 1] = { a: previous.a, b: seg.b };
    } else {
      out.push(seg);
    }
  }
  return out;
}

/**
 * @param {Seg} s1
 * @param {Seg} s2
 * @returns {boolean}
 */
function isCollinear(s1, s2) {
  const d1 = normalize(sub(s1.b, s1.a));
  const d2 = normalize(sub(s2.b, s2.a));
  return Math.abs(d1.x * d2.y - d1.y * d2.x) < 1e-9 && d1.x * d2.x + d1.y * d2.y > 0;
}
