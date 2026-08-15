/**
 * Tests for the released ChatGPT skill bundle (ADR 0017).
 *
 * The deep behavioural verification — extracting the bundle outside the repository
 * and driving it with a stripped environment — lives in scripts/verify-skill.js and
 * runs in CI as its own step. What is asserted here is the packaging contract:
 * layout, determinism, completeness and the absence of private material.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildSkill } from '../scripts/build-skill.js';
import { createZip, crc32, readZip } from '../scripts/lib/zip.js';
import { PACKAGE_ROOT, packageVersion } from '../src/model/io.js';
import { parseYaml } from '../src/themes/yaml.js';

const built = buildSkill();
const entries = readZip(built.zip);
/** @type {Map<string, Buffer>} */
const files = new Map(entries.map((entry) => [entry.path, entry.data]));

// --- the ZIP writer itself -----------------------------------------------------

test('crc32 matches the known value for a reference input', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('the archive round trips through our own reader', () => {
  const source = [
    { path: 'b.txt', data: Buffer.from('second') },
    { path: 'a/nested.txt', data: Buffer.from('x'.repeat(5000)) },
    { path: 'run.sh', data: Buffer.from('#!/bin/sh\n'), executable: true },
  ];
  const read = readZip(createZip(source));
  assert.deepEqual(read.map((entry) => entry.path), ['a/nested.txt', 'b.txt', 'run.sh'], 'entries are sorted');
  assert.equal(read[1].data.toString(), 'second');
  assert.equal(read[0].data.length, 5000, 'a compressed entry inflates correctly');
  assert.equal(read[2].mode & 0o111, 0o111, 'the executable bit survives');
});

test('the archive is independent of the input order', () => {
  const a = [{ path: 'one', data: Buffer.from('1') }, { path: 'two', data: Buffer.from('2') }];
  assert.ok(createZip(a).equals(createZip([...a].reverse())));
});

test('unsafe and duplicate entry paths are refused', () => {
  assert.throws(() => createZip([{ path: '../escape', data: Buffer.alloc(0) }]), /unsafe entry path/);
  assert.throws(() => createZip([{ path: '/absolute', data: Buffer.alloc(0) }]), /unsafe entry path/);
  assert.throws(
    () => createZip([{ path: 'same', data: Buffer.from('a') }, { path: 'same', data: Buffer.from('b') }]),
    /duplicate entry/,
  );
});

// --- the bundle ------------------------------------------------------------------

test('the build is reproducible', () => {
  assert.ok(buildSkill().zip.equals(built.zip), 'two builds must produce byte identical archives');
});

test('the bundle follows the Agent Skills layout', () => {
  const tops = new Set(entries.map((entry) => entry.path.split('/')[0]));
  assert.deepEqual([...tops], ['floorplan'], 'exactly one top level directory, named after the skill');
  assert.ok(files.has('floorplan/SKILL.md'));
  assert.ok(files.has('floorplan/scripts/floorplan.js'));
  assert.ok(files.has('floorplan/agents/openai.yaml'));
  assert.ok(files.has('floorplan/references/agent-contract.md'));
  assert.ok(files.has('floorplan/LICENSE'));
});

test('SKILL.md frontmatter is valid and uses only standard top level keys', () => {
  const text = /** @type {Buffer} */ (files.get('floorplan/SKILL.md')).toString('utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'SKILL.md must start with YAML frontmatter');
  const frontmatter = /** @type {any} */ (parseYaml(/** @type {RegExpExecArray} */ (match)[1], 'SKILL.md'));

  assert.equal(frontmatter.name, 'floorplan');
  assert.match(frontmatter.name, /^[a-z0-9-]{1,64}$/, 'the name must be a slug');
  assert.equal(typeof frontmatter.description, 'string');
  assert.ok(frontmatter.description.length > 40, 'the description drives skill selection');
  assert.ok(frontmatter.description.length <= 1024, 'the description must stay within 1024 characters');

  const allowed = ['name', 'description', 'license', 'allowed-tools', 'metadata'];
  for (const key of Object.keys(frontmatter)) {
    assert.ok(allowed.includes(key), `unexpected frontmatter key "${key}"`);
  }
  assert.equal(frontmatter.metadata.version, packageVersion(), 'the declared version must match the manifest');
  assert.equal(frontmatter.metadata.install_required, false);
});

test('the bundle carries the whole core, ready to run', () => {
  for (const required of [
    'floorplan/core/bin/floorplan.js',
    'floorplan/core/package.json',
    'floorplan/core/VERSION',
    'floorplan/core/src/index.js',
    'floorplan/core/src/cli/main.js',
    'floorplan/core/schema/floorplan.schema.json',
    'floorplan/core/schema/operations.schema.json',
    'floorplan/core/schema/observations.schema.json',
    'floorplan/core/schema/theme.schema.json',
    'floorplan/core/themes/technical.yaml',
    'floorplan/core/themes/marketing.yaml',
    'floorplan/core/themes/minimal.yaml',
  ]) {
    assert.ok(files.has(required), `missing from the bundle: ${required}`);
  }
  assert.equal(/** @type {Buffer} */ (files.get('floorplan/core/VERSION')).toString().trim(), packageVersion());
});

test('every source file of the core is bundled, byte for byte', () => {
  const bundled = [...files.keys()].filter((path) => path.startsWith('floorplan/core/src/'));
  const { execSync } = /** @type {any} */ (globalThis).process ? { execSync: null } : { execSync: null };
  void execSync;
  assert.ok(bundled.length >= 40, `expected the full source tree, found ${bundled.length} files`);
  for (const path of bundled) {
    const relativePath = path.replace('floorplan/core/', '');
    const original = readFileSync(resolve(PACKAGE_ROOT, relativePath));
    assert.ok(original.equals(/** @type {Buffer} */ (files.get(path))), `${relativePath} differs from the repository`);
  }
});

test('the bundled fixtures are the repository fixtures', () => {
  const fixtures = [...files.keys()].filter((path) => path.startsWith('floorplan/core/fixtures/'));
  assert.ok(fixtures.length >= 7, 'the fixtures serve as worked examples and must travel along');
  for (const path of fixtures) {
    const relativePath = path.replace('floorplan/core/', '');
    assert.ok(
      readFileSync(resolve(PACKAGE_ROOT, relativePath)).equals(/** @type {Buffer} */ (files.get(path))),
      `${relativePath} differs from the repository`,
    );
  }
});

test('nothing private or irrelevant is bundled', () => {
  for (const path of files.keys()) {
    for (const pattern of [/Beispiele/i, /node_modules/, /\.git\//, /\.private\./, /(^|\/)tests?\//, /\/out\//]) {
      assert.equal(pattern.test(path), false, `${path} must not be in a published artefact`);
    }
  }
});

test('the bundle contains nothing that implies an install step', () => {
  const core = JSON.parse(/** @type {Buffer} */ (files.get('floorplan/core/package.json')).toString('utf8'));
  assert.deepEqual(core.dependencies, {});
  assert.equal(core.scripts, undefined, 'shipping npm scripts would suggest a build step exists');
  assert.equal(core.devDependencies, undefined);
  assert.equal([...files.keys()].some((path) => path.includes('package-lock.json')), false);
  assert.equal([...files.keys()].some((path) => path.includes('node_modules')), false);
});

test('MANIFEST.json describes every file with its checksum', () => {
  const manifest = JSON.parse(/** @type {Buffer} */ (files.get('floorplan/MANIFEST.json')).toString('utf8'));
  assert.equal(manifest.skill, 'floorplan');
  assert.equal(manifest.version, packageVersion());
  assert.equal(manifest.self_contained, true);
  assert.equal(manifest.runtime.install_required, false);
  assert.equal(manifest.runtime.network_required, false);
  assert.equal(manifest.file_count, manifest.files.length);
  assert.equal(manifest.files.length + 1, files.size, 'the manifest covers every file except itself');

  for (const file of manifest.files) {
    const data = files.get(`floorplan/${file.path}`);
    assert.ok(data, `manifest lists ${file.path}, which is not in the archive`);
    assert.equal(createHash('sha256').update(/** @type {Buffer} */ (data)).digest('hex'), file.sha256, file.path);
    assert.equal(/** @type {Buffer} */ (data).length, file.bytes, file.path);
  }
});

test('the entry point is executable and forwards rather than reimplements', () => {
  const wrapper = /** @type {Buffer} */ (files.get('floorplan/scripts/floorplan.js')).toString('utf8');
  assert.match(wrapper, /spawnSync/);
  for (const forbidden of ['thickness', 'offset_mm', 'polygon']) {
    assert.equal(wrapper.toLowerCase().includes(forbidden), false, `the wrapper must not contain "${forbidden}"`);
  }
  const entry = entries.find((candidate) => candidate.path === 'floorplan/scripts/floorplan.js');
  assert.equal((/** @type {any} */ (entry).mode & 0o111) !== 0, true, 'the entry point must be executable');
});

test('the bundle stays small enough to upload comfortably', () => {
  assert.ok(built.zip.length < 2 * 1024 * 1024, `bundle is ${(built.zip.length / 1024).toFixed(0)} KiB`);
  assert.ok(built.zip.length > 50 * 1024, 'a suspiciously small bundle probably lost the core');
});
