import PDFDocument from 'pdfkit';
import { REPORT, checkTable, grid, header, integer, number, section, statusBox, summaryCard, text, traceCard } from './reportPresentation.js';

const NOT_PROVIDED = 'NOT PROVIDED';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function value(valueToPrint, fallback = NOT_PROVIDED) {
  if (valueToPrint === undefined || valueToPrint === null || valueToPrint === 'undefined' || valueToPrint === 'NaN') return fallback;
  if (typeof valueToPrint === 'number' && !Number.isFinite(valueToPrint)) return fallback;
  return valueToPrint;
}

function calculated(name, result, key, unit, clause) {
  const actual = result[key];
  return { name, classification: actual === undefined || actual === null || (typeof actual === 'number' && !Number.isFinite(actual)) ? 'NOT PROVIDED' : 'CALCULATED', value: actual, unit, clause };
}

function underReinforcedCheck(result, flexure) {
  if (!finite(flexure.xu) || !finite(flexure.xuMax)) {
    return { name: 'Under-reinforced check', classification: 'CHECK', value: 'NOT PROVIDED', actual: flexure.xu, limit: flexure.xuMax, unit: '', clause: 'IS 456:2000 Clause 38.1' };
  }
  return {
    name: 'Under-reinforced check',
    classification: 'CHECK',
    value: flexure.xu <= flexure.xuMax ? 'PASS' : 'FAIL',
    actual: flexure.xu,
    limit: flexure.xuMax,
    unit: '',
    clause: 'IS 456:2000 Clause 38.1'
  };
}

/**
 * Authoritative reinforcement layout summary shared by the PDF report and the web diagram.
 * Every value is read from the calculated result: no engineering value is derived here.
 * Face/role metadata comes from the calculated cage, which carries the physical face; the
 * fallback only supports results produced before that metadata existed.
 */
function reinforcementLayout(result = {}) {
  const reinforcement = result.reinforcement || result.reinforcementCage || {};
  const stirrups = reinforcement.stirrups || {};
  const flexuralBars = reinforcement.bottomBars || {};
  const secondaryBars = reinforcement.topBars || {};
  const isContinuous = result.beamType === 'Continuous';
  const isCantilever = result.beamType === 'Cantilever';

  const flexuralFace = flexuralBars.face || (isCantilever ? 'top' : 'bottom');
  const secondaryFace = secondaryBars.face || (isCantilever ? 'bottom' : 'top');
  const flexuralStructuralRole = flexuralBars.structuralRole || 'tension';
  const secondaryStructuralRole = secondaryBars.structuralRole || (isContinuous ? 'tension' : 'hanger/detailing');

  const mainRole = isCantilever
    ? 'Designed flexural reinforcement; physically the top tension steel at the fixed support'
    : isContinuous
      ? 'Designed bottom positive/span flexural reinforcement'
      : 'Bottom main tension reinforcement';
  const secondaryRole = isContinuous
    ? 'Designed top negative-moment/support flexural reinforcement'
    : 'Top hanger/detailing reinforcement; not flexurally designed compression reinforcement';
  const development = result.developmentLength || {};
  const ldRequired = result.developmentLengthRequired ?? reinforcement.developmentLength ?? development.ldRequired ?? null;
  const availableAnchorage = result.developmentLengthAvailable ?? reinforcement.availableAnchorage ?? development.ldAvailable ?? null;
  const anchorageStatus = result.developmentStatus ?? reinforcement.anchorageStatus ?? development.developmentStatus ?? development.status ?? null;

  const groupOf = (bars, face, structuralRole) => ({
    face,
    structuralRole,
    label: bars.label ?? null,
    barCount: bars.barCount ?? bars.count ?? null,
    diameter: bars.diameter ?? null,
    area: bars.area ?? null
  });

  // Which group physically occupies each face, and how that face must be described.
  const topFaceGroup = flexuralFace === 'top'
    ? { bars: flexuralBars, structuralRole: flexuralStructuralRole, designed: true }
    : { bars: secondaryBars, structuralRole: secondaryStructuralRole, designed: false };
  const bottomFaceGroup = flexuralFace === 'top'
    ? { bars: secondaryBars, structuralRole: secondaryStructuralRole, designed: false }
    : { bars: flexuralBars, structuralRole: flexuralStructuralRole, designed: true };
  const faceClassification = (group) => (group.designed || group.structuralRole === 'tension' ? 'CALCULATED' : 'DETAILING/HANGER');
  const faceRowName = (group, face) => (group.designed
    ? `${face === 'top' ? 'Top' : 'Bottom'} flexural tension bars (designed)`
    : group.structuralRole === 'tension'
      ? `${face === 'top' ? 'Top' : 'Bottom'} negative-moment/support bars (designed)`
      : `${face === 'top' ? 'Top' : 'Bottom'} detailing/hanger bars`);
  const faceClauseText = (group, face) => `Physical face = ${face}; structural role = ${group.structuralRole}`
    + (group.designed || group.structuralRole === 'tension' ? '; designed flexural reinforcement' : '; not flexurally designed compression reinforcement');

  const layout = {
    supportType: result.beamType ?? null,
    designType: reinforcement.flexuralModel ?? null,
    span: result.designSpan ?? null,
    beamWidth: result.breadth ?? null,
    beamDepth: result.overallDepth ?? null,
    clearCover: reinforcement.cover ?? null,
    mainTensionBars: flexuralBars.label ?? null,
    mainTensionBarsRole: mainRole,
    mainFace: flexuralFace,
    mainStructuralRole: flexuralStructuralRole,
    secondaryBars: secondaryBars.label ?? null,
    secondaryBarsRole: secondaryRole,
    secondaryFace,
    secondaryStructuralRole,
    groups: [
      groupOf(flexuralBars, flexuralFace, flexuralStructuralRole),
      groupOf(secondaryBars, secondaryFace, secondaryStructuralRole)
    ],
    topFaceBars: flexuralFace === 'top' ? (flexuralBars.label ? `${flexuralBars.label} (main tension steel at the top face)` : null) : (secondaryBars.label ?? null),
    bottomFaceBars: flexuralFace === 'top' ? (secondaryBars.label ? `${secondaryBars.label} (hanger/detailing)` : null) : (flexuralBars.label ?? null),
    stirrupDiameter: stirrups.diameter ?? null,
    stirrupLegs: stirrups.legs ?? null,
    stirrupSpacing: stirrups.spacing ?? result.maximumStirrupSpacing?.provided ?? null,
    stirrupMaximumSpacing: stirrups.maximumSpacing ?? result.maximumStirrupSpacing?.maxPermissible ?? null,
    stirrupArea: stirrups.area ?? null,
    stirrupLabel: stirrups.label ?? null,
    developmentLengthRequired: ldRequired,
    availableAnchorage,
    anchorageStatus,
    compressionReinforcementPresent: false
  };
  layout.rows = [
    { name: 'Support type', classification: 'INPUT', value: layout.supportType, unit: '', clause: 'Beam calculation input' },
    { name: 'Flexural design model', classification: 'MODEL', value: layout.designType, unit: '', clause: 'Beam flexural design model' },
    ...(result.spanMode === 'GEOMETRY'
      ? [
          { name: 'Clear span', classification: 'INPUT', value: result.clearSpan, unit: 'm', clause: 'Beam support geometry input' },
          { name: 'Support width', classification: 'INPUT', value: result.supportWidth, unit: 'mm', clause: 'Beam support geometry input' },
        ]
      : []),
    { name: result.spanMode === 'GEOMETRY' ? 'Calculated Effective Span' : 'Effective/Design Span', classification: result.spanMode === 'GEOMETRY' ? 'CALCULATED' : 'INPUT', value: layout.span, unit: 'm', clause: result.spanDefinition || result.spanSource || 'Beam effective span' },
    { name: 'Beam width b', classification: 'INPUT', value: layout.beamWidth, unit: 'mm', clause: 'Beam calculation input' },
    { name: 'Overall depth D', classification: 'INPUT', value: layout.beamDepth, unit: 'mm', clause: 'Beam calculation input' },
    { name: 'Clear cover', classification: 'INPUT', value: layout.clearCover, unit: 'mm', clause: 'IS 456:2000 Clause 26.4' },
    { name: 'Main tension reinforcement', classification: 'CALCULATED', value: layout.mainTensionBars, unit: '', clause: mainRole },
    { name: `Main tension reinforcement physical face (${flexuralFace})`, classification: 'DERIVED', value: flexuralFace, unit: '', clause: `Physical face = ${flexuralFace}; structural role = ${flexuralStructuralRole}` },
    { name: faceRowName(topFaceGroup, 'top'), classification: faceClassification(topFaceGroup), value: topFaceGroup.bars.label ?? null, unit: '', clause: faceClauseText(topFaceGroup, 'top') },
    { name: faceRowName(bottomFaceGroup, 'bottom'), classification: faceClassification(bottomFaceGroup), value: bottomFaceGroup.bars.label ?? null, unit: '', clause: faceClauseText(bottomFaceGroup, 'bottom') },
    { name: 'Compression reinforcement', classification: 'NOT REQUIRED', value: 'Not required by the implemented singly reinforced flexural model.', unit: '', clause: 'Beam flexural design model' },
    { name: 'Stirrups', classification: finite(stirrups.diameter) ? 'CALCULATED' : 'NOT PROVIDED', value: layout.stirrupLabel, unit: '', clause: 'IS 456:2000 Clause 26.5.1.6' },
    { name: 'Stirrup legs', classification: finite(stirrups.legs) ? 'CALCULATED' : 'NOT PROVIDED', value: layout.stirrupLegs, unit: 'legs', clause: 'IS 456:2000 Clause 26.5.1.6' },
    { name: 'Stirrup diameter', classification: finite(stirrups.diameter) ? 'CALCULATED' : 'NOT PROVIDED', value: layout.stirrupDiameter, unit: 'mm', clause: 'IS 456:2000 Clause 26.5.1.6' },
    { name: 'Stirrup spacing', classification: finite(layout.stirrupSpacing) ? 'CALCULATED' : 'NOT PROVIDED', value: layout.stirrupSpacing, unit: 'mm c/c', clause: 'IS 456:2000 Clause 26.5.1.5' },
    { name: 'Maximum stirrup spacing', classification: finite(layout.stirrupMaximumSpacing) ? 'CALCULATED' : 'NOT PROVIDED', value: layout.stirrupMaximumSpacing, unit: 'mm', clause: 'IS 456:2000 Clause 26.5.1.5' },
    { name: 'Provided stirrup area Asv', classification: finite(stirrups.area) ? 'CALCULATED' : 'NOT PROVIDED', value: layout.stirrupArea, unit: 'mm²', clause: 'IS 456:2000 Clause 26.5.1.6' },
    { name: 'Ld required', classification: finite(ldRequired) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(ldRequired) ? ldRequired : null, unit: finite(ldRequired) ? 'mm' : '', clause: 'IS 456:2000 Clause 26.2' },
    { name: 'Available anchorage', classification: finite(availableAnchorage) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(availableAnchorage) ? availableAnchorage : null, unit: finite(availableAnchorage) ? 'mm' : '', clause: 'Actual support/embedment geometry; a missing value is not zero.' },
    { name: 'Anchorage status', classification: 'CHECK', value: anchorageStatus ?? 'NOT PROVIDED', unit: '', clause: 'IS 456:2000 Clause 26.2' }
  ];
  return layout;
}


function beamReportData(result = {}) {
  const shear = result.shearCalculation || {};
  const flexure = result.momentCapacity || {};
  const deflection = result.deflectionCheck || {};
  const development = result.developmentLength || {};
  const reinforcement = result.reinforcement || result.reinforcementCage || {};
  const developmentLengthRequired = result.developmentLengthRequired ?? reinforcement.developmentLength ?? development.ldRequired;
  const developmentLengthAvailable = result.developmentLengthAvailable ?? reinforcement.availableAnchorage ?? development.ldAvailable;
  const anchorageRatio = result.anchorageRatio ?? reinforcement.anchorageRatio ?? development.anchorageRatio;
  const developmentStatus = result.developmentStatus ?? reinforcement.anchorageStatus ?? development.developmentStatus ?? development.status;
  // Physical face/role metadata is authoritative when present (results produced before the
  // metadata existed only had the "bottomBars = flexural steel" naming convention).
  const flexuralFace = reinforcement.bottomBars?.face || (result.beamType === 'Cantilever' ? 'top' : 'bottom');
  const secondaryFace = reinforcement.topBars?.face || (result.beamType === 'Cantilever' ? 'bottom' : 'top');
  const secondaryStructuralRole = reinforcement.topBars?.structuralRole || (result.continuousDesign ? 'tension' : 'hanger/detailing');
  const faceName = (face) => (face === 'top' ? 'Top' : 'Bottom');
  const faceClause = (face, role) => `Physical face = ${face}; structural role = ${role}`;
  const requiredFields = [
    ['selfWeight', result.selfWeight], ['deadLoad', result.deadLoad], ['serviceLoad', result.serviceLoad], ['effectiveDepth', result.effectiveDepth], ['ultimateLoad', result.ultimateLoad], ['ultimateMoment', result.ultimateMoment], ['ultimateShear', result.ultimateShear],
    ['requiredAreaSteel', result.requiredAreaSteel], ['minimumReinforcement', result.minimumReinforcement], ['maximumReinforcement', result.maximumReinforcement], ['providedAreaSteel', result.providedAreaSteel],
    ['barArea', result.barArea], ['clearSpacingBetweenBars', result.clearSpacingBetweenBars], ['momentCapacity.xu', flexure.xu], ['momentCapacity.xuMax', flexure.xuMax], ['momentCapacity.muProvided', flexure.muProvided],
    ['shearCalculation.tauv', shear.tauv], ['shearCalculation.tauC', shear.tauC], ['shearCalculation.tauCFullPrecision', shear.tauCFullPrecision], ['shearCalculation.tauCMax', shear.tauCMax], ['shearCalculation.vc', shear.vc], ['shearCalculation.vusProvided', shear.vusProvided], ['shearCalculation.providedSpacing', result.maximumStirrupSpacing?.provided], ['shearCalculation.maxSpacing', result.maximumStirrupSpacing?.maxPermissible],
    ['developmentLength.ld', development.ld], ['developmentLength.availableAnchorage', development.availableAnchorage], ['deflectionCheck.actualLd', deflection.actualLd], ['deflectionCheck.permissibleLd', deflection.permissibleLd], ['deflectionCheck.modificationFactor', deflection.modificationFactor], ['deflectionCheck.serviceStress', deflection.serviceStress]
  ];
  const verificationFields = ['developmentLength.availableAnchorage'];
  const missingRequired = requiredFields.filter(([fieldName, fieldValue]) => {
    if (verificationFields.includes(fieldName) && result.designStatus === 'VERIFICATION REQUIRED') return false;
    if (fieldName.startsWith('deflectionCheck.') && deflection.status === 'VERIFICATION REQUIRED') return false;
    return !finite(fieldValue);
  });
  const sourceChecks = Array.isArray(result.checks) ? result.checks : [];
  const authoritativeUnderReinforced = underReinforcedCheck(result, flexure);
  const checks = sourceChecks.map((check) => check.name === 'Under-reinforced section'
    ? { ...check, status: authoritativeUnderReinforced.value, actual: authoritativeUnderReinforced.actual, limit: authoritativeUnderReinforced.limit, message: `${value(authoritativeUnderReinforced.actual)} mm <= ${value(authoritativeUnderReinforced.limit)} mm` }
    : check);
  const requiredCheckNames = ['Flexural capacity', 'Minimum steel', 'Maximum steel', 'Under-reinforced section', 'Longitudinal spacing', 'Concrete shear capacity', 'Maximum shear stress', 'Minimum shear reinforcement', 'Stirrup capacity', 'Maximum stirrup spacing', 'Deflection', 'Development length', 'Anchorage adequacy'];
  const missingChecks = requiredCheckNames.filter((name) => !checks.some((check) => check.name === name));
  const checksComplete = requiredCheckNames.every((name) => checks.some((check) => check.name === name)) && checks.every((check) => check.status === 'PASS' && finite(Number(check.actual)) && (check.limit === null || check.limit === undefined || finite(Number(check.limit))));
  const hasFailedCheck = checks.some((check) => check.status === 'FAIL');
  const hasVerificationRequired = checks.some((check) => check.status === 'VERIFICATION REQUIRED') || result.designStatus === 'VERIFICATION REQUIRED';
  const incompleteCalculation = missingRequired.length > 0 || missingChecks.length > 0 || authoritativeUnderReinforced.value === 'NOT PROVIDED';
  // Authoritative Beam status vocabulary: PASS / FAIL / VERIFICATION REQUIRED. This fallback is only
  // used when a result arrives without a finalStatus of its own; incomplete or failed calculations
  // are forced to FAIL by the expression below, exactly as before.
  const fallbackStatus = checksComplete && !hasVerificationRequired ? 'PASS' : 'VERIFICATION REQUIRED';

  return {
    finalStatus: incompleteCalculation || hasFailedCheck ? 'FAIL' : (result.finalStatus || fallbackStatus),
    missingRequired: missingRequired.map(([name]) => name),
    missingChecks,
    inputs: [
      ...(result.spanMode === 'GEOMETRY'
        ? [
            { name: 'Clear span', classification: 'INPUT', value: result.clearSpan, unit: 'm', clause: result.spanSource || 'Beam support geometry input' },
            { name: 'Support width', classification: 'INPUT', value: result.supportWidth, unit: 'mm', clause: 'Beam support geometry input' },
            { name: 'Calculated Effective Span', classification: 'CALCULATED', value: result.designSpan, unit: 'm', clause: result.spanDefinition },
          ]
        : [
            { name: 'Effective/Design Span', classification: 'INPUT', value: result.designSpan, unit: 'm', clause: `${result.spanSource || 'Directly supplied by user.'} Clear span and support width were not provided; therefore no effective-span derivation was performed.` },
            { name: 'Clear span', classification: 'NOT PROVIDED', value: 'NOT PROVIDED', unit: 'm', clause: 'Not provided' },
            { name: 'Support width', classification: 'NOT PROVIDED', value: 'NOT PROVIDED', unit: 'mm', clause: 'Not provided' },
          ]),
      { name: 'Width', classification: 'INPUT', value: result.breadth, unit: 'mm', clause: 'Beam calculation input' },
      { name: 'Overall depth', classification: 'INPUT', value: result.overallDepth, unit: 'mm', clause: 'Beam calculation input' },
      { name: 'Support type', classification: 'INPUT', value: result.beamType, unit: '', clause: 'Beam calculation input' },
      { name: 'Superimposed dead load', classification: 'INPUT', value: result.loads?.superimposedDeadLoad ?? result.appliedDeadLoad, unit: 'kN/m', clause: 'Beam calculation input; beam self-weight is calculated automatically and added separately.' },
      { name: 'Live load', classification: 'INPUT', value: result.loads?.liveLoad ?? result.liveLoad, unit: 'kN/m', clause: 'Beam calculation input' },
      { name: 'Unit weight of concrete', classification: 'INPUT', value: result.unitWeightConcrete, unit: 'kN/m³', clause: 'Beam calculation input' }
    ],
    loads: [
      calculated('Self weight', result, 'selfWeight', 'kN/m', 'Derived from b × D × unit weight'),
      calculated('Total dead load', result, 'deadLoad', 'kN/m', 'Beam calculation service'),
      calculated('Service load', result, 'serviceLoad', 'kN/m', 'Beam calculation service'),
      calculated('Ultimate load', result, 'ultimateLoad', 'kN/m', '1.5(DL + LL), IS 456:2000 load combination assumption'),
      calculated('Ultimate moment Mu', result, 'ultimateMoment', 'kN.m', 'Support-type beam action calculation'),
      calculated('Ultimate shear Vu', result, 'ultimateShear', 'kN', 'Support-type beam action calculation')
    ],
    flexure: [
      ...(result.continuousDesign ? [
        { name: 'Positive/span moment Mu+', classification: 'CALCULATED', value: result.continuousDesign.positive.mu, unit: 'kN.m', clause: result.analysisModel },
        { name: 'Negative/support moment Mu-', classification: 'CALCULATED', value: result.continuousDesign.negative.mu, unit: 'kN.m', clause: result.analysisModel },
        { name: 'Required Ast+', classification: 'CALCULATED', value: result.continuousDesign.positive.requiredAst, unit: 'mm2', clause: 'Positive/span flexural design' },
        { name: 'Required Ast-', classification: 'CALCULATED', value: result.continuousDesign.negative.requiredAst, unit: 'mm2', clause: 'Negative/support flexural design' },
        { name: 'Bottom positive-moment reinforcement', classification: 'DERIVED', value: result.continuousDesign.positive.reinforcement, unit: '', clause: 'Positive/span flexural design' },
        { name: 'Top negative-moment/support reinforcement', classification: 'DERIVED', value: result.continuousDesign.negative.reinforcement, unit: '', clause: 'Negative/support flexural design' },
        { name: 'Positive moment capacity', classification: 'CALCULATED', value: result.continuousDesign.positive.momentCapacity, unit: 'kN.m', clause: 'IS 456:2000 Clause 38.1' },
        { name: 'Negative moment capacity', classification: 'CALCULATED', value: result.continuousDesign.negative.momentCapacity, unit: 'kN.m', clause: 'IS 456:2000 Clause 38.1' },
        { name: 'Positive flexural status', classification: 'CHECK', value: result.continuousDesign.positive.momentCapacity >= result.continuousDesign.positive.mu && result.continuousDesign.positive.underReinforced ? 'PASS' : 'FAIL', unit: '', clause: 'IS 456:2000 Clause 38.1' },
        { name: 'Negative flexural status', classification: 'CHECK', value: result.continuousDesign.negative.momentCapacity >= result.continuousDesign.negative.mu && result.continuousDesign.negative.underReinforced ? 'PASS' : 'FAIL', unit: '', clause: 'IS 456:2000 Clause 38.1' },
        { name: 'Negative under-reinforced check', classification: 'CHECK', value: result.continuousDesign.negative.underReinforced ? 'PASS' : 'FAIL', unit: '', clause: 'IS 456:2000 Clause 38.1' }
      ] : []),
      calculated('Effective depth d', result, 'effectiveDepth', 'mm', 'IS 456:2000 Clause 38.1'),
      calculated('Required Ast', result, 'requiredAreaSteel', 'mm²', 'IS 456:2000 Clauses 38.1 and 38.2'),
      calculated('Minimum Ast', result, 'minimumReinforcement', 'mm²', 'IS 456:2000 Clause 26.5.1.1'),
      calculated('Provided Ast', result, 'providedAreaSteel', 'mm²', 'Selected beam reinforcement'),
      calculated('Maximum Ast', result, 'maximumReinforcement', 'mm²', 'IS 456:2000 Clause 26.5.1.1'),
      calculated('xu', flexure, 'xu', 'mm', 'IS 456:2000 Clause 38.1'),
      calculated('xu,max', flexure, 'xuMax', 'mm', 'IS 456:2000 Clause 38.1'),
      calculated('Moment capacity', flexure, 'muProvided', 'kN.m', 'IS 456:2000 Clauses 38.1 and 38.2'),
      authoritativeUnderReinforced,
      { name: 'Flexural design model', classification: 'MODEL', value: reinforcement.flexuralModel || 'Singly reinforced section', unit: '', clause: 'Beam flexural design model' },
      { name: 'Longitudinal arrangement', classification: reinforcement.bottomBars?.status === 'VERIFICATION REQUIRED' ? 'NOT PROVIDED' : 'DERIVED', value: reinforcement.bottomBars?.label, unit: '', clause: 'IS 456:2000 Clause 26.3.3' },
      { name: `${faceName(flexuralFace)} bars (physical ${flexuralFace} face)`, classification: reinforcement.bottomBars?.label ? 'DERIVED' : 'NOT AVAILABLE', value: reinforcement.bottomBars?.label, unit: '', clause: `Designed flexural tension reinforcement; ${faceClause(flexuralFace, reinforcement.bottomBars?.structuralRole || 'tension')}` },
      { name: `${faceName(secondaryFace)} bars`, classification: secondaryStructuralRole === 'tension' ? 'DERIVED' : 'DETAILING/HANGER', value: reinforcement.topBars?.label, unit: '', clause: `${faceClause(secondaryFace, secondaryStructuralRole)}${secondaryStructuralRole === 'tension' ? '' : '; not flexurally designed compression reinforcement'}` },
      calculated('Clear spacing', result, 'clearSpacingBetweenBars', 'mm', 'IS 456:2000 Clause 26.3.3'),
      { name: 'Clear cover', classification: finite(reinforcement.cover) ? 'CALCULATED' : 'NOT PROVIDED', value: reinforcement.cover, unit: 'mm', clause: 'IS 456:2000 Clause 26.4' }
    ],
    reinforcement: [
      { name: 'Flexural design model', classification: 'MODEL', value: reinforcement.flexuralModel, unit: '', clause: 'Singly reinforced section' },
      { name: `${faceName(flexuralFace)} flexural tension bars (physical ${flexuralFace} face)`, classification: reinforcement.bottomBars?.label ? 'CALCULATED' : 'VERIFICATION REQUIRED', value: reinforcement.bottomBars?.label, unit: '', clause: `Selected flexural reinforcement; ${faceClause(flexuralFace, reinforcement.bottomBars?.structuralRole || 'tension')}` },
      { name: secondaryStructuralRole === 'tension' ? `${faceName(secondaryFace)} negative-moment/support bars` : `${faceName(secondaryFace)} detailing/hanger bars`, classification: reinforcement.topBars?.label ? (reinforcement.topBars?.status === 'VERIFICATION REQUIRED' ? 'VERIFICATION REQUIRED' : secondaryStructuralRole === 'tension' ? 'CALCULATED' : 'DETAILING/HANGER') : 'VERIFICATION REQUIRED', value: reinforcement.topBars?.label, unit: '', clause: `${faceClause(secondaryFace, secondaryStructuralRole)}${secondaryStructuralRole === 'tension' ? '' : '; not flexurally designed compression reinforcement'}${reinforcement.topBars?.status === 'VERIFICATION REQUIRED' ? '; arrangement could not satisfy the detailing minimum — engineering verification required' : ''}` },
      { name: 'Stirrups', classification: reinforcement.stirrups?.label ? 'CALCULATED' : 'VERIFICATION REQUIRED', value: reinforcement.stirrups?.label, unit: '', clause: 'IS 456:2000 Clause 26.5.1.6' },
      { name: 'Clear cover', classification: finite(reinforcement.cover) ? 'CALCULATED' : 'VERIFICATION REQUIRED', value: reinforcement.cover, unit: 'mm', clause: 'IS 456:2000 Clause 26.4' },
      { name: 'Ld required', classification: finite(developmentLengthRequired) ? 'CALCULATED' : 'VERIFICATION REQUIRED', value: developmentLengthRequired, unit: 'mm', clause: 'IS 456:2000 Clause 26.2' },
      { name: 'Ld available', classification: finite(developmentLengthAvailable) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(developmentLengthAvailable) ? developmentLengthAvailable : 'NOT PROVIDED', unit: finite(developmentLengthAvailable) ? 'mm' : '', clause: 'Actual support/embedment geometry' },
      { name: 'Anchorage ratio', classification: finite(anchorageRatio) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(anchorageRatio) ? anchorageRatio : 'NOT PROVIDED', unit: '', clause: 'Ld available / Ld required' },
      { name: 'Bar termination', classification: reinforcement.terminationLocation === null || reinforcement.terminationLocation === undefined ? 'VERIFICATION REQUIRED' : 'INPUT', value: reinforcement.terminationLocation, unit: 'mm setback from support face', clause: development.terminationDefinition || 'Curtailment geometry input' }
    ],
    shear: [
      calculated('Vu', shear, 'vu', 'N', 'IS 456:2000 Clause 40'),
      { name: 'Concrete shear capacity status', classification: 'CHECK', value: shear.concreteShearStatus || 'NOT PROVIDED', unit: '', clause: 'IS 456:2000 Table 19' },
      { name: 'Shear reinforcement capacity status', classification: 'CHECK', value: shear.shearReinforcementStatus || 'NOT PROVIDED', unit: '', clause: 'IS 456:2000 Clause 40.4' },
      { name: 'Overall shear design status', classification: 'CHECK', value: shear.overallShearStatus || 'NOT PROVIDED', unit: '', clause: 'IS 456:2000 Clauses 40 and 26.5.1.6' },
      { name: 'Maximum shear stress status', classification: 'CHECK', value: shear.maximumShearStressStatus || 'NOT PROVIDED', unit: '', clause: 'IS 456:2000 Table 20' },
      { name: 'Minimum shear reinforcement status', classification: 'CHECK', value: shear.minShearPass === true ? 'PASS' : 'FAIL', unit: '', clause: 'IS 456:2000 Clause 26.5.1.6' },
      { name: 'Maximum stirrup spacing status', classification: 'CHECK', value: shear.maxStirrupPass === true ? 'PASS' : 'FAIL', unit: '', clause: 'IS 456:2000 Clause 26.5.1.5' },
      calculated('Effective depth d', shear, 'd', 'mm', 'IS 456:2000 Clause 40'),
      calculated('Ast used for Table 19', shear, 'ast', 'mm²', 'IS 456:2000 Table 19'),
      calculated('Tension steel percentage pt', shear, 'pt', '%', 'IS 456:2000 Table 19'),
      calculated('pt (unrounded)', shear, 'ptFullPrecision', '%', 'IS 456:2000 Table 19 — interpolation input; τc and Vc derive from this value'),
      calculated('τv', shear, 'tauv', 'N/mm²', 'IS 456:2000 Clause 40'),
      calculated('τc', shear, 'tauC', 'N/mm²', 'IS 456:2000 Table 19 — displayed to 3 decimal places'),
      calculated('τc (unrounded)', shear, 'tauCFullPrecision', 'N/mm²', 'IS 456:2000 Table 19 interpolation — Vc is computed from this unrounded value'),
      calculated('τc,max', shear, 'tauCMax', 'N/mm²', 'IS 456:2000 Table 20'),
      calculated('Concrete shear capacity Vc', shear, 'vc', 'N', 'IS 456:2000 Clause 40'),
      calculated('Required shear reinforcement Vus', shear, 'vusRequired', 'N', 'IS 456:2000 Clause 40'),
      { name: 'Concrete shear capacity', classification: 'CHECK', value: shear.concreteShearStatus || 'NOT PROVIDED', unit: '', clause: 'IS 456:2000 Clause 40' },
      { name: 'Excess shear reinforcement required', classification: 'CALCULATED', value: finite(shear.vusRequired) ? shear.vusRequired : null, unit: 'N', clause: 'IS 456:2000 Clause 40' },
      { name: 'Minimum shear reinforcement', classification: 'CHECK', value: result.minimumShearReinforcement?.checkPass ? `${result.minimumShearReinforcement.providedRatio} >= ${result.minimumShearReinforcement.requiredRatio}` : 'FAIL', unit: 'Asv/(b x Sv) vs 0.4/(0.87 fy)', clause: 'IS 456:2000 Clause 26.5.1.6' },
      { name: 'Minimum shear reinforcement — provided Asv/(b x Sv)', classification: 'CALCULATED', value: finite(result.minimumShearReinforcement?.providedRatio) ? result.minimumShearReinforcement.providedRatio : null, unit: '', clause: 'IS 456:2000 Clause 26.5.1.6' },
      { name: 'Minimum shear reinforcement — required 0.4/(0.87 fy)', classification: 'CALCULATED', value: finite(result.minimumShearReinforcement?.requiredRatio) ? result.minimumShearReinforcement.requiredRatio : null, unit: '', clause: 'IS 456:2000 Clause 26.5.1.6' },
      { name: 'Minimum shear reinforcement — provided Asv/(b x Sv) as percentage', classification: 'CALCULATED', value: finite(result.minimumShearReinforcement?.providedRatioPercent) ? result.minimumShearReinforcement.providedRatioPercent : null, unit: '%', clause: 'IS 456:2000 Clause 26.5.1.6' },
      { name: 'Minimum shear reinforcement — required 0.4/(0.87 fy) as percentage', classification: 'CALCULATED', value: finite(result.minimumShearReinforcement?.requiredRatioPercent) ? result.minimumShearReinforcement.requiredRatioPercent : null, unit: '%', clause: 'IS 456:2000 Clause 26.5.1.6' },
      calculated('Selected stirrup diameter', shear, 'stirrupDiameter', 'mm', 'IS 456:2000 Clause 26.5.1.6'),
      calculated('Stirrup legs', shear, 'legs', 'legs', 'IS 456:2000 Clause 26.5.1.6'),
      { name: 'Stirrup spacing', classification: finite(result.maximumStirrupSpacing?.provided) ? 'CALCULATED' : 'NOT PROVIDED', value: result.maximumStirrupSpacing?.provided, unit: 'mm c/c', clause: 'IS 456:2000 Clause 26.5.1.5' },
      { name: 'Maximum stirrup spacing', classification: finite(result.maximumStirrupSpacing?.maxPermissible) ? 'CALCULATED' : 'NOT PROVIDED', value: result.maximumStirrupSpacing?.maxPermissible, unit: 'mm', clause: 'IS 456:2000 Clause 26.5.1.5' },
      calculated('Stirrup capacity Vus provided', shear, 'vusProvided', 'N', 'IS 456:2000 Clause 40.4'),
      { name: 'Shear status', classification: 'CHECK', value: result.shearStatus, unit: '', clause: 'IS 456:2000 Clauses 40 and 26.5.1.6' }
    ],
    development: [
      calculated('Development length Ld required', reinforcement, 'developmentLength', 'mm', 'IS 456:2000 Clause 26.2'),
      { name: 'Gross embedment', classification: finite(development.grossEmbedment) ? 'INPUT' : 'NOT PROVIDED', value: finite(development.grossEmbedment) ? development.grossEmbedment : 'NOT PROVIDED', unit: finite(development.grossEmbedment) ? 'mm' : '', clause: development.availableAnchorageSource || 'Actual support/embedment geometry' },
      { name: 'Anchorage deduction', classification: finite(development.anchorageDeduction) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(development.anchorageDeduction) ? development.anchorageDeduction : 'NOT PROVIDED', unit: finite(development.anchorageDeduction) ? 'mm' : '', clause: 'Available anchorage derivation' },
      { name: 'Ld available', classification: finite(reinforcement.availableAnchorage) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(reinforcement.availableAnchorage) ? reinforcement.availableAnchorage : 'NOT PROVIDED', unit: finite(reinforcement.availableAnchorage) ? 'mm' : '', clause: development.availableAnchorageCalculation || development.availableAnchorageSource || 'Beam support geometry' },
      { name: 'Anchorage ratio Ld available / Ld required', classification: finite(reinforcement.anchorageRatio) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(reinforcement.anchorageRatio) ? reinforcement.anchorageRatio : 'NOT PROVIDED', unit: '', clause: 'IS 456:2000 Clause 26.2' },
      { name: 'Development check', classification: 'CHECK', value: reinforcement.anchorageStatus || development.status || (development.checkPass ? 'PASS' : 'FAIL'), unit: '', clause: 'IS 456:2000 Clause 26.2' },
      { name: 'Bar termination', classification: reinforcement.terminationSetbackFromSupportFace === null || reinforcement.terminationSetbackFromSupportFace === undefined ? 'VERIFICATION REQUIRED' : 'INPUT', value: reinforcement.terminationSetbackFromSupportFace, unit: 'mm setback from support face', clause: development.terminationDefinition || 'Curtailment geometry input' },
      { name: 'Available embedment', classification: finite(reinforcement.availableEmbedmentLength) ? 'CALCULATED' : 'NOT PROVIDED', value: finite(reinforcement.availableEmbedmentLength) ? reinforcement.availableEmbedmentLength : 'NOT PROVIDED', unit: finite(reinforcement.availableEmbedmentLength) ? 'mm' : '', clause: 'Actual support/embedment geometry' },
      { name: 'Reason', classification: development.verificationRequired ? 'VERIFICATION REQUIRED' : 'CALCULATED', value: development.verificationRequired ? 'VERIFICATION REQUIRED — ANCHORAGE GEOMETRY INCOMPLETE' : development.anchorageAssumption, unit: '', clause: 'Actual support/embedment geometry' },
      { name: 'Status', classification: 'CHECK', value: development.status || 'VERIFICATION REQUIRED', unit: '', clause: 'IS 456:2000 Clause 26.2' }
    ],
    deflection: [
      calculated('Governing span', result, 'designSpan', 'm', 'Beam effective/design span'),
      calculated('Actual L/d', deflection, 'actualLd', '', 'IS 456:2000 Clause 23.2'),
      calculated('Basic L/d', deflection, 'basicRatio', '', 'IS 456:2000 Clause 23.2'),
      calculated('Tension steel percentage', deflection, 'pt', '%', 'IS 456:2000 Clause 23.2'),
      calculated('Service stress fs', deflection, 'serviceStress', 'N/mm²', 'IS 456:2000 Clause 23.2.1(c)'),
      calculated('Modification factor', deflection, 'modificationFactor', '', 'IS 456:2000 Clause 23.2.1(c), Fig. 4'),
      calculated('Permissible L/d', deflection, 'permissibleLd', '', 'IS 456:2000 Clause 23.2'),
      { name: 'Deflection status', classification: 'CHECK', value: deflection.status, unit: '', clause: 'IS 456:2000 Clause 23.2' }
    ],
    checks,
    reinforcementLayout: reinforcementLayout(result),
    assumptions: ['Beam loads are line loads in kN/m; no tributary-width conversion is performed.', result.spanDefinition, ...(result.continuousDesign ? ['Continuous beam design uses the implemented coefficient-based UDL method for the supported beam configuration. This is not a general multi-span frame analysis.'] : []), development.anchorageAssumption, 'Beam self-weight is calculated automatically and added separately from superimposed dead load.', 'Reinforcement arrangement scope: longitudinal bar lengths, curtailment locations and stirrup positions are not calculated by this design engine. Only the listed bar groups, counts, diameters, areas, stirrup spacing and clear cover are authoritative; any drawn or implied bar extents are schematic.', ...(Array.isArray(result.designLimitations) ? result.designLimitations : []), 'Deflection uses an approximate digitization of IS 456 Fig. 4 for software estimation; engineering verification is recommended. The dataset is not an exact reproduction of the code graph.']
  };
}

function writeSection(doc, title, entries) {
  doc.fontSize(14).text(title);
  doc.fontSize(10);
  entries.forEach((entry) => doc.text(`${entry.name}: [${entry.classification}] ${value(entry.value)}${entry.unit ? ` ${entry.unit}` : ''} | ${entry.clause}`));
  doc.moveDown(0.7);
}

function generateLegacyBeamPdfReport(payload) {
  return new Promise((resolve, reject) => {
    const result = payload.result || {};
    const data = beamReportData(result);
    const doc = new PDFDocument({ margin: 36, size: 'A4', compress: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Automatic Rebar Detailing System', { align: 'center' });
    doc.fontSize(12).text('RCC Beam Design Report — IS 456:2000', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Project: ${value(payload.projectName || 'Untitled Project')}`);
    doc.text(`Designer: ${value(payload.designerName || 'N/A')}`);
    doc.text(`Date: ${value(payload.date || 'N/A')}`);
    doc.moveDown();
    writeSection(doc, 'INPUTS', data.inputs);
    writeSection(doc, 'LOADS', data.loads);
    writeSection(doc, 'FLEXURAL DESIGN', data.flexure);
    writeSection(doc, 'REINFORCEMENT CAGE', data.reinforcement);
    writeSection(doc, 'REINFORCEMENT LAYOUT SUMMARY (SHARES THE SAME AUTHORITATIVE CAGE)', data.reinforcementLayout.rows);
    writeSection(doc, 'SHEAR DESIGN', data.shear);
    writeSection(doc, 'DEVELOPMENT / ANCHORAGE', data.development);
    writeSection(doc, 'DEFLECTION', data.deflection);
    writeSection(doc, 'FINAL CHECKS', data.checks.map((check) => ({ name: check.name, classification: 'CHECK', value: check.status, unit: '', clause: check.clause })));
    doc.text(`Final status: ${data.finalStatus}`);
    if (data.missingRequired.length) doc.text(`Missing required fields: ${data.missingRequired.join(', ')}`);
    if (data.missingChecks.length) doc.text(`Missing required checks: ${data.missingChecks.join(', ')}`);
    doc.moveDown();
    doc.text('ASSUMPTIONS / LIMITATIONS');
    data.assumptions.forEach((assumption) => doc.text(`[ASSUMPTION] ${assumption}`));
    doc.end();
  });
}

function drawBeamDetail(doc, result, layout) {
  const x = 56; const y = 132; const width = 450; const height = 100;
  doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(10.5).text('ELEVATION', x, 108);
  doc.rect(x, y, width, height).fillAndStroke('#e0f2fe', REPORT.ink);
  doc.rect(x - 8, y + height, 16, 8).fill('#94a3b8'); doc.rect(x + width - 8, y + height, 16, 8).fill('#94a3b8');
  const top = layout.groups?.find((group) => group.face === 'top') || {}; const bottom = layout.groups?.find((group) => group.face === 'bottom') || {};
  const lineBars = (group, yy, color, left = x, span = width) => { const count = Math.max(1, Math.min(12, Number(group.barCount) || 1)); for (let index = 0; index < count; index += 1) { const xx = left + 12 + index * (span - 24) / Math.max(1, count - 1); doc.circle(xx, yy, 2.3).fill(color); } };
  lineBars(top, y + 14, REPORT.violet); lineBars(bottom, y + height - 14, REPORT.cyan);
  const stirrupCount = 9; for (let index = 0; index < stirrupCount; index += 1) { const xx = x + 20 + index * (width - 40) / (stirrupCount - 1); doc.rect(xx - 4, y + 8, 8, height - 16).lineWidth(.45).strokeColor('#475569').stroke(); }
  doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(`Design span = ${number(result.designSpan)} m; support type = ${text(result.beamType)}`, x, 242, { width });
  doc.fillColor(REPORT.violet).text(`Top: ${text(layout.topFaceBars)}`, x, 256, { width }); doc.fillColor(REPORT.cyan).text(`Bottom: ${text(layout.bottomFaceBars)}`, x, 269, { width });
  doc.fillColor(REPORT.muted).text(`Stirrups: ${text(layout.stirrupLabel)}; b x D = ${integer(result.breadth)} x ${integer(result.overallDepth)} mm; cover = ${integer(layout.clearCover)} mm`, x, 282, { width });
  doc.fillColor(REPORT.muted).fontSize(7).text('Bar positions are a vector schematic. Bar groups, faces, counts and labels are read from the authoritative reinforcement cage.', x, 296, { width });
  const breadth = Number(result.breadth); const overallDepth = Number(result.overallDepth); const sectionScale = 150 / Math.max(breadth, overallDepth);
  const s = { x: 277 - breadth * sectionScale / 2, y: 349, w: breadth * sectionScale, h: overallDepth * sectionScale };
  doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(10.5).text('CROSS-SECTION', 190, 327, { width: 174, align: 'center' });
  doc.rect(s.x, s.y, s.w, s.h).fillAndStroke('#e0f2fe', REPORT.ink);
  const cover = Number(layout.clearCover); const coverX = Number.isFinite(cover) ? Math.min(s.w / 3, cover * sectionScale) : 10; const coverY = Number.isFinite(cover) ? Math.min(s.h / 3, cover * sectionScale) : 10;
  doc.rect(s.x + coverX, s.y + coverY, s.w - 2 * coverX, s.h - 2 * coverY).lineWidth(1.2).strokeColor('#475569').stroke();
  lineBars(top, s.y + coverY + 5, REPORT.violet, s.x + coverX, s.w - 2 * coverX); lineBars(bottom, s.y + s.h - coverY - 5, REPORT.cyan, s.x + coverX, s.w - 2 * coverX);
  doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(`${integer(result.breadth)} mm`, s.x, s.y + s.h + 8, { width: s.w, align: 'center' });
  doc.save().rotate(-90, { origin: [s.x - 14, s.y + s.h / 2] }).text(`${integer(result.overallDepth)} mm`, s.x - 34, s.y + s.h / 2 - 24, { width: 48, align: 'center' }).restore();
}

export function generateBeamPdfReport(payload) {
  return new Promise((resolve, reject) => {
    const result = payload.result || {}; const data = beamReportData(result); const layout = data.reinforcementLayout || {};
    const doc = new PDFDocument({ margin: REPORT.margin, size: 'A4', compress: false }); const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const reason = data.checks.find((check) => check.status === 'FAIL' || check.status === 'VERIFICATION REQUIRED')?.reason || data.missingRequired[0];
    header(doc, 'BEAM DESIGN REPORT', 'IS 456:2000 | Authoritative calculation result'); statusBox(doc, data.finalStatus, reason);
    section(doc, 'PROJECT / INPUTS', 177); grid(doc, [['Project', payload.projectName || 'Beam design'], ['Concrete / steel', `${text(result.concreteGrade)} / ${text(result.steelGrade)}`], ['Support condition', text(result.beamType)], ['Design span', `${number(result.designSpan)} m`], ['Dead / live load', `${number(result.loads?.superimposedDeadLoad ?? result.appliedDeadLoad)} / ${number(result.loads?.liveLoad ?? result.liveLoad)} kN/m`], ['Designer', payload.designerName || 'Not specified']], 200);
    section(doc, 'GEOMETRY / DESIGN CONDITIONS', 308); grid(doc, [['Beam width / depth', `${integer(result.breadth)} / ${integer(result.overallDepth)} mm`], ['Effective depth', `${integer(result.effectiveDepth)} mm`], ['Clear cover', `${integer(result.reinforcement?.cover)} mm`], ['Ultimate load', `${number(result.ultimateLoad)} kN/m`], ['Ultimate moment Mu', `${number(result.ultimateMoment)} kN-m`], ['Ultimate shear Vu', `${number(result.ultimateShear)} kN`]], 331);
    section(doc, 'BEAM DESIGN SUMMARY', 439);
    summaryCard(doc, 'FLEXURAL REINFORCEMENT', result.flexureStatus || data.finalStatus, [text(layout.mainTensionBars), `Ast required / provided: ${number(result.requiredAreaSteel)} / ${number(result.providedAreaSteel)} mm2`, `Moment demand / capacity: ${number(result.ultimateMoment)} / ${number(result.momentCapacity?.muProvided)} kN-m`, `Face: ${text(layout.mainFace)}; clear spacing: ${number(result.clearSpacingBetweenBars)} mm`, `Under-reinforced: ${text(data.checks.find((check) => check.name === 'Under-reinforced section')?.status)}`], REPORT.margin, 463);
    const availableAnchorage = Number.isFinite(Number(layout.availableAnchorage)) && layout.availableAnchorage !== null && layout.availableAnchorage !== undefined ? `${number(layout.availableAnchorage)} mm` : 'NOT ESTABLISHED';
    summaryCard(doc, 'SHEAR / STIRRUPS', result.shearStatus || data.finalStatus, [text(layout.stirrupLabel), `tauv / tauc: ${number(result.shearCalculation?.tauv)} / ${number(result.shearCalculation?.tauC)} N/mm2`, `Stirrup spacing: ${number(layout.stirrupSpacing)} mm c/c`, `Ld required: ${number(layout.developmentLengthRequired)} mm; available: ${availableAnchorage}`, `Anchorage: ${text(layout.anchorageStatus)}`], 304, 463);
    const checkValue = (value, unit = '') => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? `${number(value)}${unit ? ` ${unit}` : ''}` : `${text(value)}${unit ? ` ${unit}` : ''}`;
    doc.addPage(); header(doc, 'BEAM REINFORCEMENT DETAIL', 'Vector schematic generated from authoritative beam geometry and reinforcement data.'); drawBeamDetail(doc, result, layout);
    doc.addPage(); doc.x = REPORT.margin; doc.y = REPORT.margin; header(doc, 'BEAM DESIGN CHECKS', 'Authoritative demands, capacities, limits and check statuses.');
    checkTable(doc, data.checks.map((check) => ({ name: check.name, actual: checkValue(check.actual, check.unit), limit: checkValue(check.limit, check.unit), status: check.status })), 108);
    doc.addPage(); header(doc, 'CALCULATION TRACE', 'Concise authoritative calculation summary and design limitations.');
    traceCard(doc, 'LOADS', [`Service load = ${number(result.serviceLoad)} kN/m; ultimate load = ${number(result.ultimateLoad)} kN/m`, `Design span = ${number(result.designSpan)} m; support type = ${text(result.beamType)}`], 108);
    traceCard(doc, 'FLEXURE', [`Mu = ${number(result.ultimateMoment)} kN-m; Ast required / provided = ${number(result.requiredAreaSteel)} / ${number(result.providedAreaSteel)} mm2`, `Capacity = ${number(result.momentCapacity?.muProvided)} kN-m; xu / xu,max = ${number(result.momentCapacity?.xu)} / ${number(result.momentCapacity?.xuMax)} mm`], 170);
    traceCard(doc, 'SHEAR / STIRRUPS', [`Vu = ${text(result.shearCalculation?.vu)} N; tauv / tauc = ${text(result.shearCalculation?.tauv)} / ${text(result.shearCalculation?.tauC)} N/mm2; Vc = ${text(result.shearCalculation?.vc)} N`, `Vus required = ${text(result.shearCalculation?.vusRequired)} N; stirrup = ${text(layout.stirrupLabel)}; status = ${text(result.shearStatus)}`], 232);
    traceCard(doc, 'DEVELOPMENT / DEFLECTION', [`Ld required: ${number(layout.developmentLengthRequired)} mm; available anchorage: ${availableAnchorage}; ${text(layout.anchorageStatus)}`, `L/d actual / permissible = ${number(result.deflectionCheck?.actualLd)} / ${number(result.deflectionCheck?.permissibleLd)}; ${text(result.deflectionCheck?.status)}`], 294);
    section(doc, 'REINFORCEMENT LAYOUT SUMMARY (SHARES THE SAME AUTHORITATIVE CAGE)', 376);
    data.reinforcement.filter((entry) => /physical|flexural tension|negative-moment|detailing\/hanger|Stirrups/.test(entry.name)).slice(0, 4).forEach((entry, index) => doc.fillColor(REPORT.ink).font('Helvetica').fontSize(7.6).text(`${entry.name}: ${text(entry.value)}; ${text(entry.clause)}`, REPORT.margin + 4, 401 + index * 14, { width: REPORT.width - 8 }));
    section(doc, 'ASSUMPTIONS / LIMITATIONS', 468); const disclosedAssumptions = [...data.assumptions.filter(Boolean).slice(0, 5), ...data.assumptions.filter((assumption) => /bar lengths, curtailment locations and stirrup positions are not calculated|Only singly reinforced flexural design is implemented/.test(assumption))];
    [...new Set(disclosedAssumptions)].slice(0, 8).forEach((assumption, index) => doc.fillColor(REPORT.ink).font('Helvetica').fontSize(7.6).text(`- ${text(assumption)}`, REPORT.margin + 4, 493 + index * 17, { width: REPORT.width - 8 }));
    doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(8).text(`Final status: ${text(data.finalStatus)}`, REPORT.margin, 720, { width: REPORT.width });
    doc.fillColor(REPORT.muted).font('Helvetica').fontSize(7).text('All report values and vector labels are formatted directly from the authoritative beam calculation result.', REPORT.margin, 744, { width: REPORT.width, align: 'center' }); doc.end();
  });
}

export { beamReportData };
