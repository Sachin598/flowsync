/**
 * Dependency graph helpers. `graph` maps taskId -> ids of tasks that block it (blockedBy).
 */
export type Graph = Map<string, string[]>;

/** True if adding "taskId is blocked by blockerId" would create a cycle (including self-reference). */
export function wouldCreateCycle(graph: Graph, taskId: string, blockerId: string): boolean {
  if (taskId === blockerId) return true;
  // A cycle exists if taskId is reachable from blockerId by following blockedBy edges.
  const seen = new Set<string>();
  const stack = [blockerId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of graph.get(current) ?? []) stack.push(next);
  }
  return false;
}
