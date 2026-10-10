const SUPPORTED_FRAME_CONDITION = 'BRACED_NON_SWAY';
const SUPPORTED_FRAME_CONDITIONS = new Set([SUPPORTED_FRAME_CONDITION, 'UNBRACED_SWAY']);
const DESIGN_INPUT_NAMES = new Set([
  'width', 'depth', 'unsupportedLength', 'clearCover', 'frameCondition',
  'concreteGrade', 'steelGrade', 'factoredAxialLoad', 'momentX', 'momentY',
  'effectiveLength.x.supportCondition', 'effectiveLength.y.supportCondition',
  'swayAnalysis.effectiveLengthX', 'swayAnalysis.effectiveLengthY', 'swayAnalysis.analysisReference',
  'allowZeroMomentDesignCase'
]);

const numberValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value)
  : null;

export function formatColumnNumber(value, digits = 3, fallback = 'Not determined') {
  const numeric = numberValue(value);
  return numeric === null ? fallback : numeric.toFixed(digits);
}

export function formatColumnInteger(value, fallback = 'Not determined') {
  return formatColumnNumber(value, 0, fallback);
}

export function formatColumnLength(value, fallback = 'Not determined') {
  const numeric = numberValue(value);
  return numeric === null ? fallback : numeric.toFixed(3).replace(/\.?0+$/, '');
}

export function snapshotColumnInputs(inputs = {}) {
  return {
    width: numberValue(inputs.width),
    depth: numberValue(inputs.depth),
    unsupportedLength: numberValue(inputs.unsupportedLength),
    clearCover: numberValue(inputs.clearCover),
    frameCondition: inputs.frameCondition ?? null,
    concreteGrade: inputs.concreteGrade ?? null,
    steelGrade: inputs.steelGrade ?? null,
    factoredAxialLoad: numberValue(inputs.factoredAxialLoad),
    momentX: numberValue(inputs.momentX),
    momentY: numberValue(inputs.momentY),
    supportConditionX: inputs.effectiveLength?.x?.supportCondition ?? null,
    supportConditionY: inputs.effectiveLength?.y?.supportCondition ?? null,
    swayEffectiveLengthX: numberValue(inputs.swayAnalysis?.effectiveLengthX),
    swayEffectiveLengthY: numberValue(inputs.swayAnalysis?.effectiveLengthY),
    swayAnalysisReference: inputs.swayAnalysis?.analysisReference ?? null,
    allowZeroMomentDesignCase: inputs.allowZeroMomentDesignCase === true
  };
}

export function columnResultState(result, currentInputs) {
  if (!SUPPORTED_FRAME_CONDITIONS.has(currentInputs?.frameCondition)) return 'unsupported';
  if (!result) return 'empty';
  if (!SUPPORTED_FRAME_CONDITIONS.has(result.frameCondition)) return 'unsupported';
  return JSON.stringify(snapshotColumnInputs(result.inputs)) === JSON.stringify(snapshotColumnInputs(currentInputs))
    ? 'current'
    : 'stale';
}

export function isColumnDesignInput(name) {
  return DESIGN_INPUT_NAMES.has(name);
}
