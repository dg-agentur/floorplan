/**
 * Bounding box computation for viewport and layout purposes.
 */

import { add, fromModel, leftNormal, normalize, scale, sub } from './vec.js';
import { wallLength, pointOnWall } from './wallGeometry.js';

/** @typedef {import('./vec.js').Vec} Vec */
/** @typedef {import('../model/types.js').Level} Level */

/**
 * @typedef {object} Bounds
 * @property {number} min_x_mm
 * @property {number} min_y_mm
 * @property {number} max_x_mm
 * @property {number} max_y_mm
 * @property {number} width_mm
 * @property {number} height_mm
 * @property {boolean} empty
 */

/**
 * @returns {{min_x: number, min_y: number, max_x: number, max_y: number, count: number}}
 */
function emptyAccumulator() {
  return { min_x: Infinity, min_y: Infinity, max_x: -Infinity, max_y: -Infinity, count: 0 };
}

/**
 * @param {{min_x: number, min_y: number, max_x: number, max_y: number, count: number}} acc
 * @param {Vec} p
 */
function include(acc, p) {
  if (p.x < acc.min_x) acc.min_x = p.x;
  if (p.y < acc.min_y) acc.min_y = p.y;
  if (p.x > acc.max_x) acc.max_x = p.x;
  if (p.y > acc.max_y) acc.max_y = p.y;
  acc.count += 1;
}

/**
 * Bounding box of everything drawable on a level, including wall thickness.
 * @param {Level} level
 * @returns {Bounds}
 */
export function levelBounds(level) {
  const acc = emptyAccumulator();

  for (const wall of level.walls ?? []) {
    const half = wall.thickness_mm / 2;
    const len = wallLength(wall);
    for (const dist of [0, len]) {
      for (const side of [half, -half]) include(acc, pointOnWall(wall, dist, side));
    }
  }
  for (const space of level.spaces ?? []) {
    for (const point of space.boundary ?? []) include(acc, fromModel(point));
  }
  for (const stair of level.stairs ?? []) {
    for (const point of stair.footprint ?? []) include(acc, fromModel(point));
  }
  for (const shaft of level.shafts ?? []) {
    for (const point of shaft.boundary ?? []) include(acc, fromModel(point));
  }
  for (const column of level.columns ?? []) {
    const radius = column.shape === 'circle'
      ? (column.diameter_mm ?? 0) / 2
      : Math.max(column.width_mm ?? 0, column.depth_mm ?? 0) / 2;
    const c = fromModel(column.center);
    include(acc, { x: c.x - radius, y: c.y - radius });
    include(acc, { x: c.x + radius, y: c.y + radius });
  }
  for (const dimension of level.dimensions ?? []) {
    // The visible dimension line sits at the perpendicular offset, not on the
    // measured points, so the offset position is what has to fit into the view.
    const start = fromModel(dimension.start);
    const end = fromModel(dimension.end);
    include(acc, start);
    include(acc, end);
    const offset = dimension.offset_mm ?? 0;
    if (offset !== 0) {
      const direction = normalize(sub(end, start));
      const shift = scale(leftNormal(direction), offset);
      include(acc, add(start, shift));
      include(acc, add(end, shift));
    }
  }
  for (const annotation of level.annotations ?? []) {
    include(acc, fromModel(annotation.position));
  }

  if (acc.count === 0) {
    return { min_x_mm: 0, min_y_mm: 0, max_x_mm: 0, max_y_mm: 0, width_mm: 0, height_mm: 0, empty: true };
  }
  return {
    min_x_mm: acc.min_x,
    min_y_mm: acc.min_y,
    max_x_mm: acc.max_x,
    max_y_mm: acc.max_y,
    width_mm: acc.max_x - acc.min_x,
    height_mm: acc.max_y - acc.min_y,
    empty: false,
  };
}

/**
 * @param {Bounds} bounds
 * @param {number} margin
 * @returns {Bounds}
 */
export function expandBounds(bounds, margin) {
  if (bounds.empty) return bounds;
  return {
    min_x_mm: bounds.min_x_mm - margin,
    min_y_mm: bounds.min_y_mm - margin,
    max_x_mm: bounds.max_x_mm + margin,
    max_y_mm: bounds.max_y_mm + margin,
    width_mm: bounds.width_mm + 2 * margin,
    height_mm: bounds.height_mm + 2 * margin,
    empty: false,
  };
}
