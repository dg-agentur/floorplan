/**
 * Dependency free JSON Schema validator for a defined subset of draft 2020-12.
 *
 * Supported keywords (see docs/adr/0011-schema-validator.md):
 *   $ref (local pointers only) · $defs · type · enum · const
 *   properties · required · additionalProperties · patternProperties
 *   items · prefixItems · minItems · maxItems · uniqueItems
 *   minimum · maximum · exclusiveMinimum · exclusiveMaximum · multipleOf
 *   minLength · maxLength · pattern
 *   allOf · anyOf · oneOf · not · if/then/else
 *
 * Everything else is rejected at compile time rather than ignored, so a schema
 * can never silently under-validate. tests/schema-meta.test.js enforces that our
 * own schema files stay inside this subset.
 */

import { FloorplanError } from '../util/errors.js';

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$comment', 'title', 'description', 'examples', 'default', 'deprecated',
  '$defs', '$ref',
  'type', 'enum', 'const',
  'properties', 'required', 'additionalProperties', 'patternProperties',
  'items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

const MAX_REF_DEPTH = 64;

/**
 * @typedef {object} SchemaError
 * @property {string} pointer   JSON pointer into the validated document
 * @property {string} keyword   the violated keyword
 * @property {string} message   human readable explanation
 * @property {string} [schema_pointer] JSON pointer into the schema
 */

/**
 * @param {string} segment
 * @returns {string}
 */
function escapePointer(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * @param {string} pointer
 * @returns {string}
 */
function lastSegment(pointer) {
  const parts = pointer.split('/');
  return parts.length > 1 ? parts[parts.length - 1].replace(/~1/g, '/').replace(/~0/g, '~') : 'value';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return t;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function preview(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}...` : value);
  if (typeof value === 'object') return Array.isArray(value) ? `array(${value.length})` : 'object';
  return String(value);
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(/** @type {object} */ (a)).sort();
    const kb = Object.keys(/** @type {object} */ (b)).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) =>
      deepEqual(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
  }
  return false;
}

export class SchemaValidator {
  /**
   * @param {object} schema root schema document
   * @param {{name?: string}} [options]
   */
  constructor(schema, options = {}) {
    this.schema = schema;
    this.name = options.name ?? (/** @type {any} */ (schema).$id ?? 'schema');
    /** @type {Map<string, object>} */
    this.refCache = new Map();
    this.#assertSupported(schema, '#');
  }

  /**
   * Reject unknown keywords at construction time, so a schema can never be
   * under-validated by silently ignored keywords.
   * @param {unknown} node a schema node
   * @param {string} pointer
   */
  #assertSupported(node, pointer) {
    if (typeof node === 'boolean' || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return; // arrays are never schema nodes themselves

    const obj = /** @type {Record<string, unknown>} */ (node);
    for (const key of Object.keys(obj)) {
      if (!SUPPORTED_KEYWORDS.has(key)) {
        throw new FloorplanError(
          'UNSUPPORTED_SCHEMA_KEYWORD',
          `Schema "${this.name}" uses unsupported keyword "${key}" at ${pointer}.`,
          {
            exitCode: 3,
            hint: `Supported keywords: ${[...SUPPORTED_KEYWORDS].join(', ')}. See docs/adr/0011-schema-validator.md.`,
          },
        );
      }
      const value = obj[key];
      const childPointer = `${pointer}/${escapePointer(key)}`;
      // Maps of name -> schema
      if (key === 'properties' || key === 'patternProperties' || key === '$defs') {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [name, sub] of Object.entries(value)) {
            this.#assertSupported(sub, `${childPointer}/${escapePointer(name)}`);
          }
        }
        continue;
      }
      // Arrays of schemas
      if (key === 'allOf' || key === 'anyOf' || key === 'oneOf' || key === 'prefixItems') {
        if (Array.isArray(value)) value.forEach((sub, i) => this.#assertSupported(sub, `${childPointer}/${i}`));
        continue;
      }
      // Single nested schemas
      if (key === 'items' || key === 'not' || key === 'if' || key === 'then' || key === 'else'
        || key === 'additionalProperties') {
        this.#assertSupported(value, childPointer);
        continue;
      }
      // Everything else is data (enum values, strings, numbers) and needs no walk.
    }
  }

  /**
   * @param {string} ref
   * @returns {object}
   */
  #resolveRef(ref) {
    const cached = this.refCache.get(ref);
    if (cached) return cached;
    if (!ref.startsWith('#')) {
      throw new FloorplanError('UNSUPPORTED_REMOTE_REF', `Remote $ref is not supported: ${ref}`, { exitCode: 3 });
    }
    const path = ref.slice(1).split('/').filter((s) => s.length > 0);
    /** @type {any} */
    let node = this.schema;
    for (const rawSegment of path) {
      const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
      if (node === null || typeof node !== 'object' || !(segment in node)) {
        throw new FloorplanError('UNRESOLVABLE_REF', `Cannot resolve $ref "${ref}" in schema "${this.name}".`, { exitCode: 3 });
      }
      node = node[segment];
    }
    this.refCache.set(ref, node);
    return node;
  }

  /**
   * Validate a value against the schema.
   * @param {unknown} data
   * @returns {SchemaError[]} empty when valid
   */
  validate(data) {
    /** @type {SchemaError[]} */
    const errors = [];
    this.#validateNode(this.schema, data, '', '#', errors, 0);
    return errors;
  }

  /**
   * @param {unknown} data
   * @returns {boolean}
   */
  isValid(data) {
    return this.validate(data).length === 0;
  }

  /**
   * Validate against a subschema of this document, e.g. "#/$defs/wall".
   * Used by operations that insert or replace a single element.
   * @param {string} ref
   * @param {unknown} data
   * @returns {SchemaError[]}
   */
  validateSubschema(ref, data) {
    const schema = this.#resolveRef(ref);
    /** @type {SchemaError[]} */
    const errors = [];
    this.#validateNode(schema, data, '', ref, errors, 0);
    return errors;
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   * @param {number} depth
   */
  #validateNode(schema, data, pointer, schemaPointer, errors, depth) {
    if (depth > MAX_REF_DEPTH) {
      throw new FloorplanError('SCHEMA_RECURSION_LIMIT', `Schema recursion limit reached at ${pointer}.`, { exitCode: 3 });
    }
    if (schema === true) return;
    if (schema === false) {
      errors.push({ pointer, keyword: 'false', message: 'no value is allowed here', schema_pointer: schemaPointer });
      return;
    }
    if (schema === null || typeof schema !== 'object') return;

    if (typeof schema.$ref === 'string') {
      const resolved = this.#resolveRef(schema.$ref);
      this.#validateNode(resolved, data, pointer, schema.$ref, errors, depth + 1);
    }

    this.#checkType(schema, data, pointer, schemaPointer, errors);
    this.#checkConstAndEnum(schema, data, pointer, schemaPointer, errors);
    this.#checkNumber(schema, data, pointer, schemaPointer, errors);
    this.#checkString(schema, data, pointer, schemaPointer, errors);
    this.#checkArray(schema, data, pointer, schemaPointer, errors, depth);
    this.#checkObject(schema, data, pointer, schemaPointer, errors, depth);
    this.#checkCombinators(schema, data, pointer, schemaPointer, errors, depth);
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   */
  #checkType(schema, data, pointer, schemaPointer, errors) {
    if (schema.type === undefined) return;
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(data);
    const ok = allowed.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) {
      errors.push({
        pointer,
        keyword: 'type',
        message: `${lastSegment(pointer)} must be of type ${allowed.join(' or ')} (got ${actual})`,
        schema_pointer: schemaPointer,
      });
    } else if ((actual === 'number' || actual === 'integer') && !Number.isFinite(data)) {
      errors.push({
        pointer,
        keyword: 'type',
        message: `${lastSegment(pointer)} must be a finite number`,
        schema_pointer: schemaPointer,
      });
    }
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   */
  #checkConstAndEnum(schema, data, pointer, schemaPointer, errors) {
    if ('const' in schema && !deepEqual(data, schema.const)) {
      errors.push({
        pointer,
        keyword: 'const',
        message: `${lastSegment(pointer)} must be ${JSON.stringify(schema.const)} (got ${preview(data)})`,
        schema_pointer: schemaPointer,
      });
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((v) => deepEqual(data, v))) {
      errors.push({
        pointer,
        keyword: 'enum',
        message: `${lastSegment(pointer)} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')} (got ${preview(data)})`,
        schema_pointer: schemaPointer,
      });
    }
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   */
  #checkNumber(schema, data, pointer, schemaPointer, errors) {
    if (typeof data !== 'number' || !Number.isFinite(data)) return;
    const label = lastSegment(pointer);
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ pointer, keyword: 'minimum', message: `${label} must be >= ${schema.minimum} (got ${data})`, schema_pointer: schemaPointer });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({ pointer, keyword: 'maximum', message: `${label} must be <= ${schema.maximum} (got ${data})`, schema_pointer: schemaPointer });
    }
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      errors.push({ pointer, keyword: 'exclusiveMinimum', message: `${label} must be > ${schema.exclusiveMinimum} (got ${data})`, schema_pointer: schemaPointer });
    }
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
      errors.push({ pointer, keyword: 'exclusiveMaximum', message: `${label} must be < ${schema.exclusiveMaximum} (got ${data})`, schema_pointer: schemaPointer });
    }
    if (schema.multipleOf !== undefined) {
      const quotient = data / schema.multipleOf;
      if (!Number.isFinite(quotient) || Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        errors.push({ pointer, keyword: 'multipleOf', message: `${label} must be a multiple of ${schema.multipleOf} (got ${data})`, schema_pointer: schemaPointer });
      }
    }
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   */
  #checkString(schema, data, pointer, schemaPointer, errors) {
    if (typeof data !== 'string') return;
    const label = lastSegment(pointer);
    const length = [...data].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push({ pointer, keyword: 'minLength', message: `${label} must have at least ${schema.minLength} character(s) (got ${length})`, schema_pointer: schemaPointer });
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push({ pointer, keyword: 'maxLength', message: `${label} must have at most ${schema.maxLength} character(s) (got ${length})`, schema_pointer: schemaPointer });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) {
      errors.push({ pointer, keyword: 'pattern', message: `${label} must match ${schema.pattern} (got ${preview(data)})`, schema_pointer: schemaPointer });
    }
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   * @param {number} depth
   */
  #checkArray(schema, data, pointer, schemaPointer, errors, depth) {
    if (!Array.isArray(data)) return;
    const label = lastSegment(pointer);
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ pointer, keyword: 'minItems', message: `${label} must contain at least ${schema.minItems} item(s) (got ${data.length})`, schema_pointer: schemaPointer });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({ pointer, keyword: 'maxItems', message: `${label} must contain at most ${schema.maxItems} item(s) (got ${data.length})`, schema_pointer: schemaPointer });
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < data.length; i += 1) {
        for (let j = i + 1; j < data.length; j += 1) {
          if (deepEqual(data[i], data[j])) {
            errors.push({ pointer: `${pointer}/${j}`, keyword: 'uniqueItems', message: `${label} must not contain duplicate items (index ${i} equals index ${j})`, schema_pointer: schemaPointer });
          }
        }
      }
    }
    const prefixCount = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    if (prefixCount > 0) {
      for (let i = 0; i < Math.min(prefixCount, data.length); i += 1) {
        this.#validateNode(schema.prefixItems[i], data[i], `${pointer}/${i}`, `${schemaPointer}/prefixItems/${i}`, errors, depth + 1);
      }
    }
    if (schema.items !== undefined) {
      for (let i = prefixCount; i < data.length; i += 1) {
        this.#validateNode(schema.items, data[i], `${pointer}/${i}`, `${schemaPointer}/items`, errors, depth + 1);
      }
    }
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   * @param {number} depth
   */
  #checkObject(schema, data, pointer, schemaPointer, errors, depth) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return;
    const obj = /** @type {Record<string, unknown>} */ (data);
    const keys = Object.keys(obj);

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push({
            pointer,
            keyword: 'required',
            message: `missing required property "${key}"${pointer ? ` in ${lastSegment(pointer)}` : ''}`,
            schema_pointer: schemaPointer,
          });
        }
      }
    }

    /** @type {Array<[RegExp, any]>} */
    const patterns = schema.patternProperties
      ? Object.entries(schema.patternProperties).map(([p, s]) => [new RegExp(p, 'u'), s])
      : [];

    for (const key of keys) {
      const childPointer = `${pointer}/${escapePointer(key)}`;
      let matched = false;
      if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        matched = true;
        this.#validateNode(schema.properties[key], obj[key], childPointer, `${schemaPointer}/properties/${escapePointer(key)}`, errors, depth + 1);
      }
      for (const [re, sub] of patterns) {
        if (re.test(key)) {
          matched = true;
          this.#validateNode(sub, obj[key], childPointer, `${schemaPointer}/patternProperties`, errors, depth + 1);
        }
      }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) {
          errors.push({
            pointer: childPointer,
            keyword: 'additionalProperties',
            message: `unknown property "${key}"${pointer ? ` in ${lastSegment(pointer)}` : ' at document root'}`,
            schema_pointer: schemaPointer,
          });
        } else {
          this.#validateNode(schema.additionalProperties, obj[key], childPointer, `${schemaPointer}/additionalProperties`, errors, depth + 1);
        }
      }
    }
  }

  /**
   * @param {any} schema
   * @param {unknown} data
   * @param {string} pointer
   * @param {string} schemaPointer
   * @param {SchemaError[]} errors
   * @param {number} depth
   */
  #checkCombinators(schema, data, pointer, schemaPointer, errors, depth) {
    if (Array.isArray(schema.allOf)) {
      schema.allOf.forEach((sub, i) => {
        this.#validateNode(sub, data, pointer, `${schemaPointer}/allOf/${i}`, errors, depth + 1);
      });
    }

    if (Array.isArray(schema.anyOf)) {
      const branchErrors = schema.anyOf.map((sub, i) => {
        /** @type {SchemaError[]} */
        const local = [];
        this.#validateNode(sub, data, pointer, `${schemaPointer}/anyOf/${i}`, local, depth + 1);
        return local;
      });
      if (!branchErrors.some((e) => e.length === 0)) {
        errors.push(...this.#bestBranch(branchErrors, pointer, 'anyOf', schemaPointer));
      }
    }

    if (Array.isArray(schema.oneOf)) {
      const branchErrors = schema.oneOf.map((sub, i) => {
        /** @type {SchemaError[]} */
        const local = [];
        this.#validateNode(sub, data, pointer, `${schemaPointer}/oneOf/${i}`, local, depth + 1);
        return local;
      });
      const passing = branchErrors.filter((e) => e.length === 0).length;
      if (passing === 0) {
        errors.push(...this.#bestBranch(branchErrors, pointer, 'oneOf', schemaPointer));
      } else if (passing > 1) {
        errors.push({
          pointer,
          keyword: 'oneOf',
          message: `${lastSegment(pointer)} matches ${passing} alternatives but must match exactly one`,
          schema_pointer: schemaPointer,
        });
      }
    }

    if (schema.not !== undefined) {
      /** @type {SchemaError[]} */
      const local = [];
      this.#validateNode(schema.not, data, pointer, `${schemaPointer}/not`, local, depth + 1);
      if (local.length === 0) {
        errors.push({
          pointer,
          keyword: 'not',
          message: `${lastSegment(pointer)} must not match the forbidden shape${this.#describeNot(schema.not)}`,
          schema_pointer: schemaPointer,
        });
      }
    }

    if (schema.if !== undefined) {
      /** @type {SchemaError[]} */
      const probe = [];
      this.#validateNode(schema.if, data, pointer, `${schemaPointer}/if`, probe, depth + 1);
      const branch = probe.length === 0 ? schema.then : schema.else;
      if (branch !== undefined) {
        this.#validateNode(branch, data, pointer, `${schemaPointer}/${probe.length === 0 ? 'then' : 'else'}`, errors, depth + 1);
      }
    }
  }

  /**
   * Produce a readable hint for a failed `not`, which is otherwise cryptic.
   * @param {any} notSchema
   * @returns {string}
   */
  #describeNot(notSchema) {
    /** @type {string[]} */
    const forbidden = [];
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.required)) forbidden.push(...node.required);
      if (Array.isArray(node.anyOf)) node.anyOf.forEach(collect);
      if (Array.isArray(node.allOf)) node.allOf.forEach(collect);
      if (Array.isArray(node.oneOf)) node.oneOf.forEach(collect);
    };
    collect(notSchema);
    return forbidden.length > 0 ? ` (property not allowed here: ${[...new Set(forbidden)].join(', ')})` : '';
  }

  /**
   * Report the alternative that came closest, instead of dumping every branch.
   * @param {SchemaError[][]} branchErrors
   * @param {string} pointer
   * @param {string} keyword
   * @param {string} schemaPointer
   * @returns {SchemaError[]}
   */
  #bestBranch(branchErrors, pointer, keyword, schemaPointer) {
    let best = branchErrors[0] ?? [];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const branch of branchErrors) {
      // Prefer the branch that failed deepest (most specific) with fewest errors.
      const typeErrors = branch.filter((e) => e.keyword === 'const' || e.keyword === 'type' || e.keyword === 'enum').length;
      const score = branch.length + typeErrors * 2;
      if (score < bestScore) {
        bestScore = score;
        best = branch;
      }
    }
    if (best.length === 0) {
      return [{ pointer, keyword, message: `${lastSegment(pointer)} does not match any allowed alternative`, schema_pointer: schemaPointer }];
    }
    return best;
  }
}

/** @type {Map<string, SchemaValidator>} */
const validatorCache = new Map();

/**
 * Compile (and cache) a validator for a schema object.
 * @param {object} schema
 * @param {string} name
 * @returns {SchemaValidator}
 */
export function compileSchema(schema, name) {
  const cached = validatorCache.get(name);
  if (cached && cached.schema === schema) return cached;
  const validator = new SchemaValidator(schema, { name });
  validatorCache.set(name, validator);
  return validator;
}

export { SUPPORTED_KEYWORDS };
