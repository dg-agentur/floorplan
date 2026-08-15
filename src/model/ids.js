/**
 * Deterministic identifier generation (docs/adr/0007-identifiers.md).
 *
 * No UUIDs, no timestamps, no randomness: the same document plus the same
 * operations always produce the same ids.
 *
 * Ids referenced anywhere in the document — including the history, whose inverse
 * operations may resurrect deleted elements — are treated as taken.
 */

import { TYPE_TO_ID_PREFIX } from './constants.js';
import { DomainError } from '../util/errors.js';

const ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/**
 * @param {string} id
 * @param {string} [what]
 */
export function assertValidId(id, what = 'id') {
  if (!isValidId(id)) {
    throw new DomainError('INVALID_ID', `Invalid ${what} "${id}".`, {
      hint: 'Ids must match ^[a-z][a-z0-9_]{0,63}$, e.g. wall_001 or space_kitchen.',
    });
  }
}

/**
 * Collect every string in the document that looks like an id. This intentionally
 * over-collects (it also picks up ids mentioned inside history entries) so that a
 * generated id can never collide with something an undo would bring back.
 * @param {unknown} node
 * @param {Set<string>} [seen]
 * @returns {Set<string>}
 */
export function collectIdLikeStrings(node, seen = new Set()) {
  if (typeof node === 'string') {
    if (ID_PATTERN.test(node)) seen.add(node);
    return seen;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectIdLikeStrings(item, seen);
    return seen;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectIdLikeStrings(value, seen);
  }
  return seen;
}

/**
 * @param {string} type element type, e.g. "wall" or "door"
 * @returns {string}
 */
export function prefixForType(type) {
  const prefix = TYPE_TO_ID_PREFIX[type];
  if (!prefix) {
    throw new DomainError('UNKNOWN_ELEMENT_TYPE', `No id prefix defined for type "${type}".`);
  }
  return prefix;
}

/**
 * Generate the lowest free id for a type: wall_001, wall_002, ...
 * @param {import('./types.js').FloorplanDocument} doc
 * @param {string} type
 * @param {{taken?: Set<string>, prefix?: string}} [options]
 * @returns {string}
 */
export function generateId(doc, type, options = {}) {
  const prefix = options.prefix ?? prefixForType(type);
  const taken = options.taken ?? collectIdLikeStrings(doc);
  for (let n = 1; n <= 99999; n += 1) {
    const candidate = `${prefix}_${String(n).padStart(3, '0')}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new DomainError('ID_SPACE_EXHAUSTED', `Cannot generate a free id for prefix "${prefix}".`);
}

/**
 * Reusable generator for a batch of operations, so that ids stay unique within
 * one apply run without rescanning the document each time.
 * @param {import('./types.js').FloorplanDocument} doc
 * @returns {{next: (type: string, explicit?: string) => string, taken: Set<string>}}
 */
export function createIdAllocator(doc) {
  const taken = collectIdLikeStrings(doc);
  return {
    taken,
    /**
     * @param {string} type
     * @param {string} [explicit]
     */
    next(type, explicit) {
      if (explicit !== undefined) {
        assertValidId(explicit);
        if (taken.has(explicit)) {
          throw new DomainError('ID_ALREADY_IN_USE', `The id "${explicit}" is already used in this document.`, {
            hint: 'Ids are immutable and never reused. Choose a different id or omit it to get one generated.',
          });
        }
        taken.add(explicit);
        return explicit;
      }
      return generateId(doc, type, { taken });
    },
  };
}
