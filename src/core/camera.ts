/**
 * One camera over one world: a key list `{ frame, x, y, z }` interpolated with
 * a single travel curve, so almost all motion happens in the middle third of a
 * move (Highlights Reel's camera, shared with Trail Profile).
 *
 * Zoom travels in log space, so leaving a deep push-in pulls back as fast as it
 * pans. A long move dips its zoom at the midpoint and pushes in to land; short
 * hops stay flat. Held shots are still, and `frameFloat` wraps so `t = 1` snaps
 * bitwise to `t = 0`, closing the loop to the pixel.
 */

export interface Shot {
  x: number;
  y: number;
  z: number;
}

export interface Key extends Shot {
  frame: number;
}

export interface CameraOptions {
  /** Moves longer than this world distance dip their zoom. */
  travel: number;
  /** The dip scales with distance up to this span. */
  span: number;
  /** The travel curve. Defaults to the quartic in-out. */
  ease?: (t: number) => number;
}

/** The default travel curve: almost all motion happens in the middle third. */
export const easeQuartic = (t: number): number =>
  t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2;

/** A gentler cruise, used for long flights: cubic in-out. */
export const easeCubic = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The camera between keys: one curve, with a zoom dip on long moves. */
export function shotAt(keys: Key[], frame: number, opts: CameraOptions): Shot {
  const ease = opts.ease ?? easeQuartic;
  if (frame <= keys[0]!.frame) {
    return { x: keys[0]!.x, y: keys[0]!.y, z: keys[0]!.z };
  }
  const last = keys[keys.length - 1]!;
  if (frame >= last.frame) {
    return { x: last.x, y: last.y, z: last.z };
  }
  let index = 0;
  while (index < keys.length - 2 && keys[index + 1]!.frame <= frame) {
    index++;
  }
  const from = keys[index]!;
  const to = keys[index + 1]!;
  const t = clamp01((frame - from.frame) / (to.frame - from.frame));
  const travelled = ease(t);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const dip =
    distance > opts.travel
      ? 1 - 0.22 * Math.sin(Math.PI * t) * Math.min(1, distance / opts.span)
      : 1;
  return {
    x: from.x + (to.x - from.x) * travelled,
    y: from.y + (to.y - from.y) * travelled,
    z: from.z * (to.z / from.z) ** travelled * dip,
  };
}

/**
 * The camera at a moment of the loop. Held shots are still: any drift, even in
 * whole-pixel steps, reads as the scene stepping or the type vibrating.
 */
export function cameraAt(
  keys: Key[],
  frameFloat: number,
  frames: number,
  opts: CameraOptions,
): Shot {
  // t = 1 snaps to 0, so the last frame is bit-identical to the first.
  const t = frameFloat >= frames ? 0 : (((frameFloat / frames) % 1) + 1) % 1;
  return shotAt(keys, t * frames, opts);
}

/** How fast the frame is moving, in screen pixels, zoom included. */
export function speedAt(
  keys: Key[],
  frameFloat: number,
  frames: number,
  opts: CameraOptions,
): number {
  const now = cameraAt(keys, frameFloat, frames, opts);
  const before = cameraAt(keys, frameFloat - 1, frames, opts);
  return (
    (Math.hypot(now.x - before.x, now.y - before.y) + Math.abs(now.z - before.z) * 700) * now.z
  );
}

/**
 * Applies the world transform, snapped to whole screen pixels. At a fixed zoom
 * the drift then moves the scene in 1 px steps instead of resampling every
 * glyph each frame at a new sub-pixel offset, which reads as vibrating type.
 * `(cx, cy)` is the viewport's centre in screen space.
 */
export function applyCamera(
  ctx: CanvasRenderingContext2D,
  cam: Shot,
  cx: number,
  cy: number,
): void {
  ctx.translate(Math.round(cx - cam.x * cam.z), Math.round(cy - cam.y * cam.z));
  ctx.scale(cam.z, cam.z);
}
