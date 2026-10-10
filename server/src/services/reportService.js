import PDFDocument from 'pdfkit';
import { generateColumnPdfReport } from './columnReportService.js';
import { generateBeamPdfReport } from './beamReportService.js';
import { REPORT, checkTable, grid, header, integer, number, section, statusBox, summaryCard, text, traceCard } from './reportPresentation.js';

// Semantic classification labels, matching the philosophy used by the Beam report so a
// reader can tell an input from a calculated value, a derived value, a check outcome and
// an explicitly unresolved item.
const CLASSIFICATIONS = {
  INPUT: '[INPUT]',
  CALCULATED: '[CALCULATED]',
  DERIVED: '[DERIVED]',
  CHECK: '[CHECK]',
  VERIFICATION_REQUIRED: '[VERIFICATION REQUIRED]',
  NOT_REQUIRED: '[NOT REQUIRED]'
};

const NOT_PROVIDED = 'NOT PROVIDED';
const NOT_ESTABLISHED = 'NOT ESTABLISHED';

/** Renders "label: value" with a semantic classification tag, never a blank or NaN. */
function classified(doc, classification, label, value, unit = '') {
  const suffix = unit ? ` ${unit}` : '';
  doc.text(`${CLASSIFICATIONS[classification] ?? ''} ${label}: ${valueText(value, NOT_PROVIDED)}${suffix}`);
}

const valueText = (value, fallback = 'N/A') => {
  if (value === undefined || value === null || Number.isNaN(value) || value === 'undefined' || value === 'NaN') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  return value;
};

const engineeringValue = (value) => valueText(value, 'NOT CALCULATED — REQUIRED INPUT/METHOD NOT IMPLEMENTED');
const deflectionValue = (value) => valueText(value, NOT_ESTABLISHED);

function reinforcementText(reinforcement) {
  if (!reinforcement || !Number.isFinite(Number(reinforcement.diameter)) || !Number.isFinite(Number(reinforcement.spacing))) return 'NOT CALCULATED — REQUIRED INPUT/METHOD NOT IMPLEMENTED';
  return `${reinforcement.diameter} mm @ ${reinforcement.spacing} mm c/c`;
}

function writeProjectDetails(doc, payload) {
  const result = payload.result || {};
  doc.fontSize(14).text('Project Details');
  doc.fontSize(11);
  doc.text(`Project Name: ${valueText(payload.projectName || result.projectName, 'N/A')}`);
  doc.text(`Designer Name: ${valueText(payload.designerName || result.designerName, 'N/A')}`);
  doc.text(`Date: ${valueText(payload.date || result.date, 'N/A')}`);
  doc.text(`Remarks: ${valueText(payload.remarks || result.remarks, 'N/A')}`);
  doc.moveDown(0.8);
}

function writeInputParameters(doc, payload) {
  const result = payload.result || {};
  const isSlab = result.designType === 'Slab';
  const slabStatus = result.designStatus || result.finalStatus || 'VERIFICATION REQUIRED';
  doc.fontSize(14).text('INPUTS');
  doc.fontSize(11);
  doc.text(`Length: ${valueText(payload.length ?? result.length, 'N/A')} m`);
  doc.text(`Width: ${valueText(payload.width ?? result.width, 'N/A')} m`);
  if (isSlab) {
    classified(doc, 'INPUT', 'Initial slab thickness', result.initialThickness ?? result.initialSlabThickness, 'mm');
    if (slabStatus === 'APPROVED') {
      classified(doc, 'CHECK', 'Final adopted slab thickness', result.adoptedThickness ?? result.slabThickness, 'mm');
    } else {
      classified(doc, 'CALCULATED', 'Last evaluated thickness', result.lastEvaluatedThickness ?? result.slabThickness, 'mm');
      doc.text('[CHECK] Adopted slab thickness: NOT ADOPTED');
    }
    classified(doc, 'CHECK', 'Status', slabStatus);
  } else {
    doc.text(`Slab Thickness: ${valueText(payload.slabThickness ?? result.slabThickness, 'N/A')} mm`);
  }
  const supportThickness = payload.wallThickness !== undefined && Number(payload.wallThickness) < 1 ? Number(payload.wallThickness) * 1000 : payload.wallThickness;
  doc.text(`Support/Wall Thickness: ${engineeringValue(supportThickness ?? result.supportWallThickness)} mm`);
  doc.text(`Clear Cover: ${valueText(payload.clearCover ?? result.clearCover, 'N/A')} mm`);
  doc.text(`Floor Finish Load: ${valueText(payload.floorFinishLoad ?? result.floorFinish, 'N/A')} kN/m²`);
  doc.text(`Live Load: ${valueText(payload.liveLoad ?? result.liveLoad, 'N/A')} kN/m²`);
  doc.text(`Concrete Grade: ${valueText(payload.concreteGrade ?? result.concreteGrade, 'N/A')}`);
  doc.text(`Steel Grade: ${valueText(payload.steelGrade ?? result.steelGrade, 'N/A')}`);
  doc.text(`Support Type: ${valueText(payload.supportType ?? result.supportType, 'N/A')}`);
  doc.text(`Unit Weight of Concrete: ${valueText(payload.unitWeightConcrete ?? result.unitWeightConcrete, 'N/A')} kN/m³`);
  doc.text(`Preferred Bar Diameter: ${valueText(payload.preferredBarDiameter ?? result.preferredBarDiameter, 'N/A')} mm`);
  doc.moveDown(0.8);
}

function writeSlabIterations(doc, result) {
  if (!Array.isArray(result.designIterations) || result.designIterations.length === 0) return;
  // Eleven engineering fields are not legible in a portrait pipe-delimited line.
  // Give the iteration schedule its own landscape page with fixed columns and headers.
  doc.addPage({ layout: 'landscape', margin: 36 });
  doc.fontSize(14).text('SLAB DESIGN ITERATIONS');
  doc.moveDown(0.25);
  doc.fontSize(8).fillColor('#555555').text('Each row is an executed thickness candidate; values are read directly from the authoritative design iteration.', { width: 700 });
  doc.fillColor('#000000');

  const columns = [
    ['Thickness\nmm', 54], ['d short\nmm', 51], ['d long\nmm', 51], ['Mu-x\nkN m/m', 62], ['Mu-y\nkN m/m', 62],
    ['Ast-x\nmm2/m', 62], ['Ast-y\nmm2/m', 62], ['Actual\nL/d', 50], ['Permissible\nL/d', 70], ['Shear', 58], ['Status', 80]
  ];
  const left = doc.page.margins.left;
  const rowHeight = 23;
  const format = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'MANUAL VERIFICATION REQUIRED';
  const drawHeader = (y) => {
    let x = left;
    doc.fontSize(6.5).fillColor('#ffffff');
    columns.forEach(([label, width]) => {
      doc.rect(x, y, width, rowHeight).fill('#1e3a5f');
      doc.fillColor('#ffffff').text(label, x + 3, y + 4, { width: width - 6, align: 'center' });
      x += width;
    });
    doc.fillColor('#000000');
  };
  const drawRow = (iteration, index, y) => {
    const values = [
      format(iteration.thickness, 0), format(iteration.effectiveDepthShort, 0), format(iteration.effectiveDepthLong, 0),
      format(iteration.MuShort), format(iteration.MuLong), format(iteration.AstShort, 1), format(iteration.AstLong, 1),
      format(iteration.actualLd), format(iteration.permissibleLd), valueText(iteration.shearStatus, NOT_PROVIDED), valueText(iteration.status, NOT_PROVIDED)
    ];
    let x = left;
    doc.fontSize(6.5);
    columns.forEach(([, width], columnIndex) => {
      doc.rect(x, y, width, rowHeight).fill(index % 2 ? '#f1f5f9' : '#ffffff').stroke('#cbd5e1');
      doc.fillColor('#000000').text(String(values[columnIndex]), x + 3, y + 8, { width: width - 6, align: 'center', lineBreak: false });
      x += width;
    });
  };

  let y = doc.y + 6;
  drawHeader(y);
  y += rowHeight;
  result.designIterations.forEach((iteration, index) => {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ layout: 'landscape', margin: 36 });
      y = doc.page.margins.top;
      drawHeader(y);
      y += rowHeight;
    }
    drawRow(iteration, index, y);
    y += rowHeight;
  });
  doc.addPage({ layout: 'portrait', margin: 36 });
  doc.fontSize(11);
  classified(doc, 'INPUT', 'Initial thickness', `${valueText(result.initialThickness)} mm`);
  classified(doc, 'INPUT', 'Maximum thickness searched', `${valueText(result.thicknessIteration?.maximumThickness)} mm`);
  classified(doc, 'INPUT', 'Thickness step', `${valueText(result.thicknessIteration?.step)} mm`);
  classified(doc, 'CALCULATED', 'Thicknesses evaluated', valueText(result.evaluatedThicknessCount));
  classified(doc, 'CALCULATED', 'Thickness increments', valueText(result.incrementCount));
  classified(doc, 'CALCULATED', 'Thicknesses that satisfied every check', valueText(result.adoptionCount));
  classified(doc, 'CALCULATED', 'Last evaluated thickness', `${valueText(result.lastEvaluatedThickness)} mm`);
  classified(doc, 'CHECK', 'Adopted slab thickness', result.adoptedThickness === null || result.adoptedThickness === undefined ? 'NOT ADOPTED' : `${valueText(result.adoptedThickness)} mm`);
  classified(doc, 'CHECK', 'Adopted thickness status', valueText(result.adoptedThicknessStatus, 'VERIFICATION REQUIRED'));
  classified(doc, 'CHECK', 'Adopted thickness reason', result.adoptedThicknessReason);
  doc.moveDown(0.8);
}

function writeDesignOutput(doc, result) {
  doc.fontSize(14).text('DESIGN SUMMARY');
  doc.fontSize(11);
  const output = result.designOutput || {};
  doc.text('[CALCULATED] Design type: ' + valueText(output.designType ?? result.designType, 'N/A'));
  doc.text('[INPUT] Project: ' + valueText(output.projectName ?? result.projectName, 'N/A'));
  doc.text('[CALCULATED] Slab type: ' + valueText(output.slabType ?? result.slabType, 'N/A'));
  doc.text('[INPUT] Support type: ' + valueText(output.supportType ?? result.supportType, 'N/A'));
  doc.text('[INPUT] Concrete grade: ' + valueText(output.concreteGrade ?? result.concreteGrade, 'N/A'));
  doc.text('[INPUT] Steel grade: ' + valueText(output.steelGrade ?? result.steelGrade, 'N/A'));
  doc.text('[CHECK] IS 456 moment coefficient table: ' + valueText(result.coefficientTableReference, 'N/A'));
  doc.text('[DERIVED] Corner restraint: ' + valueText(output.cornerRestraintLabel ?? result.cornerRestraintLabel, 'N/A'));
  doc.text('[CHECK] Final design status: ' + valueText(result.finalStatus ?? result.designStatus, 'N/A'));
  doc.text('[CALCULATED] Slab thickness evaluated: ' + valueText(output.slabThickness ?? result.slabThickness, 'N/A') + ' mm');
  doc.text('[CHECK] Adopted slab thickness: ' + (result.adoptedThickness === null || result.adoptedThickness === undefined ? 'NOT ADOPTED' : `${valueText(result.adoptedThickness)} mm`));
  doc.text('[CALCULATED] Last evaluated thickness: ' + valueText(result.lastEvaluatedThickness, 'N/A') + ' mm');
  doc.text('[DERIVED] Effective depth - short direction: ' + valueText(output.effectiveDepthShort ?? result.effectiveDepthShort, 'N/A') + ' mm');
  doc.text('[DERIVED] Effective depth - long direction: ' + valueText(output.effectiveDepthLong ?? result.effectiveDepthLong, 'N/A') + ' mm');
  doc.text('[DERIVED] Short span Lx: ' + valueText(output.shortSpan ?? result.shortSpan ?? result.effectiveShortSpan, 'N/A') + ' m');
  doc.text('[DERIVED] Long span Ly: ' + valueText(output.longSpan ?? result.longSpan ?? result.effectiveLongSpan, 'N/A') + ' m');
  doc.text('[CALCULATED] Aspect ratio Ly/Lx: ' + valueText(output.aspectRatio ?? result.aspectRatio, 'N/A'));
  doc.text('[DERIVED] Clear span (short): ' + valueText(output.clearShortSpan ?? result.clearShortSpan, 'N/A') + ' m');
  doc.text('[DERIVED] Clear span (long): ' + valueText(output.clearLongSpan ?? result.clearLongSpan, 'N/A') + ' m');
  doc.text('[INPUT] Support/wall thickness: ' + valueText(output.supportWallThickness ?? result.supportWallThickness, 'N/A') + ' mm');
  doc.text('[INPUT] Nominal clear cover: ' + valueText(output.clearCover ?? result.clearCover, 'N/A') + ' mm');
  doc.text('[DERIVED] Effective depth layer assumption: ' + engineeringValue(result.effectiveDepthLayerAssumption));
  doc.moveDown(0.8);
}

function writeCalculationSteps(doc, result) {
  const steps = Array.isArray(result.calculationSteps) ? result.calculationSteps : [];
  doc.fontSize(14).text('DETAILED CALCULATION TRACE');
  doc.fontSize(9);
  if (steps.length === 0) {
    doc.text('No calculation steps were produced by the design engine.');
    doc.moveDown(0.8);
    return;
  }
  // Grouped so the trace reads as engineering sections rather than one wall of text.
  const groups = [];
  steps.forEach((entry) => {
    const key = entry.group ?? 'other';
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.steps.push(entry);
    else groups.push({ key, label: entry.groupLabel ?? key, steps: [entry] });
  });
  groups.forEach((group) => {
    doc.fontSize(11).text(group.label.toUpperCase());
    group.steps.forEach((entry) => {
      const unit = entry.unit ? ` ${entry.unit}` : '';
      doc.text(`${entry.step}. ${valueText(entry.title)} = ${engineeringValue(entry.result)}${unit}`);
      doc.fillColor('#555555');
      if (entry.formula) doc.text(`   Formula: ${valueText(entry.formula, 'N/A')}`);
      if (entry.substitution) doc.text(`   Substitution: ${valueText(entry.substitution, 'N/A')}`);
      if (entry.status) doc.text(`   Status: ${valueText(entry.status)}`);
      doc.fillColor('#000000');
    });
    doc.moveDown(0.3);
  });
  doc.moveDown(0.5);
}

function writeDesignForces(doc, result) {
  doc.fontSize(14).text('DESIGN FORCES');
  doc.fontSize(11);
  const forces = result.designForces || {};
  classified(doc, 'CHECK', 'IS 456 coefficient table', result.coefficientTableReference ?? forces.coefficientTableReference);
  classified(doc, 'DERIVED', 'Coefficient table selection', result.coefficientSelectionReason ?? forces.coefficientSelectionReason);
  classified(doc, 'CHECK', 'Coefficient table ruled out', result.coefficientTableRuledOut ?? forces.coefficientTableRuledOut);
  classified(doc, 'CALCULATED', 'Coefficient source', result.coefficientSource ?? forces.coefficientSource);
  classified(doc, 'CALCULATED', 'alpha_x', result.alphaX ?? forces.alphaX);
  classified(doc, 'CALCULATED', 'alpha_y', result.alphaY ?? forces.alphaY);
  classified(doc, 'CALCULATED', 'Mu-x (short direction)', result.MuShort ?? forces.MuShort, 'kN·m/m');
  classified(doc, 'CALCULATED', 'Mu-y (long direction)', result.MuLong ?? forces.MuLong, 'kN·m/m');
  classified(doc, 'DERIVED', 'Moment equation', result.momentEquation ?? forces.momentEquation);
  classified(doc, 'DERIVED', 'Effective short span used for moment calculation', result.shortSpanUsedForBothMoments ?? forces.shortSpanUsedForBothMoments, 'm');
  doc.moveDown(0.8);
}

function writeReinforcementLayout(doc, result) {
  doc.fontSize(14).text('REINFORCEMENT LAYOUT');
  doc.fontSize(11);
  const short = result.shortDirectionReinforcement || {};
  const long = result.longDirectionReinforcement || {};
  const shortDetailing = result.detailing?.shortDirection || {};
  const longDetailing = result.detailing?.longDirection || {};
  doc.text('SHORT DIRECTION (main)');
  classified(doc, 'CALCULATED', 'Design reinforcement', reinforcementText(short));
  classified(doc, 'CALCULATED', 'Bar arrangement', reinforcementText(short));
  classified(doc, 'CALCULATED', 'Required steel (flexural)', result.shortDirectionAstFlexuralRequired ?? short.AstFlexuralRequired, 'mm²/m');
  classified(doc, 'CALCULATED', 'Minimum steel', result.shortDirectionAstMinimum ?? short.AstMinimum, 'mm²/m');
  classified(doc, 'DERIVED', 'Required steel for design', result.shortDirectionAstRequired ?? short.AstRequired, 'mm²/m');
  classified(doc, 'CHECK', 'Provided steel', result.shortDirectionAstProvided ?? short.AstProvided, 'mm²/m');
  classified(doc, 'CALCULATED', 'Maximum spacing', short.maxSpacing, 'mm');
  classified(doc, 'CALCULATED', 'Clear spacing', short.clearSpacing, 'mm');
  classified(doc, 'CHECK', 'Spacing status', result.checksByCategory?.spacingShort?.status);
  classified(doc, 'DERIVED', 'Detailing number of bars', shortDetailing.numberOfBars ?? NOT_ESTABLISHED);
  classified(doc, 'DERIVED', 'Available placement width', shortDetailing.availablePlacementWidth ?? NOT_ESTABLISHED);
  classified(doc, 'DERIVED', 'Detailing bar arrangement', shortDetailing.barArrangement ?? NOT_ESTABLISHED);
  classified(doc, 'CHECK', 'Detailing status', shortDetailing.detailingStatus ?? NOT_ESTABLISHED);
  doc.moveDown(0.4);
  doc.text('LONG DIRECTION (distribution)');
  classified(doc, 'CALCULATED', 'Design reinforcement', reinforcementText(long));
  classified(doc, 'CALCULATED', 'Bar arrangement', reinforcementText(long));
  classified(doc, 'CALCULATED', 'Required steel (flexural)', result.longDirectionAstFlexuralRequired ?? long.AstFlexuralRequired, 'mm²/m');
  classified(doc, 'CALCULATED', 'Minimum steel', result.longDirectionAstMinimum ?? long.AstMinimum, 'mm²/m');
  classified(doc, 'DERIVED', 'Required steel for design', result.longDirectionAstRequired ?? long.AstRequired, 'mm²/m');
  classified(doc, 'CHECK', 'Provided steel', result.longDirectionAstProvided ?? long.AstProvided, 'mm²/m');
  classified(doc, 'CALCULATED', 'Maximum spacing', long.maxSpacing, 'mm');
  classified(doc, 'CALCULATED', 'Clear spacing', long.clearSpacing, 'mm');
  classified(doc, 'CHECK', 'Spacing status', result.checksByCategory?.spacingLong?.status);
  classified(doc, 'DERIVED', 'Detailing number of bars', longDetailing.numberOfBars ?? NOT_ESTABLISHED);
  classified(doc, 'DERIVED', 'Available placement width', longDetailing.availablePlacementWidth ?? NOT_ESTABLISHED);
  classified(doc, 'DERIVED', 'Detailing bar arrangement', longDetailing.barArrangement ?? NOT_ESTABLISHED);
  classified(doc, 'CHECK', 'Detailing status', longDetailing.detailingStatus ?? NOT_ESTABLISHED);
  doc.moveDown(0.4);
  // Cover, bar-extension detailing and the remaining detailing provisions belong with the
  // reinforcement layout so the report is not fragmented across duplicate sections.
  writeDetailing(doc, result);
}

function writeCornerTorsion(doc, result) {
  doc.fontSize(14).text('CORNER TORSION');
  doc.fontSize(11);
  const status = result.cornerTorsionStatus;
  const classification = status === 'NOT REQUIRED' ? 'NOT_REQUIRED' : status === 'VERIFICATION REQUIRED' ? 'VERIFICATION_REQUIRED' : 'CHECK';
  classified(doc, 'INPUT', 'Corner restraint', result.cornerRestraintLabel ?? result.cornerRestraint);
  classified(doc, classification, 'Corner torsion basis', result.cornerTorsionBasis);
  classified(doc, classification, 'Corner torsion reinforcement', result.cornerTorsionReinforcement);
  classified(doc, classification, 'Status', status);
  classified(doc, classification, 'Reason', result.cornerTorsionReason);
  doc.moveDown(0.8);
}

function writeDesignStatus(doc, result) {
  doc.fontSize(14).text('DESIGN STATUS');
  doc.fontSize(11);
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const verification = checks.filter((check) => check.status === 'VERIFICATION REQUIRED');
  const failed = checks.filter((check) => check.status === 'FAIL');
  const passed = checks.filter((check) => check.status === 'PASS');
  const notRequired = checks.filter((check) => check.status === 'NOT REQUIRED');

  classified(doc, 'CHECK', 'Final design status', result.finalStatus || result.designStatus);
  classified(doc, 'CHECK', 'Adopted slab thickness', result.adoptedThickness === null || result.adoptedThickness === undefined ? 'NOT ADOPTED' : `${valueText(result.adoptedThickness)} mm`);
  classified(doc, 'CALCULATED', 'Last evaluated thickness', `${valueText(result.lastEvaluatedThickness)} mm`);
  classified(doc, 'CALCULATED', 'Thicknesses evaluated', `${valueText(result.evaluatedThicknessCount)} (${valueText(result.incrementCount)} increments)`);
  classified(doc, 'CHECK', 'Adopted thickness reason', result.adoptedThicknessReason);
  // NOT REQUIRED is reported as its own category and is never counted as PASS.
  doc.text(`[CHECK] Checks: ${passed.length} PASS, ${notRequired.length} NOT REQUIRED, ${verification.length} VERIFICATION REQUIRED, ${failed.length} FAIL (of ${checks.length} total)`);
  if (verification.length) {
    doc.text(`Items requiring verification (${verification.length}):`);
    verification.forEach((check) => doc.text(`  - ${check.title}: ${check.reason}`));
  }
  if (failed.length) {
    doc.text(`Failed checks (${failed.length}):`);
    failed.forEach((check) => doc.text(`  - ${check.title}: ${check.reason}`));
  }
  doc.moveDown(0.8);
}

function writeSchematicData(doc, result) {
  doc.fontSize(14).text('SCHEMATIC');
  doc.fontSize(11);
  const lx = Number(result.shortSpan ?? result.effectiveShortSpan);
  const ly = Number(result.longSpan ?? result.effectiveLongSpan);
  const planWidth = 380;
  const planHeight = Number.isFinite(lx) && Number.isFinite(ly) && ly > 0 ? Math.max(100, Math.min(190, planWidth * lx / ly)) : 140;
  const planX = 108;
  let planY = doc.y + 24;
  if (planY + planHeight + 100 > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    doc.fontSize(14).text('SCHEMATIC (continued)');
    doc.fontSize(11);
    planY = doc.y + 24;
  }
  const planRight = planX + planWidth;
  const planBottom = planY + planHeight;

  // Canonical drawing map: Ly is horizontal PDF X and Lx is vertical PDF Y. Short
  // bars therefore run vertically along Lx; long bars run horizontally along Ly.
  doc.save();
  doc.rect(planX, planY, planWidth, planHeight).fillAndStroke('#e0f2fe', '#0f172a');
  doc.lineWidth(8).strokeColor('#94a3b8');
  [[planX, planY, planRight, planY], [planX, planBottom, planRight, planBottom], [planX, planY, planX, planBottom], [planRight, planY, planRight, planBottom]].forEach((line) => doc.moveTo(...line.slice(0, 2)).lineTo(...line.slice(2)).stroke());
  doc.lineWidth(2.4).strokeColor('#0284c7');
  for (let index = 1; index <= 9; index += 1) {
    const x = planX + (planWidth * index) / 10;
    doc.moveTo(x, planY + 4).lineTo(x, planBottom - 4).stroke();
  }
  doc.lineWidth(1.3).strokeColor('#7c3aed');
  for (let index = 1; index <= 5; index += 1) {
    const y = planY + (planHeight * index) / 6;
    doc.moveTo(planX + 4, y).lineTo(planRight - 4, y).stroke();
  }
  doc.lineWidth(0.8).dash(4, { space: 3 }).strokeColor('#64748b');
  doc.rect(planX + 8, planY + 8, planWidth - 16, planHeight - 16).stroke();
  doc.undash().restore();
  doc.fontSize(9).fillColor('#0284c7').text(`Short direction / Lx = ${valueText(result.shortSpan, NOT_PROVIDED)} m: ${reinforcementText(result.shortDirectionReinforcement)} (bottom layer, vertical)`, planX, planBottom + 26, { width: planWidth });
  doc.fillColor('#7c3aed').text(`Long direction / Ly = ${valueText(result.longSpan, NOT_PROVIDED)} m: ${reinforcementText(result.longDirectionReinforcement)} (upper layer, horizontal)`, planX, planBottom + 39, { width: planWidth });
  doc.fillColor('#334155').text(`Supporting walls on four edges: ${valueText(result.supportWallThickness, NOT_PROVIDED)} mm - ${valueText(result.supportType, NOT_PROVIDED)}; cover: ${valueText(result.clearCover, NOT_PROVIDED)} mm; corner restraint: ${valueText(result.cornerRestraintLabel ?? result.cornerRestraint, NOT_PROVIDED)}`, planX, planBottom + 52, { width: planWidth });
  doc.fillColor('#000000');
  doc.y = planBottom + 76;
  doc.text('SCHEMATIC — NOT TO SCALE. The web report renders the plan drawing; the values below are the same authoritative values the drawing reads.');
  doc.moveDown(0.3);
  const short = result.shortDirectionReinforcement || {};
  const long = result.longDirectionReinforcement || {};
  classified(doc, 'CALCULATED', 'Short direction arrangement', reinforcementText(short));
  classified(doc, 'CALCULATED', 'Long direction arrangement', reinforcementText(long));
  classified(doc, 'CALCULATED', 'Short span Lx', result.shortSpan, 'm');
  classified(doc, 'CALCULATED', 'Long span Ly', result.longSpan, 'm');
  classified(doc, 'CALCULATED', 'Aspect ratio ly/lx', result.aspectRatio);
  classified(doc, 'INPUT', 'Slab thickness D', result.slabThickness, 'mm');
  classified(doc, 'INPUT', 'Clear cover', result.clearCover, 'mm');
  classified(doc, 'DERIVED', 'Effective depth d short', result.effectiveDepthShort, 'mm');
  classified(doc, 'DERIVED', 'Effective depth d long', result.effectiveDepthLong, 'mm');
  classified(doc, 'INPUT', 'Support / wall width', result.supportWallThickness, 'mm');
  classified(doc, 'INPUT', 'Support type', result.supportType);
  classified(doc, 'INPUT', 'Corner restraint', result.cornerRestraintLabel ?? result.cornerRestraint);
  classified(doc, 'DERIVED', 'Effective depth layer assumption', result.effectiveDepthLayerAssumption);
  doc.text('The number of bars shown in the drawing is symbolic and is not a bar-bending schedule.');
  doc.moveDown(0.8);
}

function writeFinalSummary(doc, result) {
  doc.fontSize(14).text('FINAL VERIFICATION SUMMARY');
  doc.fontSize(11);
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const failed = checks.filter((check) => check.status === 'FAIL');
  const verification = checks.filter((check) => check.status === 'VERIFICATION REQUIRED');
  const notRequired = checks.filter((check) => check.status === 'NOT REQUIRED');
  const passed = checks.filter((check) => check.status === 'PASS');
  classified(doc, 'CHECK', 'Final design status', result.finalStatus || result.designStatus);
  classified(doc, 'CHECK', 'Adopted slab thickness', result.adoptedThickness === null || result.adoptedThickness === undefined ? 'NOT ADOPTED' : `${valueText(result.adoptedThickness)} mm`);
  classified(doc, 'CHECK', 'Last evaluated thickness', `${valueText(result.lastEvaluatedThickness)} mm`);
  classified(doc, 'CHECK', 'Adopted thickness reason', result.adoptedThicknessReason);
  classified(doc, 'CHECK', 'Thickness evaluations', `${valueText(result.evaluatedThicknessCount)} thicknesses evaluated, ${valueText(result.incrementCount)} increments, ${valueText(result.adoptionCount)} fully satisfied`);
  classified(doc, 'CHECK', 'Validation', result.validationMessage);
  doc.text(`[CHECK] Checks: ${passed.length} PASS, ${notRequired.length} NOT REQUIRED, ${verification.length} VERIFICATION REQUIRED, ${failed.length} FAIL (of ${checks.length} total)`);
  if (verification.length) {
    doc.text(`Items requiring verification (${verification.length}):`);
    verification.forEach((check) => doc.text(`  - ${check.title}: ${check.reason}`));
  }
  if (failed.length) {
    doc.text(`Failed checks (${failed.length}):`);
    failed.forEach((check) => doc.text(`  - ${check.title}: ${check.reason}`));
  }
  if (notRequired.length) {
    doc.text(`Not required (${notRequired.length}): ${notRequired.map((check) => check.title).join(', ')}`);
  }
  doc.moveDown(0.8);
}

export function slabReportData(payload = {}) {
  const source = payload.result || {};
  const result = source.finalDesign || source;
  const status = result.designStatus || result.finalStatus || 'VERIFICATION REQUIRED';
  return {
    initialThickness: result.initialThickness ?? result.initialSlabThickness ?? result.initialThickness,
    lastEvaluatedThickness: result.lastEvaluatedThickness ?? result.slabThickness ?? result.finalDesign?.lastEvaluatedThickness,
    adoptedThickness: status === 'APPROVED' ? (result.adoptedThickness ?? result.slabThickness ?? null) : null,
    selfWeight: result.selfWeight,
    effectiveDepthShort: result.effectiveDepthShort ?? result.effectiveDepthX,
    effectiveDepthLong: result.effectiveDepthLong ?? result.effectiveDepthY,
    actualLd: result.actualLd ?? result.deflection?.actualLd,
    permissibleLd: result.permissibleLd ?? result.deflection?.permissibleLd,
    deflection: {
      pt: result.deflectionPt ?? result.deflection?.pt,
      fs: result.deflectionFs ?? result.deflection?.fs,
      astUsedForPt: result.deflectionAstUsedForPt ?? result.deflection?.astUsedForPt,
      astRequiredForFs: result.deflectionAstRequiredForFs ?? result.deflection?.astRequiredForFs,
      ptWidth: result.deflectionPtWidth ?? result.deflection?.ptWidth,
      ptEffectiveDepth: result.deflectionPtEffectiveDepth ?? result.deflection?.ptEffectiveDepth,
      ptFormula: result.deflectionPtFormula ?? result.deflection?.ptFormula,
      fsFormula: result.deflectionFsFormula ?? result.deflection?.fsFormula,
      ptTrace: result.deflectionPtTrace ?? result.deflection?.ptTrace,
      fsTrace: result.deflectionFsTrace ?? result.deflection?.fsTrace,
      ptLower: result.deflectionPtLower ?? result.deflection?.ptLower,
      ptUpper: result.deflectionPtUpper ?? result.deflection?.ptUpper,
      ptRange: result.deflectionPtRange ?? result.deflection?.ptRange,
      ptInterpolationRatio: result.deflectionPtInterpolationRatio ?? result.deflection?.ptInterpolationRatio,
      fsLower: result.deflectionFsLower ?? result.deflection?.fsLower,
      fsUpper: result.deflectionFsUpper ?? result.deflection?.fsUpper,
      fsRange: result.deflectionFsRange ?? result.deflection?.fsRange,
      fsInterpolationRatio: result.deflectionFsInterpolationRatio ?? result.deflection?.fsInterpolationRatio,
      factorAtLowerPtLowerFs: result.deflectionFactorAtLowerPtLowerFs ?? result.deflection?.factorAtLowerPtLowerFs,
      factorAtLowerPtUpperFs: result.deflectionFactorAtLowerPtUpperFs ?? result.deflection?.factorAtLowerPtUpperFs,
      factorAtUpperPtLowerFs: result.deflectionFactorAtUpperPtLowerFs ?? result.deflection?.factorAtUpperPtLowerFs,
      factorAtUpperPtUpperFs: result.deflectionFactorAtUpperPtUpperFs ?? result.deflection?.factorAtUpperPtUpperFs,
      modificationFactor: result.modificationFactor ?? result.deflection?.modificationFactor,
      actualLd: result.actualLd ?? result.deflection?.actualLd,
      permissibleLd: result.permissibleLd ?? result.deflection?.permissibleLd,
      status: result.deflectionStatus ?? result.deflection?.status,
      message: result.deflectionMessage ?? result.deflection?.message
    },
    designStatus: status,
    designIterations: result.designIterations || [],
    designOutput: result.designOutput || null,
    loadSummary: result.loadSummary || null,
    designForces: result.designForces || null,
    calculationSteps: result.calculationSteps || [],
    checks: result.checks || [],
    finalStatus: result.finalStatus || result.designStatus || null,
    shortSpan: result.shortSpan ?? result.effectiveShortSpan,
    longSpan: result.longSpan ?? result.effectiveLongSpan,
    shortDirectionAstRequired: result.shortDirectionAstRequired,
    shortDirectionAstFlexuralRequired: result.shortDirectionAstFlexuralRequired,
    shortDirectionAstMinimum: result.shortDirectionAstMinimum,
    longDirectionAstRequired: result.longDirectionAstRequired,
    longDirectionAstFlexuralRequired: result.longDirectionAstFlexuralRequired,
    longDirectionAstMinimum: result.longDirectionAstMinimum,
    cornerTorsionStatus: result.cornerTorsionStatus,
    coverVerification: result.coverVerification,
    thicknessIteration: result.thicknessIteration,
    evaluatedThicknessCount: result.evaluatedThicknessCount,
    incrementCount: result.incrementCount,
    adoptionCount: result.adoptionCount,
    adoptedThicknessLabel: result.adoptedThicknessLabel
  };
}

function writeLoadCalculation(doc, result) {
  doc.fontSize(14).text('LOADS');
  doc.fontSize(11);
  classified(doc, 'INPUT', 'Slab thickness', result.slabThickness, 'mm');
  classified(doc, 'CALCULATED', 'Self weight', result.selfWeight, 'kN/m²');
  classified(doc, 'INPUT', 'Floor finish', result.floorFinish, 'kN/m²');
  classified(doc, 'DERIVED', 'Dead load', result.deadLoad, 'kN/m²');
  classified(doc, 'INPUT', 'Live load', result.liveLoad, 'kN/m²');
  classified(doc, 'DERIVED', 'Service load', result.serviceLoad, 'kN/m²');
  classified(doc, 'DERIVED', 'Ultimate load wu', result.ultimateLoad, 'kN/m²');
  doc.moveDown(0.8);
}

function writeGeometry(doc, result) {
  doc.fontSize(14).text('GEOMETRY');
  doc.fontSize(11);
  classified(doc, 'INPUT', 'Span input definition', 'Length and Width are the CENTRE-TO-CENTRE support spans. The clear span is the centre-to-centre span less the support width.');
  classified(doc, 'INPUT', 'Total short span', result.totalShortSpan, 'm');
  classified(doc, 'INPUT', 'Total long span', result.totalLongSpan, 'm');
  classified(doc, 'DERIVED', 'Clear span (short)', result.clearShortSpan, 'm');
  classified(doc, 'DERIVED', 'Clear span (long)', result.clearLongSpan, 'm');
  classified(doc, 'DERIVED', 'Effective short span lx', result.effectiveShortSpan, 'm');
  classified(doc, 'DERIVED', 'Effective long span ly', result.effectiveLongSpan, 'm');
  classified(doc, 'DERIVED', 'Effective span rule', 'Leff = min(clear span + d, centre-to-centre support span) (IS 456:2000 Clause 22.2)');
  classified(doc, 'CALCULATED', 'Aspect ratio ly/lx', result.aspectRatio);
  classified(doc, 'CALCULATED', 'Slab classification', `${result.slabType} — ${result.checksByCategory?.classification?.reason ?? 'selected design-path classification'}`);
  classified(doc, 'DERIVED', 'Effective span method', result.effectiveSpanMethod);
  doc.moveDown(0.8);
}

function writeMomentDesign(doc, result) {
  doc.fontSize(14).text('DESIGN FORCES');
  doc.fontSize(11);
  const forces = result.designForces || {};
  classified(doc, 'CHECK', 'IS 456 coefficient table', result.coefficientTableReference ?? forces.coefficientTableReference);
  classified(doc, 'DERIVED', 'Coefficient table selection', result.coefficientSelectionReason ?? forces.coefficientSelectionReason);
  classified(doc, 'CHECK', 'Coefficient table ruled out', result.coefficientTableRuledOut ?? forces.coefficientTableRuledOut);
  classified(doc, 'CALCULATED', 'Coefficient source', result.coefficientSource ?? forces.coefficientSource);
  classified(doc, 'CALCULATED', 'alpha_x', result.alphaX ?? forces.alphaX);
  classified(doc, 'CALCULATED', 'alpha_y', result.alphaY ?? forces.alphaY);
  classified(doc, 'DERIVED', 'Interpolation bracket ly/lx', result.coefficientInterpolationLowerM !== null && result.coefficientInterpolationLowerM !== undefined
    ? `between m = ${result.coefficientInterpolationLowerM} and m = ${result.coefficientInterpolationUpperM}`
    : NOT_PROVIDED);
  classified(doc, 'CALCULATED', 'Mu-x (short direction)', result.MuShort ?? forces.MuShort, 'kN·m/m');
  classified(doc, 'CALCULATED', 'Mu-y (long direction)', result.MuLong ?? forces.MuLong, 'kN·m/m');
  classified(doc, 'DERIVED', 'Moment equation', result.momentEquation ?? forces.momentEquation);
  classified(doc, 'DERIVED', 'Short span used for moment calculation', result.shortSpanUsedForBothMoments ?? forces.shortSpanUsedForBothMoments, 'm');
  doc.moveDown(0.8);
}

function writeFlexuralDesign(doc, result) {
  doc.fontSize(14).text('REINFORCEMENT DESIGN');
  doc.fontSize(11);
  const writeDirection = (title, depth, moment, flexural, minimum, governing, provided, barDiameter, xu, xuMax, capacity, status) => {
    doc.text(title);
    classified(doc, 'DERIVED', 'Effective depth d', depth, 'mm');
    classified(doc, 'CALCULATED', 'Design moment Mu', moment, 'kN·m/m');
    classified(doc, 'CALCULATED', 'Required Ast (flexural)', flexural, 'mm²/m');
    classified(doc, 'CALCULATED', 'Minimum Ast (Clause 26.5.2.1)', minimum, 'mm²/m');
    classified(doc, 'DERIVED', 'Governing Ast required for design', governing, 'mm²/m');
    classified(doc, 'CHECK', 'Provided Ast', provided, 'mm²/m');
    classified(doc, 'CALCULATED', 'Bar diameter', barDiameter, 'mm');
    classified(doc, 'CALCULATED', 'Moment capacity', capacity, 'kN·m/m');
    classified(doc, 'CALCULATED', 'xu', xu, 'mm');
    classified(doc, 'CALCULATED', 'xu,max', xuMax, 'mm');
    classified(doc, 'CHECK', 'Status', status);
    doc.moveDown(0.4);
  };

  const short = result.shortDirectionReinforcement || {};
  const long = result.longDirectionReinforcement || {};
  writeDirection(
    'SHORT DIRECTION', result.effectiveDepthShort, result.MuShort,
    result.AstFlexuralRequiredShort, result.AstMinimumShort, result.AstRequiredShort, result.AstProvidedShort,
    short.diameter, result.xuShort, result.xuMaxShort, result.momentCapacityShort, result.checksByCategory?.flexureShort?.status
  );
  writeDirection(
    'LONG DIRECTION', result.effectiveDepthLong, result.MuLong,
    result.AstFlexuralRequiredLong, result.AstMinimumLong, result.AstRequiredLong, result.AstProvidedLong,
    long.diameter, result.xuLong, result.xuMaxLong, result.momentCapacityLong, result.checksByCategory?.flexureLong?.status
  );
  classified(doc, 'DERIVED', 'Effective depth layer assumption', result.effectiveDepthLayerAssumption);
  doc.moveDown(0.4);
}

function writeShear(doc, result) {
  doc.fontSize(14).text('SHEAR & DEFLECTION');
  doc.fontSize(11);
  doc.text('SHEAR');
  classified(doc, 'DERIVED', 'Critical section', result.criticalSection);
  classified(doc, 'CALCULATED', 'Distance from support centreline to critical section', result.shearCriticalSectionFromCentrelineM, 'm');
  classified(doc, 'DERIVED', 'Distance from support centreline to support face', result.shearSupportFaceToCentrelineM, 'm');
  classified(doc, 'CALCULATED', 'Reaction at the support centreline', result.shearReaction, 'kN/m');
  classified(doc, 'CALCULATED', 'Vu at the critical section', result.Vu, 'kN/m');
  classified(doc, 'CALCULATED', 'tau_v', result.shearStress, 'N/mm²');
  classified(doc, 'CALCULATED', 'tau_c (IS 456 Table 19)', result.concreteShearStrength, 'N/mm²');
  classified(doc, 'CALCULATED', 'tau_c,max (IS 456 Table 20)', result.maxShearStress, 'N/mm²');
  classified(doc, 'CALCULATED', 'Tension steel percentage for Table 19', result.shearTensionSteelPercent, '%');
  classified(doc, 'DERIVED', 'Concrete shear capacity', result.shearCapacity, 'kN/m');
  classified(doc, 'CHECK', 'Shear reinforcement', result.shearReinforcement);
  classified(doc, 'CHECK', 'Status', result.shearStatus);
  // State the shear model explicitly: this is a conservative one-metre-strip check on the
  // short direction, not a two-way load-distribution model.
  const shearBasis = result.shearBasis || {};
  if (shearBasis.analysisWidth) {
    doc.moveDown(0.3);
    doc.text('SHEAR BASIS');
    doc.text(`${CLASSIFICATIONS.DERIVED} Analysis width: ${shearBasis.analysisWidth}`);
    doc.text(`   ${valueText(shearBasis.conservatismNote, NOT_PROVIDED)}`);
    doc.text(`${CLASSIFICATIONS.DERIVED} Governing direction: ${valueText(shearBasis.governingDirection, NOT_PROVIDED)}`);
    doc.text(`   ${valueText(shearBasis.longDirectionCheck, NOT_PROVIDED)}`);
    doc.text(`   ${valueText(shearBasis.criticalSectionBasis, NOT_PROVIDED)}`);
    doc.text(`   ${valueText(shearBasis.shearReinforcementNote, NOT_PROVIDED)}`);
  }
  doc.moveDown(0.4);
  writeDeflectionBody(doc, result);
}

function writeDeflection(doc, result) {
  writeDeflectionBody(doc, result);
}

function writeDeflectionBody(doc, result) {
  doc.fontSize(11);
  doc.text('DEFLECTION');
  if (result.deflectionStatus === 'VERIFICATION REQUIRED' && (result.modificationFactor === null || result.modificationFactor === undefined)) {
    // Fig. 4 values outside the validated dataset are intentionally not extrapolated.
    // Present that one engineering decision once instead of repeating NOT ESTABLISHED
    // for every intermediate interpolation cell.
    doc.text(`${CLASSIFICATIONS.VERIFICATION_REQUIRED} Modification factor: MANUAL VERIFICATION REQUIRED`);
    doc.text(`${CLASSIFICATIONS.VERIFICATION_REQUIRED} Permissible L/d: MANUAL VERIFICATION REQUIRED`);
    doc.text(`Actual L/d: ${engineeringValue(result.actualLd)}`);
    doc.text(`Tension steel percentage pt: ${deflectionValue(result.tensionSteelPercent)} % (validated range ${deflectionValue(result.deflectionPtRange?.min)} to ${deflectionValue(result.deflectionPtRange?.max)} %)`);
    doc.text(`Service steel stress fs: ${deflectionValue(result.deflectionServiceStress)} N/mm2 (validated range ${deflectionValue(result.deflectionFsRange?.min)} to ${deflectionValue(result.deflectionFsRange?.max)} N/mm2)`);
    doc.text(`${CLASSIFICATIONS.VERIFICATION_REQUIRED} Reason: ${deflectionValue(result.deflectionMessage)}`);
    doc.moveDown(0.8);
    return;
  }
  doc.text(`Governing direction: ${engineeringValue(result.governingDirection)}`);
  doc.text(`Governing span: ${engineeringValue(result.governingSpan || result.governingDeflectionSpan)} m`);
  doc.text(`Governing effective depth: ${engineeringValue(result.governingDirection === 'Long direction' ? result.effectiveDepthLong : result.effectiveDepthShort)} mm`);
  doc.text(`Basic L/d: ${engineeringValue(result.basicLd)}`);
  doc.text(`Tension steel percentage: ${deflectionValue(result.tensionSteelPercent)} %`);
  doc.text(`Ast used for pt: ${deflectionValue(result.deflectionAstUsedForPt)} mm²/m`);
  doc.text(`pt formula: ${deflectionValue(result.deflectionPtFormula)}`);
  doc.text(`pt calculation trace: ${deflectionValue(result.deflectionPtTrace)}`);
  doc.text(`Ast required: ${deflectionValue(result.governingDirection === 'Long direction' ? result.AstRequiredLong : result.AstRequiredShort)} mm²/m`);
  doc.text(`Ast provided: ${deflectionValue(result.governingDirection === 'Long direction' ? result.AstProvidedLong : result.AstProvidedShort)} mm²/m`);
  doc.text(`Service steel stress fs: ${deflectionValue(result.deflectionServiceStress)} N/mm²`);
  doc.text(`Ast required used for fs: ${deflectionValue(result.deflectionAstRequiredForFs)} mm²/m`);
  doc.text(`fs formula: ${deflectionValue(result.deflectionFsFormula)}`);
  doc.text(`fs calculation trace: ${deflectionValue(result.deflectionFsTrace)}`);
  doc.text(`pt bracket: ${deflectionValue(result.deflectionPtLower)} to ${deflectionValue(result.deflectionPtUpper)} %`);
  doc.text(`fs bracket: ${deflectionValue(result.deflectionFsLower)} to ${deflectionValue(result.deflectionFsUpper)} N/mm²`);
  doc.text(`Validated pt range: ${deflectionValue(result.deflectionPtRange?.min)} to ${deflectionValue(result.deflectionPtRange?.max)} %`);
  doc.text(`Validated fs range: ${deflectionValue(result.deflectionFsRange?.min)} to ${deflectionValue(result.deflectionFsRange?.max)} N/mm²`);
  doc.text(`Factor at lower pt/lower fs: ${deflectionValue(result.deflectionFactorAtLowerPtLowerFs)}`);
  doc.text(`Factor at lower pt/upper fs: ${deflectionValue(result.deflectionFactorAtLowerPtUpperFs)}`);
  doc.text(`Factor at upper pt/lower fs: ${deflectionValue(result.deflectionFactorAtUpperPtLowerFs)}`);
  doc.text(`Factor at upper pt/upper fs: ${deflectionValue(result.deflectionFactorAtUpperPtUpperFs)}`);
  doc.text(`Clamping: ${result.deflectionClampingApplied ? 'YES' : 'NO'}`);
  doc.text(`Flexural Ast used for fs: ${deflectionValue(result.deflectionAstFlexuralRequiredUsedForFs)} mm²/m`);
  doc.text(`Provided Ast used for fs: ${deflectionValue(result.deflectionAstProvidedUsedForFs)} mm²/m`);
  doc.text(`Basis for the fs steel area: ${deflectionValue(result.deflectionAstUsedForFsBasis)}`);
  const status = result.deflectionStatus;
  const classification = status === 'VERIFICATION REQUIRED' ? 'VERIFICATION_REQUIRED' : 'CHECK';
  doc.text(`${CLASSIFICATIONS[classification]} Modification factor: ${deflectionValue(result.modificationFactor)}`);
  doc.text(`${CLASSIFICATIONS[classification]} Actual L/d: ${deflectionValue(result.actualLd)}`);
  doc.text(`${CLASSIFICATIONS[classification]} Permissible L/d: ${deflectionValue(result.permissibleLd)}`);
  doc.text(`Method: ${deflectionValue(result.deflectionMethod)}`);
  doc.text(`Source: ${deflectionValue(result.deflectionSource)}`);
  doc.text(`Dataset version: ${deflectionValue(result.deflectionDatasetVersion)}`);
  doc.text(`Interpolation: ${deflectionValue(result.deflectionInterpolation)}`);
  doc.text(`${CLASSIFICATIONS[classification]} Status: ${deflectionValue(status)}`);
  doc.text(`${CLASSIFICATIONS[classification]} Reason: ${deflectionValue(result.deflectionMessage)}`);
  doc.moveDown(0.8);
}

function writeDetailing(doc, result) {
  // Continues the REINFORCEMENT LAYOUT section: cover, bar-extension detailing and the
  // remaining detailing provisions. No separate section header is printed.
  doc.fontSize(11);
  const cover = result.coverVerification || {};
  const geometric = result.checksByCategory?.coverGeometric;
  const durability = result.checksByCategory?.cover;
  const barExtension = result.barExtension || {};

  classified(doc, 'CALCULATED', 'Short reinforcement', reinforcementText(result.shortDirectionReinforcement));
  classified(doc, 'CALCULATED', 'Long reinforcement', reinforcementText(result.longDirectionReinforcement));
  classified(doc, 'CALCULATED', 'Short spacing', result.shortDirectionReinforcement?.spacing, 'mm');
  classified(doc, 'CALCULATED', 'Long spacing', result.longDirectionReinforcement?.spacing, 'mm');
  classified(doc, 'CALCULATED', 'Short maximum spacing', result.maxSpacingShort, 'mm');
  classified(doc, 'CALCULATED', 'Long maximum spacing', result.maxSpacingLong, 'mm');
  classified(doc, 'CHECK', 'Short spacing status', result.spacingShort?.status || result.checksByCategory?.spacingShort?.status);
  classified(doc, 'CHECK', 'Long spacing status', result.spacingLong?.status || result.checksByCategory?.spacingLong?.status);
  classified(doc, 'CALCULATED', 'Short clear spacing', result.clearSpacingShort, 'mm');
  classified(doc, 'CALCULATED', 'Long clear spacing', result.clearSpacingLong, 'mm');
  classified(doc, 'CALCULATED', 'Minimum clear spacing', result.minimumClearSpacing, 'mm');
  classified(doc, 'DERIVED', 'Clear-spacing rule', result.minimumClearSpacingRule);
  classified(doc, 'DERIVED', 'Maximum-spacing rule', result.maximumSpacingRule);

  // Cover is reported as TWO distinct items: the geometric bar accommodation, which is
  // determinable, and the Clause 26.4 durability / fire basis, which is not.
  doc.moveDown(0.3);
  doc.text('COVER');
  doc.text(`${CLASSIFICATIONS.CHECK} Cover vs bar diameter (geometric): ${valueText(geometric?.status, NOT_PROVIDED)}`
    + (geometric ? ` (cover ${geometric.actualValue} mm vs bar ${geometric.limitValue} mm)` : ''));
  doc.text(`${CLASSIFICATIONS.VERIFICATION_REQUIRED} Cover durability / fire basis: ${valueText(durability?.status, NOT_PROVIDED)}`);
  doc.text(`   ${valueText(durability?.reason ?? cover.reason, NOT_PROVIDED)}`);
  doc.text('   The clear cover is NOT compared against the slab thickness; that is not a Clause 26.4 check.');

  // IS 456:2000 Annex D-2.1.1 bar extension / curtailment.
  if (barExtension.reference) {
    doc.moveDown(0.3);
    doc.text(`BAR EXTENSION / CURTAILMENT (${barExtension.reference})`);
    doc.text(`${CLASSIFICATIONS.VERIFICATION_REQUIRED} Requirement: ${valueText(barExtension.requirement, NOT_PROVIDED)}`);
    doc.text(`   Short direction: ${valueText(barExtension.short?.terminationAllowanceExpression, NOT_PROVIDED)}`);
    doc.text(`   Long direction: ${valueText(barExtension.long?.terminationAllowanceExpression, NOT_PROVIDED)}`);
    doc.text(`   ${valueText(barExtension.verificationNote, NOT_PROVIDED)}`);
  }

  classified(doc, 'INPUT', 'Corner restraint', result.cornerRestraintLabel ?? result.cornerRestraint);
  doc.moveDown(0.8);
}

function writeFinalChecks(doc, result) {
  doc.fontSize(14).text('ENGINEERING CHECKS');
  doc.fontSize(11);
  const checks = Array.isArray(result.checks) ? result.checks : [];
  if (checks.length === 0) {
    doc.text('No checks generated.');
  } else {
    doc.fontSize(9);
    doc.text('Check | Status | Value | Limit | Unit | Code reference');
    doc.fontSize(11);
    checks.forEach((check) => {
      const value = check.actualValue ?? check.actual;
      const limit = check.limitValue ?? check.limit;
      const classification = check.status === 'NOT REQUIRED' ? 'NOT_REQUIRED' : check.status === 'VERIFICATION REQUIRED' ? 'VERIFICATION_REQUIRED' : 'CHECK';
      const valueText_ = value === null || value === undefined ? NOT_PROVIDED : `${value}${check.unit ? ` ${check.unit}` : ''}`;
      const limitText_ = limit === null || limit === undefined ? '-' : `${limit}${check.unit ? ` ${check.unit}` : ''}`;
      doc.text(`${CLASSIFICATIONS[classification]} ${check.title} | ${check.status} | ${valueText_} | ${limitText_} | ${check.codeReference ?? ''}`);
      doc.fillColor('#555555');
      doc.fontSize(9);
      doc.text(`   ${check.reason}`);
      doc.fontSize(11);
      doc.fillColor('#000000');
    });
  }
  doc.moveDown(0.8);
}

function generateLegacySlabPdfReport(payload) {
  if (payload?.result?.designType === 'Column') return generateColumnPdfReport(payload);
  if (payload?.result?.designType === 'Beam') return generateBeamPdfReport(payload);
  return new Promise((resolve, reject) => {
    // The PDF and the UI must consume the same authoritative result object, so the
    // nested summary is only used as a fallback, never as a substitute.
    const source = payload.result || {};
    const result = source.calculationSteps && Array.isArray(source.checks) ? source : (source.finalDesign || source);
    const doc = new PDFDocument({ margin: 36, size: 'A4', compress: false });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).text('Automatic Rebar Detailing System', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text('Engineering Design Report', { align: 'center' });
    doc.moveDown(1);

    writeProjectDetails(doc, payload);
    writeInputParameters(doc, payload);
    // Section order mirrors the on-screen design page so the PDF reads the same way.
    writeDesignStatus(doc, result);        // 1  Design Status
    writeDesignOutput(doc, result);        // 2  Design Summary
    writeLoadCalculation(doc, result);     // 3  Loads
    writeGeometry(doc, result);            // 3b Geometry (design summary detail)
    writeSlabIterations(doc, result);      // 3c Thickness evaluation
    writeDesignForces(doc, result);        // 4  Design Forces
    writeFlexuralDesign(doc, result);      // 5  Reinforcement Design
    writeReinforcementLayout(doc, result); // 6  Reinforcement Layout (incl. cover + bar extension)
    writeCornerTorsion(doc, result);       // 7  Corner Torsion
    writeShear(doc, result);               // 8  Shear & Deflection
    writeSchematicData(doc, result);       // 9  Schematic
    writeFinalChecks(doc, result);         // 10 Engineering Checks
    writeCalculationSteps(doc, result);    // 11 Detailed Calculation Trace
    writeFinalSummary(doc, result);        // 12 Final Verification Summary
    doc.fontSize(12).text('Generated by Automatic Rebar Detailing System', { align: 'center' });
    doc.end();
  });
}

function drawSlabDetail(doc, result) {
  const lx = Number(result.shortSpan); const ly = Number(result.longSpan); const plan = { x: 85, y: 138, w: 390, h: Math.max(130, Math.min(230, 390 * lx / ly)) };
  const right = plan.x + plan.w; const bottom = plan.y + plan.h;
  doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(10.5).text('PLAN', plan.x, 112);
  doc.rect(plan.x, plan.y, plan.w, plan.h).fillAndStroke('#e0f2fe', REPORT.ink);
  [[plan.x, plan.y, right, plan.y], [plan.x, bottom, right, bottom], [plan.x, plan.y, plan.x, bottom], [right, plan.y, right, bottom]].forEach((line) => doc.moveTo(line[0], line[1]).lineTo(line[2], line[3]).lineWidth(7).strokeColor('#94a3b8').stroke());
  // Canonical mapping: Ly is PDF X, Lx is PDF Y. Thus short/main bars run vertically along Lx.
  doc.lineWidth(1.2).strokeColor(REPORT.cyan); for (let index = 1; index <= 10; index += 1) { const x = plan.x + index * plan.w / 11; doc.moveTo(x, plan.y + 4).lineTo(x, bottom - 4).stroke(); }
  doc.lineWidth(.8).strokeColor(REPORT.violet); for (let index = 1; index <= 6; index += 1) { const y = plan.y + index * plan.h / 7; doc.moveTo(plan.x + 4, y).lineTo(right - 4, y).stroke(); }
  doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(`Ly = ${number(result.longSpan)} m (long direction, horizontal)`, plan.x, bottom + 14, { width: plan.w, align: 'center' });
  doc.save().rotate(-90, { origin: [plan.x - 22, plan.y + plan.h / 2] }).text(`Lx = ${number(result.shortSpan)} m (short direction, vertical)`, plan.x - 55, plan.y + plan.h / 2 - 30, { width: 60, align: 'center' }).restore();
  doc.fillColor(REPORT.cyan).text(`Short/main: ${reinforcementText(result.shortDirectionReinforcement)} - bottom layer, vertical along Lx`, plan.x, bottom + 30, { width: plan.w });
  doc.fillColor(REPORT.violet).text(`Long/distribution: ${reinforcementText(result.longDirectionReinforcement)} - upper layer, horizontal along Ly`, plan.x, bottom + 43, { width: plan.w });
  doc.fillColor(REPORT.muted).text(`Supports: ${text(result.supportType)}; wall width: ${integer(result.supportWallThickness)} mm; cover: ${integer(result.clearCover)} mm; corner restraint: ${text(result.cornerRestraintLabel ?? result.cornerRestraint)}`, plan.x, bottom + 56, { width: plan.w });
}

export function generatePdfReport(payload) {
  if (payload?.result?.designType === 'Column') return generateColumnPdfReport(payload);
  if (payload?.result?.designType === 'Beam') return generateBeamPdfReport(payload);
  if (payload?.result?.coefficientStatus === 'VERIFICATION REQUIRED') {
    return new Promise((resolve, reject) => {
      const result = payload.result;
      const doc = new PDFDocument({ margin: REPORT.margin, size: 'A4', compress: false });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      header(doc, 'SLAB COEFFICIENT VERIFICATION REPORT', 'IS 456:2000 Annex D-2.1 / Table 27');
      statusBox(doc, 'VERIFICATION REQUIRED', result.coefficientNotEstablishedReason);
      section(doc, 'GEOMETRY / COEFFICIENT BASIS', 184);
      grid(doc, [
        ['Project', payload.projectName || result.projectName || 'Slab design'],
        ['Support condition', text(result.supportType)],
        ['Corner restraint', text(result.cornerRestraintLabel ?? result.cornerRestraint)],
        ['Finite aspect ratio ly/lx', number(result.aspectRatio)],
        ['Coefficient table', text(result.coefficientTableReference)],
        ['Coefficient status', 'VERIFICATION REQUIRED']
      ], 207);
      section(doc, 'UNRESOLVED COEFFICIENT', 320);
      doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(10).text('Alpha x: NOT ESTABLISHED', REPORT.margin, 348);
      doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(10).text('Alpha y: NOT ESTABLISHED', REPORT.margin, 368);
      doc.fillColor(REPORT.muted).font('Helvetica').fontSize(9).text(result.coefficientNotEstablishedReason, REPORT.margin, 402, { width: REPORT.width });
      doc.fillColor(REPORT.muted).font('Helvetica').fontSize(8).text(
        'The published infinity column is not treated as a finite interpolation endpoint. No design coefficients, moments, or reinforcement values are inferred in this report.',
        REPORT.margin,
        455,
        { width: REPORT.width }
      );
      doc.end();
    });
  }
  return new Promise((resolve, reject) => {
    const source = payload.result || {}; const result = source.calculationSteps && Array.isArray(source.checks) ? source : (source.finalDesign || source);
    const doc = new PDFDocument({ margin: REPORT.margin, size: 'A4', compress: false }); const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const short = result.shortDirectionReinforcement || {}; const long = result.longDirectionReinforcement || {};
    const status = result.finalStatus || result.designStatus; const reason = (result.checks || []).find((check) => check.status === 'FAIL' || check.status === 'VERIFICATION REQUIRED')?.reason || result.adoptedThicknessReason;
    header(doc, 'SLAB DESIGN REPORT', 'IS 456:2000 | Authoritative calculation result'); statusBox(doc, status, reason);
    section(doc, 'PROJECT / INPUTS / LOADS', 177); grid(doc, [['Project', payload.projectName || 'Slab design'], ['Concrete / steel', `${text(result.concreteGrade ?? payload.concreteGrade ?? (Number.isFinite(Number(result.fck)) ? `M${result.fck}` : undefined))} / ${text(result.steelGrade ?? payload.steelGrade ?? (Number.isFinite(Number(result.fy)) ? `Fe${result.fy}` : undefined))}`], ['Slab type', text(result.slabType)], ['Support condition', text(result.supportType)], ['Floor finish / live load', `${number(result.floorFinish)} / ${number(result.liveLoad)} kN/m2`], ['Corner restraint', text(result.cornerRestraintLabel ?? result.cornerRestraint)]], 200);
    section(doc, 'GEOMETRY / DESIGN FORCES', 308); grid(doc, [['Lx / Ly', `${number(result.shortSpan)} / ${number(result.longSpan)} m`], ['Thickness', `${integer(result.slabThickness)} mm`], ['Effective depth X / Y', `${integer(result.effectiveDepthShort)} / ${integer(result.effectiveDepthLong)} mm`], ['Clear cover', `${integer(result.clearCover)} mm`], ['Aspect ratio Ly/Lx', number(result.aspectRatio)], ['Support / wall width', `${integer(result.supportWallThickness)} mm`]], 331);
    section(doc, 'REINFORCEMENT DESIGN SUMMARY', 439);
    summaryCard(doc, 'SHORT DIRECTION / LX', result.checksByCategory?.flexureShort?.status || status, [
      reinforcementText(short),
      `Flexural / governing / provided Ast: ${number(result.AstFlexuralRequiredShort)} / ${number(result.AstRequiredShort)} / ${number(result.AstProvidedShort)} mm2/m`,
      `Mu: ${number(result.MuShort)} kN-m/m; spacing: ${number(short.spacing)} mm c/c`,
      `Shear: ${text(result.shearStatus)}`,
      `Deflection: ${text(result.checksByCategory?.deflection?.status)}`
    ], REPORT.margin, 463);
    summaryCard(doc, 'LONG DIRECTION / LY', result.checksByCategory?.flexureLong?.status || status, [
      reinforcementText(long),
      `Flexural / governing / provided Ast: ${number(result.AstFlexuralRequiredLong)} / ${number(result.AstRequiredLong)} / ${number(result.AstProvidedLong)} mm2/m`,
      `Mu: ${number(result.MuLong)} kN-m/m; spacing: ${number(long.spacing)} mm c/c`
    ], 304, 463);
    doc.roundedRect(REPORT.margin, 592, REPORT.width, 32, 5).fillAndStroke(REPORT.fill, REPORT.line);
    doc.fillColor(REPORT.muted).font('Helvetica').fontSize(7.5).text('SLAB-LEVEL DESIGN DECISION', REPORT.margin + 10, 600);
    doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(8.5).text(`Adopted thickness: ${result.adoptedThickness == null ? 'NOT ADOPTED' : `${integer(result.adoptedThickness)} mm`}`, REPORT.margin + 10, 611);
    const checkValue = (value, unit = '') => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? `${number(value)}${unit ? ` ${unit}` : ''}` : `${text(value)}${unit ? ` ${unit}` : ''}`;
    doc.addPage(); header(doc, 'SLAB REINFORCEMENT LAYOUT', 'SCHEMATIC - symbolic bar lines are NOT physical bar counts or a bar-bending schedule.'); drawSlabDetail(doc, result);
    checkTable(doc, (result.checks || []).map((check) => check.id === 'effectiveSpan'
      ? {
        name: check.title || check.name,
        actual: `${number(result.effectiveShortSpan)} / ${number(result.effectiveLongSpan)} m`,
        limit: 'IS 456:2000 Clause 22.2',
        status: check.status
      }
      : { name: check.title || check.name, actual: checkValue(check.actualValue ?? check.actual, check.unit), limit: checkValue(check.limitValue ?? check.limit, check.unit), status: check.status }), 470);
    doc.addPage(); header(doc, 'DETAILED CALCULATION TRACE', 'Concise authoritative calculation summary and design limitations.');
    traceCard(doc, 'LOADS / GEOMETRY', [`Lx / Ly = ${number(result.shortSpan)} / ${number(result.longSpan)} m; thickness = ${integer(result.slabThickness)} mm`, `Self weight / service load = ${number(result.selfWeight)} / ${number(result.serviceLoad)} kN/m2`], 108);
    traceCard(doc, 'BENDING', [`alpha x / y = ${number(result.alphaX)} / ${number(result.alphaY)}; Mx / My = ${number(result.MuShort)} / ${number(result.MuLong)} kN-m/m`, `Flexural / governing / provided Ast, short: ${number(result.AstFlexuralRequiredShort)} / ${number(result.AstRequiredShort)} / ${number(result.AstProvidedShort)}; long: ${number(result.AstFlexuralRequiredLong)} / ${number(result.AstRequiredLong)} / ${number(result.AstProvidedLong)} mm2/m`], 170);
    traceCard(doc, 'SHEAR & DEFLECTION', [`tau_c (IS 456 Table 19): ${text(result.concreteShearStrength)} N/mm2; Concrete shear capacity: ${text(result.shearCapacity)} kN/m; Status: ${text(result.shearStatus)}`, `L/d actual / permissible = ${number(result.actualLd)} / ${number(result.permissibleLd)}; ${text(result.deflectionStatus)}`], 232);
    traceCard(doc, 'CORNER TORSION / REINFORCEMENT LAYOUT', [`Corner torsion: ${text(result.cornerTorsionStatus)}; short reinforcement: ${reinforcementText(short)}`, `Long reinforcement: ${reinforcementText(long)}; Required steel for design: ${text(result.shortDirectionAstRequired)} mm\u00b2/m`], 294);
    traceCard(doc, 'REINFORCEMENT DETAILING', [
      `Short direction: Number of bars: ${text(result.detailing?.shortDirection?.numberOfBars, NOT_ESTABLISHED)}; status: ${text(result.detailing?.shortDirection?.detailingStatus, NOT_ESTABLISHED)}`,
      `Long direction: Number of bars: ${text(result.detailing?.longDirection?.numberOfBars, NOT_ESTABLISHED)}; status: ${text(result.detailing?.longDirection?.detailingStatus, NOT_ESTABLISHED)}`
    ], 356);
    traceCard(doc, 'SLAB DESIGN ITERATIONS', [`Evaluated thicknesses: ${integer(result.evaluatedThicknessCount)}; increments: ${integer(result.incrementCount)}; adopted: ${result.adoptedThickness == null ? 'NOT ADOPTED' : `${integer(result.adoptedThickness)} mm`}`, 'The complete executed iteration data remains authoritative in the calculation result.'], 418);
    section(doc, 'ASSUMPTIONS / LIMITATIONS', 486); (result.assumptions || []).slice(0, 8).forEach((assumption, index) => doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(`- ${text(assumption)}`, REPORT.margin + 4, 511 + index * 19, { width: REPORT.width - 8 }));
    doc.fillColor(REPORT.ink).font('Helvetica-Bold').fontSize(8).text(`FINAL VERIFICATION SUMMARY - Final design status: ${text(status)}`, REPORT.margin, 710, { width: REPORT.width });
    doc.fillColor(REPORT.muted).font('Helvetica').fontSize(7).text('All report values and drawing labels are formatted directly from the authoritative slab calculation result.', REPORT.margin, 744, { width: REPORT.width, align: 'center' });
    // The appendix preserves the established audit disclosures.  It is presentation
    // only: every allowance and status below is read from the authoritative result.
    doc.addPage(); header(doc, 'APPENDIX — SUPPORTING CALCULATION TRACE', 'Authoritative calculation disclosures, code references and verification notes.'); doc.y = 108;
    [
      `Short span Lx: ${result.shortSpan} m`, `Long span Ly: ${result.longSpan} m`,
      `[CALCULATED] Mu-x (short direction): ${result.MuShort} kN\u00b7m/m`, `[CALCULATED] Mu-y (long direction): ${result.MuLong} kN\u00b7m/m`,
      `[CALCULATED] Short Ast flexural / minimum / governing / provided: ${result.AstFlexuralRequiredShort} / ${result.AstMinimumShort} / ${result.AstRequiredShort} / ${result.AstProvidedShort} mm\u00b2/m`,
      `[CALCULATED] Long Ast flexural / minimum / governing / provided: ${result.AstFlexuralRequiredLong} / ${result.AstMinimumLong} / ${result.AstRequiredLong} / ${result.AstProvidedLong} mm\u00b2/m`,
      `[CHECK] Final design status: ${status}`, `Thicknesses evaluated: ${result.evaluatedThicknessCount}`,
      `Adopted slab thickness: ${result.adoptedThickness == null ? 'NOT ADOPTED' : `${result.adoptedThickness} mm`}`, 'Modification factor: MANUAL VERIFICATION REQUIRED',
      `Short direction / Lx = ${result.shortSpan} m: ${reinforcementText(short)}`, `Long direction / Ly = ${result.longSpan} m: ${reinforcementText(long)}`, 'SCHEMATIC - NOT TO SCALE'
    ].forEach((line) => doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(line, REPORT.margin, doc.y, { width: REPORT.width }));
    const checks = Array.isArray(result.checks) ? result.checks : [];
    const checkCount = (checkStatus) => checks.filter((check) => check.status === checkStatus).length;
    const barExtension = result.barExtension || {};
    [
      '[INPUT] Spans are centre-to-centre support spans.',
      '[CALCULATED] Leff = min(clear span + d, centre-to-centre support span).',
      `[DERIVED] Coefficient basis: ${text(result.coefficientTableReference, 'IS 456:2000 Table 27')} - Annex D-2.1 / Table 27; finite interpolation only through m = 2.5; infinity is not a finite endpoint.`,
      `[NOT REQUIRED] Corner torsion basis: IS 456:2000 Annex D-2.1; status: ${text(result.cornerTorsionStatus)}.`,
      '[VERIFICATION REQUIRED] BAR EXTENSION / CURTAILMENT (IS 456:2000 Annex D-2.1.1).',
      text(barExtension.short?.terminationAllowanceExpression), text(barExtension.long?.terminationAllowanceExpression),
      '[CALCULATED] SHEAR BASIS: conservative upper bound from the authoritative one-metre strip check.',
      `[CHECK] Cover vs bar diameter (geometric): ${text(checks.find((check) => check.id === 'coverGeometric')?.status)}.`,
      `[VERIFICATION REQUIRED] Cover durability / fire basis: ${text(checks.find((check) => check.id === 'cover')?.status)}.`,
      'Slab thickness is not a Clause 26.4 check for nominal cover; durability/fire input verification remains required.',
      `Checks: ${checkCount('PASS')} PASS, ${checkCount('NOT REQUIRED')} NOT REQUIRED, ${checkCount('VERIFICATION REQUIRED')} VERIFICATION REQUIRED, ${checkCount('FAIL')} FAIL.`
    ].forEach((line) => doc.fillColor(REPORT.ink).font('Helvetica').fontSize(8).text(line, REPORT.margin, doc.y, { width: REPORT.width }));
    doc.end();
  });
}
