import { getOperation, listOperations } from '../../operations/registry.js';
import { SETTABLE_ATTRIBUTES } from '../../operations/ops/general.js';
import { OPERATIONS_SCHEMA_VERSION } from '../../model/constants.js';
import { UsageError } from '../../util/errors.js';
import { parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish, table } from '../output.js';

export const opsSpec = {
  boolean: ['json', 'debug'],
  string: ['category'],
};

/**
 * The discovery surface for agents: `floorplan ops list --json` returns the
 * complete change vocabulary with schemas and examples, so an agent never has to
 * guess an operation name or parameter (docs/adr/0013-cli-contract.md).
 *
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function opsCommand(argv, out) {
  const args = parseArgs(argv, opsSpec);
  const sub = args.positional[0] ?? 'list';

  if (sub === 'list') {
    const category = stringFlag(args, 'category');
    const operations = listOperations()
      .filter((definition) => !category || definition.category === category)
      .map((definition) => ({
        op: definition.op,
        category: definition.category,
        summary: definition.summary,
        required: /** @type {string[]} */ (definition.schema.required ?? []).filter((p) => p !== 'op'),
        optional: Object.keys(definition.schema.properties ?? {}).filter(
          (p) => p !== 'op' && !(definition.schema.required ?? []).includes(p),
        ),
      }));
    const human = [
      `${operations.length} operations (schema_version ${OPERATIONS_SCHEMA_VERSION})`,
      '',
      table(
        ['operation', 'category', 'required parameters', 'summary'],
        operations.map((o) => [o.op, o.category, o.required.join(', ') || '-', o.summary]),
      ),
      '',
      'Use `floorplan ops describe <op>` for the full schema and an example.',
    ].join('\n');
    return finish(out, { data: { schema_version: OPERATIONS_SCHEMA_VERSION, operations }, human });
  }

  if (sub === 'describe') {
    const name = requirePositional(args, 1, 'the operation name');
    const definition = getOperation(name);
    const data = {
      op: definition.op,
      category: definition.category,
      summary: definition.summary,
      description: definition.description,
      schema: definition.schema,
      examples: definition.examples,
      ...(definition.op === 'set_attribute' ? { settable_attributes: SETTABLE_ATTRIBUTES } : {}),
    };
    const properties = Object.entries(definition.schema.properties ?? {}).filter(([key]) => key !== 'op');
    const required = new Set(definition.schema.required ?? []);
    const human = [
      `${definition.op}  (${definition.category})`,
      definition.summary,
      '',
      definition.description,
      '',
      table(
        ['parameter', 'required', 'type'],
        properties.map(([key, value]) => [
          key,
          required.has(key) ? 'yes' : 'no',
          describeType(value),
        ]),
      ),
      ...(definition.examples.length > 0
        ? ['', 'example:', JSON.stringify(definition.examples[0], null, 2)]
        : []),
    ].join('\n');
    return finish(out, { data, human });
  }

  if (sub === 'template') {
    const names = args.positional.slice(1);
    if (names.length === 0) throw new UsageError('MISSING_ARGUMENT', 'Missing argument: at least one operation name.');
    const operations = names.map((name) => {
      const definition = getOperation(name);
      return definition.examples[0] ?? { op: definition.op };
    });
    const file = { schema_version: OPERATIONS_SCHEMA_VERSION, operations };
    return finish(out, { data: file, human: JSON.stringify(file, null, 2) });
  }

  throw new UsageError('UNKNOWN_SUBCOMMAND', `Unknown subcommand "ops ${sub}".`, {
    hint: 'Available: list, describe <op>, template <op...>',
  });
}

/**
 * @param {any} schema
 * @returns {string}
 */
function describeType(schema) {
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.type === 'array') return `array of ${describeType(schema.items ?? {})}`;
  if (schema.type === 'object' && schema.properties) return `object{${Object.keys(schema.properties).join(', ')}}`;
  if (schema.type === 'integer') {
    const range = [schema.minimum !== undefined ? `>= ${schema.minimum}` : '', schema.maximum !== undefined ? `<= ${schema.maximum}` : ''].filter(Boolean).join(', ');
    return range ? `integer (${range})` : 'integer';
  }
  return schema.type ?? 'any';
}
