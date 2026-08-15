/**
 * Architectural plausibility.
 *
 * Explicitly separated from geometric validity and from legal admissibility
 * (ARCHITECTURE.md section 11). Everything in this file is a hint based on
 * common practice — never a normative or legal statement. All findings are INFO
 * at every quality level, and the ranges live in one table so a future rule
 * module can replace them with sourced values.
 */

import { wallLength } from '../../geometry/wallGeometry.js';

/** @typedef {import('../context.js').ValidationContext} ValidationContext */

/**
 * Usual ranges observed in residential construction. These are conventions,
 * not requirements, and carry no regulatory meaning.
 */
export const USUAL_RANGES = {
  door_width_mm: { min: 600, max: 1300 },
  double_door_width_mm: { min: 1200, max: 2600 },
  garage_door_width_mm: { min: 2200, max: 6000 },
  passage_width_mm: { min: 600, max: 4000 },
  wall_thickness_mm: { min: 60, max: 800 },
};

/**
 * @param {ValidationContext} ctx
 */
export function checkPlausibility(ctx) {
  for (const { level } of ctx.levels) {
    for (const wall of level.walls ?? []) {
      const range = USUAL_RANGES.wall_thickness_mm;
      if (wall.thickness_mm < range.min || wall.thickness_mm > range.max) {
        ctx.report({
          rule: 'WALL_THICKNESS_UNUSUAL',
          element_id: wall.id,
          level_id: level.id,
          message: `Wall "${wall.id}" is ${wall.thickness_mm} mm thick, outside the usual range of ${range.min}..${range.max} mm.`,
          data: { thickness_mm: wall.thickness_mm, usual_min_mm: range.min, usual_max_mm: range.max },
          hint: 'Common practice only — not a requirement.',
        });
      }
      if (wallLength(wall) > 0 && wall.thickness_mm > wallLength(wall)) {
        ctx.report({
          rule: 'WALL_THICKNESS_UNUSUAL',
          element_id: wall.id,
          level_id: level.id,
          message: `Wall "${wall.id}" is thicker (${wall.thickness_mm} mm) than it is long (${Math.round(wallLength(wall))} mm).`,
        });
      }
    }

    for (const opening of level.openings ?? []) {
      const range = rangeForOpening(opening);
      if (!range) continue;
      if (opening.width_mm < range.min || opening.width_mm > range.max) {
        ctx.report({
          rule: 'DOOR_WIDTH_UNUSUAL',
          element_id: opening.id,
          level_id: level.id,
          message: `${opening.type === 'passage' ? 'Passage' : 'Door'} "${opening.id}" is ${opening.width_mm} mm wide, outside the usual range of ${range.min}..${range.max} mm.`,
          data: { width_mm: opening.width_mm, usual_min_mm: range.min, usual_max_mm: range.max },
          hint: 'Common practice only — not a requirement.',
        });
      }
    }

    for (const space of level.spaces ?? []) {
      if (!space.category) {
        ctx.report({
          rule: 'SPACE_WITHOUT_CATEGORY',
          element_id: space.id,
          level_id: level.id,
          message: `Space "${space.id}" ("${space.name}") has no category, so themes and later rule modules cannot classify it.`,
        });
      }
    }
  }
}

/**
 * @param {import('../../model/types.js').Opening} opening
 * @returns {{min: number, max: number}|null}
 */
function rangeForOpening(opening) {
  if (opening.type === 'passage') return USUAL_RANGES.passage_width_mm;
  if (opening.type !== 'door') return null;
  if (opening.door_type === 'garage') return USUAL_RANGES.garage_door_width_mm;
  if (opening.door_type === 'double') return USUAL_RANGES.double_door_width_mm;
  return USUAL_RANGES.door_width_mm;
}
