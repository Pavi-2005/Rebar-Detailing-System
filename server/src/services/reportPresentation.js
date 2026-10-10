// Presentation-only primitives shared by structural PDF reports.  These helpers do
// not derive engineering values or statuses; callers pass the authoritative result.
export const REPORT = { margin: 36, width: 523, ink: '#0f172a', muted: '#475569', line: '#cbd5e1', fill: '#f8fafc', cyan: '#0284c7', violet: '#7c3aed', amber: '#b45309', green: '#15803d', approved: '#0369a1', red: '#b91c1c' };

export const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
export const text = (value, fallback = 'NOT ESTABLISHED') => value === undefined || value === null || value === '' || (typeof value === 'number' && !Number.isFinite(value)) ? fallback : String(value);
export const number = (value, digits = 3, fallback = 'NOT ESTABLISHED') => finite(value) ? Number(value).toFixed(digits) : fallback;
export const integer = (value, fallback = 'NOT ESTABLISHED') => finite(value) ? Number(value).toFixed(0) : fallback;
export const statusColor = (status) => status === 'APPROVED' ? REPORT.approved : status === 'PASS' ? REPORT.green : status === 'FAIL' ? REPORT.red : REPORT.amber;

export function header(doc, title, subtitle = '') {
  const { margin, width, ink, muted, line } = REPORT;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text('AUTOMATIC REBAR DETAILING SYSTEM', margin, 36, { width });
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text(title, margin, 59, { width });
  if (subtitle) doc.fillColor(muted).font('Helvetica').fontSize(8).text(subtitle, margin, 74, { width });
  doc.moveTo(margin, 88).lineTo(margin + width, 88).lineWidth(0.8).strokeColor(line).stroke();
}

export function section(doc, title, y) {
  const { margin, width, ink, line } = REPORT;
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(10.5).text(title, margin, y, { width });
  doc.moveTo(margin, y + 15).lineTo(margin + width, y + 15).lineWidth(0.5).strokeColor(line).stroke();
}

export function statusPill(doc, status, x, y, width = 116) {
  const color = statusColor(status);
  doc.roundedRect(x, y, width, 21, 10).fillAndStroke(`${color}22`, color);
  doc.fillColor(color).font('Helvetica-Bold').fontSize(7.3).text(text(status), x + 4, y + 7, { width: width - 8, align: 'center', lineBreak: false });
}

export function statusBox(doc, status, reason) {
  const { margin, width, ink, muted } = REPORT;
  doc.roundedRect(margin, 104, width, 54, 7).fillAndStroke('#fff7ed', '#f59e0b');
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('FINAL DESIGN STATUS', margin + 12, 116);
  statusPill(doc, status, 403, 113, 144);
  doc.fillColor(ink).font('Helvetica').fontSize(8.2).text(`Reason: ${text(reason, 'See authoritative design checks and limitations.')}`, margin + 12, 133, { width: 340, height: 16, ellipsis: true });
}

export function grid(doc, entries, y, columns = 2) {
  const { margin, width, ink, muted, line } = REPORT;
  const cellWidth = width / columns;
  entries.forEach(([label, display], index) => {
    const x = margin + (index % columns) * cellWidth;
    const top = y + Math.floor(index / columns) * 32;
    doc.rect(x, top, cellWidth, 32).lineWidth(0.4).strokeColor(line).stroke();
    doc.fillColor(muted).font('Helvetica').fontSize(7.3).text(text(label), x + 7, top + 6, { width: cellWidth - 14, lineBreak: false });
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(8.5).text(text(display), x + 7, top + 17, { width: cellWidth - 14, lineBreak: false, ellipsis: true });
  });
}

export function summaryCard(doc, title, status, lines, x, y, width = 255, height = 112) {
  const { ink, muted, line, fill } = REPORT;
  doc.roundedRect(x, y, width, height, 6).fillAndStroke(fill, line);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(9.5).text(title, x + 10, y + 10, { width: width - 110, lineBreak: false });
  statusPill(doc, status, x + width - 89, y + 8, 79);
  lines.filter(Boolean).slice(0, 5).forEach((lineText, index) => doc.fillColor(index === 0 ? ink : muted).font(index === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(index === 0 ? 9 : 7.5).text(text(lineText), x + 10, y + 31 + index * 14, { width: width - 20, lineBreak: false, ellipsis: true }));
}

export function checkTable(doc, checks, y) {
  const { margin, width, ink, line, fill } = REPORT;
  section(doc, 'ENGINEERING CHECKS / DESIGN CHECKS', y);
  const columns = [165, 130, 130, 98]; const labels = ['Check', 'Demand / provided', 'Limit / required', 'Status'];
  let x = margin; const top = y + 24;
  columns.forEach((w, index) => { doc.rect(x, top, w, 20).fillAndStroke('#e2e8f0', line); doc.fillColor(ink).font('Helvetica-Bold').fontSize(7).text(labels[index], x + 4, top + 7, { width: w - 8, align: 'center', lineBreak: false }); x += w; });
  checks.slice(0, 13).forEach((row, rowIndex) => {
    let xx = margin; const yy = top + 20 + rowIndex * 20;
    [row.name, row.actual, row.limit, row.status].forEach((cell, columnIndex) => { const w = columns[columnIndex]; doc.rect(xx, yy, w, 20).fillAndStroke(rowIndex % 2 ? '#ffffff' : fill, line); doc.fillColor(columnIndex === 3 ? statusColor(row.status) : ink).font(columnIndex === 3 ? 'Helvetica-Bold' : 'Helvetica').fontSize(columnIndex === 3 ? 6.4 : 7).text(text(cell), xx + 4, yy + 7, { width: w - 8, align: columnIndex === 3 ? 'center' : 'left', lineBreak: false, ellipsis: true }); xx += w; });
  });
}

export function traceCard(doc, title, lines, y) {
  const { margin, width, ink, muted, line, fill } = REPORT;
  doc.roundedRect(margin, y, width, 52, 5).fillAndStroke(fill, line);
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(9).text(title, margin + 9, y + 8);
  lines.filter(Boolean).slice(0, 2).forEach((lineText, index) => doc.fillColor(index ? muted : ink).font('Helvetica').fontSize(7.5).text(text(lineText), margin + 9, y + 21 + index * 10, { width: width - 18, lineBreak: false, ellipsis: true }));
}
