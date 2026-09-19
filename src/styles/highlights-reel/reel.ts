import type { Highlights } from '../../core/data/highlights.js';
import type { Contributions } from '../../core/data/contributions.js';
import type { Rng } from '../../core/prng.js';
import type { Options, Theme } from './options.js';
import { paletteOf, type Palette, type Rgb } from './palette.js';

/**
 * Where the reel lives: four cards on one desk, filmed by one camera.
 *
 * The cards sit in a serpentine (row one left to right, row two right to left),
 * just far enough apart that a neighbour is off frame (or under the identity
 * band) at the holding zoom, so the pull-back at the end reads as one tight,
 * laid-out sheet rather than a queue. Everything here is a pure function of the
 * data; the sketch only draws.
 */

export const FRAMES = 425;

export const LAYOUT = {
  width: 1280,
  height: 400,
  /** Holding zoom. */
  z: 0.62,
  card: { w: 1000, h: 500, r: 18 },
  /** Station pitch: a neighbour clears the frame, or sits under the identity band. */
  spacing: { x: 1240, y: 680 },
  /** At the hold the card sits right of centre, clearing the identity band. */
  offX: 374,
  /** The one push-in: twice the holding zoom, landing right of centre on the busiest week. */
  pushZ: 1.24,
  pushOffX: 169,
  pushUpY: 40,
  /**
   * The top-repo card holds a grid of pseudo repo cards, drawn at `scale`, the
   * top repo first. The second push-in lands on it at `z / scale`, so the pseudo
   * card fills the frame exactly as a whole card does at the hold.
   */
  mini: { scale: 0.2, x: 520, y: 84, gap: 16, cols: 2 },
  /** Moves longer than this world distance dip their zoom; shorter ones stay flat. */
  travel: 1200,
  /** Weekly strip, card-local. */
  strip: { x: 70, baseline: 440, height: 165 },
  /** Wide-shot frame band, screen space: right of the identity text. */
  band: { left: 490, right: 1262, top: 14, bottom: 386 },
} as const;

/** Segment weights, in frames at four cards; the plan normalizes them to `FRAMES`. */
const WEIGHTS = {
  hold: 52,
  travel: 20,
  pushTravel: 20,
  pushHold: 46,
  focusTravel: 20,
  focusHold: 46,
  wideHold: 34,
  return: 24,
} as const;

export type { Rgb };

export interface ContributionsCard {
  kind: 'contributions';
  total: number;
  /** Longest run of consecutive active days in the window; null when there is none. */
  streak: number | null;
  /** Weekly totals, oldest first. */
  weeks: number[];
  /** Week index of the busiest week; null when every week is empty. */
  busiest: number | null;
  /** Day counts of the busiest week, oldest first. */
  busiestDays: number[];
  busiestLabel: string;
}

export interface TopRepoCard {
  kind: 'top_repo';
  totalStars: number;
  /** Pseudo cards, most starred first; the first is the top repo. */
  plates: { name: string; stars: number; color: Rgb }[];
  name: string;
  stars: number;
  forks: number;
  language: { name: string; color: Rgb } | null;
}

export interface PullRequestsCard {
  kind: 'pull_requests';
  merged: number;
}

export interface LanguagesCard {
  kind: 'languages';
  languages: { name: string; color: Rgb; count: number }[];
}

export type Card = ContributionsCard | TopRepoCard | PullRequestsCard | LanguagesCard;

export interface Shot {
  x: number;
  y: number;
  z: number;
}

export interface Key extends Shot {
  frame: number;
}

export interface Reel {
  cards: Card[];
  plan: Plan;
  palette: Palette;
}

export interface Plan {
  keys: Key[];
  /** Build window per card, in frames. An empty window means already finished. */
  builds: Window[];
  /** Build window of the top repo's own card, while the camera pushes into it. */
  focus: Window;
}

export interface Window {
  start: number;
  end: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Languages without a linguist color: the theme's soft grey. */
const NEUTRAL: Record<Theme, Rgb> = { light: [102, 106, 124], dark: [140, 146, 168] };

/** Cards in play order. */
const CARD_ORDER = ['contributions', 'top_repo', 'pull_requests', 'languages'] as const;

/** Longest run of consecutive days with at least one contribution. */
export function longestStreak(contributions: Contributions): number {
  let best = 0;
  let run = 0;
  for (const week of contributions.weeks) {
    for (const day of week) {
      run = day.count > 0 ? run + 1 : 0;
      if (run > best) best = run;
    }
  }
  return best;
}

/** "2026-03-28" .. "2026-04-03" -> "Mar 28 to Apr 3". */
function dateRange(from: string, to: string): string {
  const [, fm, fd] = from.split('-').map(Number);
  const [, tm, td] = to.split('-').map(Number);
  const start = `${MONTHS[fm! - 1]} ${fd}`;
  return fm === tm ? `${start} to ${td}` : `${start} to ${MONTHS[tm! - 1]} ${td}`;
}

function busiestWeek(contributions: Contributions): {
  index: number;
  days: number[];
  total: number;
  label: string;
} | null {
  let index = -1;
  let total = 0;
  contributions.weeks.forEach((week, i) => {
    const sum = week.reduce((s, d) => s + d.count, 0);
    if (sum > total) {
      total = sum;
      index = i;
    }
  });
  if (index < 0) return null;
  const week = contributions.weeks[index]!;
  return {
    index,
    total,
    days: week.map((d) => d.count),
    label: dateRange(week[0]!.date, week[week.length - 1]!.date),
  };
}

/**
 * Linguist colors include pale and dark ones: darken for the white card, lighten
 * for the dark one, so every dot reads on its card.
 */
export function languageColor(hex: string | null | undefined, theme: Theme = 'light'): Rgb {
  if (!hex) return NEUTRAL[theme];
  const n = Number.parseInt(hex.slice(1), 16);
  const [h, s, l] = rgbToHsl([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const lightness = theme === 'light' ? Math.min(l, 0.55) : Math.max(l, 0.52);
  return hslToRgb(h, Math.min(s, 0.85), lightness);
}

/** Serpentine desk: row one left to right, row two right to left. */
export function stationOf(index: number): { x: number; y: number } {
  const row = Math.floor(index / 2);
  const col = row % 2 === 0 ? index % 2 : 1 - (index % 2);
  return { x: col * LAYOUT.spacing.x, y: row * LAYOUT.spacing.y };
}

function holdPose(index: number): Shot {
  const s = stationOf(index);
  return { x: s.x - LAYOUT.offX, y: s.y, z: LAYOUT.z };
}

/** Pulls back far enough to hold every card at once, inside the identity band. */
function widePose(count: number): Shot {
  const { w, h } = LAYOUT.card;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < count; i++) {
    const s = stationOf(i);
    left = Math.min(left, s.x - w / 2);
    right = Math.max(right, s.x + w / 2);
    top = Math.min(top, s.y - h / 2);
    bottom = Math.max(bottom, s.y + h / 2);
  }
  const pad = 40;
  left -= pad;
  right += pad;
  top -= pad;
  bottom += pad;
  const z = Math.min(
    (LAYOUT.band.right - LAYOUT.band.left) / (right - left),
    (LAYOUT.band.bottom - LAYOUT.band.top) / (bottom - top),
  );
  const bandCx = (LAYOUT.band.left + LAYOUT.band.right) / 2;
  return {
    x: (left + right) / 2 - (bandCx - LAYOUT.width / 2) / z,
    y: (top + bottom) / 2,
    z,
  };
}

/** Card-local top-left corner of pseudo card `k` on the top-repo card. */
export function plateAt(k: number): { x: number; y: number } {
  const { scale, x, y, gap, cols } = LAYOUT.mini;
  const w = LAYOUT.card.w * scale;
  const h = LAYOUT.card.h * scale;
  return { x: x + (k % cols) * (w + gap), y: y + Math.floor(k / cols) * (h + gap) };
}

/** Where the second push-in lands: the top repo's pseudo card, framed like a hold. */
function focusPoseOf(index: number): Shot {
  const s = stationOf(index);
  const { scale } = LAYOUT.mini;
  const plate = plateAt(0);
  const z = LAYOUT.z / scale;
  return {
    x:
      s.x -
      LAYOUT.card.w / 2 +
      plate.x +
      (LAYOUT.card.w * scale) / 2 -
      (LAYOUT.offX * LAYOUT.z) / z,
    y: s.y - LAYOUT.card.h / 2 + plate.y + (LAYOUT.card.h * scale) / 2,
    z,
  };
}

/**
 * Where the push-in lands: the busiest week's opened column, framed right of
 * centre. Null when there is no busiest week (an empty year), so no push.
 */
function pushPoseOf(card: ContributionsCard, weekCount: number): Shot | null {
  if (card.busiest === null) return null;
  const pitch = (LAYOUT.card.w - 2 * LAYOUT.strip.x) / weekCount;
  const s = stationOf(0);
  const localX = LAYOUT.strip.x + (card.busiest + 0.5) * pitch;
  const localY = LAYOUT.strip.baseline - LAYOUT.strip.height / 2;
  return {
    x: s.x - LAYOUT.card.w / 2 + localX - LAYOUT.pushOffX,
    y: s.y - LAYOUT.card.h / 2 + localY - LAYOUT.pushUpY,
    z: LAYOUT.pushZ,
  };
}

export function buildPlan(cards: Card[], push: Shot | null): Plan {
  const hold = (i: number): Shot => holdPose(i);

  if (cards.length === 1 && !push) {
    // The empty state: one card, drift only.
    return {
      keys: [
        { frame: 0, ...hold(0) },
        { frame: FRAMES, ...hold(0) },
      ],
      builds: [{ start: 0, end: 0 }],
      focus: { start: 0, end: 0 },
    };
  }

  type Seg = { weight: number; pose: Shot; build?: number; focus?: boolean };
  const segs: Seg[] = [{ weight: WEIGHTS.hold, pose: hold(0) }];
  if (push) {
    segs.push({ weight: WEIGHTS.pushTravel, pose: push });
    segs.push({ weight: WEIGHTS.pushHold, pose: push });
  }
  for (let i = 1; i < cards.length; i++) {
    segs.push({ weight: WEIGHTS.travel, pose: hold(i), build: i });
    segs.push({ weight: WEIGHTS.hold, pose: hold(i) });
    if (cards[i]!.kind === 'top_repo') {
      // Total stars first, then into the top repo's pseudo card.
      const focus = focusPoseOf(i);
      segs.push({ weight: WEIGHTS.focusTravel, pose: focus, focus: true });
      segs.push({ weight: WEIGHTS.focusHold, pose: focus });
    }
  }
  if (cards.length >= 2) {
    const wide = widePose(cards.length);
    segs.push({ weight: WEIGHTS.travel, pose: wide });
    segs.push({ weight: WEIGHTS.wideHold, pose: wide });
  }
  // Back into card 0: its pose is the loop's first key, so the seam closes.
  segs.push({ weight: WEIGHTS.return, pose: hold(0) });

  const total = segs.reduce((s, g) => s + g.weight, 0);
  const scale = FRAMES / total;
  const keys: Key[] = [{ frame: 0, ...hold(0) }];
  const builds: Window[] = cards.map(() => ({ start: 0, end: 0 }));
  let focus: Window = { start: 0, end: 0 };
  let frame = 0;
  for (const seg of segs) {
    const start = frame;
    frame += seg.weight * scale;
    const end = Math.min(FRAMES, Math.round(frame));
    keys.push({ frame: end, ...seg.pose });
    if (seg.build !== undefined) {
      // A card builds while the camera arrives, and settles shortly after.
      builds[seg.build] = {
        start,
        end: Math.min(FRAMES, end + Math.round(WEIGHTS.hold * scale * 0.4)),
      };
    }
    if (seg.focus) {
      // The top repo's details build as the camera lands in its pseudo card.
      focus = {
        start: Math.round(start + (end - start) * 0.5),
        end: Math.min(FRAMES, end + Math.round(WEIGHTS.focusHold * scale * 0.4)),
      };
    }
  }
  keys[keys.length - 1]!.frame = FRAMES;
  return { keys, builds, focus };
}

export function buildReel(data: Highlights, _rng: Rng, options: Options): Reel {
  const contributions = data.contributions;
  const busiest = busiestWeek(contributions);
  const streak = longestStreak(contributions);
  const cards: Card[] = [];
  let push: Shot | null = null;

  const theme = options.theme;
  for (const id of CARD_ORDER) {
    switch (id) {
      case 'contributions': {
        // The one card that is always filmed, even at zero.
        const card: ContributionsCard = {
          kind: 'contributions',
          total: contributions.total,
          streak: streak > 0 ? streak : null,
          weeks: contributions.weeks.map((w) => w.reduce((s, d) => s + d.count, 0)),
          busiest: busiest?.index ?? null,
          busiestDays: busiest?.days ?? [],
          busiestLabel: busiest?.label ?? '',
        };
        push = pushPoseOf(card, card.weeks.length);
        cards.push(card);
        break;
      }
      case 'top_repo':
        if (data.topRepo) {
          cards.push({
            kind: 'top_repo',
            totalStars: data.totalStars,
            plates: data.starredRepos.map((r) => ({
              name: r.name,
              stars: r.stars,
              color: languageColor(r.color, theme),
            })),
            name: data.topRepo.name,
            stars: data.topRepo.stars,
            forks: data.topRepo.forks,
            language: data.topRepo.language
              ? {
                  name: data.topRepo.language.name,
                  color: languageColor(data.topRepo.language.color, theme),
                }
              : null,
          });
        }
        break;
      case 'pull_requests':
        if (data.mergedPullRequests > 0) {
          cards.push({ kind: 'pull_requests', merged: data.mergedPullRequests });
        }
        break;
      case 'languages':
        if (data.languages.length > 0) {
          cards.push({
            kind: 'languages',
            languages: data.languages.map((l) => ({
              name: l.name,
              color: languageColor(l.color, theme),
              count: l.count,
            })),
          });
        }
        break;
    }
  }

  return { cards, plan: buildPlan(cards, push), palette: paletteOf(options) };
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
