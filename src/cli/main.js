/**
 * CLI entry point.
 *
 * The CLI is the primary public interface of the platform: every capability of
 * the core is reachable through it, because it is the only interface all agent
 * platforms can drive equally well (docs/adr/0013-cli-contract.md).
 */

import { UsageError } from '../util/errors.js';
import { packageVersion } from '../model/io.js';
import { createOutput, fail, finish } from './output.js';
import { validateCommand, rulesCommand } from './commands/validate.js';
import { inspectCommand } from './commands/inspect.js';
import { applyCommand, undoCommand } from './commands/apply.js';
import { renderCommand } from './commands/render.js';
import { graphCommand } from './commands/graph.js';
import { createCommand } from './commands/create.js';
import { opsCommand } from './commands/ops.js';
import { themeCommand } from './commands/theme.js';
import { schemaCommand } from './commands/schema.js';
import { reconcileCommand } from './commands/reconcile.js';

/** @type {Record<string, {run: (argv: string[], out: any) => number, summary: string, usage: string}>} */
const COMMANDS = {
  create: {
    run: createCommand,
    summary: 'Create a new floorplan document.',
    usage: 'floorplan create <out.floorplan.json> [--template empty|room] [--name <n>] [--width-mm <n> --depth-mm <n>]',
  },
  inspect: {
    run: inspectCommand,
    summary: 'Show structure, areas, openings, connectivity or provenance.',
    usage: 'floorplan inspect <file> [--section summary|levels|walls|openings|spaces|graph|provenance|history|all] [--level <id>]',
  },
  validate: {
    run: validateCommand,
    summary: 'Validate a document against the schema and the semantic rules.',
    usage: 'floorplan validate <file> [--quality marketing|scaled|verified] [--min-severity ERROR|WARNING|INFO]',
  },
  apply: {
    run: applyCommand,
    summary: 'Apply a batch of operations (atomic, reversible).',
    usage: 'floorplan apply <file> <ops.json> [--output <f> | --in-place | --dry-run] [--force] [--stamp <iso>]',
  },
  undo: {
    run: undoCommand,
    summary: 'Undo the most recent operations using the recorded inverses.',
    usage: 'floorplan undo <file> [--steps <n>] [--output <f> | --in-place | --dry-run]',
  },
  render: {
    run: renderCommand,
    summary: 'Render a level to deterministic SVG.',
    usage: 'floorplan render <file> [--theme technical|marketing|minimal|<path>] [--output <f>] [--level <id>] [--force]',
  },
  graph: {
    run: graphCommand,
    summary: 'Show the room connectivity graph and answer reachability questions.',
    usage: 'floorplan graph <file> [--level <id>] [--from <space>] [--to <space>] [--include-windows]',
  },
  reconcile: {
    run: reconcileCommand,
    summary: 'Turn an observation set into a floorplan document, deterministically.',
    usage: 'floorplan reconcile <observations.json> [--output <f>] [--min-confidence <0..1>] [--snap-mm <n>]',
  },
  ops: {
    run: opsCommand,
    summary: 'Discover the change vocabulary: list, describe, template.',
    usage: 'floorplan ops list|describe <op>|template <op...> [--category <c>]',
  },
  theme: {
    run: themeCommand,
    summary: 'List, show or validate rendering themes.',
    usage: 'floorplan theme list|show <name>|validate <name|path>|schema',
  },
  schema: {
    run: schemaCommand,
    summary: 'Print a JSON schema (floorplan, operations, observations, theme).',
    usage: 'floorplan schema [floorplan|operations|observations|theme]',
  },
  rules: {
    run: rulesCommand,
    summary: 'List all validation rules and their severity per quality level.',
    usage: 'floorplan rules',
  },
};

const VERSION = packageVersion();

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns {number} exit code
 */
export function run(argv) {
  const wantsJson = argv.includes('--json');
  const debug = argv.includes('--debug');
  const commandName = argv.find((token) => !token.startsWith('-'));
  const out = createOutput(wantsJson, commandName ?? 'help');

  try {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
      return finish(out, { data: helpData(), human: helpText() });
    }
    if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
      return finish(out, { data: { version: VERSION }, human: VERSION });
    }
    const name = argv[0];
    const command = COMMANDS[name];
    if (!command) {
      throw new UsageError('UNKNOWN_COMMAND', `Unknown command "${name}".`, {
        hint: `Available commands: ${Object.keys(COMMANDS).join(', ')}. Run \`floorplan help\`.`,
      });
    }
    const rest = argv.slice(1);
    if (rest.includes('--help') || rest.includes('-h')) {
      return finish(out, {
        data: { command: name, summary: command.summary, usage: command.usage },
        human: `${command.summary}\n\n${command.usage}`,
      });
    }
    return command.run(rest, out);
  } catch (error) {
    return fail(out, error, debug);
  }
}

/**
 * @returns {object}
 */
function helpData() {
  return {
    version: VERSION,
    commands: Object.entries(COMMANDS).map(([name, command]) => ({
      name, summary: command.summary, usage: command.usage,
    })),
    global_flags: [
      { flag: '--json', description: 'machine readable output: one JSON object on stdout' },
      { flag: '--debug', description: 'print stack traces on internal errors' },
    ],
    exit_codes: {
      0: 'success',
      1: 'domain failure (invalid document, failed operation)',
      2: 'usage failure (bad arguments, missing file, malformed JSON)',
      3: 'internal error',
    },
  };
}

/**
 * @returns {string}
 */
function helpText() {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  return [
    `floorplan ${VERSION} — deterministic floorplan core for humans and AI agents`,
    '',
    'Usage: floorplan <command> [options]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`),
    '',
    'Global options:',
    '  --json    machine readable output (exactly one JSON object on stdout)',
    '  --debug   print stack traces on internal errors',
    '',
    'Exit codes: 0 ok · 1 domain failure · 2 usage failure · 3 internal error',
    '',
    'Agents: read docs/agent-contract.md, then use `floorplan ops list --json`.',
  ].join('\n');
}
