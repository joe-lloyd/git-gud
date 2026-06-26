// Pure helpers for commit multi-selection in the graph. No React — unit-testable.

/**
 * The contiguous range of SHAs between `anchor` and `target` (inclusive), in
 * the given display order. Used for shift-click range selection. Falls back to
 * just `[target]` when either endpoint isn't found.
 */
export function rangeBetween(order: string[], anchor: string, target: string): string[] {
  const a = order.indexOf(anchor);
  const b = order.indexOf(target);
  if (a < 0 || b < 0) return target ? [target] : [];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

/**
 * Whether `shas` form an unbroken run within `order` (no gaps). A single SHA is
 * contiguous; an empty selection is not.
 */
export function isContiguous(order: string[], shas: string[]): boolean {
  if (shas.length <= 1) return shas.length === 1;
  const idxs = shas.map((s) => order.indexOf(s)).filter((i) => i >= 0).sort((x, y) => x - y);
  if (idxs.length !== shas.length) return false;
  return idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1);
}
