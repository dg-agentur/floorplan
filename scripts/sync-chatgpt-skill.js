#!/usr/bin/env node
/**
 * Copy the shared documentation into the ChatGPT skill package.
 *
 * A skill package has to be self-contained, so the references cannot be symlinks.
 * They are therefore GENERATED copies, and tests/integrations.test.js fails when a
 * copy drifts from its original — the same mechanism that keeps
 * schema/operations.schema.json in sync with the operation registry.
 *
 *   node scripts/sync-chatgpt-skill.js
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACKAGE_ROOT } from '../src/model/io.js';

/** Documents copied into the skill, source relative to the package root. */
export const SYNCED_REFERENCES = [
  'agent-contract.md',
  'operations.md',
  'observations.md',
  'provenance.md',
  'themes.md',
];

const TARGET_DIR = resolve(PACKAGE_ROOT, 'integrations/chatgpt/floorplan/references');

mkdirSync(TARGET_DIR, { recursive: true });
for (const name of SYNCED_REFERENCES) {
  const source = resolve(PACKAGE_ROOT, 'docs', name);
  const target = resolve(TARGET_DIR, name);
  copyFileSync(source, target);
  process.stdout.write(`docs/${name} -> integrations/chatgpt/floorplan/references/${name}\n`);
}
process.stdout.write(`${SYNCED_REFERENCES.length} reference(s) synced.\n`);
