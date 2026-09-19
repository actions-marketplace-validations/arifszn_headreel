import type p5 from 'p5';
import { applyCamera, cameraAt } from '../../core/camera.js';
import { altimeterLine, FRAMES, LAYOUT, markerAt, summitDates, type TrailModel } from './trail.js';
import { CELL, GROUND_Y, type Point } from './profile.js';
import { type Palette, type Rgb } from './palette.js';

/**
 * A printed trail profile sheet, walked by one camera.
 *
 * Everything that covers area is flat and pinned (paper, collar), and the
 * sheet's line work is rasterized like a plotter: the profile and the ground
 * line as pure 1px pixel runs, the strata as horizontal spans, the relief as
 * engraved stipple dots. This is not only the printed look the style wants -
 * measured on the top-down draft this style replaces, anti-aliased strokes
 * re-derive their fringes on every camera move, which dithers across a
 * hundred colors and re-shuffles every frame, bloating the GIF to 20 MB;
 * rasterized onto whole pixels the loop is a few MB.
 *
 * The collar, text, graticule, grid, spot heights, summit, marker and
 * neatline stay vector through the raw context (style set right before each
 * draw; see Highlights Reel's note on p5's cached fill state). Small type
 * that would read as dithered noise at the wide shot (grid and month labels,
 * spot figures, the summit label) fades in with zoom, as Highlights Reel's
 * busiest-week rule does for its day cells.
 */

const SANS = '"Space Grotesk"';
const MONO = '"JetBrains Mono"';
const TAU = Math.PI * 2;

const { width: W, height: H, viewport, collar: COLLAR } = LAYOUT;

/** Camera dip tuning: moves longer than `travel` dip, scaled to `span`. */
const CAMERA = { travel: LAYOUT.travel, span: LAYOUT.span } as const;

/** Hairline weights in screen px: the neatline's heavy rule. */
const LINE = { neatHeavy: 2.4, neatThin: 1 } as const;

/** Small type appears as the camera closes in (zoom thresholds). */
const LABEL_Z = { sheet: [0.36, 0.42], summit: [1.15, 1.5] } as const;
/** Screen size of the sheet's small type. */
const LABEL_SIZE = 10;

/** Stipple relief: engraving pitch, and the density under the profile line. */
const STIPPLE_PITCH = 10;
const STIPPLE_BASE = 0.05;
const STIPPLE_MAX = 0.3;

type Ctx = CanvasRenderingContext2D;

/**
 * The camera as a screen transform: the world origin's screen position,
 * snapped to whole pixels exactly as `applyCamera` snaps it, and the zoom.
 * Raster and screen-space layers project through this, so they land on the
 * same pixels as the vector layers under the canvas transform and nothing
 * slides 1 px against the rest while the camera pans.
 */
interface View {
  ox: number;
  oy: number;
  z: number;
}

function viewOf(cam: { x: number; y: number; z: number }): View {
  return {
    ox: Math.round(viewport.cx - cam.x * cam.z),
    oy: Math.round(viewport.cy - cam.y * cam.z),
    z: cam.z,
  };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
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
  mono?: boolean;
  bold?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Letter spacing, in the current space's units. */
  tracking?: number;
}

function setFont(ctx: Ctx, o: TextOptions): void {
  ctx.font = `${o.bold ? 700 : 400} ${o.size}px ${o.mono ? MONO : SANS}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
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

/**
 * The relief, engraved: one stipple dot per jittered grid cell where a seeded
 * draw falls under the cell's density. Density is highest just below the
 * profile line and falls off with depth, so the silhouette reads at the wide
 * shot; flat ground takes no dots, because there is nothing under it. Dots
 * are placed once, in world space, and plotted as single pixels every frame.
 */
function stippleDots(model: TrailModel, next: () => number): number[] {
  const { mapArea, profileY } = model.profile;
  const dots: number[] = [];
  for (let y = STIPPLE_PITCH / 2; y < GROUND_Y; y += STIPPLE_PITCH) {
    for (let x = STIPPLE_PITCH / 2; x < mapArea.x1; x += STIPPLE_PITCH) {
      if (x < mapArea.x0) continue;
      const surface = profileY(x);
      if (y <= surface) continue;
      const depth = (y - surface) / (GROUND_Y - surface);
      const density = STIPPLE_BASE + STIPPLE_MAX * (1 - depth) ** 3;
      if (next() >= density) continue;
      const jx = (next() - 0.5) * 0.8 * STIPPLE_PITCH;
      const jy = (next() - 0.5) * 0.8 * STIPPLE_PITCH;
      dots.push(x + jx, y + jy);
    }
  }
  return dots;
}

/**
 * A plotter hairline between two screen-integer points: Bresenham, batching
 * pixels on the same row into one fillRect so a mostly-horizontal line is a
 * few wide runs instead of one call per pixel. Segments that round to the
 * same pixel are a single dot. `across` shifts the whole line one pixel
 * sideways for the profile line's and the index strata's weight.
 */
function plotHairline(
  ctx: Ctx,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  across: [number, number] | null,
): void {
  const ox = across?.[0] ?? 0;
  const oy = across?.[1] ?? 0;
  let x = Math.round(ax) + ox;
  let y = Math.round(ay) + oy;
  const endX = Math.round(bx) + ox;
  const endY = Math.round(by) + oy;
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  if (dx === 0 && dy === 0) {
    ctx.fillRect(x, y, 1, 1);
    return;
  }
  const sx = x < endX ? 1 : -1;
  const sy = y < endY ? 1 : -1;
  let err = dx + dy;
  let runX = x;
  let runY = y;
  for (;;) {
    const lastX = x;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      // The row changed: flush the run and start the next.
      ctx.fillRect(Math.min(runX, lastX), runY, Math.abs(lastX - runX) + 1, 1);
      err += dx;
      y += sy;
      runY = y;
      runX = x;
    }
    if (x === endX && y === endY) break;
  }
  ctx.fillRect(Math.min(runX, endX), runY, Math.abs(endX - runX) + 1, 1);
}

/** A hairline polyline, plotted with an optional second pass one pixel over. */
function plotPolyline(ctx: Ctx, view: View, line: Point[], across: [number, number] | null): void {
  for (let i = 1; i < line.length; i++) {
    const ax = view.ox + line[i - 1]![0] * view.z;
    const ay = view.oy + line[i - 1]![1] * view.z;
    const bx = view.ox + line[i]![0] * view.z;
    const by = view.oy + line[i]![1] * view.z;
    plotHairline(ctx, ax, ay, bx, by, null);
    if (across) plotHairline(ctx, ax, ay, bx, by, across);
  }
}

export function createTrailSketch(
  model: TrailModel,
  next: () => number,
): {
  setup: (p: p5) => void;
  draw: (p: p5, frame: number, t: number) => void;
} {
  const P: Palette = model.palette;
  const { profile } = model;
  const { mapArea, world } = profile;
  // Pure geometry, computed once.
  let dots: number[] = [];

  function setup(p: p5): void {
    dots = stippleDots(model, next);
    void p;
  }

  /** World point to screen integer, under the current view. */
  const toScreen = (view: View, x: number, y: number): [number, number] => [
    Math.round(view.ox + x * view.z),
    Math.round(view.oy + y * view.z),
  ];

  // --- world layers ---------------------------------------------------------

  /**
   * The elevation grid: a hairline at each index level across the sheet.
   * Like the graticule, the lines are world-weight, so the resting wide sheet
   * reads ruled but faint. Its labels are screen-space (`drawSheetLabels`).
   */
  function drawGrid(ctx: Ctx): void {
    if (!profile.summit) return;
    const indexLevels = profile.levels.filter((l) => l.kind === 'index');
    ctx.lineJoin = 'round';
    setStroke(ctx, P.grid);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const level of indexLevels) {
      ctx.moveTo(mapArea.x0, level.y);
      ctx.lineTo(mapArea.x1, level.y);
    }
    ctx.stroke();
  }

  /** The graticule: a month line from the ground to the top neatline. */
  function drawGraticule(ctx: Ctx): void {
    ctx.lineJoin = 'round';
    setStroke(ctx, P.graticule);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const mark of model.months) {
      const x = mapArea.x0 + mark.week * CELL;
      ctx.moveTo(x, GROUND_Y);
      ctx.lineTo(x, mapArea.y0);
    }
    ctx.stroke();
  }

  /**
   * The plotted sheet: strata, stipple, the ground line and the profile,
   * rasterized in screen space and clipped to the map area, because printed
   * sheets stop at the neatline. The dots and hairlines land on whole pixels
   * at exact colors, so a still camera reproduces the sheet pixel for pixel
   * and a moving one changes only the pixels a line actually crossed.
   */
  function drawRaster(ctx: Ctx, cam: { x: number; y: number; z: number }, view: View): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const [mx0, my0] = toScreen(view, mapArea.x0, mapArea.y0);
    const [mx1, my1] = toScreen(view, mapArea.x1, mapArea.y1);
    ctx.beginPath();
    ctx.rect(mx0, my0, mx1 - mx0, my1 - my0);
    ctx.clip();
    const hw = (W - viewport.left) / 2 / cam.z + 8;
    const hh = H / 2 / cam.z + 8;
    const bounds = { x0: cam.x - hw, x1: cam.x + hw, y0: cam.y - hh, y1: cam.y + hh };

    // Strata: the x spans where the trail is above each level, index levels
    // plotted twice for their weight.
    setFill(ctx, P.strata);
    for (const level of profile.levels) {
      if (level.y < bounds.y0 || level.y > bounds.y1) continue;
      const across: [number, number] | null = level.kind === 'index' ? [0, 1] : null;
      for (const [x0, x1] of level.spans) {
        if (x1 < bounds.x0 || x0 > bounds.x1) continue;
        const ly = view.oy + level.y * view.z;
        const ax = view.ox + x0 * view.z;
        const bx = view.ox + x1 * view.z;
        plotHairline(ctx, ax, ly, bx, ly, null);
        if (across) plotHairline(ctx, ax, ly, bx, ly, across);
      }
    }

    // Stipple relief. Close in, the world pitch would thin to specks, so the
    // dots double with the summit zoom.
    const dot = cam.z > 1.15 ? 2 : 1;
    setFill(ctx, P.stipple);
    for (let d = 0; d < dots.length; d += 2) {
      const x = dots[d]!;
      const y = dots[d + 1]!;
      if (x < mapArea.x0 || x > mapArea.x1 || y < mapArea.y0 || y > mapArea.y1) continue;
      if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) continue;
      const [sx, sy] = toScreen(view, x, y);
      ctx.fillRect(sx, sy, dot, dot);
    }

    // The ground line and the profile, plotted like the rest of the line work.
    setFill(ctx, P.ink);
    const gy = view.oy + GROUND_Y * view.z;
    plotHairline(ctx, view.ox + mapArea.x0 * view.z, gy, view.ox + mapArea.x1 * view.z, gy, null);
    if (profile.summit) {
      setFill(ctx, P.accent);
      plotPolyline(ctx, view, profile.line, [0, 1]);
    }
    ctx.restore();
  }

  /** The summit: survey triangle on the profile, flag on a pole, its figure. */
  function drawSummit(ctx: Ctx, cam: { z: number }, t: number, labelAlpha: number): void {
    const summit = profile.summit;
    if (!summit) return;
    const poleTop = summit.y - 88;

    // Survey triangle at the highest point.
    setFill(ctx, P.ink);
    ctx.beginPath();
    ctx.moveTo(summit.x, summit.y - 7);
    ctx.lineTo(summit.x + 8, summit.y + 6);
    ctx.lineTo(summit.x - 8, summit.y + 6);
    ctx.closePath();
    ctx.fill();

    setStroke(ctx, P.ink);
    ctx.lineWidth = 2 / cam.z;
    ctx.beginPath();
    ctx.moveTo(summit.x, summit.y);
    ctx.lineTo(summit.x, poleTop);
    ctx.stroke();

    // The flag waves only while the camera holds the summit, about one cycle
    // per 40 frames (at least two), amplitude eased to 0 at both ends of the
    // hold, so the wide shots at the seam match (the flag is always planted).
    const { start, end } = model.plan.summitHold;
    const u = end > start ? clamp01((t * FRAMES - start) / (end - start)) : 0;
    const envelope = Math.sin(Math.PI * u);
    const cycles = Math.max(2, Math.round((end - start) / 40));
    const phase = cycles * TAU * u;
    const tipX = 34 + 4 * Math.sin(phase) * envelope;
    const sag = 3 * Math.sin(phase + 1) * envelope;
    setFill(ctx, P.flag);
    ctx.beginPath();
    ctx.moveTo(summit.x, poleTop);
    ctx.quadraticCurveTo(summit.x + tipX * 0.6, poleTop + 8 + sag, summit.x + tipX, poleTop + 8);
    ctx.lineTo(summit.x, poleTop + 16);
    ctx.closePath();
    ctx.fill();

    if (labelAlpha <= 0.02) return;
    // Beside the pole's lower half: at the hold zoom the figure's ascender
    // would cross the frame's top edge if it sat at the flag.
    drawText(ctx, String(summit.total), summit.x + 46, summit.y - 40, {
      size: 30,
      bold: true,
      color: P.ink,
      alpha: labelAlpha,
    });
    drawText(ctx, summitDates(summit.from, summit.to), summit.x + 46, summit.y - 18, {
      size: 13,
      mono: true,
      color: P.muted,
      alpha: labelAlpha,
    });
  }

  /** Double frame around the map: thin inner, heavy outer. */
  function drawNeatline(ctx: Ctx, cam: { z: number }): void {
    ctx.lineJoin = 'miter';
    const off = 7;
    setStroke(ctx, P.ink);
    ctx.lineWidth = LINE.neatHeavy / cam.z;
    ctx.strokeRect(
      mapArea.x0 - off,
      mapArea.y0 - off,
      mapArea.x1 - mapArea.x0 + 2 * off,
      mapArea.y1 - mapArea.y0 + 2 * off,
    );
    ctx.lineWidth = LINE.neatThin / cam.z;
    ctx.strokeRect(mapArea.x0, mapArea.y0, mapArea.x1 - mapArea.x0, mapArea.y1 - mapArea.y0);
  }

  // --- screen layers --------------------------------------------------------

  /**
   * The sheet's small type, at a fixed screen size so it reads at the walk
   * zoom without swelling at the summit: elevation labels on the west
   * neatline (or the viewport's edge), month labels under the ground line, and the spot heights (`×`
   * and figure). Anchored to world points through the snapped view, so it
   * moves with the sheet pixel for pixel.
   */
  function drawSheetLabels(ctx: Ctx, view: View, alpha: number): void {
    if (alpha <= 0.02 || !profile.summit) return;
    const label = { size: LABEL_SIZE, mono: true, color: P.muted, alpha } as const;
    // Elevation labels ride the west neatline, or the viewport's left edge
    // once the walk has panned the neatline out of view.
    const wx = Math.max(toScreen(view, mapArea.x0, 0)[0], viewport.left + 4);
    for (const level of profile.levels) {
      if (level.kind !== 'index') continue;
      const [, y] = toScreen(view, 0, level.y);
      drawText(ctx, String(level.height), wx + 4, y + 4, label);
    }
    const [, gy] = toScreen(view, 0, GROUND_Y);
    drawText(ctx, '0', wx + 4, gy - 3, label);
    for (const mark of model.months) {
      const [x] = toScreen(view, mapArea.x0 + mark.week * CELL, 0);
      drawText(ctx, mark.label, x + 3, gy + 13, label);
    }

    const r = 3.5;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.2;
    setStroke(ctx, P.ink, alpha);
    ctx.beginPath();
    for (const spot of profile.spots) {
      const [x, y] = toScreen(view, spot.x, spot.y);
      ctx.moveTo(x - r, y - r - 6);
      ctx.lineTo(x + r, y + r - 6);
      ctx.moveTo(x + r, y - r - 6);
      ctx.lineTo(x - r, y + r - 6);
    }
    ctx.stroke();
    for (const spot of profile.spots) {
      const [x, y] = toScreen(view, spot.x, spot.y);
      drawText(ctx, String(spot.total), x + 7, y - 3, { ...label, color: P.ink });
    }
  }

  /**
   * The hiker: an ink bead with a paper ring, centred on the profile line.
   * Drawn in screen space at a fixed size, so the walker does not balloon
   * with the zoom; it fades in on the descend and out on the summit arrival.
   */
  function drawMarker(
    ctx: Ctx,
    view: View,
    marker: { x: number; y: number; alpha: number } | null,
  ): void {
    if (!marker || marker.alpha <= 0.02) return;
    const [sx, sy] = toScreen(view, marker.x, marker.y);
    ctx.globalAlpha = marker.alpha;
    setFill(ctx, P.paper);
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, TAU);
    ctx.fill();
    setFill(ctx, P.ink);
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- collar ---------------------------------------------------------------

  function drawScaleBar(ctx: Ctx): void {
    const { px, segments } = model.collar.scale;
    const x = COLLAR.left;
    const y = 296;
    const h = 5;
    setFill(ctx, P.ink);
    ctx.fillRect(x, y, px, h);
    ctx.fillRect(x + 2 * px, y, px, h);
    setStroke(ctx, P.ink);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, segments * px - 1, h - 1);
    for (let k = 0; k <= segments; k++) {
      drawText(ctx, String(k * 4), x + k * px, y - 5, {
        size: 9,
        mono: true,
        align: 'center',
        color: P.muted,
      });
    }
    drawText(ctx, 'WEEKS', x + segments * px + 8, y + 5, { size: 9, mono: true, color: P.muted });
  }

  function drawCollar(ctx: Ctx, altimeter: string | null): void {
    const c = model.collar;
    setFill(ctx, P.paper);
    ctx.fillRect(0, 0, viewport.left, H);
    // The double rule on the collar's right edge.
    setFill(ctx, P.ink, 0.45);
    ctx.fillRect(391, 0, 1, H);
    setFill(ctx, P.ink);
    ctx.fillRect(398, 0, 2, H);

    const x = COLLAR.left;
    drawText(ctx, 'TRAIL PROFILE · LAST 12 MONTHS', x, 58, {
      size: 11,
      mono: true,
      tracking: 2,
      color: P.muted,
    });
    drawText(ctx, c.name.text, x, 122, {
      size: c.name.size,
      bold: true,
      tracking: 3,
      color: P.ink,
    });
    if (c.tagline) {
      drawText(ctx, c.tagline.text, x, 152, { size: c.tagline.size, color: P.accent });
    }
    drawText(ctx, c.total, x, 216, { size: 34, bold: true, color: P.ink });
    drawText(ctx, 'contributions', x, 238, { size: 11, mono: true, color: P.muted });
    if (altimeter) {
      drawText(ctx, altimeter, x, 266, { size: 11, mono: true, color: P.ink });
    }
    drawScaleBar(ctx);
    if (c.intervalText) {
      drawText(ctx, c.intervalText, x, 328, { size: 10, mono: true, color: P.muted });
    }
    if (c.website) {
      drawText(ctx, c.website.text, x, 352, { size: c.website.size, mono: true, color: P.accent });
    }
  }

  // --- frame ----------------------------------------------------------------

  function draw(p: p5, _frame: number, t: number): void {
    const ctx = p.drawingContext as Ctx;
    const frameFloat = t * FRAMES;
    const cam = cameraAt(model.plan.keys, frameFloat, FRAMES, CAMERA);
    const view = viewOf(cam);
    const sheetAlpha = smoothstep(LABEL_Z.sheet[0], LABEL_Z.sheet[1], cam.z);
    const summitAlpha = smoothstep(LABEL_Z.summit[0], LABEL_Z.summit[1], cam.z);

    setFill(ctx, P.paper);
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(viewport.left, 0, W - viewport.left, H);
    ctx.clip();
    applyCamera(ctx, cam, viewport.cx, viewport.cy);
    setFill(ctx, P.paper);
    ctx.fillRect(0, 0, world.w, world.h);
    drawGrid(ctx);
    drawGraticule(ctx);
    drawRaster(ctx, cam, view);
    drawSummit(ctx, cam, t, summitAlpha);
    drawNeatline(ctx, cam);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSheetLabels(ctx, view, sheetAlpha);
    drawMarker(ctx, view, markerAt(profile, model.plan, frameFloat));
    ctx.restore();

    drawCollar(ctx, altimeterLine(profile, model.plan, frameFloat));
  }

  return { setup, draw };
}
