type FxPlacement = {
  positionMode?: 'fixed' | 'random';
  positionAnchor?: { x: number; y: number };
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  xUnit?: '%' | 'px';
  yUnit?: '%' | 'px';
  widthUnit?: '%' | 'px';
  heightUnit?: '%' | 'px';
};

function length(value: unknown, unit: unknown, fallback: number) {
  const number = Number(value);
  return `${Number.isFinite(number) ? number : fallback}${unit === 'px' ? 'px' : '%'}`;
}

function fraction(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

export function sampleFxPosition(random = Math.random) {
  return { x: fraction(random()), y: fraction(random()) };
}

export function fxPlacementStyle(item: FxPlacement) {
  const width = length(item.width, item.widthUnit, 30);
  const height = length(item.height, item.heightUnit, 30);
  if (item.positionMode !== 'random') {
    return { left: length(item.x, item.xUnit, 50), top: length(item.y, item.yUnit, 50), width, height };
  }
  const x = fraction(item.positionAnchor?.x ?? 0.5);
  const y = fraction(item.positionAnchor?.y ?? 0.5);
  const boundedWidth = `min(100%, ${width})`;
  const boundedHeight = `min(100%, ${height})`;
  // Keep the same sampled position on updates/resizes, within the available area.
  return {
    left: `calc(${boundedWidth} * 0.5 + (100% - ${boundedWidth}) * ${x})`,
    top: `calc(${boundedHeight} * 0.5 + (100% - ${boundedHeight}) * ${y})`,
    width: boundedWidth,
    height: boundedHeight,
  };
}
