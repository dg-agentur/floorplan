/**
 * Error types used across the platform.
 *
 * Rules:
 *  - Every error carries a machine readable `code` and, where possible, a `hint`
 *    that tells a human or an agent what to do next.
 *  - Nothing is ever swallowed. There are no silent failures in this codebase.
 *  - `exitCode` follows docs/adr/0013-cli-contract.md:
 *      1 = domain failure (invalid model, failed operation)
 *      2 = usage failure (bad arguments, missing file, malformed JSON)
 *      3 = internal error (bug)
 */

/**
 * @typedef {object} ErrorOptions
 * @property {string} [hint]
 * @property {unknown} [details]
 * @property {number} [exitCode]
 * @property {Error} [cause]
 */

export class FloorplanError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'FloorplanError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
    this.exitCode = options.exitCode ?? 1;
  }

  toJSON() {
    /** @type {Record<string, unknown>} */
    const out = { code: this.code, message: this.message };
    if (this.hint !== undefined) out.hint = this.hint;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

/** Bad invocation: unknown command, missing file, malformed input. Exit code 2. */
export class UsageError extends FloorplanError {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options = {}) {
    super(code, message, { ...options, exitCode: options.exitCode ?? 2 });
    this.name = 'UsageError';
  }
}

/** A domain rule was violated: invalid model, impossible operation. Exit code 1. */
export class DomainError extends FloorplanError {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options = {}) {
    super(code, message, { ...options, exitCode: options.exitCode ?? 1 });
    this.name = 'DomainError';
  }
}

/**
 * An operation could not be applied. Carries the index inside the batch so the
 * caller can point at the offending entry.
 */
export class OperationError extends DomainError {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions & {opIndex?: number, op?: string}} [options]
   */
  constructor(code, message, options = {}) {
    super(code, message, options);
    this.name = 'OperationError';
    this.opIndex = options.opIndex;
    this.op = options.op;
  }

  toJSON() {
    const base = super.toJSON();
    if (this.opIndex !== undefined) base.op_index = this.opIndex;
    if (this.op !== undefined) base.op = this.op;
    return base;
  }
}

/**
 * Assertion for conditions that indicate a bug in this codebase, not bad input.
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
export function invariant(condition, message) {
  if (!condition) {
    throw new FloorplanError('INTERNAL_INVARIANT', `Internal invariant violated: ${message}`, {
      exitCode: 3,
      hint: 'This is a bug in floorplan-platform. Please report the input that triggered it.',
    });
  }
}
