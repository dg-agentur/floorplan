/**
 * Derived quantities. Nothing here is ever stored in the model — it is always
 * recomputed, so it cannot contradict the geometry.
 *
 * Naming discipline: what we compute from a space polygon is the geometric
 * FLOOR AREA. It is deliberately not called "Wohnfläche" / living area, because
 * that is a regulated calculation (WoFlV, DIN 277) that needs information the
 * 2.5D model does not carry. See docs/adr/0003-25d-model.md.
 */

import { area as polygonArea, perimeter as polygonPerimeter } from '../geometry/polygon.js';
import { fromModel } from '../geometry/vec.js';
import { wallLength } from '../geometry/wallGeometry.js';
import { AREA_TOLERANCE_RATIO } from './constants.js';

/** @typedef {import('../model/types.js').Space} Space */
/** @typedef {import('../model/types.js').Level} Level */

/**
 * @param {Space} space
 * @returns {number} floor area in mm²
 */
export function spaceAreaMm2(space) {
  return polygonArea((space.boundary ?? []).map(fromModel));
}

/**
 * @param {Space} space
 * @returns {number} perimeter in mm
 */
export function spacePerimeterMm(space) {
  return polygonPerimeter((space.boundary ?? []).map(fromModel));
}

/**
 * @param {number} mm2
 * @returns {number} area in m², rounded to 4 decimals to stay deterministic
 */
export function toSquareMetres(mm2) {
  return Math.round((mm2 / 1_000_000) * 10000) / 10000;
}

/**
 * Compare a declared area override with the polygon area.
 * @param {Space} space
 * @returns {{matches: boolean, computed_mm2: number, declared_mm2: number, deviation_ratio: number}|null}
 */
export function checkAreaOverride(space) {
  if (space.area_override_mm2 === undefined) return null;
  const computed = spaceAreaMm2(space);
  const declared = space.area_override_mm2;
  const deviation = computed === 0 ? 1 : Math.abs(computed - declared) / computed;
  return {
    matches: deviation <= AREA_TOLERANCE_RATIO,
    computed_mm2: Math.round(computed),
    declared_mm2: declared,
    deviation_ratio: Math.round(deviation * 10000) / 10000,
  };
}

/**
 * Totals for a level. `total_floor_area_mm2` sums the space polygons and
 * therefore excludes wall footprints by construction.
 * @param {Level} level
 * @returns {{space_count: number, wall_count: number, opening_count: number,
 *   total_floor_area_mm2: number, total_wall_length_mm: number}}
 */
export function levelMetrics(level) {
  const spaces = level.spaces ?? [];
  const walls = level.walls ?? [];
  return {
    space_count: spaces.length,
    wall_count: walls.length,
    opening_count: (level.openings ?? []).length,
    total_floor_area_mm2: Math.round(spaces.reduce((sum, s) => sum + spaceAreaMm2(s), 0)),
    total_wall_length_mm: Math.round(walls.reduce((sum, w) => sum + wallLength(w), 0)),
  };
}
