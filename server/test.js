import { generateSlabDesign } from './src/services/slabCalculationService.js';

const result = generateSlabDesign({
  projectName: 'Test',
  designerName: 'Test',
  length: 5,
  width: 3,
  slabThickness: 150,
  wallThickness: 150,
  supportType: 'Simply Supported',
  clearCover: 25,
  concreteGrade: 'M35',
  steelGrade: 'Fe500',
  liveLoad: 3,
  floorFinishLoad: 1.5,
  unitWeightConcrete: 25,
  preferredBarDiameter: 12
});

console.log('=== SLAB DESIGN TEST RESULTS ===');
console.log('Slab Type:', result.slabType);
console.log('Aspect Ratio:', result.aspectRatio);
console.log('Short Span:', result.shortSpan, 'm');
console.log('Long Span:', result.longSpan, 'm');
console.log('');
console.log('Effective Depth:', result.effectiveDepth, 'mm');
console.log('Self Weight:', result.selfWeight, 'kN/m²');
console.log('Ultimate Load:', result.ultimateLoad, 'kN/m²');
console.log('');
console.log('Alpha X:', result.alphaX);
console.log('Alpha Y:', result.alphaY);
console.log('Moment X (Short):', result.momentX, 'kN·m/m');
console.log('Moment Y (Long):', result.momentY, 'kN·m/m');
console.log('');
console.log('Short Direction Reinforcement:', result.shortDirectionReinforcement);
console.log('Long Direction Reinforcement:', result.longDirectionReinforcement);
console.log('');
console.log('Design Status:', result.designStatus);
