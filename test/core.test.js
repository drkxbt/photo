import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLIP_X,
  FLIP_Y,
  History,
  LOOKS,
  NEUTRAL,
  TURN_LEFT,
  UPRIGHT,
  adjustPixels,
  aspectCrop,
  compose,
  cropFits,
  fitCrop,
  flipRect,
  mirrored,
  orientedSize,
  pixelate,
  resizeCrop,
  towards,
  turnPoint,
  turnRect,
} from "../dist/index.js";

const near = (actual, expected, digits = 6) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} is not ${expected}`);
const size = { width: 800, height: 600 };

test("four quarter turns and two flips each bring the picture back upright", () => {
  let m = UPRIGHT;
  for (let i = 0; i < 4; i++) m = compose(TURN_LEFT, m);
  assert.deepEqual(m, UPRIGHT);
  assert.deepEqual(compose(FLIP_X, compose(FLIP_X, UPRIGHT)), UPRIGHT);
  assert.deepEqual(orientedSize(size, compose(TURN_LEFT, UPRIGHT)), { width: 600, height: 800 });
  assert.equal(mirrored(compose(FLIP_Y, UPRIGHT)), true);
  assert.equal(mirrored(compose(FLIP_X, compose(FLIP_Y, UPRIGHT))), false);
});

test("a flip after a turn mirrors what is on screen, not the source", () => {
  // Turned left then flipped left to right is the same as flipped top to bottom then turned left.
  assert.deepEqual(compose(FLIP_X, compose(TURN_LEFT, UPRIGHT)), compose(TURN_LEFT, compose(FLIP_Y, UPRIGHT)));
});

test("a turn carries points and rectangles with the picture", () => {
  assert.deepEqual(turnPoint({ x: 0, y: 0 }, size), { x: 0, y: 800 });
  assert.deepEqual(turnPoint({ x: 800, y: 0 }, size), { x: 0, y: 0 });
  assert.deepEqual(turnRect({ x: 100, y: 50, width: 200, height: 100 }, size), { x: 50, y: 500, width: 100, height: 200 });
  assert.deepEqual(flipRect({ x: 100, y: 50, width: 200, height: 100 }, size, "x"), { x: 500, y: 50, width: 200, height: 100 });
});

test("a crop fits when it is inside the picture and its frame, and not when a corner leaves either", () => {
  assert.equal(cropFits({ x: 0, y: 0, width: 800, height: 600 }, size, 0), true);
  assert.equal(cropFits({ x: 0, y: 0, width: 800, height: 600 }, size, 5), false);
  assert.equal(cropFits({ x: 300, y: 200, width: 200, height: 200 }, size, 30), true);
  assert.equal(cropFits({ x: -1, y: 0, width: 100, height: 100 }, size, 0), false);
});

test("straightening shrinks the crop about its middle, keeping its shape, until it fits", () => {
  const full = { x: 0, y: 0, width: 800, height: 600 };
  const fitted = fitCrop(full, size, 10);
  assert.ok(cropFits(fitted, size, 10));
  near(fitted.width / fitted.height, 800 / 600);
  near(fitted.x + fitted.width / 2, 400);
  near(fitted.y + fitted.height / 2, 300);
  // As large as fits: a hair bigger would not.
  const bigger = { x: fitted.x - 1, y: fitted.y - 0.75, width: fitted.width + 2, height: fitted.height + 1.5 };
  assert.equal(cropFits(bigger, size, 10), false);
  assert.deepEqual(fitCrop(full, size, 0), full);
});

test("a crop of a given shape is the largest centred one", () => {
  const square = aspectCrop(size, 1, 0);
  assert.deepEqual(square, { x: 100, y: 0, width: 600, height: 600 });
  const wide = aspectCrop(size, 16 / 9, 0);
  near(wide.width, 800);
  near(wide.height, 450);
  assert.deepEqual(aspectCrop(size, null, 0), { x: 0, y: 0, width: 800, height: 600 });
});

test("dragging a corner with a fixed shape keeps the opposite corner and the shape", () => {
  const start = { x: 100, y: 100, width: 400, height: 300 };
  const free = resizeCrop(start, "se", 50, 20, null, 10);
  assert.deepEqual(free, { x: 100, y: 100, width: 450, height: 320 });
  const locked = resizeCrop(start, "nw", -40, -10, 4 / 3, 10);
  near(locked.width / locked.height, 4 / 3);
  near(locked.x + locked.width, 500);
  near(locked.y + locked.height, 400);
  const side = resizeCrop(start, "e", 100, 0, 1, 10);
  assert.equal(side.width, side.height);
  near(side.y + side.height / 2, 250);
});

test("a crop is never dragged smaller than the minimum", () => {
  const start = { x: 100, y: 100, width: 400, height: 300 };
  const small = resizeCrop(start, "w", 1000, 0, null, 24);
  assert.equal(small.width, 24);
  assert.equal(small.x + small.width, 500);
});

test("a drag past the edge stops at the edge", () => {
  const from = { x: 100, y: 100, width: 200, height: 200 };
  const stopped = towards(from, { ...from, x: 700 }, size, 0);
  assert.ok(cropFits(stopped, size, 0));
  near(stopped.x + stopped.width, 800, 2);
  assert.deepEqual(towards(from, { ...from, x: 150 }, size, 0), { ...from, x: 150 });
});

test("neutral adjustments leave pixels alone", () => {
  const data = new Uint8ClampedArray([10, 120, 240, 255, 0, 0, 0, 255]);
  adjustPixels(data, NEUTRAL, LOOKS.find((look) => look.id === "none"));
  assert.deepEqual([...data], [10, 120, 240, 255, 0, 0, 0, 255]);
});

test("brightness lifts, contrast spreads from mid-grey, and alpha is untouched", () => {
  const data = new Uint8ClampedArray([100, 100, 100, 128]);
  adjustPixels(data, { ...NEUTRAL, brightness: 50 }, undefined);
  assert.ok(data[0] > 100);
  assert.equal(data[3], 128);
  const grey = new Uint8ClampedArray([128, 128, 128, 255, 200, 200, 200, 255]);
  adjustPixels(grey, { ...NEUTRAL, contrast: 60 }, undefined);
  assert.equal(grey[0], 128);
  assert.ok(grey[4] > 200);
});

test("mono turns colour into its own grey; saturation at -100 does too", () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255]);
  adjustPixels(data, NEUTRAL, LOOKS.find((look) => look.id === "mono"));
  assert.equal(data[0], data[1]);
  assert.equal(data[1], data[2]);
  const flat = new Uint8ClampedArray([255, 0, 0, 255]);
  adjustPixels(flat, { ...NEUTRAL, saturation: -100 }, undefined);
  assert.equal(flat[0], flat[1]);
});

test("warmth moves red up and blue down", () => {
  const data = new Uint8ClampedArray([100, 100, 100, 255]);
  adjustPixels(data, { ...NEUTRAL, warmth: 100 }, undefined);
  assert.ok(data[0] > 100 && data[2] < 100);
  assert.equal(data[1], 100);
});

test("hiding turns a region into blocks of its average and leaves the rest", () => {
  const width = 4;
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([i * 10, 0, 0, 255], i * 4);
  pixelate(data, width, 4, { x: 0, y: 0, width: 2, height: 2 }, 2);
  // Pixels 0, 1, 4 and 5 were 0, 10, 40 and 50: their average is 25.
  for (const i of [0, 1, 4, 5]) assert.equal(data[i * 4], 25);
  assert.equal(data[2 * 4], 20);
});

test("history undoes and redoes, and a run of merged changes is one step", () => {
  const history = new History(0);
  history.push(1);
  history.push(2, "drag");
  history.push(3, "drag");
  history.push(4, "drag");
  assert.equal(history.state, 4);
  assert.equal(history.undo(), 1);
  assert.equal(history.redo(), 4);
  history.seal();
  history.push(5, "drag");
  assert.equal(history.undo(), 4);
  history.push(9);
  assert.equal(history.canRedo, false);
});
