/**
 * The only module in the core that touches the file system.
 *
 * Everything above this layer works on plain objects, which keeps the geometry,
 * validation, operation and rendering layers pure and trivially testable.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJson, stringifyStable } from '../util/json.js';
import { FloorplanError, UsageError } from '../util/errors.js';
import { compileSchema } from '../validation/schemaValidator.js';
import { SCHEMA_VERSION } from './constants.js';

/** Absolute path of the package root (the directory containing package.json). */
export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const SCHEMA_NAMES = /** @type {const} */ (['floorplan', 'operations', 'observations', 'theme']);

/** @type {string|null} */
let cachedVersion = null;

/**
 * The software version, read from package.json.
 *
 * Single source of truth on purpose: a hard coded version in the CLI drifts away
 * from the manifest at the first release, and the drift is invisible until
 * someone compares an artefact against its tag.
 *
 * @returns {string}
 */
export function packageVersion() {
  if (cachedVersion) return cachedVersion;
  const path = resolve(PACKAGE_ROOT, 'package.json');
  const manifest = /** @type {any} */ (parseJson(readFileSync(path, 'utf8'), 'package.json'));
  if (typeof manifest.version !== 'string') {
    throw new FloorplanError('MISSING_VERSION', 'package.json has no version field.', { exitCode: 3 });
  }
  cachedVersion = manifest.version;
  return manifest.version;
}

/** @type {Map<string, object>} */
const schemaCache = new Map();

/**
 * @param {string} name one of SCHEMA_NAMES
 * @returns {object}
 */
export function loadSchema(name) {
  const cached = schemaCache.get(name);
  if (cached) return cached;
  if (!(/** @type {readonly string[]} */ (SCHEMA_NAMES).includes(name))) {
    throw new UsageError('UNKNOWN_SCHEMA', `Unknown schema "${name}".`, {
      hint: `Available schemas: ${SCHEMA_NAMES.join(', ')}`,
    });
  }
  const path = resolve(PACKAGE_ROOT, 'schema', `${name}.schema.json`);
  if (!existsSync(path)) {
    throw new FloorplanError('SCHEMA_FILE_MISSING', `Schema file not found: ${path}`, { exitCode: 3 });
  }
  const schema = /** @type {object} */ (parseJson(readFileSync(path, 'utf8'), `schema/${name}.schema.json`));
  schemaCache.set(name, schema);
  return schema;
}

/**
 * @param {string} name
 * @returns {import('../validation/schemaValidator.js').SchemaValidator}
 */
export function getSchemaValidator(name) {
  return compileSchema(loadSchema(name), name);
}

/**
 * @param {string} path
 * @param {string} [label]
 * @returns {unknown}
 */
export function readJsonFile(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new UsageError('FILE_NOT_FOUND', `File not found: ${path}`, {
      hint: 'Check the path. Relative paths are resolved against the current working directory.',
    });
  }
  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (err) {
    throw new UsageError('FILE_UNREADABLE', `Cannot read file: ${path}`, { cause: /** @type {Error} */ (err) });
  }
  return parseJson(text, label ?? path);
}

/**
 * @param {string} path
 * @param {unknown} data
 * @returns {string} the absolute path written
 */
export function writeJsonFile(path, data) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, stringifyStable(data), 'utf8');
  return absolute;
}

/**
 * @param {string} path
 * @param {string} content
 * @returns {string} the absolute path written
 */
export function writeTextFile(path, content) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
  return absolute;
}

/**
 * @param {string} version
 * @returns {{major: number, minor: number}}
 */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)$/.exec(String(version));
  if (!match) {
    throw new FloorplanError('INVALID_SCHEMA_VERSION', `Invalid schema_version "${version}". Expected MAJOR.MINOR, e.g. "0.1".`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Check document version compatibility (docs/adr/0010-versioning.md).
 * Returns a warning string for a newer minor version, throws for a foreign major.
 * @param {string} version
 * @returns {string|undefined}
 */
export function checkSchemaVersion(version) {
  const current = parseVersion(SCHEMA_VERSION);
  const found = parseVersion(version);
  if (found.major !== current.major) {
    throw new FloorplanError(
      'INCOMPATIBLE_SCHEMA_VERSION',
      `Document uses schema_version ${version}, this build supports ${SCHEMA_VERSION} (major version ${current.major}).`,
      { hint: 'A migration is required. See docs/versioning.md.' },
    );
  }
  if (found.minor > current.minor) {
    return `Document uses a newer minor schema version (${version} > ${SCHEMA_VERSION}). Unknown fields may be lost on save.`;
  }
  return undefined;
}

/**
 * Load and structurally validate a floorplan document.
 *
 * Structural validation is on by default: a caller that receives a document from
 * this function can rely on its shape. Semantic validation is a separate,
 * explicit step (src/validation/validate.js).
 *
 * @param {string} path
 * @param {{validate?: boolean}} [options]
 * @returns {{document: import('./types.js').FloorplanDocument, warnings: string[]}}
 */
export function loadDocument(path, options = {}) {
  const raw = readJsonFile(path, path);
  return parseDocument(raw, { ...options, label: path });
}

/**
 * @param {unknown} raw
 * @param {{validate?: boolean, label?: string}} [options]
 * @returns {{document: import('./types.js').FloorplanDocument, warnings: string[]}}
 */
export function parseDocument(raw, options = {}) {
  const label = options.label ?? 'document';
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UsageError('NOT_A_DOCUMENT', `${label} is not a floorplan document (expected a JSON object).`);
  }
  const doc = /** @type {import('./types.js').FloorplanDocument} */ (raw);
  /** @type {string[]} */
  const warnings = [];

  if (!doc.schema_version) {
    throw new FloorplanError('MISSING_SCHEMA_VERSION', `${label} has no schema_version.`, {
      hint: `Add "schema_version": "${SCHEMA_VERSION}" at the top level.`,
    });
  }
  const versionWarning = checkSchemaVersion(doc.schema_version);
  if (versionWarning) warnings.push(versionWarning);

  if (options.validate !== false) {
    const errors = getSchemaValidator('floorplan').validate(doc);
    if (errors.length > 0) {
      throw new FloorplanError(
        'SCHEMA_INVALID',
        `${label} does not match the floorplan schema (${errors.length} error${errors.length === 1 ? '' : 's'}).`,
        {
          details: errors.slice(0, 25),
          hint: 'Run `floorplan validate <file> --json` for the full list.',
        },
      );
    }
  }
  return { document: doc, warnings };
}

/**
 * @param {string} path
 * @param {import('./types.js').FloorplanDocument} doc
 * @returns {string}
 */
export function saveDocument(path, doc) {
  return writeJsonFile(path, doc);
}
