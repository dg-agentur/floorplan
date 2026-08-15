import { loadDocument } from '../../model/io.js';
import { resolveLevel } from '../../model/document.js';
import {
  OUTSIDE, adjacency, buildConnectivityGraph, components, findPath, isolatedSpaces, reachableFrom,
} from '../../topology/connectivity.js';
import { boolFlag, parseArgs, requirePositional, stringFlag } from '../args.js';
import { finish, table } from '../output.js';

export const graphSpec = {
  boolean: ['json', 'debug', 'include-windows'],
  string: ['level', 'from', 'to'],
};

/**
 * @param {string[]} argv
 * @param {import('../output.js').OutputContext} out
 * @returns {number}
 */
export function graphCommand(argv, out) {
  const args = parseArgs(argv, graphSpec);
  const file = requirePositional(args, 0, 'the floorplan file');
  const { document: doc } = loadDocument(file);
  const level = resolveLevel(doc, stringFlag(args, 'level'));
  const graph = buildConnectivityGraph(doc, level);
  const passableOnly = !boolFlag(args, 'include-windows');

  const from = stringFlag(args, 'from');
  const to = stringFlag(args, 'to');

  /** @type {Record<string, unknown>} */
  const data = {
    level_id: level.id,
    nodes: graph.nodes,
    edges: graph.edges,
    components: components(graph, { passableOnly }),
    isolated: isolatedSpaces(graph),
  };

  /** @type {string[]} */
  const human = [
    `connectivity of level "${level.id}" (${graph.nodes.length} node(s), ${graph.edges.length} edge(s))`,
    '',
    table(
      ['from', 'via', 'type', 'to', 'width', 'walkable'],
      graph.edges.map((e) => [e.from, e.id, e.type, e.to, `${e.width_mm} mm`, e.passable ? 'yes' : 'no']),
    ),
  ];

  const neighbours = adjacency(graph, { passableOnly });
  data.adjacency = Object.fromEntries([...neighbours.entries()].map(([node, list]) => [node, list]));

  if (from && !to) {
    const reachable = reachableFrom(graph, from, { passableOnly });
    data.reachable_from = { start: from, reachable };
    human.push('', `reachable from "${from}": ${reachable.join(', ') || '(nothing)'}`);
  }
  if (from && to) {
    const path = findPath(graph, from, to, { passableOnly });
    data.path = path;
    human.push('', path
      ? `path ${from} -> ${to}: ${path.nodes.join(' -> ')}  (through ${path.openings.join(', ')})`
      : `no path from "${from}" to "${to}"`);
  }

  const groups = /** @type {string[][]} */ (data.components);
  if (groups.length > 1) {
    human.push('', `warning: the level falls into ${groups.length} unconnected groups:`);
    for (const group of groups) human.push(`  - ${group.join(', ')}`);
  }
  const isolated = /** @type {string[]} */ (data.isolated);
  if (isolated.length > 0) {
    human.push('', `spaces without any opening: ${isolated.join(', ')}`);
  }
  const hasOutside = graph.nodes.some((n) => n.id === OUTSIDE);
  if (hasOutside) {
    const reachable = reachableFrom(graph, OUTSIDE, { passableOnly });
    human.push('', `reachable from outside: ${reachable.join(', ') || '(nothing)'}`);
    data.reachable_from_outside = reachable;
  }

  return finish(out, { data, human: human.join('\n') });
}
