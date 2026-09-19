import type p5 from 'p5';
import { dotScale } from './halftone.js';
import { LAYOUT, typedChars, type SheetModel } from './sheet.js';
import type { Rgb } from './palette.js';

/**
 * The spec card. Everything is drawn in screen space through the raw context,
 * the style set right before each draw (see Highlights Reel's note on p5's
 * cached fill state), so a still frame reproduces byte for byte: the loop
 * holds the finished card at both ends and only the portrait's dots and the
 * table's typing move in between.
 */

const MONO = '"JetBrains Mono"';
const SANS = '"Space Grotesk"';
const TAU = Math.PI * 2;

const { width: W, height: H, inset: INSET, pad: PAD, grid: GRID, panel: PANEL } = LAYOUT;

/** Rule weights, px: the card and table borders, the header rule, row rules. */
const LINE = { border: 2, header: 2, row: 1 } as const;

/** Table type: header and labels tracked, values plain mono. */
const TYPE = { header: 11, label: 12, value: 16, glyph: 12 } as const;

type Ctx = CanvasRenderingContext2D;

function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function setFill(ctx: Ctx, color: Rgb, alpha = 1): void {
  ctx.fillStyle = rgba(color, alpha);
}

interface TextOptions {
  size: number;
  mono?: boolean;
  bold?: boolean;
  align?: CanvasTextAlign;
  /** Letter spacing, px. */
  tracking?: number;
}

function setFont(ctx: Ctx, o: TextOptions): void {
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
  o: TextOptions & { color: Rgb },
): void {
  setFont(ctx, o);
  setFill(ctx, o.color);
  ctx.fillText(str, x, y);
  if (o.tracking) ctx.letterSpacing = '0px';
}

/** The value column's mono advance at 16 px, for the typing cursor's width. */
function monoAdvance(ctx: Ctx): number {
  setFont(ctx, { size: TYPE.value, mono: true });
  return ctx.measureText('0').width;
}

export function createSpecSheetSketch(model: SheetModel): {
  setup: (p: p5) => void;
  draw: (p: p5, frame: number, t: number) => void;
} {
  const P = model.palette;

  function setup(p: p5): void {
    void p;
  }

  /** Grid paper: whole-pixel hairlines at the exact blended color. */
  function drawGrid(ctx: Ctx): void {
    setFill(ctx, P.grid);
    for (let x = GRID; x < W; x += GRID) ctx.fillRect(x, 0, 1, H);
    for (let y = GRID; y < H; y += GRID) ctx.fillRect(0, y, W, 1);
  }

  /** The card border and the bordered stats table, printed black. */
  function drawRules(ctx: Ctx): void {
    ctx.strokeStyle = rgba(P.ink);
    ctx.lineWidth = LINE.border;
    ctx.strokeRect(INSET + 1, INSET + 1, W - 2 * INSET - 2, H - 2 * INSET - 2);
    ctx.strokeRect(
      PANEL.left + 1,
      PANEL.top + 1,
      PANEL.right - PANEL.left - 2,
      PANEL.bottom - PANEL.top - 2,
    );
    setFill(ctx, P.ink);
    const headerY = PANEL.top + PANEL.rowH;
    ctx.fillRect(PANEL.left, headerY - 1, PANEL.right - PANEL.left, LINE.header);
    for (let i = 1; i < model.stats.length; i++) {
      ctx.fillRect(PANEL.left, headerY + i * PANEL.rowH, PANEL.right - PANEL.left, LINE.row);
    }
  }

  function drawHeadline(ctx: Ctx): void {
    drawText(ctx, model.sinceText, W - PAD, LAYOUT.topBarY, {
      size: 12,
      mono: true,
      tracking: 2,
      align: 'right',
      color: P.muted,
    });
    drawText(ctx, model.eyebrow, PAD, LAYOUT.eyebrowY, {
      size: 12,
      mono: true,
      tracking: 2,
      color: P.accent,
    });
    drawText(ctx, model.name.text, PAD, LAYOUT.nameY, {
      size: model.name.size,
      bold: true,
      tracking: 2,
      color: P.ink,
    });
    if (model.tagline) {
      drawText(ctx, model.tagline.text, PAD, LAYOUT.taglineY, {
        size: model.tagline.size,
        bold: true,
        color: P.accent,
      });
    }
  }

  /**
   * The stats table. The form is printed (glyphs, labels, rules); the values
   * are deleted during the dissolve and retyped during the build from their
   * final left anchor, so the completed row is right-aligned and the typing
   * grows rightward in place.
   */
  function drawStats(ctx: Ctx, t: number, advance: number): void {
    const headerY = PANEL.top + PANEL.rowH;
    drawText(ctx, 'STATS', PANEL.left + PANEL.pad, headerY - 13, {
      size: TYPE.header,
      mono: true,
      tracking: 2,
      color: P.muted,
    });

    model.stats.forEach((row, i) => {
      const baseline = headerY + i * PANEL.rowH + 25;
      drawText(ctx, row.glyph, PANEL.left + PANEL.pad, baseline, {
        size: TYPE.glyph,
        mono: true,
        color: P.ink,
      });
      drawText(ctx, row.label, PANEL.left + PANEL.pad + 22, baseline, {
        size: TYPE.label,
        mono: true,
        tracking: 1,
        color: P.muted,
      });

      const { text, cursor } = typedChars(row.value, i, model.stats.length, t);
      setFont(ctx, { size: TYPE.value, mono: true });
      const anchor = PANEL.right - PANEL.pad - ctx.measureText(row.value).width;
      const width = ctx.measureText(text).width;
      drawText(ctx, text, anchor, baseline, { size: TYPE.value, mono: true, color: P.ink });
      if (cursor) {
        setFill(ctx, P.accent);
        ctx.fillRect(anchor + width + 1, baseline - 13, advance, TYPE.value);
      }
    });
  }

  /** The portrait: the halftone screen, each dot at its phase scale. */
  function drawPortrait(ctx: Ctx, t: number): void {
    setFill(ctx, P.ink);
    for (const dot of model.dots) {
      const scale = dotScale(dot, t);
      if (scale <= 0) continue;
      const r = dot.r * scale;
      if (r < 0.1) continue;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, r, 0, TAU);
      ctx.fill();
    }
  }

  function drawFooter(ctx: Ctx): void {
    if (model.footer.handle) {
      drawText(ctx, model.footer.handle, PAD, LAYOUT.footerY, {
        size: 12,
        mono: true,
        tracking: 2,
        color: P.muted,
      });
    }
    if (model.footer.website) {
      drawText(ctx, '↗', model.footer.arrowX, LAYOUT.footerY, {
        size: 12,
        mono: true,
        tracking: 2,
        color: P.accent,
      });
      drawText(ctx, model.footer.website.text, model.footer.websiteX, LAYOUT.footerY, {
        size: 12,
        mono: true,
        tracking: 2,
        color: P.accent,
      });
    }
  }

  function draw(p: p5, _frame: number, t: number): void {
    const ctx = p.drawingContext as Ctx;
    setFill(ctx, P.paper);
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx);
    drawRules(ctx);
    drawHeadline(ctx);
    drawStats(ctx, t, monoAdvance(ctx));
    drawPortrait(ctx, t);
    drawFooter(ctx);
  }

  return { setup, draw };
}
