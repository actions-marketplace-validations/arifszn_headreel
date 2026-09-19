import type { SpecSheet } from '../../core/data/spec-sheet.js';
import { canvasMeasure, fitLine, type FittedLine } from '../../core/text.js';
import type { Identity } from '../types.js';
import { BUILD, DISSOLVE, halftoneDots, sphereLuma, type Dot } from './halftone.js';
import type { Palette } from './palette.js';

/**
 * The card as printed: where every block of type sits, the stats rows, and
 * the halftone screen. Everything here is a pure function of the data; the
 * sketch only draws.
 */

export const FRAMES = 140;

export const LAYOUT = {
  width: 1280,
  height: 400,
  /** Card border inset, and the text margin inside it. */
  inset: 24,
  pad: 48,
  /** Grid paper pitch. */
  grid: 16,
  /** Headline and tagline column: x 48 to 560, the stats panel's left edge minus 32. */
  nameColumn: 560 - 48,
  topBarY: 48,
  eyebrowY: 84,
  /** Baselines. */
  nameY: 152,
  taglineY: 192,
  /** The bordered stats table. */
  panel: { left: 592, right: 900, top: 110, bottom: 300, rowH: 38, pad: 20 },
  /** The halftone portrait disc. */
  portrait: { cx: 1086, cy: 200, radius: 140 },
  footerY: 352,
} as const;

/** Frames a stats row's value takes to retype during the build. */
export const TYPE_FRAMES = 12;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-09-19" -> "19 SEP 2026". */
export function asOfText(asOf: string): string {
  const [, m, d] = asOf.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${asOf.slice(0, 4)}`;
}

export interface StatRow {
  glyph: string;
  label: string;
  /** Grouped with a comma, as every identity column does. */
  value: string;
}

export interface SheetModel {
  /** `SINCE 2016`, from the account creation date. */
  sinceText: string;
  /** `// GITHUB PROFILE · 19 SEP 2026`. */
  eyebrow: string;
  name: FittedLine;
  tagline: FittedLine | null;
  stats: StatRow[];
  /**
   * The footer: the handle, then the website link (`↗ domain`) in the accent.
   * The arrow hugs the domain so the two read as one unit after the handle.
   */
  footer: {
    handle: string;
    arrowX: number;
    website: FittedLine | null;
    websiteX: number;
  };
  dots: Dot[];
  palette: Palette;
}

/**
 * A value's visible characters at loop phase `t`. Complete at rest; during
 * the dissolve the values are deleted one row at a time, bottom row first,
 * and during the build they are typed back top row first, the deletion
 * played backwards. Between the two they are empty, like the portrait.
 */
export function typedChars(
  value: string,
  row: number,
  rows: number,
  t: number,
): { text: string; cursor: boolean } {
  const len = TYPE_FRAMES / FRAMES;
  let k: number;
  if (t >= DISSOLVE[0] && t < BUILD[0]) {
    const start = DISSOLVE[0] + (rows - 1 - row) * len;
    k = t < start ? 1 : 1 - (t - start) / len;
  } else if (t >= BUILD[0] && t < BUILD[1]) {
    const start = BUILD[0] + row * len;
    k = (t - start) / len;
  } else {
    return { text: value, cursor: false };
  }
  if (k >= 1 - 1e-9) return { text: value, cursor: false };
  if (k <= 1e-9) return { text: '', cursor: false };
  const chars = Math.min(value.length, Math.floor(k * (value.length + 1)));
  return { text: value.slice(0, chars), cursor: true };
}

/** "https://www.example.com/" -> "www.example.com" */
function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

export function buildSheet(
  data: SpecSheet,
  identity: Identity,
  palette: Palette,
  next: () => number,
): SheetModel {
  const { portrait } = LAYOUT;
  const luma = data.avatar ? Buffer.from(data.avatar.luma, 'base64') : sphereLuma(next);
  const dots = halftoneDots(luma, portrait.cx, portrait.cy, portrait.radius, next);

  // The footer: the handle, then the website link, on one line. The link is
  // the arrow plus the domain with a hair of space between them, and the
  // domain fits what remains of the column.
  const mono = canvasMeasure('JetBrains Mono', 400, 2);
  const handle = identity.handle?.trim() ?? '';
  const arrowX = LAYOUT.pad + mono(handle, 12) + (handle ? 24 : 0);
  const arrowW = mono('↗', 12);
  const websiteX = arrowX + arrowW + 7;
  const website = identity.website
    ? fitLine(
        displayUrl(identity.website),
        LAYOUT.nameColumn - (websiteX - LAYOUT.pad),
        12,
        12,
        mono,
      )
    : null;

  const stat = (glyph: string, label: string, n: number): StatRow => ({
    glyph,
    label,
    value: n.toLocaleString('en-US'),
  });
  return {
    sinceText: `SINCE ${data.createdAt.slice(0, 4)}`,
    eyebrow: `// GITHUB PROFILE · ${asOfText(data.asOf)}`,
    name: fitLine(
      identity.name.toUpperCase(),
      LAYOUT.nameColumn,
      56,
      30,
      canvasMeasure('Space Grotesk', 700, 2),
    ),
    tagline: identity.tagline
      ? fitLine(identity.tagline, LAYOUT.nameColumn, 28, 28, canvasMeasure('Space Grotesk', 700))
      : null,
    stats: [
      stat('▲', 'FOLLOWERS', data.followers),
      stat('■', 'STARS', data.stars),
      stat('●', 'REPOS', data.repos),
      stat('◆', 'CONTRIBUTIONS', data.contributions),
    ],
    footer: { handle, arrowX, website, websiteX },
    dots,
    palette,
  };
}
