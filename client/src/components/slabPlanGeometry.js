/**
 * Presentation mapping for the normalized slab result. The calculation engine always
 * supplies Lx as the short span and Ly as the long span; the plan deliberately lays
 * Ly on SVG/PDF X and Lx on SVG/PDF Y so its physical proportions remain meaningful.
 */
export function slabPlanAxes(result = {}) {
  const shortSpan = Number(result.shortSpan ?? result.effectiveShortSpan);
  const longSpan = Number(result.longSpan ?? result.effectiveLongSpan);
  if (!Number.isFinite(shortSpan) || !Number.isFinite(longSpan) || shortSpan <= 0 || longSpan <= 0 || shortSpan > longSpan) {
    throw new Error('Slab plan geometry requires finite normalized shortSpan (Lx) and longSpan (Ly).');
  }
  return {
    shortSpan,
    longSpan,
    shortAxis: { name: 'Lx', screenAxis: 'y', barOrientation: 'vertical' },
    longAxis: { name: 'Ly', screenAxis: 'x', barOrientation: 'horizontal' }
  };
}
