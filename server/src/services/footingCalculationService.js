import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const constants = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'constants', 'designConstants.json'), 'utf8'));
const BAR_DIAMETERS = [8, 10, 12, 16, 20, 25, 28, 32];
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const finite = (value) => Number.isFinite(Number(value));
const positive = (values, key) => {
  if (!finite(values[key]) || Number(values[key]) <= 0) throw new Error(`${key} must be a finite value greater than zero.`);
  return Number(values[key]);
};
const status = (pass) => pass ? 'PASS' : 'FAIL';
const check = (name, actual, limit, unit, pass, clause, formula, note = '', statusOverride = null) => ({ name, actual: round(actual), limit: round(limit), unit, status: statusOverride || status(pass), clause, formula, note });

function validate(values) {
  if (!values || typeof values !== 'object') throw new Error('Footing inputs are required.');
  ['columnWidth', 'columnDepth', 'footingLength', 'footingWidth', 'footingThickness', 'clearCover', 'safeBearingCapacity', 'serviceAxialLoad', 'factoredAxialLoad'].forEach((key) => positive(values, key));
  ['serviceMomentX', 'serviceMomentY', 'factoredMomentX', 'factoredMomentY'].forEach((key) => {
    if (!finite(values[key])) throw new Error(`${key} must be a finite number.`);
  });
  if (Number(values.columnWidth) >= Number(values.footingLength) || Number(values.columnDepth) >= Number(values.footingWidth)) throw new Error('Column dimensions must be smaller than the corresponding footing dimensions.');
  if (!constants.concreteGrades[values.concreteGrade]) throw new Error('Unsupported concrete grade.');
  if (!constants.steelGrades[values.steelGrade]) throw new Error('Unsupported reinforcement grade.');
  if (!BAR_DIAMETERS.includes(Number(values.preferredBarDiameter))) throw new Error(`preferredBarDiameter must be one of ${BAR_DIAMETERS.join(', ')} mm.`);
  if (Number(values.clearCover) >= Number(values.footingThickness) - Number(values.preferredBarDiameter) / 2) throw new Error('Cover and preferred bar diameter leave no effective footing depth.');
}

// q(x,y) = P/(LB) + 12My*x/(B L^3) + 12Mx*y/(L B^3), where x is along L and y is along B.
// Mx therefore produces a y-gradient, and My an x-gradient. Coordinates are measured from footing centre.
function pressure(load, mx, my, L, B) {
  const q0 = load / (L * B);
  const ax = 12 * my / (B * L ** 3);
  const ay = 12 * mx / (L * B ** 3);
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => q0 + ax * sx * L / 2 + ay * sy * B / 2));
  return { average: q0, gradientX: ax, gradientY: ay, qmax: Math.max(...corners), qmin: Math.min(...corners), corners: corners.map((q) => round(q)), ex: my / load, ey: mx / load, contact: Math.min(...corners) >= -1e-9 ? 'FULL_COMPRESSION' : 'PARTIAL_CONTACT_NOT_IMPLEMENTED' };
}

function integrateRect(p, x1, x2, y1, y2) {
  const area = (x2 - x1) * (y2 - y1);
  return p.average * area + p.gradientX * ((x2 ** 2 - x1 ** 2) / 2) * (y2 - y1) + p.gradientY * (x2 - x1) * ((y2 ** 2 - y1 ** 2) / 2);
}

function momentOutsideFace(p, L, B, columnWidth, columnDepth) {
  const xFace = columnWidth / 2000;
  const yFace = columnDepth / 2000;
  const momentXSide = (side) => {
    const a = side > 0 ? xFace : -L / 2; const b = side > 0 ? L / 2 : -xFace;
    // Integral q(x,y) * distance to column face, across the complete B width.
    const i0 = ((b - side * xFace) ** 2 - (a - side * xFace) ** 2) / 2;
    const i1 = ((b ** 3 - a ** 3) / 3) - side * xFace * (b ** 2 - a ** 2) / 2;
    return Math.abs(B * (p.average * i0 + p.gradientX * i1));
  };
  const momentYSide = (side) => {
    const a = side > 0 ? yFace : -B / 2; const b = side > 0 ? B / 2 : -yFace;
    const i0 = ((b - side * yFace) ** 2 - (a - side * yFace) ** 2) / 2;
    const i1 = ((b ** 3 - a ** 3) / 3) - side * yFace * (b ** 2 - a ** 2) / 2;
    return Math.abs(L * (p.average * i0 + p.gradientY * i1));
  };
  const alongX = Math.max(momentXSide(1), momentXSide(-1));
  const alongY = Math.max(momentYSide(1), momentYSide(-1));
  return { alongX, alongY, xProjection: L / 2 - xFace, yProjection: B / 2 - yFace, criticalSection: 'At the concrete column face' };
}

function tauC(grade, pt) {
  const table = constants.shearStrengthTable[grade];
  const points = Object.entries(table).map(([percentage, strength]) => ({ percentage: Number(percentage), strength: Number(strength) })).sort((a, b) => a.percentage - b.percentage);
  const keys = points.map((point) => point.percentage);
  const p = Math.max(0.15, Math.min(3, pt));
  const lower = keys.filter((v) => v <= p).at(-1) ?? keys[0];
  const upper = keys.find((v) => v >= p) ?? keys.at(-1);
  const lowerStrength = points.find((point) => point.percentage === lower).strength;
  const upperStrength = points.find((point) => point.percentage === upper).strength;
  const value = lower === upper ? lowerStrength : lowerStrength + (p - lower) / (upper - lower) * (upperStrength - lowerStrength);
  return { value, boundedPercent: p, lower, upper, extrapolated: pt < 0.15 || pt > 3 };
}

function designSteel(Mu, totalWidth, overallDepth, d, fck, fy, preferred, clearCover, direction) {
  const width = 1000;
  const mu = Mu * 1e6;
  const a = 0.87 * fy * fy / (fck * width);
  const b = -0.87 * fy * d;
  const c = mu;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return { status: 'FAIL', reason: 'Required moment exceeds the singly reinforced section equation for the selected depth.' };
  const required = (-b - Math.sqrt(discriminant)) / (2 * a);
  const minimum = 0.0012 * width * overallDepth; // Clause 34.5.1: solid-slab nominal reinforcement, based on D.
  const governing = Math.max(required, minimum);
  const diameter = preferred;
  const area = Math.PI * diameter ** 2 / 4;
  const minClear = Math.max(25, diameter);
  const maxSpacing = Math.min(3 * d, 300);
  const edgeCentreOffset = clearCover + diameter / 2;
  const usableWidth = totalWidth - 2 * edgeCentreOffset;
  if (usableWidth <= 0) return { status: 'FAIL', reason: 'Cover and bar diameter leave no usable reinforcement width.' };
  let bars = 2;
  const densityFor = (count) => area * 1000 / (usableWidth / (count - 1));
  // One discrete arrangement controls both the reported c/c spacing and steel density.
  while (densityFor(bars) < governing && bars < 1000) bars += 1;
  while (usableWidth / (bars - 1) > maxSpacing && bars < 1000) bars += 1;
  const spacing = usableWidth / (bars - 1);
  const clearSpacing = spacing - diameter;
  const providedTotal = bars * area;
  const provided = densityFor(bars);
  const barCenters = Array.from({ length: bars }, (_, index) => round(edgeCentreOffset + index * spacing));
  const momentCapacity = 0.87 * fy * provided * d * (1 - fy * provided / (fck * width * d)) / 1e6;
  const fitPass = barCenters[0] - diameter / 2 >= clearCover && barCenters.at(-1) + diameter / 2 <= totalWidth - clearCover;
  const pass = provided >= governing && spacing <= maxSpacing && clearSpacing >= minClear && momentCapacity >= Mu && fitPass;
  return { direction, Mu: round(Mu), designWidth: width, distributionWidth: totalWidth, overallDepth, effectiveDepth: d, AstRequired: round(required), AstMinimum: round(minimum), AstGoverning: round(governing), AstProvided: round(provided), AstProvidedPerMetre: round(provided), AstProvidedTotal: round(providedTotal), diameter, bars, edgeCentreOffset: round(edgeCentreOffset), usableWidth: round(usableWidth), barCenters, spacing: round(spacing), clearSpacing: round(clearSpacing), maxSpacing: round(maxSpacing), minClearSpacing: minClear, spacingStatus: status(spacing <= maxSpacing && clearSpacing >= minClear), fitStatus: status(fitPass), momentCapacity: round(momentCapacity), capacityStatus: status(momentCapacity >= Mu), status: status(pass), formula: 'Mu = 0.87 fy Ast d (1 - fy Ast/(fck b d)); Ast is calculated from the final bar-centre spacing within the usable width.' };
}

export function generateFootingDesign(values) {
  validate(values);
  const Lmm = positive(values, 'footingLength'); const Bmm = positive(values, 'footingWidth'); const T = positive(values, 'footingThickness');
  const cw = positive(values, 'columnWidth'); const cd = positive(values, 'columnDepth'); const cover = positive(values, 'clearCover');
  const L = Lmm / 1000; const B = Bmm / 1000; const fck = constants.concreteGrades[values.concreteGrade].fck; const fy = constants.steelGrades[values.steelGrade].fy;
  const preferred = Number(values.preferredBarDiameter); const d = T - cover - preferred / 2;
  const includeSelfWeight = values.includeFootingSelfWeight !== false;
  const footingSelfWeight = includeSelfWeight ? L * B * (T / 1000) * 25 : 0;
  const serviceLoad = Number(values.serviceAxialLoad) + footingSelfWeight;
  const ultimateLoad = Number(values.factoredAxialLoad) + (includeSelfWeight ? 1.5 * footingSelfWeight : 0);
  const service = pressure(serviceLoad, Number(values.serviceMomentX), Number(values.serviceMomentY), L, B);
  const ultimate = pressure(ultimateLoad, Number(values.factoredMomentX), Number(values.factoredMomentY), L, B);
  const bearingPass = service.contact === 'FULL_COMPRESSION' && service.qmax <= Number(values.safeBearingCapacity);
  const moments = momentOutsideFace(ultimate, L, B, cw, cd);
  // Bars along X resist the moment caused by the X cantilever; layouts are distributed across B, and conversely for Y.
  const reinforcementX = designSteel(moments.alongX, Bmm, T, d, fck, fy, preferred, cover, 'X (along footing length L)');
  const reinforcementY = designSteel(moments.alongY, Lmm, T, d, fck, fy, preferred, cover, 'Y (along footing width B)');
  const oneWay = (axis, columnDimension, footingDimension, transverseDimension, reinforcement) => {
    const face = columnDimension / 2000; const section = face + d / 1000;
    if (section >= footingDimension / 2) return { axis, status: 'FAIL', reason: 'Effective-depth shear section lies outside the footing projection.' };
    const outside = integrateRect(ultimate, axis === 'X' ? section : -L / 2, axis === 'X' ? L / 2 : L / 2, axis === 'X' ? -B / 2 : section, axis === 'X' ? B / 2 : B / 2);
    // The opposing side is also checked because biaxial pressure may make it governing.
    const opposite = integrateRect(ultimate, axis === 'X' ? -L / 2 : -L / 2, axis === 'X' ? -section : L / 2, axis === 'X' ? -B / 2 : -B / 2, axis === 'X' ? B / 2 : -section);
    const Vu = Math.max(outside, opposite);
    const tauv = Vu * 1000 / (transverseDimension * d);
    const pt = 100 * reinforcement.AstProvidedPerMetre / (1000 * d);
    const concrete = tauC(values.concreteGrade, pt);
    const max = constants.maximumShearStress[values.concreteGrade];
    return { axis, criticalSection: `${round(d)} mm from column face`, Vu: round(Vu), width: transverseDimension, effectiveDepth: d, tauv: round(tauv), pt: round(pt, 4), tauc: round(concrete.value, 4), taucMax: max, status: status(tauv <= concrete.value && tauv <= max), clause: 'IS 456:2000 Clause 34.2.4.1 and Table 19' };
  };
  const oneWayX = oneWay('X', cw, L, Bmm, reinforcementX);
  const oneWayY = oneWay('Y', cd, B, Lmm, reinforcementY);
  const perimeterWidth = cw + d; const perimeterDepth = cd + d; const perimeter = 2 * (perimeterWidth + perimeterDepth);
  const insideReaction = integrateRect(ultimate, -perimeterWidth / 2000, perimeterWidth / 2000, -perimeterDepth / 2000, perimeterDepth / 2000);
  const punchingVu = ultimateLoad - insideReaction;
  const betaC = Math.min(cw, cd) / Math.max(cw, cd); const ks = Math.min(1, 0.5 + betaC); const permissiblePunching = ks * 0.25 * Math.sqrt(fck);
  const punchingStress = punchingVu * 1000 / (perimeter * d);
  const punching = { criticalPerimeter: round(perimeter), offsetFromColumnFace: round(d / 2), perimeterDimensions: { width: round(perimeterWidth), depth: round(perimeterDepth) }, Vu: round(punchingVu), tauv: round(punchingStress, 4), permissible: round(permissiblePunching, 4), ks: round(ks, 4), betaC: round(betaC, 4), status: status(punchingStress <= permissiblePunching), clause: 'IS 456:2000 Clauses 34.2.4.1 and 31.6.1/31.6.3' };
  const longSide = Math.max(Lmm, Bmm); const shortSide = Math.min(Lmm, Bmm); const ratio = longSide / shortSide;
  const centralFraction = Lmm === Bmm ? 1 : 2 / (ratio + 1);
  const shortSteel = Lmm <= Bmm ? reinforcementX : reinforcementY;
  const distribution = { footingAspectRatio: round(ratio), centralBandWidth: shortSide, centralBandFraction: round(centralFraction, 4), centralBandSteel: round(shortSteel.AstProvidedTotal * centralFraction), outerSteel: round(shortSteel.AstProvidedTotal * (1 - centralFraction)), status: 'PASS', clause: 'IS 456:2000 Clause 34.3.1(c)', note: Lmm === Bmm ? 'Square footing: reinforcement is uniformly distributed across the full footing width in each direction.' : 'Long-direction reinforcement is uniform. Short-direction reinforcement is distributed between the central band and equal outer portions.' };
  const basicBond = { M20: 1.2, M25: 1.4, M30: 1.5, M35: 1.7 }[values.concreteGrade]; const tauBd = basicBond * 1.6;
  const development = (r, axis, projection) => { const ld = r.diameter * 0.87 * fy / (4 * tauBd); const available = projection * 1000 - cover; return { axis, ldRequired: round(ld), available: round(available), tauBd: round(tauBd), status: status(available >= ld), clause: 'IS 456:2000 Clauses 34.2.4.3 and 26.2.1 / Table 5' }; };
  const developmentX = development(reinforcementX, 'X', moments.xProjection); const developmentY = development(reinforcementY, 'Y', moments.yProjection);
  const A2 = cw * cd; const A1 = Math.min(Lmm, cw + 4 * T) * Math.min(Bmm, cd + 4 * T); const bearingFactor = Math.min(2, Math.sqrt(A1 / A2)); const columnBaseAction = Number(values.factoredAxialLoad); const transferStress = columnBaseAction * 1000 / A2; const bearingCapacity = 0.45 * fck * bearingFactor;
  const transfer = { columnBaseAction, loadedArea: A2, supportingArea: A1, bearingFactor: round(bearingFactor), transferStress: round(transferStress, 4), permissible: round(bearingCapacity, 4), concreteBearingStatus: status(transferStress <= bearingCapacity), reinforcementTransferStatus: 'VERIFICATION REQUIRED', status: status(transferStress <= bearingCapacity), clause: 'IS 456:2000 Clause 34.4', note: 'Concrete bearing uses the factored column-base action only. Column bars/dowels, their area, continuation and development into the footing are not inputs in this model, so reinforcement load-transfer detailing requires verification.' };
  const checks = [check('Soil bearing pressure', service.qmax, Number(values.safeBearingCapacity), 'kN/m²', bearingPass, 'IS 456:2000 Clause 34.1', 'qmax <= SBC', service.contact === 'FULL_COMPRESSION' ? '' : 'Partial contact is not modelled; a no-tension soil-contact analysis is required.'), check('One-way shear X', oneWayX.tauv, oneWayX.tauc, 'N/mm²', oneWayX.status === 'PASS', oneWayX.clause, 'tauv <= tauc'), check('One-way shear Y', oneWayY.tauv, oneWayY.tauc, 'N/mm²', oneWayY.status === 'PASS', oneWayY.clause, 'tauv <= tauc'), check('Punching shear', punching.tauv, punching.permissible, 'N/mm²', punching.status === 'PASS', punching.clause, 'tauv <= ks x 0.25 sqrt(fck)'), check('Load transfer bearing', transfer.transferStress, transfer.permissible, 'N/mm²', transfer.status === 'PASS', transfer.clause, 'sigma_br <= 0.45 fck x min(sqrt(A1/A2),2)'), check('Development length X', developmentX.ldRequired, developmentX.available, 'mm', developmentX.status === 'PASS', developmentX.clause, 'Ld <= available anchorage'), check('Development length Y', developmentY.ldRequired, developmentY.available, 'mm', developmentY.status === 'PASS', developmentY.clause, 'Ld <= available anchorage')];
  const reinforcementChecks = (axis, r) => [
    check(`Flexural reinforcement ${axis}`, r.AstProvided, r.AstRequired, 'mm2/m', r.AstProvided >= r.AstRequired, 'IS 456:2000 Clauses 34.3 and 38.1', 'Ast,provided >= Ast,required'),
    check(`Minimum reinforcement ${axis}`, r.AstProvided, r.AstMinimum, 'mm2/m', r.AstProvided >= r.AstMinimum, 'IS 456:2000 Clause 34.5.1', 'Ast,provided >= 0.0012 b D'),
    check(`Reinforcement spacing ${axis}`, r.spacing, r.maxSpacing, 'mm', r.spacing <= r.maxSpacing && r.clearSpacing >= r.minClearSpacing, 'IS 456:2000 Clauses 34.5.1 and 26.3.2/26.3.3', 'spacing <= maximum and clear spacing >= minimum'),
    check(`Moment capacity ${axis}`, r.momentCapacity, r.Mu, 'kN m/m', r.capacityStatus === 'PASS', 'IS 456:2000 Clause 38.1', 'Mu,capacity >= Mu,design')
  ];
  checks.splice(1, 0, ...reinforcementChecks('X', reinforcementX), ...reinforcementChecks('Y', reinforcementY));
  checks.push(check('Column-to-footing reinforcement transfer', 0, 0, 'detail', false, 'IS 456:2000 Clauses 34.4.1 to 34.4.3', 'Extended column bars/dowels and their development must be established from detailing inputs.', transfer.note, 'VERIFICATION REQUIRED'));
  const verificationRequired = service.contact !== 'FULL_COMPRESSION' || checks.some((entry) => entry.status === 'VERIFICATION REQUIRED');
  const finalStatus = verificationRequired ? 'VERIFICATION REQUIRED' : checks.some((entry) => entry.status === 'FAIL') || reinforcementX.status === 'FAIL' || reinforcementY.status === 'FAIL' ? 'FAIL' : 'PASS';
  const trace = [
    { section: 'Bearing pressure', formula: 'q(x,y) = P/(LB) + 12My x/(B L³) + 12Mx y/(L B³)', values: `Service qmax = ${round(service.qmax)}; qmin = ${round(service.qmin)} kN/m²`, clause: 'IS 456:2000 Clause 34.1' },
    { section: 'Bending', formula: 'Integrate factored soil reaction over the footing area outside the column-face section.', values: `Mu,X = ${round(moments.alongX)}; Mu,Y = ${round(moments.alongY)} kN·m`, clause: 'IS 456:2000 Clauses 34.2.3.1 and 34.2.3.2' },
    { section: 'Punching shear', formula: 'Critical perimeter at d/2 from column face; tauv = Vu/(u d)', values: `u = ${round(perimeter)} mm; tauv = ${round(punchingStress, 4)} N/mm²`, clause: punching.clause }
  ];
  return { designType: 'Footing', designCode: 'IS 456:2000', inputs: { ...values }, geometry: { footingLength: Lmm, footingWidth: Bmm, footingThickness: T, columnWidth: cw, columnDepth: cd, clearCover: cover, effectiveDepth: round(d), area: round(L * B, 4) }, loads: { serviceColumnLoad: Number(values.serviceAxialLoad), factoredColumnLoad: Number(values.factoredAxialLoad), footingSelfWeight: round(footingSelfWeight), serviceDesignLoad: round(serviceLoad), factoredDesignLoad: round(ultimateLoad), serviceMomentX: Number(values.serviceMomentX), serviceMomentY: Number(values.serviceMomentY), factoredMomentX: Number(values.factoredMomentX), factoredMomentY: Number(values.factoredMomentY) }, soil: { safeBearingCapacity: Number(values.safeBearingCapacity), selfWeightIncluded: includeSelfWeight }, bearingPressure: { service, ultimate }, moments, reinforcement: { x: reinforcementX, y: reinforcementY, distribution }, oneWayShear: { x: oneWayX, y: oneWayY }, punchingShear: punching, developmentLength: { x: developmentX, y: developmentY }, loadTransfer: transfer, checks, finalStatus, designStatus: finalStatus, trace, assumptions: ['Soil-supported isolated rectangular footing with centrally positioned rectangular RCC column.', 'Service SBC is checked against service load effects; bending and shear use supplied factored column actions plus 1.5 times included footing self-weight.', 'Linear full-contact soil-pressure model is used. If qmin is negative, partial-contact analysis is not implemented and final status is VERIFICATION REQUIRED.', 'No dowel design is generated; Clause 34.4 bearing is checked.'] };
}
