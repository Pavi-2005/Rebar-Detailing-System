import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const constantsPath = path.join(__dirname, '..', 'constants', 'designConstants.json');
const constants = JSON.parse(fs.readFileSync(constantsPath, 'utf8'));

const dataset = constants.slabDeflection;

function round(value, digits = 6) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : value;
}

export const fig4Dataset = {
  version: dataset?.datasetVersion ?? 'fig4-unknown',
  source: dataset?.source ?? 'IS 456:2000 Clause 23.2.1(c), Fig. 4',
  description: dataset?.description ?? 'Approximate digitization of the published Fig. 4 graph.',
  xAxis: dataset?.xAxis ?? 'pt_percent',
  yAxis: dataset?.yAxis ?? 'fs_N_per_mm2',
  validPtRange: dataset?.validPtRange ?? { min: 0.15, max: 2 },
  validFsRange: dataset?.validFsRange ?? { min: 100, max: 350 },
  interpolationMethod: dataset?.interpolation ?? 'Bilinear interpolation within the validated dataset range only.',
  ptValues: [...new Set((dataset?.curves?.[0]?.points ?? []).map((point) => Number(point.pt)))],
  fsValues: [...new Set((dataset?.curves ?? []).map((curve) => Number(curve.fs)))],
  modificationFactors: (dataset?.curves ?? []).flatMap((curve) =>
    (curve.points ?? []).map((point) => ({
      fs: Number(curve.fs),
      pt: Number(point.pt),
      factor: Number(point.factor)
    }))
  )
};

export function validateFig4Dataset() {
  if (!dataset || dataset.xAxis !== 'pt_percent' || dataset.yAxis !== 'fs_N_per_mm2' || !Array.isArray(dataset.curves) || dataset.curves.length < 2) {
    throw new Error('IS 456 Fig. 4 dataset must declare axes and at least two stress curves.');
  }

  const fsValues = dataset.curves.map((curve) => Number(curve.fs));
  if (fsValues.some((value) => !Number.isFinite(value)) || new Set(fsValues).size !== fsValues.length) {
    throw new Error('IS 456 Fig. 4 dataset contains missing or duplicate stress curve labels.');
  }

  const referencePoints = dataset.curves[0].points ?? [];
  if (!Array.isArray(referencePoints) || referencePoints.length < 2) {
    throw new Error('IS 456 Fig. 4 dataset requires at least two pt points per curve.');
  }

  const ptValues = referencePoints.map((point) => Number(point.pt));
  if (ptValues.some((value) => !Number.isFinite(value)) || new Set(ptValues).size !== ptValues.length) {
    throw new Error('IS 456 Fig. 4 dataset contains missing or duplicate pt values.');
  }
  if (ptValues.some((value, index) => index > 0 && value <= ptValues[index - 1])) {
    throw new Error('IS 456 Fig. 4 dataset pt values must be strictly increasing.');
  }

  const sortedFsValues = [...fsValues].sort((left, right) => left - right);
  if (sortedFsValues.some((value, index) => index > 0 && value <= sortedFsValues[index - 1])) {
    throw new Error('IS 456 Fig. 4 dataset fs curves must have unique increasing values.');
  }

  const ptRange = dataRange(dataset.validPtRange, ptValues, 'pt');
  const fsRange = dataRange(dataset.validFsRange, fsValues, 'fs');
  if (ptRange.min < ptValues[0] || ptRange.max > ptValues.at(-1) || fsRange.min < sortedFsValues[0] || fsRange.max > sortedFsValues.at(-1)) {
    throw new Error('IS 456 Fig. 4 validated ranges must be contained within the tabulated dataset.');
  }

  dataset.curves.forEach((curve) => {
    if (!Array.isArray(curve.points) || curve.points.length !== ptValues.length || curve.points.some((point, index) => Number(point.pt) !== ptValues[index] || !Number.isFinite(Number(point.factor)))) {
      throw new Error('IS 456 Fig. 4 dataset has inconsistent pt points or missing factors.');
    }
  });

  return fig4Dataset;
}

function dataRange(range, values, label) {
  if (!range || !Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max)) || Number(range.min) > Number(range.max)) {
    throw new Error(`IS 456 Fig. 4 ${label} validated range is invalid.`);
  }
  return { min: Number(range.min), max: Number(range.max) };
}

export function interpolateFig4ModificationFactor(ptPercent, fsNmm2) {
  const data = validateFig4Dataset();
  const ptValue = Number(ptPercent);
  const fsValue = Number(fsNmm2);

  if (!Number.isFinite(ptValue) || !Number.isFinite(fsValue)) {
    return {
      pt: ptPercent,
      fs: fsNmm2,
      modificationFactor: null,
      status: 'VERIFICATION REQUIRED',
      validInput: false,
      ptClamped: false,
      fsClamped: false,
      clampingApplied: false,
      datasetSource: data.source,
      datasetVersion: data.version,
      interpolationMethod: data.interpolationMethod,
      message: 'Automatic approval could not be established because the Fig. 4 deflection calculation received a non-finite input.',
      // No bracket exists for a non-finite input, so these are explicitly absent
      // rather than left undefined.
      ptLower: null, ptUpper: null, ptInterpolationRatio: null,
      fsLower: null, fsUpper: null, fsInterpolationRatio: null,
      factorAtLowerPtLowerFs: null, factorAtLowerPtUpperFs: null,
      factorAtUpperPtLowerFs: null, factorAtUpperPtUpperFs: null,
      ptRange: data.validPtRange ?? null,
      fsRange: data.validFsRange ?? null
    };
  }

  const ptRange = data.validPtRange ?? { min: Math.min(...data.ptValues), max: Math.max(...data.ptValues) };
  const fsRange = data.validFsRange ?? { min: Math.min(...data.fsValues), max: Math.max(...data.fsValues) };
  const outsidePtRange = ptValue < ptRange.min || ptValue > ptRange.max;
  const outsideFsRange = fsValue < fsRange.min || fsValue > fsRange.max;

  if (outsidePtRange || outsideFsRange) {
    return {
      pt: round(ptValue, 6),
      fs: round(fsValue, 6),
      modificationFactor: null,
      status: 'VERIFICATION REQUIRED',
      validInput: false,
      ptClamped: false,
      fsClamped: false,
      clampingApplied: false,
      datasetSource: data.source,
      datasetVersion: data.version,
      interpolationMethod: data.interpolationMethod,
      // An out-of-range input has no bracket within the validated dataset.
      ptLower: null, ptUpper: null, ptInterpolationRatio: null,
      fsLower: null, fsUpper: null, fsInterpolationRatio: null,
      factorAtLowerPtLowerFs: null, factorAtLowerPtUpperFs: null,
      factorAtUpperPtLowerFs: null, factorAtUpperPtUpperFs: null,
      message: 'Automatic approval could not be established because the deflection modification-factor calculation exceeded the validated Fig. 4 dataset range. No clamping or extrapolation is used.',
      ptRange,
      fsRange,
      rangeViolation: outsidePtRange && outsideFsRange ? 'pt,fs' : outsidePtRange ? 'pt' : 'fs'
    };
  }

  const sortedCurves = [...dataset.curves].sort((left, right) => left.fs - right.fs);
  const ptValues = sortedCurves[0].points.map((point) => Number(point.pt));
  const fsValues = sortedCurves.map((curve) => Number(curve.fs));

  let ptLowerIndex = ptValues.findLastIndex((value) => value <= ptValue);
  let fsLowerIndex = fsValues.findLastIndex((value) => value <= fsValue);

  if (ptLowerIndex === -1) {
    return {
      pt: round(ptValue, 6),
      fs: round(fsValue, 6),
      modificationFactor: null,
      status: 'VERIFICATION REQUIRED',
      validInput: false,
      ptClamped: false,
      fsClamped: false,
      clampingApplied: false,
      datasetSource: data.source,
      datasetVersion: data.version,
      interpolationMethod: data.interpolationMethod,
      message: 'pt value is below the validated Fig. 4 range.',
      rangeViolation: 'pt'
    };
  }

  if (fsLowerIndex === -1) {
    return {
      pt: round(ptValue, 6),
      fs: round(fsValue, 6),
      modificationFactor: null,
      status: 'VERIFICATION REQUIRED',
      validInput: false,
      ptClamped: false,
      fsClamped: false,
      clampingApplied: false,
      datasetSource: data.source,
      datasetVersion: data.version,
      interpolationMethod: data.interpolationMethod,
      message: 'fs value is below the validated Fig. 4 range.',
      rangeViolation: 'fs',
      ptLower: null, ptUpper: null, ptInterpolationRatio: null,
      fsLower: null, fsUpper: null, fsInterpolationRatio: null,
      factorAtLowerPtLowerFs: null, factorAtLowerPtUpperFs: null,
      factorAtUpperPtLowerFs: null, factorAtUpperPtUpperFs: null,
      ptRange,
      fsRange
    };
  }

  if (ptLowerIndex >= ptValues.length - 1) {
    ptLowerIndex = ptValues.length - 2;
  }
  if (fsLowerIndex >= fsValues.length - 1) {
    fsLowerIndex = fsValues.length - 2;
  }

  const ptLower = ptValues[ptLowerIndex];
  const ptUpper = ptValues[ptLowerIndex + 1] ?? ptValues[ptLowerIndex];
  const fsLower = fsValues[fsLowerIndex];
  const fsUpper = fsValues[fsLowerIndex + 1] ?? fsValues[fsLowerIndex];

  const ptInterpolationRatio = ptUpper === ptLower ? 0 : (ptValue - ptLower) / (ptUpper - ptLower);
  const fsInterpolationRatio = fsUpper === fsLower ? 0 : (fsValue - fsLower) / (fsUpper - fsLower);

  const factorAtLowerPtLowerFs = sortedCurves[fsLowerIndex].points[ptLowerIndex].factor;
  const factorAtLowerPtUpperFs = sortedCurves[fsLowerIndex + 1].points[ptLowerIndex].factor;
  const factorAtUpperPtLowerFs = sortedCurves[fsLowerIndex].points[ptLowerIndex + 1].factor;
  const factorAtUpperPtUpperFs = sortedCurves[fsLowerIndex + 1].points[ptLowerIndex + 1].factor;

  const lowerPtFactor = factorAtLowerPtLowerFs + fsInterpolationRatio * (factorAtLowerPtUpperFs - factorAtLowerPtLowerFs);
  const upperPtFactor = factorAtUpperPtLowerFs + fsInterpolationRatio * (factorAtUpperPtUpperFs - factorAtUpperPtLowerFs);
  const modificationFactor = lowerPtFactor + ptInterpolationRatio * (upperPtFactor - lowerPtFactor);

  return {
    pt: round(ptValue, 6),
    fs: round(fsValue, 6),
    ptLower: round(ptLower, 6),
    ptUpper: round(ptUpper, 6),
    fsLower: round(fsLower, 6),
    fsUpper: round(fsUpper, 6),
    ptInterpolationRatio: round(ptInterpolationRatio, 6),
    fsInterpolationRatio: round(fsInterpolationRatio, 6),
    factorAtLowerPtLowerFs: round(factorAtLowerPtLowerFs, 6),
    factorAtLowerPtUpperFs: round(factorAtLowerPtUpperFs, 6),
    factorAtUpperPtLowerFs: round(factorAtUpperPtLowerFs, 6),
    factorAtUpperPtUpperFs: round(factorAtUpperPtUpperFs, 6),
    // The validated dataset ranges are provenance for the reported factor and must be
    // present on the successful path too, not only when the input is out of range.
    ptRange,
    fsRange,
    modificationFactor: round(modificationFactor, 6),
    validInput: true,
    ptClamped: false,
    fsClamped: false,
    clampingApplied: false,
    status: 'PASS',
    datasetSource: data.source,
    datasetVersion: data.version,
    interpolationMethod: data.interpolationMethod,
    message: 'Fig. 4 interpolation used within the validated dataset range.'
  };
}

export default fig4Dataset;
