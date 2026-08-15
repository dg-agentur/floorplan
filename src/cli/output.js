/**
 * CLI output handling.
 *
 * Contract (docs/adr/0013-cli-contract.md):
 *   --json  -> exactly one JSON object on stdout, nothing else; notes on stderr
 *   default -> compact human readable text on stdout
 * Errors are JSON too when --json is active, never a bare stack trace.
 */

import { stringifyStable } from '../util/json.js';

/**
 * @typedef {object} OutputContext
 * @property {boolean} json
 * @property {string} command
 * @property {string[]} diagnostics
 */

/**
 * @param {boolean} json
 * @param {string} command
 * @returns {OutputContext}
 */
export function createOutput(json, command) {
  return { json, command, diagnostics: [] };
}

/**
 * A note that is never part of the machine readable payload.
 * @param {OutputContext} out
 * @param {string} message
 */
export function note(out, message) {
  out.diagnostics.push(message);
  if (out.json) process.stderr.write(`${message}\n`);
}

/**
 * Human readable line. Suppressed entirely in --json mode.
 * @param {OutputContext} out
 * @param {string} line
 */
export function text(out, line) {
  if (!out.json) process.stdout.write(`${line}\n`);
}

/**
 * Emit the final result and return the exit code.
 * @param {OutputContext} out
 * @param {{data?: unknown, human?: string, exitCode?: number}} result
 * @returns {number}
 */
export function finish(out, result) {
  if (out.json) {
    process.stdout.write(stringifyStable({
      ok: (result.exitCode ?? 0) === 0,
      command: out.command,
      data: result.data ?? {},
      diagnostics: out.diagnostics,
    }));
  } else if (result.human !== undefined && result.human !== '') {
    process.stdout.write(`${result.human}\n`);
  }
  return result.exitCode ?? 0;
}

/**
 * @param {OutputContext} out
 * @param {unknown} error
 * @param {boolean} debug
 * @returns {number}
 */
export function fail(out, error, debug) {
  const err = /** @type {any} */ (error);
  const code = err?.code ?? 'INTERNAL_ERROR';
  const message = err?.message ?? String(error);
  const exitCode = typeof err?.exitCode === 'number' ? err.exitCode : 3;

  if (out.json) {
    process.stdout.write(stringifyStable({
      ok: false,
      command: out.command,
      error: {
        code,
        message,
        ...(err?.hint ? { hint: err.hint } : {}),
        ...(err?.details !== undefined ? { details: err.details } : {}),
        ...(err?.opIndex !== undefined ? { op_index: err.opIndex } : {}),
      },
      diagnostics: out.diagnostics,
    }));
  } else {
    process.stderr.write(`error [${code}]: ${message}\n`);
    if (err?.hint) process.stderr.write(`hint: ${err.hint}\n`);
    if (err?.details !== undefined) {
      process.stderr.write(`details: ${stringifyStable(err.details)}`);
    }
  }
  if (debug && err?.stack) process.stderr.write(`${err.stack}\n`);
  return exitCode;
}

/**
 * Render a simple aligned table for human output.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function table(headers, rows) {
  const all = [headers, ...rows.map((row) => row.map((cell) => String(cell)))];
  const widths = headers.map((_, i) => Math.max(...all.map((row) => String(row[i] ?? '').length)));
  const line = (row) => row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}
