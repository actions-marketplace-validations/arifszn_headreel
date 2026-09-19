import type p5 from 'p5';
import type { Rng } from '../../core/prng.js';
import type { Sketch } from '../../core/render/render.js';
import { fitIdentity } from '../../core/text.js';
import type { Identity } from '../types.js';
import { LAYOUT, RINGS, type Galaxy, type Planet, type Rgb } from './galaxy.js';

const PALETTE = {
  skyTop: '#060914',
  skyMid: '#0d1228',
  skyFloor: '#0a0d1c',
  /** Shadow side of planets. */
  night: [6, 9, 20],
  brass: [217, 178, 111],
  sun: [255, 243, 214],
  ink: '#f2ede3',
  muted: '#8e93a8',
} as const;

const SANS = 'Space Grotesk';
const MONO = 'JetBrains Mono';
const TEXT_X = 48;
const PROMPT = '~/repos';
/**
 * Rays around the sun, long and short in turn. They rotate by one long-short
 * pair (two spacings) per loop, so the loop closes.
 */
const RAYS = 12;
/** Trail length along the orbit, px. */
const TRAIL = 110;
/** Where orbit names sit: the far side, left of the sun's crown. */
const RING_LABEL_ANGLE = -Math.PI / 2 - 0.42;

const { width: W, height: H, cx: CX, cy: CY, tilt: TILT, aspect: ASPECT } = LAYOUT;
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);

/** 0..1, periodic in `phase`, so every animated value loops seamlessly. */
function wave(phase: number, cycles: number, off: number): number {
  return 0.5 + 0.5 * Math.sin(Math.PI * 2 * (phase * cycles + off));
}

/** Screen position of angle `a` on an orbit of half-width `rx`. */
function project(rx: number, a: number): { x: number; y: number } {
  const x = rx * Math.cos(a);
  const y = rx * ASPECT * Math.sin(a);
  return { x: CX + x * COS_T - y * SIN_T, y: CY + x * SIN_T + y * COS_T };
}

/** -1 at the far side of the plane, 1 at the near side. */
const depthOf = (a: number) => Math.sin(a);

function rgba([r, g, b]: Rgb, a: number): string {
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** 1234 -> "1.2k" */
function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`;
}

/** "https://www.example.com/" -> "www.example.com" */
function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface Placed {
  planet: Planet;
  a: number;
  x: number;
  y: number;
  depth: number;
  r: number;
}

export function createGalaxySketch(
  galaxy: Galaxy,
  identity: Identity,
  login: string,
  rng: Rng,
): Sketch {
  const grainSeed = Math.floor(rng() * 2 ** 31);
  // Everything in the text column stops short of the outer orbit's dial.
  const column = CX - RINGS[RINGS.length - 1]!.rx - 24 - TEXT_X;
  const fitted = fitIdentity(
    {
      name: identity.name.toUpperCase(),
      tagline: identity.tagline,
      website: identity.website && `↗ ${displayUrl(identity.website)}`,
    },
    column,
  );
  let sky: p5.Graphics;
  let grain: p5.Graphics;

  function renderSky(p: p5): p5.Graphics {
    const g = p.createGraphics(W, H);
    g.pixelDensity(1);
    const ctx = g.drawingContext as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, PALETTE.skyTop);
    grad.addColorStop(0.7, PALETTE.skyMid);
    grad.addColorStop(1, PALETTE.skyFloor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Cool haze on the far right, warm light around the sun.
    const haze = ctx.createRadialGradient(1180, 60, 0, 1180, 60, 520);
    haze.addColorStop(0, 'rgba(111,120,220,0.10)');
    haze.addColorStop(1, 'rgba(111,120,220,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);
    const warm = ctx.createRadialGradient(CX, CY, 0, CX, CY, 420);
    warm.addColorStop(0, 'rgba(217,178,111,0.20)');
    warm.addColorStop(0.35, 'rgba(217,178,111,0.06)');
    warm.addColorStop(1, 'rgba(217,178,111,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);

    for (const d of galaxy.dust) {
      ctx.fillStyle = d.warm ? `rgba(240,214,170,${d.a / 255})` : `rgba(190,200,255,${d.a / 255})`;
      ctx.fillRect(d.x, d.y, 1, 1);
    }
    return g;
  }

  function renderGrain(p: p5): p5.Graphics {
    const g = p.createGraphics(W, H);
    g.pixelDensity(1);
    g.noStroke();
    let s = grainSeed;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < LAYOUT.grain; i++) {
      g.fill(255, 4 + next() * 8);
      g.rect(next() * W, next() * H, 1, 1);
    }
    return g;
  }

  function drawStars(p: p5, phase: number) {
    p.noStroke();
    for (const s of galaxy.stars) {
      p.fill(226, 232, 250, s.a * (0.3 + 0.7 * wave(phase, s.cycles, s.off)));
      p.rect(s.x, s.y, s.s, s.s);
    }
  }

  /** One half of every orbit: the far half (behind the sun) or the near half. */
  function drawOrbits(ctx: CanvasRenderingContext2D, near: boolean) {
    const [start, end] = near ? [0, Math.PI] : [Math.PI, Math.PI * 2];
    ctx.lineWidth = 0.8;
    RINGS.forEach((ring, i) => {
      const outer = i === RINGS.length - 1;
      ctx.strokeStyle = rgba(PALETTE.brass, (near ? 0.42 : 0.2) + (outer ? 0.08 : 0));
      ctx.setLineDash(outer ? [] : [1, 4]);
      ctx.beginPath();
      ctx.ellipse(CX, CY, ring.rx, ring.rx * ASPECT, TILT, start, end);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Dial on the outer orbit: a tick every 6 degrees, a long one every 30.
    const rx = RINGS[RINGS.length - 1]!.rx;
    ctx.strokeStyle = rgba(PALETTE.brass, near ? 0.5 : 0.24);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      if (depthOf(a) >= 0 !== near) continue;
      const inner = project(rx + 3, a);
      const outerPt = project(rx + (k % 5 === 0 ? 11 : 6), a);
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(outerPt.x, outerPt.y);
    }
    ctx.stroke();
  }

  function drawRingLabels(p: p5) {
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(9);
    p.noStroke();
    ctx.letterSpacing = '1.5px';
    p.textAlign(p.CENTER, p.BASELINE);
    for (const ring of RINGS) {
      const at = project(ring.rx, RING_LABEL_ANGLE);
      p.fill(217, 178, 111, 130);
      p.text(ring.label, at.x, at.y - 5);
    }
    ctx.letterSpacing = '0px';
  }

  function place(planet: Planet, phase: number): Placed {
    const ring = RINGS[planet.ring]!;
    const a = planet.angle + Math.PI * 2 * ring.revs * phase;
    const { x, y } = project(ring.rx, a);
    const depth = depthOf(a);
    return { planet, a, x, y, depth, r: planet.r * (1 + 0.16 * depth) };
  }

  function drawTrail(ctx: CanvasRenderingContext2D, pl: Placed, light: number) {
    const rx = RINGS[pl.planet.ring]!.rx;
    const span = TRAIL / rx;
    const steps = 24;
    ctx.lineCap = 'round';
    let prev = project(rx, pl.a);
    for (let k = 1; k <= steps; k++) {
      const pt = project(rx, pl.a - (span * k) / steps);
      const fade = 1 - k / steps;
      ctx.strokeStyle = rgba(pl.planet.color, 0.45 * fade * fade * light);
      ctx.lineWidth = Math.max(0.6, pl.r * 0.55 * fade);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      prev = pt;
    }
  }

  /** A lit sphere: bright toward the sun, shadowed on the far side. */
  function drawPlanet(ctx: CanvasRenderingContext2D, pl: Placed) {
    const { x, y, r, planet } = pl;
    const light = 0.62 + 0.38 * ((pl.depth + 1) / 2);
    drawTrail(ctx, pl, light);

    // A soft glow on the larger planets only; small ones stay crisp.
    if (r >= 7) {
      const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2);
      halo.addColorStop(0, rgba(planet.color, 0.2 * light));
      halo.addColorStop(1, rgba(planet.color, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    }

    const ring = planet.rank === 0 && planet.stars > 0;
    if (ring) drawPlanetRing(ctx, pl, false, light);

    // Direction from the sun, for the shadow side.
    const dx = x - CX;
    const dy = y - CY;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(planet.color, light);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = rgba(PALETTE.night, 0.62);
    ctx.beginPath();
    ctx.arc(x + ux * r * 0.95, y + uy * r * 0.95, r * 1.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${(0.35 * light).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x - ux * r * 0.45, y - uy * r * 0.45, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (ring) drawPlanetRing(ctx, pl, true, light);
  }

  /** The most starred repo wears a ring, split so the planet sits inside it. */
  function drawPlanetRing(ctx: CanvasRenderingContext2D, pl: Placed, near: boolean, light: number) {
    const [start, end] = near ? [0, Math.PI] : [Math.PI, Math.PI * 2];
    ctx.lineCap = 'butt';
    for (const [scale, width, alpha] of [
      [2.05, 1.6, 0.75],
      [1.6, 0.8, 0.45],
    ] as const) {
      ctx.strokeStyle = rgba(PALETTE.brass, alpha * light);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.ellipse(pl.x, pl.y, pl.r * scale, pl.r * scale * 0.32, -0.32, start, end);
      ctx.stroke();
    }
  }

  function drawSun(p: p5, phase: number) {
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    const pulse = wave(phase, 1, 0);
    const corona = ctx.createRadialGradient(CX, CY, 8, CX, CY, 64 + pulse * 10);
    corona.addColorStop(0, rgba(PALETTE.sun, 0.55));
    corona.addColorStop(0.3, rgba(PALETTE.brass, 0.22));
    corona.addColorStop(1, rgba(PALETTE.brass, 0));
    ctx.fillStyle = corona;
    ctx.fillRect(CX - 80, CY - 80, 160, 160);

    ctx.strokeStyle = rgba(PALETTE.brass, 0.4);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const turn = (phase * Math.PI * 4) / RAYS;
    for (let k = 0; k < RAYS; k++) {
      const a = turn + (k / RAYS) * Math.PI * 2;
      const len = k % 2 === 0 ? 20 : 11;
      ctx.moveTo(CX + Math.cos(a) * 22, CY + Math.sin(a) * 22);
      ctx.lineTo(CX + Math.cos(a) * (22 + len), CY + Math.sin(a) * (22 + len));
    }
    ctx.stroke();

    const core = ctx.createRadialGradient(CX - 4, CY - 4, 1, CX, CY, 15);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.6, rgba(PALETTE.sun, 1));
    core.addColorStop(1, rgba([246, 206, 140], 1));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(CX, CY, 15, 0, Math.PI * 2);
    ctx.fill();

    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(10);
    p.textAlign(p.CENTER, p.BASELINE);
    p.noStroke();
    p.fill(217, 178, 111, 200);
    p.text(`@${login}`, CX, CY + 34);
  }

  function drawStarGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Callout centered above the planet, clamped to the canvas. Its position is
   * a continuous function of the planet's, so it never jumps between frames.
   */
  function drawLabel(p: p5, pl: Placed) {
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    const light = 0.55 + 0.45 * ((pl.depth + 1) / 2);
    const name = truncate(pl.planet.name, 22);
    const count = compact(pl.planet.stars);
    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(11);
    const nameW = p.textWidth(name);
    const width = nameW + 17 + p.textWidth(count);

    const ey = pl.y - pl.r - 16;
    const tx = Math.min(Math.max(pl.x - width / 2, 20), W - 20 - width);
    ctx.strokeStyle = rgba(PALETTE.brass, 0.6 * light);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(pl.x, pl.y - pl.r - 2);
    ctx.lineTo(pl.x, ey + 8);
    ctx.stroke();

    // A dark tag behind the text keeps it legible when it crosses the sun.
    ctx.fillStyle = rgba(PALETTE.night, 0.7 * light);
    ctx.beginPath();
    ctx.roundRect(tx - 4, ey - 8, width + 8, 16, 3);
    ctx.fill();
    p.textAlign(p.LEFT, p.BASELINE);
    p.noStroke();
    p.fill(242, 237, 227, 235 * light);
    p.text(name, tx, ey + 4);
    const sx = tx + nameW + 10;
    ctx.fillStyle = rgba(PALETTE.brass, light);
    drawStarGlyph(ctx, sx, ey + 0.5, 4.2);
    p.fill(217, 178, 111, 255 * light);
    p.text(count, sx + 7, ey + 4);
  }

  function drawText(p: p5, phase: number) {
    const x = TEXT_X;
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    const brass = PALETTE.brass;
    p.noStroke();
    p.textAlign(p.LEFT, p.BASELINE);

    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(13);
    p.fill(...brass);
    p.text(PROMPT, x, 58);
    if (wave(phase, 3, 0) > 0.5) {
      p.rect(x + p.textWidth(PROMPT) + 4, 47, 7, 13);
    }

    p.textFont(SANS);
    p.textStyle(p.BOLD);
    p.textSize(fitted.name.size);
    ctx.letterSpacing = '3px';
    p.fill(PALETTE.ink);
    p.text(fitted.name.text, x, 116);
    ctx.letterSpacing = '0px';

    if (fitted.tagline) {
      p.textStyle(p.NORMAL);
      p.textSize(fitted.tagline.size);
      p.fill(...brass);
      p.text(fitted.tagline.text, x, 146);
    }

    const count = galaxy.planets.length;
    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(11);
    p.fill(PALETTE.muted);
    p.text(count === 1 ? '1 REPOSITORY' : `${count} REPOSITORIES`, x, 206);
    p.textFont(SANS);
    p.textStyle(p.BOLD);
    p.textSize(34);
    p.fill(PALETTE.ink);
    p.text(galaxy.totalStars.toLocaleString('en-US'), x, 244);
    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(11);
    p.fill(PALETTE.muted);
    p.text(galaxy.totalStars === 1 ? 'star' : 'stars', x, 262);

    if (count === 0) {
      p.text('no public repositories yet', x, 296);
    }
    let lx = x;
    for (const lang of galaxy.languages) {
      const label = truncate(lang.name, 14);
      p.fill(...lang.color);
      p.circle(lx + 4, 292, 7);
      p.fill(PALETTE.muted);
      p.text(label, lx + 14, 296);
      lx += 14 + p.textWidth(label) + 18;
    }

    if (fitted.website) {
      p.textSize(fitted.website.size);
      p.fill(...brass);
      p.text(fitted.website.text, x, 350);
    }
  }

  return {
    setup(p) {
      sky = renderSky(p);
      grain = renderGrain(p);
    },
    draw(p, _frame, phase) {
      const ctx = p.drawingContext as CanvasRenderingContext2D;
      const placed = galaxy.planets.map((pl) => place(pl, phase)).sort((a, b) => a.depth - b.depth);

      p.image(sky, 0, 0);
      drawStars(p, phase);
      drawOrbits(ctx, false);
      drawRingLabels(p);
      for (const pl of placed) if (pl.depth < 0) drawPlanet(ctx, pl);
      drawSun(p, phase);
      drawOrbits(ctx, true);
      for (const pl of placed) if (pl.depth >= 0) drawPlanet(ctx, pl);
      for (const pl of placed) if (pl.planet.label) drawLabel(p, pl);
      drawText(p, phase);
      p.image(grain, 0, 0);
    },
  };
}
