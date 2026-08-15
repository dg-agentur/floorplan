/**
 * Conformance tests for the dependency free JSON Schema subset validator.
 * See docs/adr/0011-schema-validator.md — this suite is the reason we can trust it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SchemaValidator, SUPPORTED_KEYWORDS } from '../src/validation/schemaValidator.js';
import { FloorplanError } from '../src/util/errors.js';

/**
 * @param {object} schema
 * @returns {(data: unknown) => boolean}
 */
function validatorFor(schema) {
  const validator = new SchemaValidator(schema, { name: 'test' });
  return (data) => validator.isValid(data);
}

test('type keyword distinguishes integer from number', () => {
  const isValid = validatorFor({ type: 'integer' });
  assert.equal(isValid(3), true);
  assert.equal(isValid(3.0), true, '3.0 is an integer in JSON');
  assert.equal(isValid(3.5), false);
  assert.equal(isValid('3'), false);
  assert.equal(isValid(null), false);
});

test('type keyword rejects non finite numbers', () => {
  const isValid = validatorFor({ type: 'number' });
  assert.equal(isValid(Number.NaN), false);
  assert.equal(isValid(Number.POSITIVE_INFINITY), false);
  assert.equal(isValid(1.5), true);
});

test('null, array and object are distinct types', () => {
  assert.equal(validatorFor({ type: 'object' })(null), false);
  assert.equal(validatorFor({ type: 'object' })([]), false);
  assert.equal(validatorFor({ type: 'array' })({}), false);
  assert.equal(validatorFor({ type: 'null' })(null), true);
});

test('type accepts an array of alternatives', () => {
  const isValid = validatorFor({ type: ['string', 'integer'] });
  assert.equal(isValid('a'), true);
  assert.equal(isValid(2), true);
  assert.equal(isValid(true), false);
});

test('enum and const use deep equality', () => {
  assert.equal(validatorFor({ enum: ['a', 'b'] })('a'), true);
  assert.equal(validatorFor({ enum: ['a', 'b'] })('c'), false);
  assert.equal(validatorFor({ const: { x: 1 } })({ x: 1 }), true);
  assert.equal(validatorFor({ const: { x: 1 } })({ x: 2 }), false);
  assert.equal(validatorFor({ enum: [{ a: [1, 2] }] })({ a: [1, 2] }), true);
});

test('numeric bounds including exclusive variants', () => {
  assert.equal(validatorFor({ minimum: 5 })(5), true);
  assert.equal(validatorFor({ minimum: 5 })(4.999), false);
  assert.equal(validatorFor({ exclusiveMinimum: 5 })(5), false);
  assert.equal(validatorFor({ maximum: 5 })(5), true);
  assert.equal(validatorFor({ exclusiveMaximum: 5 })(5), false);
  assert.equal(validatorFor({ multipleOf: 0.5 })(1.5), true);
  assert.equal(validatorFor({ multipleOf: 0.5 })(1.6), false);
  assert.equal(validatorFor({ minimum: 5 })('not a number'), true, 'bounds only apply to numbers');
});

test('string length counts code points, not UTF-16 units', () => {
  const isValid = validatorFor({ type: 'string', maxLength: 2 });
  assert.equal(isValid('ab'), true);
  assert.equal(isValid('abc'), false);
  assert.equal(isValid('😀😀'), true, 'two emoji are two characters');
});

test('pattern is anchored exactly as written', () => {
  const isValid = validatorFor({ pattern: '^[a-z]+$' });
  assert.equal(isValid('abc'), true);
  assert.equal(isValid('Abc'), false);
  assert.equal(validatorFor({ pattern: 'b' })('abc'), true, 'unanchored patterns match anywhere');
});

test('required, properties and additionalProperties', () => {
  const schema = {
    type: 'object',
    required: ['a'],
    additionalProperties: false,
    properties: { a: { type: 'integer' }, b: { type: 'string' } },
  };
  const isValid = validatorFor(schema);
  assert.equal(isValid({ a: 1 }), true);
  assert.equal(isValid({ a: 1, b: 'x' }), true);
  assert.equal(isValid({ b: 'x' }), false, 'missing required property');
  assert.equal(isValid({ a: 1, c: 3 }), false, 'unknown property');
  assert.equal(isValid({ a: 'x' }), false, 'wrong property type');
});

test('patternProperties cooperate with additionalProperties', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { name: { type: 'string' } },
    patternProperties: { '^x_': { type: 'integer' } },
  };
  const isValid = validatorFor(schema);
  assert.equal(isValid({ name: 'a', x_1: 5 }), true);
  assert.equal(isValid({ x_1: 'no' }), false);
  assert.equal(isValid({ y_1: 5 }), false);
});

test('items, prefixItems, minItems, maxItems, uniqueItems', () => {
  assert.equal(validatorFor({ type: 'array', items: { type: 'integer' } })([1, 2]), true);
  assert.equal(validatorFor({ type: 'array', items: { type: 'integer' } })([1, 'a']), false);
  assert.equal(validatorFor({ minItems: 2 })([1]), false);
  assert.equal(validatorFor({ maxItems: 1 })([1, 2]), false);
  assert.equal(validatorFor({ uniqueItems: true })([1, 2, 1]), false);
  assert.equal(validatorFor({ uniqueItems: true })([{ a: 1 }, { a: 1 }]), false);
  const tuple = { prefixItems: [{ type: 'string' }, { type: 'integer' }], items: { type: 'boolean' } };
  assert.equal(validatorFor(tuple)(['a', 1, true]), true);
  assert.equal(validatorFor(tuple)(['a', 'b']), false);
  assert.equal(validatorFor(tuple)(['a', 1, 'nope']), false);
});

test('allOf, anyOf, oneOf and not', () => {
  assert.equal(validatorFor({ allOf: [{ type: 'integer' }, { minimum: 3 }] })(4), true);
  assert.equal(validatorFor({ allOf: [{ type: 'integer' }, { minimum: 3 }] })(2), false);
  assert.equal(validatorFor({ anyOf: [{ type: 'string' }, { type: 'integer' }] })(1), true);
  assert.equal(validatorFor({ anyOf: [{ type: 'string' }, { type: 'integer' }] })(true), false);
  assert.equal(validatorFor({ oneOf: [{ type: 'integer' }, { type: 'string' }] })('x'), true);
  assert.equal(
    validatorFor({ oneOf: [{ type: 'integer' }, { minimum: 0 }] })(5),
    false,
    'matching two alternatives violates oneOf',
  );
  assert.equal(
    validatorFor({ oneOf: [{ minimum: 0 }, { type: 'string' }] })('x'),
    false,
    'a numeric bound is vacuously true for a string, so both alternatives match',
  );
  assert.equal(validatorFor({ not: { type: 'string' } })(1), true);
  assert.equal(validatorFor({ not: { type: 'string' } })('a'), false);
});

test('if / then / else', () => {
  const schema = {
    type: 'object',
    properties: { kind: { type: 'string' } },
    if: { properties: { kind: { const: 'door' } }, required: ['kind'] },
    then: { required: ['door_type'] },
    else: { not: { required: ['door_type'] } },
  };
  const isValid = validatorFor(schema);
  assert.equal(isValid({ kind: 'door', door_type: 'swing' }), true);
  assert.equal(isValid({ kind: 'door' }), false);
  assert.equal(isValid({ kind: 'window' }), true);
  assert.equal(isValid({ kind: 'window', door_type: 'swing' }), false);
});

test('$ref resolves local pointers and $defs', () => {
  const schema = {
    $defs: { positive: { type: 'integer', minimum: 1 } },
    type: 'object',
    properties: { width: { $ref: '#/$defs/positive' } },
  };
  const isValid = validatorFor(schema);
  assert.equal(isValid({ width: 5 }), true);
  assert.equal(isValid({ width: 0 }), false);
});

test('validateSubschema validates against a named definition', () => {
  const validator = new SchemaValidator({
    $defs: { point: { type: 'object', required: ['x'], properties: { x: { type: 'integer' } } } },
  }, { name: 'test' });
  assert.equal(validator.validateSubschema('#/$defs/point', { x: 1 }).length, 0);
  assert.equal(validator.validateSubschema('#/$defs/point', {}).length, 1);
});

test('unsupported keywords are rejected at compile time, never ignored', () => {
  assert.throws(
    () => new SchemaValidator({ type: 'object', unevaluatedProperties: false }, { name: 'test' }),
    (error) => error instanceof FloorplanError && error.code === 'UNSUPPORTED_SCHEMA_KEYWORD',
  );
  assert.throws(
    () => new SchemaValidator({ properties: { a: { dependentSchemas: {} } } }, { name: 'test' }),
    (error) => error instanceof FloorplanError && error.code === 'UNSUPPORTED_SCHEMA_KEYWORD',
  );
});

test('property names are not mistaken for keywords', () => {
  const schema = {
    type: 'object',
    properties: {
      // "items" and "type" are legitimate property NAMES here
      items: { type: 'array' },
      type: { type: 'string' },
      not: { type: 'boolean' },
    },
  };
  const isValid = validatorFor(schema);
  assert.equal(isValid({ items: [], type: 'x', not: true }), true);
  assert.equal(isValid({ items: 'no' }), false);
});

test('errors carry a JSON pointer and the violated keyword', () => {
  const validator = new SchemaValidator({
    type: 'object',
    properties: { walls: { type: 'array', items: { type: 'object', properties: { t: { type: 'integer', minimum: 1 } } } } },
  }, { name: 'test' });
  const errors = validator.validate({ walls: [{ t: 5 }, { t: 0 }] });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].pointer, '/walls/1/t');
  assert.equal(errors[0].keyword, 'minimum');
  assert.match(errors[0].message, /t must be >= 1/);
});

test('all errors are collected, not just the first', () => {
  const validator = new SchemaValidator({
    type: 'object',
    required: ['a', 'b', 'c'],
  }, { name: 'test' });
  assert.equal(validator.validate({}).length, 3);
});

test('the supported keyword list is the documented subset', () => {
  for (const keyword of ['$ref', '$defs', 'type', 'enum', 'const', 'properties', 'required',
    'additionalProperties', 'patternProperties', 'items', 'prefixItems', 'minItems', 'maxItems',
    'uniqueItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minLength', 'maxLength', 'pattern', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else']) {
    assert.ok(SUPPORTED_KEYWORDS.has(keyword), `${keyword} must be supported`);
  }
  for (const keyword of ['unevaluatedProperties', 'dependentSchemas', 'contains', 'propertyNames', '$dynamicRef']) {
    assert.equal(SUPPORTED_KEYWORDS.has(keyword), false, `${keyword} must stay out of the subset`);
  }
});
