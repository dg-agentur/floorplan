#!/usr/bin/env node
/**
 * Entry point of the ChatGPT skill package.
 *
 * It locates the floorplan core and forwards every argument unchanged. It contains
 * NO floorplan logic of its own — that would be a second, divergent implementation,
 * which the architecture explicitly forbids (see ../references/agent-contract.md).
 *
 * Search order for the core:
 *   1. $FLOORPLAN_HOME
 *   2. a checkout bundled inside this skill  (./core, ../core)
 *   3. the usual sibling locations of a clone
 *   4. a globally linked `floorplan` on PATH
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  process.env.FLOORPLAN_HOME,
  resolve(HERE, 'core'),
  resolve(HERE, '..', 'core'),
  resolve(HERE, '..', '..', '..', '..'),          // inside a full checkout of the platform
  resolve(process.cwd(), 'floorplan-platform'),
  resolve(process.cwd(), '..', 'floorplan-platform'),
].filter(Boolean);

/**
 * @returns {string|null} path to bin/floorplan.js
 */
function findCore() {
  for (const base of CANDIDATES) {
    const entry = resolve(/** @type {string} */ (base), 'bin/floorplan.js');
    if (existsSync(entry)) return entry;
  }
  return null;
}

const core = findCore();

if (core) {
  const result = spawnSync(process.execPath, [core, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

// Fall back to a globally installed binary before giving up.
const global = spawnSync('floorplan', process.argv.slice(2), { stdio: 'inherit' });
if (global.error === undefined && global.status !== null) {
  process.exit(global.status);
}

process.stderr.write(
  [
    'error [CORE_NOT_FOUND]: the floorplan core could not be located.',
    '',
    'Searched:',
    ...CANDIDATES.map((base) => `  - ${resolve(/** @type {string} */ (base), 'bin/floorplan.js')}`),
    '  - a globally installed `floorplan` on PATH',
    '',
    'Fix it with either of:',
    '  export FLOORPLAN_HOME=/path/to/floorplan-platform',
    '  git clone <repo> ./core        # inside this skill directory',
    '',
    'The core needs Node.js >= 20 and has no dependencies: no npm install, no build step.',
    'See references/setup.md.',
    '',
  ].join('\n'),
);
process.exit(2);
