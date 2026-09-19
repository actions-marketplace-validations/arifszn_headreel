import type { Receipt } from '../../core/data/receipt.js';
import { bestDay, currentStreak, longestStreak } from '../../core/streaks.js';
import type { Rng } from '../../core/prng.js';
import { canvasMeasure, fitLine } from '../../core/text.js';
import type { Options } from './options.js';
import type { Palette } from './palette.js';

/**
 * What the printer prints. The whole receipt is one list of text lines plus a
 * tail (barcode, footer, tear line); the sketch rasterizes them into one
 * offscreen strip and feeds it out of the slot. Everything here is a pure
 * function of the data.
 */

export const FRAMES = 400;

/** Paper geometry, px: a 58 mm thermal printer prints 384 dots per line. */
export const PAPER = {
  width: 384,
  /** Side margins; the 32-column text grid lives between them. */
  margin: 16,
  text: 352,
  size: 18,
  line: 26,
  /** Barcode bars, full height. */
  bars: 48,
} as const;

/** The tail: everything after the last text line, to the next header. */
export const TAIL = {
  gapAboveBars: 10,
  gapBelowBars: 12,
  footer: PAPER.line,
  gapBelowFooter: 8,
  tear: PAPER.line,
  /** Paper between the tear line and the next receipt's header. */
  leader: 18,
} as const;

export interface Line {
  /** Row height, px. */
  h: number;
  left?: string;
  right?: string;
  center?: string;
  /** Faded ink pass: dates, `@` language lines, the tear line. */
  faded?: boolean;
  /** Double height, the thermal printer mode: a vertical scale of the font. */
  double?: boolean;
  /** Ink density, 0.88 to 1; a real head fades on some lines. */
  density: number;
}

export interface Segment {
  start: number;
  end: number;
  /** Paper distance covered during the segment, px. */
  dist: number;
  kind: 'hold' | 'step' | 'pause' | 'feed';
}

export interface FeedPlan {
  /** Strip period, px: one receipt, tear line to matching tear line. */
  length: number;
  segments: Segment[];
}

/** Step, pause and hold weights, in frames, normalized to `FRAMES` below. */
const WEIGHTS = { hold: 40, step: 3, pause: 5 } as const;
/** Constant feed speed of the barcode tail, px per frame. */
const FEED_SPEED = 2;

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The feed timeline: a hold, then one eased step per text line with a pause
 * after each, then the tail at constant speed. Weights are normalized to the
 * loop, so a short receipt feeds more slowly over the same 16 s.
 */
export function buildFeedPlan(textHeights: readonly number[], tail: number): FeedPlan {
  const raw: { w: number; dist: number; kind: Segment['kind'] }[] = [
    { w: WEIGHTS.hold, dist: 0, kind: 'hold' },
  ];
  for (const h of textHeights) {
    raw.push({ w: WEIGHTS.step, dist: h, kind: 'step' });
    raw.push({ w: WEIGHTS.pause, dist: 0, kind: 'pause' });
  }
  raw.push({ w: tail / FEED_SPEED, dist: tail, kind: 'feed' });

  const scale = FRAMES / raw.reduce((sum, g) => sum + g.w, 0);
  const segments: Segment[] = [];
  let at = 0;
  let length = 0;
  for (const g of raw) {
    const end = at + g.w * scale;
    segments.push({ start: at, end, dist: g.dist, kind: g.kind });
    length += g.dist;
    at = end;
  }
  return { length, segments };
}

export interface FeedState {
  /** Whole-pixel offset of the paper, in [0, length). */
  offset: number;
  /** The status LED: blinking on text steps, lit while feeding and holding. */
  led: boolean;
}

/** Where the paper is at `t`, and whether the printer's LED is on. */
export function feedAt(plan: FeedPlan, t: number): FeedState {
  const pos = Math.min(Math.max(t, 0), 1) * FRAMES;
  let dist = 0;
  for (const seg of plan.segments) {
    const last = seg === plan.segments.at(-1);
    if (pos < seg.end || last) {
      const u = Math.min(1, Math.max(0, (pos - seg.start) / (seg.end - seg.start)));
      dist += seg.kind === 'step' ? seg.dist * easeInOut(u) : seg.dist * u;
      const led = seg.kind === 'pause' ? false : seg.kind === 'step' ? u < 0.6 : true;
      return { offset: Math.round(dist) % plan.length, led };
    }
    dist += seg.dist;
  }
  return { offset: 0, led: true };
}

/**
 * Barcode bar widths, one per calendar week: 0 for a week without
 * contributions, otherwise 1 to 4 px by quartile of the non-zero weeks, so
 * the busiest weeks print as the widest bars.
 */
export function barcodeWidths(days: readonly number[], from: string): number[] {
  // Calendar columns start on Sunday; the window's first week may be partial.
  const lead = new Date(`${from}T00:00:00Z`).getUTCDay();
  const weeks: number[] = [];
  days.forEach((count, i) => {
    const w = Math.floor((lead + i) / 7);
    weeks[w] = (weeks[w] ?? 0) + count;
  });
  const active = weeks.filter((t) => t > 0).sort((a, b) => a - b);
  if (active.length === 0) return weeks.map(() => 0);
  const at = (p: number): number =>
    active[Math.min(active.length - 1, Math.floor(p * (active.length - 1)))]!;
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)];
  return weeks.map((total) =>
    total <= 0 ? 0 : total >= q3 ? 4 : total >= q2 ? 3 : total >= q1 ? 2 : 1,
  );
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/** "2026-03-12" -> "12 MAR 2026". */
export function printDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${date.slice(0, 4)}`;
}

export interface ReceiptModel {
  palette: Palette;
  /** The calendar total, repeated in the identity column. */
  total: number;
  lines: Line[];
  /** Barcode bar widths, one per week; 0 = no bar. */
  barcode: number[];
  /** Human-readable text under the barcode. */
  footer: string;
  feed: FeedPlan;
  /** The strip's period, px. */
  length: number;
  /** Transaction number, from the style seed. */
  txn: string;
}

const measure = canvasMeasure('JetBrains Mono', PAPER.size);

/** Right-aligned value with room to breathe: the till-receipt column gap. */
const GAP = 12;

export function buildReceipt(
  data: Receipt,
  login: string,
  identity: { name: string },
  options: Options,
  palette: Palette,
  rng: Rng,
): ReceiptModel {
  // Thermal texture: per-line density, with a lighter band every few lines.
  const texture = (): number => {
    const d = 0.88 + rng() * 0.12;
    return rng() < 0.15 ? d * 0.8 : d;
  };
  const line = (h: number, fields: Omit<Line, 'h' | 'density'>): Line => ({
    h,
    ...fields,
    density: texture(),
  });
  const text = (fields: Omit<Line, 'h' | 'density'>): Line => line(PAPER.line, fields);
  const rule = (): Line => text({ left: '-'.repeat(32) });
  const doubleRule = (): Line => text({ left: '='.repeat(32) });
  const count = (label: string, value: number): Line => text({ left: label, right: String(value) });

  const lines: Line[] = [];

  // Header: the store is the user.
  const name = fitLine(identity.name.toUpperCase(), PAPER.text, PAPER.size, PAPER.size, measure);
  lines.push(line(PAPER.line * 2, { center: name.text, double: true }));
  lines.push(text({ center: `github.com/${login}`, faded: true }));
  const txn = `${Math.floor(rng() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0')}-${String(Math.floor(rng() * 99) + 1).padStart(2, '0')}`;
  lines.push(text({ left: `TXN ${txn}`, right: 'REG 01' }));
  lines.push(text({ center: `${printDate(data.from)}  -  ${printDate(data.to)}`, faded: true }));
  lines.push(rule());

  // Items: the repositories the user committed to.
  const empty = data.total === 0;
  const items = data.items.slice(0, options.items);
  if (empty) {
    lines.push(text({ center: 'NO ITEMS' }));
    lines.push(rule());
  } else if (items.length > 0 || data.privateCommits > 0) {
    lines.push(text({ left: 'ITEM', right: 'QTY' }));
    for (const item of items) {
      const qty = String(item.commits);
      const fitted = fitLine(
        item.name,
        PAPER.text - measure(qty, PAPER.size) - GAP,
        PAPER.size,
        PAPER.size,
        measure,
      );
      lines.push(text({ left: fitted.text, right: qty }));
      if (item.language) {
        lines.push(text({ left: `  @ ${item.language.name}`, faded: true }));
      }
    }
    if (data.privateCommits > 0) {
      lines.push(count('private repos', data.privateCommits));
    }
    lines.push(rule());
  }

  // Totals; a line whose count is 0 is left out. OTHER is what the per-type
  // counts do not add up to, so the receipt always adds up.
  const totals: Line[] = [
    count('COMMITS', data.commits),
    count('PULL REQUESTS', data.pullRequests),
    count('REVIEWS', data.reviews),
    count('ISSUES', data.issues),
    count('NEW REPOS', data.newRepos),
    count('PRIVATE', data.restricted),
  ].filter((l) => l.right !== '0');
  const other =
    data.total -
    (data.commits +
      data.pullRequests +
      data.reviews +
      data.issues +
      data.newRepos +
      data.restricted);
  if (other > 0) totals.push(count('OTHER', other));
  else if (other < 0)
    console.warn('receipt: per-type counts exceed the calendar total; OTHER left out');
  lines.push(...totals);
  lines.push(doubleRule());
  lines.push(count('TOTAL', data.total));
  lines.push(doubleRule());

  // Streaks and the best day; a streak of 0 is left out.
  const longest = longestStreak(data.days);
  if (longest > 0) lines.push(text({ left: 'LONGEST STREAK', right: `${longest} DAYS` }));
  const current = currentStreak(data.days);
  if (current > 0) lines.push(text({ left: 'CURRENT STREAK', right: `${current} DAYS` }));
  const best = bestDay(data.days);
  if (best) {
    const date = new Date(Date.parse(`${data.from}T00:00:00Z`) + best.index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const qty = String(best.count);
    const label = fitLine(
      `BEST DAY ${printDate(date)}`,
      PAPER.text - measure(qty, PAPER.size) - GAP,
      PAPER.size,
      PAPER.size,
      measure,
    );
    lines.push(text({ left: label.text, right: qty }));
  }

  const barcode = barcodeWidths(data.days, data.from);
  const tail =
    TAIL.gapAboveBars +
    PAPER.bars +
    TAIL.gapBelowBars +
    TAIL.footer +
    TAIL.gapBelowFooter +
    TAIL.tear +
    TAIL.leader;
  const feed = buildFeedPlan(
    lines.map((l) => l.h),
    tail,
  );
  return {
    palette,
    total: data.total,
    lines,
    barcode,
    footer: `${login.toUpperCase()}-${data.asOf.slice(0, 4)}`,
    feed,
    length: feed.length,
    txn,
  };
}
