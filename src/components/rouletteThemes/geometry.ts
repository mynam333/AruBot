export function point(radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 500 + Math.sin(angle * Math.PI / 180) * radius, y: 500 + Math.sin(radians) * radius };
}

export function polygon(sides: number, radius: number, offset = 0) {
  return Array.from({ length: sides }, (_, index) => {
    const p = point(radius, offset + index * 360 / sides);
    return `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  }).join(' ');
}

export function ring(outer = 490, inner = 415) {
  return `M500 ${500 - outer}A${outer} ${outer} 0 1 1 500 ${500 + outer}A${outer} ${outer} 0 1 1 500 ${500 - outer}Z M500 ${500 - inner}A${inner} ${inner} 0 1 0 500 ${500 + inner}A${inner} ${inner} 0 1 0 500 ${500 - inner}Z`;
}

export function scallop(radius: number, amplitude: number, lobes: number, phase = 0) {
  return Array.from({ length: 240 }, (_, index) => {
    const angle = index * 1.5;
    const p = point(radius + amplitude * Math.cos((angle * lobes + phase) * Math.PI / 180), angle);
    return `${index ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  }).join(' ') + 'Z';
}

export function aperture(outerPath: string, inner = 414) {
  return `${outerPath} M500 ${500 - inner}A${inner} ${inner} 0 1 0 500 ${500 + inner}A${inner} ${inner} 0 1 0 500 ${500 - inner}Z`;
}
