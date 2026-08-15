/**
 * Minimal argument parser.
 *
 * Deliberately strict: an unknown flag is an error, not something to ignore.
 * An agent that mistypes a flag must find out immediately instead of receiving
 * a silently different result.
 */

import { UsageError } from '../util/errors.js';

/**
 * @typedef {object} ParsedArgs
 * @property {string[]} positional
 * @property {Record<string, string|boolean>} flags
 */

/**
 * @param {string[]} argv
 * @param {{boolean?: string[], string?: string[]}} spec
 * @returns {ParsedArgs}
 */
export function parseArgs(argv, spec = {}) {
  const booleanFlags = new Set(spec.boolean ?? []);
  const stringFlags = new Set(spec.string ?? []);
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-') {
      positional.push(token);
      continue;
    }
    const withoutDashes = token.replace(/^--?/, '');
    const equals = withoutDashes.indexOf('=');
    const name = equals >= 0 ? withoutDashes.slice(0, equals) : withoutDashes;
    const inlineValue = equals >= 0 ? withoutDashes.slice(equals + 1) : undefined;

    if (booleanFlags.has(name)) {
      if (inlineValue !== undefined) {
        flags[name] = inlineValue !== 'false' && inlineValue !== '0';
      } else {
        flags[name] = true;
      }
      continue;
    }
    if (stringFlags.has(name)) {
      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next.length > 2)) {
        throw new UsageError('MISSING_FLAG_VALUE', `Option --${name} needs a value.`);
      }
      flags[name] = next;
      i += 1;
      continue;
    }
    const known = [...booleanFlags, ...stringFlags].sort();
    throw new UsageError('UNKNOWN_FLAG', `Unknown option "--${name}".`, {
      hint: known.length > 0 ? `Known options here: ${known.map((f) => `--${f}`).join(', ')}` : undefined,
    });
  }

  return { positional, flags };
}

/**
 * @param {ParsedArgs} args
 * @param {string} name
 * @param {number} [fallback]
 * @returns {number|undefined}
 */
export function numberFlag(args, name, fallback) {
  const raw = args.flags[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new UsageError('INVALID_FLAG_VALUE', `Option --${name} must be a number (got "${raw}").`);
  }
  return value;
}

/**
 * @param {ParsedArgs} args
 * @param {string} name
 * @returns {number|undefined}
 */
export function integerFlag(args, name) {
  const value = numberFlag(args, name);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new UsageError('INVALID_FLAG_VALUE', `Option --${name} must be a whole number (got "${value}").`);
  }
  return value;
}

/**
 * @param {ParsedArgs} args
 * @param {string} name
 * @returns {string|undefined}
 */
export function stringFlag(args, name) {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * @param {ParsedArgs} args
 * @param {string} name
 * @returns {boolean}
 */
export function boolFlag(args, name) {
  return args.flags[name] === true;
}

/**
 * @param {ParsedArgs} args
 * @param {number} index
 * @param {string} what
 * @returns {string}
 */
export function requirePositional(args, index, what) {
  const value = args.positional[index];
  if (value === undefined) {
    throw new UsageError('MISSING_ARGUMENT', `Missing argument: ${what}.`);
  }
  return value;
}
