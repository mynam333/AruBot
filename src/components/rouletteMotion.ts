export type RouletteMotionProfile = {
  acceleration: number;
  cruise: number;
  braking: number;
  turns: number;
  pointer: number;
  recoil: number;
};

// Curves describe material inertia; they never select or change a winner.
const profiles: Record<string, RouletteMotionProfile> = {
  studio:  { acceleration: .07, cruise: .20, braking: 2.2, turns: 6, pointer: 7, recoil: 1 },
  prism:   { acceleration: .08, cruise: .30, braking: 2.6, turns: 7, pointer: 10, recoil: 3 },
  aurora:  { acceleration: .18, cruise: .32, braking: 2.5, turns: 5, pointer: 2, recoil: 0 },
  velvet:  { acceleration: .18, cruise: .38, braking: 2.8, turns: 6, pointer: 12, recoil: 2 },
  mono:    { acceleration: .05, cruise: .16, braking: 1.9, turns: 5, pointer: 0, recoil: 0 },
  deco:    { acceleration: .12, cruise: .28, braking: 2.4, turns: 6, pointer: 6, recoil: 1 },
  crystal: { acceleration: .14, cruise: .25, braking: 2.3, turns: 5, pointer: 3, recoil: 1 },
  ink:     { acceleration: .21, cruise: .25, braking: 2.7, turns: 4, pointer: 0, recoil: 0 },
  nova:    { acceleration: .16, cruise: .40, braking: 2.9, turns: 7, pointer: 8, recoil: 2 },
  ceramic: { acceleration: .19, cruise: .29, braking: 2.4, turns: 5, pointer: 4, recoil: 1 },
  arcade:  { acceleration: .04, cruise: .42, braking: 2.1, turns: 8, pointer: 13, recoil: 4 },
  sakura:  { acceleration: .20, cruise: .33, braking: 2.6, turns: 5, pointer: 2, recoil: 0 },
  ocean:   { acceleration: .17, cruise: .37, braking: 2.3, turns: 6, pointer: 9, recoil: 2 },
  solar:   { acceleration: .06, cruise: .38, braking: 2.8, turns: 8, pointer: 11, recoil: 3 },
  cyber:   { acceleration: .03, cruise: .32, braking: 2.0, turns: 7, pointer: 0, recoil: 0 },
  gold:    { acceleration: .15, cruise: .35, braking: 2.6, turns: 6, pointer: 10, recoil: 2 },
};

export function getRouletteMotionProfile(theme: string): RouletteMotionProfile {
  return profiles[theme] || profiles.studio;
}

// Integral of a cosine launch, constant-speed run and continuous power brake.
// Position and velocity are continuous at both joins, and velocity ends at zero.
export function rouletteMotionProgress(time: number, profile: RouletteMotionProfile): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(time) ? time : 0));
  if (t === 0 || t === 1) return t;
  const { acceleration: a, cruise: c, braking: power } = profile;
  const total = a / 2 + c - a + (1 - c) / (power + 1);
  if (t < a) return (t / 2 - a * Math.sin(Math.PI * t / a) / (2 * Math.PI)) / total;
  if (t < c) return (a / 2 + t - a) / total;
  const brake = (t - c) / (1 - c);
  return (a / 2 + c - a + (1 - c) * (1 - Math.pow(1 - brake, power + 1)) / (power + 1)) / total;
}

export function rouletteWheelKeyframes(start: number, finish: number, profile: RouletteMotionProfile): Keyframe[] {
  return Array.from({ length: 121 }, (_, index) => {
    const offset = index / 120;
    return { offset, transform: `rotate(${start + (finish - start) * rouletteMotionProgress(offset, profile)}deg)` };
  });
}

export function rouletteMotionPhase(time: number, profile: RouletteMotionProfile) {
  if (time >= 1) return 'settled';
  if (time < profile.acceleration) return 'launch';
  return time < profile.cruise ? 'cruise' : 'brake';
}
