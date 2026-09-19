import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { registerFonts } from './fonts.js';

/** Width of `text` drawn at `size` px, in the caller's font. */
export type Measure = (text: string, size: number) => number;

export interface FittedLine {
  text: string;
  size: number;
}

const ELLIPSIS = '…';

/**
 * Fits one line of text into `maxWidth`. It first shrinks from `size` toward
 * `minSize` (pass `minSize === size` to keep the size), then cuts the text
 * with an ellipsis. The result is never wider than `maxWidth`, so no line can
 * leave the canvas or run into the scene.
 */
export function fitLine(
  text: string,
  maxWidth: number,
  size: number,
  minSize: number,
  measure: Measure,
): FittedLine {
  if (measure(text, size) <= maxWidth) return { text, size };

  // Width scales about linearly with size; step down until it fits.
  let fitted = Math.max(minSize, Math.floor((size * maxWidth) / measure(text, size)));
  while (fitted > minSize && measure(text, fitted) > maxWidth) fitted--;
  if (measure(text, fitted) <= maxWidth) return { text, size: fitted };

  // Longest prefix that fits with the ellipsis.
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${chars.slice(0, mid).join('').trimEnd()}${ELLIPSIS}`;
    if (measure(candidate, minSize) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const cut = chars.slice(0, lo).join('').trimEnd();
  return { text: cut ? `${cut}${ELLIPSIS}` : '', size: minSize };
}

let scratch: SKRSContext2D | undefined;

/**
 * Measures with the bundled fonts on a private canvas, so fitting never
 * touches a sketch's own drawing state (p5 caches font and fill state).
 * `tracking` is letter spacing in px, as the sketch draws it.
 */
export function canvasMeasure(family: string, weight: number, tracking = 0): Measure {
  registerFonts();
  scratch ??= createCanvas(1, 1).getContext('2d');
  const ctx = scratch;
  return (text, size) => {
    ctx.font = `${weight} ${size}px "${family}"`;
    ctx.letterSpacing = `${tracking}px`;
    return ctx.measureText(text).width;
  };
}

/** The identity column's lines, shared by every style (same fonts and sizes). */
export const IDENTITY_TYPE = {
  name: { family: 'Space Grotesk', weight: 700, size: 50, minSize: 30, tracking: 3 },
  tagline: { family: 'Space Grotesk', weight: 400, size: 17 },
  website: { family: 'JetBrains Mono', weight: 400, size: 12 },
} as const;

export interface IdentityLines {
  name: FittedLine;
  tagline: FittedLine | null;
  website: FittedLine | null;
}

/**
 * Fits the identity column: `name` shrinks then cuts, `tagline` and `website`
 * cut. `column` bounds name and tagline; `websiteColumn` bounds the website,
 * which some styles draw beside the scene rather than above it.
 */
export function fitIdentity(
  lines: { name: string; tagline?: string | undefined; website?: string | undefined },
  column: number,
  websiteColumn = column,
): IdentityLines {
  const { name, tagline, website } = IDENTITY_TYPE;
  return {
    name: fitLine(
      lines.name,
      column,
      name.size,
      name.minSize,
      canvasMeasure(name.family, name.weight, name.tracking),
    ),
    tagline: lines.tagline
      ? fitLine(
          lines.tagline,
          column,
          tagline.size,
          tagline.size,
          canvasMeasure(tagline.family, tagline.weight),
        )
      : null,
    website: lines.website
      ? fitLine(
          lines.website,
          websiteColumn,
          website.size,
          website.size,
          canvasMeasure(website.family, website.weight),
        )
      : null,
  };
}
