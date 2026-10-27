/* Colour adjustments and looks, worked on raw RGBA pixels so the preview and the exported file come out the same, in
   every browser. Kept free of the DOM so it can be tested on its own. */

/** Each from -100 to 100; 0 leaves the picture as it is. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

/** A ready-made look: adjustments of its own, added to the user's, and optionally black and white or faded. */
export interface Look {
  id: string;
  label: string;
  adjust: Partial<Adjustments>;
  mono?: boolean;
  /** From 0 to 1: lifts the blacks and softens the whites, like a print left in the sun. */
  fade?: number;
}

export const NEUTRAL: Adjustments = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

export const LOOKS: Look[] = [
  { id: "none", label: "Original", adjust: {} },
  { id: "mono", label: "Mono", adjust: {}, mono: true },
  { id: "noir", label: "Noir", adjust: { contrast: 40, brightness: -6 }, mono: true },
  { id: "warm", label: "Warm", adjust: { warmth: 45, saturation: 10 } },
  { id: "cool", label: "Cool", adjust: { warmth: -45, saturation: -5 } },
  { id: "fade", label: "Fade", adjust: { contrast: -18, saturation: -20 }, fade: 0.6 },
  { id: "punch", label: "Punch", adjust: { contrast: 28, saturation: 35 } },
];

const ADJUSTMENT_KEYS = ["brightness", "contrast", "saturation", "warmth"] as const;

/** The user's adjustments with a look's added on, each kept within -100 to 100. */
export function combine(user: Adjustments, look?: Look): Adjustments {
  const out = { ...NEUTRAL };
  for (const key of ADJUSTMENT_KEYS) out[key] = Math.max(-100, Math.min(100, (user[key] ?? 0) + (look?.adjust[key] ?? 0)));
  return out;
}

export function isNeutral(user: Adjustments, look?: Look): boolean {
  const total = combine(user, look);
  return ADJUSTMENT_KEYS.every((key) => total[key] === 0) && !look?.mono && !look?.fade;
}

/**
 * Applies `user` adjustments and `look` to RGBA pixels in place. Brightness and contrast go through one lookup table,
 * then warmth shifts red against blue, saturation pulls each pixel towards or away from its own grey, and a look can
 * finish in black and white or faded.
 */
export function adjustPixels(data: Uint8ClampedArray, user: Adjustments, look?: Look): void {
  if (isNeutral(user, look)) return;
  const a = combine(user, look);
  const offset = (a.brightness / 100) * 64;
  // The usual contrast curve: a factor about mid-grey, steeper the further from 0.
  const c = (a.contrast / 100) * 128;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const table = new Float32Array(256);
  for (let v = 0; v < 256; v++) table[v] = factor * (v + offset - 128) + 128;
  const warm = (a.warmth / 100) * 28;
  const saturation = 1 + a.saturation / 100;
  const mono = Boolean(look?.mono);
  const fade = look?.fade ?? 0;
  const keep = 1 - 0.2 * fade;
  const lift = 255 * 0.1 * fade;
  for (let i = 0; i < data.length; i += 4) {
    let r = table[data[i]] + warm;
    let g = table[data[i + 1]];
    let b = table[data[i + 2]] - warm;
    const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (mono) {
      r = g = b = grey;
    } else if (saturation !== 1) {
      r = grey + (r - grey) * saturation;
      g = grey + (g - grey) * saturation;
      b = grey + (b - grey) * saturation;
    }
    if (fade) {
      r = r * keep + lift;
      g = g * keep + lift;
      b = b * keep + lift;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** Replaces a region of RGBA pixels (`width` wide) with blocks of their average colour, for hiding what is under it. */
export function pixelate(data: Uint8ClampedArray, width: number, height: number, area: { x: number; y: number; width: number; height: number }, block: number): void {
  const x0 = Math.max(0, Math.floor(area.x));
  const y0 = Math.max(0, Math.floor(area.y));
  const x1 = Math.min(width, Math.ceil(area.x + area.width));
  const y1 = Math.min(height, Math.ceil(area.y + area.height));
  const size = Math.max(2, Math.round(block));
  for (let by = y0; by < y1; by += size) {
    for (let bx = x0; bx < x1; bx += size) {
      const ex = Math.min(bx + size, x1);
      const ey = Math.min(by + size, y1);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * width + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }
      for (let y = by; y < ey; y++) {
        for (let x = bx; x < ex; x++) {
          const i = (y * width + x) * 4;
          data[i] = r / count;
          data[i + 1] = g / count;
          data[i + 2] = b / count;
        }
      }
    }
  }
}
