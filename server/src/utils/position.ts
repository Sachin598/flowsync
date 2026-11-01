/** Returns a sort position that places an item at `index` between its neighbours (float ordering). */
export function positionAt(positions: number[], index: number): number {
  const i = Math.max(0, Math.min(index, positions.length));
  if (positions.length === 0) return 1000;
  if (i === 0) return positions[0] - 1000;
  if (i === positions.length) return positions[positions.length - 1] + 1000;
  return (positions[i - 1] + positions[i]) / 2;
}
