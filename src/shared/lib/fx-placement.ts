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

export function fxPlacementStyle(item: FxPlacement, viewport?: { width: number; height: number }) {
  const width = length(item.width, item.widthUnit, 30);
  const height = length(item.height, item.heightUnit, 30);
  if (item.positionMode !== 'random') {
    return { left: length(item.x, item.xUnit, 50), top: length(item.y, item.yUnit, 50), width, height };
  }
  const x = fraction(item.positionAnchor?.x ?? 0.5);
  const y = fraction(item.positionAnchor?.y ?? 0.5);
  if (viewport) {
    const pixels = (value: unknown, unit: unknown, extent: number) => {
      const size = Number.isFinite(Number(value)) ? Number(value) : 30;
      return Math.max(0, Math.min(extent, unit === 'px' ? size : extent * size / 100));
    };
    const w = pixels(item.width, item.widthUnit, viewport.width);
    const h = pixels(item.height, item.heightUnit, viewport.height);
    return {
      left: `${w / 2 + (viewport.width - w) * x}px`,
      top: `${h / 2 + (viewport.height - h) * y}px`,
      width: `${w}px`, height: `${h}px`,
    };
  }
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
