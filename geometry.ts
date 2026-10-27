/* Crop and turn arithmetic, kept free of the DOM so it can be tested on its own. Everything here is in the "turned"
   image: the source after its quarter turns and flips (its orientation), before straightening. A straighten angle turns that image
   about its centre, and the crop has to stay inside both the turned image and its own frame. */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const RADIANS = Math.PI / 180;

/**
 * Which way up the image is: a 2×2 matrix of 0s and ±1s taking a point of the source, measured from its centre, to
 * the turned image. Quarter turns and flips compose by multiplying, in the order they were made, so a flip after a
 * turn mirrors what is on screen.
 */
export type Orientation = readonly [number, number, number, number];

export const UPRIGHT: Orientation = [1, 0, 0, 1];
/** A quarter turn counter-clockwise on screen, where y points down. */
export const TURN_LEFT: Orientation = [0, 1, -1, 0];
export const FLIP_X: Orientation = [-1, 0, 0, 1];
export const FLIP_Y: Orientation = [1, 0, 0, -1];

/** `op` applied after `m`. */
export function compose(op: Orientation, m: Orientation): Orientation {
  // Adding 0 turns -0 into 0, so equal orientations compare equal.
  return [op[0] * m[0] + op[1] * m[2] + 0, op[0] * m[1] + op[1] * m[3] + 0, op[2] * m[0] + op[3] * m[2] + 0, op[2] * m[1] + op[3] * m[3] + 0];
}

/** Whether an orientation mirrors the image, which reverses the way a straighten angle turns. */
export const mirrored = (m: Orientation) => m[0] * m[3] - m[1] * m[2] < 0;

/** The image's size the way up `m` puts it. */
export function orientedSize(size: Size, m: Orientation): Size {
  return m[0] !== 0 ? { width: size.width, height: size.height } : { width: size.height, height: size.width };
}

export function corners(rect: Rect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/** Whether `point` is inside a `size` image turned by `degrees` about its centre. */
export function insideTurned(point: Point, size: Size, degrees: number): boolean {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const cos = Math.cos(-degrees * RADIANS);
  const sin = Math.sin(-degrees * RADIANS);
  const dx = point.x - cx;
  const dy = point.y - cy;
  const ux = dx * cos - dy * sin;
  const uy = dx * sin + dy * cos;
  return Math.abs(ux) <= cx + 1e-6 && Math.abs(uy) <= cy + 1e-6;
}

/** Whether a crop fits: inside the straightened image and inside the frame it is shown in. */
export function cropFits(rect: Rect, size: Size, degrees: number): boolean {
  return rect.width > 0 && rect.height > 0 && corners(rect).every((point) => insideTurned(point, size, degrees) && insideTurned(point, size, 0));
}

/**
 * The largest copy of `rect`, about the same centre and of the same shape, that fits inside the image straightened by
 * `degrees` and inside its frame. If too little of it fits about that centre, about the image's centre instead.
 */
export function fitCrop(rect: Rect, size: Size, degrees: number): Rect {
  const centre = { x: size.width / 2, y: size.height / 2 };
  const scaleAt = (cx: number, cy: number) => {
    let k = 1;
    for (const angle of [degrees, 0]) {
      const cos = Math.cos(-angle * RADIANS);
      const sin = Math.sin(-angle * RADIANS);
      const turn = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
      const a = turn(cx - centre.x, cy - centre.y);
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const b = turn((sx * rect.width) / 2, (sy * rect.height) / 2);
        // Each corner, a + k·b, has to stay within the half-size on both axes.
        for (const [av, bv, limit] of [[a.x, b.x, centre.x], [a.y, b.y, centre.y]]) {
          if (Math.abs(av) > limit + 1e-9) return 0;
          if (bv > 0) k = Math.min(k, (limit - av) / bv);
          else if (bv < 0) k = Math.min(k, (-limit - av) / bv);
        }
      }
    }
    return Math.max(0, k);
  };
  let cx = rect.x + rect.width / 2;
  let cy = rect.y + rect.height / 2;
  let k = scaleAt(cx, cy);
  if (k < 0.25) {
    cx = centre.x;
    cy = centre.y;
    k = scaleAt(cx, cy);
  }
  const width = rect.width * k;
  const height = rect.height * k;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** The largest crop of `aspect` (width over height) centred in the image, fitted to the straighten angle. Without an
 *  aspect, the whole image. */
export function aspectCrop(size: Size, aspect: number | null, degrees: number): Rect {
  let width = size.width;
  let height = size.height;
  if (aspect) {
    height = width / aspect;
    if (height > size.height) {
      height = size.height;
      width = height * aspect;
    }
  }
  return fitCrop({ x: (size.width - width) / 2, y: (size.height - height) / 2, width, height }, size, degrees);
}

/** A crop dragged by one of its handles by (dx, dy), kept at least `min` on each side and, with `aspect`, to that
 *  shape: a corner keeps the opposite corner still, a side keeps its own middle. */
export function resizeCrop(start: Rect, handle: Handle, dx: number, dy: number, aspect: number | null, min: number): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = Math.min(left + dx, right - min);
  if (handle.includes("e")) right = Math.max(right + dx, left + min);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - min);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + min);
  if (aspect) {
    let width = right - left;
    let height = bottom - top;
    if (handle.length === 2) {
      // A corner follows whichever side the pointer pulled further, in proportion.
      if (width / height > aspect) height = width / aspect;
      else width = height * aspect;
      if (handle.includes("w")) left = right - width;
      else right = left + width;
      if (handle.includes("n")) top = bottom - height;
      else bottom = top + height;
    } else if (handle === "e" || handle === "w") {
      height = width / aspect;
      const middle = (top + bottom) / 2;
      top = middle - height / 2;
      bottom = middle + height / 2;
    } else {
      width = height * aspect;
      const middle = (left + right) / 2;
      left = middle - width / 2;
      right = middle + width / 2;
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** As far from `from` towards `to` as a crop can go and still fit, so a drag stops at the image's edge instead of
 *  leaving it. */
export function towards(from: Rect, to: Rect, size: Size, degrees: number): Rect {
  if (cropFits(to, size, degrees)) return to;
  if (!cropFits(from, size, degrees)) return fitCrop(to, size, degrees);
  const at = (t: number): Rect => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t,
  });
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (cropFits(at(mid), size, degrees)) low = mid;
    else high = mid;
  }
  return at(low);
}

/** A point of a `size` image after a quarter turn counter-clockwise; the image becomes height by width. */
export const turnPoint = (point: Point, size: Size): Point => ({ x: point.y, y: size.width - point.x });

export function turnRect(rect: Rect, size: Size): Rect {
  return { x: rect.y, y: size.width - rect.x - rect.width, width: rect.height, height: rect.width };
}

/** A point of a `size` image mirrored left to right, or top to bottom. */
export const flipPoint = (point: Point, size: Size, axis: "x" | "y"): Point =>
  axis === "x" ? { x: size.width - point.x, y: point.y } : { x: point.x, y: size.height - point.y };

export function flipRect(rect: Rect, size: Size, axis: "x" | "y"): Rect {
  return axis === "x"
    ? { ...rect, x: size.width - rect.x - rect.width }
    : { ...rect, y: size.height - rect.y - rect.height };
}

/** The rectangle two points span, whichever way they were dragged. */
export function spanRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Distance from `point` to the segment from `a` to `b`. */
export function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The size that fits `content` inside `box`, scaled down but never up past `maxScale`. */
export function fitScale(content: Size, box: Size, maxScale = Infinity): number {
  return Math.min(box.width / content.width, box.height / content.height, maxScale);
}
