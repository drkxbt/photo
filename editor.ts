import { LOOKS, NEUTRAL, adjustPixels, isNeutral, pixelate, type Adjustments } from "./adjust.js";
import {
  FLIP_X,
  FLIP_Y,
  TURN_LEFT,
  UPRIGHT,
  aspectCrop,
  compose,
  fitCrop,
  fitScale,
  flipPoint,
  flipRect,
  orientedSize,
  resizeCrop,
  segmentDistance,
  spanRect,
  towards,
  turnPoint,
  turnRect,
  type Handle,
  type Orientation,
  type Point,
  type Rect,
  type Size,
} from "./geometry.js";
import { History } from "./history.js";

export type ShapeKind = "pen" | "arrow" | "rect" | "ellipse" | "text" | "redact";

/** A mark on the picture, in the turned image's pixels. Lines and boxes have two points, start and end; a pen has
 *  many; text has one, its top-left corner. */
export interface Shape {
  id: number;
  kind: ShapeKind;
  points: Point[];
  color: string;
  width: number;
  text?: string;
}

/** Everything about an edit, all plain data: it can be saved, restored and undone. */
export interface EditState {
  orientation: Orientation;
  /** Straighten, in degrees, from -45 to 45. */
  angle: number;
  /** In the turned image's pixels. */
  crop: Rect;
  adjust: Adjustments;
  look: string;
  shapes: Shape[];
}

export type Tool = "crop" | "adjust" | "looks" | "draw";
export type ImageSource = string | Blob | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface Labels {
  editor: string;
  cancel: string;
  done: string;
  undo: string;
  redo: string;
  compare: string;
  tools: Record<Tool, string>;
  aspects: (aspect: number | null | "original") => string;
  turn: string;
  flipX: string;
  flipY: string;
  straighten: string;
  reset: string;
  adjust: Record<keyof Adjustments, string>;
  marks: Record<ShapeKind | "move", string>;
  color: (color: string) => string;
  width: (index: number) => string;
  remove: string;
  text: string;
}

export interface PhotoOptions {
  src: ImageSource;
  /** The tools offered, in order. */
  tools?: Tool[];
  /** Crop shapes offered: width over height, "original" for the picture's own, or null for free. */
  aspects?: Array<number | null | "original">;
  /** The stroke colours offered for marks. */
  colors?: string[];
  output?: { type?: string; quality?: number; maxSize?: number };
  /** An edit to start from, as `state` returned it. */
  state?: EditState;
  labels?: Partial<Labels>;
  onDone?: (blob: Blob, state: EditState) => void;
  onCancel?: () => void;
  onChange?: (state: EditState) => void;
}

export interface PhotoEditor {
  readonly element: HTMLElement;
  readonly state: EditState;
  setState(state: EditState): void;
  setTool(tool: Tool): void;
  undo(): void;
  redo(): void;
  /** The edited picture, at full size unless `output.maxSize` says otherwise. */
  export(): Promise<Blob>;
  load(src: ImageSource): Promise<void>;
  destroy(): void;
}

const ASPECT_NAMES: Record<string, string> = { null: "Free", original: "Original", "1": "Square", "0.8": "4:5", [String(16 / 9)]: "16:9", [String(9 / 16)]: "9:16", [String(3 / 2)]: "3:2" };

const DEFAULT_LABELS: Labels = {
  editor: "Photo editor",
  cancel: "Cancel",
  done: "Done",
  undo: "Undo",
  redo: "Redo",
  compare: "Hold to see the original",
  tools: { crop: "Crop and turn", adjust: "Adjust", looks: "Looks", draw: "Draw" },
  aspects: (aspect) => `Crop: ${ASPECT_NAMES[String(aspect)] ?? `${Math.round(Number(aspect) * 100) / 100}:1`}`,
  turn: "Turn left",
  flipX: "Flip left to right",
  flipY: "Flip top to bottom",
  straighten: "Straighten",
  reset: "Reset crop and turn",
  adjust: { brightness: "Brightness", contrast: "Contrast", saturation: "Saturation", warmth: "Warmth" },
  marks: { move: "Select and move", pen: "Pen", arrow: "Arrow", rect: "Box", ellipse: "Ellipse", text: "Text", redact: "Hide with blocks" },
  color: (color) => `Colour ${color}`,
  width: (index) => ["Thin", "Medium", "Thick"][index] ?? `Width ${index + 1}`,
  remove: "Delete the selected mark",
  text: "Text",
};
const COLORS = ["#ffffff", "#121212", "#2ff0b8", "#f0bf2f", "#ff5a4e"];
const ICONS: Record<string, string> = {
  close: '<path d="M6.5 6.5l11 11m0-11-11 11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  compare: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 4v16"/><path class="fill" d="M12 4h5a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-5Z"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  adjust: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  looks: '<circle cx="12" cy="9" r="4.5"/><circle cx="9" cy="14.5" r="4.5"/><circle cx="15" cy="14.5" r="4.5"/>',
  draw: '<path d="m5 19 3.5-.8L19 7.7a2 2 0 0 0-2.8-2.8L5.8 15.5Z"/><path d="m14.5 6.6 2.9 2.9"/>',
  move: '<path d="M6 4l12 6.5-5.2 1.5-1.5 5.3Z"/>',
  pen: '<path d="M4 16c3-5 5-7 7-7s1.5 6 4 6 3-3 5-6"/>',
  arrow: '<path d="M5 19 19 5M10.5 5H19v8.5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  redact: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  turn: '<path d="M4 4v5h5"/><path d="M4.6 9A8 8 0 1 1 6 16.6"/>',
  flipX: '<path d="M12 3v18"/><path d="M9 7 4 17h5Z"/><path class="fill" d="m15 7 5 10h-5Z"/>',
  flipY: '<path d="M3 12h18"/><path d="M7 9 17 4v5Z"/><path class="fill" d="m7 15 10 5v-5Z"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4.5H8"/><path d="M12 8v4l2.5 2"/>',
  brightness: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  contrast: '<circle cx="12" cy="12" r="8"/><path class="fill" d="M12 4a8 8 0 0 1 0 16Z"/>',
  saturation: '<path d="M12 3.5c3 4 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.5 6-10.5Z"/>',
  warmth: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>',
  free: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  original: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="m7 15 3.5-3.5 3 3 2-2 2 2"/>',
};

const RADIANS = Math.PI / 180;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function icon(markup: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = markup;
  return svg;
}

/** A button with an icon only; its name is for screen readers and the tooltip. */
function iconButton(className: string, label: string, markup: string): HTMLButtonElement {
  const button = element("button", `ph-btn ${className}`);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(markup));
  return button;
}

/** An icon for a crop shape: a rectangle of that shape, as large as fits. */
function aspectIcon(aspect: number): string {
  const width = aspect >= 1 ? 16 : 16 * aspect;
  const height = aspect >= 1 ? 16 / aspect : 16;
  return `<rect x="${12 - width / 2}" y="${12 - height / 2}" width="${width}" height="${height}" rx="1.5"/>`;
}

async function loadSource(src: ImageSource): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof src === "string") {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.src = src;
    await image.decode();
    return image;
  }
  if (src instanceof Blob) return createImageBitmap(src);
  if (src instanceof HTMLImageElement) {
    if (!src.complete) await src.decode();
    return src;
  }
  return src;
}

const sizeOf = (source: { width: number; height: number } & Partial<{ naturalWidth: number; naturalHeight: number }>): Size => ({
  width: source.naturalWidth || source.width,
  height: source.naturalHeight || source.height,
});

/** Draws the source the way up `state` has it, straightened, into the turned image's coordinates. */
function paintSource(ctx: CanvasRenderingContext2D, source: CanvasImageSource, size: Size, state: EditState) {
  const turned = orientedSize(size, state.orientation);
  const [a, b, c, d] = state.orientation;
  ctx.save();
  ctx.translate(turned.width / 2, turned.height / 2);
  ctx.rotate(state.angle * RADIANS);
  ctx.transform(a, c, b, d, 0, 0);
  ctx.drawImage(source, -size.width / 2, -size.height / 2, size.width, size.height);
  ctx.restore();
}

function textFont(shape: Shape) {
  return `650 ${shape.width}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

/** Draws one mark, in the turned image's coordinates. Hiding marks are handled on the pixels, not here. */
function paintShape(ctx: CanvasRenderingContext2D, shape: Shape) {
  const [start, end = start] = shape.points;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = ctx.lineJoin = "round";
  if (shape.kind === "pen") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    // Through the midpoints, so a quick stroke comes out smooth instead of as straight segments.
    for (let i = 1; i < shape.points.length - 1; i++) {
      const p = shape.points[i];
      const q = shape.points[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    const last = shape.points[shape.points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  } else if (shape.kind === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(shape.width * 3.2, 12);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.moveTo(end.x - head * Math.cos(angle - 0.5), end.y - head * Math.sin(angle - 0.5));
    ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle + 0.5), end.y - head * Math.sin(angle + 0.5));
    ctx.stroke();
  } else if (shape.kind === "rect") {
    const box = spanRect(start, end);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
  } else if (shape.kind === "ellipse") {
    const box = spanRect(start, end);
    ctx.beginPath();
    ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.kind === "text" && shape.text) {
    ctx.font = textFont(shape);
    ctx.textBaseline = "top";
    // A soft dark edge keeps light text readable on a light picture, and the other way round.
    ctx.shadowColor = shape.color === "#121212" ? "rgb(255 255 255 / 0.5)" : "rgb(0 0 0 / 0.45)";
    ctx.shadowBlur = shape.width * 0.25;
    ctx.fillText(shape.text, start.x, start.y);
  }
  ctx.restore();
}

/** The box a mark takes up, for selecting it and showing it selected. */
function shapeBox(shape: Shape, measure: CanvasRenderingContext2D): Rect {
  if (shape.kind === "text") {
    measure.font = textFont(shape);
    const width = measure.measureText(shape.text ?? "").width;
    return { x: shape.points[0].x, y: shape.points[0].y, width, height: shape.width * 1.2 };
  }
  const xs = shape.points.map((p) => p.x);
  const ys = shape.points.map((p) => p.y);
  const pad = shape.kind === "redact" ? 0 : shape.width / 2;
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, width: Math.max(...xs) - Math.min(...xs) + pad * 2, height: Math.max(...ys) - Math.min(...ys) + pad * 2 };
}

function hitShape(shape: Shape, point: Point, slop: number, measure: CanvasRenderingContext2D): boolean {
  if (shape.kind === "pen" || shape.kind === "arrow") {
    const points = shape.kind === "arrow" ? shape.points.slice(0, 2) : shape.points;
    for (let i = 0; i < points.length - 1; i++) if (segmentDistance(point, points[i], points[i + 1]) <= shape.width / 2 + slop) return true;
    return points.length === 1 && Math.hypot(point.x - points[0].x, point.y - points[0].y) <= shape.width + slop;
  }
  const box = shapeBox(shape, measure);
  return point.x >= box.x - slop && point.x <= box.x + box.width + slop && point.y >= box.y - slop && point.y <= box.y + box.height + slop;
}

/** Hiding marks turn the pixels under them into blocks. `toPixels` maps the turned image to the canvas's pixels. */
function hidePixels(data: ImageData, shapes: Shape[], toPixels: (rect: Rect) => Rect) {
  for (const shape of shapes) {
    if (shape.kind !== "redact" || shape.points.length < 2) continue;
    const area = toPixels(spanRect(shape.points[0], shape.points[1]));
    pixelate(data.data, data.width, data.height, area, Math.max(6, Math.min(area.width, area.height) / 8));
  }
}

/** The starting edit for a picture: upright, uncropped, unadjusted. */
export function initialState(size: Size): EditState {
  return { orientation: UPRIGHT, angle: 0, crop: { x: 0, y: 0, width: size.width, height: size.height }, adjust: { ...NEUTRAL }, look: "none", shapes: [] };
}

/** Renders `state` of `source` at full size, or scaled down to `maxSize` on its longer side, to a canvas. */
export function renderEdit(source: CanvasImageSource, size: Size, state: EditState, maxSize = Infinity): HTMLCanvasElement {
  const { crop } = state;
  const scale = Math.min(1, maxSize / Math.max(crop.width, crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(scale, 0, 0, scale, -crop.x * scale, -crop.y * scale);
  paintSource(ctx, source, size, state);
  const look = LOOKS.find((item) => item.id === state.look);
  const redacts = state.shapes.some((shape) => shape.kind === "redact");
  if (!isNeutral(state.adjust, look) || redacts) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    adjustPixels(pixels.data, state.adjust, look);
    hidePixels(pixels, state.shapes, (rect) => ({ x: (rect.x - crop.x) * scale, y: (rect.y - crop.y) * scale, width: rect.width * scale, height: rect.height * scale }));
    ctx.putImageData(pixels, 0, 0);
  }
  for (const shape of state.shapes) if (shape.kind !== "redact") paintShape(ctx, shape);
  return canvas;
}

/**
 * A photo editor in `container`: crop with a free or fixed shape, turn, flip and straighten; adjust brightness,
 * contrast, saturation and warmth; pick a look; draw, point, box, write and hide parts of the picture. Every change can
 * be undone, and Done hands back the finished file.
 */
export function photoEditor(container: HTMLElement, options: PhotoOptions): PhotoEditor {
  const labels: Labels = { ...DEFAULT_LABELS, ...options.labels } as Labels;
  const tools = options.tools?.length ? options.tools : (["crop", "adjust", "looks", "draw"] as Tool[]);
  const aspects = options.aspects ?? [null, "original", 1, 4 / 5, 16 / 9];
  const colors = options.colors ?? COLORS;

  // The editor
  const root = element("div", "ph");
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", labels.editor);
  root.tabIndex = -1;
  const top = element("div", "ph-top");
  const cancel = iconButton("ph-cancel", labels.cancel, ICONS.close);
  const undoButton = iconButton("ph-undo", labels.undo, ICONS.undo);
  const redoButton = iconButton("ph-redo", labels.redo, ICONS.redo);
  const compare = iconButton("ph-compare", labels.compare, ICONS.compare);
  const done = iconButton("ph-done", labels.done, ICONS.check);
  const history = element("div", "ph-history");
  history.append(undoButton, redoButton, compare);
  top.append(cancel, history, done);
  const stage = element("div", "ph-stage");
  const canvas = element("canvas", "ph-canvas");
  const textInput = element("input", "ph-text-input");
  textInput.type = "text";
  textInput.hidden = true;
  textInput.setAttribute("aria-label", labels.text);
  stage.append(canvas, textInput);
  const panel = element("div", "ph-panel");
  const tabs = element("div", "ph-tools");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", labels.editor);
  root.append(top, stage, panel, tabs);
  container.append(root);

  // State
  let source: CanvasImageSource | null = null;
  let preview: HTMLCanvasElement | null = null;
  let size: Size = { width: 1, height: 1 };
  let history_ = new History<EditState>(options.state ?? initialState(size));
  let tool: Tool = tools[0];
  let aspect: number | null | "original" = null;
  let mark: ShapeKind | "move" = "pen";
  let color = colors[2] ?? colors[0];
  let widthIndex = 1;
  let selected: number | null = null;
  let comparing = false;
  let nextId = 1;
  const state = () => history_.state;
  const turned = () => orientedSize(size, state().orientation);

  function commit(next: EditState, merge?: string) {
    history_.push(next, merge);
    // The crop as it was before any straightening, so straightening back to level gives it back in full.
    if (next.angle === 0) unrotated = next.crop;
    changed();
  }
  function changed() {
    undoButton.disabled = !history_.canUndo;
    redoButton.disabled = !history_.canRedo;
    if (selected !== null && !state().shapes.some((shape) => shape.id === selected)) selected = null;
    syncPanel();
    schedule();
    options.onChange?.(state());
  }

  /* The view. In the crop tool the whole turned image shows, with the crop marked on it; in the others, the crop
     alone. `view` maps the turned image to the stage in CSS pixels. */
  let view = { scale: 1, x: 0, y: 0 };
  let stageSize: Size = { width: 1, height: 1 };
  const measureCtx = document.createElement("canvas").getContext("2d")!;
  let base: { key: string; canvas: HTMLCanvasElement } | null = null;

  function layout() {
    const box = stage.getBoundingClientRect();
    stageSize = { width: Math.max(1, box.width), height: Math.max(1, box.height) };
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stageSize.width * dpr);
    canvas.height = Math.round(stageSize.height * dpr);
    canvas.style.width = `${stageSize.width}px`;
    canvas.style.height = `${stageSize.height}px`;
  }

  function computeView() {
    const area = tool === "crop" ? { x: 0, y: 0, ...turned() } : state().crop;
    // Room around the picture for the crop handles to be grabbed.
    const pad = tool === "crop" ? 28 : 16;
    const scale = fitScale(area, { width: stageSize.width - pad * 2, height: stageSize.height - pad * 2 });
    view = {
      scale,
      x: (stageSize.width - area.width * scale) / 2 - area.x * scale,
      y: (stageSize.height - area.height * scale) / 2 - area.y * scale,
    };
  }

  /** The picture with adjustments and hiding marks, at the stage's resolution, kept until something it shows changes. */
  function baseCanvas(dpr: number): HTMLCanvasElement {
    const s = state();
    const area = tool === "crop" ? { x: 0, y: 0, ...turned() } : s.crop;
    const plain = comparing;
    const redacts = plain || tool === "crop" ? [] : s.shapes.filter((shape) => shape.kind === "redact");
    const key = JSON.stringify([tool, s.orientation, s.angle, area, plain ? null : [s.adjust, s.look], redacts, view.scale, dpr]);
    if (base?.key === key) return base.canvas;
    const scale = view.scale * dpr;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(area.width * scale));
    out.height = Math.max(1, Math.round(area.height * scale));
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
    paintSource(ctx, preview ?? source!, size, s);
    const look = LOOKS.find((item) => item.id === s.look);
    if (!plain && (!isNeutral(s.adjust, look) || redacts.length)) {
      const pixels = ctx.getImageData(0, 0, out.width, out.height);
      adjustPixels(pixels.data, s.adjust, look);
      hidePixels(pixels, redacts, (rect) => ({ x: (rect.x - area.x) * scale, y: (rect.y - area.y) * scale, width: rect.width * scale, height: rect.height * scale }));
      ctx.putImageData(pixels, 0, 0);
    }
    base = { key, canvas: out };
    return out;
  }

  let frame = 0;
  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function render() {
    frame = 0;
    if (!source) return;
    computeView();
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = state();
    const area = tool === "crop" ? { x: 0, y: 0, ...turned() } : s.crop;
    const picture = baseCanvas(dpr);
    ctx.drawImage(picture, Math.round((view.x + area.x * view.scale) * dpr), Math.round((view.y + area.y * view.scale) * dpr));
    ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr);
    if (tool === "crop") paintCropFrame(ctx, s.crop, dpr);
    else if (!comparing) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.crop.x, s.crop.y, s.crop.width, s.crop.height);
      ctx.clip();
      for (const shape of s.shapes) if (shape.kind !== "redact") paintShape(ctx, shape);
      for (const shape of draft ? [draft] : []) {
        if (shape.kind === "redact") {
          const box = spanRect(shape.points[0], shape.points[1] ?? shape.points[0]);
          ctx.fillStyle = "rgb(18 18 18 / 0.35)";
          ctx.fillRect(box.x, box.y, box.width, box.height);
        } else paintShape(ctx, shape);
      }
      const chosen = s.shapes.find((shape) => shape.id === selected);
      if (chosen && tool === "draw") {
        const box = shapeBox(chosen, measureCtx);
        const line = 1.5 / view.scale;
        ctx.setLineDash([5 / view.scale, 4 / view.scale]);
        ctx.lineWidth = line;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeRect(box.x - 4 / view.scale, box.y - 4 / view.scale, box.width + 8 / view.scale, box.height + 8 / view.scale);
      }
      ctx.restore();
    }
  }

  /** The crop on the whole image: the rest dimmed, a thin frame, thirds while dragging, and the corners to grab. */
  function paintCropFrame(ctx: CanvasRenderingContext2D, crop: Rect, dpr: number) {
    const t = turned();
    const px = 1 / view.scale;
    ctx.save();
    ctx.fillStyle = "rgb(10 10 12 / 0.62)";
    ctx.beginPath();
    ctx.rect(-t.width, -t.height, t.width * 3, t.height * 3);
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgb(255 255 255 / 0.9)";
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    if (dragging) {
      ctx.strokeStyle = "rgb(255 255 255 / 0.45)";
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const f of [1 / 3, 2 / 3]) {
        ctx.moveTo(crop.x + crop.width * f, crop.y);
        ctx.lineTo(crop.x + crop.width * f, crop.y + crop.height);
        ctx.moveTo(crop.x, crop.y + crop.height * f);
        ctx.lineTo(crop.x + crop.width, crop.y + crop.height * f);
      }
      ctx.stroke();
    }
    // Corner brackets, thick enough to read as handles.
    const arm = Math.min(22 * px, crop.width / 3, crop.height / 3);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3.5 * px;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[crop.x, crop.y, 1, 1], [crop.x + crop.width, crop.y, -1, 1], [crop.x + crop.width, crop.y + crop.height, -1, -1], [crop.x, crop.y + crop.height, 1, -1]]) {
      ctx.moveTo(x + sx * arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * arm);
    }
    ctx.stroke();
    ctx.restore();
    void dpr;
  }

  /* Pointer: in the crop tool, the crop's corners and sides resize it and its inside moves it; in draw, marks are made
     or, with the move tool, picked up and moved. */
  let dragging: null | { kind: "move" | Handle; start: Rect; from: Point; id: number } = null;
  let draft: Shape | null = null;
  let moving: null | { id: number; from: Point; points: Point[] } = null;
  let gestureId = 0;

  const toImage = (event: PointerEvent): Point => {
    const box = stage.getBoundingClientRect();
    return { x: (event.clientX - box.left - view.x) / view.scale, y: (event.clientY - box.top - view.y) / view.scale };
  };

  function handleAt(point: Point): Handle | "move" | null {
    const crop = state().crop;
    const reach = 22 / view.scale;
    const xs = { w: crop.x, e: crop.x + crop.width, mid: crop.x + crop.width / 2 };
    const ys = { n: crop.y, s: crop.y + crop.height, mid: crop.y + crop.height / 2 };
    for (const handle of HANDLES) {
      const hx = handle.includes("w") ? xs.w : handle.includes("e") ? xs.e : xs.mid;
      const hy = handle.includes("n") ? ys.n : handle.includes("s") ? ys.s : ys.mid;
      // Sides can be grabbed anywhere along them, corners near the corner.
      const nearX = handle.length === 1 && (handle === "n" || handle === "s") ? point.x > crop.x + reach && point.x < crop.x + crop.width - reach : Math.abs(point.x - hx) <= reach;
      const nearY = handle.length === 1 && (handle === "e" || handle === "w") ? point.y > crop.y + reach && point.y < crop.y + crop.height - reach : Math.abs(point.y - hy) <= reach;
      if (nearX && nearY) return handle;
    }
    if (point.x > crop.x && point.x < crop.x + crop.width && point.y > crop.y && point.y < crop.y + crop.height) return "move";
    return null;
  }

  const cursors: Record<string, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", move: "move" };

  const aspectValue = () => (aspect === "original" ? turned().width / turned().height : aspect);
  const strokeWidth = () => {
    const unit = Math.max(state().crop.width, state().crop.height) / 1000;
    return [3, 6, 11][widthIndex] * unit;
  };
  const textSize = () => {
    const unit = Math.max(state().crop.width, state().crop.height) / 1000;
    return [48, 76, 110][widthIndex] * unit;
  };

  function onPointerDown(event: PointerEvent) {
    if (!source || event.button > 0 || comparing) return;
    if (event.target === textInput) return;
    const point = toImage(event);
    if (tool === "crop") {
      const hit = handleAt(point);
      if (!hit) return;
      dragging = { kind: hit, start: { ...state().crop }, from: point, id: ++gestureId };
    } else if (tool === "draw") {
      if (!textInput.hidden) {
        finishText();
        return;
      }
      const s = state();
      const slop = 10 / view.scale;
      if (mark === "move") {
        const hit = [...s.shapes].reverse().find((shape) => hitShape(shape, point, slop, measureCtx));
        selected = hit?.id ?? null;
        syncPanel();
        if (hit) moving = { id: hit.id, from: point, points: hit.points.map((p) => ({ ...p })) };
        schedule();
        if (!hit) return;
      } else if (mark === "text") {
        startText(point);
        event.preventDefault();
        return;
      } else {
        draft = { id: nextId++, kind: mark, points: mark === "pen" ? [point] : [point, point], color, width: mark === "redact" ? 0 : strokeWidth() };
      }
    } else return;
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks cannot be captured; the drag still works without it.
    }
    event.preventDefault();
    schedule();
  }

  function onPointerMove(event: PointerEvent) {
    const point = toImage(event);
    if (tool === "crop" && !dragging) {
      const hit = source ? handleAt(point) : null;
      stage.style.cursor = hit ? cursors[hit] : "";
      return;
    }
    if (dragging) {
      const s = state();
      const dx = point.x - dragging.from.x;
      const dy = point.y - dragging.from.y;
      const t = turned();
      let next: Rect;
      if (dragging.kind === "move") {
        // Across, then down, so a crop pushed into an edge slides along it.
        const across = towards(s.crop, { ...s.crop, x: dragging.start.x + dx }, t, s.angle);
        next = towards(across, { ...across, y: dragging.start.y + dy }, t, s.angle);
      } else {
        const min = Math.max(24 / view.scale, 8);
        next = towards(s.crop, resizeCrop(dragging.start, dragging.kind, dx, dy, aspectValue(), min), t, s.angle);
      }
      commit({ ...s, crop: next }, `crop-${dragging.id}`);
      if (s.angle !== 0) unrotated = null;
      return;
    }
    if (moving) {
      const s = state();
      const dx = point.x - moving.from.x;
      const dy = point.y - moving.from.y;
      const shapes = s.shapes.map((shape) => (shape.id === moving!.id ? { ...shape, points: moving!.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : shape));
      commit({ ...s, shapes }, `move-${moving.id}-${gestureId}`);
      return;
    }
    if (draft) {
      if (draft.kind === "pen") {
        const last = draft.points[draft.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) * view.scale >= 2) draft.points.push(point);
      } else draft.points[1] = point;
      schedule();
    }
  }

  function onPointerUp() {
    if (dragging) {
      dragging = null;
      history_.seal();
      schedule();
    }
    if (moving) {
      moving = null;
      gestureId++;
      history_.seal();
    }
    if (draft) {
      const shape = draft;
      draft = null;
      const box = spanRect(shape.points[0], shape.points[shape.points.length - 1]);
      // A tap without a drag is not a mark, except a pen dot.
      const tiny = shape.kind !== "pen" && box.width * view.scale < 4 && box.height * view.scale < 4;
      if (!tiny) commit({ ...state(), shapes: [...state().shapes, shape] });
      else schedule();
    }
  }

  /* Text: a field over the picture where it was tapped, committed on Enter or when focus leaves. */
  let textAt: Point | null = null;
  function startText(point: Point) {
    textAt = point;
    const size = textSize();
    textInput.value = "";
    textInput.hidden = false;
    textInput.style.left = `${view.x + point.x * view.scale}px`;
    textInput.style.top = `${view.y + point.y * view.scale}px`;
    textInput.style.fontSize = `${Math.max(14, size * view.scale)}px`;
    textInput.style.color = color;
    textInput.focus({ preventScroll: true });
  }
  function finishText(keep = true) {
    if (textInput.hidden) return;
    const text = textInput.value.trim();
    textInput.hidden = true;
    if (keep && text && textAt) {
      commit({ ...state(), shapes: [...state().shapes, { id: nextId++, kind: "text", points: [textAt], color, width: textSize(), text }] });
    }
    textAt = null;
    root.focus({ preventScroll: true });
  }
  textInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishText();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishText(false);
    }
  });
  textInput.addEventListener("blur", () => finishText());

  /* Crop and turn actions. A turn or a flip carries the crop and every mark with the picture. */
  function reorient(op: Orientation) {
    const s = state();
    const t = turned();
    const turn = op === TURN_LEFT;
    const axis = op === FLIP_X ? "x" : "y";
    const point = (p: Point) => (turn ? turnPoint(p, t) : flipPoint(p, t, axis));
    const rect = (r: Rect) => (turn ? turnRect(r, t) : flipRect(r, t, axis));
    const shapes = s.shapes.map((shape) => {
      if (shape.kind !== "text") return { ...shape, points: shape.points.map(point) };
      // Text keeps reading the right way: its corner moves, its letters do not turn.
      const box = shapeBox(shape, measureCtx);
      const moved = rect(box);
      return { ...shape, points: [{ x: moved.x, y: moved.y }] };
    });
    const angle = turn ? s.angle : -s.angle;
    const orientation = compose(op, s.orientation);
    const nextSize = orientedSize(size, orientation);
    commit({ ...s, orientation, angle, crop: fitCrop(rect(s.crop), nextSize, angle), shapes });
  }

  /** The crop at level, kept while straightening; a crop moved by hand while tilted becomes the new starting point. */
  let unrotated: Rect | null = null;
  function straighten(degrees: number, merge?: string) {
    const s = state();
    // The crop keeps its middle and shape and shrinks as far as it must to stay on the picture.
    const crop = fitCrop(unrotated ?? s.crop, turned(), degrees);
    history_.push({ ...s, angle: degrees, crop }, merge);
    changed();
  }

  function setAspect(next: number | null | "original") {
    aspect = next;
    const s = state();
    commit({ ...s, crop: aspectCrop(turned(), aspectValue(), s.angle) });
  }

  function resetCrop() {
    aspect = null;
    const s = state();
    const from = turned();
    const [a, b, c, d] = s.orientation;
    // Marks go back with the picture: the orientation's transpose undoes it, about each image's centre.
    const upright = (p: Point): Point => {
      const u = p.x - from.width / 2;
      const v = p.y - from.height / 2;
      return { x: a * u + c * v + size.width / 2, y: b * u + d * v + size.height / 2 };
    };
    const shapes = s.shapes.map((shape) => {
      if (shape.kind !== "text") return { ...shape, points: shape.points.map(upright) };
      const box = shapeBox(shape, measureCtx);
      const ends = [upright({ x: box.x, y: box.y }), upright({ x: box.x + box.width, y: box.y + box.height })];
      return { ...shape, points: [{ x: Math.min(ends[0].x, ends[1].x), y: Math.min(ends[0].y, ends[1].y) }] };
    });
    commit({ ...s, orientation: UPRIGHT, angle: 0, crop: { x: 0, y: 0, ...size }, shapes });
  }

  /* Panels: each tool's controls, buttons with icons only. */
  const tabButtons = new Map<Tool, HTMLButtonElement>();
  for (const name of tools) {
    const button = iconButton("ph-tool", labels.tools[name], ICONS[name]);
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => setTool(name));
    tabButtons.set(name, button);
    tabs.append(button);
  }
  tabs.addEventListener("keydown", (event) => {
    const order = [...tabButtons.values()];
    const at = order.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (at < 0 || !step) return;
    event.preventDefault();
    const next = order[(at + step + order.length) % order.length];
    next.focus();
    next.click();
  });

  let syncers: Array<() => void> = [];
  function syncPanel() {
    for (const sync of syncers) sync();
  }

  function buildPanel() {
    panel.replaceChildren();
    syncers = [];
    panel.dataset.tool = tool;
    if (tool === "crop") buildCrop();
    else if (tool === "adjust") buildAdjust();
    else if (tool === "looks") buildLooks();
    else buildDraw();
    syncPanel();
  }

  function group(className = "") {
    const row = element("div", `ph-group ${className}`.trim());
    panel.append(row);
    return row;
  }

  function slider(label: string, markup: string, min: number, max: number, read: () => number, write: (value: number, done: boolean) => void, unit = "") {
    const row = element("label", "ph-slider");
    row.append(icon(markup));
    const input = element("input", "ph-range");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.setAttribute("aria-label", label);
    input.title = label;
    const value = element("output", "ph-value");
    row.append(input, value);
    input.addEventListener("input", () => write(Number(input.value), false));
    input.addEventListener("change", () => write(Number(input.value), true));
    // A double click puts it back to neutral.
    input.addEventListener("dblclick", () => write(0, true));
    syncers.push(() => {
      const v = read();
      if (document.activeElement !== input || Number(input.value) !== v) input.value = String(v);
      value.textContent = `${v > 0 ? "+" : ""}${v}${unit}`;
      input.setAttribute("aria-valuetext", `${v}${unit}`);
      input.style.setProperty("--fill", `${((v - min) / (max - min)) * 100}%`);
    });
    return row;
  }

  function buildCrop() {
    const shapes = group("ph-aspects");
    for (const option of aspects) {
      const markup = option === null ? ICONS.free : option === "original" ? ICONS.original : aspectIcon(option);
      const button = iconButton("ph-chip", labels.aspects(option), markup);
      button.addEventListener("click", () => setAspect(option));
      syncers.push(() => button.setAttribute("aria-pressed", String(aspect === option)));
      shapes.append(button);
    }
    const actions = group();
    const turn = iconButton("ph-chip", labels.turn, ICONS.turn);
    turn.addEventListener("click", () => reorient(TURN_LEFT));
    const flipX = iconButton("ph-chip", labels.flipX, ICONS.flipX);
    flipX.addEventListener("click", () => reorient(FLIP_X));
    const flipY = iconButton("ph-chip", labels.flipY, ICONS.flipY);
    flipY.addEventListener("click", () => reorient(FLIP_Y));
    const reset = iconButton("ph-chip", labels.reset, ICONS.reset);
    reset.addEventListener("click", resetCrop);
    actions.append(turn, flipX, flipY, reset);
    const straight = slider(labels.straighten, '<path d="M3 17h18M6 17a6 6 0 0 1 12 0"/><path d="m12 17 4-7"/>', -45, 45, () => Math.round(state().angle), (value, end) => {
      straighten(value, "straighten");
      if (end) history_.seal();
    }, "°");
    group("ph-wide").append(straight);
  }

  function buildAdjust() {
    const rows = group("ph-sliders");
    for (const key of ["brightness", "contrast", "saturation", "warmth"] as const) {
      rows.append(
        slider(labels.adjust[key], ICONS[key], -100, 100, () => state().adjust[key], (value, end) => {
          commit({ ...state(), adjust: { ...state().adjust, [key]: value } }, `adjust-${key}`);
          if (end) history_.seal();
        }),
      );
    }
  }

  /** Small previews of each look on the current crop, made once per crop and adjustment. */
  let thumbsKey = "";
  const thumbCanvases = new Map<string, HTMLCanvasElement>();
  function buildLooks() {
    const row = group("ph-looks");
    for (const look of LOOKS) {
      const button = element("button", "ph-look");
      button.type = "button";
      button.setAttribute("aria-label", look.label);
      button.title = look.label;
      const thumb = element("canvas", "ph-thumb");
      thumbCanvases.set(look.id, thumb);
      button.append(thumb);
      button.addEventListener("click", () => commit({ ...state(), look: look.id }));
      syncers.push(() => button.setAttribute("aria-pressed", String(state().look === look.id)));
      row.append(button);
    }
    thumbsKey = "";
    syncers.push(drawThumbs);
  }
  function drawThumbs() {
    if (!source) return;
    const s = state();
    const key = JSON.stringify([s.orientation, s.angle, s.crop, s.adjust]);
    if (key === thumbsKey) return;
    thumbsKey = key;
    const side = 112;
    const scale = side / Math.min(s.crop.width, s.crop.height);
    const plain = document.createElement("canvas");
    plain.width = plain.height = side;
    const ctx = plain.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, -(s.crop.x + (s.crop.width - side / scale) / 2) * scale, -(s.crop.y + (s.crop.height - side / scale) / 2) * scale);
    paintSource(ctx, preview ?? source, size, s);
    const pixels = ctx.getImageData(0, 0, side, side);
    for (const look of LOOKS) {
      const thumb = thumbCanvases.get(look.id);
      if (!thumb) continue;
      thumb.width = thumb.height = side;
      const copy = new ImageData(new Uint8ClampedArray(pixels.data), side, side);
      adjustPixels(copy.data, s.adjust, look);
      thumb.getContext("2d")!.putImageData(copy, 0, 0);
    }
  }

  function buildDraw() {
    const kinds = group("ph-marks");
    for (const kind of ["move", "pen", "arrow", "rect", "ellipse", "text", "redact"] as const) {
      const button = iconButton("ph-chip", labels.marks[kind], ICONS[kind]);
      button.addEventListener("click", () => {
        mark = kind;
        if (kind !== "move") selected = null;
        syncPanel();
        schedule();
      });
      syncers.push(() => button.setAttribute("aria-pressed", String(mark === kind)));
      kinds.append(button);
    }
    const style = group();
    for (const swatch of colors) {
      const button = element("button", "ph-btn ph-swatch");
      button.type = "button";
      button.setAttribute("aria-label", labels.color(swatch));
      button.title = labels.color(swatch);
      button.style.setProperty("--swatch", swatch);
      button.addEventListener("click", () => {
        color = swatch;
        recolorSelected();
        syncPanel();
      });
      syncers.push(() => button.setAttribute("aria-pressed", String(color === swatch)));
      style.append(button);
    }
    for (let index = 0; index < 3; index++) {
      const button = iconButton("ph-chip", labels.width(index), `<circle class="fill" cx="12" cy="12" r="${[2, 3.5, 5.5][index]}"/>`);
      button.addEventListener("click", () => {
        widthIndex = index;
        syncPanel();
      });
      syncers.push(() => button.setAttribute("aria-pressed", String(widthIndex === index)));
      style.append(button);
    }
    const remove = iconButton("ph-chip", labels.remove, ICONS.trash);
    remove.addEventListener("click", removeSelected);
    syncers.push(() => (remove.disabled = selected === null));
    style.append(remove);
  }

  function recolorSelected() {
    if (selected === null) return;
    commit({ ...state(), shapes: state().shapes.map((shape) => (shape.id === selected && shape.kind !== "redact" ? { ...shape, color } : shape)) });
  }
  function removeSelected() {
    if (selected === null) return;
    const id = selected;
    selected = null;
    commit({ ...state(), shapes: state().shapes.filter((shape) => shape.id !== id) });
  }

  function setTool(next: Tool) {
    if (!tools.includes(next)) return;
    finishText();
    tool = next;
    selected = null;
    stage.style.cursor = "";
    stage.dataset.tool = next;
    for (const [name, button] of tabButtons) {
      button.setAttribute("aria-selected", String(name === next));
      button.tabIndex = name === next ? 0 : -1;
    }
    buildPanel();
    schedule();
  }

  /* Top bar: history, compare, and the way out. */
  function undo() {
    finishText(false);
    history_.undo();
    changed();
  }
  function redo() {
    finishText(false);
    history_.redo();
    changed();
  }
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);
  const showOriginal = (on: boolean) => {
    if (comparing === on) return;
    comparing = on;
    compare.setAttribute("aria-pressed", String(on));
    schedule();
  };
  compare.addEventListener("pointerdown", () => showOriginal(true));
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) compare.addEventListener(type, () => showOriginal(false));
  compare.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") showOriginal(true);
  });
  compare.addEventListener("keyup", () => showOriginal(false));

  async function exportBlob(): Promise<Blob> {
    if (!source) throw new Error("No picture loaded");
    const out = renderEdit(source, size, state(), options.output?.maxSize);
    return new Promise((resolve, reject) =>
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be encoded"))), options.output?.type ?? "image/png", options.output?.quality ?? 0.92),
    );
  }
  done.addEventListener("click", async () => {
    finishText();
    done.disabled = true;
    try {
      options.onDone?.(await exportBlob(), state());
    } finally {
      done.disabled = false;
    }
  });
  cancel.addEventListener("click", () => options.onCancel?.());

  function onKey(event: KeyboardEvent) {
    if (event.target === textInput) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if ((event.key === "Delete" || event.key === "Backspace") && selected !== null && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      removeSelected();
    } else if (event.key === "Escape" && selected !== null) {
      event.stopPropagation();
      selected = null;
      syncPanel();
      schedule();
    }
  }

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("keydown", onKey);
  const resize = new ResizeObserver(() => {
    layout();
    base = null;
    schedule();
  });
  resize.observe(stage);

  async function load(src: ImageSource) {
    const loaded = await loadSource(src);
    source = loaded;
    size = sizeOf(loaded as HTMLImageElement);
    // A smaller copy for the preview, so dragging a slider over a large photo stays quick.
    const longest = Math.max(size.width, size.height);
    if (longest > 1600) {
      const scale = 1600 / longest;
      preview = document.createElement("canvas");
      preview.width = Math.round(size.width * scale);
      preview.height = Math.round(size.height * scale);
      const ctx = preview.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(loaded, 0, 0, preview.width, preview.height);
    } else preview = null;
    const start = options.state && history_.state === options.state ? options.state : initialState(size);
    history_ = new History<EditState>(start);
    // A new picture starts with a free crop and nothing selected.
    aspect = null;
    unrotated = null;
    selected = null;
    nextId = Math.max(0, ...start.shapes.map((shape) => shape.id)) + 1;
    base = null;
    thumbsKey = "";
    changed();
  }

  setTool(tool);
  layout();
  void load(options.src);

  return {
    element: root,
    get state() {
      return state();
    },
    setState(next: EditState) {
      commit(next);
    },
    setTool,
    undo,
    redo,
    export: exportBlob,
    load,
    destroy() {
      resize.disconnect();
      cancelAnimationFrame(frame);
      root.remove();
    },
  };
}

/**
 * Opens the editor over the page, full screen, and resolves with the finished file, or null if it was cancelled.
 * Escape cancels; focus goes back to where it was.
 */
export function editPhoto(src: ImageSource, options: Omit<PhotoOptions, "src" | "onDone" | "onCancel"> = {}): Promise<Blob | null> {
  return new Promise((resolve) => {
    const dialog = element("div", "ph-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", options.labels?.editor ?? DEFAULT_LABELS.editor);
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && !child.inert);
    for (const child of inerted) child.inert = true;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    document.body.append(dialog);
    const finish = (blob: Blob | null) => {
      editor.destroy();
      dialog.remove();
      for (const child of inerted) child.inert = false;
      html.style.overflow = overflow;
      document.removeEventListener("keydown", onEscape);
      returnFocus?.focus({ preventScroll: true });
      resolve(blob);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) finish(null);
    };
    document.addEventListener("keydown", onEscape);
    const editor = photoEditor(dialog, { ...options, src, onDone: (blob) => finish(blob), onCancel: () => finish(null) });
    editor.element.focus({ preventScroll: true });
  });
}
