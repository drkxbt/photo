// A looping tour for recordings, run inside each screen of tour.html: a mouse on the MacBook, a finger on the iPhone.
// Both have the same period, and every loop starts the picture over.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(name, editor) {
  const $ = (selector) => document.querySelector(selector);
  const touch = name === "phone";

  // Where the pointer is: a dot for the finger, and for the mouse the same dot, smaller and darker.
  const finger = document.createElement("div");
  finger.className = "finger";
  document.body.append(finger);
  const show = (x, y, down) => {
    finger.style.translate = `${x - 22}px ${y - 22}px`;
    finger.toggleAttribute("data-on", true);
    finger.toggleAttribute("data-down", down);
  };
  const lift = () => finger.removeAttribute("data-on");

  let captured = null;
  const pointer = (type, x, y) => {
    if (type === "pointerdown") captured = document.elementFromPoint(x, y) ?? document.body;
    const target = captured ?? document.body;
    if (type === "pointerup") captured = null;
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: touch ? "touch" : "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true }));
  };
  const ease = (t) => 1 - (1 - t) ** 2;
  async function drag(from, to, ms) {
    show(from.x, from.y, true);
    pointer("pointerdown", from.x, from.y);
    const steps = Math.max(4, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      pointer("pointermove", x, y);
      show(x, y, true);
      await wait(16);
    }
    pointer("pointerup", to.x, to.y);
    show(to.x, to.y, false);
    await wait(160);
    lift();
  }
  async function stroke(points, ms) {
    show(points[0].x, points[0].y, true);
    pointer("pointerdown", points[0].x, points[0].y);
    for (const point of points.slice(1)) {
      pointer("pointermove", point.x, point.y);
      show(point.x, point.y, true);
      await wait(ms / points.length);
    }
    const last = points[points.length - 1];
    pointer("pointerup", last.x, last.y);
    await wait(160);
    lift();
  }
  async function tap(element) {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    show(x, y, true);
    await wait(120);
    show(x, y, false);
    element.click();
    await wait(140);
    lift();
  }
  async function slide(label, to, ms) {
    const input = $(`.ph-range[aria-label="${label}"]`);
    const from = Number(input.value);
    const box = input.getBoundingClientRect();
    const at = (v) => box.left + 9 + ((v - Number(input.min)) / (Number(input.max) - Number(input.min))) * (box.width - 18);
    const steps = Math.max(4, Math.round(ms / 16));
    for (let i = 0; i <= steps; i++) {
      const v = Math.round(from + (to - from) * ease(i / steps));
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      show(at(v), box.top + box.height / 2, true);
      await wait(16);
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    show(at(to), box.top + box.height / 2, false);
    await wait(140);
    lift();
  }
  const tool = (label) => tap($(`.ph-tool[aria-label="${label}"]`));
  const chip = (label) => tap($(`.ph-chip[aria-label="${label}"]`));
  const stageBox = () => $(".ph-stage").getBoundingClientRect();

  const scripts = {
    // Square crop, a corner pulled in, a tilt straightened; warmer and punchier; an arrow and a word; then a look
    // back at the original.
    async desk(at) {
      await at(500);
      await chip("Crop: Square");
      await at(1200);
      const s = stageBox();
      const side = Math.min(s.width - 56, s.height - 56);
      const left = s.left + (s.width - side) / 2;
      const top = s.top + (s.height - side) / 2;
      await drag({ x: left + 3, y: top + 3 }, { x: left + side * 0.18, y: top + side * 0.18 }, 420);
      await at(2100);
      await slide("Straighten", 7, 520);
      await at(3100);
      await tool("Adjust");
      await slide("Warmth", 36, 420);
      await slide("Saturation", 24, 380);
      await at(4800);
      await tool("Looks");
      await at(5300);
      await tap($('.ph-look[aria-label="Punch"]'));
      await at(5900);
      await tool("Draw");
      await chip("Arrow");
      const d = stageBox();
      await drag({ x: d.left + d.width * 0.3, y: d.top + d.height * 0.72 }, { x: d.left + d.width * 0.47, y: d.top + d.height * 0.5 }, 360);
      await at(7000);
      await chip("Text");
      const tx = d.left + d.width * 0.28;
      const ty = d.top + d.height * 0.22;
      show(tx, ty, true);
      pointer("pointerdown", tx, ty);
      pointer("pointerup", tx, ty);
      await wait(140);
      lift();
      const field = $(".ph-text-input");
      for (const char of "gm") {
        field.value += char;
        await wait(130);
      }
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await at(8300);
      const compare = $(".ph-compare");
      const c = compare.getBoundingClientRect();
      show(c.left + c.width / 2, c.top + c.height / 2, true);
      compare.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await wait(800);
      compare.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      lift();
      await at(9500);
      await restart();
    },
    // On the phone: a look, a brighter picture, a quick drawing, then a crop to 4:5 and a quarter turn.
    async phone(at) {
      await at(700);
      await tool("Looks");
      await at(1300);
      await tap($('.ph-look[aria-label="Noir"]'));
      await at(2300);
      await tool("Adjust");
      await slide("Brightness", 22, 420);
      await at(3600);
      await tool("Draw");
      await chip("Pen");
      const s = stageBox();
      const cx = s.left + s.width * 0.5;
      const cy = s.top + s.height * 0.42;
      const points = Array.from({ length: 40 }, (_, i) => {
        const t = (i / 39) * Math.PI * 2;
        return { x: cx + Math.cos(t) * s.width * 0.18, y: cy + Math.sin(t) * s.width * 0.12 };
      });
      await stroke(points, 700);
      await at(5600);
      await tool("Crop and turn");
      await at(6200);
      await chip("Crop: 4:5");
      await at(7200);
      await chip("Turn left");
      await at(9400);
      await restart();
    },
  };

  // Back to the untouched picture and the first tool, ready for the next loop.
  async function restart() {
    await editor.load("images/penguin-woodblock.webp");
    editor.setTool("crop");
  }

  const script = scripts[name];
  if (!script) return;
  const { start, period } = await new Promise((resolve) => {
    const hello = setInterval(() => parent.postMessage({ tourReady: name }, "*"), 300);
    parent.postMessage({ tourReady: name }, "*");
    addEventListener("message", (event) => {
      if (!event.data?.tourStart) return;
      clearInterval(hello);
      resolve({ start: event.data.tourStart, period: event.data.period });
    });
  });
  for (let k = 0; ; k++) {
    const t0 = start + k * period;
    await script((ms) => wait(Math.max(0, t0 + ms - Date.now())));
    await wait(Math.max(0, t0 + period - Date.now()));
  }
}
