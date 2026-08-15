import { SCHEMA_NAMES, loadSchema } from '../../model/io.js';
import { parseArgs } from '../args.js';
import { finish, table } from '../output.js';

export const schemaSpec = { boolean: ['json', 'debug', 'list'], string: [] };

/**
 * `floorplan schema <name>` prints a schema so an agent can read the contract at
 * runtime instead of relying on what it was told in a prompt.
 *
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function schemaCommand(argv, out) {
  const args = parseArgs(argv, schemaSpec);
  const name = args.positional[0];

  if (!name) {
    const schemas = SCHEMA_NAMES.map((schemaName) => {
      const schema = /** @type {any} */ (loadSchema(schemaName));
      return { name: schemaName, id: schema.$id, title: schema.title };
    });
    return finish(out, {
      data: { schemas },
      human: [
        table(['name', 'title'], schemas.map((s) => [s.name, s.title])),
        '',
        'Use `floorplan schema <name>` to print one.',
      ].join('\n'),
    });
  }

  const schema = loadSchema(name);
  return finish(out, { data: schema, human: JSON.stringify(schema, null, 2) });
}
