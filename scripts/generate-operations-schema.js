#!/usr/bin/env node
/**
 * Regenerate schema/operations.schema.json from the operation registry.
 *
 * The registry in src/operations/registry.js is the source of truth. The schema
 * file is a published artifact for external consumers and agents.
 * tests/operations-schema.test.js fails if the two ever drift apart.
 *
 *   node scripts/generate-operations-schema.js
 */

import { resolve } from 'node:path';
import { buildOperationsSchema } from '../src/operations/registry.js';
import { PACKAGE_ROOT, writeJsonFile } from '../src/model/io.js';

const target = resolve(PACKAGE_ROOT, 'schema', 'operations.schema.json');
const written = writeJsonFile(target, buildOperationsSchema());
process.stdout.write(`Wrote ${written}\n`);
