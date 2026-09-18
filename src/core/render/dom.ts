import { createCanvas, DOMMatrix, ImageData, Path2D, type Canvas } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLCanvasElement',
  'Image',
  'Event',
  'MouseEvent',
  'getComputedStyle',
  'screen',
  'devicePixelRatio',
  // p5 passes an AbortSignal to addEventListener; jsdom rejects Node's own.
  'AbortController',
  'AbortSignal',
] as const;

let installed = false;

/**
 * Installs a jsdom window on globalThis with canvas elements backed by
 * @napi-rs/canvas. p5 2.x draws shapes through Path2D, which node-canvas lacks.
 * Idempotent; must run before importing p5.
 */
export function installDom(): void {
  if (installed) return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const win = dom.window as unknown as Record<string, unknown>;

  for (const key of DOM_GLOBALS) {
    if (win[key] !== undefined) {
      Object.defineProperty(globalThis, key, {
        value: win[key],
        configurable: true,
        writable: true,
      });
    }
  }

  const backing = new WeakMap<HTMLCanvasElement, Canvas>();
  dom.window.HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== '2d') return null;
    let canvas = backing.get(this);
    if (!canvas || canvas.width !== this.width || canvas.height !== this.height) {
      canvas = createCanvas(this.width, this.height);
      backing.set(this, canvas);
    }
    return canvas.getContext('2d');
  } as typeof HTMLCanvasElement.prototype.getContext;

  Object.assign(globalThis, {
    Path2D,
    ImageData,
    DOMMatrix,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  });
  installed = true;
}
