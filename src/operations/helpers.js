/**
 * Shared helpers for operation implementations.
 *
 * Two kinds of inverse operations are used (docs/adr/0009-operations-and-history.md):
 *  - a *natural* inverse when it is exact and readable (move_opening by -delta)
 *  - a *snapshot* inverse (set_element / restore_element / delete_element) when the
 *    forward operation touches several elements or is not cleanly invertible.
 *
 * Snapshot inverses are always exact, which is what matters; natural inverses are
 * used only where they are equally exact and much easier to read in the history.
 */

import { deepClone } from '../util/json.js';
import { OperationError } from '../util/errors.js';
import { collectionForType, ensureCollection, resolveLevel } from '../model/document.js';

/** @typedef {import('../model/types.js').FloorplanDocument} FloorplanDocument */
/** @typedef {import('../model/types.js').Level} Level */

/**
 * @typedef {object} OperationContext
 * @property {FloorplanDocument} doc            the working copy, mutated in place
 * @property {import('../model/document.js').DocumentIndex} index
 * @property {{next: (type: string, explicit?: string) => string, taken: Set<string>}} ids
 * @property {() => void} reindex
 * @property {() => Level} defaultLevel  the level a command works on when none is given
 */

/**
 * @typedef {object} OperationResult
 * @property {string} summary
 * @property {string[]} affected_ids
 * @property {Record<string, unknown>[]} inverse
 */

/**
 * @param {OperationContext} ctx
 * @param {string} [levelId]
 * @returns {Level}
 */
export function levelOf(ctx, levelId) {
  return resolveLevel(ctx.doc, levelId);
}

/**
 * The level that contains a given element.
 * @param {OperationContext} ctx
 * @param {string} elementId
 * @returns {Level}
 */
export function levelContaining(ctx, elementId) {
  return ctx.index.require(elementId).level;
}

/**
 * @template T
 * @param {T} element
 * @returns {T}
 */
export function snapshot(element) {
  return deepClone(element);
}

/**
 * Inverse operation that puts an element back exactly as it was.
 * @param {string} levelId
 * @param {unknown} element
 * @returns {Record<string, unknown>}
 */
export function setElementOp(levelId, element) {
  return { op: 'set_element', level_id: levelId, element: snapshot(element) };
}

/**
 * @param {string} levelId
 * @param {unknown} element
 * @param {number} [index]
 * @returns {Record<string, unknown>}
 */
export function restoreElementOp(levelId, element, index) {
  const operation = /** @type {Record<string, unknown>} */ ({
    op: 'restore_element',
    level_id: levelId,
    element: snapshot(element),
  });
  if (index !== undefined) operation.at_index = index;
  return operation;
}

/**
 * @param {string} id
 * @returns {Record<string, unknown>}
 */
export function deleteElementOp(id) {
  return { op: 'delete_element', target_id: id };
}

/**
 * Insert an element into the correct collection of a level.
 * @param {Level} level
 * @param {any} element
 * @param {number} [atIndex]
 */
export function insertElement(level, element, atIndex) {
  const collection = ensureCollection(level, collectionForType(element.type));
  if (atIndex === undefined || atIndex < 0 || atIndex > collection.length) {
    collection.push(element);
  } else {
    collection.splice(atIndex, 0, element);
  }
}

/**
 * Remove an element by id from its level.
 * @param {OperationContext} ctx
 * @param {string} id
 * @returns {{element: any, level: Level, collection: string, index: number}}
 */
export function removeElement(ctx, id) {
  const ref = ctx.index.require(id);
  const list = /** @type {any[]} */ (/** @type {any} */ (ref.level)[ref.collection]);
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) {
    throw new OperationError('ELEMENT_NOT_FOUND', `Element "${id}" is indexed but not present in its collection.`);
  }
  const [element] = list.splice(index, 1);
  // An empty collection carries no information and would survive an undo as a
  // stray "annotations": [] that the original document never had.
  if (list.length === 0) delete (/** @type {any} */ (ref.level))[ref.collection];
  ctx.reindex();
  return { element, level: ref.level, collection: ref.collection, index };
}

/**
 * Reject values that are not whole millimetres. The model is integer only
 * (docs/adr/0002-units-and-coordinates.md); silently rounding an agent's input
 * would hide a mistake.
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
export function requireIntegerMm(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new OperationError('NON_INTEGER_MM', `${name} must be a whole number of millimetres (got ${String(value)}).`, {
      hint: 'The model stores integer millimetres. Round the value yourself so the rounding is your decision, not ours.',
    });
  }
  return value;
}

/**
 * @param {any} point
 * @param {string} name
 * @returns {{x_mm: number, y_mm: number}}
 */
export function requirePoint(point, name) {
  if (!point || typeof point !== 'object') {
    throw new OperationError('INVALID_POINT', `${name} must be an object with x_mm and y_mm.`);
  }
  return { x_mm: requireIntegerMm(point.x_mm, `${name}.x_mm`), y_mm: requireIntegerMm(point.y_mm, `${name}.y_mm`) };
}

/**
 * Copy the optional common fields an operation may set on a new element.
 * Keeps the create_* operations free of repetitive plumbing.
 * @param {any} target
 * @param {any} operation
 * @param {string[]} fields
 */
export function applyOptionalFields(target, operation, fields) {
  for (const field of fields) {
    if (operation[field] !== undefined) target[field] = operation[field];
  }
}

/**
 * Human readable label for messages.
 * @param {any} element
 * @returns {string}
 */
export function label(element) {
  return element?.name ? `"${element.id}" (${element.name})` : `"${element?.id}"`;
}
