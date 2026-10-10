export default function FootingReinforcementDiagram({ result }) {
  if (!result?.geometry || !result?.reinforcement) return null;
  const { geometry: g, reinforcement: r, punchingShear: p } = result;
  const plan = { x: 70, y: 80, w: 390, h: 260 };
  const sx = plan.w / g.footingLength;
  const sy = plan.h / g.footingWidth;
  const col = { x: plan.x + (plan.w - g.columnWidth * sx) / 2, y: plan.y + (plan.h - g.columnDepth * sy) / 2, w: g.columnWidth * sx, h: g.columnDepth * sy };
  const centralBand = g.footingLength > g.footingWidth ? { x: plan.x + (plan.w - g.footingWidth * sx) / 2, y: plan.y, w: g.footingWidth * sx, h: plan.h } : g.footingWidth > g.footingLength ? { x: plan.x, y: plan.y + (plan.h - g.footingLength * sy) / 2, w: plan.w, h: g.footingLength * sy } : null;
  const oneWaySectionX = 605 + ((g.columnWidth / 2 + g.effectiveDepth) / g.footingLength) * 120;
  const xBars = r.x.barCenters || [];
  const yBars = r.y.barCenters || [];
  return <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
    <h4 className="font-semibold">Footing reinforcement detail</h4>
    <p className="mt-1 text-xs text-slate-400">Calculated bar-centre coordinates, cover and symbolic critical sections. Not a bar-bending schedule.</p>
    <svg viewBox="0 0 760 500" className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950" role="img" aria-label="Footing plan and section reinforcement detail">
      <text x="70" y="35" fill="#e2e8f0" fontSize="15" fontWeight="600">Plan</text><text x="535" y="35" fill="#e2e8f0" fontSize="15" fontWeight="600">Section</text>
      <rect {...plan} fill="#172554" stroke="#38bdf8" strokeWidth="2" />
      {centralBand && <rect {...centralBand} fill="#f59e0b" fillOpacity="0.12" stroke="#f59e0b" strokeDasharray="5 4" />}
      {xBars.map((centre, index) => <line key={`x${index}`} x1={plan.x + 12} x2={plan.x + plan.w - 12} y1={plan.y + centre / g.footingWidth * plan.h} y2={plan.y + centre / g.footingWidth * plan.h} stroke="#38bdf8" />)}
      {yBars.map((centre, index) => <line key={`y${index}`} y1={plan.y + 12} y2={plan.y + plan.h - 12} x1={plan.x + centre / g.footingLength * plan.w} x2={plan.x + centre / g.footingLength * plan.w} stroke="#c4b5fd" />)}
      <rect {...col} fill="#cbd5e1" stroke="#f8fafc" />
      <rect x={plan.x + (plan.w - p.perimeterDimensions.width / g.footingLength * plan.w) / 2} y={plan.y + (plan.h - p.perimeterDimensions.depth / g.footingWidth * plan.h) / 2} width={p.perimeterDimensions.width / g.footingLength * plan.w} height={p.perimeterDimensions.depth / g.footingWidth * plan.h} fill="none" stroke="#f59e0b" strokeDasharray="5 4" />
      <text x={plan.x + plan.w / 2} y="365" textAnchor="middle" fill="#e2e8f0" fontSize="11">L = {g.footingLength} mm</text><text x="45" y={plan.y + plan.h / 2} textAnchor="middle" fill="#e2e8f0" fontSize="11" transform={`rotate(-90 45 ${plan.y + plan.h / 2})`}>B = {g.footingWidth} mm</text>
      <text x="70" y="392" fill="#38bdf8" fontSize="11">X: {r.x.bars} × {r.x.diameter} mm @ {r.x.spacing} mm c/c</text><text x="70" y="411" fill="#c4b5fd" fontSize="11">Y: {r.y.bars} × {r.y.diameter} mm @ {r.y.spacing} mm c/c</text><text x="70" y="430" fill="#f59e0b" fontSize="11">Amber band: short-direction central band; dashed: punching perimeter</text>
      <rect x="545" y="135" width="120" height="210" fill="#172554" stroke="#38bdf8" strokeWidth="2" /><rect x="580" y="62" width="50" height="73" fill="#cbd5e1" stroke="#e2e8f0" /><line x1="557" y1="322" x2="653" y2="322" stroke="#38bdf8" strokeWidth="5" /><line x1="535" y1="322" x2="675" y2="322" stroke="#c4b5fd" strokeDasharray="4 3" /><line x1={oneWaySectionX} y1="135" x2={oneWaySectionX} y2="345" stroke="#f59e0b" strokeDasharray="5 4" />
      <text x="545" y="370" fill="#e2e8f0" fontSize="11">T = {g.footingThickness} mm</text><text x="545" y="389" fill="#e2e8f0" fontSize="11">d = {g.effectiveDepth} mm; cover = {g.clearCover} mm</text><text x="545" y="408" fill="#f59e0b" fontSize="10">Amber dashed: one-way shear cut at d from column face</text>
    </svg>
  </section>;
}
