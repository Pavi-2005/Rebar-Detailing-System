const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

/** Presentation mapping only: bar centres are authoritative calculation output. */
export function columnDrawingData(result = {}) {
  const width = finite(result.geometry?.width);
  const depth = finite(result.geometry?.depth);
  const unsupportedLength = finite(result.geometry?.unsupportedLength);
  const tieDiameter = finite(result.ties?.tieDiameter);
  const tieSpacing = finite(result.ties?.selectedSpacing);
  const bars = Array.isArray(result.reinforcement?.bars) ? result.reinforcement.bars : [];
  if (width === null || depth === null || unsupportedLength === null || tieDiameter === null || tieSpacing === null || !bars.length) return null;
  return { width, depth, unsupportedLength, tieDiameter, tieSpacing, bars, diameter: finite(result.reinforcement?.selectedBarDiameter), numberOfBars: finite(result.reinforcement?.numberOfBars), cover: finite(result.geometry?.clearCover), centerX: finite(result.reinforcement?.centerSpacingX), centerY: finite(result.reinforcement?.centerSpacingY), clearX: finite(result.reinforcement?.clearSpacingX), clearY: finite(result.reinforcement?.clearSpacingY) };
}
