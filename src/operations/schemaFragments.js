/**
 * Reusable JSON schema fragments for operation schemas.
 *
 * Each getter returns a fresh object so that callers can extend a fragment
 * without accidentally mutating a shared instance.
 */

import {
  DOOR_TYPES, PROVENANCE_VALUES, SPACE_CATEGORIES, STATES, WALL_CLASSIFICATIONS, WINDOW_TYPES,
} from '../model/constants.js';

export const idPattern = '^[a-z][a-z0-9_]{0,63}$';

/** @returns {object} */
export const id = () => ({ type: 'string', pattern: idPattern });

/** @returns {object} */
export const point = () => ({
  type: 'object',
  required: ['x_mm', 'y_mm'],
  additionalProperties: false,
  properties: {
    x_mm: { type: 'integer', minimum: -1000000000, maximum: 1000000000 },
    y_mm: { type: 'integer', minimum: -1000000000, maximum: 1000000000 },
  },
});

/** @returns {object} */
export const polygon = () => ({ type: 'array', minItems: 3, items: point() });

/** @returns {object} */
export const state = () => ({ enum: [...STATES] });

/** @returns {object} */
export const provenance = () => ({ enum: [...PROVENANCE_VALUES] });

/** @returns {object} */
export const confidence = () => ({ type: 'number', minimum: 0, maximum: 1 });

/** @returns {object} */
export const positiveMm = () => ({ type: 'integer', minimum: 1 });

/** @returns {object} */
export const nonNegativeMm = () => ({ type: 'integer', minimum: 0 });

/** @returns {object} */
export const classification = () => ({ enum: [...WALL_CLASSIFICATIONS] });

/** @returns {object} */
export const spaceCategory = () => ({ enum: [...SPACE_CATEGORIES] });

/** @returns {object} */
export const doorType = () => ({ enum: [...DOOR_TYPES] });

/** @returns {object} */
export const windowType = () => ({ enum: [...WINDOW_TYPES] });

/** @returns {object} */
export const name = () => ({ type: 'string', minLength: 1, maxLength: 200 });

/**
 * Fields every element carrying provenance may receive from a create operation.
 * @returns {Record<string, object>}
 */
export const provenanceProperties = () => ({
  state: state(),
  provenance: provenance(),
  confidence: confidence(),
  verified: { type: 'boolean' },
  source_id: id(),
});

/** The names of the fields returned by provenanceProperties(). */
export const PROVENANCE_FIELD_NAMES = ['state', 'provenance', 'confidence', 'verified', 'source_id'];

/**
 * Build a complete operation schema.
 * @param {string} op
 * @param {{required?: string[], properties: Record<string, object>}} spec
 * @returns {object}
 */
export function operationSchema(op, spec) {
  return {
    type: 'object',
    required: ['op', ...(spec.required ?? [])],
    additionalProperties: false,
    properties: {
      op: { const: op },
      ...spec.properties,
    },
  };
}
