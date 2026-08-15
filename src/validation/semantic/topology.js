/**
 * Topological consistency.
 *
 * The core rule here: `connects_space_ids` is redundant information. It is
 * useful (imports, partial models without rooms) but it is never the truth —
 * the truth is the geometry. When both exist and disagree, that is a finding.
 */

import { OUTSIDE, components, isolatedSpaces, reachableFrom } from '../../topology/connectivity.js';

/** @typedef {import('../context.js').ValidationContext} ValidationContext */

/**
 * @param {ValidationContext} ctx
 */
export function checkTopology(ctx) {
  for (const { level, graph } of ctx.levels) {
    const openingsById = new Map((level.openings ?? []).map((o) => [o.id, o]));

    for (const connection of graph.connections) {
      const opening = openingsById.get(connection.opening_id);
      if (!opening) continue;

      if (connection.derived_space_ids.length === 0) {
        ctx.report({
          rule: 'OPENING_WITHOUT_SPACE',
          element_id: opening.id,
          level_id: level.id,
          message: `No space was found on either side of opening "${opening.id}".`,
          hint: 'Either the surrounding rooms are missing, or the opening sits in a wall that does not enclose anything.',
        });
      }

      const declared = opening.connects_space_ids;
      if (declared && declared.length > 0) {
        const declaredSorted = [...declared].sort();
        const derived = connection.derived_space_ids;
        const mismatch = declaredSorted.length !== derived.length
          || declaredSorted.some((id, i) => id !== derived[i]);
        if (mismatch) {
          ctx.report({
            rule: 'OPENING_CONNECTIVITY_MISMATCH',
            element_id: opening.id,
            level_id: level.id,
            message: `Opening "${opening.id}" declares connects_space_ids [${declaredSorted.join(', ')}] but geometrically connects [${derived.join(', ') || 'nothing'}]${connection.leads_outside ? ' (one side leads outside)' : ''}.`,
            data: { declared: declaredSorted, derived },
            hint: 'Remove the field or correct it; the geometry is the source of truth.',
          });
        }
      }
    }

    // --- rooms nobody can enter ---------------------------------------------
    for (const spaceId of isolatedSpaces(graph)) {
      ctx.report({
        rule: 'SPACE_ISOLATED',
        element_id: spaceId,
        level_id: level.id,
        message: `Space "${spaceId}" has no door or passage at all.`,
      });
    }

    // --- plan falls apart -----------------------------------------------------
    const groups = components(graph).filter((group) => group.length > 0);
    if (groups.length > 1) {
      ctx.report({
        rule: 'PLAN_DISCONNECTED',
        level_id: level.id,
        message: `Level "${level.id}" splits into ${groups.length} groups of rooms that cannot reach each other: ${groups.map((g) => `[${g.join(', ')}]`).join(' ')}.`,
        data: { groups },
      });
    }

    // --- reachability of the outside -----------------------------------------
    const hasOutside = graph.nodes.some((n) => n.id === OUTSIDE);
    if (hasOutside) {
      const reachable = new Set(reachableFrom(graph, OUTSIDE, { passableOnly: true }));
      for (const node of graph.nodes) {
        if (node.id === OUTSIDE) continue;
        if (!reachable.has(node.id)) {
          ctx.report({
            rule: 'SPACE_WITHOUT_EXIT',
            element_id: node.id,
            level_id: level.id,
            message: `Space "${node.id}" ("${node.name}") cannot reach the outside through doors or passages on this level.`,
            hint: 'This is a geometric observation about the level, not a statement about escape routes or building regulations.',
          });
        }
      }
    }
  }
}
