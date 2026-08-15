/**
 * Deterministic JSON serialisation.
 *
 * Two goals:
 *  1. Byte stable output. The same document always produces the same bytes, so
 *     diffs are meaningful and golden tests are possible.
 *  2. Human inspectability. Points and short primitive arrays stay on one line,
 *     which keeps polygons readable instead of exploding into 60 lines.
 *
 * Key order is fixed by KEY_PRIORITY (semantic order, id first). Unknown keys
 * follow, sorted alphabetically, so new fields never reorder existing ones.
 */

import { FloorplanError } from './errors.js';

/** Keys are emitted in this order. Everything else follows alphabetically. */
const KEY_PRIORITY = [
  // document level
  'schema_version', 'unit', 'project', 'sources', 'buildings', 'levels',
  'history', 'revision',
  // identity
  'id', 'type', 'name', 'description', 'index',
  // project
  'client', 'address', 'quality', 'defaults',
  // geometry
  'elevation_mm', 'start', 'end', 'points', 'boundary', 'footprint',
  'run_start', 'run_end', 'center', 'position', 'x_mm', 'y_mm',
  'thickness_mm', 'width_mm', 'depth_mm', 'diameter_mm', 'height_mm',
  'base_z_mm', 'sill_mm', 'offset_mm', 'rotation_deg',
  // semantics
  'classification', 'category', 'material', 'shape', 'host_wall_id',
  'door_type', 'hinge', 'swing', 'window_type', 'has_threshold',
  'shaft_kind', 'step_count', 'direction', 'to_level_id',
  'connects_space_ids', 'area_override_mm2', 'label_anchor',
  'text', 'annotation_kind', 'label_override',
  // state and provenance
  'state', 'provenance', 'confidence', 'verified', 'property_provenance',
  'source_id', 'observation_ids',
  // collections inside a level
  'walls', 'openings', 'spaces', 'columns', 'stairs', 'shafts',
  'dimensions', 'annotations',
  // operations
  'op', 'target_id', 'operations',
  // history
  'operation', 'summary', 'affected_ids', 'inverse', 'digest', 'stamp',
  // tail
  'tags', 'notes', 'meta',
];

/** @type {Map<string, number>} */
const PRIORITY = new Map(KEY_PRIORITY.map((k, i) => [k, i]));

/** Keys whose object values are always rendered inline when small. */
const INLINE_OBJECT_KEYS = new Set(['x_mm', 'y_mm']);

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareKeys(a, b) {
  const pa = PRIORITY.get(a);
  const pb = PRIORITY.get(b);
  if (pa !== undefined && pb !== undefined) return pa - pb;
  if (pa !== undefined) return -1;
  if (pb !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isInlineObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.length > 2) return false;
  return keys.every((k) => INLINE_OBJECT_KEYS.has(k));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isInlineArray(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  if (value.length > 8) return false;
  return value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
}

/**
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
  if (!Number.isFinite(n)) {
    throw new FloorplanError(
      'NON_FINITE_NUMBER',
      `Cannot serialise non finite number: ${String(n)}`,
      { hint: 'NaN and Infinity are not representable in JSON and never valid in a floorplan model.' },
    );
  }
  if (Object.is(n, -0)) return '0';
  return String(n);
}

/**
 * @param {unknown} value
 * @param {string} indent
 * @param {string} pad
 * @returns {string}
 */
function write(value, indent, pad) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') return formatNumber(/** @type {number} */ (value));
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (t === 'undefined') return 'null';
  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new FloorplanError('UNSERIALISABLE_VALUE', `Cannot serialise value of type ${t}.`);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isInlineArray(value)) {
      return `[${value.map((v) => write(v, indent, '')).join(', ')}]`;
    }
    const inner = pad + indent;
    const parts = value.map((v) => inner + write(v, indent, inner));
    return `[\n${parts.join(',\n')}\n${pad}]`;
  }

  const obj = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort(compareKeys);
  if (keys.length === 0) return '{}';
  if (isInlineObject(obj)) {
    return `{ ${keys.map((k) => `${JSON.stringify(k)}: ${write(obj[k], indent, '')}`).join(', ')} }`;
  }
  const inner = pad + indent;
  const parts = keys.map((k) => `${inner}${JSON.stringify(k)}: ${write(obj[k], indent, inner)}`);
  return `{\n${parts.join(',\n')}\n${pad}}`;
}

/**
 * Serialise a value deterministically, with a trailing newline.
 * @param {unknown} value
 * @param {{indent?: number}} [options]
 * @returns {string}
 */
export function stringifyStable(value, options = {}) {
  const indent = ' '.repeat(options.indent ?? 2);
  return `${write(value, indent, '')}\n`;
}

/**
 * Canonical form used for hashing: no whitespace, keys sorted alphabetically.
 * Independent of KEY_PRIORITY so that digests stay stable if the display order changes.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalise(value) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' ? formatNumber(value) : JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(obj[k])}`).join(',')}}`;
}

/**
 * Parse JSON with a precise error message including line and column.
 * @param {string} text
 * @param {string} [label]
 * @returns {unknown}
 */
export function parseJson(text, label = 'input') {
  try {
    return JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const match = /position (\d+)/.exec(message);
    let where = '';
    if (match) {
      const pos = Number(match[1]);
      const before = text.slice(0, pos);
      const line = before.split('\n').length;
      const column = pos - before.lastIndexOf('\n');
      where = ` at line ${line}, column ${column}`;
    }
    throw new FloorplanError('INVALID_JSON', `${label} is not valid JSON${where}: ${message}`, {
      exitCode: 2,
      hint: 'Check for trailing commas, single quotes or unquoted keys.',
    });
  }
}

/**
 * Structured deep clone. Used to guarantee that operations never mutate their input.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone(value) {
  return structuredClone(value);
}
