import type p5 from 'p5';
import {
  canvasMeasure,
  fitIdentity,
  fitLine,
  type FittedLine,
  type Measure,
} from '../../core/text.js';
import type { Identity } from '../types.js';
import type { NowPlayingStatus } from '../../core/data/now-playing.js';
import { HUB_R, type Deck, type Reel } from './deck.js';

/**
 * A cassette deck, drawn as hardware: the cassette through a smoked window,
 * a VFD showing the user's commit messages as lyrics, and a level meter of
 * the month's days.
 *
 * Everything is drawn through the raw 2D context with the style set right
 * before each draw (see Highlights Reel's note on p5's cached fill state).
 * The chrome is one static layer built in setup; the reels, the display and
 * the LEDs animate over it. Every animated value is periodic in `t`.
 */

const SANS = '"Space Grotesk"';
const MONO = '"JetBrains Mono"';
const HAND = '"Caveat"';

/**
 * The prompt names what the tape is with made-up flags: the most active repo
 * of the window, or the last pushed one when the window was empty.
 */
export function promptFor(status: NowPlayingStatus): string {
  if (status === 'playing') return '~/now-playing --most-active-repo --30d';
  if (status === 'last-played') return '~/now-playing --last-pushed';
  return '~/now-playing';
}

const W = 1280;
const H = 400;
const TAU = Math.PI * 2;

/** Width of the identity column: x 48 to 420. */
export const IDENTITY_COLUMN = 420 - 48;

const PLATE = { x: 452, y: 36, w: 784, h: 328, r: 12 };
/** The smoked window and its interior, where the cassette sits. */
const WELL = { x: 470, y: 56, w: 304, h: 190, r: 8 };
const INTERIOR = { x: WELL.x + 7, y: WELL.y + 7, w: WELL.w - 14, h: WELL.h - 14, r: 5 };
const CASSETTE = { x: 486, y: 72, w: 272, h: 160, r: 6 };
const LABEL = { x: 500, y: 82, w: 244, h: 58 };
const BAND_H = 20;
const HUBS = { y: 192, left: 548, right: 696 };

const KEYS = ['REW', 'PLAY', 'FF', 'STOP', 'REC'] as const;
const KEY = { w: 52, h: 44, gap: 9, y: 264 };

const DISPLAY = { x: 792, y: 56, w: 428, h: 240, r: 8 };
const PAD = 18;
const UX = DISPLAY.x + PAD;
const UW = DISPLAY.w - PAD * 2;
const LYRIC_BASE = [128, 158, 188] as const;
const LYRIC_ROW = 30;
const METER = { y: 210, h: 62 };
const BARS = 30;
const COUNTER = { x: 792, y: 308, w: 112, h: 40 };
const LEDS = { rec: 934, play: 988, y: 328 };

type Ctx = CanvasRenderingContext2D;
type Rgb = readonly number[];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 0..1, periodic in `t`, so every animated value loops seamlessly. */
function wave(t: number, cycles: number, off: number): number {
  return 0.5 + 0.5 * Math.sin(TAU * (t * cycles + off));
}

/** The tape scroll: a short eased move between holds. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function setFill(ctx: Ctx, color: Rgb, alpha = 1): void {
  ctx.fillStyle = rgba(color, alpha);
}

function setStroke(ctx: Ctx, color: Rgb, alpha = 1): void {
  ctx.strokeStyle = rgba(color, alpha);
}

interface TextOptions {
  size: number;
  family?: string;
  mono?: boolean;
  bold?: boolean;
  align?: CanvasTextAlign;
  tracking?: number;
}

function setFont(ctx: Ctx, o: TextOptions): void {
  ctx.font = `${o.bold ? 700 : 400} ${o.size}px ${o.mono ? MONO : (o.family ?? SANS)}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${o.tracking ?? 0}px`;
}

function drawText(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  o: TextOptions & { color: Rgb; alpha?: number },
): void {
  setFont(ctx, o);
  setFill(ctx, o.color, o.alpha ?? 1);
  ctx.fillText(str, x, y);
  if (o.tracking) ctx.letterSpacing = '0px';
}

/** Phosphor: the glyphs carry a faint glow, as a VFD does. */
function glowText(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  o: TextOptions & { color: Rgb; alpha?: number; glow?: number },
): void {
  setFont(ctx, o);
  setFill(ctx, o.color, o.alpha ?? 1);
  ctx.shadowColor = rgba(o.color, 0.9);
  ctx.shadowBlur = o.glow ?? 7;
  ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  if (o.tracking) ctx.letterSpacing = '0px';
}

function measure(ctx: Ctx, str: string, o: TextOptions): number {
  setFont(ctx, o);
  return ctx.measureText(str).width;
}

/**
 * The lyric lines on the display at `t`: index into the lyrics, baseline and
 * alpha. Lines scroll up one row between holds; the middle one is bright, its
 * neighbours dim, and the loop wraps from the last line to the first. The row
 * two below the middle is hidden during a hold and scrolls in, so no line
 * appears in place. With two lines, the row above would repeat the row below,
 * so it is left out and the leaving line fades out on its way up.
 */
export function lyricLayout(
  n: number,
  t: number,
): { index: number; base: number; alpha: number }[] {
  if (n === 0) return [];
  if (n === 1) return [{ index: 0, base: LYRIC_BASE[1], alpha: 1 }];
  const u = t * n;
  const k = Math.floor(u) % n;
  const offset = easeInOut(clamp01((u - Math.floor(u) - 0.8) / 0.2));
  const rows = n === 2 ? [0, 1, 2] : [-1, 0, 1, 2];
  const fadeAbove = n === 2 ? 1 : 0.68;
  const lines = [];
  for (const row of rows) {
    const base = LYRIC_BASE[1] + (row - offset) * LYRIC_ROW;
    const dist = Math.abs(base - LYRIC_BASE[1]) / LYRIC_ROW;
    const alpha = clamp01(1 - dist * (base < LYRIC_BASE[1] ? fadeAbove : 0.68));
    if (alpha > 0.02) lines.push({ index: (k + row + n) % n, base, alpha });
  }
  return lines;
}

/** Width the hand-written name may take on the label. */
export const TAPE_NAME_WIDTH = LABEL.w - 24;

/**
 * The hand-written `owner/name` on the label, with baselines relative to the
 * label's writing area. One line when it fits at 20 px or more; otherwise the
 * owner goes on a smaller first line and the name below it, each cut with an
 * ellipsis if it is still too long.
 */
export function tapeLabel(
  owner: string,
  name: string,
  measure: Measure,
): (FittedLine & { dy: number })[] {
  const full = `${owner}/${name}`;
  if (measure(full, 20) <= TAPE_NAME_WIDTH) {
    return [{ ...fitLine(full, TAPE_NAME_WIDTH, 30, 20, measure), dy: 0 }];
  }
  return [
    { ...fitLine(`${owner}/`, TAPE_NAME_WIDTH, 16, 16, measure), dy: -16 },
    { ...fitLine(name, TAPE_NAME_WIDTH, 22, 18, measure), dy: 2 },
  ];
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function createDeckSketch(
  deck: Deck,
  identity: Identity,
): {
  setup: (p: p5) => void;
  draw: (p: p5, frame: number, t: number) => void;
} {
  const P = deck.palette;
  const prompt = promptFor(deck.status);
  const fitted = fitIdentity(
    {
      name: identity.name.toUpperCase(),
      tagline: identity.tagline,
      website: identity.website && `↗ ${displayUrl(identity.website)}`,
    },
    IDENTITY_COLUMN,
  );

  const repo = deck.repo;

  // Lines are cut with an ellipsis at the width they are drawn into.
  const measureMono = canvasMeasure('JetBrains Mono', 400);
  const measureHand = canvasMeasure('Caveat', 400);
  const topLabel = deck.status === 'last-played' ? 'LAST PLAYED' : 'NOW PLAYING';
  const topLabelW = canvasMeasure('JetBrains Mono', 400, 2)(topLabel, 12);
  const topName =
    // The label carries the owner; the display keeps the room for the name.
    repo === null ? null : fitLine(repo.name, UW - topLabelW - 14, 13, 13, measureMono);
  const lyrics = deck.lyrics.map((line) => fitLine(line, UW, 14, 14, measureMono));
  const tapeName = repo === null ? [] : tapeLabel(repo.owner, repo.name, measureHand);
  const languageName =
    deck.languageName === null
      ? null
      : fitLine(deck.languageName, LABEL.w * 0.55, 8, 8, canvasMeasure('JetBrains Mono', 400, 1));

  // --- static layer ---------------------------------------------------------

  function drawVignette(ctx: Ctx): void {
    const grad = ctx.createRadialGradient(W / 2, H / 2 - 20, 180, W / 2, H / 2, 860);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${P.vignette})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPlate(ctx: Ctx): void {
    setFill(ctx, P.faceplate);
    roundRect(ctx, PLATE.x, PLATE.y, PLATE.w, PLATE.h, PLATE.r);
    ctx.fill();

    // Fine horizontal brushing, seeded.
    for (const s of deck.brush) {
      setStroke(ctx, [255, 255, 255], s.alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PLATE.x + 4 + s.x0 * (PLATE.w - 8), PLATE.y + 4 + s.y * (PLATE.h - 8));
      ctx.lineTo(PLATE.x + 4 + s.x1 * (PLATE.w - 8), PLATE.y + 4 + s.y * (PLATE.h - 8));
      ctx.stroke();
    }

    // Bevel: light on top, dark on the bottom edge.
    setStroke(ctx, P.bevel, 0.65);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PLATE.x + PLATE.r, PLATE.y + 1);
    ctx.lineTo(PLATE.x + PLATE.w - PLATE.r, PLATE.y + 1);
    ctx.stroke();
    setStroke(ctx, [0, 0, 0], 0.4);
    ctx.beginPath();
    ctx.moveTo(PLATE.x + PLATE.r, PLATE.y + PLATE.h - 1);
    ctx.lineTo(PLATE.x + PLATE.w - PLATE.r, PLATE.y + PLATE.h - 1);
    ctx.stroke();
    setStroke(ctx, [0, 0, 0], 0.35);
    ctx.lineWidth = 1;
    roundRect(ctx, PLATE.x + 0.5, PLATE.y + 0.5, PLATE.w - 1, PLATE.h - 1, PLATE.r);
    ctx.stroke();

    // Screws in the corners, slots at seeded angles.
    const corners: [number, number][] = [
      [PLATE.x + 16, PLATE.y + 16],
      [PLATE.x + PLATE.w - 16, PLATE.y + 16],
      [PLATE.x + 16, PLATE.y + PLATE.h - 16],
      [PLATE.x + PLATE.w - 16, PLATE.y + PLATE.h - 16],
    ];
    corners.forEach(([cx, cy], i) => {
      setFill(ctx, P.screw);
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, TAU);
      ctx.fill();
      setStroke(ctx, P.bevel, 0.9);
      ctx.lineWidth = 1.5;
      const a = deck.screws[i]!;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(a) * 3, cy - Math.sin(a) * 3);
      ctx.lineTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3);
      ctx.stroke();
    });
  }

  function drawWellChrome(ctx: Ctx): void {
    // The well's interior: glass over the faceplate, the cassette sits inside.
    setFill(ctx, P.glass, 0.85);
    roundRect(ctx, INTERIOR.x, INTERIOR.y, INTERIOR.w, INTERIOR.h, INTERIOR.r);
    ctx.fill();
    setStroke(ctx, P.bevel, 0.9);
    ctx.lineWidth = 1.5;
    roundRect(ctx, WELL.x, WELL.y, WELL.w, WELL.h, WELL.r);
    ctx.stroke();
    setStroke(ctx, [0, 0, 0], 0.5);
    ctx.lineWidth = 1;
    roundRect(ctx, INTERIOR.x + 0.5, INTERIOR.y + 0.5, INTERIOR.w - 1, INTERIOR.h - 1, INTERIOR.r);
    ctx.stroke();
  }

  function drawDisplayChrome(ctx: Ctx): void {
    setFill(ctx, P.glass);
    roundRect(ctx, DISPLAY.x, DISPLAY.y, DISPLAY.w, DISPLAY.h, DISPLAY.r);
    ctx.fill();
    setStroke(ctx, P.bevel, 0.9);
    ctx.lineWidth = 1.5;
    roundRect(ctx, DISPLAY.x, DISPLAY.y, DISPLAY.w, DISPLAY.h, DISPLAY.r);
    ctx.stroke();
    setStroke(ctx, [0, 0, 0], 0.5);
    ctx.lineWidth = 1;
    roundRect(ctx, DISPLAY.x + 1, DISPLAY.y + 1, DISPLAY.w - 2, DISPLAY.h - 2, DISPLAY.r - 1);
    ctx.stroke();

    // Unlit segment ghosts, as real VFDs show.
    const ghost = rgba(P.accent, 0.05);
    ctx.fillStyle = ghost;
    for (const base of LYRIC_BASE) {
      for (let x = UX; x < UX + UW - 3; x += 7) {
        ctx.fillRect(x, base - 9, 3.5, 10);
      }
    }
  }

  function drawKeys(ctx: Ctx): void {
    const total = KEYS.length * KEY.w + (KEYS.length - 1) * KEY.gap;
    const x0 = WELL.x + (WELL.w - total) / 2;
    KEYS.forEach((label, i) => {
      const pressed = label === 'PLAY';
      const x = x0 + i * (KEY.w + KEY.gap);
      const y = KEY.y + (pressed ? 5 : 0);
      const h = KEY.h - (pressed ? 5 : 0);
      // Slot the raised keys sit out of.
      if (!pressed) {
        setFill(ctx, [0, 0, 0], 0.35);
        roundRect(ctx, x, KEY.y - 3, KEY.w, KEY.h + 3, 5);
        ctx.fill();
      }
      setFill(ctx, pressed ? P.faceplate : P.keyTop);
      roundRect(ctx, x, y, KEY.w, h, 5);
      ctx.fill();
      setStroke(ctx, pressed ? [0, 0, 0] : P.keyRim, pressed ? 0.4 : 0.25);
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, KEY.w - 1, h - 1, 5);
      ctx.stroke();
      if (pressed) {
        setFill(ctx, P.identityAccent, 0.9);
        ctx.fillRect(x + 8, y + 4, KEY.w - 16, 2.5);
      }
      drawText(ctx, label, x + KEY.w / 2, KEY.y + KEY.h + 18, {
        size: 10,
        align: 'center',
        color: P.plateInk,
        alpha: pressed ? 0.9 : 0.6,
      });
    });
  }

  function drawCounter(ctx: Ctx): void {
    setFill(ctx, [10, 11, 14]);
    roundRect(ctx, COUNTER.x, COUNTER.y, COUNTER.w, COUNTER.h, 4);
    ctx.fill();
    setStroke(ctx, P.bevel, 0.8);
    ctx.lineWidth = 1;
    roundRect(ctx, COUNTER.x + 0.5, COUNTER.y + 0.5, COUNTER.w - 1, COUNTER.h - 1, 4);
    ctx.stroke();

    const digits = String(deck.counter).padStart(3, '0');
    for (let i = 0; i < 3; i++) {
      const x = COUNTER.x + 10 + i * 33;
      setFill(ctx, [4, 4, 6]);
      roundRect(ctx, x, COUNTER.y + 7, 28, 26, 2);
      ctx.fill();
      drawText(ctx, digits[i]!, x + 14, COUNTER.y + 28, {
        size: 19,
        mono: true,
        bold: true,
        align: 'center',
        color: P.amber,
      });
    }
    drawText(ctx, 'COUNTER', COUNTER.x + COUNTER.w / 2, COUNTER.y + COUNTER.h + 12, {
      size: 7,
      mono: true,
      tracking: 2,
      align: 'center',
      color: P.plateInk,
      alpha: 0.7,
    });
  }

  function drawLedLabels(ctx: Ctx): void {
    drawText(ctx, 'REC', LEDS.rec + 9, LEDS.y + 3, {
      size: 7,
      mono: true,
      color: P.plateInk,
      alpha: 0.7,
    });
    drawText(ctx, 'PLAY', LEDS.play + 9, LEDS.y + 3, {
      size: 7,
      mono: true,
      color: P.plateInk,
      alpha: 0.7,
    });
  }

  function drawIdentity(ctx: Ctx): void {
    const x = 48;
    drawText(ctx, prompt, x, 58, { size: 13, mono: true, color: P.identityAccent });
    drawText(ctx, fitted.name.text, x, 116, {
      size: fitted.name.size,
      bold: true,
      color: P.identityInk,
      tracking: 3,
    });
    if (fitted.tagline) {
      drawText(ctx, fitted.tagline.text, x, 146, {
        size: fitted.tagline.size,
        color: P.identityAccent,
      });
    }
    if (fitted.website) {
      drawText(ctx, fitted.website.text, x, 350, {
        size: fitted.website.size,
        mono: true,
        color: P.identityAccent,
      });
    }
  }

  let chrome: p5.Graphics | undefined;

  function setup(p: p5): void {
    chrome = p.createGraphics(W, H) as p5.Graphics;
    const ctx = chrome.drawingContext as Ctx;
    setFill(ctx, P.bg);
    ctx.fillRect(0, 0, W, H);
    drawVignette(ctx);
    drawPlate(ctx);
    drawWellChrome(ctx);
    drawDisplayChrome(ctx);
    drawKeys(ctx);
    drawCounter(ctx);
    drawLedLabels(ctx);
    drawIdentity(ctx);
  }

  // --- cassette -------------------------------------------------------------

  function drawReel(ctx: Ctx, reel: Reel, cx: number, t: number): void {
    const angle = (reel.phase + reel.revs * t) * TAU;
    setFill(ctx, P.tape);
    ctx.beginPath();
    ctx.arc(cx, HUBS.y, reel.radius, 0, TAU);
    ctx.fill();
    // Wound tape: a bright rim and faint rings.
    if (reel.radius > HUB_R + 2) {
      setStroke(ctx, [96, 84, 72], 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, HUBS.y, reel.radius - 0.5, 0, TAU);
      ctx.stroke();
      setStroke(ctx, [255, 255, 255], 0.05);
      for (let r = HUB_R + 5; r < reel.radius - 2; r += 4) {
        ctx.beginPath();
        ctx.arc(cx, HUBS.y, r, 0, TAU);
        ctx.stroke();
      }
    }

    // Six-spoke hub, turning a whole number of sixths per loop.
    setStroke(ctx, [92, 86, 78], 0.95);
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = angle + (i * TAU) / 6;
      const dx = Math.cos(a) * (HUB_R - 3);
      const dy = Math.sin(a) * (HUB_R - 3);
      ctx.moveTo(cx - dx, HUBS.y - dy);
      ctx.lineTo(cx + dx, HUBS.y + dy);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    setFill(ctx, P.tape);
    ctx.beginPath();
    ctx.arc(cx, HUBS.y, 5, 0, TAU);
    ctx.fill();
  }

  function drawCassette(ctx: Ctx, t: number): void {
    ctx.save();
    roundRect(ctx, INTERIOR.x, INTERIOR.y, INTERIOR.w, INTERIOR.h, INTERIOR.r);
    ctx.clip();
    if (deck.status !== 'empty') {
      setFill(ctx, P.shell);
      roundRect(ctx, CASSETTE.x, CASSETTE.y, CASSETTE.w, CASSETTE.h, CASSETTE.r);
      ctx.fill();
      setStroke(ctx, [255, 255, 255], 0.06);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(CASSETTE.x + CASSETTE.r, CASSETTE.y + 1);
      ctx.lineTo(CASSETTE.x + CASSETTE.w - CASSETTE.r, CASSETTE.y + 1);
      ctx.stroke();
      setStroke(ctx, [20, 19, 17], 0.8);
      roundRect(
        ctx,
        CASSETTE.x + 0.5,
        CASSETTE.y + 0.5,
        CASSETTE.w - 1,
        CASSETTE.h - 1,
        CASSETTE.r,
      );
      ctx.stroke();

      // Label: cream paper, colored band, hand-written name.
      setFill(ctx, P.paper);
      ctx.fillRect(LABEL.x, LABEL.y, LABEL.w, LABEL.h);
      setFill(ctx, deck.bandColor);
      ctx.fillRect(LABEL.x, LABEL.y, LABEL.w, BAND_H);
      setStroke(ctx, [0, 0, 0], 0.15);
      ctx.lineWidth = 1;
      ctx.strokeRect(LABEL.x + 0.5, LABEL.y + 0.5, LABEL.w - 1, LABEL.h - 1);
      drawText(ctx, 'SIDE A', LABEL.x + 7, LABEL.y + 14, {
        size: 8,
        mono: true,
        tracking: 1,
        color: [255, 255, 255],
        alpha: 0.92,
      });
      if (languageName) {
        drawText(ctx, languageName.text, LABEL.x + LABEL.w - 7, LABEL.y + 14, {
          size: languageName.size,
          mono: true,
          tracking: 1,
          align: 'right',
          color: [255, 255, 255],
          alpha: 0.92,
        });
      }
      ctx.save();
      ctx.translate(LABEL.x + LABEL.w / 2, LABEL.y + BAND_H + (LABEL.h - BAND_H) / 2 + 12);
      ctx.rotate(deck.labelTilt);
      for (const line of tapeName) {
        drawText(ctx, line.text, 0, line.dy, {
          size: line.size,
          family: HAND,
          align: 'center',
          color: P.ink,
        });
      }
      ctx.restore();

      // Tape threading along the bottom, then the reels.
      setFill(ctx, P.tape);
      ctx.fillRect(HUBS.left, 216, HUBS.right - HUBS.left, 3);
      drawReel(ctx, deck.supply, HUBS.left, t);
      drawReel(ctx, deck.takeUp, HUBS.right, t);
    }

    // Smoked glass over whatever is inside.
    setFill(ctx, P.glass, 0.35);
    ctx.fillRect(INTERIOR.x, INTERIOR.y, INTERIOR.w, INTERIOR.h);
    ctx.restore();
  }

  // --- display --------------------------------------------------------------

  function drawLyrics(ctx: Ctx, t: number): void {
    ctx.save();
    roundRect(ctx, DISPLAY.x + 4, DISPLAY.y + 4, DISPLAY.w - 8, DISPLAY.h - 8, DISPLAY.r - 2);
    ctx.clip();
    for (const { index, base, alpha } of lyricLayout(lyrics.length, t)) {
      const line = lyrics[index]!;
      const opts = { size: line.size, mono: true, color: P.accent, alpha };
      if (alpha > 0.8) {
        glowText(ctx, line.text, UX, base, opts);
      } else {
        drawText(ctx, line.text, UX, base, opts);
      }
    }
    ctx.restore();
  }

  function drawMeter(ctx: Ctx, t: number): void {
    const pitch = UW / BARS;
    const barW = pitch * 0.55;
    const pos = (t * BARS) % BARS;
    deck.bars.forEach((height, i) => {
      const x = UX + i * pitch + (pitch - barW) / 2;
      if (height <= 0) {
        // Unlit ghost for a day without commits.
        setFill(ctx, P.accent, 0.09);
        ctx.fillRect(x, METER.y, barW, METER.h);
        return;
      }
      const d = (pos - i + BARS) % BARS;
      const flash = Math.exp(-d * 0.4);
      setFill(ctx, P.accent, Math.min(1, 0.55 + flash * 0.45));
      const h = Math.max(3, height * METER.h);
      ctx.fillRect(x, METER.y + METER.h - h, barW, h);
    });
    setStroke(ctx, P.accent, 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(UX, METER.y + METER.h + 2.5);
    ctx.lineTo(UX + UW, METER.y + METER.h + 2.5);
    ctx.stroke();

    // The playhead sweeps once per loop.
    const px = UX + pos * pitch + pitch / 2;
    ctx.save();
    setStroke(ctx, P.accent, 0.55);
    ctx.lineWidth = 1.5;
    ctx.shadowColor = rgba(P.accent, 0.9);
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(px, METER.y - 4);
    ctx.lineTo(px, METER.y + METER.h + 4);
    ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  function drawDisplay(ctx: Ctx, t: number): void {
    if (deck.status === 'empty') {
      glowText(ctx, 'NO TAPE', UX, 86, {
        size: 13,
        mono: true,
        tracking: 2,
        color: P.accent,
        alpha: 0.85,
      });
    } else {
      drawText(ctx, topLabel, UX, 86, {
        size: 12,
        mono: true,
        tracking: 2,
        color: P.accent,
        alpha: 0.55,
      });
      if (topName) {
        glowText(ctx, topName.text, UX + topLabelW + 14, 86, {
          size: topName.size,
          mono: true,
          color: P.accent,
          alpha: 0.95,
        });
      }
    }
    drawLyrics(ctx, t);
    drawMeter(ctx, t);
  }

  function drawLeds(ctx: Ctx, t: number): void {
    // Record-off: the red LED stays dim. Play pulses once per loop.
    setFill(ctx, P.red, 0.22);
    ctx.beginPath();
    ctx.arc(LEDS.rec, LEDS.y, 4.5, 0, TAU);
    ctx.fill();
    const pulse = 0.45 + 0.55 * wave(t, 1, 0);
    ctx.save();
    setFill(ctx, P.accent, pulse);
    ctx.shadowColor = rgba(P.accent, pulse);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(LEDS.play, LEDS.y, 4.5, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  function drawCursor(ctx: Ctx, t: number): void {
    // Once a second, a terminal's blink rate: 16 whole cycles per 16 s loop.
    if (wave(t, 16, 0) <= 0.5) return;
    setFill(ctx, P.identityAccent);
    ctx.fillRect(48 + measure(ctx, prompt, { size: 13, mono: true }) + 4, 47, 7, 13);
  }

  function draw(p: p5, _frame: number, t: number): void {
    const ctx = p.drawingContext as Ctx;
    if (chrome) p.image(chrome, 0, 0);
    drawCassette(ctx, t);
    drawDisplay(ctx, t);
    drawLeds(ctx, t);
    drawCursor(ctx, t);
  }

  return { setup, draw };
}

/** "https://www.example.com/" -> "www.example.com" */
function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}
