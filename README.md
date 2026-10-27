# photo

A photo editor for the browser, in plain TypeScript with no dependencies. Crop to a free or fixed shape, turn, flip and straighten. Adjust brightness, contrast, saturation and warmth, or pick a look. Draw, point with arrows, box, write, and hide parts of the picture behind blocks. Every change can be undone, and Done hands back the finished picture as a file.

![A MacBook and an iPhone running the editor in Safari: on the MacBook, a square crop is pulled in at a corner and straightened, the picture is warmed and given the Punch look, an arrow and the word gm are added, and holding compare shows the original; on the iPhone, the Noir look, a brighter picture, a pen loop, a 4:5 crop and a quarter turn](demo/preview.webp)

Image editors that do this well, such as Pintura, are sold as yearly licences. This one is MIT licensed: use it in a product, change it, ship it.

- **Crop and turn.** Free, the picture's own shape, square, 4:5, 16:9 or any shapes you list. Drag the corners or the sides, or move the crop; it stops at the picture's edge. Turn a quarter at a time, flip either way, and straighten up to 45° either side: the crop shrinks about its middle to stay on the picture and grows back as the picture levels.
- **Adjust and looks.** Brightness, contrast, saturation and warmth, each a slider that fills out from the middle. Seven looks, from Mono and Noir to Warm, Cool, Fade and Punch, each previewed on your own crop.
- **Draw.** Pen, arrow, box, ellipse and text in five colours and three widths, and a block tool that hides faces, names or numbers for good. Marks can be picked up, moved, recoloured and deleted, and they turn and flip with the picture.
- **Undo everything.** Every change is a step, and a slider drag or a crop drag counts as one. Ctrl or Cmd with Z undoes, with Shift redoes. Hold compare to see the original.
- **The same pixels everywhere.** Adjustments are worked on the pixels rather than left to CSS filters, so the preview, the exported file and every browser agree. Large pictures preview from a smaller copy and export at full size.
- **Touch first.** Crop and draw with a finger; the stage never scrolls the page.
- **Accessible.** Every control is a labelled button or slider, the tools are a tab list with arrow keys, and focus goes back where it was when the dialog closes.
- **Content Security Policy.** Nothing writes a `style` attribute or a `<style>` tag, so it runs under `style-src 'self'`.

## Install

The package is not on npm. Install it from GitHub, which builds it on the way in:

```bash
npm install github:drkxbt/photo
```

It installs as `@drkxbt/photo`. Import it and its stylesheet:

```js
import { editPhoto, photoEditor } from "@drkxbt/photo";
import "@drkxbt/photo/photo.css";
```

## Usage

Open a picture full screen and wait for the result:

```js
const blob = await editPhoto(file, { output: { type: "image/jpeg", quality: 0.9, maxSize: 2400 } });
if (blob) upload(blob);
```

`editPhoto` resolves with the edited file, or `null` if it was cancelled. Escape cancels.

Or put the editor in a page yourself:

```js
const editor = photoEditor(document.querySelector("#editor"), {
  src: "photos/harbour.jpg",
  aspects: [null, "original", 1, 3 / 2],
  onDone: (blob, state) => save(blob, state),
  onCancel: () => editor.load("photos/harbour.jpg"),
});
```

Give the container a height; the editor fills it.

| Option | Default | |
| --- | --- | --- |
| `src` | | An image address, a `Blob` or `File`, an `<img>`, a canvas or an `ImageBitmap`. |
| `tools` | all four | Which tools to offer, in order: `"crop"`, `"adjust"`, `"looks"`, `"draw"`. |
| `aspects` | free, original, 1, 4:5, 16:9 | Crop shapes, as width over height, `"original"`, or `null` for free. |
| `colors` | five | The colours offered for marks. |
| `output` | PNG, full size | `type`, `quality` from 0 to 1 for JPEG and WebP, and `maxSize` for the longer side. |
| `state` | | An edit to start from, as `editor.state` gave it. |
| `labels` | English | Every control's name, for other languages. |
| `onDone`, `onCancel`, `onChange` | | Called with the file and the edit, on cancel, and with each change. |

`photoEditor()` returns `{ element, state, setState(state), setTool(tool), undo(), redo(), export(), load(src), destroy() }`. An edit is plain data, so it can be saved and opened again later, and `renderEdit(source, size, state, maxSize)` draws one onto a canvas without the editor.

## Theming

```css
.ph {
  --ph-bg: #0e0e10;
  --ph-surface: #1a1a1d;
  --ph-raised: #26262a;
  --ph-text: #f2f1ec;
  --ph-muted: #9a9a9f;
  --ph-accent: #2ff0b8;
  --ph-accent-ink: #04392a;
  --ph-radius: 8px;
}
```

The editor stays dark whatever the page looks like, so a picture's colours read true while they change.

## How it works

- **Which way up.** Quarter turns and flips are a 2×2 matrix of 0s and ±1s, multiplied in the order they were made, so a flip after a turn mirrors what is on screen. The crop and every mark are in the turned picture's pixels and move with each turn or flip.
- **Straightening.** The crop has to stay inside the tilted picture and its frame. For each corner the largest scale about the crop's middle that keeps it inside is solved directly, and the smallest wins, so the crop keeps its shape and middle while it shrinks.
- **Dragging.** A crop drag is checked against the edges and, where it would leave the picture, cut back by a binary search to the last point that fits; a move goes across, then down, so a crop pushed into an edge slides along it.
- **Pixels.** Brightness and contrast go through one lookup table; warmth shifts red against blue; saturation pulls each pixel towards or away from its own grey; looks add their own settings and can end in black and white or faded. Hiding marks average blocks of pixels, so nothing under them survives the export.
- **History.** Every state is plain data. Changes with the same key in a row, such as one slider drag, merge into one step.

## Demo

```bash
npm install
npm run demo
```

Then open http://localhost:4327/demo/. It edits drk's penguin art; Done shows the file it made, ready to download.

## Tests

```bash
npm test
```

Builds the package and tests the geometry and the pixels: turns and flips composing, the crop fitting a straightened picture, fixed-shape and minimum-size resizing, drags stopping at the edge, every adjustment and look, hiding, and undo with merged steps.

## License

[MIT](LICENSE). The penguin art in `demo/images` is drk's and is not covered by the license; see [NOTICE](NOTICE).
