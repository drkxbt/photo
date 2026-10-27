import { photoEditor } from "../dist/index.js";

const frame = document.querySelector("[data-editor]");
const result = document.querySelector("[data-result]");
// The result's image is made once there is a result, so the page never holds an empty one.
const resultImage = Object.assign(document.createElement("img"), { alt: "The edited picture" });
const resultInfo = document.querySelector("[data-result-info]");
const download = document.querySelector("[data-download]");
const tour = new URLSearchParams(location.search).get("tour");
if (tour) document.documentElement.dataset.tour = tour;

const kb = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
let lastUrl = "";

const editor = photoEditor(frame, {
  src: "images/penguin-woodblock.webp",
  output: { type: "image/png" },
  async onDone(blob) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    resultImage.src = lastUrl;
    if (!resultImage.isConnected) result.prepend(resultImage);
    await resultImage.decode().catch(() => {});
    resultInfo.textContent = `PNG · ${resultImage.naturalWidth} × ${resultImage.naturalHeight} · ${kb(blob.size)}`;
    download.href = lastUrl;
    result.hidden = false;
    if (!tour) result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
  // Cancel starts the current picture over.
  onCancel() {
    editor.load(document.querySelector("[data-pictures] [aria-checked='true']").dataset.src);
  },
});

// Choosing another picture starts a fresh edit of it.
document.querySelector("[data-pictures]").addEventListener("click", (event) => {
  const button = event.target.closest("[data-src]");
  if (!button) return;
  for (const other of button.parentElement.children) other.setAttribute("aria-checked", String(other === button));
  editor.load(button.dataset.src);
});

if (tour) import("./tour.js").then(({ run }) => run(tour, editor));
