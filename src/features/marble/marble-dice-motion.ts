export type DiceVector = [number, number, number];
export type DiceQuaternion = [number, number, number, number];

export const MARBLE_DICE_SETTLED_AT = 0.8;
export const MARBLE_DICE_RADIUS = 0.1;
export const MARBLE_DICE_VIEW = {
  width: 440,
  height: 146,
  verticalSpan: 1.7,
  target: [0, 0.65, 0] as DiceVector,
  position: [0, 3.15, 10] as DiceVector,
};

// RoundedBoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
export const MARBLE_DICE_FACES = [3, 4, 1, 6, 2, 5] as const;
export const MARBLE_DICE_PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

const HALF_PI = Math.PI / 2;
const FACE_ROTATIONS: Readonly<Record<number, DiceVector>> = {
  1: [HALF_PI, 0, 0], 2: [0, 0, 0], 3: [0, -HALF_PI, 0],
  4: [0, HALF_PI, 0], 5: [0, Math.PI, 0], 6: [-HALF_PI, 0, 0],
};

export function marbleDiceValues(dice: readonly number[]): number[] {
  return dice.slice(0, 2).filter(value => Number.isInteger(value) && value >= 1 && value <= 6);
}

export function marbleDiceProgress(progress: number): number {
  return Number.isNaN(progress) ? 0 : Math.max(0, Math.min(1, progress));
}

function quaternion([x, y, z]: DiceVector): DiceQuaternion {
  const cx = Math.cos(x / 2), cy = Math.cos(y / 2), cz = Math.cos(z / 2);
  const sx = Math.sin(x / 2), sy = Math.sin(y / 2), sz = Math.sin(z / 2);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}

function multiply(a: DiceQuaternion, b: DiceQuaternion): DiceQuaternion {
  const [x, y, z, w] = a, [bx, by, bz, bw] = b;
  return [w * bx + x * bw + y * bz - z * by, w * by - x * bz + y * bw + z * bx,
    w * bz + x * by - y * bx + z * bw, w * bw - x * bx - y * by - z * bz];
}

// Support of a rounded unit box (inner cube + radius). The lowest point stays
// on y=0 even while rocking; using a constant center height would sink corners.
export function marbleDiceSupport([x, y, z, w]: DiceQuaternion): number {
  return MARBLE_DICE_RADIUS + (0.5 - MARBLE_DICE_RADIUS)
    * (Math.abs(2 * (x * y + z * w)) + Math.abs(1 - 2 * (x * x + z * z)) + Math.abs(2 * (y * z - x * w)));
}

function hashSeed(seed: string, index: number): number {
  let hash = (2166136261 ^ index) >>> 0;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  return hash;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixAngles = (a: DiceVector, b: DiceVector, t: number): DiceVector => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export type MarbleDiePoseInput = {
  value: number;
  index: number;
  count: number;
  progress: number;
  seed: string;
  reduced?: boolean;
};

export type MarbleDiePose = {
  position: DiceVector;
  quaternion: DiceQuaternion;
  lift: number;
  settled: boolean;
  phase: 'anticipation' | 'flight' | 'bounce' | 'settle' | 'hold';
  shadowOpacity: number;
  shadowScale: number;
};

/** Stateless authored throw, sampled from the parent's 1200 ms server phase. */
export function marbleDiePose({ value, index, count, progress, seed, reduced = false }: MarbleDiePoseInput): MarbleDiePose {
  const lane = index === 1 ? 1 : 0;
  const direction = lane === 0 ? -1 : 1;
  const hash = hashSeed(seed, lane);
  const variation = (hash & 255) / 255;
  const p = reduced ? 1 : marbleDiceProgress(progress);
  const settled = p >= MARBLE_DICE_SETTLED_AT;
  // Stagger the second launch by 22 ms without shortening the shared hold.
  const delay = lane * 0.018;
  const t = settled ? MARBLE_DICE_SETTLED_AT : Math.max(0, p - delay) * MARBLE_DICE_SETTLED_AT / (MARBLE_DICE_SETTLED_AT - delay);
  const yaw = direction * (0.17 + variation * 0.055);
  const target = multiply(quaternion([0, yaw, 0]), quaternion(FACE_ROTATIONS[value] ?? FACE_ROTATIONS[1]));
  const finalX = count === 1 ? 0 : direction * 1.12;
  const finalZ = lane === 0 ? 0.045 : -0.045;
  let angles: DiceVector = [0, 0, 0];
  let lift = 0;
  let travel = 1;
  let phase: MarbleDiePose['phase'] = 'hold';

  if (t < 0.1) {
    const windup = smooth(t / 0.1);
    angles = [-0.16 * windup, 0, direction * 0.1 * windup];
    travel = -0.14 * windup;
    phase = 'anticipation';
  } else if (t < 0.47) {
    const flight = (t - 0.1) / 0.37;
    const spin = 1 - (1 - flight) ** 1.4;
    // A compact lateral throw keeps the result faces large in the fixed-height
    // overlay. The camera never zooms between flight and the held result.
    angles = mixAngles([-0.16, -direction * Math.PI * 4, direction * 0.1], [-0.34, direction * 0.18, direction * 0.14], spin);
    lift = 4 * flight * (1 - flight) * (0.13 + variation * 0.035);
    travel = mix(-0.14, 0.9, spin);
    phase = 'flight';
  } else if (t < 0.63) {
    const bounce = (t - 0.47) / 0.16;
    angles = mixAngles([-0.34, direction * 0.18, direction * 0.14], [0.115, -direction * 0.045, -direction * 0.065], smooth(bounce));
    lift = 4 * bounce * (1 - bounce) * 0.055;
    travel = mix(0.9, 1.025, smooth(bounce));
    phase = 'bounce';
  } else if (t < 0.72) {
    const bounce = (t - 0.63) / 0.09;
    angles = mixAngles([0.115, -direction * 0.045, -direction * 0.065], [-0.025, 0, direction * 0.02], smooth(bounce));
    lift = 4 * bounce * (1 - bounce) * 0.015;
    travel = mix(1.025, 1, smooth(bounce));
    phase = 'bounce';
  } else if (!settled) {
    const settle = smooth((t - 0.72) / 0.08);
    angles = mixAngles([-0.025, 0, direction * 0.02], [0, 0, 0], settle);
    phase = 'settle';
  }

  const rotation = settled ? target : multiply(quaternion(angles), target);
  return {
    position: [finalX + direction * 0.24 * (1 - travel), marbleDiceSupport(rotation) + lift, finalZ - 0.12 * (1 - travel)],
    quaternion: rotation,
    lift,
    settled,
    phase,
    shadowOpacity: 0.25 / (1 + lift * 4),
    shadowScale: 1 + lift * 0.55,
  };
}
