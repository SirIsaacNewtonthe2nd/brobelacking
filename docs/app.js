import { SIZE, CAR_LENGTH, CAR_WIDTH } from "./rl.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REWARD_DEFAULTS = { crashPenalty: -15, centerWeight: 1.5, speedWeight: 0.3, revisitPenalty: 0.5 };
const STORAGE_KEY = "car-rl-playground/model";
const REPLAY_FPS = 30;
const LR_MIN = 0.000001;
const LR_MAX = 0.1;
const LR_STEP = 0.0001;

// Render colors
const BG_RGB = [8, 9, 11];
const TRACK_RGB = [36, 40, 50];
const COLOR_BG = "#08090B";
const COLOR_TRACK = "#242832";
const COLOR_TRAIL = "#5F6878";
const COLOR_CAR = "#4C8DFF";
const COLOR_SCORE = "#7D8491";
const COLOR_BEST = "#4C8DFF";

const $ = (id) => document.getElementById(id);
const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const state = {
  source: "Draw",
  strokes: [],
  history: [],
  totalSteps: 0,
  trainedSteps: 0,
  track: null,
  saved: loadModel(),
  worker: null,
};

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
// Size a canvas for the screen's pixel density and draw in 400x400 track units
function setupBoard(canvas) {
  const scale = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  canvas.width = canvas.height = Math.round(SIZE * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}

function offscreen(size = SIZE) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

function tracePreset(ctx, name) {
  const c = SIZE / 2;
  ctx.lineJoin = "round";
  ctx.lineWidth = name === "Figure eight" ? 36 : 40;
  ctx.beginPath();
  if (name === "Circle") {
    ctx.arc(c, c, 130, 0, 2 * Math.PI);
  } else if (name === "Oval") {
    ctx.ellipse(c, c, 155, 100, 0, 0, 2 * Math.PI);
  } else if (name === "Square") {
    ctx.rect(75, 75, SIZE - 150, SIZE - 150);
  } else if (name === "Figure eight") {
    ctx.moveTo(c + 80, 115);
    ctx.arc(c, 115, 80, 0, 2 * Math.PI);
    ctx.moveTo(c + 80, 285);
    ctx.arc(c, 285, 80, 0, 2 * Math.PI);
  }
  ctx.stroke();
}

function paintStrokes(ctx) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const { width, points } of state.strokes) {
    ctx.lineWidth = width;
    ctx.beginPath();
    if (points.length === 1) {
      ctx.arc(points[0][0], points[0][1], width / 2, 0, 2 * Math.PI);
      ctx.fill();
      continue;
    }
    // Smooth the freehand path through segment midpoints
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i][0] + points[i + 1][0]) / 2;
      const my = (points[i][1] + points[i + 1][1]) / 2;
      ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }
}

// White-on-black drawing -> Uint8Array track (1 = road), thresholded on grayscale like OpenCV
function rasterize(paint, threshold) {
  const canvas = offscreen();
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = ctx.fillStyle = "#fff";
  paint(ctx);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const track = new Uint8Array(SIZE * SIZE);
  let blank = true;
  for (let i = 0, p = 0; i < track.length; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (r > 10 || g > 10 || b > 10) blank = false;
    track[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b) > threshold ? 1 : 0;
  }
  return { track, blank };
}

const presetCache = new Map();
function presetTrack(name) {
  if (!presetCache.has(name)) presetCache.set(name, rasterize((ctx) => tracePreset(ctx, name), 127).track);
  return presetCache.get(name);
}

function drawnTrack() {
  const { track, blank } = rasterize(paintStrokes, 50);
  return blank ? null : track;
}

// ---------------------------------------------------------------------------
// Track panel
// ---------------------------------------------------------------------------
const trackCanvas = $("track-canvas");
const trackCtx = setupBoard(trackCanvas);
let renderQueued = false;

function renderTrackBoard() {
  renderQueued = false;
  const ctx = trackCtx;
  if (state.source === "Draw") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    paintStrokes(ctx);
    return;
  }

  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = COLOR_TRACK;
  tracePreset(ctx, state.source);

  // Start marker: where the car starts and which way it faces
  const first = presetTrack(state.source).indexOf(1);
  const x = first % SIZE;
  const y = Math.floor(first / SIZE);
  const tip = x + 26;
  const head = 26 * 0.4 * Math.SQRT1_2;
  ctx.fillStyle = ctx.strokeStyle = COLOR_CAR;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, 2 * Math.PI);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tip, y);
  ctx.moveTo(tip - head, y - head);
  ctx.lineTo(tip, y);
  ctx.lineTo(tip - head, y + head);
  ctx.stroke();
}

function queueTrackRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(renderTrackBoard);
  }
}

function setSource(source) {
  state.source = source;
  const drawing = source === "Draw";
  $("brush-field").hidden = !drawing;
  $("canvas-toolbar").hidden = !drawing;
  trackCanvas.classList.toggle("drawing", drawing);
  $("track-caption").textContent = drawing
    ? "Use the toolbar to undo or clear. The car starts at the topmost point of the track, facing right."
    : "Blue marker shows where the car starts and which way it faces.";
  renderTrackBoard();
}

for (const radio of document.querySelectorAll('input[name="source"]')) {
  radio.addEventListener("change", () => setSource(radio.value));
}

function boardPoint(e) {
  const rect = trackCanvas.getBoundingClientRect();
  return [((e.clientX - rect.left) * SIZE) / rect.width, ((e.clientY - rect.top) * SIZE) / rect.height];
}

let activeStroke = null;
trackCanvas.addEventListener("pointerdown", (e) => {
  if (state.source !== "Draw" || e.button > 0) return;
  e.preventDefault();
  trackCanvas.setPointerCapture(e.pointerId);
  activeStroke = { width: +$("brush").value, points: [boardPoint(e)] };
  state.strokes.push(activeStroke);
  queueTrackRender();
});
trackCanvas.addEventListener("pointermove", (e) => {
  if (!activeStroke) return;
  const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of coalesced.length ? coalesced : [e]) activeStroke.points.push(boardPoint(ev));
  queueTrackRender();
});
for (const type of ["pointerup", "pointercancel"]) {
  trackCanvas.addEventListener(type, () => { activeStroke = null; });
}

$("undo").addEventListener("click", () => { state.strokes.pop(); renderTrackBoard(); });
$("clear").addEventListener("click", () => { state.strokes = []; renderTrackBoard(); });

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
function bindRange(id, format) {
  const input = $(id);
  const output = $(`${id}-value`);
  const update = () => { output.value = format(+input.value); };
  input.addEventListener("input", update);
  update();
  return update;
}

bindRange("brush", (v) => String(v));
bindRange("steps", (v) => fmtInt.format(v));
const rewardUpdaters = Object.keys(REWARD_DEFAULTS).map((key) => {
  $(key).value = REWARD_DEFAULTS[key];
  return bindRange(key, (v) => v.toFixed(2));
});

$("reset-rewards").addEventListener("click", () => {
  for (const [key, value] of Object.entries(REWARD_DEFAULTS)) $(key).value = value;
  rewardUpdaters.forEach((update) => update());
});

function currentRewards() {
  return Object.fromEntries(Object.keys(REWARD_DEFAULTS).map((key) => [key, +$(key).value]));
}

const lrInput = $("lr");
let learningRate = 0.0003;
function setLearningRate(value) {
  if (Number.isFinite(value)) learningRate = Math.min(LR_MAX, Math.max(LR_MIN, value));
  lrInput.value = learningRate.toFixed(5);
}
lrInput.addEventListener("change", () => setLearningRate(parseFloat(lrInput.value)));
$("lr-down").addEventListener("click", () => setLearningRate(+(learningRate - LR_STEP).toFixed(6)));
$("lr-up").addEventListener("click", () => setLearningRate(+(learningRate + LR_STEP).toFixed(6)));

for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll('[role="tab"]')) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      $(other.getAttribute("aria-controls")).hidden = !selected;
    }
  });
}

function parseLayers(text) {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length || !parts.every((s) => /^\+?\d+$/.test(s))) return null;
  const layers = parts.map((s) => parseInt(s, 10));
  return layers.every((n) => n > 0) ? layers : null;
}

function updateResumeUi() {
  const resume = $("resume");
  resume.disabled = !state.saved;
  if (!state.saved) resume.checked = false;
  $("no-weights").hidden = Boolean(state.saved);
  $("download").hidden = !state.saved;
}

// ---------------------------------------------------------------------------
// Saved weights (per browser)
// ---------------------------------------------------------------------------
function toBase64(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float64Array(bytes.buffer);
}

function paramCount(layers) {
  const sizes = (out) => [6, ...layers, out];
  const count = (s) => s.slice(1).reduce((n, size, l) => n + s[l] * size + size, 0);
  return count(sizes(4)) + count(sizes(1));
}

function persistModel(model) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      layers: model.layers,
      adamT: model.adamT,
      numTimesteps: model.numTimesteps,
      params: toBase64(model.params),
      adamM: toBase64(model.adamM),
      adamV: toBase64(model.adamV),
    }));
  } catch {
    // Storage can be full or blocked; the weights still work for this visit
  }
}

function loadModel() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw || !Array.isArray(raw.layers)) return null;
    const model = { ...raw, params: fromBase64(raw.params), adamM: fromBase64(raw.adamM), adamV: fromBase64(raw.adamV) };
    const expected = paramCount(model.layers);
    if ([model.params, model.adamM, model.adamV].some((a) => a.length !== expected)) return null;
    return model;
  } catch {
    return null;
  }
}

// Readable export: per layer, weight is [out][in] like torch.nn.Linear
function exportWeights(model) {
  let offset = 0;
  const take = (sizes) => sizes.slice(1).map((nOut, l) => {
    const nIn = sizes[l];
    const weight = [];
    for (let o = 0; o < nOut; o++) weight.push(Array.from(model.params.subarray(offset + o * nIn, offset + (o + 1) * nIn)));
    offset += nIn * nOut;
    const bias = Array.from(model.params.subarray(offset, offset + nOut));
    offset += nOut;
    return { weight, bias };
  });
  const actor = take([6, ...model.layers, 4]);
  const critic = take([6, ...model.layers, 1]);
  return {
    format: "car-rl-playground-weights/1",
    trainedSteps: model.numTimesteps,
    hiddenLayers: model.layers,
    activation: "tanh",
    observation: ["radar -60°", "radar -30°", "radar 0°", "radar +30°", "radar +60°", "speed / max speed"],
    actions: ["steer left", "steer right", "accelerate", "brake"],
    actor,
    critic,
  };
}

$("download").addEventListener("click", () => {
  if (!state.saved) return;
  const blob = new Blob([JSON.stringify(exportWeights(state.saved))], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "custom_model.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

// ---------------------------------------------------------------------------
// Best-run replay
// ---------------------------------------------------------------------------
const replayCanvas = $("replay");
const replay = {
  ctx: setupBoard(replayCanvas),
  trail: offscreen(replayCanvas.width),
  base: offscreen(),
  states: null,
  frame: 0,
  start: 0,
  raf: 0,
};
replay.trailCtx = replay.trail.getContext("2d");
replay.trailCtx.setTransform(replayCanvas.width / SIZE, 0, 0, replayCanvas.width / SIZE, 0, 0);

function startReplay(track, states) {
  const ctx = replay.base.getContext("2d");
  const image = ctx.createImageData(SIZE, SIZE);
  for (let i = 0, p = 0; i < track.length; i++, p += 4) {
    const rgb = track[i] ? TRACK_RGB : BG_RGB;
    image.data[p] = rgb[0];
    image.data[p + 1] = rgb[1];
    image.data[p + 2] = rgb[2];
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  replay.states = states;
  restartReplay(performance.now());
  replayCanvas.hidden = false;
  $("replay-empty").hidden = true;
  if (!replay.raf) replay.raf = requestAnimationFrame(tickReplay);
}

function stopReplay() {
  cancelAnimationFrame(replay.raf);
  replay.raf = 0;
  replay.states = null;
  replayCanvas.hidden = true;
  $("replay-empty").hidden = false;
}

function restartReplay(now) {
  replay.trailCtx.drawImage(replay.base, 0, 0, SIZE, SIZE);
  replay.frame = 0;
  replay.start = now;
}

function tickReplay(now) {
  const { states, trailCtx: t } = replay;
  const frames = states.length / 3;
  const due = Math.min(frames - 1, Math.floor(((now - replay.start) * REPLAY_FPS) / 1000));

  // Extend the trail up to the current frame
  if (due > replay.frame) {
    t.strokeStyle = COLOR_TRAIL;
    t.lineWidth = 2;
    t.lineCap = t.lineJoin = "round";
    t.beginPath();
    t.moveTo(states[replay.frame * 3], states[replay.frame * 3 + 1]);
    for (let f = replay.frame + 1; f <= due; f++) t.lineTo(states[f * 3], states[f * 3 + 1]);
    t.stroke();
    replay.frame = due;
  }

  const ctx = replay.ctx;
  ctx.drawImage(replay.trail, 0, 0, SIZE, SIZE);
  const f = replay.frame * 3;
  ctx.save();
  ctx.translate(states[f], states[f + 1]);
  ctx.rotate(states[f + 2]);
  ctx.fillStyle = COLOR_CAR;
  ctx.fillRect(-CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH);
  ctx.restore();

  // Loop like the video did once every frame has been shown
  if ((now - replay.start) * REPLAY_FPS >= frames * 1000) restartReplay(now);
  replay.raf = requestAnimationFrame(tickReplay);
}

// ---------------------------------------------------------------------------
// Score chart
// ---------------------------------------------------------------------------
const SVG_NS = "http://www.w3.org/2000/svg";
const chartEl = $("chart");

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (parent) parent.appendChild(el);
  return el;
}

function niceTicks(lo, hi, count) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.999; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function renderChart() {
  const hist = state.history;
  chartEl.replaceChildren();
  if (!hist.length) return;

  const width = chartEl.clientWidth || 480;
  const height = chartEl.clientHeight || 300;
  const m = { top: 10, right: 14, bottom: 28, left: 52 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  let x0 = hist[0].steps;
  let x1 = hist[hist.length - 1].steps;
  if (x0 === x1) { x0 -= 2500; x1 += 2500; }
  const values = hist.flatMap((h) => [h.score, h.best]);
  const yTicks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 5);
  const y0 = yTicks[0];
  const y1 = yTicks[yTicks.length - 1];
  const sx = (v) => m.left + ((v - x0) / (x1 - x0)) * plotW;
  const sy = (v) => m.top + (1 - (v - y0) / (y1 - y0)) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" }, chartEl);
  const grid = svgEl("g", { class: "grid" }, svg);
  for (const t of yTicks) {
    svgEl("line", { x1: m.left, x2: width - m.right, y1: sy(t), y2: sy(t) }, grid);
    svgEl("text", { class: "tick", x: m.left - 8, y: sy(t) + 4, "text-anchor": "end" }, svg).textContent = fmtInt.format(t);
  }
  const xTicks = niceTicks(x0, x1, Math.max(2, Math.floor(plotW / 90))).filter((t) => t >= x0 && t <= x1);
  for (const t of xTicks) {
    svgEl("text", { class: "tick", x: sx(t), y: height - 8, "text-anchor": "middle" }, svg).textContent = fmtInt.format(t);
  }

  const series = [["score", COLOR_SCORE, "Score"], ["best", COLOR_BEST, "Best"]];
  for (const [key, color] of series) {
    const d = hist.map((h, i) => `${i ? "L" : "M"}${sx(h.steps).toFixed(1)},${sy(h[key]).toFixed(1)}`).join("");
    svgEl("path", { class: "series", d, stroke: color }, svg);
    if (hist.length === 1) svgEl("circle", { class: "dot", r: 4, fill: color, cx: sx(hist[0].steps), cy: sy(hist[0][key]) }, svg);
  }

  // Hover layer: hairline snapped to the nearest checkpoint, both values in one tooltip
  const hover = svgEl("g", { visibility: "hidden" }, svg);
  const hair = svgEl("line", { class: "hairline", y1: m.top, y2: height - m.bottom }, hover);
  const dots = series.map(([, color]) => svgEl("circle", { class: "dot", r: 4, fill: color }, hover));
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.hidden = true;
  chartEl.appendChild(tip);

  let index = hist.length - 1;
  const show = (i) => {
    index = i;
    const h = hist[i];
    const x = sx(h.steps);
    hair.setAttribute("x1", x);
    hair.setAttribute("x2", x);
    series.forEach(([key], s) => {
      dots[s].setAttribute("cx", x);
      dots[s].setAttribute("cy", sy(h[key]));
    });
    hover.setAttribute("visibility", "visible");

    const head = document.createElement("div");
    head.className = "head";
    head.textContent = `Steps ${fmtInt.format(h.steps)}`;
    const rows = series.map(([key, color, name]) => {
      const row = document.createElement("div");
      row.className = "row";
      const swatch = document.createElement("i");
      swatch.className = "key";
      swatch.style.background = color;
      const value = document.createElement("strong");
      value.textContent = h[key].toFixed(1);
      const label = document.createElement("span");
      label.className = "name";
      label.textContent = name;
      row.append(swatch, value, label);
      return row;
    });
    tip.replaceChildren(head, ...rows);
    tip.hidden = false;
    const left = x + 12 + tip.offsetWidth > width ? x - 12 - tip.offsetWidth : x + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${m.top}px`;
  };
  const hide = () => {
    hover.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };

  chartEl.onpointermove = (e) => {
    const px = e.clientX - chartEl.getBoundingClientRect().left;
    let best = 0;
    hist.forEach((h, i) => { if (Math.abs(sx(h.steps) - px) < Math.abs(sx(hist[best].steps) - px)) best = i; });
    show(best);
  };
  chartEl.onpointerleave = hide;
  chartEl.onfocus = () => show(hist.length - 1);
  chartEl.onblur = hide;
  chartEl.onkeydown = (e) => {
    if (e.key === "ArrowLeft") show(Math.max(0, index - 1));
    else if (e.key === "ArrowRight") show(Math.min(hist.length - 1, index + 1));
  };
  const last = hist[hist.length - 1];
  chartEl.setAttribute("aria-label",
    `Score per checkpoint over ${hist.length} checkpoints. Latest score ${last.score.toFixed(1)}, best ${last.best.toFixed(1)}.`);
}

new ResizeObserver(() => { if (state.history.length) renderChart(); }).observe(chartEl);

// ---------------------------------------------------------------------------
// Results panel
// ---------------------------------------------------------------------------
function drawProgress() {
  const done = Math.min(state.trainedSteps, state.totalSteps);
  const pct = state.totalSteps ? (100 * done) / state.totalSteps : 0;
  $("progress-bar").style.width = `${pct}%`;
  $("progress").setAttribute("aria-valuenow", Math.round(pct));
  $("m-steps").textContent = `${fmtInt.format(done)} / ${fmtInt.format(state.totalSteps)}`;
}

function drawResults() {
  const last = state.history[state.history.length - 1];
  drawProgress();
  $("m-score").textContent = last ? last.score.toFixed(1) : "–";
  $("m-best").textContent = last ? last.best.toFixed(1) : "–";
  $("m-length").textContent = last ? fmtInt.format(last.length) : "–";
  $("chart-empty").hidden = Boolean(last);
  $("chart-wrap").hidden = !last;
  renderChart();
}

function showError(message) {
  $("error").textContent = message || "";
  $("error").hidden = !message;
}

let toastTimer = 0;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------
function onWorkerMessage(msg) {
  if (msg.type === "progress") {
    state.trainedSteps = msg.steps;
    drawProgress();
  } else if (msg.type === "checkpoint") {
    state.trainedSteps = Math.max(state.trainedSteps, msg.steps);
    state.history.push({ steps: msg.steps, score: msg.score, best: msg.best, length: msg.length });
    if (msg.states) startReplay(state.track, msg.states);
    if (msg.model) {
      state.saved = msg.model;
      persistModel(msg.model);
      updateResumeUi();
    }
    drawResults();
  } else if (msg.type === "done") {
    state.worker.terminate();
    state.worker = null;
    toast(`Training complete. Best score ${msg.best.toFixed(1)}`);
  } else if (msg.type === "error") {
    showError(`Training stopped: ${msg.message}`);
  }
}

$("train").addEventListener("click", () => {
  setLearningRate(parseFloat(lrInput.value));
  const resume = $("resume").checked && state.saved !== null;
  const layers = parseLayers($("layers").value);
  if (!layers && !resume) {
    showError("Network layers should be positive whole numbers separated by commas, like 64, 64.");
    return;
  }
  showError(null);

  const notes = [resume ? "Resumed from saved weights." : "Fresh training run."];
  let track = state.source === "Draw" ? drawnTrack() : presetTrack(state.source);
  if (!track) {
    track = presetTrack("Circle");
    notes.push("Canvas was empty, so the circle track was used.");
  }

  // Clicking again restarts training, as in the original app
  if (state.worker) state.worker.terminate();
  state.history = [];
  state.totalSteps = +$("steps").value;
  state.trainedSteps = 0;
  state.track = track;
  stopReplay();
  $("run-note").textContent = notes.join(" ");
  $("results").hidden = false;
  drawResults();

  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  state.worker = worker;
  worker.onmessage = ({ data }) => { if (state.worker === worker) onWorkerMessage(data); };
  worker.onerror = (e) => showError(`Training stopped: ${e.message || "the training worker failed to start."}`);
  worker.postMessage({
    track,
    rewards: currentRewards(),
    totalSteps: state.totalSteps,
    learningRate,
    layers,
    saved: resume ? state.saved : null,
  });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
setSource("Draw");
setLearningRate(learningRate);
updateResumeUi();
