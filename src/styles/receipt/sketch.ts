import type p5 from 'p5';
import { fitIdentity } from '../../core/text.js';
import type { Identity } from '../types.js';
import { feedAt, PAPER, TAIL, type Line, type ReceiptModel } from './receipt.js';
import type { Palette, Rgb } from './palette.js';

/**
 * A thermal printer feeding the user's year as a till receipt.
 *
 * The whole receipt, tear line included, is rasterized once in setup into one
 * offscreen strip (the paper). Each frame draws that strip at a whole-pixel
 * offset, clipped at the printer's slot, tiling around at the strip's length:
 * the roll prints the same receipt back to back, so the loop closes. Nothing
 * on the paper is re-rasterized per frame, so held frames are byte-identical.
 *
 * Everything is drawn through the raw 2D context with the style set right
 * before each draw (see Highlights Reel's note on p5's cached fill state).
 */

const SANS = '"Space Grotesk"';
const MONO = '"JetBrains Mono"';
const PROMPT = '~/receipt --last-12-months';

const W = 1280;
const H = 400;
const TAU = Math.PI * 2;

/** Width of the identity column: x 48 to 640, the printer body's left edge minus 20. */
export const IDENTITY_COLUMN = 640 - 48;

/** Paper and printer geometry, screen space. */
const PAPER_X = 708;
const SLOT_Y = 336;
const PRINTER = { left: 660, right: 1140, bottom: 400 };
const SLOT = { left: 700, right: 1100, bottom: 350 };
const LED = { x: 1104, y: 369 };

type Ctx = CanvasRenderingContext2D;

function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function setFill(ctx: Ctx, color: Rgb, alpha = 1): void {
  ctx.fillStyle = rgba(color, alpha);
}

function setFont(
  ctx: Ctx,
  o: { size: number; mono?: boolean; bold?: boolean; align?: CanvasTextAlign; tracking?: number },
): void {
  ctx.font = `${o.bold ? 700 : 400} ${o.size}px ${o.mono ? MONO : SANS}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${o.tracking ?? 0}px`;
}

function drawText(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  o: Parameters<typeof setFont>[1] & { color: Rgb; alpha?: number },
): void {
  setFont(ctx, o);
  setFill(ctx, o.color, o.alpha ?? 1);
  ctx.fillText(str, x, y);
  if (o.tracking) ctx.letterSpacing = '0px';
}

/** 0..1, periodic in `t`, so every animated value loops seamlessly. */
function wave(t: number, cycles: number, off: number): number {
  return 0.5 + 0.5 * Math.sin(TAU * (t * cycles + off));
}

/** One text row of the paper, in strip coordinates. */
function drawLine(ctx: Ctx, line: Line, top: number, p: Palette): void {
  if (!line.left && !line.right && !line.center) return;
  const color = line.faded ? p.fadedInk : p.ink;
  ctx.font = `400 ${PAPER.size}px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '0px';
  if (line.double) {
    // The thermal double-height mode: the same glyphs, vertically scaled.
    ctx.save();
    ctx.translate(0, top);
    ctx.scale(1, 2);
    setFill(ctx, color, line.density);
    ctx.textAlign = 'center';
    ctx.fillText(line.center ?? '', PAPER.width / 2, line.h / 4);
    ctx.restore();
    return;
  }
  setFill(ctx, color, line.density);
  if (line.left) {
    ctx.textAlign = 'left';
    ctx.fillText(line.left, PAPER.margin, top + line.h / 2);
  }
  if (line.right) {
    ctx.textAlign = 'right';
    ctx.fillText(line.right, PAPER.width - PAPER.margin, top + line.h / 2);
  }
  if (line.center) {
    ctx.textAlign = 'center';
    ctx.fillText(line.center, PAPER.width / 2, top + line.h / 2);
  }
}

/** The paper: everything the printer prints, one receipt per period. */
function renderStrip(p: p5, model: ReceiptModel): p5.Graphics {
  const P = model.palette;
  const strip = p.createGraphics(PAPER.width, model.length) as p5.Graphics;
  const ctx = strip.drawingContext as Ctx;
  setFill(ctx, P.paper);
  ctx.fillRect(0, 0, PAPER.width, model.length);

  let y = 0;
  for (const line of model.lines) {
    drawLine(ctx, line, y, P);
    y += line.h;
  }

  // Barcode: one bar per week, centered, 2 px between bars.
  const bars = model.barcode.filter((w) => w > 0);
  const barsTop = y + TAIL.gapAboveBars;
  if (bars.length > 0) {
    const total = bars.reduce((s, w) => s + w, 0) + (bars.length - 1) * 2;
    let x = (PAPER.width - total) / 2;
    ctx.fillStyle = rgba(P.ink, 0.95);
    for (const w of model.barcode) {
      if (w > 0) {
        ctx.fillRect(Math.round(x), barsTop, w, PAPER.bars);
        x += w + 2;
      }
    }
  }

  // Human-readable text under the barcode.
  const footerTop = barsTop + PAPER.bars + TAIL.gapBelowBars;
  ctx.font = `400 14px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '2px';
  ctx.fillStyle = rgba(P.ink, 0.9);
  ctx.fillText(model.footer, PAPER.width / 2, footerTop + TAIL.footer / 2);
  ctx.letterSpacing = '0px';

  // Tear line: a perforation between receipts, with edge notches.
  const tearY = footerTop + TAIL.footer + TAIL.gapBelowFooter + TAIL.tear / 2;
  ctx.strokeStyle = rgba(P.fadedInk, 0.85);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(8, tearY);
  ctx.lineTo(PAPER.width - 8, tearY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalCompositeOperation = 'destination-out';
  for (const cx of [0, PAPER.width]) {
    ctx.beginPath();
    ctx.arc(cx, tearY, 6, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  if (P.paperBorder) {
    ctx.strokeStyle = rgba(P.paperBorder, 0.09);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, PAPER.width - 1, model.length - 1);
  }
  return strip;
}

export function createReceiptSketch(
  model: ReceiptModel,
  identity: Identity,
): {
  setup: (p: p5) => void;
  draw: (p: p5, frame: number, t: number) => void;
} {
  const P = model.palette;
  const fitted = fitIdentity(
    {
      name: identity.name.toUpperCase(),
      tagline: identity.tagline,
      website: identity.website && `↗ ${displayUrl(identity.website)}`,
    },
    IDENTITY_COLUMN,
  );

  // --- static layers --------------------------------------------------------

  /** The counter and the identity column, beneath the paper. */
  function renderChrome(p: p5): p5.Graphics {
    const chrome = p.createGraphics(W, H) as p5.Graphics;
    const ctx = chrome.drawingContext as Ctx;
    setFill(ctx, P.counter);
    ctx.fillRect(0, 0, W, H);

    // Soft shadow around the paper, light theme only.
    if (P.shadow > 0) {
      for (const [x0, x1, peak] of [
        [PAPER_X + PAPER.width, PAPER_X + PAPER.width + 10, P.shadow],
        [PAPER_X - 10, PAPER_X, P.shadow * 0.6],
      ] as const) {
        const grad = ctx.createLinearGradient(x0, 0, x1, 0);
        grad.addColorStop(0, rgba(P.paperBorder!, peak));
        grad.addColorStop(1, rgba(P.paperBorder!, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(x0, 0, x1 - x0, SLOT_Y);
      }
    }

    const x = 48;
    drawText(ctx, PROMPT, x, 58, { size: 13, mono: true, color: P.accent });
    drawText(ctx, fitted.name.text, x, 116, {
      size: fitted.name.size,
      bold: true,
      color: P.identityInk,
      tracking: 3,
    });
    if (fitted.tagline) {
      drawText(ctx, fitted.tagline.text, x, 146, {
        size: fitted.tagline.size,
        color: P.accent,
      });
    }
    drawText(ctx, model.total.toLocaleString('en-US'), x, 218, {
      size: 34,
      bold: true,
      color: P.identityInk,
    });
    drawText(ctx, 'contributions · last 12 months', x, 240, {
      size: 11,
      mono: true,
      color: P.identityMuted,
    });
    if (fitted.website) {
      drawText(ctx, fitted.website.text, x, 350, {
        size: fitted.website.size,
        mono: true,
        color: P.accent,
      });
    }
    return chrome;
  }

  /** The printer, drawn over the paper's lower edge. */
  function renderPrinter(p: p5): p5.Graphics {
    const printer = p.createGraphics(W, H) as p5.Graphics;
    const ctx = printer.drawingContext as Ctx;
    setFill(ctx, P.body);
    ctx.fillRect(PRINTER.left, SLOT_Y, PRINTER.right - PRINTER.left, PRINTER.bottom - SLOT_Y);
    // Bevel on the body's top edge.
    setStroke(ctx, P.bevel, 0.7);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PRINTER.left + 8, SLOT_Y + 1);
    ctx.lineTo(PRINTER.right - 8, SLOT_Y + 1);
    ctx.stroke();

    // The slot: a dark mouth with a serrated tear bar biting the paper.
    setFill(ctx, P.slot);
    ctx.fillRect(SLOT.left, SLOT_Y, SLOT.right - SLOT.left, SLOT.bottom - SLOT_Y);
    setFill(ctx, P.slot);
    ctx.beginPath();
    for (let x = SLOT.left + 4; x < SLOT.right - 2; x += 12) {
      ctx.moveTo(x, SLOT_Y + 1);
      ctx.lineTo(x + 6, SLOT_Y - 5);
      ctx.lineTo(x + 12, SLOT_Y + 1);
      ctx.closePath();
    }
    ctx.fill();
    return printer;
  }

  function setStroke(ctx: Ctx, color: Rgb, alpha = 1): void {
    ctx.strokeStyle = rgba(color, alpha);
  }

  let chrome: p5.Graphics | undefined;
  let printer: p5.Graphics | undefined;
  let strip: p5.Graphics | undefined;

  function setup(p: p5): void {
    chrome = renderChrome(p);
    printer = renderPrinter(p);
    strip = renderStrip(p, model);
  }

  function draw(p: p5, _frame: number, t: number): void {
    const ctx = p.drawingContext as Ctx;
    if (chrome) p.image(chrome, 0, 0);

    // The paper, one whole receipt per period, wrapped at the strip's length.
    const { offset, led } = feedAt(model.feed, t);
    const L = model.length;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAPER_X, 0, PAPER.width, SLOT_Y);
    ctx.clip();
    if (strip) {
      p.image(strip, PAPER_X, SLOT_Y - offset);
      p.image(strip, PAPER_X, SLOT_Y - offset - L);
    }
    ctx.restore();

    if (P.paperBorder) {
      setStroke(ctx, P.paperBorder, 0.09);
      ctx.lineWidth = 1;
      ctx.strokeRect(PAPER_X + 0.5, 0.5, PAPER.width - 1, SLOT_Y - 1);
    }

    if (printer) p.image(printer, 0, 0);

    // Status LED: blinks once per text step, lit while feeding and holding.
    if (led) {
      ctx.save();
      setFill(ctx, P.accent);
      ctx.shadowColor = rgba(P.accent, 0.8);
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(LED.x, LED.y, 4.5, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    } else {
      setFill(ctx, P.accent, 0.16);
      ctx.beginPath();
      ctx.arc(LED.x, LED.y, 4.5, 0, TAU);
      ctx.fill();
    }

    // Prompt cursor, blinking 3 times per loop.
    if (wave(t, 3, 0) > 0.5) {
      setFont(ctx, { size: 13, mono: true });
      setFill(ctx, P.accent);
      ctx.fillRect(48 + ctx.measureText(PROMPT).width + 4, 47, 7, 13);
    }
  }

  return { setup, draw };
}

/** "https://www.example.com/" -> "www.example.com" */
function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}
