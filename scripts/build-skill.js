#!/usr/bin/env node
/**
 * Build the self-contained ChatGPT skill bundle.
 *
 *   node scripts/build-skill.js            -> dist/chatgpt/skill.zip (+ unpacked tree)
 *   node scripts/build-skill.js --check    -> build twice and verify reproducibility
 *
 * The bundle follows the Agent Skills layout (a single top level directory named
 * after the skill, containing SKILL.md with YAML frontmatter) and carries the
 * floorplan core with it. At runtime it needs Node >= 20 and nothing else:
 * no git clone, no npm install, no network (ADR 0017).
 *
 * Files are selected from an explicit allow list, never by copying a directory
 * wholesale — that is what keeps private material out of a published artefact.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { PACKAGE_ROOT } from '../src/model/io.js';
import { stringifyStable } from '../src/util/json.js';
import { createZip } from './lib/zip.js';

const SKILL_NAME = 'floorplan';
const SKILL_SOURCE = resolve(PACKAGE_ROOT, 'integrations/chatgpt/floorplan');
const DIST = resolve(PACKAGE_ROOT, 'dist/chatgpt');
const UNPACKED = join(DIST, 'skill');
const ZIP_PATH = join(DIST, 'skill.zip');

/**
 * Paths that must never appear in a published artefact, checked against every
 * collected entry as a second line of defence behind the allow list.
 */
const FORBIDDEN = [
  /(^|\/)Beispiele\//i,
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)dist\//,
  /(^|\/)out\//,
  /\.private\./,
  /(^|\/)tests?\//,
];

/**
 * @typedef {object} Collected
 * @property {string} path  path inside the archive, below the skill directory
 * @property {Buffer} data
 * @property {boolean} [executable]
 */

/**
 * Recursively list files below a directory, filtered by extension.
 * @param {string} root absolute
 * @param {string[]} extensions
 * @returns {string[]} absolute paths, sorted
 */
function listFiles(root, extensions) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return found.sort();
}

/**
 * @param {string} absolute
 * @param {string} archivePath
 * @param {boolean} [executable]
 * @returns {Collected}
 */
function file(absolute, archivePath, executable = false) {
  if (!existsSync(absolute)) throw new Error(`missing input file: ${relative(PACKAGE_ROOT, absolute)}`);
  return { path: archivePath, data: readFileSync(absolute), executable };
}

/**
 * The trimmed package manifest that travels with the core.
 * Deliberately without a "scripts" section: nothing inside the bundle should
 * suggest that an install or build step exists.
 * @param {any} source
 * @returns {object}
 */
function coreManifest(source) {
  return {
    name: source.name,
    version: source.version,
    description: source.description,
    type: 'module',
    private: true,
    license: source.license,
    engines: source.engines,
    bin: { floorplan: 'bin/floorplan.js' },
    main: 'src/index.js',
    dependencies: {},
  };
}

/**
 * @returns {Collected[]}
 */
function collect() {
  const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
  /** @type {Collected[]} */
  const entries = [];

  // --- the skill itself -------------------------------------------------------
  entries.push(file(join(SKILL_SOURCE, 'SKILL.md'), 'SKILL.md'));
  entries.push(file(join(SKILL_SOURCE, 'agents/openai.yaml'), 'agents/openai.yaml'));
  entries.push(file(join(SKILL_SOURCE, 'scripts/floorplan.js'), 'scripts/floorplan.js', true));
  for (const reference of listFiles(join(SKILL_SOURCE, 'references'), ['.md'])) {
    entries.push(file(reference, `references/${relative(join(SKILL_SOURCE, 'references'), reference).split(sep).join('/')}`));
  }
  entries.push(file(resolve(PACKAGE_ROOT, 'LICENSE'), 'LICENSE'));

  // --- the bundled core -------------------------------------------------------
  entries.push(file(resolve(PACKAGE_ROOT, 'bin/floorplan.js'), 'core/bin/floorplan.js', true));
  for (const source of listFiles(resolve(PACKAGE_ROOT, 'src'), ['.js'])) {
    entries.push(file(source, `core/src/${relative(resolve(PACKAGE_ROOT, 'src'), source).split(sep).join('/')}`));
  }
  for (const schema of listFiles(resolve(PACKAGE_ROOT, 'schema'), ['.json'])) {
    entries.push(file(schema, `core/schema/${relative(resolve(PACKAGE_ROOT, 'schema'), schema).split(sep).join('/')}`));
  }
  for (const theme of listFiles(resolve(PACKAGE_ROOT, 'themes'), ['.yaml', '.yml', '.json'])) {
    entries.push(file(theme, `core/themes/${relative(resolve(PACKAGE_ROOT, 'themes'), theme).split(sep).join('/')}`));
  }
  // Fixtures travel along as worked examples of the file formats.
  for (const fixture of listFiles(resolve(PACKAGE_ROOT, 'fixtures'), ['.json'])) {
    entries.push(file(fixture, `core/fixtures/${relative(resolve(PACKAGE_ROOT, 'fixtures'), fixture).split(sep).join('/')}`));
  }
  entries.push(file(resolve(PACKAGE_ROOT, 'LICENSE'), 'core/LICENSE'));
  entries.push({
    path: 'core/package.json',
    data: Buffer.from(stringifyStable(coreManifest(manifest)), 'utf8'),
  });
  entries.push({ path: 'core/VERSION', data: Buffer.from(`${manifest.version}\n`, 'utf8') });

  for (const entry of entries) {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(entry.path)) throw new Error(`refusing to bundle ${entry.path} (matches ${pattern})`);
    }
  }
  return entries;
}

/**
 * @param {Collected[]} entries
 * @param {string} version
 * @returns {Collected}
 */
function buildManifest(entries, version) {
  const files = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((entry) => ({
      path: entry.path,
      bytes: entry.data.length,
      sha256: createHash('sha256').update(entry.data).digest('hex'),
    }));
  return {
    path: 'MANIFEST.json',
    data: Buffer.from(stringifyStable({
      skill: SKILL_NAME,
      version,
      layout: 'agent-skill',
      self_contained: true,
      runtime: { node: '>=20.10.0', install_required: false, network_required: false },
      entry: 'scripts/floorplan.js',
      core: 'core/bin/floorplan.js',
      file_count: files.length,
      files,
    }), 'utf8'),
  };
}

/**
 * @returns {{zip: Buffer, entries: Collected[], version: string}}
 */
export function buildSkill() {
  const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const entries = collect();
  entries.push(buildManifest(entries, manifest.version));
  const zip = createZip(entries.map((entry) => ({
    path: `${SKILL_NAME}/${entry.path}`,
    data: entry.data,
    executable: entry.executable,
  })));
  return { zip, entries, version: manifest.version };
}

/**
 * @param {Collected[]} entries
 */
function writeUnpacked(entries) {
  rmSync(UNPACKED, { recursive: true, force: true });
  for (const entry of entries) {
    const target = join(UNPACKED, SKILL_NAME, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data, { mode: entry.executable ? 0o755 : 0o644 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const first = buildSkill();

  if (check) {
    const second = buildSkill();
    if (!first.zip.equals(second.zip)) {
      process.stderr.write('error: the skill bundle is not reproducible — two builds differ.\n');
      process.exit(1);
    }
  }

  mkdirSync(DIST, { recursive: true });
  writeFileSync(ZIP_PATH, first.zip);
  writeUnpacked(first.entries);

  const digest = createHash('sha256').update(first.zip).digest('hex');
  writeFileSync(`${ZIP_PATH}.sha256`, `${digest}  skill.zip\n`, 'utf8');

  const kib = (first.zip.length / 1024).toFixed(1);
  process.stdout.write([
    `skill:        ${SKILL_NAME} ${first.version}`,
    `files:        ${first.entries.length}`,
    `archive:      ${relative(PACKAGE_ROOT, ZIP_PATH)} (${kib} KiB)`,
    `sha256:       ${digest}`,
    `unpacked:     ${relative(PACKAGE_ROOT, UNPACKED)}/${SKILL_NAME}/`,
    check ? 'reproducible: yes (built twice, byte identical)' : 'reproducible: not checked (use --check)',
    '',
  ].join('\n'));
}
