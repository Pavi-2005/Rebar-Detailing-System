import { useMemo } from 'react';

export default function CalculationStepsPage() {
  const steps = useMemo(() => [
    {
      title: 'Step 1: Select design type',
      description: 'Choose a beam, slab, or column design and enter geometry, material properties, and loading conditions.'
    },
    {
      title: 'Step 2: Determine effective depth',
      description: 'Compute effective depth using cover, bar diameter, and section depth for accurate steel requirement.'
    },
    {
      title: 'Step 3: Calculate loads',
      description: 'Compute self weight, dead load and ultimate load using code load factors.'
    },
    {
      title: 'Step 4: Calculate design moment and shear',
      description: 'For beams and slabs use member-specific actions; for columns include minimum eccentricity and slenderness moments.'
    },
    {
      title: 'Step 5: Choose reinforcement',
      description: 'Estimate required steel area, then select bar diameter, longitudinal arrangement, and lateral ties.'
    },
    {
      title: 'Step 6: Check shear and deflection',
      description: 'Verify axial capacity, flexure, biaxial interaction, slenderness, ties, and detailing limits.'
    }
  ], []);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100 lg:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Calculation Guide</p>
          <h2 className="mt-3 text-4xl font-semibold">Step-by-step calculation workflow</h2>
          <p className="mt-4 text-slate-400">Follow each calculation stage to understand how the structural design is derived and how reinforcement is selected.</p>
        </div>

        <div className="space-y-5">
          {steps.map((step, index) => (
            <div key={index} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-lg transition hover:border-cyan-500">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500 text-lg font-semibold text-slate-950">{index + 1}</div>
                <div>
                  <h3 className="text-xl font-semibold text-slate-100">{step.title}</h3>
                  <p className="mt-2 text-slate-400">{step.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
