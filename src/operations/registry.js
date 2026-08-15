/**
 * The operation registry is the single source of truth for the change vocabulary.
 *
 * schema/operations.schema.json is GENERATED from this registry
 * (scripts/generate-operations-schema.js) and a test asserts that the checked in
 * file still matches — so the published schema can never drift from the code.
 */

import { wallOperations } from './ops/walls.js';
import { openingOperations } from './ops/openings.js';
import { spaceOperations } from './ops/spaces.js';
import { generalOperations } from './ops/general.js';
import { structureOperations } from './ops/structure.js';
import { OPERATIONS_SCHEMA_VERSION } from '../model/constants.js';
import { UsageError } from '../util/errors.js';

/**
 * @typedef {object} OperationDefinition
 * @property {string} op
 * @property {string} category
 * @property {string} summary
 * @property {string} description
 * @property {object} schema JSON schema of the operation object, including "op"
 * @property {Record<string, unknown>[]} examples
 * @property {(ctx: import('./helpers.js').OperationContext, operation: any) => import('./helpers.js').OperationResult} apply
 */

/** @type {OperationDefinition[]} */
const ALL = [
  ...wallOperations,
  ...openingOperations,
  ...spaceOperations,
  ...generalOperations,
  ...structureOperations,
];

/** @type {Map<string, OperationDefinition>} */
export const OPERATIONS = new Map(ALL.map((definition) => [definition.op, definition]));

if (OPERATIONS.size !== ALL.length) {
  throw new Error('Duplicate operation name in the registry.');
}

/**
 * @returns {OperationDefinition[]} sorted by category then name, for stable output
 */
export function listOperations() {
  return [...ALL].sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.op < b.op ? -1 : 1));
}

/**
 * @param {string} name
 * @returns {OperationDefinition}
 */
export function getOperation(name) {
  const definition = OPERATIONS.get(name);
  if (definition) return definition;
  const suggestion = closestOperation(name);
  throw new UsageError('UNKNOWN_OPERATION', `Unknown operation "${name}".`, {
    hint: suggestion
      ? `Did you mean "${suggestion}"? Run \`floorplan ops list\` for the full vocabulary.`
      : 'Run `floorplan ops list` for the full vocabulary.',
  });
}

/**
 * @param {string} name
 * @returns {string|null}
 */
export function closestOperation(name) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of OPERATIONS.keys()) {
    const d = levenshtein(name, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= Math.max(3, Math.floor(name.length / 2)) ? best : null;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  /** @type {number[]} */
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Assemble the published operations schema from the registry.
 * @returns {object}
 */
export function buildOperationsSchema() {
  const definitions = listOperations();
  /** @type {Record<string, object>} */
  const defs = {};
  for (const definition of definitions) {
    defs[definition.op] = {
      title: definition.op,
      description: `${definition.summary} ${definition.description}`.trim(),
      ...definition.schema,
    };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://floorplan-platform.dev/schema/0.1/operations.schema.json',
    title: 'Floorplan Operation Batch',
    description:
      'A list of explicit, validated change operations. Applying a batch is atomic: if one operation fails, '
      + 'none are applied. Generated from src/operations/registry.js — do not edit by hand.',
    type: 'object',
    required: ['schema_version', 'operations'],
    additionalProperties: false,
    properties: {
      schema_version: { const: OPERATIONS_SCHEMA_VERSION },
      description: { type: 'string', maxLength: 2000 },
      operations: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/$defs/operation' },
      },
    },
    $defs: {
      operation: {
        type: 'object',
        required: ['op'],
        properties: {
          op: { enum: definitions.map((d) => d.op) },
        },
        allOf: definitions.map((definition) => ({
          if: { properties: { op: { const: definition.op } }, required: ['op'] },
          then: { $ref: `#/$defs/${definition.op}` },
        })),
      },
      ...defs,
    },
  };
}
