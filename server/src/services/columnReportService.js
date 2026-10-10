import PDFDocument from 'pdfkit';
import { REPORT, checkTable, grid, header, integer, number, section, statusBox, summaryCard, text, traceCard } from './reportPresentation.js';

const value = (input) => input === undefined || input === null || (typeof input === 'number' && !Number.isFinite(input)) ? 'NOT CALCULATED — REQUIRED INPUT/METHOD NOT IMPLEMENTED' : input;

function assertFiniteNumbers(valueToCheck, path = 'result') {
  if (typeof valueToCheck === 'number' && !Number.isFinite(valueToCheck)) throw new Error(`Cannot generate a column PDF from a non-finite value at ${path}.`);
  if (Array.isArray(valueToCheck)) valueToCheck.forEach((entry, index) => assertFiniteNumbers(entry, `${path}[${index}]`));
  if (valueToCheck && typeof valueToCheck === 'object') Object.entries(valueToCheck).forEach(([key, entry]) => assertFiniteNumbers(entry, `${path}.${key}`));
}

function writeReinforcementDetail(doc, result) {
  const geometry = result.geometry || {};
  const reinforcement = result.reinforcement || {};
  const ties = result.ties || {};
  const bars = Array.isArray(reinforcement.bars) ? reinforcement.bars : [];
  const width = Number(geometry.width);
  const depth = Number(geometry.depth);
  if (!Number.isFinite(width) || !Number.isFinite(depth) || !bars.length) return;
  doc.addPage();
  header(doc, 'COLUMN REINFORCEMENT DETAIL', 'Vector detail generated from authoritative calculated bar coordinates. Repeated elevation ties are symbolic, not a tie count.');
  const section = { x: 80, y: 120, width: 210, height: 210 };
  const sx = section.width / width;
  const sy = section.height / depth;
  const horizontalDimension = (x1, x2, y, label) => {
    doc.lineWidth(0.7).strokeColor('#334155').moveTo(x1, y).lineTo(x2, y).stroke();
    doc.save().fillColor('#334155').moveTo(x1, y).lineTo(x1 + 5, y - 2.5).lineTo(x1 + 5, y + 2.5).fill();
    doc.moveTo(x2, y).lineTo(x2 - 5, y - 2.5).lineTo(x2 - 5, y + 2.5).fill().restore();
    doc.fillColor('#000000').fontSize(8).text(label, x1, y - 12, { width: x2 - x1, align: 'center' });
  };
  const verticalDimension = (x, y1, y2, label) => {
    doc.lineWidth(0.7).strokeColor('#334155').moveTo(x, y1).lineTo(x, y2).stroke();
    doc.save().fillColor('#334155').moveTo(x, y1).lineTo(x - 2.5, y1 + 5).lineTo(x + 2.5, y1 + 5).fill();
    doc.moveTo(x, y2).lineTo(x - 2.5, y2 - 5).lineTo(x + 2.5, y2 - 5).fill().restore();
    doc.save().rotate(-90, { origin: [x - 17, (y1 + y2) / 2] }).fillColor('#000000').fontSize(8).text(label, x - 17, (y1 + y2) / 2 - 25, { width: 50, align: 'center' }).restore();
  };
  doc.rect(section.x, section.y, section.width, section.height).fillAndStroke('#e0f2fe', '#0f172a');
  const cover = Number(geometry.clearCover);
  if (Number.isFinite(cover)) doc.rect(section.x + cover * sx, section.y + cover * sy, section.width - 2 * cover * sx, section.height - 2 * cover * sy).lineWidth(2).stroke('#7c3aed');
  bars.forEach((bar) => doc.circle(section.x + section.width / 2 + Number(bar.x) * sx, section.y + section.height / 2 + Number(bar.y) * sy, 5).fillAndStroke('#0284c7', '#ffffff'));
  horizontalDimension(section.x, section.x + section.width, section.y - 2, `${value(geometry.width)} mm`);
  verticalDimension(section.x - 14, section.y, section.y + section.height, `${value(geometry.depth)} mm`);
  if (Number.isFinite(cover)) {
    const coverX = section.x + cover * sx;
    const coverY = section.y + cover * sy;
    doc.lineWidth(0.6).dash(2, { space: 2 }).strokeColor('#334155').moveTo(coverX, coverY).lineTo(section.x + 12, section.y + 48).stroke().undash();
    doc.fillColor('#000000').fontSize(8).text(`${value(geometry.clearCover)} mm clear cover`, section.x + 14, section.y + 42);
    doc.lineWidth(0.6).dash(2, { space: 2 }).strokeColor('#7c3aed').moveTo(coverX, coverY).lineTo(section.x + 145, section.y + 48).stroke().undash();
    doc.fillColor('#000000').fontSize(8).text(`${value(ties.tieDiameter)} mm tie`, section.x + 147, section.y + 42);
  }
  doc.fontSize(11).fillColor('#000000').text('CROSS-SECTION', section.x, 94);
  doc.fontSize(9).text(`${value(geometry.width)} × ${value(geometry.depth)} mm; cover ${value(geometry.clearCover)} mm`, section.x, 345);
  doc.text(`${value(reinforcement.numberOfBars)} × ${value(reinforcement.selectedBarDiameter)} mm bars; ${value(ties.tieDiameter)} mm closed tie`, section.x, 359);
  doc.text(`Centre X/Y ${value(reinforcement.centerSpacingX)} / ${value(reinforcement.centerSpacingY)} mm; clear X/Y ${value(reinforcement.clearSpacingX)} / ${value(reinforcement.clearSpacingY)} mm`, section.x, 373, { width: 240 });
  const elevation = { x: 390, y: 120, width: 115, height: 210 };
  doc.fontSize(11).text('ELEVATION', elevation.x, 94);
  doc.rect(elevation.x, elevation.y, elevation.width, elevation.height).fillAndStroke('#e0f2fe', '#0f172a');
  doc.rect(elevation.x - 8, elevation.y - 8, elevation.width + 16, 7).fill('#94a3b8'); doc.rect(elevation.x - 8, elevation.y + elevation.height + 1, elevation.width + 16, 7).fill('#94a3b8');
  [elevation.x + 20, elevation.x + elevation.width - 20].forEach((x) => doc.moveTo(x, elevation.y + 4).lineTo(x, elevation.y + elevation.height - 4).lineWidth(4).stroke('#0284c7'));
  for (let index = 1; index <= 5; index += 1) doc.rect(elevation.x + 8, elevation.y + index * 34, elevation.width - 16, 3).fill('#7c3aed');
  doc.fillColor('#000000').fontSize(9).text(`Unsupported length: ${value(geometry.unsupportedLength)} mm`, elevation.x, 345);
  doc.text(`Ties: ${value(ties.tieDiameter)} mm @ ${value(ties.selectedSpacing)} mm c/c (symbolic)`, elevation.x, 359, { width: 170 });
  doc.text(`Longitudinal: ${value(reinforcement.numberOfBars)} × ${value(reinforcement.selectedBarDiameter)} mm`, elevation.x, 373);
  // Keep Biaxial Interaction and the checks on this detail page; the previous large
  // moveDown left a mostly unused lower half before the natural page break.
  doc.y = 398;
}

function generateLegacyColumnPdfReport(payload) {
  return new Promise((resolve, reject) => {
    const result = payload.result || {};
    assertFiniteNumbers(result);
    const doc = new PDFDocument({ margin: 36, size: 'A4', compress: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Automatic Rebar Detailing System', { align: 'center' });
    doc.fontSize(12).text('RCC Column Design Report — IS 456:2000', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text('PROJECT');
    doc.fontSize(10).text(`Project: ${value(payload.projectName || 'Untitled Project')}`);
    doc.text(`Designer: ${value(payload.designerName || 'N/A')}`);
    doc.text(`Date: ${value(payload.date || 'N/A')}`);
    doc.moveDown();

    doc.fontSize(14).text('INPUTS');
    doc.fontSize(10);
    doc.text(`Section: ${value(result.geometry?.width)} x ${value(result.geometry?.depth)} mm`);
    doc.text(`Unsupported length: ${value(result.geometry?.unsupportedLength)} mm`);
    doc.text(`Clear cover: ${value(result.geometry?.clearCover)} mm`);
    doc.text(`Concrete / steel: ${value(result.materials?.concreteGrade)} / ${value(result.materials?.steelGrade)}`);
    doc.text(`Pu: ${value(result.inputs?.factoredAxialLoad)} kN`);
    doc.text(`Mux / Muy: ${value(result.inputs?.momentX)} / ${value(result.inputs?.momentY)} kN.m`);
    doc.text(`Frame assumption: ${value(result.frameCondition)}`);
    doc.moveDown();

    doc.fontSize(14).text('SLENDERNESS AND MOMENTS');
    doc.fontSize(10);
    ['x', 'y'].forEach((axis) => {
      doc.text(`${axis.toUpperCase()} axis: le = ${value(result.effectiveLengths?.[axis]?.effectiveLength)} mm; le/dimension = ${value(result.slenderness?.[axis]?.ratio)}; ${value(result.slenderness?.[axis]?.classification)}`);
      doc.text(`  Minimum eccentricity moment: ${value(result.designMoments?.[axis]?.minimumEccentricityMoment)} kN.m; additional moment: ${value(result.designMoments?.[axis]?.additionalMoment)} kN.m; design moment: ${value(result.designMoments?.[axis]?.designMoment)} kN.m`);
      doc.text(`  Formula: ${value(result.designMoments?.[axis]?.formula)} | ${value(result.designMoments?.[axis]?.clause)}`);
    });
    doc.moveDown();

    doc.fontSize(14).text('AXIAL AND REINFORCEMENT DESIGN');
    doc.fontSize(10);
    doc.text(`Concrete contribution: ${value(result.axialCapacity?.concreteContribution)} kN`);
    doc.text(`Steel contribution: ${value(result.axialCapacity?.steelContribution)} kN`);
    doc.text(`Axial capacity: ${value(result.axialCapacity?.capacity)} kN; utilization: ${value(result.axialCapacity?.utilization)}`);
    doc.text(`Longitudinal bars: ${value(result.reinforcement?.numberOfBars)} - ${value(result.reinforcement?.selectedBarDiameter)} mm`);
    doc.text(`Arrangement: ${value(result.reinforcement?.barsPerFace?.widthFaces)} bars on each width face; ${value(result.reinforcement?.barsPerFace?.depthFaces)} bars on each depth face; corners ${value(result.reinforcement?.cornerBars)}; intermediate ${value(result.reinforcement?.intermediateBars)}; symmetric ${value(result.reinforcement?.symmetry)}`);
    doc.text(`Ast required / minimum / provided / maximum: ${value(result.reinforcement?.AstRequired)} / ${value(result.reinforcement?.AstMinimum)} / ${value(result.reinforcement?.AstProvided)} / ${value(result.reinforcement?.maximumSteel)} mm2`);
    doc.text(`Steel requirement: ${value(result.reinforcement?.governingRequirement)}; method: ${value(result.reinforcement?.requiredSteelMethod)}`);
    doc.text(`Steel percentage: ${value(result.reinforcement?.percentage)} %`);
    doc.text(`Centre spacing X / Y: ${value(result.reinforcement?.centerSpacingX)} / ${value(result.reinforcement?.centerSpacingY)} mm`);
    doc.text(`Clear spacing X / Y: ${value(result.reinforcement?.clearSpacingX)} / ${value(result.reinforcement?.clearSpacingY)} mm; minimum: ${value(result.reinforcement?.minimumRequiredSpacing)} mm`);
    doc.text(`Cover definition: ${value(result.reinforcement?.coverDefinition)}`);
    doc.text(`Ties: ${value(result.ties?.tieDiameter)} mm @ ${value(result.ties?.selectedSpacing)} mm c/c`);
    const intermediateBars = result.reinforcement?.intermediateBars;
    const crossTieText = intermediateBars > 0 ? `cross ${value(result.ties?.crossTieLegs)}` : 'no supplementary cross-ties required';
    doc.text(`Tie legs: main ${value(result.ties?.mainTieLegs)}, ${crossTieText}; restrained bars: ${value(result.ties?.restrainedBars?.length)}; unrestrained bars: ${value(result.ties?.unrestrainedBars?.length)}; restraint: ${value(result.ties?.restraintStatus)}`);
    doc.moveDown();

    writeReinforcementDetail(doc, result);

    doc.fontSize(14).text('BIAXIAL INTERACTION');
    doc.fontSize(10);
    doc.text(`Formula: ${value(result.biaxialInteraction?.formula)}`);
    doc.text(`Mux1 / Muy1: ${value(result.biaxialInteraction?.Mux1)} / ${value(result.biaxialInteraction?.Muy1)} kN.m`);
    doc.text(`Exponent: ${value(result.biaxialInteraction?.exponent)}; method: ${value(result.biaxialInteraction?.alphaMethod)}; interaction value: ${value(result.biaxialInteraction?.interactionValue)}; limit: ${value(result.biaxialInteraction?.limit)}`);
    doc.text(`Pu / Puz: ${value(result.biaxialInteraction?.Pu)} / ${value(result.biaxialInteraction?.Puz)} kN = ${value(result.biaxialInteraction?.PuOverPuz)}`);
    doc.text(`Mux1 / Muy1 convergence: ${value(result.biaxialInteraction?.xCapacity?.converged)} / ${value(result.biaxialInteraction?.yCapacity?.converged)}; residuals: ${value(result.biaxialInteraction?.xCapacity?.axialResidual)} / ${value(result.biaxialInteraction?.yCapacity?.axialResidual)} kN`);
    doc.moveDown();

    doc.fontSize(14).text('TRACEABLE CHECKS');
    doc.fontSize(10);
    (result.checks || []).forEach((check) => {
      doc.text(`${value(check.name)}: ${value(check.status)} | actual ${value(check.actual)} ${value(check.unit)} | limit ${value(check.limit)} | ${value(check.clause)}`);
    });
    doc.moveDown();
    doc.fontSize(15).text(`FINAL STATUS: ${value(result.finalStatus)}`);
    doc.fontSize(9).text('Assumptions:');
    (result.assumptions || []).forEach((assumption) => doc.text(`- ${value(assumption)}`));
    doc.end();
  });
}

export function generateColumnPdfReport(payload) {
  return new Promise((resolve, reject) => {
    const result = payload.result || {};
    assertFiniteNumbers(result);
    const doc = new PDFDocument({ margin: REPORT.margin, size: 'A4', compress: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const geometry = result.geometry || {}; const reinforcement = result.reinforcement || {}; const ties = result.ties || {};
    const status = result.finalStatus;
    const reason = (result.checks || []).find((check) => check.status === 'FAIL' || check.status === 'VERIFICATION REQUIRED')?.reason;
    header(doc, 'COLUMN DESIGN REPORT', result.frameCondition === 'UNBRACED_SWAY'
      ? 'IS 456:2000 | External sway-frame inputs; frame model not verified by this column check.'
      : 'IS 456:2000 | Authoritative calculation result');
    statusBox(doc, status, reason);
    section(doc, 'PROJECT / INPUTS', 177);
    grid(doc, [['Project', payload.projectName || 'Column design'], ['Concrete / steel', `${text(result.materials?.concreteGrade)} / ${text(result.materials?.steelGrade)}`], ['Factored axial load Pu', `${number(result.inputs?.factoredAxialLoad)} kN`], ['Mux / Muy', `${number(result.inputs?.momentX)} / ${number(result.inputs?.momentY)} kN-m`], ['Frame condition', text(result.frameCondition)], ['Designer', payload.designerName || 'Not specified']], 200);
    section(doc, 'GEOMETRY / DESIGN CONDITIONS', 308);
    grid(doc, [['Column size', `${integer(geometry.width)} x ${integer(geometry.depth)} mm`], ['Unsupported length', `${integer(geometry.unsupportedLength)} mm`], ['Effective length X / Y', `${integer(result.effectiveLengths?.x?.effectiveLength)} / ${integer(result.effectiveLengths?.y?.effectiveLength)} mm`], ['Clear cover', `${integer(geometry.clearCover)} mm`], ['Slenderness X / Y', `${number(result.slenderness?.x?.ratio)} / ${number(result.slenderness?.y?.ratio)}`], ['Classification X / Y', `${text(result.slenderness?.x?.classification)} / ${text(result.slenderness?.y?.classification)}`]], 331);
    section(doc, 'COLUMN DESIGN SUMMARY', 439);
    summaryCard(doc, 'LONGITUDINAL REINFORCEMENT', reinforcement.status || status, [`${integer(reinforcement.numberOfBars)} x ${integer(reinforcement.selectedBarDiameter)} mm bars`, `Ast required / provided: ${number(reinforcement.AstRequired)} / ${number(reinforcement.AstProvided)} mm2`, `Ast min / max: ${number(reinforcement.AstMinimum)} / ${number(reinforcement.maximumSteel)} mm2`, `Steel percentage: ${number(reinforcement.percentage)} %`, `Clear spacing X / Y: ${number(reinforcement.clearSpacingX)} / ${number(reinforcement.clearSpacingY)} mm`], REPORT.margin, 463);
    summaryCard(doc, 'BIAXIAL INTERACTION / TIES', result.biaxialInteraction?.status || status, [`Interaction: ${number(result.biaxialInteraction?.interactionValue)} / ${number(result.biaxialInteraction?.limit)}`, `Mux1 / Muy1: ${number(result.biaxialInteraction?.Mux1)} / ${number(result.biaxialInteraction?.Muy1)} kN-m`, `Pu / Puz: ${number(result.biaxialInteraction?.Pu)} / ${number(result.biaxialInteraction?.Puz)} kN`, `Exponent alpha: ${number(result.biaxialInteraction?.exponent)}`, `Ties: ${integer(ties.tieDiameter)} mm @ ${integer(ties.selectedSpacing)} mm c/c`], 304, 463);

    const checkValue = (valueToPrint, unit = '') => valueToPrint !== null && valueToPrint !== undefined && valueToPrint !== '' && Number.isFinite(Number(valueToPrint)) ? `${number(valueToPrint)}${unit ? ` ${unit}` : ''}` : `${text(valueToPrint)}${unit ? ` ${unit}` : ''}`;
    // Retains the audited column vector geometry and calculated bar coordinates.
    writeReinforcementDetail(doc, result);
    checkTable(doc, (result.checks || []).map((check) => ({ name: check.name, actual: checkValue(check.actual, check.unit), limit: checkValue(check.limit, check.unit), status: check.status })), 417);

    doc.addPage(); doc.x = REPORT.margin; doc.y = REPORT.margin;
    header(doc, 'CALCULATION TRACE', 'Concise authoritative calculation summary and design limitations.');
    traceCard(doc, 'EFFECTIVE LENGTH / SLENDERNESS', [`X: le = ${number(result.effectiveLengths?.x?.effectiveLength)} mm; ratio = ${number(result.slenderness?.x?.ratio)} (${text(result.slenderness?.x?.classification)})`, `Y: le = ${number(result.effectiveLengths?.y?.effectiveLength)} mm; ratio = ${number(result.slenderness?.y?.ratio)} (${text(result.slenderness?.y?.classification)})`], 108);
    traceCard(doc, 'AXIAL CAPACITY', [`Capacity = ${number(result.axialCapacity?.capacity)} kN; Pu = ${number(result.inputs?.factoredAxialLoad)} kN; utilization = ${number(result.axialCapacity?.utilization)}`, `Concrete / steel contribution = ${number(result.axialCapacity?.concreteContribution)} / ${number(result.axialCapacity?.steelContribution)} kN`], 170);
    traceCard(doc, 'BIAXIAL INTERACTION', [`Mux1 / Muy1 = ${number(result.biaxialInteraction?.Mux1)} / ${number(result.biaxialInteraction?.Muy1)} kN-m; Puz = ${number(result.biaxialInteraction?.Puz)} kN`, `Interaction = ${number(result.biaxialInteraction?.interactionValue)}; limit = ${number(result.biaxialInteraction?.limit)}; ${text(result.biaxialInteraction?.status, status)}`], 232);
    traceCard(doc, 'LONGITUDINAL STEEL / TIES', [`${integer(reinforcement.numberOfBars)} x ${integer(reinforcement.selectedBarDiameter)} mm; Ast provided = ${number(reinforcement.AstProvided)} mm2`, `Tie: ${integer(ties.tieDiameter)} mm @ ${integer(ties.selectedSpacing)} mm c/c; restraint = ${text(ties.restraintStatus)}`], 294);
    if (result.frameCondition === 'UNBRACED_SWAY') {
      doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(`External frame-analysis reference: ${text(result.inputs?.swayAnalysis?.analysisReference)}`, REPORT.margin + 4, 356, { width: REPORT.width - 8 });
      const assumptionsY = Math.max(376, doc.y + 8);
      section(doc, 'ASSUMPTIONS / LIMITATIONS', assumptionsY);
      let assumptionY = assumptionsY + 25;
      (result.assumptions || []).slice(0, 8).forEach((assumption) => {
        doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(`- ${text(assumption)}`, REPORT.margin + 4, assumptionY, { width: REPORT.width - 8 });
        assumptionY = doc.y + 4;
      });
    } else {
      section(doc, 'ASSUMPTIONS / LIMITATIONS', 376);
      (result.assumptions || []).slice(0, 8).forEach((assumption, index) => doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(`- ${text(assumption)}`, REPORT.margin + 4, 401 + index * 19, { width: REPORT.width - 8 }));
    }
    doc.fillColor(REPORT.muted).font('Helvetica').fontSize(7).text('All report values and vector coordinates are formatted directly from the authoritative column calculation result.', REPORT.margin, 744, { width: REPORT.width, align: 'center' });
    doc.end();
  });
}
