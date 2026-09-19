import type p5 from 'p5';
import type { Rng } from '../../core/prng.js';
import type { Sketch } from '../../core/render/render.js';
import type { Identity } from '../types.js';
import { cityOrigin, LAYOUT, tileAt, type Arc, type Building, type City } from './city.js';
import type { Accent } from './options.js';

const PALETTE = {
  skyTop: '#07090c',
  skyBottom: '#1c1917',
  skyFloor: '#0c0a09',
  front: [20, 28, 34],
  side: [12, 18, 23],
  ink: '#f5f5f4',
  muted: '#a8a29e',
} as const;

type Rgb = readonly [number, number, number];

/**
 * One accent family: deep (roofs, horizon glow), bright (lines, beam, text),
 * pale (windows, lit edges, packets), and the tint the scan beam adds to a
 * building front. Tailwind 600/400/200; see SPEC for the contrast checks.
 */
interface Family {
  deep: Rgb;
  bright: Rgb;
  pale: Rgb;
  scan: Rgb;
}

const ACCENTS: Record<Accent, Family> = {
  cyan: { deep: [8, 145, 178], bright: [34, 211, 238], pale: [165, 243, 252], scan: [12, 40, 50] },
  cobalt: {
    deep: [37, 99, 235],
    bright: [96, 165, 250],
    pale: [191, 219, 254],
    scan: [19, 33, 50],
  },
  green: { deep: [5, 150, 105], bright: [52, 211, 153], pale: [167, 243, 208], scan: [10, 42, 31] },
  violet: {
    deep: [124, 58, 237],
    bright: [167, 139, 250],
    pale: [221, 214, 254],
    scan: [33, 28, 50],
  },
  pink: {
    deep: [219, 39, 119],
    bright: [244, 114, 182],
    pale: [251, 207, 232],
    scan: [49, 23, 36],
  },
};

const rgba = ([r, g, b]: Rgb, a: number): string => `rgba(${r},${g},${b},${a})`;

const SANS = 'Space Grotesk';
const MONO = 'JetBrains Mono';
const TEXT_X = 48;
const PROMPT = '~/github';

const { width: W, height: H, depthX, depthY, baseY } = LAYOUT;

/** 0..1, periodic in `phase`, so every animated value loops seamlessly. */
function wave(phase: number, cycles: number, off: number): number {
  return 0.5 + 0.5 * Math.sin(Math.PI * 2 * (phase * cycles + off));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** "https://www.example.com/" -> "www.example.com" */
function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

export function createCitySketch(
  city: City,
  identity: Identity,
  rng: Rng,
  accent: Accent = 'cyan',
): Sketch {
  const { deep, bright, pale, scan } = ACCENTS[accent];
  const [br, bg, bb] = bright;
  const [pr, pg, pb] = pale;
  const origin = cityOrigin(city.weeks);
  const noiseSeed = Math.floor(rng() * 2 ** 31);
  const grainSeed = Math.floor(rng() * 2 ** 31);
  let sky: p5.Graphics;
  let grain: p5.Graphics;

  const scanPosition = (phase: number) => {
    const start = origin.x - 100;
    return start + (W + 100 - start) * phase;
  };

  function renderSky(p: p5): p5.Graphics {
    const g = p.createGraphics(W, H);
    g.pixelDensity(1);
    const ctx = g.drawingContext as CanvasRenderingContext2D;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, PALETTE.skyTop);
    grad.addColorStop(0.75, PALETTE.skyBottom);
    grad.addColorStop(1, PALETTE.skyFloor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Horizon glow behind the skyline.
    const gx = origin.x + 520;
    const gy = baseY - 40;
    const glow = ctx.createRadialGradient(gx, gy, 10, gx, gy, 620);
    glow.addColorStop(0, rgba(deep, 0.22));
    glow.addColorStop(0.5, rgba(deep, 0.06));
    glow.addColorStop(1, rgba(deep, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Faint contour lines from warped noise.
    p.noiseSeed(noiseSeed);
    g.noFill();
    g.strokeWeight(0.6);
    for (let k = 0; k < 7; k++) {
      g.stroke(br, bg, bb, 10 + k * 1.5);
      g.beginShape();
      for (let x = 0; x <= W; x += 8) {
        const n = p.noise(x * 0.0025, k * 0.4);
        g.vertex(x, 80 + k * 26 + (p.noise(x * 0.004 + n * 2, k) - 0.5) * 70);
      }
      g.endShape();
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
    for (const s of city.stars) {
      p.fill(226, 244, 250, s.a * (0.35 + 0.65 * wave(phase, s.cycles, s.off)));
      p.rect(s.x, s.y, s.s, s.s);
    }
  }

  function drawGround(p: p5) {
    const back = tileAt(city.weeks, 0, 0);
    const frontRight = tileAt(city.weeks, city.weeks, 6);
    p.noStroke();
    p.fill(14, 18, 22);
    p.quad(
      origin.x - 14,
      origin.y + 6,
      frontRight.x + 14,
      origin.y + 6,
      frontRight.x + 14 + 7 * depthX,
      back.y - depthY - 4,
      back.x - 14 + depthX,
      back.y - depthY - 4,
    );
    // Street grid, one line per weekday row.
    p.stroke(br, bg, bb, 18);
    p.strokeWeight(0.6);
    for (let d = 0; d <= 7; d++) {
      const y = origin.y - d * depthY + 2;
      p.line(origin.x + d * depthX - 8, y, frontRight.x + d * depthX + 8, y);
    }
    p.stroke(br, bg, bb, 60);
    p.strokeWeight(1);
    p.line(origin.x - 14, origin.y + 6, frontRight.x + 14, origin.y + 6);
  }

  function drawBuilding(p: p5, b: Building, phase: number, scanX: number) {
    const { x, y, bw: w, h } = b;
    const dx = depthX * 0.8;
    const dy = depthY * 0.8;
    const hit = Math.max(0, 1 - Math.abs(x + w / 2 - scanX) / 70);

    if (h === 0) {
      p.noStroke();
      p.fill(br, bg, bb, 10 + hit * 40);
      p.quad(x, y, x + w, y, x + w + dx, y - dy, x + dx, y - dy);
      return;
    }

    const lum = 0.55 + b.t * 0.45;
    const [fr, fg, fb] = PALETTE.front;
    const [sr, sg, sb] = PALETTE.side;
    const [tr, tg, tb] = deep;
    p.noStroke();
    p.fill(sr + hit * 10, sg + hit * 30, sb + hit * 38);
    p.quad(x + w, y, x + w + dx, y - dy, x + w + dx, y - dy - h, x + w, y - h);
    p.fill(fr * lum + hit * scan[0], fg * lum + hit * scan[1], fb * lum + hit * scan[2]);
    p.rect(x, y - h, w, h);
    p.fill(tr + hit * 60, tg + hit * 80, tb + hit * 60, Math.min(255, 90 + b.t * 165 + hit * 80));
    p.quad(x, y - h, x + w, y - h, x + w + dx, y - h - dy, x + dx, y - h - dy);
    p.stroke(pr, pg, pb, 40 + b.t * 120 + hit * 90);
    p.strokeWeight(0.8);
    p.line(x, y - h, x + w, y - h);
    p.noStroke();

    const [wr, wg, wb] = pale;
    for (const win of b.windows) {
      const on = win.cycles ? wave(phase, win.cycles, win.off) > 0.5 : win.lit;
      const a = on ? 150 + b.t * 80 : 18;
      p.fill(wr, wg, wb, Math.min(255, a + hit * 120));
      p.rect(x + win.x, y - h + win.y, 3, 2);
    }

    if (b.beacon) {
      const pulse = wave(phase, 2, b.beaconOffset);
      const cx = x + w / 2 + dx / 2;
      const cy = y - h - dy / 2 - 5;
      p.stroke(245, 158, 11, 120);
      p.strokeWeight(1);
      p.line(cx, cy + 4, cx, cy);
      p.noStroke();
      p.fill(245, 158, 11, 30 + pulse * 60);
      p.circle(cx, cy, 8 + pulse * 8);
      p.fill(253, 230, 138, 180 + pulse * 75);
      p.circle(cx, cy, 3);
    }
  }

  function roofPoint(b: Building) {
    return { x: b.x + b.bw / 2 + depthX * 0.4, y: b.y - b.h - depthY * 0.4 };
  }

  function drawArc(p: p5, arc: Arc, phase: number) {
    const p0 = roofPoint(arc.a);
    const p3 = roofPoint(arc.b);
    const top = Math.min(p0.y, p3.y) - arc.lift;
    const c1x = p0.x + (p3.x - p0.x) * 0.25;
    const c2x = p0.x + (p3.x - p0.x) * 0.75;
    p.noFill();
    p.stroke(br, bg, bb, 34);
    p.strokeWeight(0.8);
    p.bezier(p0.x, p0.y, c1x, top, c2x, top, p3.x, p3.y);

    // A packet travels the arc once per loop, trailed by fading dots.
    const t = (phase + arc.off) % 1;
    const eased = easeInOut(t);
    const fade = Math.sin(Math.PI * t);
    p.noStroke();
    for (let k = 6; k >= 0; k--) {
      const s = Math.max(0, eased - k * 0.012);
      const px = p.bezierPoint(p0.x, c1x, c2x, p3.x, s);
      const py = p.bezierPoint(p0.y, top, top, p3.y, s);
      p.fill(pr, pg, pb, (k === 0 ? 255 : 110 - k * 14) * fade);
      p.circle(px, py, k === 0 ? 4 : 3 - k * 0.3);
    }
  }

  function drawScanBeam(p: p5, scanX: number, phase: number) {
    // Fade at both ends of the sweep so the loop seam is invisible.
    const k = Math.min(1, phase / 0.06, (1 - phase) / 0.06);
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    ctx.globalAlpha = k;
    const g = ctx.createLinearGradient(scanX - 60, 0, scanX + 60, 0);
    g.addColorStop(0, rgba(bright, 0));
    g.addColorStop(0.5, rgba(bright, 0.07));
    g.addColorStop(1, rgba(bright, 0));
    ctx.fillStyle = g;
    ctx.fillRect(scanX - 60, 150, 120, baseY - 140);
    p.stroke(pr, pg, pb, 70);
    p.strokeWeight(1);
    p.line(scanX, baseY + 8, scanX, baseY + 16);
    ctx.globalAlpha = 1;
  }

  function drawMonths(p: p5, scanX: number) {
    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);
    p.noStroke();
    for (const m of city.months) {
      const t = tileAt(city.weeks, m.w, 6);
      const hit = Math.max(0, 1 - Math.abs(t.x - scanX) / 80);
      p.fill(168, 162, 158, 110 + hit * 145);
      p.text(m.label, t.x, baseY + 14);
    }
  }

  function drawText(p: p5, phase: number) {
    const x = TEXT_X;
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    p.noStroke();
    p.textAlign(p.LEFT, p.BASELINE);

    // Prompt line with a blinking block cursor.
    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(13);
    p.fill(br, bg, bb);
    p.text(PROMPT, x, 58);
    if (wave(phase, 3, 0) > 0.5) {
      p.rect(x + p.textWidth(PROMPT) + 4, 47, 7, 13);
    }

    p.textFont(SANS);
    p.textStyle(p.BOLD);
    p.textSize(50);
    ctx.letterSpacing = '3px';
    p.fill(PALETTE.ink);
    p.text(identity.name.toUpperCase(), x, 116);
    ctx.letterSpacing = '0px';

    if (identity.tagline) {
      p.textStyle(p.NORMAL);
      p.textSize(17);
      p.fill(br, bg, bb);
      p.text(identity.tagline, x, 146);
    }

    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(11);
    p.fill(PALETTE.muted);
    p.text('LAST 12 MONTHS', x, 206);
    p.textFont(SANS);
    p.textStyle(p.BOLD);
    p.textSize(34);
    p.fill(PALETTE.ink);
    p.text(city.total.toLocaleString('en-US'), x, 244);
    p.textFont(MONO);
    p.textStyle(p.NORMAL);
    p.textSize(11);
    p.fill(PALETTE.muted);
    p.text('contributions', x, 262);

    if (city.maxCount > 0) {
      p.fill(245, 158, 11);
      p.circle(x + 4, 292, 5);
      p.fill(PALETTE.muted);
      p.text('busiest days', x + 14, 296);
    }

    if (identity.website) {
      p.textSize(12);
      p.fill(br, bg, bb);
      p.text(`↗ ${displayUrl(identity.website)}`, x, 350);
    }
  }

  return {
    setup(p) {
      sky = renderSky(p);
      grain = renderGrain(p);
    },
    draw(p, _frame, phase) {
      const scanX = scanPosition(phase);
      p.image(sky, 0, 0);
      drawStars(p, phase);
      drawGround(p);
      for (const b of city.buildings) drawBuilding(p, b, phase, scanX);
      for (const arc of city.arcs) drawArc(p, arc, phase);
      drawScanBeam(p, scanX, phase);
      drawMonths(p, scanX);
      drawText(p, phase);
      p.image(grain, 0, 0);
    },
  };
}
