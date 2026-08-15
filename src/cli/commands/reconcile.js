import { readJsonFile, saveDocument } from '../../model/io.js';
import { reconcileObservations } from '../../importers/observations/reconcile.js';
import { validateDocument } from '../../validation/validate.js';
import { boolFlag, integerFlag, numberFlag, parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish, table } from '../output.js';

export const reconcileSpec = {
  boolean: ['json', 'debug', 'dry-run', 'force'],
  string: [
    'output', 'min-confidence', 'snap-mm', 'max-host-distance-mm',
    'default-thickness-mm', 'project-name', 'project-id',
  ],
};

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function reconcileCommand(argv, out) {
  const args = parseArgs(argv, reconcileSpec);
  const file = requirePositional(args, 0, 'the observations file');
  const observations = readJsonFile(file, file);

  const result = reconcileObservations(observations, {
    minConfidence: numberFlag(args, 'min-confidence'),
    snapMm: integerFlag(args, 'snap-mm'),
    maxHostDistanceMm: integerFlag(args, 'max-host-distance-mm'),
    defaultThicknessMm: integerFlag(args, 'default-thickness-mm'),
    projectName: stringFlag(args, 'project-name'),
    projectId: stringFlag(args, 'project-id'),
  });

  const report = validateDocument(result.document);
  const output = stringFlag(args, 'output');
  let written = null;
  if (output && !boolFlag(args, 'dry-run')) {
    if (!report.ok && !boolFlag(args, 'force')) {
      return finish(out, {
        data: { input: file, reconciliation: result.report, report, output: null },
        human: `reconciliation produced ${report.counts.ERROR} validation error(s); not written. Use --force to write anyway.`,
        exitCode: 1,
      });
    }
    written = saveDocument(output, result.document);
  }

  const rejected = result.report.entries.filter((entry) => entry.status === 'rejected');
  const human = [
    `source: ${result.report.source.kind} ${result.report.source.uri ?? result.report.source.id}`,
    `observations: ${result.report.entries.length}  accepted ${result.report.counts.accepted}  merged ${result.report.counts.merged}  rejected ${result.report.counts.rejected}`,
    `elements: ${result.report.counts.walls} wall(s), ${result.report.counts.openings} opening(s), ${result.report.counts.spaces} space(s)`,
    `quality: ${result.report.quality} — ${result.report.quality_reason}`,
    `validation: ${report.ok ? 'OK' : 'FAILED'} (errors ${report.counts.ERROR}, warnings ${report.counts.WARNING})`,
    ...(result.report.assumptions.length > 0
      ? ['', 'assumptions made:', ...result.report.assumptions.map((a) => `  - ${a}`)]
      : []),
    ...(rejected.length > 0
      ? ['', 'unused observations:', table(['observation', 'reason'], rejected.map((r) => [r.observation_id, r.reason ?? '']))]
      : []),
    written ? `\nwritten: ${written}` : '',
  ].filter(Boolean).join('\n');

  return finish(out, {
    data: {
      input: file,
      output: written,
      reconciliation: result.report,
      report,
      ...(written ? {} : { document: result.document }),
    },
    human,
    exitCode: report.ok ? 0 : 1,
  });
}
