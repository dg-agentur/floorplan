import { relative } from 'node:path';
import { listThemes, loadTheme, readThemeFile, resolveThemePath } from '../../themes/load.js';
import { PACKAGE_ROOT, loadSchema } from '../../model/io.js';
import { UsageError } from '../../util/errors.js';
import { parseArgs, requirePositional } from '../args.js';
import { finish, table } from '../output.js';

export const themeSpec = { boolean: ['json', 'debug', 'resolved'], string: [] };

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function themeCommand(argv, out) {
  const args = parseArgs(argv, themeSpec);
  const sub = args.positional[0] ?? 'list';

  if (sub === 'list') {
    const themes = listThemes().map((theme) => ({
      name: theme.name,
      path: relative(process.cwd(), theme.path),
      description: safeDescription(theme.path),
    }));
    return finish(out, {
      data: { themes },
      human: table(['theme', 'file', 'description'], themes.map((t) => [t.name, t.path, t.description ?? ''])),
    });
  }

  if (sub === 'show') {
    const name = requirePositional(args, 1, 'the theme name');
    const resolved = loadTheme(name);
    return finish(out, { data: { theme: resolved }, human: JSON.stringify(resolved, null, 2) });
  }

  if (sub === 'validate') {
    const name = requirePositional(args, 1, 'the theme name or file path');
    const path = resolveThemePath(name);
    readThemeFile(path); // throws with a precise message when invalid
    const resolved = loadTheme(name);
    return finish(out, {
      data: { path: relative(process.cwd(), path), name: resolved.name, valid: true },
      human: `VALID  ${relative(process.cwd(), path)}  (resolved name: ${resolved.name})`,
    });
  }

  if (sub === 'schema') {
    const schema = loadSchema('theme');
    return finish(out, { data: schema, human: JSON.stringify(schema, null, 2) });
  }

  throw new UsageError('UNKNOWN_SUBCOMMAND', `Unknown subcommand "theme ${sub}".`, {
    hint: 'Available: list, show <name>, validate <name|path>, schema',
  });
}

/**
 * @param {string} path
 * @returns {string|undefined}
 */
function safeDescription(path) {
  try {
    return readThemeFile(path).description;
  } catch {
    return '(invalid)';
  }
}

export { PACKAGE_ROOT };
