/**
 * Theme loading, inheritance and validation.
 *
 * Lookup order for a bare theme name:
 *   1. ./themes/<name>.{yaml,yml,json}   (project local, wins)
 *   2. <package>/themes/<name>.{...}     (built in)
 *
 * A path (anything containing a separator or a known extension) is used directly.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';

import { parseYaml } from './yaml.js';
import { DEFAULT_THEME } from './defaults.js';
import { PACKAGE_ROOT, getSchemaValidator } from '../model/io.js';
import { parseJson } from '../util/json.js';
import { FloorplanError, UsageError } from '../util/errors.js';

const EXTENSIONS = ['.yaml', '.yml', '.json'];

/**
 * @returns {string[]} directories searched for themes, in priority order
 */
export function themeSearchPaths() {
  return [resolve(process.cwd(), 'themes'), resolve(PACKAGE_ROOT, 'themes')];
}

/**
 * @returns {Array<{name: string, path: string, builtin: boolean}>}
 */
export function listThemes() {
  /** @type {Map<string, {name: string, path: string, builtin: boolean}>} */
  const found = new Map();
  const paths = themeSearchPaths();
  paths.forEach((directory, priority) => {
    if (!existsSync(directory)) return;
    for (const file of readdirSync(directory).sort()) {
      if (!EXTENSIONS.includes(extname(file))) continue;
      const name = basename(file, extname(file));
      if (!found.has(name)) {
        found.set(name, { name, path: resolve(directory, file), builtin: priority > 0 });
      }
    }
  });
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * @param {string} nameOrPath
 * @returns {string} absolute path
 */
export function resolveThemePath(nameOrPath) {
  const looksLikePath = nameOrPath.includes(sep) || nameOrPath.includes('/')
    || EXTENSIONS.includes(extname(nameOrPath));
  if (looksLikePath) {
    const absolute = resolve(nameOrPath);
    if (!existsSync(absolute)) {
      throw new UsageError('THEME_NOT_FOUND', `Theme file not found: ${nameOrPath}`);
    }
    return absolute;
  }
  for (const directory of themeSearchPaths()) {
    for (const extension of EXTENSIONS) {
      const candidate = resolve(directory, `${nameOrPath}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  const available = listThemes().map((t) => t.name);
  throw new UsageError('THEME_NOT_FOUND', `Unknown theme "${nameOrPath}".`, {
    hint: available.length > 0 ? `Available themes: ${available.join(', ')}` : 'No theme files found.',
  });
}

/**
 * Parse and schema-validate a theme file without resolving inheritance.
 * @param {string} path
 * @returns {any}
 */
export function readThemeFile(path) {
  const text = readFileSync(path, 'utf8');
  const raw = extname(path) === '.json' ? parseJson(text, path) : parseYaml(text, path);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FloorplanError('INVALID_THEME', `${path} does not contain a theme object.`, { exitCode: 2 });
  }
  const errors = getSchemaValidator('theme').validate(raw);
  if (errors.length > 0) {
    throw new FloorplanError(
      'INVALID_THEME',
      `Theme "${basename(path)}" is invalid: ${errors[0].message} (at ${errors[0].pointer || '/'})`,
      {
        exitCode: 2,
        details: errors.slice(0, 10),
        hint: 'Unknown keys are rejected on purpose so that a typo cannot silently disable a setting.',
      },
    );
  }
  return raw;
}

/**
 * Deep merge where objects are merged and everything else is replaced.
 * @param {any} base
 * @param {any} override
 * @returns {any}
 */
export function mergeDeep(base, override) {
  if (override === undefined) return base;
  if (override === null || typeof override !== 'object' || Array.isArray(override)) return override;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(override)) {
    out[key] = mergeDeep(out[key], value);
  }
  return out;
}

/**
 * Load a theme with inheritance resolved and defaults applied.
 * @param {string} [nameOrPath] defaults to the built in default theme
 * @returns {any}
 */
export function loadTheme(nameOrPath) {
  if (!nameOrPath) return structuredClone(DEFAULT_THEME);

  /** @type {any[]} */
  const chain = [];
  /** @type {Set<string>} */
  const seen = new Set();
  let cursor = nameOrPath;
  while (cursor) {
    const path = resolveThemePath(cursor);
    if (seen.has(path)) {
      throw new FloorplanError('THEME_INHERITANCE_CYCLE', `Theme inheritance cycle at "${cursor}".`, { exitCode: 2 });
    }
    seen.add(path);
    const theme = readThemeFile(path);
    chain.unshift(theme);
    cursor = theme.extends;
    if (chain.length > 10) {
      throw new FloorplanError('THEME_INHERITANCE_TOO_DEEP', 'Theme inheritance is more than 10 levels deep.', { exitCode: 2 });
    }
  }

  let resolved = structuredClone(DEFAULT_THEME);
  for (const theme of chain) {
    resolved = mergeDeep(resolved, theme);
  }
  delete resolved.extends;
  return resolved;
}
