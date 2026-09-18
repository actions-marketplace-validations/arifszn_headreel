import { compareRepos, type Repo, type Repos } from '../../core/data/repos.js';
import type { Rng } from '../../core/prng.js';
import type { Options } from './options.js';

export const LAYOUT = {
  width: 1280,
  height: 400,
  /** Sun, center of every orbit. */
  cx: 872,
  cy: 206,
  /** Tilt of the orbital plane on screen, radians. */
  tilt: -0.1,
  /** Orbit ellipse height / width: how far the plane leans away from the viewer. */
  aspect: 0.3,
  /** Planet radius range, px, before depth scaling. */
  minR: 3,
  maxR: 13,
  stars: 220,
  dust: 2400,
  grain: 2600,
} as const;

/**
 * Orbits by time since the last push: recent work circles close to the sun.
 * `revs` are whole revolutions per loop, so every orbit closes seamlessly.
 */
export const RINGS = [
  { label: '30 DAYS', maxDays: 30, rx: 132, revs: 3 },
  { label: '6 MONTHS', maxDays: 183, rx: 206, revs: 2 },
  { label: '2 YEARS', maxDays: 730, rx: 282, revs: 1 },
  { label: 'OLDER', maxDays: Infinity, rx: 360, revs: 1 },
] as const;

export type Rgb = readonly [number, number, number];

export interface Planet {
  name: string;
  stars: number;
  /** 0 = most starred. */
  rank: number;
  ring: number;
  r: number;
  color: Rgb;
  /** Orbit angle at phase 0, radians. */
  angle: number;
  label: boolean;
}

export interface Star {
  x: number;
  y: number;
  s: number;
  a: number;
  cycles: number;
  off: number;
}

export interface Dust {
  x: number;
  y: number;
  a: number;
  warm: boolean;
}

export interface LanguageCount {
  name: string;
  color: Rgb;
  count: number;
}

export interface Galaxy {
  planets: Planet[];
  totalStars: number;
  languages: LanguageCount[];
  stars: Star[];
  dust: Dust[];
}

/** Planets without a language, and languages without a linguist color. */
const NEUTRAL: Rgb = [154, 163, 181];
const DAY_MS = 86_400_000;

/** Linguist colors include near-black ones; lift them so every planet reads on the night sky. */
export function planetColor(hex: string | null | undefined): Rgb {
  if (!hex) return NEUTRAL;
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb(h, Math.min(s, 0.85), Math.max(l, 0.52));
}

export function ringFor(pushedAt: string, asOf: string): number {
  const days = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${pushedAt}T00:00:00Z`)) / DAY_MS;
  return RINGS.findIndex((r) => days <= r.maxDays);
}

export function selectRepos(
  data: Repos,
  options: Pick<Options, 'max_repos' | 'include_forks'>,
): Repo[] {
  return data.repos
    .filter((r) => options.include_forks || !r.fork)
    .sort(compareRepos)
    .slice(0, options.max_repos);
}

export function buildGalaxy(data: Repos, rng: Rng, options: Options): Galaxy {
  const repos = selectRepos(data, options);
  const maxStars = Math.max(0, ...repos.map((r) => r.stars));
  const scale = Math.log1p(maxStars);

  const planets: Planet[] = repos.map((repo, rank) => ({
    name: repo.name,
    stars: repo.stars,
    rank,
    ring: ringFor(repo.pushedAt, data.asOf),
    r:
      scale > 0
        ? LAYOUT.minR + (LAYOUT.maxR - LAYOUT.minR) * (Math.log1p(repo.stars) / scale)
        : LAYOUT.minR + 0.5,
    color: planetColor(repo.language?.color),
    angle: 0,
    // A repo without stars is not among the most starred, whatever its rank.
    label: options.labels === 'top3' && rank < 3 && repo.stars > 0,
  }));

  // Spread each ring's planets evenly from a seeded start, with a little jitter.
  RINGS.forEach((_, ring) => {
    const members = planets.filter((p) => p.ring === ring);
    const start = rng() * Math.PI * 2;
    const step = (Math.PI * 2) / Math.max(1, members.length);
    members.forEach((p, i) => {
      p.angle = start + i * step + (rng() - 0.5) * step * 0.3;
    });
  });

  const languages = new Map<string, LanguageCount>();
  for (const repo of repos) {
    if (!repo.language) continue;
    const entry = languages.get(repo.language.name) ?? {
      name: repo.language.name,
      color: planetColor(repo.language.color),
      count: 0,
    };
    entry.count++;
    languages.set(entry.name, entry);
  }

  const stars: Star[] = Array.from({ length: LAYOUT.stars }, () => ({
    x: rng() * LAYOUT.width,
    y: rng() * LAYOUT.height,
    s: rng() < 0.07 ? 2 : 1,
    a: 30 + rng() * 140,
    cycles: 1 + Math.floor(rng() * 3),
    off: rng(),
  }));

  // A faint band of dust crossing behind the orbits, bottom left to top right.
  const dust: Dust[] = Array.from({ length: LAYOUT.dust }, () => {
    const t = rng();
    const spread = (rng() + rng() + rng() - 1.5) * 70;
    return {
      x: 380 + t * 960 + spread * 0.4,
      y: 430 - t * 470 + spread,
      a: 6 + rng() * 26,
      warm: rng() < 0.35,
    };
  });

  return {
    planets,
    totalStars: repos.reduce((sum, r) => sum + r.stars, 0),
    languages: [...languages.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 3),
    stars,
    dust,
  };
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const k = (t + 1) % 1;
    const v =
      k < 1 / 6
        ? p + (q - p) * 6 * k
        : k < 1 / 2
          ? q
          : k < 2 / 3
            ? p + (q - p) * (2 / 3 - k) * 6
            : p;
    return Math.round(v * 255);
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}
