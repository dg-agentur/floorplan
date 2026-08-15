/**
 * The apply engine.
 *
 * Contract (docs/adr/0009-operations-and-history.md):
 *   - pure: the input document is never mutated
 *   - atomic: if one operation fails, nothing is applied
 *   - reversible: every entry carries the operations that undo it
 *   - deterministic: no timestamps unless explicitly supplied
 */

import { deepClone } from '../util/json.js';
import { digest } from '../util/hash.js';
import { OperationError, UsageError } from '../util/errors.js';
import { OPERATIONS_SCHEMA_VERSION } from '../model/constants.js';
import { indexDocument, resolveLevel } from '../model/document.js';
import { createIdAllocator } from '../model/ids.js';
import { compileSchema } from '../validation/schemaValidator.js';
import { validateDocument } from '../validation/validate.js';
import { getOperation } from './registry.js';

/** @typedef {import('../model/types.js').FloorplanDocument} FloorplanDocument */

/**
 * @typedef {object} AppliedOperation
 * @property {number} index
 * @property {string} op
 * @property {string} summary
 * @property {string[]} affected_ids
 */

/**
 * @typedef {object} ApplyResult
 * @property {FloorplanDocument} document the new document (the input is untouched)
 * @property {AppliedOperation[]} results
 * @property {import('../validation/validate.js').ValidationReport} report
 */

/** @type {Map<string, import('../validation/schemaValidator.js').SchemaValidator>} */
const operationValidators = new Map();

/**
 * @param {import('./registry.js').OperationDefinition} definition
 * @returns {import('../validation/schemaValidator.js').SchemaValidator}
 */
function validatorFor(definition) {
  let validator = operationValidators.get(definition.op);
  if (!validator) {
    validator = compileSchema(definition.schema, `operation:${definition.op}`);
    operationValidators.set(definition.op, validator);
  }
  return validator;
}

/**
 * Accept either a full operations file or a bare array of operations.
 * @param {unknown} input
 * @returns {Record<string, any>[]}
 */
export function normaliseOperationInput(input) {
  if (Array.isArray(input)) return /** @type {Record<string, any>[]} */ (input);
  if (input && typeof input === 'object') {
    const file = /** @type {any} */ (input);
    if (file.schema_version !== undefined && file.schema_version !== OPERATIONS_SCHEMA_VERSION) {
      throw new UsageError(
        'INCOMPATIBLE_OPERATIONS_VERSION',
        `Operations file uses schema_version "${file.schema_version}", expected "${OPERATIONS_SCHEMA_VERSION}".`,
      );
    }
    if (Array.isArray(file.operations)) return file.operations;
    if (typeof file.op === 'string') return [file];
  }
  throw new UsageError('INVALID_OPERATIONS_FILE', 'Expected an object with an "operations" array, or a bare array of operations.', {
    hint: `Minimal file: {"schema_version": "${OPERATIONS_SCHEMA_VERSION}", "operations": [{"op": "..."}]}`,
  });
}

/**
 * @param {FloorplanDocument} document
 * @param {unknown} operationsInput
 * @param {{stamp?: string, recordHistory?: boolean, quality?: string}} [options]
 * @returns {ApplyResult}
 */
export function applyOperations(document, operationsInput, options = {}) {
  const operations = normaliseOperationInput(operationsInput);
  if (operations.length === 0) {
    throw new UsageError('EMPTY_OPERATIONS', 'The operations list is empty.');
  }

  const working = deepClone(document);
  const recordHistory = options.recordHistory ?? true;
  const ids = createIdAllocator(working);

  /** @type {import('./helpers.js').OperationContext & {defaultLevel: () => any}} */
  const ctx = {
    doc: working,
    index: indexDocument(working),
    ids,
    reindex() {
      ctx.index = indexDocument(working);
    },
    defaultLevel() {
      return resolveLevel(working);
    },
  };

  /** @type {AppliedOperation[]} */
  const results = [];
  if (recordHistory && !Array.isArray(working.history)) working.history = [];

  operations.forEach((operation, i) => {
    if (!operation || typeof operation !== 'object' || typeof operation.op !== 'string') {
      throw new UsageError('INVALID_OPERATION', `Operation at index ${i} has no "op" field.`, {
        details: { index: i, operation },
      });
    }
    const definition = getOperation(operation.op);
    const schemaErrors = validatorFor(definition).validate(operation);
    if (schemaErrors.length > 0) {
      throw new OperationError(
        'INVALID_OPERATION',
        `Operation ${i} (${operation.op}): ${schemaErrors[0].message}`,
        {
          opIndex: i,
          op: operation.op,
          details: schemaErrors.slice(0, 10),
          hint: `Run \`floorplan ops describe ${operation.op} --json\` to see the expected parameters.`,
        },
      );
    }

    ctx.index = indexDocument(working);
    let outcome;
    try {
      outcome = definition.apply(ctx, operation);
    } catch (err) {
      if (err instanceof OperationError) {
        err.opIndex = i;
        err.op = operation.op;
        throw err;
      }
      const wrapped = new OperationError(
        /** @type {any} */ (err)?.code ?? 'OPERATION_FAILED',
        `Operation ${i} (${operation.op}) failed: ${/** @type {Error} */ (err).message}`,
        { opIndex: i, op: operation.op, cause: /** @type {Error} */ (err) },
      );
      throw wrapped;
    }

    results.push({ index: i, op: operation.op, summary: outcome.summary, affected_ids: outcome.affected_ids });

    if (recordHistory) {
      /** @type {any} */
      const entry = {
        index: /** @type {any[]} */ (working.history).length,
        operation: deepClone(operation),
        summary: outcome.summary,
        affected_ids: outcome.affected_ids,
        inverse: outcome.inverse,
        digest: digest(operation),
      };
      if (options.stamp) entry.stamp = options.stamp;
      /** @type {any[]} */ (working.history).push(entry);
    }
  });

  if (recordHistory) working.revision = (working.revision ?? 0) + 1;

  const report = validateDocument(working, { quality: options.quality });
  return { document: working, results, report };
}

/**
 * Undo the most recent history entries.
 * @param {FloorplanDocument} document
 * @param {{steps?: number, quality?: string}} [options]
 * @returns {ApplyResult & {undone: string[]}}
 */
export function undoOperations(document, options = {}) {
  const steps = options.steps ?? 1;
  const history = document.history ?? [];
  if (history.length === 0) {
    throw new UsageError('NOTHING_TO_UNDO', 'This document has no history entries.', {
      hint: 'Only changes applied through `floorplan apply` can be undone.',
    });
  }
  if (steps < 1) {
    throw new UsageError('INVALID_STEPS', 'steps must be at least 1.');
  }
  const effective = Math.min(steps, history.length);
  const entries = history.slice(-effective).reverse();

  /** @type {Record<string, any>[]} */
  const inverseOperations = [];
  /** @type {string[]} */
  const undone = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.inverse) || entry.inverse.length === 0) {
      throw new UsageError(
        'NOT_UNDOABLE',
        `History entry ${entry.index} ("${entry.summary}") carries no inverse operations.`,
        { hint: 'Entries written by older versions may not be undoable.' },
      );
    }
    inverseOperations.push(.../** @type {Record<string, any>[]} */ (entry.inverse));
    undone.push(`${/** @type {any} */ (entry.operation)?.op ?? 'operation'}: ${entry.summary}`);
  }

  const applied = applyOperations(document, inverseOperations, {
    recordHistory: false,
    quality: options.quality,
  });
  applied.document.history = (applied.document.history ?? []).slice(0, history.length - effective);
  applied.document.revision = Math.max(0, (document.revision ?? 0) - effective);

  return { ...applied, undone };
}
