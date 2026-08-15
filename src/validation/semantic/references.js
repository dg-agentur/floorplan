/**
 * Referential integrity: ids, cross references, numeric sanity.
 * These are the rules that stay fatal at every quality level.
 */

import { ELEMENT_COLLECTIONS } from '../../model/constants.js';
import { levelElements } from '../../model/document.js';

/** @typedef {import('../context.js').ValidationContext} ValidationContext */

/**
 * @param {ValidationContext} ctx
 */
export function checkReferences(ctx) {
  const { doc, index } = ctx;

  // --- unique ids ----------------------------------------------------------
  for (const id of [...new Set(index.duplicateIds)].sort()) {
    ctx.report({
      rule: 'DUPLICATE_ID',
      element_id: id,
      message: `The id "${id}" is used by more than one element.`,
      hint: 'Ids must be unique across the whole document, including levels and buildings.',
    });
  }

  const sourceIds = new Set((doc.sources ?? []).map((s) => s.id));

  for (const { level, building } of ctx.levels) {
    // --- openings must sit on a wall of the same level ----------------------
    for (const opening of level.openings ?? []) {
      const ref = index.get(opening.host_wall_id);
      if (!ref || ref.element.type !== 'wall') {
        ctx.report({
          rule: 'UNKNOWN_HOST_WALL',
          element_id: opening.id,
          level_id: level.id,
          message: `Opening "${opening.id}" references host_wall_id "${opening.host_wall_id}", which is not an existing wall.`,
          hint: 'Every opening must be hosted by a wall (docs/adr/0005-opening-hosting.md).',
        });
      } else if (ref.level.id !== level.id) {
        ctx.report({
          rule: 'HOST_WALL_OTHER_LEVEL',
          element_id: opening.id,
          level_id: level.id,
          message: `Opening "${opening.id}" is on level "${level.id}" but its host wall "${opening.host_wall_id}" is on level "${ref.level.id}".`,
        });
      }

      for (const spaceId of opening.connects_space_ids ?? []) {
        const spaceRef = index.get(spaceId);
        if (!spaceRef || spaceRef.element.type !== 'space') {
          ctx.report({
            rule: 'UNKNOWN_SPACE_REF',
            element_id: opening.id,
            level_id: level.id,
            message: `Opening "${opening.id}" references space "${spaceId}", which does not exist.`,
          });
        }
      }
    }

    // --- stairs referencing other levels ------------------------------------
    for (const stair of level.stairs ?? []) {
      if (stair.to_level_id && !index.levels.has(stair.to_level_id)) {
        ctx.report({
          rule: 'UNKNOWN_LEVEL_REF',
          element_id: stair.id,
          level_id: level.id,
          message: `Stair "${stair.id}" references level "${stair.to_level_id}", which does not exist.`,
        });
      }
    }

    // --- source references ---------------------------------------------------
    for (const element of levelElements(level)) {
      const sourceId = /** @type {any} */ (element).source_id;
      if (sourceId && !sourceIds.has(sourceId)) {
        ctx.report({
          rule: 'UNKNOWN_SOURCE_REF',
          element_id: element.id,
          level_id: level.id,
          message: `Element "${element.id}" references source "${sourceId}", which is not listed in document.sources.`,
          hint: 'Add the source to the top level "sources" array so provenance stays traceable.',
        });
      }
      const propertyProvenance = /** @type {any} */ (element).property_provenance;
      for (const [property, entry] of Object.entries(propertyProvenance ?? {})) {
        const entrySource = /** @type {any} */ (entry).source_id;
        if (entrySource && !sourceIds.has(entrySource)) {
          ctx.report({
            rule: 'UNKNOWN_SOURCE_REF',
            element_id: element.id,
            level_id: level.id,
            message: `Element "${element.id}" references source "${entrySource}" for property "${property}", which is not listed in document.sources.`,
          });
        }
      }
    }

    // --- empty level ---------------------------------------------------------
    const elementCount = ELEMENT_COLLECTIONS.reduce(
      (sum, collection) => sum + (/** @type {any} */ (level)[collection]?.length ?? 0),
      0,
    );
    if (elementCount === 0) {
      ctx.report({
        rule: 'EMPTY_LEVEL',
        element_id: level.id,
        level_id: level.id,
        message: `Level "${level.id}" ("${level.name}") of building "${building.id}" contains no elements.`,
      });
    }
  }

  // --- duplicate level index within a building --------------------------------
  for (const building of doc.buildings ?? []) {
    /** @type {Map<number, string[]>} */
    const byIndex = new Map();
    for (const level of building.levels ?? []) {
      const list = byIndex.get(level.index);
      if (list) list.push(level.id);
      else byIndex.set(level.index, [level.id]);
    }
    for (const [levelIndex, ids] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
      if (ids.length > 1) {
        ctx.report({
          rule: 'LEVEL_INDEX_DUPLICATE',
          element_id: building.id,
          message: `Building "${building.id}" has ${ids.length} levels with index ${levelIndex}: ${ids.join(', ')}.`,
        });
      }
    }
  }

  // --- non finite numbers -------------------------------------------------------
  // JSON cannot express NaN or Infinity, but a document built through the API can.
  checkFinite(ctx, doc, '');
}

/**
 * @param {ValidationContext} ctx
 * @param {unknown} node
 * @param {string} pointer
 * @param {{count: number}} [state]
 */
function checkFinite(ctx, node, pointer, state = { count: 0 }) {
  if (state.count > 20) return;
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) {
      state.count += 1;
      ctx.report({
        rule: 'NON_FINITE_NUMBER',
        pointer: pointer || '/',
        message: `Value at ${pointer || '/'} is ${String(node)}, which is not a finite number.`,
      });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => checkFinite(ctx, item, `${pointer}/${i}`, state));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      checkFinite(ctx, value, `${pointer}/${key}`, state);
    }
  }
}
