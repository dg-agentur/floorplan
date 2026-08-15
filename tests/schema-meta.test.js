/**
 * Meta tests over our own schema files.
 *
 * These are the safety net for the dependency free validator: if a schema starts
 * using a keyword the validator does not implement, this suite fails instead of
 * the keyword being silently ignored (docs/adr/0011-schema-validator.md).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PACKAGE_ROOT, SCHEMA_NAMES, loadSchema, getSchemaValidator } from '../src/model/io.js';
import { SUPPORTED_KEYWORDS } from '../src/validation/schemaValidator.js';

const SCHEMA_DIR = resolve(PACKAGE_ROOT, 'schema');

test('every schema file compiles, which proves it stays inside the supported subset', () => {
  for (const name of SCHEMA_NAMES) {
    assert.doesNotThrow(() => getSchemaValidator(name), `schema "${name}" must compile`);
  }
});

test('no schema file contains a keyword outside the supported subset', () => {
  const files = readdirSync(SCHEMA_DIR).filter((file) => file.endsWith('.schema.json'));
  assert.ok(files.length >= 4, 'expected at least four schema files');

  for (const file of files) {
    const schema = JSON.parse(readFileSync(resolve(SCHEMA_DIR, file), 'utf8'));
    walk(schema, '#', file);
  }

  /**
   * @param {any} node
   * @param {string} pointer
   * @param {string} file
   */
  function walk(node, pointer, file) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      assert.ok(
        SUPPORTED_KEYWORDS.has(key),
        `${file}: keyword "${key}" at ${pointer} is not implemented by the validator`,
      );
      if (key === 'properties' || key === 'patternProperties' || key === '$defs') {
        for (const [name, sub] of Object.entries(/** @type {object} */ (value ?? {}))) {
          walk(sub, `${pointer}/${key}/${name}`, file);
        }
      } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key)) {
        for (const [i, sub] of (/** @type {any[]} */ (value ?? [])).entries()) walk(sub, `${pointer}/${key}/${i}`, file);
      } else if (['items', 'not', 'if', 'then', 'else', 'additionalProperties'].includes(key)) {
        walk(value, `${pointer}/${key}`, file);
      }
    }
  }
});

test('every $ref in a schema resolves', () => {
  for (const name of SCHEMA_NAMES) {
    const schema = /** @type {any} */ (loadSchema(name));
    const refs = collectRefs(schema);
    for (const ref of refs) {
      assert.ok(ref.startsWith('#/'), `${name}: remote refs are not supported (${ref})`);
      const path = ref.slice(2).split('/');
      let node = schema;
      for (const segment of path) {
        assert.ok(node && typeof node === 'object' && segment in node, `${name}: unresolvable $ref ${ref}`);
        node = node[segment];
      }
    }
  }
});

test('the floorplan schema forbids unknown properties on every element type', () => {
  const schema = /** @type {any} */ (loadSchema('floorplan'));
  for (const name of ['wall', 'opening', 'space', 'column', 'stair', 'shaft', 'dimension', 'annotation', 'level', 'building', 'project']) {
    const definition = schema.$defs[name];
    assert.ok(definition, `missing $defs/${name}`);
    assert.equal(
      definition.additionalProperties,
      false,
      `$defs/${name} must reject unknown properties so that typos are loud (docs/adr/0010-versioning.md)`,
    );
  }
});

test('every element definition allows a meta escape hatch', () => {
  const schema = /** @type {any} */ (loadSchema('floorplan'));
  for (const name of ['wall', 'opening', 'space', 'column', 'stair', 'shaft', 'dimension', 'annotation']) {
    assert.ok(schema.$defs[name].properties.meta, `$defs/${name} must allow "meta"`);
  }
});

test('length fields consistently use the _mm suffix', () => {
  const schema = /** @type {any} */ (loadSchema('floorplan'));
  /** @type {string[]} */
  const offenders = [];
  collectPropertyNames(schema, offenders);
  assert.deepEqual(offenders, [], 'these numeric properties should carry a unit suffix');
});

/**
 * @param {any} node
 * @param {Set<string>} [found]
 * @returns {Set<string>}
 */
function collectRefs(node, found = new Set()) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') found.add(value);
    else collectRefs(value, found);
  }
  return found;
}

/**
 * @param {any} node
 * @param {string[]} offenders
 */
function collectPropertyNames(node, offenders) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectPropertyNames(item, offenders);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [name, sub] of Object.entries(/** @type {any} */ (value))) {
        const type = /** @type {any} */ (sub)?.type;
        const looksNumeric = type === 'integer' || type === 'number';
        const hasUnit = /_(mm|mm2|px|deg|ratio)$/.test(name);
        const allowed = ['index', 'page', 'confidence', 'revision', 'step_count', 'elevation_mm',
          'scale_mm_per_px', 'width_px', 'height_px', 'target_width_px', 'px_per_mm',
          'min_px_per_mm', 'max_px_per_mm', 'decimals', 'area_decimals', 'frame_ratio', 'opacity'];
        if (looksNumeric && !hasUnit && !allowed.includes(name)) offenders.push(name);
        collectPropertyNames(sub, offenders);
      }
      continue;
    }
    collectPropertyNames(value, offenders);
  }
}
