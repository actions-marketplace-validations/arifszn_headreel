import type p5 from 'p5';
import { applyCamera, cameraAt, speedAt, type Shot } from '../../core/camera.js';
import { fitIdentity } from '../../core/text.js';
import type { Identity } from '../types.js';
import {
  FRAMES,
  LAYOUT,
  plateAt,
  stationOf,
  type Card,
  type ContributionsCard,
  type Reel,
  type TopRepoCard,
  type Window,
} from './reel.js';

/**
 * One camera over one desk.
 *
 * The cards and desk are drawn under the camera transform; the identity column
 * is drawn after it, in screen space, and never moves. Held shots do not
 * move at all. The dot
 * field reads the camera speed and gets out of the way: hairline dots crossing
 * the frame fast strobe, and cost GIF bytes. There is no screen-space grain:
 * on a light desk it reads as dust on the lens once the cards move under it.
 *
 * Everything is drawn through the raw 2D context, with the style set right
 * before each draw. p5's cached fill state desyncs from the context as soon as
 * a gradient or shadow is written directly, and a stale fill paints cards
 * white; explicit styles keep every frame identical.
 */

const SANS = '"Space Grotesk"';
const MONO = '"JetBrains Mono"';
const PROMPT = '~/github';

const { width: W, height: H } = LAYOUT;

/** The busiest week's bar, opened: seven day cells with their counts. */
const COLUMN_W = 46;

const TAU = Math.PI * 2;

/** Width of the identity column: x 48 to 440, the solid part of the band. */
export const IDENTITY_COLUMN = 440 - 48;

type Ctx = CanvasRenderingContext2D;
type Rgb = readonly number[];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Camera tuning: moves longer than `travel` dip their zoom, scaled to `span`. */
const CAMERA = { travel: LAYOUT.travel, span: 2400 } as const;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 0..1, periodic in `t`, so every animated value loops seamlessly. */
function wave(t: number, cycles: number, off: number): number {
  return 0.5 + 0.5 * Math.sin(TAU * (t * cycles + off));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "https://www.example.com/" -> "www.example.com" */
function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

function mix(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [
    Math.round(a[0]! + (b[0]! - a[0]!) * t),
    Math.round(a[1]! + (b[1]! - a[1]!) * t),
    Math.round(a[2]! + (b[2]! - a[2]!) * t),
  ];
}

function setFill(ctx: Ctx, color: Rgb | string, alpha = 1): void {
  ctx.fillStyle =
    typeof color === 'string' ? color : `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function setStroke(ctx: Ctx, color: Rgb | string, alpha = 1): void {
  ctx.strokeStyle =
    typeof color === 'string' ? color : `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
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
  o: TextOptions & { color: Rgb | string; alpha?: number },
): void {
  setFont(ctx, o);
  setFill(ctx, o.color, o.alpha ?? 1);
  ctx.fillText(str, x, y);
  if (o.tracking) ctx.letterSpacing = '0px';
}

function measure(ctx: Ctx, str: string, o: TextOptions): number {
  setFont(ctx, o);
  return ctx.measureText(str).width;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function createReelSketch(
  reel: Reel,
  identity: Identity,
): {
  setup: (p: p5) => void;
  draw: (p: p5, frame: number, t: number) => void;
} {
  const PALETTE = reel.palette;
  // The identity column ends where the solid part of the identity band does.
  const fitted = fitIdentity(
    {
      name: identity.name.toUpperCase(),
      tagline: identity.tagline,
      website: identity.website && `↗ ${displayUrl(identity.website)}`,
    },
    IDENTITY_COLUMN,
  );

  // --- camera ---------------------------------------------------------------

  /** The camera at a moment of the loop (see `core/camera.ts`). */
  const camera = (frameFloat: number) => cameraAt(reel.plan.keys, frameFloat, FRAMES, CAMERA);

  /** How fast the frame is moving, in screen pixels, zoom included. */
  const speedOf = (frameFloat: number) => speedAt(reel.plan.keys, frameFloat, FRAMES, CAMERA);

  /** A card builds while the camera arrives; an empty window means already finished. */
  function buildAt(window: Window, frameFloat: number): number {
    if (window.end <= window.start) return 1;
    return easeOutCubic(clamp01((frameFloat - window.start) / (window.end - window.start)));
  }

  // --- desk -----------------------------------------------------------------

  /** Dot field, world space, culled to the visible rect, yielding to speed. */
  function drawDots(ctx: Ctx, cam: Shot, speed: number) {
    const fade = 1 - clamp01((speed - 1) / 4);
    if (fade < 0.03) return;
    const pitch = 56;
    const hw = W / 2 / cam.z + pitch;
    const hh = H / 2 / cam.z + pitch;
    const k0 = Math.ceil(Math.max(-2800, cam.x - hw) / pitch);
    const k1 = Math.floor(Math.min(3800, cam.x + hw) / pitch);
    const j0 = Math.ceil(Math.max(-1000, cam.y - hh) / pitch);
    const j1 = Math.floor(Math.min(1400, cam.y + hh) / pitch);
    setFill(ctx, PALETTE.dots.rgb, PALETTE.dots.alpha * fade);
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        ctx.fillRect(k * pitch - 1.1, j * pitch - 1.1, 2.2, 2.2);
      }
    }
  }

  /** Print registration marks at the card corners: the desk as a light table. */
  function drawMarks(ctx: Ctx, index: number) {
    const s = stationOf(index);
    const { w, h } = LAYOUT.card;
    const l = s.x - w / 2;
    const t = s.y - h / 2;
    const r = s.x + w / 2;
    const b = s.y + h / 2;
    const o = 12;
    const a = 14;
    setStroke(ctx, PALETTE.marks.rgb, PALETTE.marks.alpha);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(l - o - a, t);
    ctx.lineTo(l - o, t);
    ctx.moveTo(l, t - o - a);
    ctx.lineTo(l, t - o);
    ctx.moveTo(r + o, t);
    ctx.lineTo(r + o + a, t);
    ctx.moveTo(r, t - o - a);
    ctx.lineTo(r, t - o);
    ctx.moveTo(l - o - a, b);
    ctx.lineTo(l - o, b);
    ctx.moveTo(l, b + o);
    ctx.lineTo(l, b + o + a);
    ctx.moveTo(r + o, b);
    ctx.lineTo(r + o + a, b);
    ctx.moveTo(r, b + o);
    ctx.lineTo(r, b + o + a);
    ctx.stroke();
  }

  // --- card parts -----------------------------------------------------------

  function eyebrow(ctx: Ctx, text: string, x: number, y: number): void {
    drawText(ctx, text, x, y, { size: 15, mono: true, color: PALETTE.soft, tracking: 2.5 });
  }

  function unitLine(ctx: Ctx, text: string, x: number, y: number): void {
    drawText(ctx, text, x, y, { size: 17, mono: true, color: PALETTE.soft });
  }

  /** The hero figure counts up in cobalt and settles to ink. */
  function drawHero(
    ctx: Ctx,
    value: number,
    x: number,
    y: number,
    size: number,
    prog: number,
  ): void {
    drawText(ctx, Math.round(value * prog).toLocaleString('en-US'), x, y, {
      size,
      bold: true,
      color: mix(PALETTE.accent, PALETTE.ink, prog),
    });
  }

  function starGlyph(ctx: Ctx, x: number, y: number, r: number): void {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function forkGlyph(ctx: Ctx, x: number, y: number, alpha: number): void {
    setStroke(ctx, PALETTE.soft, alpha);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x - 6, y - 9, 3, 0, TAU);
    ctx.moveTo(x - 4, y - 9);
    ctx.arc(x + 6, y - 9, 3, 0, TAU);
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x - 6, y);
    ctx.quadraticCurveTo(x - 6, y + 5, x, y + 5);
    ctx.moveTo(x + 6, y - 6);
    ctx.lineTo(x + 6, y);
    ctx.quadraticCurveTo(x + 6, y + 5, x, y + 5);
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x, y + 12);
    ctx.stroke();
  }

  // --- cards ----------------------------------------------------------------

  function drawShell(ctx: Ctx): void {
    const { w, h, r } = LAYOUT.card;
    setFill(ctx, PALETTE.shadow.rgb, PALETTE.shadow.alpha);
    roundRect(ctx, 0, 16, w, h, r);
    ctx.fill();
    setFill(ctx, PALETTE.card);
    roundRect(ctx, 0, 0, w, h, r);
    ctx.fill();
    setStroke(ctx, PALETTE.border.rgb, PALETTE.border.alpha);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawContributions(ctx: Ctx, card: ContributionsCard, prog: number, zoom: number): void {
    eyebrow(ctx, 'CONTRIBUTIONS · LAST 12 MONTHS', 70, 86);
    drawHero(ctx, card.total, 68, 212, 118, prog);

    if (card.streak !== null) {
      const a = clamp01((prog - 0.5) / 0.3);
      if (a > 0.02) {
        setFill(ctx, PALETTE.amber, a);
        roundRect(ctx, 70, 236, 4, 18, 2);
        ctx.fill();
        const label = 'longest streak';
        const value = ` ${card.streak} ${card.streak === 1 ? 'day' : 'days'}`;
        const opts = { size: 16, mono: true, color: PALETTE.soft, alpha: a } as const;
        drawText(ctx, label, 86, 250, opts);
        drawText(ctx, value, 86 + measure(ctx, label, opts), 250, {
          ...opts,
          color: PALETTE.ink,
        });
      }
    }

    drawStrip(ctx, card, prog, zoom);
  }

  function drawStrip(ctx: Ctx, card: ContributionsCard, prog: number, zoom: number): void {
    const { x, baseline, height } = LAYOUT.strip;
    const n = card.weeks.length;
    const pitch = (LAYOUT.card.w - 2 * x) / n;
    const barW = Math.max(6, pitch * 0.8);
    const maxTotal = Math.max(1, ...card.weeks);
    for (let i = 0; i < n; i++) {
      if (i === card.busiest) continue;
      const gp = clamp01((prog - (i / n) * 0.55) / 0.45);
      if (gp <= 0) continue;
      const total = card.weeks[i]!;
      const bx = x + i * pitch + (pitch - barW) / 2;
      if (total === 0) {
        setFill(ctx, PALETTE.well);
        ctx.fillRect(bx, baseline - 6 * gp, barW, 6 * gp);
      } else {
        setFill(ctx, PALETTE.accent);
        const h = (6 + (total / maxTotal) * (height - 6)) * easeOutCubic(gp);
        ctx.fillRect(bx, baseline - h, barW, h);
      }
    }
    if (card.busiest !== null) drawOpenedColumn(ctx, card, pitch, prog, zoom);
  }

  /**
   * The busiest week's bar, opened: a white plate over its neighbours, seven
   * day cells inside it, counts and a date label that only read once the
   * camera has pushed in close enough.
   */
  function drawOpenedColumn(
    ctx: Ctx,
    card: ContributionsCard,
    pitch: number,
    prog: number,
    zoom: number,
  ): void {
    const { x, baseline, height } = LAYOUT.strip;
    const detail = smoothstep(0.85, 1.05, zoom);
    const cx = x + (card.busiest! + 0.5) * pitch;
    const left = cx - COLUMN_W / 2;
    const days = card.busiestDays;
    const cellH = height / days.length;

    setFill(ctx, PALETTE.card);
    ctx.fillRect(left - 3, baseline - height * prog, COLUMN_W + 6, height * prog + 3);

    days.forEach((count, k) => {
      const top = baseline - (k + 1) * cellH * prog;
      setFill(ctx, count > 0 ? PALETTE.accent : PALETTE.well);
      ctx.fillRect(left, top + 1, COLUMN_W, Math.max(0, cellH * prog - 2));
    });

    if (detail > 0.02) {
      days.forEach((count, k) => {
        const cy = baseline - (k + 0.5) * cellH * prog + 4.5;
        drawText(ctx, String(count), cx, cy, {
          size: 13,
          mono: true,
          align: 'center',
          color: count > 0 ? PALETTE.onAccent : PALETTE.soft,
          alpha: detail,
        });
      });

      const total = days.reduce((s, d) => s + d, 0);
      const label = `${card.busiestLabel}, ${total} ${total === 1 ? 'contribution' : 'contributions'}`;
      const lw = measure(ctx, label, { size: 15, mono: true });
      const lx = Math.min(Math.max(cx, 70 + lw / 2), LAYOUT.card.w - 70 - lw / 2);
      drawText(ctx, label, lx, baseline + 30, {
        size: 15,
        mono: true,
        align: 'center',
        color: PALETTE.soft,
        alpha: detail,
      });
    }
  }

  /** The top repo's own card: what the camera finds inside its pseudo card. */
  function drawTopRepo(ctx: Ctx, card: TopRepoCard, prog: number): void {
    eyebrow(ctx, 'TOP REPOSITORY', 70, 86);
    const a = clamp01((prog - 0.4) / 0.3);
    drawText(ctx, truncate(card.name, 26), 70, 154, {
      size: 46,
      bold: true,
      color: PALETTE.ink,
      alpha: a,
    });

    setFill(ctx, PALETTE.amber, a);
    starGlyph(ctx, 92, 268, 17);
    drawHero(ctx, card.stars, 120, 302, 112, prog);

    if (a > 0.02) {
      let mx = 70;
      if (card.language) {
        setFill(ctx, card.language.color);
        ctx.beginPath();
        ctx.arc(mx + 6, 386, 5.5, 0, TAU);
        ctx.fill();
        drawText(ctx, card.language.name, mx + 20, 390, {
          size: 17,
          mono: true,
          color: PALETTE.soft,
          alpha: a,
        });
        mx += 20 + measure(ctx, card.language.name, { size: 17, mono: true }) + 30;
      }
      forkGlyph(ctx, mx + 6, 384, a);
      drawText(
        ctx,
        `${card.forks.toLocaleString('en-US')} ${card.forks === 1 ? 'fork' : 'forks'}`,
        mx + 20,
        390,
        { size: 17, mono: true, color: PALETTE.soft, alpha: a },
      );
    }
  }

  /**
   * A repo seen from across the desk: the shape of a card in its own colours,
   * a name bar and a star bar sized to its share of the top repo's stars.
   */
  function drawPlate(ctx: Ctx, plate: TopRepoCard['plates'][number], max: number): void {
    const { w, h, r } = LAYOUT.card;
    setFill(ctx, PALETTE.plate);
    roundRect(ctx, 0, 0, w, h, r * 2);
    ctx.fill();
    setFill(ctx, plate.color);
    ctx.beginPath();
    ctx.arc(100, 120, 24, 0, TAU);
    ctx.fill();
    setFill(ctx, PALETTE.ink, 0.72);
    roundRect(ctx, 150, 98, Math.min(720, 120 + plate.name.length * 30), 44, 22);
    ctx.fill();
    setFill(ctx, PALETTE.amber);
    starGlyph(ctx, 100, 340, 42);
    setFill(ctx, PALETTE.accent, 0.85);
    roundRect(ctx, 160, 316, 60 + 660 * (plate.stars / Math.max(1, max)), 48, 24);
    ctx.fill();
  }

  /**
   * Total stars, with the most starred repos laid out as pseudo cards. The
   * camera then pushes into the first one, the others clear, and the pseudo
   * card turns into the top repo's real card, drawn small in the world so the
   * zoom finds real type.
   */
  function drawStars(
    ctx: Ctx,
    card: TopRepoCard,
    prog: number,
    focusProg: number,
    zoom: number,
  ): void {
    eyebrow(ctx, 'TOTAL STARS', 70, 86);
    const a = clamp01((prog - 0.3) / 0.3);
    setFill(ctx, PALETTE.amber, a);
    starGlyph(ctx, 92, 196, 17);
    drawHero(ctx, card.totalStars, 120, 230, 104, prog);
    if (prog > 0.9) unitLine(ctx, 'across public repositories', 70, 280);

    const { scale } = LAYOUT.mini;
    const solo = smoothstep(0.9, 1.8, zoom);
    const detail = smoothstep(1.6, 2.6, zoom);
    const max = card.plates[0]?.stars ?? 1;

    card.plates.forEach((plate, k) => {
      const landed = easeOutCubic(clamp01((prog - (0.25 + k * 0.08)) / 0.3));
      const shown = landed * (k === 0 ? 1 : 1 - solo);
      if (shown <= 0.004) return;
      const at = plateAt(k);
      ctx.save();
      ctx.globalAlpha = shown;
      ctx.translate(at.x, at.y + (1 - landed) * 24);
      ctx.scale(scale, scale);
      if (k > 0 || detail < 1) drawPlate(ctx, plate, max);
      if (k === 0 && detail > 0) {
        ctx.globalAlpha = detail;
        drawShell(ctx);
        drawTopRepo(ctx, card, focusProg);
      }
      ctx.restore();
    });

    // The selection: the top repo is the one the camera is about to choose.
    const sel = clamp01((prog - 0.8) / 0.2) * (1 - detail);
    if (sel > 0.01 && card.plates.length > 0) {
      const at = plateAt(0);
      setStroke(ctx, PALETTE.accent, 0.85 * sel);
      ctx.lineWidth = 3;
      roundRect(
        ctx,
        at.x - 7,
        at.y - 7,
        LAYOUT.card.w * scale + 14,
        LAYOUT.card.h * scale + 14,
        LAYOUT.card.r * scale * 2 + 7,
      );
      ctx.stroke();
    }
  }

  function drawPullRequests(
    ctx: Ctx,
    card: Extract<Card, { kind: 'pull_requests' }>,
    prog: number,
  ): void {
    eyebrow(ctx, 'PULL REQUESTS', 70, 86);
    drawHero(ctx, card.merged, 70, 296, 126, prog);
    if (prog > 0.9) unitLine(ctx, 'merged, all time', 70, 344);
  }

  function drawLanguages(ctx: Ctx, card: Extract<Card, { kind: 'languages' }>, prog: number): void {
    eyebrow(ctx, 'LANGUAGES', 70, 86);
    card.languages.forEach((lang, j) => {
      const a = clamp01((prog - (0.35 + j * 0.15)) / 0.25);
      if (a <= 0.02) return;
      const y = 196 + j * 88;
      setFill(ctx, lang.color);
      ctx.beginPath();
      ctx.arc(76, y - 13, 6, 0, TAU);
      ctx.fill();
      drawText(ctx, lang.name, 96, y, {
        size: 40,
        bold: true,
        color: PALETTE.ink,
        alpha: a,
      });
      drawText(
        ctx,
        `${lang.count} ${lang.count === 1 ? 'repository' : 'repositories'}`,
        96,
        y + 30,
        { size: 16, mono: true, color: PALETTE.soft, alpha: a },
      );
    });
  }

  function drawCard(
    ctx: Ctx,
    card: Card,
    index: number,
    prog: number,
    focusProg: number,
    zoom: number,
  ): void {
    const s = stationOf(index);
    ctx.save();
    ctx.translate(s.x - LAYOUT.card.w / 2, s.y - LAYOUT.card.h / 2);
    drawShell(ctx);
    switch (card.kind) {
      case 'contributions':
        drawContributions(ctx, card, prog, zoom);
        break;
      case 'top_repo':
        drawStars(ctx, card, prog, focusProg, zoom);
        break;
      case 'pull_requests':
        drawPullRequests(ctx, card, prog);
        break;
      case 'languages':
        drawLanguages(ctx, card, prog);
        break;
    }
    ctx.restore();
  }

  // --- screen space ---------------------------------------------------------

  /**
   * The identity band: desk under type that never moves. Solid where a
   * neighbouring card can sit at the hold, then a short fade into the shot.
   */
  function drawWash(ctx: Ctx): void {
    const grad = ctx.createLinearGradient(0, 0, 480, 0);
    const [r, g, b] = PALETTE.desk;
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(440 / 480, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 480, H);
  }

  function drawIdentity(ctx: Ctx, t: number): void {
    const x = 48;
    drawText(ctx, PROMPT, x, 58, { size: 13, mono: true, color: PALETTE.accent });
    if (wave(t, 3, 0) > 0.5) {
      setFill(ctx, PALETTE.accent);
      ctx.fillRect(x + measure(ctx, PROMPT, { size: 13, mono: true }) + 4, 47, 7, 13);
    }

    drawText(ctx, fitted.name.text, x, 116, {
      size: fitted.name.size,
      bold: true,
      color: PALETTE.ink,
      tracking: 3,
    });

    if (fitted.tagline) {
      drawText(ctx, fitted.tagline.text, x, 146, {
        size: fitted.tagline.size,
        color: PALETTE.accent,
      });
    }

    if (fitted.website) {
      drawText(ctx, fitted.website.text, x, 350, {
        size: fitted.website.size,
        mono: true,
        color: PALETTE.accent,
      });
    }
  }

  function setup(_p: p5): void {}

  function draw(p: p5, _frame: number, t: number): void {
    const frameFloat = t * FRAMES;
    const cam = camera(frameFloat);
    const speed = speedOf(frameFloat);
    const ctx = p.drawingContext as Ctx;

    setFill(ctx, PALETTE.desk);
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    // Snap the world to whole screen pixels (see `applyCamera`): at a fixed
    // zoom the drift then moves the cards in 1 px steps instead of resampling
    // every glyph each frame at a new sub-pixel offset.
    applyCamera(ctx, cam, W / 2, H / 2);
    drawDots(ctx, cam, speed);
    for (let i = 0; i < reel.cards.length; i++) drawMarks(ctx, i);
    reel.cards.forEach((card, i) => {
      const prog = buildAt(reel.plan.builds[i]!, frameFloat);
      drawCard(ctx, card, i, prog, buildAt(reel.plan.focus, frameFloat), cam.z);
    });
    ctx.restore();

    drawWash(ctx);
    drawIdentity(ctx, t);
  }

  return { setup, draw };
}
