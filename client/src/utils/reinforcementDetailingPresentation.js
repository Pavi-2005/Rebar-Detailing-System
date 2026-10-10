export const NOT_ESTABLISHED = 'NOT ESTABLISHED';

export function slabDetailingPresentation(detailing = {}) {
  const direction = (value = {}) => ({
    barDiameter: value.barDiameter ?? NOT_ESTABLISHED,
    spacing: value.spacing ?? NOT_ESTABLISHED,
    astProvided: value.astProvided ?? NOT_ESTABLISHED,
    numberOfBars: value.numberOfBars ?? NOT_ESTABLISHED,
    availablePlacementWidth: value.availablePlacementWidth ?? NOT_ESTABLISHED,
    barArrangement: value.barArrangement ?? NOT_ESTABLISHED,
    detailingStatus: value.detailingStatus ?? NOT_ESTABLISHED
  });

  return {
    shortDirection: direction(detailing.shortDirection),
    longDirection: direction(detailing.longDirection)
  };
}

export function footingBarCountPresentation(reinforcement = {}) {
  return {
    x: reinforcement.x?.bars ?? NOT_ESTABLISHED,
    y: reinforcement.y?.bars ?? NOT_ESTABLISHED
  };
}

export function slabShearStatusPresentation(result = {}) {
  return result.shearStatus ?? NOT_ESTABLISHED;
}
