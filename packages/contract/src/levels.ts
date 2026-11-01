// Levels per zone, earned from coach skill points. Names come from the hi-fi
// Levels screen; thresholds are a first guess to tune in the pilot.
export const LEVELS = [
  { level: 1, name: "Spark", from: 0 },
  { level: 2, name: "Explorer", from: 10 },
  { level: 3, name: "Maker", from: 25 },
  { level: 4, name: "Crafter", from: 45 },
  { level: 5, name: "Master", from: 70 },
] as const;

export interface LevelState {
  level: number;
  name: string;
  points: number;
  nextAt: number | null; // null at the top level
  progress: number; // 0..1 towards the next level
}

export function levelFor(points: number): LevelState {
  const p = Math.max(0, Math.floor(points));
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (p >= LEVELS[k]!.from) i = k;
  const cur = LEVELS[i]!;
  const next = LEVELS[i + 1];
  if (!next) return { level: cur.level, name: cur.name, points: p, nextAt: null, progress: 1 };
  return {
    level: cur.level,
    name: cur.name,
    points: p,
    nextAt: next.from,
    progress: (p - cur.from) / (next.from - cur.from),
  };
}

// True when going from `before` to `after` points crosses into a new level,
// which earns a digital postcard (PRD: postcards).
export function levelledUp(before: number, after: number): boolean {
  return levelFor(after).level > levelFor(before).level;
}
