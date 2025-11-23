const playArea = document.getElementById("playArea");
const palette = document.getElementById("palette");
const playButton = document.getElementById("playButton");
const playHead = document.getElementById("playHead");
const selectionBox = document.getElementById("selectionBox");
const helpButton = document.getElementById("helpButton");
const helpOverlay = document.getElementById("helpOverlay");
const helpCloseButton = document.getElementById("helpCloseButton");
const speedSlider = document.getElementById("speedSlider");
const hoverTooltip = document.createElement("div");
hoverTooltip.id = "hoverTooltip";
document.body.appendChild(hoverTooltip);

const mobilePaletteQuery = window.matchMedia("(max-width: 900px), (orientation: portrait)");

function updateMobilePalettePadding() {
  if (!palette) return;
  if (!mobilePaletteQuery.matches) {
    document.documentElement.style.removeProperty("--mobile-palette-padding");
    return;
  }

  const paletteRect = palette.getBoundingClientRect();
  const clampedHeight = Math.min(paletteRect.height || 0, window.innerHeight * 0.3);
  if (clampedHeight > 0) {
    document.documentElement.style.setProperty("--mobile-palette-padding", `${clampedHeight}px`);
  }
}

mobilePaletteQuery.addEventListener("change", updateMobilePalettePadding);
window.addEventListener("resize", updateMobilePalettePadding);
window.addEventListener("orientationchange", updateMobilePalettePadding);

if (typeof ResizeObserver !== "undefined" && palette) {
  const paletteObserver = new ResizeObserver(updateMobilePalettePadding);
  paletteObserver.observe(palette);
}

function getClientPoint(e) {
  if (e.touches && e.touches.length) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  if (e.clientX != null && e.clientY != null) {
    return { x: e.clientX, y: e.clientY };
  }
  return null;
}

let items = [];
let selectedItems = new Set();

let clipboardData = null;
let undoStack = [];
let hoverTimer = null;
let hoverTarget = null;

const baseColors = {
  C: "#f97373",
  D: "#fb923c",
  E: "#facc15",
  F: "#4ade80",
  G: "#38bdf8",
  A: "#6366f1",
  B: "#e879f9"
};

const namesSharpPC = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const namesFlatPC  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

const MIN_OCTAVE = 1;
const MAX_OCTAVE = 7;

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// Playback speed (pixels per second)
let playSpeed = parseFloat(speedSlider.value) || 220;
speedSlider.addEventListener("input", () => {
  playSpeed = parseFloat(speedSlider.value) || 220;
});

// Piano-like sound
function playPiano(freq, duration = 0.8, overallGain = 0.35) {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(overallGain, now + 0.01);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  masterGain.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = freq;

  const osc2 = ctx.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.value = freq * 2;

  const osc3 = ctx.createOscillator();
  osc3.type = "sine";
  osc3.frequency.value = freq * 3;

  const g1 = ctx.createGain();
  const g2 = ctx.createGain();
  const g3 = ctx.createGain();

  g1.gain.setValueAtTime(1.0, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + duration);

  g2.gain.setValueAtTime(0.4, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.8);

  g3.gain.setValueAtTime(0.25, now);
  g3.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.6);

  osc1.connect(g1);
  osc2.connect(g2);
  osc3.connect(g3);

  g1.connect(masterGain);
  g2.connect(masterGain);
  g3.connect(masterGain);

  osc1.start(now);
  osc2.start(now);
  osc3.start(now);
  osc1.stop(now + duration + 0.05);
  osc2.stop(now + duration + 0.05);
  osc3.stop(now + duration + 0.05);
}

// Kick (sharp)
function playKick() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(50, now + 0.25);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1.0, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.26);
}

// Snare (flat)
function playSnare() {
  const ctx = getAudioCtx();
  const bufferSize = ctx.sampleRate * 0.2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1000;

  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.8, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + 0.21);
}

// Hi-hat (8↑)
function playHiHat() {
  const ctx = getAudioCtx();
  const bufferSize = ctx.sampleRate * 0.08;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 6000;

  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.6, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + 0.09);
}

// Tom (8↓)
function playTom() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.22);

  gain.gain.setValueAtTime(0.7, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.24);
}

// Note name parsing
function parseNoteName(note) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!m) return null;
  return { step: m[1], accidental: m[2], octave: Number(m[3]) };
}

function noteToMidi(note) {
  const p = parseNoteName(note);
  if (!p) return null;
  const semitoneBase = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[p.step];
  let accOffset = 0;
  if (p.accidental === "#") accOffset = 1;
  else if (p.accidental === "b") accOffset = -1;
  return (p.octave + 1) * 12 + semitoneBase + accOffset;
}

function midiToNote(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return namesSharpPC[pc] + octave;
}

function noteToFreq(note) {
  const midi = noteToMidi(note);
  if (midi == null) return null;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Display label (C, C♯, D♭, etc.)
function updateNoteLabel(el) {
  const noteName = el.dataset.note;
  const midi = noteToMidi(noteName);
  if (midi == null) {
    el.textContent = noteName;
    return;
  }
  const pc = ((midi % 12) + 12) % 12;
  const flavor = el.dataset.displayAcc || "none"; // "sharp" | "flat" | "none"
  let base;
  if (flavor === "sharp") {
    base = namesSharpPC[pc];
  } else if (flavor === "flat") {
    base = namesFlatPC[pc];
  } else {
    base = namesSharpPC[pc].replace("#", "");
  }
  base = base.replace("#", "♯").replace("b", "♭");
  el.textContent = base;
}

function formatNoteForDisplay(note) {
  const parsed = parseNoteName(note);
  if (!parsed) return note;
  const acc = parsed.accidental === "#" ? "♯" : parsed.accidental === "b" ? "♭" : "";
  return `${parsed.step}${acc}${parsed.octave}`;
}

function applyOctaveRing(el, octave) {
  if (octave == null || isNaN(octave)) {
    el.style.outline = "";
    return;
  }
  const ratioRaw = (octave - MIN_OCTAVE) / (MAX_OCTAVE - MIN_OCTAVE);
  const ratio = Math.max(0, Math.min(1, ratioRaw));
  const g = Math.round(255 * ratio);
  const col = `rgb(${g},${g},${g})`;
  el.style.outline = `2px solid ${col}`;
}

function applyNoteVisual(el) {
  const noteName = el.dataset.note;
  const parsed = parseNoteName(noteName);
  const step = parsed ? parsed.step : null;
  const color = baseColors[step] || "#9ca3af";

  el.style.background = color;
  el.style.color = "#020617";

  if (el.classList.contains("item") && el.dataset.type === "note") {
    applyOctaveRing(el, parsed ? parsed.octave : null);
  }

  updateNoteLabel(el);
}

function applyChordVisual(el, rootNote) {
  const parsed = parseNoteName(rootNote);
  const step = parsed ? parsed.step : null;
  const color = baseColors[step] || "#a855f7";
  el.style.background = color;
  el.style.color = "#f9fafb";
  if (parsed && el.classList.contains("item")) {
    applyOctaveRing(el, parsed.octave);
  }
}

function hideHoverTooltip() {
  hoverTooltip.classList.remove("visible");
}

function showHoverTooltip(el) {
  if (!el || el.dataset.type !== "chord") return;
  const notes = (el.dataset.notes || "").split(",").filter(Boolean);
  if (!notes.length) return;

  const noteText = notes.map(formatNoteForDisplay).join(", ");
  hoverTooltip.textContent = noteText;
  hoverTooltip.classList.add("visible");

  const rect = el.getBoundingClientRect();
  const tipRect = hoverTooltip.getBoundingClientRect();
  let top = rect.top + window.scrollY - tipRect.height - 8;
  if (top < 4) top = rect.bottom + window.scrollY + 8;

  const rawLeft = rect.left + window.scrollX + rect.width / 2 - tipRect.width / 2;
  const viewportRight = window.scrollX + document.documentElement.clientWidth;
  const clampedLeft = Math.min(viewportRight - tipRect.width - 8, Math.max(window.scrollX + 8, rawLeft));
  hoverTooltip.style.top = `${top}px`;
  hoverTooltip.style.left = `${clampedLeft}px`;
}

function scheduleHoverTooltip(el) {
  clearTimeout(hoverTimer);
  hoverTarget = el;
  hoverTimer = setTimeout(() => {
    if (hoverTarget === el) showHoverTooltip(el);
  }, 500);
}

function cancelHoverTooltip() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  hoverTarget = null;
  hideHoverTooltip();
}

function positionItem(el, x, y) {
  const w = el.offsetWidth || 50;
  const h = el.offsetHeight || 50;
  let px = x;
  let py = y;

  px = Math.max(0, Math.min(px, playArea.clientWidth - w));
  py = Math.max(0, Math.min(py, playArea.clientHeight - h));

  el.style.left = px + "px";
  el.style.top = py + "px";
}

function registerItem(el) {
  items.push(el);
  el.addEventListener("mousedown", onItemPointerDown);
  el.addEventListener("touchstart", onItemPointerDown, { passive: false });
  el.addEventListener("dblclick", onItemDoubleClick);
  el.addEventListener("mouseenter", onItemHoverStart);
  el.addEventListener("mouseleave", onItemHoverEnd);
}

function removeItem(el) {
  const idx = items.indexOf(el);
  if (idx >= 0) items.splice(idx, 1);
  selectedItems.delete(el);
  if (el.parentNode === playArea) {
    playArea.removeChild(el);
  } else if (el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

function createNoteItem(noteName, x, y) {
  const el = document.createElement("div");
  el.className = "item note";
  el.dataset.type = "note";
  el.dataset.note = noteName;
  el.dataset.displayAcc = "none";
  playArea.appendChild(el);
  positionItem(el, x, y);
  applyNoteVisual(el);
  registerItem(el);
  return el;
}

function createAccidentalItem(accType, x, y) {
  const el = document.createElement("div");
  el.className = "item accidental";
  el.dataset.type = "accidental";
  el.dataset.accType = accType;
  el.textContent = accType === "sharp" ? "♯" : "♭";
  playArea.appendChild(el);
  positionItem(el, x, y);
  registerItem(el);
  return el;
}

function createOctaveItem(octDir, x, y) {
  const el = document.createElement("div");
  el.className = "item octave";
  el.dataset.type = "octave";
  el.dataset.octDir = octDir;
  el.textContent = octDir === "up" ? "8↑" : "8↓";
  playArea.appendChild(el);
  positionItem(el, x, y);
  registerItem(el);
  return el;
}

const chordTemplates = [
  { id: "maj",    suffix: "",          intervals: [0, 4, 7],       quality: [4] },
  { id: "min",    suffix: "m",         intervals: [0, 3, 7],       quality: [3] },
  { id: "dim",    suffix: "dim",       intervals: [0, 3, 6],       quality: [3, 6] },
  { id: "aug",    suffix: "+",         intervals: [0, 4, 8],       quality: [4, 8] },
  { id: "sus2",   suffix: "sus2",      intervals: [0, 2, 7],       quality: [2] },
  { id: "sus4",   suffix: "sus",       intervals: [0, 5, 7],       quality: [5] },
  { id: "5",      suffix: "5",         intervals: [0, 7],          quality: [] },
  { id: "6",      suffix: "6",         intervals: [0, 4, 7, 9],    quality: [4, 9] },
  { id: "m6",     suffix: "m6",        intervals: [0, 3, 7, 9],    quality: [3, 9] },
  { id: "6/9",    suffix: "6/9",       intervals: [0, 4, 7, 9, 2], quality: [4, 9, 2] },
  { id: "m6/9",   suffix: "m6/9",      intervals: [0, 3, 7, 9, 2], quality: [3, 9, 2] },
  { id: "7",      suffix: "7",         intervals: [0, 4, 7, 10],   quality: [4, 10] },
  { id: "7b5",    suffix: "7-5",       intervals: [0, 4, 6, 10],   quality: [4, 6, 10] },
  { id: "7#5",    suffix: "7+5",       intervals: [0, 4, 8, 10],   quality: [4, 8, 10] },
  { id: "aug7",   suffix: "aug7",      intervals: [0, 4, 8, 11],   quality: [4, 8, 11] },
  { id: "maj7",   suffix: "maj7",      intervals: [0, 4, 7, 11],   quality: [4, 11] },
  { id: "m7",     suffix: "m7",        intervals: [0, 3, 7, 10],   quality: [3, 10] },
  { id: "mMaj7",  suffix: "m(maj7)",   intervals: [0, 3, 7, 11],   quality: [3, 11] },
  { id: "7sus4",  suffix: "7sus4",     intervals: [0, 5, 7, 10],   quality: [5, 10] },
  { id: "7sus2",  suffix: "7sus2",     intervals: [0, 2, 7, 10],   quality: [2, 10] },
  { id: "m7b5",   suffix: "m7b5",      intervals: [0, 3, 6, 10],   quality: [3, 6, 10] },
  { id: "dim7",   suffix: "dim7",      intervals: [0, 3, 6, 9],    quality: [3, 6, 9] }
];

function toDisplayName(note) {
  const p = parseNoteName(note);
  if (!p) return note;
  return p.step + (p.accidental === "#" ? "#" : "");
}

function getChordNameForNotes(notes) {
  const uniqNotes = Array.from(new Set(notes));
  if (uniqNotes.length === 0) return { name: "?", root: null };
  if (uniqNotes.length === 1) {
    const n = uniqNotes[0];
    return { name: toDisplayName(n), root: n };
  }

  const midiMap = {};
  const pcMap = {};
  uniqNotes.forEach((n) => {
    const m = noteToMidi(n);
    const pc = m == null ? null : m % 12;
    midiMap[n] = m;
    pcMap[n] = pc;
  });

  const sortedByMidi = uniqNotes
    .slice()
    .sort((a, b) => (midiMap[a] || 0) - (midiMap[b] || 0));

  let best = null;

  uniqNotes.forEach((rootNote) => {
    const rootMidi = midiMap[rootNote];
    const rootPc = pcMap[rootNote];
    if (rootPc == null || rootMidi == null) return;

    const intervalSet = new Set();
    uniqNotes.forEach((n) => {
      const pc = pcMap[n];
      if (pc == null) return;
      const iv = (pc - rootPc + 12) % 12;
      intervalSet.add(iv);
    });
    if (!intervalSet.has(0)) intervalSet.add(0);
    const intervalsArr = Array.from(intervalSet).sort((a, b) => a - b);

    const extIntervals = [1, 2, 3, 5, 6, 8, 9];

    chordTemplates.forEach((tpl) => {
      const tplIntervals = tpl.intervals;
      const considered = intervalsArr.filter((iv) => {
        if (tplIntervals.includes(iv)) return true;
        return !extIntervals.includes(iv);
      });

      const covered = tplIntervals.filter((iv) => intervalSet.has(iv));
      const coverage = covered.length;
      const missingIntervals = tplIntervals.filter((iv) => !intervalSet.has(iv));
      const extra = considered.filter((iv) => !tplIntervals.includes(iv));

      const coverageScore = coverage * (tplIntervals.length >= 5 ? 3.2 : 4);
      const missingScore = missingIntervals.length * -(tplIntervals.length > intervalsArr.length ? 3.5 : 2.5);
      const extraScore = extra.reduce((acc, iv) => {
        if (extIntervals.includes(iv)) return acc - 0.3;
        if (iv === 10 || iv === 11) return acc - 1.8;
        return acc - 1.1;
      }, 0);

      let thirdMismatchPenalty = 0;
      const hasMinorThird = intervalSet.has(3);
      const hasMajorThird = intervalSet.has(4);
      if (tpl.intervals.includes(3) && hasMajorThird && !tpl.intervals.includes(4)) {
        thirdMismatchPenalty -= hasMinorThird ? 0.8 : 3.2;
      }
      if (tpl.intervals.includes(4) && hasMinorThird && !tpl.intervals.includes(3)) {
        thirdMismatchPenalty -= hasMajorThird ? 0.8 : 3.2;
      }

      let tensionPenalty = 0;
      [10, 11].forEach((iv) => {
        if (intervalSet.has(iv) && !tplIntervals.includes(iv)) tensionPenalty -= 3;
      });

      const qualityScore = (tpl.quality || []).reduce((acc, iv) => {
        if (intervalSet.has(iv)) return acc + 1.5;
        return acc - 1;
      }, 0);

      const bassBonus = rootNote === sortedByMidi[0] ? 1 : 0;

      const score =
        coverageScore +
        missingScore +
        extraScore +
        thirdMismatchPenalty +
        tensionPenalty +
        qualityScore +
        bassBonus +
        (tplIntervals.length <= intervalsArr.length ? 0.2 : 0) +
        (coverage === tplIntervals.length ? 0.5 : 0);

      if (
        !best ||
        score > best.score ||
        (score === best.score && rootMidi < best.rootMidi)
      ) {
        best = {
          score,
          rootNote,
          rootMidi,
          rootPc,
          tpl,
          intervalsArr,
          intervalSet
        };
      }
    });
  });

  if (!best || best.score <= 0) {
    const sortedByMidi = uniqNotes
      .slice()
      .sort((a, b) => (midiMap[a] || 0) - (midiMap[b] || 0));
    const root = sortedByMidi[0];
    return { name: toDisplayName(root) + " cluster", root };
  }

  const { rootNote, tpl, intervalsArr, intervalSet } = best;
  const rootName = toDisplayName(rootNote);
  let suffix = tpl.suffix;

  const has = (iv) => intervalSet.has(iv);
  const hasDom7 = has(10);
  const hasMaj7 = has(11);
  const hasSeventh = hasDom7 || hasMaj7;
  const has9thInterval = has(2);
  const hasFlat9Interval = has(1);
  const hasSharp9Interval = has(3) && intervalSet.has(4);
  const has11thInterval = has(5);
  const hasSharp11Interval = has(6);
  const has13thInterval = has(9);
  const hasFlat13Interval = has(8);

  let used9ForName = false;
  let used11ForName = false;
  let used13ForName = false;

  const extraIntervals = intervalsArr.filter((iv) => !tpl.intervals.includes(iv));
  const bassNote = sortedByMidi[0];
  const bassInterval =
    bassNote != null && pcMap[bassNote] != null
      ? (pcMap[bassNote] - best.rootPc + 12) % 12
      : null;
  const isBassOnlyExtra = (iv) =>
    bassInterval != null && extraIntervals.length === 1 && extraIntervals[0] === iv && bassInterval === iv;

  const setExtendedSuffix = (newSuffix) => {
    if (newSuffix && newSuffix !== suffix) {
      suffix = newSuffix;
      return true;
    }
    return false;
  };

  if (has13thInterval && hasSeventh && !isBassOnlyExtra(9)) {
    const applied =
      (hasMaj7 && setExtendedSuffix("maj13")) ||
      (tpl.id === "maj7" && setExtendedSuffix("maj13")) ||
      (tpl.id === "m7" && setExtendedSuffix("m13")) ||
      (tpl.id === "mMaj7" && setExtendedSuffix("m(maj13)")) ||
      (tpl.id === "7" && setExtendedSuffix("13"));
    used13ForName = Boolean(applied);
  }

  if (!used13ForName && has11thInterval && hasSeventh && !isBassOnlyExtra(5)) {
    const applied =
      (hasMaj7 && setExtendedSuffix("maj11")) ||
      (tpl.id === "maj7" && setExtendedSuffix("maj11")) ||
      (tpl.id === "m7" && setExtendedSuffix("m11")) ||
      (tpl.id === "mMaj7" && setExtendedSuffix("m(maj11)")) ||
      (tpl.id === "7" && setExtendedSuffix("11"));
    used11ForName = Boolean(applied);
  }

  if (!used13ForName && !used11ForName && has9thInterval && hasSeventh && !isBassOnlyExtra(2)) {
    const applied =
      (hasMaj7 && setExtendedSuffix("maj9")) ||
      (tpl.id === "maj7" && setExtendedSuffix("maj9")) ||
      (tpl.id === "m7" && setExtendedSuffix("m9")) ||
      (tpl.id === "mMaj7" && setExtendedSuffix("m(maj9)")) ||
      (tpl.id === "7" && setExtendedSuffix("9"));
    used9ForName = Boolean(applied);
  }

  let name = rootName + suffix;

  const missingInts = tpl.intervals.filter((iv) => !intervalSet.has(iv));
  let no5 = false;
  if (missingInts.includes(7) && intervalsArr.length >= 2) no5 = true;
  if (no5) name += "(no5)";

  const needsThird = tpl.intervals.includes(3) || tpl.intervals.includes(4);
  const hasThird = intervalSet.has(3) || intervalSet.has(4);
  if (needsThird && !hasThird) name += "(no3)";

  const ext = [];
  if (
    has9thInterval &&
    !used9ForName &&
    !used11ForName &&
    !used13ForName &&
    !tpl.intervals.includes(2) &&
    !isBassOnlyExtra(2)
  )
    ext.push("add9");
  if (
    has11thInterval &&
    !used11ForName &&
    !used13ForName &&
    !tpl.intervals.includes(5) &&
    tpl.id !== "sus4" &&
    !isBassOnlyExtra(5)
  )
    ext.push("add11");
  if (has13thInterval && !used13ForName && !tpl.intervals.includes(9) && !isBassOnlyExtra(9))
    ext.push("add13");
  if (hasFlat9Interval && !tpl.intervals.includes(1) && !isBassOnlyExtra(1))
    ext.push(hasSeventh ? "b9" : "addb9");
  if (hasSharp9Interval && !tpl.intervals.includes(3) && !isBassOnlyExtra(3))
    ext.push(hasSeventh ? "#9" : "add#9");
  if (hasSharp11Interval && !tpl.intervals.includes(6) && !isBassOnlyExtra(6))
    ext.push(hasSeventh ? "#11" : "add#11");
  if (hasFlat13Interval && !tpl.intervals.includes(8) && !isBassOnlyExtra(8))
    ext.push(hasSeventh ? "b13" : "addb13");
  if (ext.length > 0) name += ext.join("");

  if (bassNote && bassNote !== rootNote) {
    name += "/" + toDisplayName(bassNote);
  }

  return { name, root: rootNote };
}

function createChordItem(notes, x, y) {
  const uniqSortedNotes = Array.from(new Set(notes)).sort(
    (a, b) => (noteToMidi(a) || 0) - (noteToMidi(b) || 0)
  );

  const el = document.createElement("div");
  el.className = "item chord";
  el.dataset.type = "chord";
  el.dataset.notes = uniqSortedNotes.join(",");

  const chordInfo = getChordNameForNotes(uniqSortedNotes);
  el.dataset.chordName = chordInfo.name;
  el.textContent = chordInfo.name;

  const rootForColor = chordInfo.root || uniqSortedNotes[0];
  applyChordVisual(el, rootForColor);

  playArea.appendChild(el);
  positionItem(el, x, y);
  registerItem(el);
  return el;
}

function updateSelectionStyles() {
  items.forEach((el) => {
    if (selectedItems.has(el)) el.classList.add("selected");
    else el.classList.remove("selected");
  });
}

function playElement(el) {
  const type = el.dataset.type;
  if (type === "note") {
    const note = el.dataset.note;
    const freq = noteToFreq(note);
    if (freq) playPiano(freq, 0.7, 0.35);
  } else if (type === "chord") {
    const notes = (el.dataset.notes || "").split(",").filter(Boolean);
    notes.forEach((n) => {
      const freq = noteToFreq(n);
      if (freq) playPiano(freq, 0.8, 0.28);
    });
  } else if (type === "accidental") {
    if (el.dataset.accType === "sharp") playKick();
    else playSnare();
  } else if (type === "octave") {
    if (el.dataset.octDir === "up") playHiHat();
    else playTom();
  }
}

// ---- Undo / Copy helpers ----
function serializeItem(el) {
  const type = el.dataset.type;
  const left = parseFloat(el.style.left) || 0;
  const top = parseFloat(el.style.top) || 0;
  if (type === "note") {
    return {
      type,
      note: el.dataset.note,
      left,
      top,
      displayAcc: el.dataset.displayAcc || "none"
    };
  } else if (type === "chord") {
    return {
      type,
      notes: (el.dataset.notes || "").split(",").filter(Boolean),
      left,
      top
    };
  } else if (type === "accidental") {
    return { type, accType: el.dataset.accType, left, top };
  } else if (type === "octave") {
    return { type, octDir: el.dataset.octDir, left, top };
  }
  return null;
}

function restoreItem(data) {
  if (!data) return null;
  if (data.type === "note") {
    const el = createNoteItem(data.note, data.left, data.top);
    el.dataset.displayAcc = data.displayAcc || "none";
    applyNoteVisual(el);
    return el;
  } else if (data.type === "chord") {
    return createChordItem(data.notes, data.left, data.top);
  } else if (data.type === "accidental") {
    return createAccidentalItem(data.accType, data.left, data.top);
  } else if (data.type === "octave") {
    return createOctaveItem(data.octDir, data.left, data.top);
  }
  return null;
}

function pushUndo(action) {
  undoStack.push(action);
  if (undoStack.length > 200) undoStack.shift();
}

function undoLast() {
  const action = undoStack.pop();
  if (!action) return;

  if (action.type === "add") {
    action.els.forEach((el) => {
      if (items.includes(el)) removeItem(el);
    });
    selectedItems.clear();
    updateSelectionStyles();
  } else if (action.type === "remove") {
    const restored = action.data.map((d) => restoreItem(d));
    selectedItems = new Set(restored);
    updateSelectionStyles();
  } else if (action.type === "combine") {
    action.created.forEach((el) => {
      if (items.includes(el)) removeItem(el);
    });
    const restored = action.removed.map((d) => restoreItem(d));
    selectedItems = new Set(restored);
    updateSelectionStyles();
  }
}

// ---- Double-click duplicate ----
function duplicateFromElement(el) {
  const baseSet = selectedItems.has(el)
    ? Array.from(selectedItems)
    : [el];

  const newEls = baseSet.map((src) => {
    const data = serializeItem(src);
    if (!data) return null;
    data.left += 20;
    data.top += 20;
    return restoreItem(data);
  }).filter(Boolean);

  if (newEls.length) {
    selectedItems = new Set(newEls);
    updateSelectionStyles();
    pushUndo({ type: "add", els: newEls });
  }
}

function onItemDoubleClick(e) {
  e.stopPropagation();
  const el = e.currentTarget;
  duplicateFromElement(el);
}

// ------- Wheel-based octave change -------
function transposeNoteOctave(note, deltaOct) {
  const p = parseNoteName(note);
  if (!p) return note;
  let newOct = p.octave + deltaOct;
  if (newOct < MIN_OCTAVE) newOct = MIN_OCTAVE;
  if (newOct > MAX_OCTAVE) newOct = MAX_OCTAVE;
  return p.step + p.accidental + newOct;
}

function transposeNoteSemitone(note, deltaSemi) {
  const midi = noteToMidi(note);
  if (midi == null) return note;
  const newMidi = midi + deltaSemi;
  return midiToNote(newMidi);
}

function handleItemWheel(item, deltaY) {
  const delta = deltaY < 0 ? +1 : -1;
  if (item.dataset.type === "note") {
    const oldNote = item.dataset.note;
    const newNote = transposeNoteOctave(oldNote, delta);
    if (newNote === oldNote) return;
    item.dataset.note = newNote;
    applyNoteVisual(item);
    playElement(item);
  } else if (item.dataset.type === "chord") {
    const notes = (item.dataset.notes || "").split(",").filter(Boolean);
    if (!notes.length) return;
    const newNotes = notes.map((n) => transposeNoteOctave(n, delta));
    item.dataset.notes = newNotes.join(",");
    const chordInfo = getChordNameForNotes(newNotes);
    item.dataset.chordName = chordInfo.name;
    item.textContent = chordInfo.name;
    const rootForColor = chordInfo.root || newNotes[0];
    applyChordVisual(item, rootForColor);
    playElement(item);
  }
}

playArea.addEventListener(
  "wheel",
  (e) => {
    const item = e.target.closest(".item");
    if (!item) return;
    e.preventDefault();
    handleItemWheel(item, e.deltaY);
  },
  { passive: false }
);

// ------- Dragging items -------
let dragState = null;

function addDragListeners() {
  document.addEventListener("mousemove", onDragPointerMove);
  document.addEventListener("mouseup", onDragPointerUp);
  document.addEventListener("touchmove", onDragPointerMove, { passive: false });
  document.addEventListener("touchend", onDragPointerUp);
  document.addEventListener("touchcancel", onDragPointerUp);
}

function removeDragListeners() {
  document.removeEventListener("mousemove", onDragPointerMove);
  document.removeEventListener("mouseup", onDragPointerUp);
  document.removeEventListener("touchmove", onDragPointerMove);
  document.removeEventListener("touchend", onDragPointerUp);
  document.removeEventListener("touchcancel", onDragPointerUp);
}

function onItemPointerDown(e) {
  const point = getClientPoint(e);
  if (!point) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;

  cancelHoverTooltip();

  if (!selectedItems.has(el)) {
    selectedItems.clear();
    selectedItems.add(el);
  }
  updateSelectionStyles();

  playElement(el);

  const startX = point.x;
  const startY = point.y;
  const dragItems = Array.from(selectedItems);

  dragState = {
    startX,
    startY,
    items: dragItems.map((item) => ({
      el: item,
      left: parseFloat(item.style.left) || 0,
      top: parseFloat(item.style.top) || 0
    }))
  };

  addDragListeners();
}

function onItemHoverStart(e) {
  const el = e.currentTarget;
  if (el.dataset.type !== "chord") return;
  scheduleHoverTooltip(el);
}

function onItemHoverEnd() {
  cancelHoverTooltip();
}

function onDragPointerMove(e) {
  if (!dragState) return;
  const point = getClientPoint(e);
  if (!point) return;
  if (e.cancelable) e.preventDefault();
  const dx = point.x - dragState.startX;
  const dy = point.y - dragState.startY;

  dragState.items.forEach((it) => {
    let newLeft = it.left + dx;
    let newTop = it.top + dy;
    const w = it.el.offsetWidth;
    const h = it.el.offsetHeight;

    newLeft = Math.max(0, Math.min(newLeft, playArea.clientWidth - w));
    newTop = Math.max(0, Math.min(newTop, playArea.clientHeight - h));

    it.el.style.left = newLeft + "px";
    it.el.style.top = newTop + "px";
  });
}

function elementsOverlapForCombine(a, b) {
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const ax = ra.left + ra.width / 2;
  const ay = ra.top + ra.height / 2;
  const bx = rb.left + rb.width / 2;
  const by = rb.top + rb.height / 2;
  const dist = Math.hypot(ax - bx, ay - by);
  const threshold = (ra.width + rb.width) / 2 / 1.2;
  return dist < threshold;
}

function extractNotesFromItem(el) {
  if (el.dataset.type === "note") {
    return [el.dataset.note].filter(Boolean);
  } else if (el.dataset.type === "chord") {
    return (el.dataset.notes || "").split(",").filter(Boolean);
  }
  return [];
}

function applyAccidentalToPitchItem(target, accType) {
  const delta = accType === "sharp" ? +1 : -1;
  if (target.dataset.type === "note") {
    const oldNote = target.dataset.note;
    const newNote = transposeNoteSemitone(oldNote, delta);
    target.dataset.note = newNote;
    target.dataset.displayAcc = accType;
    applyNoteVisual(target);
  } else if (target.dataset.type === "chord") {
    const notes = (target.dataset.notes || "").split(",").filter(Boolean);
    if (!notes.length) return;
    const newNotes = notes.map((n) => transposeNoteSemitone(n, delta));
    target.dataset.notes = newNotes.join(",");
    const chordInfo = getChordNameForNotes(newNotes);
    target.dataset.chordName = chordInfo.name;
    target.textContent = chordInfo.name;
    const rootForColor = chordInfo.root || newNotes[0];
    applyChordVisual(target, rootForColor);
  }
}

function applyOctaveToPitchItem(target, octDir) {
  const deltaOct = octDir === "up" ? +1 : -1;
  if (target.dataset.type === "note") {
    const oldNote = target.dataset.note;
    const newNote = transposeNoteOctave(oldNote, deltaOct);
    target.dataset.note = newNote;
    applyNoteVisual(target);
  } else if (target.dataset.type === "chord") {
    const notes = (target.dataset.notes || "").split(",").filter(Boolean);
    if (!notes.length) return;
    const newNotes = notes.map((n) => transposeNoteOctave(n, deltaOct));
    target.dataset.notes = newNotes.join(",");
    const chordInfo = getChordNameForNotes(newNotes);
    target.dataset.chordName = chordInfo.name;
    target.textContent = chordInfo.name;
    const rootForColor = chordInfo.root || newNotes[0];
    applyChordVisual(target, rootForColor);
  }
}

function tryCombineItem(anchorEl) {
  if (!anchorEl) return;

  for (const other of items) {
    if (other === anchorEl) continue;
    if (!elementsOverlapForCombine(anchorEl, other)) continue;

    const typeA = anchorEl.dataset.type;
    const typeB = other.dataset.type;

    // Accidentals
    if (typeA === "accidental" && (typeB === "note" || typeB === "chord")) {
      applyAccidentalToPitchItem(other, anchorEl.dataset.accType);
      removeItem(anchorEl);
      playElement(other);
      return;
    }
    if (typeB === "accidental" && (typeA === "note" || typeA === "chord")) {
      applyAccidentalToPitchItem(anchorEl, other.dataset.accType);
      removeItem(other);
      playElement(anchorEl);
      return;
    }

    // Octave tokens
    if (typeA === "octave" && (typeB === "note" || typeB === "chord")) {
      applyOctaveToPitchItem(other, anchorEl.dataset.octDir);
      removeItem(anchorEl);
      playElement(other);
      return;
    }
    if (typeB === "octave" && (typeA === "note" || typeA === "chord")) {
      applyOctaveToPitchItem(anchorEl, other.dataset.octDir);
      removeItem(other);
      playElement(anchorEl);
      return;
    }

    if ((typeA === "accidental" && typeB === "accidental") ||
        (typeA === "octave" && typeB === "octave") ||
        (typeA === "accidental" && typeB === "octave") ||
        (typeA === "octave" && typeB === "accidental")) {
      continue;
    }

    // Normal note/chord combination → chord
    const notesA = extractNotesFromItem(anchorEl);
    const notesB = extractNotesFromItem(other);
    if (notesA.length === 0 || notesB.length === 0) continue;

    const rectA = anchorEl.getBoundingClientRect();
    the_rectB = other.getBoundingClientRect();
    const areaRect = playArea.getBoundingClientRect();
    const centerX =
      (rectA.left + rectA.width / 2 + the_rectB.left + the_rectB.width / 2) / 2 -
      areaRect.left;
    const centerY =
      (rectA.top + rectA.height / 2 + the_rectB.top + the_rectB.height / 2) / 2 -
      areaRect.top;

    const combinedNotes = Array.from(new Set([...notesA, ...notesB]));

    const removedData = [
      serializeItem(anchorEl),
      serializeItem(other)
    ];

    removeItem(anchorEl);
    removeItem(other);

    const newChord = createChordItem(combinedNotes, centerX - 35, centerY - 16);
    pushUndo({ type: "combine", created: [newChord], removed: removedData });

    playElement(newChord);
    updateSelectionStyles();
    break;
  }
}

function onDragPointerUp(e) {
  if (!dragState) return;
  removeDragListeners();
  const point = getClientPoint(e);
  if (!point) {
    dragState = null;
    return;
  }

  const paletteRect = palette.getBoundingClientRect();
  const cx = point.x;
  const cy = point.y;

  if (
    cx >= paletteRect.left &&
    cx <= paletteRect.right &&
    cy >= paletteRect.top &&
    cy <= paletteRect.bottom
  ) {
    const removedData = dragState.items
      .map((it) => serializeItem(it.el))
      .filter(Boolean);
    dragState.items.forEach((it) => removeItem(it.el));
    selectedItems.clear();
    updateSelectionStyles();
    if (removedData.length) {
      pushUndo({ type: "remove", data: removedData });
    }
  } else if (dragState.items.length === 1) {
    tryCombineItem(dragState.items[0].el);
  }

  dragState = null;
}

// Palette styling + drag
function stylePaletteNotes() {
  document.querySelectorAll(".palette-note").forEach((p) => {
    const note = p.dataset.note;
    p.dataset.note = note;
    const parsed = parseNoteName(note);
    const step = parsed ? parsed.step : null;
    const color = baseColors[step] || "#9ca3af";
    p.style.background = color;
    p.style.color = "#020617";

    const midi = noteToMidi(note);
    if (midi != null) {
      const pc = ((midi % 12) + 12) % 12;
      let base = namesSharpPC[pc].replace("#", "");
      base = base.replace("#", "♯").replace("b", "♭");
      p.textContent = base;
    }
  });
}

function setupPaletteDrag() {
  // Notes
  document.querySelectorAll(".palette-note").forEach((p) => {
    const startNoteDrag = (e) => {
      const point = getClientPoint(e);
      if (!point) return;
      e.preventDefault();
      const note = p.dataset.note;
      const areaRect = playArea.getBoundingClientRect();
      const x = point.x - areaRect.left - 25;
      const y = point.y - areaRect.top - 25;

      const item = createNoteItem(note, x, y);
      selectedItems.clear();
      selectedItems.add(item);
      updateSelectionStyles();

      playElement(item);
      pushUndo({ type: "add", els: [item] });

      const startX = point.x;
      const startY = point.y;
      dragState = {
        startX,
        startY,
        items: [
          {
            el: item,
            left: parseFloat(item.style.left) || 0,
            top: parseFloat(item.style.top) || 0
          }
        ]
      };
      addDragListeners();
    };
    p.addEventListener("mousedown", startNoteDrag);
    p.addEventListener("touchstart", startNoteDrag, { passive: false });
  });

  // Accidentals
  document.querySelectorAll(".palette-acc").forEach((p) => {
    const startAccDrag = (e) => {
      const point = getClientPoint(e);
      if (!point) return;
      e.preventDefault();
      const accType = p.dataset.acc;
      const areaRect = playArea.getBoundingClientRect();
      const x = point.x - areaRect.left - 20;
      const y = point.y - areaRect.top - 20;

      const item = createAccidentalItem(accType, x, y);
      selectedItems.clear();
      selectedItems.add(item);
      updateSelectionStyles();

      playElement(item);
      pushUndo({ type: "add", els: [item] });

      const startX = point.x;
      const startY = point.y;
      dragState = {
        startX,
        startY,
        items: [
          {
            el: item,
            left: parseFloat(item.style.left) || 0,
            top: parseFloat(item.style.top) || 0
          }
        ]
      };
      addDragListeners();
    };
    p.addEventListener("mousedown", startAccDrag);
    p.addEventListener("touchstart", startAccDrag, { passive: false });
  });

  // Octave tokens
  document.querySelectorAll(".palette-oct").forEach((p) => {
    const startOctDrag = (e) => {
      const point = getClientPoint(e);
      if (!point) return;
      e.preventDefault();
      const octDir = p.dataset.oct;
      const areaRect = playArea.getBoundingClientRect();
      const x = point.x - areaRect.left - 22;
      const y = point.y - areaRect.top - 22;

      const item = createOctaveItem(octDir, x, y);
      selectedItems.clear();
      selectedItems.add(item);
      updateSelectionStyles();

      playElement(item);
      pushUndo({ type: "add", els: [item] });

      const startX = point.x;
      const startY = point.y;
      dragState = {
        startX,
        startY,
        items: [
          {
            el: item,
            left: parseFloat(item.style.left) || 0,
            top: parseFloat(item.style.top) || 0
          }
        ]
      };
      addDragListeners();
    };
    p.addEventListener("mousedown", startOctDrag);
    p.addEventListener("touchstart", startOctDrag, { passive: false });
  });
}

// ------- Box selection -------
let selectionState = null;

playArea.addEventListener("mousedown", (e) => {
  if (e.target !== playArea || selectionState) return;
  e.preventDefault();
  const point = getClientPoint(e);
  if (!point) return;

  const startX = point.x;
  const startY = point.y;
  const areaRect = playArea.getBoundingClientRect();

  selectionState = {
    startX,
    startY,
    moved: false,
    areaRect,
    lastInside: new Set()
  };

  selectionBox.style.display = "block";
  selectionBox.style.left = startX - areaRect.left + "px";
  selectionBox.style.top = startY - areaRect.top + "px";
  selectionBox.style.width = "0px";
  selectionBox.style.height = "0px";
  document.addEventListener("mousemove", onSelectionPointerMove);
  document.addEventListener("mouseup", onSelectionPointerUp);
});

function onSelectionPointerMove(e) {
  if (!selectionState) return;
  const point = getClientPoint(e);
  if (!point) return;
  if (e.cancelable) e.preventDefault();
  const areaRect = selectionState.areaRect;
  const x1 = selectionState.startX;
  const y1 = selectionState.startY;
  const x2 = point.x;
  const y2 = point.y;

  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const maxX = Math.max(x1, x2);
  const maxY = Math.max(y1, y2);

  const width = maxX - minX;
  const height = maxY - minY;

  if (width > 3 || height > 3) selectionState.moved = true;

  selectionBox.style.left = minX - areaRect.left + "px";
  selectionBox.style.top = minY - areaRect.top + "px";
  selectionBox.style.width = width + "px";
  selectionBox.style.height = height + "px";

  const selRect = { left: minX, top: minY, right: maxX, bottom: maxY };

  const currentInside = [];
  items.forEach((el) => {
    const r = el.getBoundingClientRect();
    const intersects = !(
      r.right < selRect.left ||
      r.left > selRect.right ||
      r.bottom < selRect.top ||
      r.top > selRect.bottom
    );
    if (intersects) currentInside.push(el);
  });

  selectedItems = new Set(currentInside);
  updateSelectionStyles();

  let hasNew = false;
  for (const el of currentInside) {
    if (!selectionState.lastInside.has(el)) {
      hasNew = true;
      break;
    }
  }

  if (hasNew && currentInside.length > 0) {
    currentInside.forEach((el) => playElement(el));
  }

  selectionState.lastInside = new Set(currentInside);
}

function onSelectionPointerUp() {
  if (!selectionState) return;
  document.removeEventListener("mousemove", onSelectionPointerMove);
  document.removeEventListener("mouseup", onSelectionPointerUp);

  selectionBox.style.display = "none";

  if (!selectionState.moved) {
    selectedItems.clear();
    updateSelectionStyles();
    selectionState = null;
    return;
  }

  selectionState = null;
}

// Playback line
let isPlaying = false;
let playedSet = null;

function startPlayback() {
  if (isPlaying) return;
  getAudioCtx();
  isPlaying = true;
  playButton.classList.add("playing");
  playButton.textContent = "■ Stop";

  const areaRect = playArea.getBoundingClientRect();
  const width = playArea.clientWidth;
  playedSet = new Set();
  playHead.style.display = "block";
  playHead.style.left = "0px";

  const start = performance.now();

  function step(now) {
    if (!isPlaying) return;
    const t = (now - start) / 1000;
    const speed = playSpeed;
    let x = t * speed;
    if (x > width) x = width;

    playHead.style.left = x + "px";

    items.forEach((el) => {
      if (playedSet.has(el)) return;
      const r = el.getBoundingClientRect();
      const centerX = r.left + r.width / 2 - areaRect.left;
      if (centerX <= x) {
        playedSet.add(el);
        playElement(el);
      }
    });

    if (x >= width) {
      stopPlayback();
    } else {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function stopPlayback() {
  if (!isPlaying) return;
  isPlaying = false;
  playButton.classList.remove("playing");
  playButton.textContent = "▶ Play";
  playHead.style.display = "none";
  playedSet = null;
}

playButton.addEventListener("click", () => {
  if (isPlaying) stopPlayback();
  else startPlayback();
});

window.addEventListener("resize", () => {
  items.forEach((el) => {
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    positionItem(el, left, top);
  });
});

// Keyboard shortcuts: Ctrl+C/V/Z and Space
document.addEventListener("keydown", (e) => {
  // Space: toggle playback (ignore when focused in inputs)
  if (
    e.code === "Space" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    e.target === document.body
  ) {
    e.preventDefault();
    if (isPlaying) stopPlayback();
    else startPlayback();
    return;
  }

  const key = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (key === "c") {
      e.preventDefault();
      handleCopy();
    } else if (key === "v") {
      e.preventDefault();
      handlePaste();
    } else if (key === "z") {
      e.preventDefault();
      undoLast();
    }
  }
});

// Copy / paste
function handleCopy() {
  if (!selectedItems.size) return;
  clipboardData = Array.from(selectedItems)
    .map(serializeItem)
    .filter(Boolean);
}

function handlePaste() {
  if (!clipboardData || !clipboardData.length) return;
  const newEls = clipboardData.map((d) => {
    const data = { ...d, left: d.left + 20, top: d.top + 20 };
    return restoreItem(data);
  }).filter(Boolean);
  if (newEls.length) {
    selectedItems = new Set(newEls);
    updateSelectionStyles();
    pushUndo({ type: "add", els: newEls });
  }
}

// Help overlay logic
function showHelp() {
  helpOverlay.classList.add("visible");
}
function hideHelp() {
  helpOverlay.classList.remove("visible");
}
helpButton.addEventListener("click", () => {
  showHelp();
});
helpCloseButton.addEventListener("click", () => {
  hideHelp();
});
helpOverlay.addEventListener("click", (e) => {
  if (e.target === helpOverlay) {
    hideHelp();
  }
});

// Init
stylePaletteNotes();
setupPaletteDrag();
updateMobilePalettePadding();
// Show help on first load
showHelp();
