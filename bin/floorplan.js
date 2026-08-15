#!/usr/bin/env node
/**
 * floorplan — deterministic floorplan core for humans and AI agents.
 *
 * No build step and no dependencies: this file runs straight from a git clone
 * (docs/adr/0001-language-and-runtime.md).
 */

import { run } from '../src/cli/main.js';

process.exitCode = run(process.argv.slice(2));
