#!/usr/bin/env node
/**
 * Run the test suite.
 *
 *   node scripts/run-tests.js [extra node --test flags]
 *
 * Why this exists instead of `node --test tests/`: how the built in runner treats
 * a positional argument changed between Node versions. Node 20 accepts a
 * directory; Node 22 and later interpret positionals as glob patterns and fail
 * with "Cannot find module .../tests". Passing the files explicitly is
 * unambiguous on every supported version — and on Windows, where npm runs scripts
 * through cmd.exe and a shell glob would not be expanded.
 *
 * The file list is sorted, so test execution order is reproducible.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEST_DIR = resolve(ROOT, 'tests');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectTests(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectTests(full));
    else if (entry.endsWith('.test.js')) found.push(full);
  }
  return found;
}

const files = collectTests(TEST_DIR);
if (files.length === 0) {
  process.stderr.write(`No test files found in ${relative(ROOT, TEST_DIR)}.\n`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', ...process.argv.slice(2), ...files],
  { cwd: ROOT, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
