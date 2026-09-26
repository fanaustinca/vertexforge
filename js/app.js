import * as G from './geom.js';
import * as C from './construct.js';
import { compile } from './expr.js';
import { SETTINGS_DEF, PRESETS, SIDE_NAMES, HELP } from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LETTERS = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + (i % 26)) + Math.floor(i / 26));
const DASHES = ['solid', 'dashed', 'dotted', 'dashdot'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/* ======================= settings ======================= */

const S = {};
function loadSettings() {
  const raw = store.get('vf.settings') || {};
  for (const d of SETTINGS_DEF) S[d.key] = validSetting(d, raw[d.key]) ? raw[d.key] : d.def;
}
function validSetting(d, v) {
  if (v === undefined) return false;
  if (d.type === 'bool') return typeof v === 'boolean';
  if (d.type === 'number') return typeof v === 'number' && isFinite(v) && v >= d.min && v <= d.max;
  if (d.type === 'color') return typeof v === 'string' && COLOR_RE.test(v);
  if (d.type === 'select') return d.options.some(([k]) => k === v);
  if (d.type === 'text') return typeof v === 'string' && v.length <= 12;
  return false;
}
function setSetting(key, v) {
  S[key] = v;
  store.set('vf.settings', S);
  applySettingsSideEffects();
}
function applySettingsSideEffects() {
  document.documentElement.dataset.theme = S.theme;
  $('#tglGrid').setAttribute('aria-pressed', S.showGrid);
  if (document.activeElement !== $('#gridSizeInput')) $('#gridSizeInput').value = S.gridSize;
  document.documentElement.style.setProperty('--snap', S.snapColor);
  $('#presetSection').hidden = !S.showSpecialShapes;
  $('#objSection').hidden = !S.showObjectsPanel;
  $('#funcSection').hidden = !S.showFunctionsPanel;
  updateHud();
  renderProps();
  requestRender();
}

/* ======================= document ======================= */

let doc = { objects: [] };
const view = { cx: 0, cy: 0, scale: 48 };
let sel = [];
let tool = 'select';
let shapeSides = 4;
const toolsOn = { rightTri: false, area: false };
let vertexEdit = null; // id of polygon in corner-edit mode
let pick = null; // {type: 'point'|'line', hint, cb} while a construction waits for a click
let clipboard = null;
const funcCache = new Map();

const byId = (id) => doc.objects.find((o) => o.id === id);
const selected = () => sel.map(byId).filter(Boolean);
const single = () => (sel.length === 1 ? byId(sel[0]) : null);

// Key points of an object (for fitting, marquee selection, moving).
function objPoints(o) {
  if (o.type === 'shape') return G.outline(o, 32);
  if (o.type === 'line') return [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }];
  if (o.type === 'angle') return [{ x: o.ax, y: o.ay }, { x: o.vx, y: o.vy }, { x: o.bx, y: o.by }];
  if (o.type === 'point' || o.type === 'text') return [{ x: o.x, y: o.y }];
  return [];
}
function shiftObj(t, dx, dy) {
  if (t.type === 'shape') { t.cx += dx; t.cy += dy; }
  else if (t.type === 'line') { t.x1 += dx; t.y1 += dy; t.x2 += dx; t.y2 += dy; }
  else if (t.type === 'point' || t.type === 'text') { t.x += dx; t.y += dy; }
  else if (t.type === 'angle') { t.ax += dx; t.ay += dy; t.vx += dx; t.vy += dy; t.bx += dx; t.by += dy; }
}
function angleValue(o) {
  const a1 = Math.atan2(o.ay - o.vy, o.ax - o.vx), a2 = Math.atan2(o.by - o.vy, o.bx - o.vx);
  let d = Math.abs(a1 - a2) / G.DEG;
  if (d > 180) d = 360 - d;
  return o.reflex ? 360 - d : d;
}

function shapeStyle() {
  return { stroke: S.shapeStroke, width: S.shapeWidth, dash: 'solid', fill: S.shapeFill, fillAlpha: S.shapeFillAlpha };
}
function lineStyle() {
  return { stroke: S.lineColor, width: S.lineWidth, dash: S.lineDash };
}

function makeShape(n, cx, cy, w, h) {
  const o = { id: uid(), type: 'shape', kind: 'polygon', cx, cy, w, h, rot: 0, pts: null, style: shapeStyle(), snapN: S.defaultSnapN, name: '' };
  if (n === 1) o.kind = 'ellipse';
  else if (n === 2) o.kind = 'semi';
  else o.pts = G.regularUnit(n);
  return o;
}
function defaultDims(n) {
  const s = S.defaultSize;
  if (n === 1) return [s, s];
  if (n === 2) return [s, s / 2];
  return [s, s * G.regularAspect(n)];
}
function sidesOf(o) {
  if (o.type !== 'shape') return 0;
  if (o.kind === 'ellipse') return 1;
  if (o.kind === 'semi') return 2;
  return o.pts.length;
}
function shapeName(o) {
  if (o.name) return o.name;
  if (o.type === 'line') return o.ext === 'line' ? 'Line' : o.ext === 'ray' ? 'Ray' : 'Line segment';
  if (o.type === 'point') return 'Point';
  if (o.type === 'text') return 'Text';
  if (o.type === 'func') return 'Function';
  if (o.type === 'angle') return `Angle ${fmtAng(angleValue(o))}`;
  if (o.kind === 'ellipse') return G.isCircle(o) ? 'Circle' : 'Oval';
  if (o.kind === 'semi') return G.isCircle(o) ? 'Semicircle' : 'Half-oval';
  const n = o.pts.length;
  return `${SIDE_NAMES[n] || n + '-gon'}`.replace('Square', n === 4 ? 'Quadrilateral' : 'Square');
}

function addObject(o, select = true) {
  doc.objects.push(o);
  if (select) setSelection([o.id]);
  return o;
}

// Free spot near the view center so repeated inserts don't stack exactly.
function insertPoint() {
  const step = S.defaultSize * 0.3;
  let c = { x: view.cx, y: view.cy };
  for (let i = 0; i < 12; i++) {
    const taken = doc.objects.some((o) => o.type === 'shape' && Math.hypot(o.cx - c.x, o.cy - c.y) < step * 0.5);
    if (!taken) break;
    c = { x: c.x + step, y: c.y - step };
  }
  return c;
}

function insertShape(n, at) {
  const [w, h] = defaultDims(n);
  const c = at || insertPoint();
  pushUndo();
  const o = addObject(makeShape(n, c.x, c.y, w, h));
  if (n === 4) o.name = 'Square';
  changed();
  toast(`Inserted ${shapeName(o).toLowerCase()} — drag the handles to resize, right-click for more`);
  return o;
}

function insertPreset(p, at) {
  const c = at || insertPoint();
  pushUndo();
  if (p.kind === 'ellipse') {
    const o = addObject(makeShape(1, c.x, c.y, S.defaultSize, S.defaultSize / 2));
    o.name = '';
    changed();
    return o;
  }
  const raw = p.pts.map(([x, y]) => ({ x, y }));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of raw) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  const k = S.defaultSize / Math.max(x1 - x0, y1 - y0);
  const world = raw.map((q) => ({ x: c.x + (q.x - (x0 + x1) / 2) * k, y: c.y + (q.y - (y0 + y1) / 2) * k }));
  const o = makeShape(3, 0, 0, 1, 1);
  o.name = p.name.replace(/ \(.*\)$/, '');
  G.setPolyFromWorld(o, world);
  addObject(o);
  changed();
  toast(`Inserted ${p.name}`);
  return o;
}

/* ---------- inscribed shapes ---------- */

function childrenOf(id) { return doc.objects.filter((o) => o.inscribed && o.inscribed.parent === id); }
function descendants(id, acc = new Set()) {
  for (const c of childrenOf(id)) if (!acc.has(c.id)) { acc.add(c.id); descendants(c.id, acc); }
  return acc;
}
function applyInscribeResult(child, r) {
  if (r.kind === 'polygon') {
    child.kind = 'polygon'; child.rot = r.rot;
    G.setPolyFromWorld(child, r.world);
  } else {
    Object.assign(child, { kind: r.kind, cx: r.cx, cy: r.cy, w: r.w, h: r.h, rot: r.rot, pts: null });
  }
}
function updateInscribed(parentId, depth = 0) {
  if (!S.inscribeFollow || depth > 8) return;
  const p = byId(parentId);
  if (!p) return;
  for (const c of childrenOf(parentId)) {
    const r = G.inscribe(p, c.inscribed.kind, c.inscribed.n);
    if (!r.error) applyInscribeResult(c, r);
    updateInscribed(c.id, depth + 1);
  }
}
function detach(o) { if (o.inscribed) o.inscribed = null; }

function doInscribe(host, kind, n) {
  const r = G.inscribe(host, kind, n);
  if (r.error) { toast(r.error, true); return; }
  pushUndo();
  const c = makeShape(3, 0, 0, 1, 1);
  c.style.stroke = S.inscribeColor; c.style.fill = S.inscribeColor; c.style.fillAlpha = Math.min(S.shapeFillAlpha, 0.1);
  applyInscribeResult(c, r);
  c.inscribed = { parent: host.id, kind, n };
  // put it right above its parent
  const i = doc.objects.indexOf(host);
  doc.objects.splice(i + 1, 0, c);
  setSelection([c.id]);
  changed();
  toast(`Inscribed ${shapeName(c).toLowerCase()} in ${shapeName(host).toLowerCase()}`);
}

/* ---------- serialization / sanitizing ---------- */

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const colr = (v, d) => (typeof v === 'string' && COLOR_RE.test(v) ? v : d);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
function cleanStyle(s = {}, shape) {
  const out = { stroke: colr(s.stroke, '#38bdf8'), width: clamp(num(s.width, 2), 0.25, 40), dash: DASHES.includes(s.dash) ? s.dash : 'solid' };
  if (shape) { out.fill = colr(s.fill, out.stroke); out.fillAlpha = clamp(num(s.fillAlpha, 0.12), 0, 1); }
  return out;
}
function sanitizeObj(o) {
  const r = sanitizeInner(o);
  if (r && o.hidden) r.hidden = true;
  if (r && o.locked) r.locked = true;
  return r;
}
function sanitizeInner(o) {
  if (!o || typeof o !== 'object') return null;
  const id = typeof o.id === 'string' && /^[\w-]{1,20}$/.test(o.id) ? o.id : uid();
  switch (o.type) {
    case 'shape': {
      const kind = ['polygon', 'ellipse', 'semi'].includes(o.kind) ? o.kind : null;
      if (!kind) return null;
      const r = { id, type: 'shape', kind, cx: num(o.cx), cy: num(o.cy), w: Math.max(num(o.w, 1), 1e-6), h: Math.max(num(o.h, 1), 1e-6), rot: num(o.rot), pts: null, style: cleanStyle(o.style, true), snapN: clamp(Math.round(num(o.snapN)), 0, 500), name: str(o.name, 40) };
      if (kind === 'polygon') {
        if (!Array.isArray(o.pts) || o.pts.length < 3 || o.pts.length > 200) return null;
        r.pts = o.pts.map((p) => [clamp(num(p?.[0]), -1, 1), clamp(num(p?.[1]), -1, 1)]);
      }
      if (o.inscribed && typeof o.inscribed.parent === 'string' && ['circle', 'ellipse', 'square', 'rect', 'ngon'].includes(o.inscribed.kind)) {
        r.inscribed = { parent: o.inscribed.parent, kind: o.inscribed.kind, n: clamp(Math.round(num(o.inscribed.n, 3)), 1, 20) };
      }
      return r;
    }
    case 'line':
      return { id, type: 'line', x1: num(o.x1), y1: num(o.y1), x2: num(o.x2), y2: num(o.y2), style: cleanStyle(o.style), ext: ['segment', 'ray', 'line'].includes(o.ext) ? o.ext : 'segment', arrows: ['none', 'end', 'both'].includes(o.arrows) ? o.arrows : 'none', name: str(o.name, 40) };
    case 'point':
      return { id, type: 'point', x: num(o.x), y: num(o.y), style: cleanStyle(o.style), label: str(o.label, 20) };
    case 'text':
      return { id, type: 'text', x: num(o.x), y: num(o.y), text: str(o.text, 300) || 'Text', size: clamp(num(o.size, 16), 6, 120), style: cleanStyle(o.style) };
    case 'func':
      return {
        id, type: 'func', expr: str(o.expr, 300), style: cleanStyle(o.style), hidden: !!o.hidden,
        alpha: clamp(num(o.alpha, 1), 0.05, 1),
        xMin: typeof o.xMin === 'number' && isFinite(o.xMin) ? o.xMin : null,
        xMax: typeof o.xMax === 'number' && isFinite(o.xMax) ? o.xMax : null,
        showLabel: !!o.showLabel, endDots: !!o.endDots,
      };
    case 'angle':
      return { id, type: 'angle', ax: num(o.ax), ay: num(o.ay), vx: num(o.vx), vy: num(o.vy), bx: num(o.bx), by: num(o.by), style: cleanStyle(o.style), reflex: !!o.reflex, name: str(o.name, 40) };
  }
  return null;
}
function loadDocData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.o)) throw new Error('Not a Vertex Forge graph');
  const objs = data.o.slice(0, 5000).map(sanitizeObj).filter(Boolean);
  const ids = new Set();
  for (const o of objs) { while (ids.has(o.id)) o.id = uid(); ids.add(o.id); }
  doc = { objects: objs };
  if (data.view) {
    view.cx = num(data.view.cx); view.cy = num(data.view.cy);
    view.scale = clamp(num(data.view.scale, 48), 0.001, 1e6);
  }
  if (data.grid && typeof data.grid.size === 'number' && data.grid.size >= 0.01 && data.grid.size <= 1000) S.gridSize = data.grid.size;
  sel = []; vertexEdit = null;
}
function docData() {
  return { v: 1, o: doc.objects, view: { cx: view.cx, cy: view.cy, scale: view.scale }, grid: { size: S.gridSize } };
}
const roundJSON = (obj) => JSON.stringify(obj, (k, v) => (typeof v === 'number' ? +v.toPrecision(10) : v));

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function encodeShare() {
  const bytes = new TextEncoder().encode(roundJSON(docData()));
  if (typeof CompressionStream !== 'undefined') {
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return 'VF1.' + b64url(new Uint8Array(buf));
  }
  return 'VF0.' + b64url(bytes);
}
async function decodeShare(code) {
  code = code.trim().replace(/^.*[#&]g=/, '').replace(/\s+/g, '');
  const m = /^VF([01])\.([\w-]+)$/.exec(code);
  if (!m) throw new Error('That doesn’t look like a Vertex Forge code (it should start with VF1.)');
  let bytes = unb64url(m[2]);
  if (m[1] === '1') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unpack compressed codes.');
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- history ---------- */

let undoStack = [], redoStack = [];
let editPending = false;
const snapshot = () => JSON.stringify(doc.objects);
function pushUndo() {
  undoStack.push(snapshot());
  while (undoStack.length > S.historyLimit) undoStack.shift();
  redoStack = [];
}
function beginEdit() { if (!editPending) { pushUndo(); editPending = true; } }
function endEdit() { editPending = false; }
function undo() {
  if (!undoStack.length) return toast('Nothing to undo');
  redoStack.push(snapshot());
  doc.objects = JSON.parse(undoStack.pop());
  afterRestore();
}
function redo() {
  if (!redoStack.length) return toast('Nothing to redo');
  undoStack.push(snapshot());
  doc.objects = JSON.parse(redoStack.pop());
  afterRestore();
}
function afterRestore() {
  sel = sel.filter((id) => byId(id));
  if (vertexEdit && !byId(vertexEdit)) vertexEdit = null;
  changed();
}

let saveTimer = 0;
function changed() {
  requestRender();
  renderProps();
  renderFuncList();
  renderObjList();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (S.autosave) store.set('vf.current', docData()); }, 300);
}

/* ======================= canvas & view ======================= */

const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
let cw = 0, ch = 0, dpr = 1;
const W2S = (p) => ({ x: (p.x - view.cx) * view.scale + cw / 2, y: ch / 2 - (p.y - view.cy) * view.scale });
const S2W = (p) => ({ x: (p.x - cw / 2) / view.scale + view.cx, y: (ch / 2 - p.y) / view.scale + view.cy });

function resize() {
  const r = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  cw = r.width; ch = r.height;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  requestRender();
}
new ResizeObserver(resize).observe($('#stage'));

let rafPending = false;
function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

function zoomAt(sp, factor) {
  const before = S2W(sp);
  view.scale = clamp(view.scale * factor, 0.002, 2e5);
  const after = S2W(sp);
  view.cx += before.x - after.x; view.cy += before.y - after.y;
  requestRender(); updateHud();
}
function fitAll() {
  const pts = [];
  for (const o of doc.objects) if (!o.hidden) pts.push(...objPoints(o));
  if (!pts.length) { view.cx = 0; view.cy = 0; view.scale = 48; requestRender(); updateHud(); return; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
  view.scale = clamp(Math.min((cw - 120) / Math.max(x1 - x0, 1e-3), (ch - 120) / Math.max(y1 - y0, 1e-3)), 0.002, 2e5);
  requestRender(); updateHud();
}

/* ======================= theme colors ======================= */

function theme() {
  const t = themeBase();
  return { ...t, sel: S.selColor, hover: hexA(S.selColor, 0.38) };
}
function themeBase() {
  return S.theme === 'light'
    ? { bg: '#fbfaf6', minor: 'rgba(30,41,59,0.07)', major: 'rgba(30,41,59,0.17)', axis: 'rgba(15,23,42,0.62)', text: '#1e293b', muted: '#64748b', labelBg: 'rgba(255,255,255,0.92)', sel: '#2563eb', handle: '#ffffff', hover: 'rgba(37,99,235,0.35)' }
    : { bg: '#0b1220', minor: 'rgba(148,163,184,0.09)', major: 'rgba(148,163,184,0.2)', axis: 'rgba(226,232,240,0.55)', text: '#e2e8f0', muted: '#94a3b8', labelBg: 'rgba(11,18,32,0.86)', sel: '#60a5fa', handle: '#0b1220', hover: 'rgba(96,165,250,0.4)' };
}

/* ======================= rendering ======================= */

const textBoxes = new Map(); // text id -> screen rect, filled during render
let hoverId = null;
let snapHint = null;
let draft = null; // in-progress line / shape / measure / marquee
let measureShown = null;

function fx(v) {
  const s = v.toFixed(S.decimals);
  return S.trimZeros && s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
function fmtLen(v) { return fx(v) + (S.units ? ' ' + S.units : ''); }
function fmtArea(v) { return fx(v) + (S.units ? ' ' + S.units + '²' : ' u²'); }
function fmtAng(deg) { return S.angleUnit === 'rad' ? fx(deg * G.DEG) + ' rad' : fx(deg) + '°'; }
function niceNum(v) { const r = +v.toPrecision(10); return Math.abs(r) < 1e-12 ? '0' : String(r); }

function dashFor(dash, w) {
  const k = Math.max(w, 1.5);
  if (dash === 'dashed') return [k * 4, k * 2.5];
  if (dash === 'dotted') return [0.01, k * 2.2];
  if (dash === 'dashdot') return [k * 5, k * 2, 0.01, k * 2];
  return [];
}
function strokeWith(style, extraWidth = 0) {
  ctx.setLineDash(dashFor(style.dash, style.width));
  ctx.lineCap = style.dash === 'dotted' || style.dash === 'dashdot' ? 'round' : 'butt';
  ctx.lineJoin = 'round';
  ctx.lineWidth = style.width + extraWidth;
  ctx.strokeStyle = style.stroke;
  ctx.stroke();
  ctx.setLineDash([]);
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function pathShape(o) {
  ctx.beginPath();
  if (o.kind === 'ellipse') {
    const c = W2S({ x: o.cx, y: o.cy });
    ctx.ellipse(c.x, c.y, (o.w / 2) * view.scale, (o.h / 2) * view.scale, -o.rot, 0, G.TAU);
    return;
  }
  const pts = G.outline(o, 240).map(W2S);
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function render() {
  const T = theme();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, cw, ch);
  drawGrid(T);
  textBoxes.clear();
  for (const o of doc.objects) drawObject(o, T);
  drawOverlayLabels(T);
  drawSnapPoints();
  drawSelection(T);
  drawFlash(T);
  drawDraft(T);
  if (snapHint) {
    const p = W2S(snapHint);
    const col = snapHint.kind === 'snap' ? S.snapColor : snapHint.kind === 'intersection' ? '#fb923c' : T.sel;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    if (snapHint.kind === 'intersection') {
      ctx.beginPath(); ctx.moveTo(p.x - 7, p.y - 7); ctx.lineTo(p.x + 7, p.y + 7); ctx.moveTo(p.x + 7, p.y - 7); ctx.lineTo(p.x - 7, p.y + 7); ctx.stroke();
    } else if (snapHint.kind === 'midpoint') {
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x + 8, p.y + 6); ctx.lineTo(p.x - 8, p.y + 6); ctx.closePath(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(p.x, p.y, snapHint.kind === 'on outline' ? 6 : 9, 0, G.TAU); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, G.TAU); ctx.fillStyle = col; ctx.fill();
    if (S.showSnapTag && snapHint.kind && snapHint.kind !== 'grid') {
      ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = col; ctx.fillText(snapHint.kind === 'snap' ? 'snap point' : snapHint.kind, p.x + 13, p.y - 12);
    }
  }
}

function drawGrid(T) {
  const base = S.gridSize;
  let step = base, mult = 1;
  const seq = [2, 2.5, 2];
  let i = 0;
  while (step * view.scale < 9) { step *= seq[i++ % 3]; mult++; }
  const major = step * S.gridMajor;
  const tl = S2W({ x: 0, y: 0 }), br = S2W({ x: cw, y: ch });
  ctx.lineWidth = 1;
  if (S.showGrid) {
    const drawLines = (st, color) => {
      if (st * view.scale < 4) return;
      ctx.beginPath();
      for (let x = Math.ceil(tl.x / st) * st; x <= br.x; x += st) { const sx = Math.round(W2S({ x, y: 0 }).x) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, ch); }
      for (let y = Math.ceil(br.y / st) * st; y <= tl.y; y += st) { const sy = Math.round(W2S({ x: 0, y }).y) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(cw, sy); }
      ctx.strokeStyle = color; ctx.stroke();
    };
    const drawDots = (st, color, r) => {
      if (st * view.scale < 7) return;
      const nx = (br.x - tl.x) / st, ny = (tl.y - br.y) / st;
      if (nx * ny > 60000) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let x = Math.ceil(tl.x / st) * st; x <= br.x; x += st) {
        const sx = W2S({ x, y: 0 }).x;
        for (let y = Math.ceil(br.y / st) * st; y <= tl.y; y += st) { const sy = W2S({ x: 0, y }).y; ctx.moveTo(sx + r, sy); ctx.arc(sx, sy, r, 0, G.TAU); }
      }
      ctx.fill();
    };
    if (S.gridStyle === 'dots') {
      if (S.showMinor) drawDots(step, T.major, 1.1);
      drawDots(major, T.axis, 1.7);
    } else {
      if (S.showMinor) drawLines(step, T.minor);
      drawLines(major, T.major);
    }
  }
  const o = W2S({ x: 0, y: 0 });
  if (S.showAxes) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(o.y) + 0.5); ctx.lineTo(cw, Math.round(o.y) + 0.5);
    ctx.moveTo(Math.round(o.x) + 0.5, 0); ctx.lineTo(Math.round(o.x) + 0.5, ch);
    ctx.strokeStyle = T.axis; ctx.lineWidth = 1.2; ctx.stroke();
  }
  if (S.showAxisNumbers && (S.showAxes || S.showGrid)) {
    let lab = major;
    while (lab * view.scale < 60) lab *= 2;
    while (lab * view.scale > 200) lab /= 2;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = T.muted;
    const ay = clamp(o.y + 4, 4, ch - 16), ax = clamp(o.x - 5, 30, cw - 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let x = Math.ceil(tl.x / lab) * lab; x <= br.x; x += lab) {
      if (Math.abs(x) < lab / 2) continue;
      ctx.fillText(niceNum(x), W2S({ x, y: 0 }).x, ay);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let y = Math.ceil(br.y / lab) * lab; y <= tl.y; y += lab) {
      if (Math.abs(y) < lab / 2) continue;
      ctx.fillText(niceNum(y), ax, W2S({ x: 0, y }).y);
    }
    if (o.x > 0 && o.x < cw && o.y > 0 && o.y < ch) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText('0', o.x - 5, o.y + 4); }
  }
}

function drawObject(o, T) {
  if (o.hidden) return;
  const hovered = ((o.id === hoverId && S.hoverHighlight) || o.id === listHover) && !sel.includes(o.id);
  if (o.type === 'angle') {
    const g = angleGeom(o);
    ctx.beginPath(); ctx.moveTo(g.A.x, g.A.y); ctx.lineTo(g.V.x, g.V.y); ctx.lineTo(g.B.x, g.B.y);
    if (hovered) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.stroke(); }
    strokeWith(o.style);
    ctx.beginPath();
    if (g.right) { ctx.moveTo(g.sq[0].x, g.sq[0].y); ctx.lineTo(g.sq[1].x, g.sq[1].y); ctx.lineTo(g.sq[2].x, g.sq[2].y); }
    else ctx.arc(g.V.x, g.V.y, g.r, g.mid - g.sweep / 2, g.mid + g.sweep / 2);
    ctx.strokeStyle = o.style.stroke; ctx.lineWidth = 1.6; ctx.setLineDash([]); ctx.stroke();
    if (!g.right) { ctx.lineTo(g.V.x, g.V.y); ctx.closePath(); ctx.fillStyle = hexA(o.style.stroke, 0.12); ctx.fill(); }
    label(fmtAng(g.deg), g.L.x, g.L.y, T, o.style.stroke);
    return;
  }
  if (o.type === 'shape') {
    pathShape(o);
    if (o.style.fillAlpha > 0) { ctx.fillStyle = hexA(o.style.fill, o.style.fillAlpha); ctx.fill(); }
    if (hovered) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.setLineDash([]); ctx.stroke(); }
    strokeWith(o.style);
  } else if (o.type === 'line') {
    const [a, b] = lineScreenEnds(o);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    if (hovered) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.stroke(); }
    strokeWith(o.style);
    const p1 = W2S({ x: o.x1, y: o.y1 }), p2 = W2S({ x: o.x2, y: o.y2 });
    if (o.arrows === 'end' || o.arrows === 'both') arrowHead(p1, p2, o.style);
    if (o.arrows === 'both') arrowHead(p2, p1, o.style);
    if (o.ext !== 'line') {
      ctx.fillStyle = o.style.stroke;
      for (const p of o.ext === 'ray' ? [p1] : o.arrows === 'none' ? [p1, p2] : []) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, o.style.width * 0.9), 0, G.TAU); ctx.fill(); }
    }
  } else if (o.type === 'point') {
    const p = W2S(o);
    const r = Math.max(3, o.style.width + 2);
    if (hovered) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, G.TAU); ctx.fillStyle = T.hover; ctx.fill(); }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, G.TAU); ctx.fillStyle = o.style.stroke; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = T.bg; ctx.stroke();
    if (o.label) label(o.label, p.x + r + 4, p.y - r - 4, T, o.style.stroke, 'left');
  } else if (o.type === 'text') {
    const p = W2S(o);
    ctx.font = `500 ${o.size}px Inter, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const lines = o.text.split('\n');
    let wmax = 0;
    lines.forEach((ln, i) => { ctx.fillStyle = o.style.stroke; ctx.fillText(ln, p.x, p.y + i * o.size * 1.25); wmax = Math.max(wmax, ctx.measureText(ln).width); });
    const box = { x: p.x - 3, y: p.y - o.size, w: wmax + 6, h: o.size * 1.25 * lines.length + 4 };
    textBoxes.set(o.id, box);
    if (hovered) { ctx.strokeStyle = T.hover; ctx.lineWidth = 1; ctx.strokeRect(box.x, box.y, box.w, box.h); }
  } else if (o.type === 'func') {
    if (o.hidden) return;
    const runs = funcPolylines(o);
    if (!runs) return;
    ctx.beginPath();
    for (const run of runs) run.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (hovered || sel.includes(o.id)) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.stroke(); }
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    strokeWith(o.style);
    for (const p of funcEndDots(o)) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, o.style.width + 1.5), 0, G.TAU); ctx.fillStyle = o.style.stroke; ctx.fill(); }
    ctx.restore();
    const lp = funcLabelPos(runs);
    if (o.showLabel && lp) label('y = ' + o.expr, lp.x, lp.y, T, o.style.stroke, 'right');
  }
}

// Visible pieces of a function graph, in screen space, split at gaps and jumps.
function funcPolylines(o) {
  const f = getFunc(o.expr);
  if (!f) return null;
  const runs = [];
  let run = null, prevY = 0;
  const lo = o.xMin != null ? Math.max(-2, W2S({ x: o.xMin, y: 0 }).x) : -2;
  const hi = o.xMax != null ? Math.min(cw + 2, W2S({ x: o.xMax, y: 0 }).x) : cw + 2;
  if (hi < lo) return runs;
  const xs = [];
  for (let sx = lo; sx < hi; sx += 1.5) xs.push(sx);
  xs.push(hi); // include the exact end of the domain
  const at = (sx) => {
    let y;
    try { y = f(S2W({ x: sx, y: 0 }).x); } catch { return null; }
    const sy = ch / 2 - (y - view.cy) * view.scale;
    return isFinite(sy) && Math.abs(sy) <= ch * 20 ? sy : null;
  };
  // Where the curve stops being defined between a good and a bad sample (e.g. the ends of sqrt(16 - x^2)).
  const edge = (good, bad) => {
    for (let i = 0; i < 30; i++) { const m = (good + bad) / 2; if (at(m) === null) bad = m; else good = m; }
    return { x: good, y: at(good) };
  };
  let prevSx = null, prevOk = false;
  for (const sx of xs) {
    const sy = at(sx);
    if (sy === null) {
      if (run && prevOk) run.push(edge(prevSx, sx));
      run = null; prevSx = sx; prevOk = false; continue;
    }
    if (run && Math.abs(sy - prevY) > ch * 1.5) run = null;
    if (!run) {
      run = []; runs.push(run);
      if (prevSx !== null && !prevOk) run.push(edge(sx, prevSx));
    }
    run.push({ x: sx, y: sy });
    prevY = sy; prevSx = sx; prevOk = true;
  }
  return runs;
}

// Screen points for the closed dots at the ends of a restricted domain.
function funcEndDots(o) {
  if (!o.endDots) return [];
  const f = getFunc(o.expr);
  const out = [];
  for (const x of [o.xMin, o.xMax]) {
    if (x == null || !f) continue;
    let y; try { y = f(x); } catch { continue; }
    if (isFinite(y)) out.push(W2S({ x, y }));
  }
  return out;
}
// Where to put a function's "y = …" label: near the right end of its last visible piece.
function funcLabelPos(runs) {
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r];
    for (let i = run.length - 1; i >= 0; i -= 4) {
      const p = run[i];
      if (p.x > 40 && p.x < cw - 20 && p.y > 24 && p.y < ch - 24) return { x: Math.min(p.x, cw - 12), y: p.y - 16 };
    }
  }
  return null;
}

// Screen-space geometry for an angle marker.
function angleGeom(o) {
  const V = W2S({ x: o.vx, y: o.vy }), A = W2S({ x: o.ax, y: o.ay }), B = W2S({ x: o.bx, y: o.by });
  const deg = angleValue(o);
  const la = Math.hypot(A.x - V.x, A.y - V.y) || 1, lb = Math.hypot(B.x - V.x, B.y - V.y) || 1;
  const u = { x: (A.x - V.x) / la, y: (A.y - V.y) / la }, v = { x: (B.x - V.x) / lb, y: (B.y - V.y) / lb };
  let bx = u.x + v.x, by = u.y + v.y;
  if (Math.hypot(bx, by) < 1e-6) { bx = -u.y; by = u.x; }
  if (o.reflex) { bx = -bx; by = -by; }
  const mid = Math.atan2(by, bx);
  const r = clamp(Math.min(la, lb) * 0.45, 12, 30);
  const right = Math.abs(deg - 90) <= S.rightTriTolerance;
  const s = r * 0.7;
  const sq = [{ x: V.x + u.x * s, y: V.y + u.y * s }, { x: V.x + (u.x + v.x) * s, y: V.y + (u.y + v.y) * s }, { x: V.x + v.x * s, y: V.y + v.y * s }];
  const d = r + 10 + S.labelSize;
  return { V, A, B, deg, mid, sweep: deg * G.DEG, r, right, sq, L: { x: V.x + Math.cos(mid) * d, y: V.y + Math.sin(mid) * d } };
}

function getFunc(expr) {
  if (!funcCache.has(expr)) {
    try { funcCache.set(expr, compile(expr)); } catch { funcCache.set(expr, null); }
  }
  return funcCache.get(expr);
}

function lineScreenEnds(o) {
  const a = W2S({ x: o.x1, y: o.y1 }), b = W2S({ x: o.x2, y: o.y2 });
  if (o.ext === 'segment') return [a, b];
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const far = (cw + ch) * 4 + Math.hypot(a.x - cw / 2, a.y - ch / 2) * 2;
  const e = { x: a.x + (dx / L) * far, y: a.y + (dy / L) * far };
  if (o.ext === 'ray') return [a, e];
  return [{ x: a.x - (dx / L) * far, y: a.y - (dy / L) * far }, e];
}
function arrowHead(from, to, style) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const s = 7 + style.width * 2.2;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - s * Math.cos(a - 0.4), to.y - s * Math.sin(a - 0.4));
  ctx.lineTo(to.x - s * Math.cos(a + 0.4), to.y - s * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fillStyle = style.stroke; ctx.fill();
}

function label(text, x, y, T, color, align = 'center') {
  ctx.font = `500 ${S.labelSize}px "JetBrains Mono", monospace`;
  const w = ctx.measureText(text).width + 10, h = S.labelSize + 7;
  const bx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  if (S.labelBackground) {
    ctx.fillStyle = T.labelBg;
    ctx.beginPath(); ctx.roundRect(bx, y - h / 2, w, h, 5); ctx.fill();
    ctx.strokeStyle = hexA(color, 0.5); ctx.lineWidth = 1; ctx.stroke();
  } else {
    // a soft halo keeps text readable without a card
    ctx.lineWidth = 3; ctx.strokeStyle = T.bg; ctx.lineJoin = 'round';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.strokeText(text, bx + 5, y + 0.5);
  }
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 5, y + 0.5);
}

function rightAngleIndex(o) {
  if (o.type !== 'shape' || o.kind !== 'polygon' || o.pts.length !== 3) return -1;
  const ang = G.interiorAngles(G.polyWorld(o));
  return ang.findIndex((a) => Math.abs(a - 90) <= S.rightTriTolerance);
}

function drawOverlayLabels(T) {
  for (const o of doc.objects) {
    if (o.type !== 'shape') continue;
    const isSel = sel.includes(o.id);
    const showSides = S.sideLabels === 'always' || (S.sideLabels === 'selected' && isSel);
    const showAngles = S.angleLabels === 'always' || (S.angleLabels === 'selected' && isSel);
    const rt = toolsOn.rightTri ? rightAngleIndex(o) : -1;
    if (o.kind === 'polygon') {
      const W = G.polyWorld(o);
      const P = W.map(W2S);
      const ccw = G.signedArea(W) > 0;
      const n = P.length;
      const lens = G.sideLengths(o);
      const angs = G.interiorAngles(W);
      const cen = W2S(G.centroid(W));
      // side labels
      const sideText = (i) => {
        if (rt >= 0) {
          const hyp = (rt + 1) % 3; // side opposite vertex rt goes from rt+1 to rt+2
          if (i === hyp) return `c = ${fmtLen(lens[i])}`;
          return `${i === rt ? 'a' : 'b'} = ${fmtLen(lens[i])}`;
        }
        return fmtLen(lens[i]);
      };
      if (showSides || rt >= 0) {
        for (let i = 0; i < n; i++) {
          const a = P[i], b = P[(i + 1) % n];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          let nx = b.y - a.y, ny = -(b.x - a.x);
          const L = Math.hypot(nx, ny) || 1;
          nx /= L; ny /= L;
          if (!ccw) { nx = -nx; ny = -ny; }
          // screen y is flipped, so the CCW outward normal flips sign too
          nx = -nx; ny = -ny;
          label(sideText(i), mx + nx * 16, my + ny * 16, T, rt >= 0 ? S.rightTriColor : o.style.stroke);
        }
      }
      if (showAngles || rt >= 0) {
        for (let i = 0; i < n; i++) {
          const isRight = Math.abs(angs[i] - 90) <= S.rightTriTolerance;
          if (!showAngles && !(rt >= 0 && (i === rt || S.rightTriAngles))) continue;
          const p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
          const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
          const r = clamp(Math.min(la, lb) * 0.3, 8, 22);
          const a1 = Math.atan2(a.y - p.y, a.x - p.x), a2 = Math.atan2(b.y - p.y, b.x - p.x);
          const color = rt >= 0 ? S.rightTriColor : o.style.stroke;
          ctx.strokeStyle = hexA(color, 0.85); ctx.lineWidth = 1.3;
          // interior direction: bisector of the interior angle
          const mid = interiorMid(p, a, b, angs[i], cen);
          const kind = showAngles ? S.angleKind : 'interior';
          if (kind !== 'exterior') {
            if (isRight && S.rightAngleMarks) {
              const u = { x: Math.cos(a1), y: Math.sin(a1) }, v = { x: Math.cos(a2), y: Math.sin(a2) };
              const s = r * 0.6;
              ctx.beginPath();
              ctx.moveTo(p.x + u.x * s, p.y + u.y * s); ctx.lineTo(p.x + (u.x + v.x) * s, p.y + (u.y + v.y) * s); ctx.lineTo(p.x + v.x * s, p.y + v.y * s);
              ctx.stroke();
            } else if (S.showAngleArcs) {
              ctx.beginPath();
              const start = mid - (angs[i] * G.DEG) / 2;
              ctx.arc(p.x, p.y, r, start, start + angs[i] * G.DEG);
              ctx.stroke();
            }
            if (showAngles || (rt >= 0 && i !== rt)) {
              const d = r + 8 + S.labelSize;
              label(fmtAng(angs[i]), p.x + Math.cos(mid) * d, p.y + Math.sin(mid) * d, T, color);
            }
          }
          if (kind !== 'interior') {
            // exterior angle: between the dotted extension of the previous side and the next side
            const ext = 180 - angs[i];
            const ea = a1 + Math.PI;
            const ex = { x: Math.cos(ea), y: Math.sin(ea) }, v = { x: Math.cos(a2), y: Math.sin(a2) };
            const len = clamp(Math.min(la, lb) * 0.5, 22, 60);
            ctx.save();
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + ex.x * len, p.y + ex.y * len);
            ctx.setLineDash([2, 4]); ctx.strokeStyle = hexA(color, 0.7); ctx.lineWidth = 1.3; ctx.stroke();
            ctx.restore();
            let bx = ex.x + v.x, by = ex.y + v.y;
            if (Math.hypot(bx, by) < 1e-6) { bx = -ex.y; by = ex.x; }
            const emid = Math.atan2(by, bx);
            const sweep = Math.abs(ext) * G.DEG;
            const er = r * 1.15;
            if (S.showAngleArcs && sweep > 1e-6) {
              ctx.beginPath(); ctx.arc(p.x, p.y, er, emid - sweep / 2, emid + sweep / 2);
              ctx.setLineDash([]); ctx.strokeStyle = hexA(color, 0.85); ctx.lineWidth = 1.3; ctx.stroke();
            }
            const d = er + 10 + S.labelSize;
            label('ext ' + fmtAng(ext), p.x + Math.cos(emid) * d, p.y + Math.sin(emid) * d, T, color);
          }
        }
      }
      if (S.vertexNames) {
        for (let i = 0; i < n; i++) {
          const p = P[i];
          const dx = p.x - cen.x, dy = p.y - cen.y, L = Math.hypot(dx, dy) || 1;
          ctx.font = `600 ${S.labelSize + 1}px Inter, sans-serif`;
          ctx.fillStyle = T.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(LETTERS(i), p.x + (dx / L) * 14, p.y + (dy / L) * 14);
        }
      }
      if (rt >= 0 && S.rightTriFormula) {
        const a = lens[rt], b = lens[(rt + 2) % 3], c = lens[(rt + 1) % 3];
        const ys = P.map((p) => p.y);
        const f = (v) => (v * v).toFixed(S.decimals);
        label(`a² + b² = c²  →  ${f(a)} + ${f(b)} = ${f(c)}`, cen.x, Math.max(...ys) + 22 + (toolsOn.area && S.areaPosition === 'below' ? 24 : 0), T, S.rightTriColor);
      }
    } else if (showSides) {
      // radius indicator for circles / ovals
      const { rx, ry } = G.ellipseRadii(o);
      const c = o.kind === 'semi' ? G.toWorld(o, 0, -0.5) : { x: o.cx, y: o.cy };
      const e = G.rotPt({ x: rx, y: 0 }, o.rot);
      const cs = W2S(c), es = W2S({ x: c.x + e.x, y: c.y + e.y });
      ctx.beginPath(); ctx.moveTo(cs.x, cs.y); ctx.lineTo(es.x, es.y);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = o.style.stroke; ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(cs.x, cs.y, 3, 0, G.TAU); ctx.fillStyle = o.style.stroke; ctx.fill();
      const circle = G.isCircle(o);
      label(circle ? `r = ${fmtLen(rx)}` : `rx = ${fmtLen(rx)}`, (cs.x + es.x) / 2, (cs.y + es.y) / 2 - 14, T, o.style.stroke);
      if (!circle) {
        const f = G.rotPt({ x: 0, y: ry }, o.rot);
        const fs = W2S({ x: c.x + f.x, y: c.y + f.y });
        ctx.beginPath(); ctx.moveTo(cs.x, cs.y); ctx.lineTo(fs.x, fs.y);
        ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        label(`ry = ${fmtLen(ry)}`, (cs.x + fs.x) / 2 + 36, (cs.y + fs.y) / 2, T, o.style.stroke);
      }
    }
    if (toolsOn.area) {
      const out = G.outline(o, 64);
      const P = out.map(W2S);
      let x;
      let y;
      if (S.areaPosition === 'center') { const c = W2S(G.centroid(out)); x = c.x; y = c.y; }
      else {
        x = P.reduce((s, p) => s + p.x, 0) / P.length;
        y = S.areaPosition === 'above' ? Math.min(...P.map((p) => p.y)) - 20 : Math.max(...P.map((p) => p.y)) + 20;
      }
      label(`A = ${fmtArea(G.area(o))}`, x, y, T, S.areaColor);
      if (S.areaShowPerimeter) label(`P = ${fmtLen(G.perimeter(o))}`, x, y + S.labelSize + 12, T, S.areaColor);
    }
  }
  // line lengths for selected lines
  for (const o of selected()) {
    if (o.type !== 'line' || S.sideLabels === 'never') continue;
    const a = W2S({ x: o.x1, y: o.y1 }), b = W2S({ x: o.x2, y: o.y2 });
    label(fmtLen(Math.hypot(o.x2 - o.x1, o.y2 - o.y1)), (a.x + b.x) / 2, (a.y + b.y) / 2 - 16, T, o.style.stroke);
  }
  if (S.sideLabels === 'always') {
    for (const o of doc.objects) {
      if (o.type !== 'line' || sel.includes(o.id)) continue;
      const a = W2S({ x: o.x1, y: o.y1 }), b = W2S({ x: o.x2, y: o.y2 });
      label(fmtLen(Math.hypot(o.x2 - o.x1, o.y2 - o.y1)), (a.x + b.x) / 2, (a.y + b.y) / 2 - 16, T, o.style.stroke);
    }
  }
}

// Screen-space direction of the interior angle bisector at vertex p.
function interiorMid(p, a, b, angDeg, cen) {
  const la = Math.hypot(a.x - p.x, a.y - p.y) || 1, lb = Math.hypot(b.x - p.x, b.y - p.y) || 1;
  let bx = (a.x - p.x) / la + (b.x - p.x) / lb, by = (a.y - p.y) / la + (b.y - p.y) / lb;
  if (Math.hypot(bx, by) < 1e-6) {
    bx = -(a.y - p.y) / la; by = (a.x - p.x) / la;
    if ((cen.x - p.x) * bx + (cen.y - p.y) * by < 0) { bx = -bx; by = -by; }
  } else if (angDeg > 180) { bx = -bx; by = -by; }
  return Math.atan2(by, bx);
}

function snapPointsOf(o) {
  if (o.type !== 'shape' || !o.snapN) return [];
  return G.pointsAlong(G.outline(o, 720), o.snapN);
}
function drawSnapPoints() {
  if (!S.showSnapPoints) return;
  for (const o of doc.objects) {
    for (const p of snapPointsOf(o)) {
      const s = W2S(p);
      ctx.beginPath(); ctx.arc(s.x, s.y, S.snapPointSize, 0, G.TAU);
      ctx.fillStyle = S.snapColor; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }
  }
}

/* ---------- selection handles ---------- */

function bboxScreen(o) {
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => W2S(G.toWorld(o, u, v)));
}
function handlesFor(o) {
  const hs = [];
  if (o.locked || o.hidden) return hs;
  if (o.type === 'angle') {
    return [['a', o.ax, o.ay], ['v', o.vx, o.vy], ['b', o.bx, o.by]].map(([k, x, y]) => ({ type: 'anglePt', k, p: W2S({ x, y }) }));
  }
  if (o.type === 'shape') {
    for (const hx of [-1, 0, 1]) for (const hy of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      hs.push({ type: 'resize', hx, hy, p: W2S(G.toWorld(o, hx / 2, hy / 2)) });
    }
    const top = W2S(G.toWorld(o, 0, 0.5));
    const up = { x: -Math.sin(o.rot), y: -Math.cos(o.rot) };
    hs.push({ type: 'rotate', p: { x: top.x + up.x * 28, y: top.y + up.y * 28 }, base: top });
    if (vertexEdit === o.id && o.kind === 'polygon') {
      // vertex handles take priority in edit mode
      return G.polyWorld(o).map((w, i) => ({ type: 'vertex', i, p: W2S(w) }));
    }
  } else if (o.type === 'line') {
    hs.push({ type: 'lineEnd', end: 1, p: W2S({ x: o.x1, y: o.y1 }) }, { type: 'lineEnd', end: 2, p: W2S({ x: o.x2, y: o.y2 }) });
  }
  return hs;
}
function handleAt(sp) {
  const o = single();
  if (!o) return null;
  const tol = Math.max(8, S.handleSize);
  for (const h of handlesFor(o)) if (Math.hypot(h.p.x - sp.x, h.p.y - sp.y) <= tol) return { ...h, id: o.id };
  return null;
}

function drawSelection(T) {
  for (const o of selected()) {
    if (o.type === 'shape') {
      const b = bboxScreen(o);
      ctx.beginPath(); b.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = T.sel; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    } else if (o.type === 'point') {
      const p = W2S(o); ctx.beginPath(); ctx.arc(p.x, p.y, o.style.width + 8, 0, G.TAU); ctx.strokeStyle = T.sel; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (o.type === 'text') {
      const b = textBoxes.get(o.id);
      if (b) { ctx.setLineDash([4, 3]); ctx.strokeStyle = T.sel; ctx.lineWidth = 1; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]); }
    }
  }
  const o = single();
  if (!o) return;
  for (const h of handlesFor(o)) {
    if (h.type === 'rotate') {
      ctx.beginPath(); ctx.moveTo(h.base.x, h.base.y); ctx.lineTo(h.p.x, h.p.y); ctx.strokeStyle = T.sel; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, S.handleSize * 0.66, 0, G.TAU); ctx.fillStyle = T.handle; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    } else if (h.type === 'vertex' || h.type === 'lineEnd' || h.type === 'anglePt') {
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, S.handleSize * 0.66, 0, G.TAU); ctx.fillStyle = T.handle; ctx.fill(); ctx.strokeStyle = T.sel; ctx.lineWidth = 2; ctx.stroke();
    } else {
      ctx.save(); ctx.translate(h.p.x, h.p.y); ctx.rotate(-o.rot);
      const hs = S.handleSize;
      ctx.fillStyle = T.handle; ctx.fillRect(-hs / 2, -hs / 2, hs, hs); ctx.strokeStyle = T.sel; ctx.lineWidth = 1.8; ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
      ctx.restore();
    }
  }
}

// Build a canvas path for any object (used by highlights).
function pathOf(o) {
  ctx.beginPath();
  if (o.type === 'shape') { pathShape(o); return true; }
  if (o.type === 'line') { const [a, b] = lineScreenEnds(o); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); return true; }
  if (o.type === 'point') { const p = W2S(o); ctx.arc(p.x, p.y, o.style.width + 7, 0, G.TAU); return true; }
  if (o.type === 'angle') { const g = angleGeom(o); ctx.moveTo(g.A.x, g.A.y); ctx.lineTo(g.V.x, g.V.y); ctx.lineTo(g.B.x, g.B.y); return true; }
  if (o.type === 'text') { const b = textBoxes.get(o.id); if (!b) return false; ctx.rect(b.x, b.y, b.w, b.h); return true; }
  return false;
}
const FLASH_MS = 1500;
function drawFlash(T) {
  if (!flash) return;
  const o = byId(flash.id);
  const t = (performance.now() - flash.t0) / FLASH_MS;
  if (!o || t >= 1) { flash = null; return; }
  if (!pathOf(o)) return;
  const pulse = 0.5 + 0.5 * Math.cos(t * Math.PI * 6);
  ctx.setLineDash(o.hidden ? [6, 5] : []);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = hexA(T.sel, 0.35 * (1 - t) * (0.4 + 0.6 * pulse));
  ctx.lineWidth = (o.style?.width || 2) + 10 + 8 * pulse;
  ctx.stroke();
  ctx.strokeStyle = hexA(T.sel, 0.95 * (1 - t * 0.6));
  ctx.lineWidth = (o.style?.width || 2) + 2;
  ctx.stroke();
  ctx.setLineDash([]);
  // a shrinking ring around the object's center draws the eye to it
  const pts = objPoints(o).map(W2S);
  if (pts.length) {
    const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const rad = Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) + 14 + 60 * (1 - Math.min(1, t * 2.5));
    ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, G.TAU);
    ctx.strokeStyle = hexA(T.sel, 0.5 * Math.max(0, 1 - t * 2)); ctx.lineWidth = 2; ctx.stroke();
  }
}
function flashObject(id) {
  flash = { id, t0: performance.now() };
  const tick = () => { requestRender(); if (flash && flash.id === id) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
// Bring an object into view (smoothly), zooming out if it doesn't fit.
function focusObject(o, mode) {
  if (mode === 'never') return;
  const pts = objPoints(o);
  if (!pts.length) return;
  const S2 = pts.map(W2S);
  const m = 24;
  const off = S2.some((p) => p.x < m || p.x > cw - m || p.y < m || p.y > ch - m);
  if (mode === 'offscreen' && !off) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const target = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: view.scale };
  const fit = Math.min((cw - 140) / Math.max(x1 - x0, 1e-9), (ch - 140) / Math.max(y1 - y0, 1e-9));
  if (fit < view.scale) target.scale = clamp(fit, 0.002, 2e5);
  const from = { cx: view.cx, cy: view.cy, scale: view.scale }, t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / 320), e = 1 - (1 - t) ** 3;
    view.cx = from.cx + (target.cx - from.cx) * e; view.cy = from.cy + (target.cy - from.cy) * e;
    view.scale = from.scale * (target.scale / from.scale) ** e;
    requestRender(); updateHud();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function drawDraft(T) {
  if (!draft) {
    if (measureShown) drawMeasure(measureShown.a, measureShown.b, T);
    return;
  }
  if (draft.mode === 'line' && draft.b) {
    const a = W2S(draft.a), b = W2S(draft.b);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    strokeWith(lineStyle());
    if (S.showLineLength) {
      const L = G.dist(draft.a, draft.b);
      const ang = (Math.atan2(draft.b.y - draft.a.y, draft.b.x - draft.a.x) / G.DEG + 360) % 360;
      label(`${fmtLen(L)} · ${fmtAng(ang)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 18, T, S.lineColor);
    }
  } else if (draft.mode === 'line') {
    const a = W2S(draft.a);
    ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, G.TAU); ctx.fillStyle = S.lineColor; ctx.fill();
  } else if (draft.mode === 'shape' && draft.shape) {
    pathShape(draft.shape);
    ctx.fillStyle = hexA(S.shapeFill, S.shapeFillAlpha); ctx.fill();
    strokeWith({ ...shapeStyle(), dash: 'dashed' });
  } else if (draft.mode === 'marquee') {
    const x = Math.min(draft.a.x, draft.b.x), y = Math.min(draft.a.y, draft.b.y);
    ctx.fillStyle = hexA(T.sel, 0.08);
    ctx.fillRect(x, y, Math.abs(draft.b.x - draft.a.x), Math.abs(draft.b.y - draft.a.y));
    ctx.strokeStyle = T.sel; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.strokeRect(x, y, Math.abs(draft.b.x - draft.a.x), Math.abs(draft.b.y - draft.a.y)); ctx.setLineDash([]);
  } else if (draft.mode === 'measure' && draft.b) {
    drawMeasure(draft.a, draft.b, T);
  } else if (draft.mode === 'poly') {
    const pts = [...draft.pts, draft.cur].filter(Boolean).map(W2S);
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (pts.length >= 3) { ctx.save(); ctx.closePath(); ctx.fillStyle = hexA(S.shapeFill, S.shapeFillAlpha); ctx.fill(); ctx.restore(); }
    strokeWith({ ...shapeStyle(), dash: 'solid' });
    if (pts.length >= 3) { const a = pts.at(-1), b = pts[0]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); strokeWith({ ...shapeStyle(), width: 1, dash: 'dashed' }); }
    draft.pts.forEach((p, i) => { const s = W2S(p); ctx.beginPath(); ctx.arc(s.x, s.y, i === 0 ? 6 : 3.5, 0, G.TAU); ctx.fillStyle = i === 0 ? T.handle : S.shapeStroke; ctx.fill(); if (i === 0) { ctx.strokeStyle = S.shapeStroke; ctx.lineWidth = 2; ctx.stroke(); } });
    if (draft.cur && draft.pts.length && S.showLineLength) {
      const a = draft.pts.at(-1), b = draft.cur, A = W2S(a), B = W2S(b);
      if (G.dist(a, b) * view.scale > 20) label(fmtLen(G.dist(a, b)), (A.x + B.x) / 2, (A.y + B.y) / 2 - 16, T, S.shapeStroke);
    }
  } else if (draft.mode === 'angle') {
    const pts = [...draft.pts, draft.cur].filter(Boolean);
    const P = pts.map(W2S);
    ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    strokeWith({ stroke: S.angleColor, width: 2, dash: 'dashed' });
    if (pts.length === 3) {
      const g = angleGeom({ ax: pts[0].x, ay: pts[0].y, vx: pts[1].x, vy: pts[1].y, bx: pts[2].x, by: pts[2].y });
      label(fmtAng(g.deg), g.L.x, g.L.y, T, S.angleColor);
    }
    P.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, G.TAU); ctx.fillStyle = S.angleColor; ctx.fill(); });
  }
}
function drawMeasure(a, b, T) {
  const A = W2S(a), B = W2S(b);
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
  strokeWith({ stroke: '#fbbf24', width: 1.5, dash: 'dashed' });
  for (const p of [A, B]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, G.TAU); ctx.fillStyle = '#fbbf24'; ctx.fill(); }
  const dx = b.x - a.x, dy = b.y - a.y;
  const ang = (Math.atan2(dy, dx) / G.DEG + 360) % 360;
  label(`d = ${fmtLen(Math.hypot(dx, dy))}`, (A.x + B.x) / 2, (A.y + B.y) / 2 - 30, T, '#fbbf24');
  label(`Δx ${dx.toFixed(S.decimals)}  Δy ${dy.toFixed(S.decimals)}  ∠ ${fmtAng(ang)}`, (A.x + B.x) / 2, (A.y + B.y) / 2 - 8, T, '#fbbf24');
}

/* ======================= hit testing & snapping ======================= */

function hitTest(sp) {
  const wp = S2W(sp);
  const tol = 7 / view.scale;
  for (let i = doc.objects.length - 1; i >= 0; i--) {
    const o = doc.objects[i];
    if (o.hidden) continue;
    if (pick?.type === 'line' && o.type !== 'line') continue;
    if (o.type === 'angle') {
      const g = angleGeom(o);
      if (G.distToSeg(sp, g.V, g.A) < 7 || G.distToSeg(sp, g.V, g.B) < 7 || Math.hypot(sp.x - g.L.x, sp.y - g.L.y) < 18) return o;
      continue;
    }
    if (o.type === 'shape') {
      const pts = G.outline(o, 96);
      // hollow (unfilled) shapes are only picked on their outline, so they don't cover what's inside them
      if (o.style.fillAlpha > 0 && G.pointInPoly(wp, pts)) return o;
      for (let k = 0; k < pts.length; k++) if (G.distToSeg(wp, pts[k], pts[(k + 1) % pts.length]) < tol + o.style.width / 2 / view.scale) return o;
    } else if (o.type === 'line') {
      const [a, b] = lineScreenEnds(o);
      if (G.distToSeg(sp, a, b) < Math.max(7, o.style.width / 2 + 3)) return o;
    } else if (o.type === 'point') {
      const p = W2S(o);
      if (Math.hypot(p.x - sp.x, p.y - sp.y) < o.style.width + 8) return o;
    } else if (o.type === 'text') {
      const b = textBoxes.get(o.id);
      if (b && sp.x >= b.x && sp.x <= b.x + b.w && sp.y >= b.y && sp.y <= b.y + b.h) return o;
    } else if (o.type === 'func' && !o.hidden) {
      const f = getFunc(o.expr);
      if (!f) continue;
      let best = Infinity;
      for (let dx = -6; dx <= 6; dx += 2) {
        const x = S2W({ x: sp.x + dx, y: 0 }).x;
        if ((o.xMin != null && x < o.xMin) || (o.xMax != null && x > o.xMax)) continue;
        let y; try { y = f(x); } catch { continue; }
        if (!isFinite(y)) continue;
        const s = W2S({ x, y });
        best = Math.min(best, Math.hypot(s.x - sp.x, s.y - sp.y));
      }
      if (best < 7) return o;
    }
  }
  return null;
}

function snapCandidates(exclude) {
  const out = [];
  for (const o of doc.objects) {
    if (o.id === exclude || o.hidden) continue;
    if (S.snapPoints) for (const p of snapPointsOf(o)) out.push({ ...p, kind: 'snap' });
    if (o.type === 'shape') {
      if (o.kind === 'polygon') {
        const W = G.polyWorld(o);
        if (S.snapVertices) for (const p of W) out.push({ ...p, kind: 'vertex' });
        if (S.snapMidpoints) W.forEach((p, i) => { const q = W[(i + 1) % W.length]; out.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, kind: 'midpoint' }); });
      }
      if (S.snapVertices && o.kind === 'semi') out.push({ ...G.toWorld(o, -0.5, -0.5), kind: 'vertex' }, { ...G.toWorld(o, 0.5, -0.5), kind: 'vertex' });
      if (S.snapCenters) {
        if (o.kind === 'ellipse') out.push({ x: o.cx, y: o.cy, kind: 'center' });
        else if (o.kind === 'semi') out.push({ ...G.toWorld(o, 0, -0.5), kind: 'center' });
        else out.push({ ...G.centroid(G.polyWorld(o)), kind: 'center' });
      }
    } else if (o.type === 'line') {
      if (S.snapEndpoints && o.ext !== 'line') out.push({ x: o.x1, y: o.y1, kind: 'endpoint' });
      if (S.snapEndpoints && o.ext === 'segment') out.push({ x: o.x2, y: o.y2, kind: 'endpoint' });
      if (S.snapMidpoints && o.ext === 'segment') out.push({ x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2, kind: 'midpoint' });
    } else if (S.snapEndpoints) {
      if (o.type === 'point') out.push({ x: o.x, y: o.y, kind: 'point' });
      else if (o.type === 'angle') out.push({ x: o.vx, y: o.vy, kind: 'vertex' }, { x: o.ax, y: o.ay, kind: 'endpoint' }, { x: o.bx, y: o.by, kind: 'endpoint' });
    }
  }
  return out;
}

// Straight pieces and curves of every visible object (used for intersections and on-outline snaps).
function geometryOf(o) {
  const pieces = [], curves = [];
  if (o.hidden) return { pieces, curves };
  if (o.type === 'shape') {
    if (o.kind === 'polygon') {
      const W = G.polyWorld(o);
      W.forEach((p, i) => pieces.push({ a: p, b: W[(i + 1) % W.length], t0: 0, t1: 1 }));
    } else {
      curves.push(C.ellipseOf(o));
      if (o.kind === 'semi') pieces.push({ a: G.toWorld(o, -0.5, -0.5), b: G.toWorld(o, 0.5, -0.5), t0: 0, t1: 1 });
    }
  } else if (o.type === 'line') {
    pieces.push({ a: { x: o.x1, y: o.y1 }, b: { x: o.x2, y: o.y2 }, t0: o.ext === 'line' ? -Infinity : 0, t1: o.ext === 'segment' ? 1 : Infinity });
  } else if (o.type === 'angle') {
    const V = { x: o.vx, y: o.vy };
    pieces.push({ a: V, b: { x: o.ax, y: o.ay }, t0: 0, t1: 1 }, { a: V, b: { x: o.bx, y: o.by }, t0: 0, t1: 1 });
  }
  return { pieces, curves };
}
function nearbyGeometry(wp, R, exclude) {
  const out = [];
  for (const o of doc.objects) {
    if (o.id === exclude) continue;
    const { pieces, curves } = geometryOf(o);
    for (const p of pieces) { const q = C.nearestOnPiece(wp, p); const d = Math.hypot(q.x - wp.x, q.y - wp.y); if (d < R) out.push({ id: o.id, piece: p, q, d }); }
    for (const E of curves) { const q = C.nearestOnEllipse(E, wp); const d = Math.hypot(q.x - wp.x, q.y - wp.y); if (d < R) out.push({ id: o.id, curve: E, q, d }); }
  }
  return out;
}
function intersectionsNear(near, wp, R) {
  const out = [];
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const g = near[i], h = near[j];
    if (g.id === h.id) continue;
    let pts = [];
    if (g.piece && h.piece) { const x = C.intersectPieces(g.piece, h.piece); if (x) pts = [x]; }
    else if (g.piece || h.piece) pts = C.pieceEllipse((g.piece || h.piece), (g.curve || h.curve));
    else {
      // curve / curve: start near the cursor and alternate projections until both curves agree
      let p = { x: (g.q.x + h.q.x) / 2, y: (g.q.y + h.q.y) / 2 };
      for (let k = 0; k < 60; k++) { p = C.nearestOnEllipse(g.curve, p); p = C.nearestOnEllipse(h.curve, p); }
      const p2 = C.nearestOnEllipse(g.curve, p);
      if (Math.hypot(p2.x - p.x, p2.y - p.y) < 1e-9 * Math.max(1, Math.hypot(p.x, p.y))) pts = [p];
    }
    for (const x of pts) if (Math.hypot(x.x - wp.x, x.y - wp.y) < R) out.push({ x: x.x, y: x.y, kind: 'intersection' });
  }
  return out;
}
function snap(wp, exclude, extra = []) {
  if (S.altDisablesSnap && altHeld) return { x: wp.x, y: wp.y, snapped: false };
  const R = S.snapRadius / view.scale;
  const near = S.snapIntersections || S.snapOnOutline ? nearbyGeometry(wp, R, exclude) : [];
  let best = null, bd = R;
  const cands = [...extra, ...snapCandidates(exclude), ...(S.snapIntersections ? intersectionsNear(near, wp, R) : [])];
  for (const c of cands) {
    // purple snap points win ties, then intersections
    const d = Math.hypot(c.x - wp.x, c.y - wp.y) - (c.kind === 'snap' ? 2 / view.scale : c.kind === 'intersection' ? 1 / view.scale : 0);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) return { x: best.x, y: best.y, kind: best.kind, snapped: true };
  if (S.snapOnOutline && near.length) {
    const n = near.reduce((m, g) => (g.d < m.d ? g : m));
    if (n.d < R * 0.75) return { x: n.q.x, y: n.q.y, kind: 'on outline', snapped: true };
  }
  if (S.snapGrid) {
    const g = S.gridSize;
    return { x: Math.round(wp.x / g) * g, y: Math.round(wp.y / g) * g, kind: 'grid', snapped: true };
  }
  return { x: wp.x, y: wp.y, snapped: false };
}
function constrainAngle(a, b, stepDeg) {
  const L = G.dist(a, b);
  const st = stepDeg * G.DEG;
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / st) * st;
  return { x: a.x + L * Math.cos(ang), y: a.y + L * Math.sin(ang) };
}

/* ======================= pointer interaction ======================= */

let drag = null;
let spaceDown = false;
let altHeld = false;
let listHover = null; // object hovered in the Objects panel
let flash = null; // {id, t0} pulsing highlight after clicking in the Objects panel
let lastPointer = { x: 0, y: 0 };
const pointers = new Map();

function spOf(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointerdown', (e) => {
  altHeld = e.altKey;
  hideMenu();
  canvas.focus?.();
  const sp = spOf(e);
  pointers.set(e.pointerId, sp);
  if (pointers.size === 2) { // pinch start
    const [p1, p2] = [...pointers.values()];
    drag = { mode: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), scale0: view.scale, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
    draft = null;
    return;
  }
  if (e.button === 2) return;
  canvas.setPointerCapture(e.pointerId);
  const wp = S2W(sp);
  if (e.button === 1 || spaceDown || tool === 'pan') {
    drag = { mode: 'pan', sp, cx: view.cx, cy: view.cy };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (pick) {
    if (pick.type === 'point') { const s = snap(wp); const cb = pick.cb; endPick(); cb({ x: s.x, y: s.y }); }
    else {
      const hit = hitTest(sp);
      if (hit && hit.type === 'line') { const cb = pick.cb; endPick(); cb(hit); } else toast('Click a line (or press Esc to cancel)', true);
    }
    return;
  }
  if (tool === 'polygon' || tool === 'angle') {
    let s = snap(wp);
    if (draft && draft.pts?.length && e.shiftKey && !s.snapped) s = constrainAngle(draft.pts[draft.pts.length - 1], s, S.lineAngleSnap);
    const p = { x: s.x, y: s.y };
    if (tool === 'polygon') {
      if (draft?.mode === 'poly') {
        const first = W2S(draft.pts[0]);
        if (draft.pts.length >= 3 && Math.hypot(first.x - sp.x, first.y - sp.y) < 10) { finishPoly(); return; }
        const last = draft.pts[draft.pts.length - 1];
        if (Math.hypot(last.x - p.x, last.y - p.y) * view.scale > 2) draft.pts.push(p);
      } else draft = { mode: 'poly', pts: [p], cur: p };
      setHint(`${draft.pts.length} corner${draft.pts.length > 1 ? 's' : ''} · click the first corner, double-click or Enter to finish · Backspace undoes a corner`);
    } else {
      if (draft?.mode !== 'angle') draft = { mode: 'angle', pts: [], cur: p };
      draft.pts.push(p);
      if (draft.pts.length === 3) finishAngle();
      else setHint(draft.pts.length === 1 ? 'Now click the vertex (corner) of the angle' : 'Now click a point on the second arm');
    }
    requestRender();
    return;
  }
  if (tool === 'line') {
    const s = snap(wp);
    if (draft && draft.mode === 'line' && draft.clickMode) { finishLine(e); return; }
    draft = { mode: 'line', a: { x: s.x, y: s.y }, b: null, sp };
    drag = { mode: 'line' };
    requestRender();
    return;
  }
  if (tool === 'measure') {
    const s = snap(wp);
    measureShown = null;
    draft = { mode: 'measure', a: { x: s.x, y: s.y }, b: null };
    drag = { mode: 'measure' };
    return;
  }
  if (tool === 'point') {
    const s = snap(wp);
    pushUndo();
    addObject({ id: uid(), type: 'point', x: s.x, y: s.y, style: { stroke: S.pointColor, width: S.pointSize, dash: 'solid' }, label: '' });
    changed();
    afterDraw();
    return;
  }
  if (tool === 'text') {
    promptText('', (text) => {
      pushUndo();
      addObject({ id: uid(), type: 'text', x: wp.x, y: wp.y, text, size: S.textSize, style: { stroke: theme().text, width: 1, dash: 'solid' } });
      setTool('select');
      changed();
    });
    return;
  }
  if (tool === 'shape') {
    const s = snap(wp);
    draft = { mode: 'shape', a: { x: s.x, y: s.y }, shape: null, sp };
    drag = { mode: 'shape' };
    return;
  }
  // select tool
  const h = handleAt(sp);
  if (h) { startHandleDrag(h, wp, e); return; }
  const hit = hitTest(sp);
  if (hit) {
    if (vertexEdit && vertexEdit !== hit.id) vertexEdit = null;
    if (e.shiftKey) {
      setSelection(sel.includes(hit.id) ? sel.filter((i) => i !== hit.id) : [...sel, hit.id]);
    } else if (!sel.includes(hit.id)) setSelection([hit.id]);
    if (hit.type === 'func') return;
    const moving = new Set(sel.filter((id) => !byId(id)?.locked));
    if (!moving.size) return;
    if (S.inscribeFollow) for (const id of sel) for (const d of descendants(id)) moving.add(d);
    drag = { mode: 'move', start: wp, orig: new Map([...moving].map((id) => [id, JSON.parse(JSON.stringify(byId(id)))])), moved: false };
    return;
  }
  vertexEdit = null;
  if (!e.shiftKey) setSelection([]);
  draft = { mode: 'marquee', a: sp, b: sp, add: e.shiftKey ? [...sel] : [] };
  drag = { mode: 'marquee' };
});

function startHandleDrag(h, wp, e) {
  const o = byId(h.id);
  pushUndo();
  detach(o);
  const orig = JSON.parse(JSON.stringify(o));
  if (h.type === 'resize') drag = { mode: 'resize', id: o.id, hx: h.hx, hy: h.hy, orig };
  else if (h.type === 'rotate') drag = { mode: 'rotate', id: o.id, orig, a0: Math.atan2(wp.y - o.cy, wp.x - o.cx) };
  else if (h.type === 'vertex') drag = { mode: 'vertex', id: o.id, i: h.i, orig };
  else if (h.type === 'lineEnd') drag = { mode: 'lineEnd', id: o.id, end: h.end, orig };
  else if (h.type === 'anglePt') drag = { mode: 'anglePt', id: o.id, k: h.k, orig };
}

canvas.addEventListener('pointermove', (e) => {
  altHeld = e.altKey;
  const sp = spOf(e);
  lastPointer = sp;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sp);
  const wp = S2W(sp);
  updateHud(wp);
  if (drag?.mode === 'pinch') {
    const [p1, p2] = [...pointers.values()];
    if (!p2) return;
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    zoomAt(drag.mid, (drag.scale0 * d) / drag.d0 / view.scale);
    return;
  }
  if (!drag) {
    snapHint = null;
    if (pick?.type === 'line') {
      const hit = hitTest(sp);
      hoverId = hit ? hit.id : null;
      canvas.style.cursor = hit ? 'pointer' : 'crosshair';
    } else if (pick || ['line', 'point', 'measure', 'shape', 'polygon', 'angle'].includes(tool)) {
      let s = snap(wp);
      snapHint = s.snapped ? s : null;
      if (draft?.pts?.length && (draft.mode === 'poly' || draft.mode === 'angle')) {
        if (e.shiftKey && !s.snapped) s = constrainAngle(draft.pts[draft.pts.length - 1], s, S.lineAngleSnap);
        draft.cur = { x: s.x, y: s.y };
      }
      if (draft && draft.mode === 'line' && draft.clickMode) {
        draft.b = e.shiftKey ? constrainAngle(draft.a, s, S.lineAngleSnap) : { x: s.x, y: s.y };
      }
      canvas.style.cursor = 'crosshair';
    } else if (tool === 'select') {
      const h = handleAt(sp);
      const hit = h ? null : hitTest(sp);
      const nh = hit ? hit.id : null;
      if (nh !== hoverId) { hoverId = nh; }
      canvas.style.cursor = h ? cursorForHandle(h) : hit ? 'move' : 'default';
    } else canvas.style.cursor = spaceDown ? 'grab' : 'grab';
    requestRender();
    return;
  }
  const o = drag.id ? byId(drag.id) : null;
  switch (drag.mode) {
    case 'pan':
      view.cx = drag.cx - (sp.x - drag.sp.x) / view.scale;
      view.cy = drag.cy + (sp.y - drag.sp.y) / view.scale;
      break;
    case 'line': {
      const s = snap(wp);
      snapHint = s.snapped ? s : null;
      draft.b = e.shiftKey ? constrainAngle(draft.a, s, S.lineAngleSnap) : { x: s.x, y: s.y };
      break;
    }
    case 'measure': {
      const s = snap(wp);
      snapHint = s.snapped ? s : null;
      draft.b = e.shiftKey ? constrainAngle(draft.a, s, S.lineAngleSnap) : { x: s.x, y: s.y };
      break;
    }
    case 'shape': {
      const s = snap(wp);
      snapHint = s.snapped ? s : null;
      draft.shape = shapeFromBox(draft.a, s, e.shiftKey);
      break;
    }
    case 'marquee':
      draft.b = sp;
      break;
    case 'move': {
      let dx = wp.x - drag.start.x, dy = wp.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.scale < 3) return;
      if (!drag.moved) { pushUndo(); drag.moved = true; }
      if (S.snapGrid) { const g = S.gridSize; dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; }
      for (const [id, orig] of drag.orig) {
        const t = byId(id);
        if (!t) continue;
        for (const k of ['cx', 'cy', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'ax', 'ay', 'vx', 'vy', 'bx', 'by']) if (k in orig) t[k] = orig[k];
        shiftObj(t, dx, dy);
        // moving an inscribed shape without its parent detaches it
        if (t.inscribed && !drag.orig.has(t.inscribed.parent)) detach(t);
      }
      break;
    }
    case 'resize': doResize(o, drag, wp, e); updateInscribed(o.id); break;
    case 'rotate': {
      let r = drag.orig.rot + Math.atan2(wp.y - o.cy, wp.x - o.cx) - drag.a0;
      if (e.shiftKey) { const st = S.rotateSnap * G.DEG; r = Math.round(r / st) * st; }
      o.rot = ((r % G.TAU) + G.TAU) % G.TAU;
      updateInscribed(o.id);
      break;
    }
    case 'vertex': {
      const s = snap(wp, o.id);
      snapHint = s.snapped ? s : null;
      const W = G.polyWorld(drag.orig);
      W[drag.i] = { x: s.x, y: s.y };
      G.setPolyFromWorld(o, W);
      updateInscribed(o.id);
      break;
    }
    case 'anglePt': {
      const s = snap(wp, o.id);
      snapHint = s.snapped ? s : null;
      o[drag.k + 'x'] = s.x; o[drag.k + 'y'] = s.y;
      break;
    }
    case 'lineEnd': {
      let s = snap(wp, o.id);
      snapHint = s.snapped ? s : null;
      const other = drag.end === 1 ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
      if (e.shiftKey) s = constrainAngle(other, s, S.lineAngleSnap);
      if (drag.end === 1) { o.x1 = s.x; o.y1 = s.y; } else { o.x2 = s.x; o.y2 = s.y; }
      break;
    }
  }
  requestRender();
  throttleProps();
});

let propsTimer = 0;
function throttleProps() {
  if (propsTimer) return;
  propsTimer = setTimeout(() => { propsTimer = 0; renderProps(); }, 80);
}

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.style.cursor = '';
  if (d.mode === 'pinch') { if (pointers.size < 2) drag = null; return; }
  if (d.mode === 'line') {
    const moved = draft && draft.b && G.dist(draft.a, draft.b) * view.scale > 4;
    if (moved) finishLine(e);
    else if (draft) { draft.clickMode = true; draft.b = null; setHint('Click where the line should end · Esc to cancel'); }
    return;
  }
  if (d.mode === 'measure') {
    if (draft?.b) measureShown = { a: draft.a, b: draft.b };
    draft = null; requestRender(); return;
  }
  if (d.mode === 'shape') {
    pushUndo();
    let o;
    if (draft.shape && draft.shape.w * view.scale > 4 && draft.shape.h * view.scale > 4) o = addObject(draft.shape);
    else { const [w, h] = defaultDims(shapeSides); o = addObject(makeShape(shapeSides, draft.a.x, draft.a.y, w, h)); }
    draft = null; snapHint = null;
    changed();
    afterDraw();
    return;
  }
  if (d.mode === 'marquee') {
    const x0 = Math.min(draft.a.x, draft.b.x), x1 = Math.max(draft.a.x, draft.b.x);
    const y0 = Math.min(draft.a.y, draft.b.y), y1 = Math.max(draft.a.y, draft.b.y);
    if (x1 - x0 > 3 || y1 - y0 > 3) {
      const inside = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const ids = doc.objects.filter((o) => {
        if (o.hidden || o.type === 'func') return false;
        const pts = objPoints(o);
        return pts.length > 0 && pts.map(W2S).every(inside);
      }).map((o) => o.id);
      setSelection([...new Set([...draft.add, ...ids])]);
    }
    draft = null; requestRender(); return;
  }
  if (d.mode === 'move' && !d.moved) return;
  if (['resize', 'rotate', 'vertex'].includes(d.mode) && d.id) updateInscribed(d.id);
  snapHint = null;
  changed();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!drag) { hoverId = null; snapHint = null; requestRender(); updateHud(); } });

function finishLine(e) {
  if (!draft || !draft.b || G.dist(draft.a, draft.b) < 1e-9) return;
  pushUndo();
  addObject({ id: uid(), type: 'line', x1: draft.a.x, y1: draft.a.y, x2: draft.b.x, y2: draft.b.y, style: lineStyle(), ext: 'segment', arrows: 'none', name: '' }, false);
  draft = null; snapHint = null;
  setHint(toolHint());
  changed();
  afterDraw();
}

function afterDraw() { if (S.returnToSelect && tool !== 'select') setTool('select'); }

function finishPoly() {
  if (!draft || draft.mode !== 'poly') return;
  const pts = draft.pts.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) * view.scale > 2);
  if (pts.length > 1 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) * view.scale < 3) pts.pop();
  if (pts.length < 3) { toast('A polygon needs at least 3 corners', true); return; }
  if (pts.length > 200) { toast('Too many corners (max 200)', true); return; }
  if (Math.abs(G.signedArea(pts)) < 1e-12) { toast('Those corners are all in a line — no area', true); return; }
  pushUndo();
  const o = makeShape(3, 0, 0, 1, 1);
  o.name = '';
  G.setPolyFromWorld(o, pts);
  addObject(o);
  draft = null; snapHint = null;
  setHint(toolHint());
  changed();
  toast(`Created ${C.classify(o).toLowerCase()}${G.isSimple(pts) ? '' : ' (its sides cross)'}`);
  afterDraw();
}
function finishAngle() {
  const [A, V, B] = draft.pts;
  draft = null; snapHint = null;
  setHint(toolHint());
  if (Math.hypot(A.x - V.x, A.y - V.y) < 1e-12 || Math.hypot(B.x - V.x, B.y - V.y) < 1e-12) { toast('The arms must not start at the vertex', true); return; }
  pushUndo();
  const o = addObject({ id: uid(), type: 'angle', ax: A.x, ay: A.y, vx: V.x, vy: V.y, bx: B.x, by: B.y, style: { stroke: S.angleColor, width: 2, dash: 'solid' }, reflex: false, name: '' }, false);
  changed();
  toast(`Angle: ${fmtAng(angleValue(o))} — right-click it to show the reflex angle`);
  afterDraw();
}

function cursorForHandle(h) {
  if (h.type === 'rotate') return 'grab';
  if (h.type !== 'resize') return 'pointer';
  const o = byId(h.id);
  const a = ((Math.atan2(h.hy, h.hx) + o.rot) / G.DEG + 360) % 180;
  return ['ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize'][Math.round(a / 45) % 4];
}

function shapeFromBox(a, b, shift) {
  let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  const n = shapeSides;
  if (shift) {
    const asp = n >= 3 ? G.regularAspect(n) : n === 2 ? 0.5 : 1;
    if (w * asp > h) h = w * asp; else w = h / asp;
  }
  const sx = Math.sign(b.x - a.x) || 1, sy = Math.sign(b.y - a.y) || 1;
  return makeShape(n, a.x + (sx * w) / 2, a.y + (sy * h) / 2, Math.max(w, 1e-6), Math.max(h, 1e-6));
}

function doResize(o, d, wp, e) {
  const O = d.orig;
  const p = G.rotPt({ x: wp.x - O.cx, y: wp.y - O.cy }, -O.rot);
  const ax = (-d.hx * O.w) / 2, ay = (-d.hy * O.h) / 2;
  const min = 6 / view.scale;
  let w = O.w, h = O.h, pts = O.pts;
  if (d.hx) w = Math.max(min, (p.x - ax) * d.hx);
  if (d.hy) h = Math.max(min, (p.y - ay) * d.hy);
  const convex = O.kind !== 'polygon' || G.isConvex(G.polyWorld(O));
  // Shift keeps proportions (so regular shapes stay regular and others keep their form);
  // only the optional "force regular" mode rebuilds the shape as a regular polygon.
  const regular = e.shiftKey && S.shiftMode === 'regular' && convex;
  const prop = e.ctrlKey || e.metaKey || (e.shiftKey && !regular);
  if (regular || prop) {
    let asp;
    if (regular) {
      if (O.kind === 'polygon') { asp = G.regularAspect(O.pts.length); pts = G.regularUnit(O.pts.length); }
      else asp = O.kind === 'semi' ? 0.5 : 1;
    } else asp = O.h / O.w;
    if (d.hx && d.hy) { if (w * asp > h) h = w * asp; else w = h / asp; }
    else if (d.hx) h = w * asp;
    else w = h / asp;
  }
  const ncx = d.hx ? ax + (d.hx * w) / 2 : 0;
  const ncy = d.hy ? ay + (d.hy * h) / 2 : 0;
  const c = G.rotPt({ x: ncx, y: ncy }, O.rot);
  Object.assign(o, { cx: O.cx + c.x, cy: O.cy + c.y, w, h, pts: pts ? pts.map((q) => q.slice()) : null });
}

canvas.addEventListener('dblclick', (e) => {
  if (tool === 'polygon') { finishPoly(); return; }
  if (tool !== 'select') return;
  const hit = hitTest(spOf(e));
  if (!hit) return;
  if (hit.type === 'shape' && hit.kind === 'polygon') {
    if (S.dblClickAction === 'corners' && !hit.locked) enterVertexEdit(hit);
    else if (S.dblClickAction === 'sides') dimsDialog(hit, 'sides');
  }
  else if (hit.type === 'text') editText(hit);
  else if (hit.type === 'shape') radiusDialog(hit);
  else if (hit.type === 'line') lineDialog(hit);
});

function enterVertexEdit(o) {
  vertexEdit = o.id;
  setSelection([o.id]);
  setHint('Corner edit: drag the round handles · Esc to finish');
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const sp = spOf(e);
  if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5 && e.deltaMode === 0) {
    view.cx += e.deltaX / view.scale; requestRender(); return;
  }
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(S.zoomToCursor ? sp : { x: cw / 2, y: ch / 2 }, Math.exp(-dy * 0.0015 * S.zoomSpeed * (e.ctrlKey ? 4 : 1)));
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const sp = spOf(e);
  if (pick) { endPick(); return; }
  if (draft?.mode === 'poly') { if (draft.pts.length >= 3) finishPoly(); else { draft = null; setHint(toolHint()); requestRender(); } return; }
  if (draft?.mode === 'angle' || draft?.clickMode) { draft = null; requestRender(); setHint(toolHint()); return; }
  const hit = hitTest(sp);
  if (hit && !sel.includes(hit.id)) setSelection([hit.id]);
  showMenu(hit ? objectMenu(hit) : canvasMenu(S2W(sp)), e.clientX, e.clientY);
});

/* ======================= keyboard ======================= */

function typingTarget(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
const ROW_KEYS = ['Delete', 'Backspace', 'Enter', ' ', 'ArrowUp', 'ArrowDown'];

window.addEventListener('keydown', (e) => {
  if ($('.overlay')) { if (e.key === 'Escape') closeTopDialog(); return; }
  if (typingTarget(e.target)) return;
  if (e.target.classList?.contains('obj-row') && ROW_KEYS.includes(e.key)) return; // the row handles these itself
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === ' ') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); saveDialog(); return; }
  if (mod && k === 'c') { copySel(); return; }
  if (mod && k === 'v') { paste(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && k === 'a') { e.preventDefault(); setSelection(doc.objects.filter((o) => o.type !== 'func').map((o) => o.id)); return; }
  if (mod) return;
  if (draft?.mode === 'poly' && e.key === 'Enter') { finishPoly(); return; }
  if (draft?.pts?.length && e.key === 'Backspace') { draft.pts.pop(); if (!draft.pts.length) draft = null; requestRender(); e.preventDefault(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSel(); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    hideMenu();
    if (pick) endPick();
    else if (draft) { draft = null; }
    else if (vertexEdit) vertexEdit = null;
    else if (measureShown) measureShown = null;
    else setSelection([]);
    setHint(toolHint()); requestRender(); return;
  }
  if (e.key.startsWith('Arrow') && sel.length) {
    e.preventDefault();
    const st = (e.shiftKey ? 10 : 1) * (S.nudgeStep > 0 ? S.nudgeStep : S.snapGrid ? S.gridSize : 1 / view.scale);
    const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0;
    const dy = e.key === 'ArrowDown' ? -st : e.key === 'ArrowUp' ? st : 0;
    beginEdit(); moveObjects(sel, dx, dy); clearTimeout(nudgeTimer); nudgeTimer = setTimeout(endEdit, 500);
    changed(); return;
  }
  if (e.key === '?' || e.key === 'F1') { e.preventDefault(); helpDialog(); return; }
  if (e.key === '+' || e.key === '=') { zoomAt({ x: cw / 2, y: ch / 2 }, 1.25); return; }
  if (e.key === '-' || e.key === '_') { zoomAt({ x: cw / 2, y: ch / 2 }, 0.8); return; }
  if (e.key === '0') { view.cx = 0; view.cy = 0; view.scale = 48; requestRender(); updateHud(); return; }
  if (tool === 'shape' && /^[1-9]$/.test(e.key)) { setShapeSides(+e.key); return; }
  const tools = { v: 'select', h: 'pan', l: 'line', p: 'point', s: 'shape', n: 'polygon', a: 'angle', t: 'text', m: 'measure' };
  if (tools[k]) { setTool(tools[k]); return; }
  if (k === 'g') { setSetting('showGrid', !S.showGrid); return; }
});
let nudgeTimer = 0;
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceDown = false; canvas.style.cursor = ''; }
  if (e.key === 'Alt') { altHeld = false; requestRender(); }
});
window.addEventListener('keydown', (e) => { if (e.key === 'Alt' && S.altDisablesSnap) { altHeld = true; snapHint = null; e.preventDefault(); requestRender(); } });

function moveObjects(ids, dx, dy) {
  const all = new Set(ids);
  if (S.inscribeFollow) for (const id of ids) for (const d of descendants(id)) all.add(d);
  for (const id of all) {
    const t = byId(id);
    if (!t) continue;
    if (t.locked) continue;
    shiftObj(t, dx, dy);
    if (t.inscribed && !all.has(t.inscribed.parent)) detach(t);
  }
}

/* ======================= edit operations ======================= */

function setSelection(ids) {
  sel = ids;
  if (vertexEdit && !(ids.length === 1 && ids[0] === vertexEdit)) vertexEdit = null;
  renderProps();
  renderFuncList();
  renderObjList();
  requestRender();
}
function deleteSel() { deleteIds(sel); }
function deleteIds(ids, force) {
  if (!ids.length) return;
  const del = new Set(ids.filter((id) => !byId(id)?.locked));
  if (del.size && S.confirmDelete && !force) {
    const what = del.size === 1 ? shapeName(byId([...del][0])).toLowerCase() : `${del.size} objects`;
    confirmDialog('Delete?', `Delete ${what}? You can undo this with Ctrl+Z.`, 'Delete', () => deleteIds(ids, true));
    return;
  }
  if (!del.size) { toast('That object is locked — unlock it first', true); return; }
  if (del.size < ids.length) toast('Locked objects were kept');
  pushUndo();
  doc.objects = doc.objects.filter((o) => !del.has(o.id));
  for (const o of doc.objects) if (o.inscribed && del.has(o.inscribed.parent)) o.inscribed = null;
  sel = sel.filter((id) => !del.has(id));
  if (listHover && del.has(listHover)) listHover = null;
  changed();
}
function cloneObjs(objs, offset) {
  const map = new Map();
  const out = objs.map((o) => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = uid(); map.set(o.id, c.id);
    shiftObj(c, offset, -offset);
    delete c.locked;
    return c;
  });
  for (const c of out) if (c.inscribed) c.inscribed = map.has(c.inscribed.parent) ? { ...c.inscribed, parent: map.get(c.inscribed.parent) } : null;
  return out;
}
function duplicateSel() {
  const objs = selected();
  if (!objs.length) return;
  pushUndo();
  const copies = cloneObjs(objs, 20 / view.scale);
  doc.objects.push(...copies);
  setSelection(copies.map((c) => c.id));
  changed();
}
function copySel() {
  const objs = selected();
  if (!objs.length) return;
  clipboard = JSON.parse(JSON.stringify(objs));
  toast(`Copied ${objs.length} object${objs.length > 1 ? 's' : ''}`);
}
function paste(at) {
  if (!clipboard) return toast('Clipboard is empty');
  pushUndo();
  let copies = cloneObjs(clipboard, 20 / view.scale);
  if (at) {
    const first = copies[0];
    const ref = first.type === 'shape' ? { x: first.cx, y: first.cy } : objPoints(first)[0] || { x: 0, y: 0 };
    const dx = at.x - ref.x, dy = at.y - ref.y;
    doc.objects.push(...copies);
    moveObjects(copies.map((c) => c.id), dx, dy);
  } else doc.objects.push(...copies);
  setSelection(copies.map((c) => c.id));
  changed();
}
function reorder(o, where) {
  pushUndo();
  const i = doc.objects.indexOf(o);
  doc.objects.splice(i, 1);
  if (where === 'front') doc.objects.push(o); else doc.objects.unshift(o);
  changed();
}

/* ======================= constructions ======================= */

const cStyle = (color) => ({ stroke: color || S.constructColor, width: S.constructWidth, dash: S.constructDash });
const mkLine = (a, b, ext = 'segment', color) => ({ id: uid(), type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, style: cStyle(color), ext, arrows: 'none', name: '' });
const mkPoint = (p, lab = '', color) => ({ id: uid(), type: 'point', x: p.x, y: p.y, style: { stroke: color || S.constructColor, width: 3, dash: 'solid' }, label: lab });
function mkCircle(c, r, color) {
  const o = makeShape(1, c.x, c.y, 2 * r, 2 * r);
  o.style = { stroke: color || S.constructColor, width: S.constructWidth, dash: S.constructDash, fill: color || S.constructColor, fillAlpha: 0 };
  return o;
}
function addConstruction(objs, msg) {
  objs = objs.filter(Boolean);
  if (!objs.length) return;
  pushUndo();
  doc.objects.push(...objs);
  setSelection(objs.map((o) => o.id));
  changed();
  toast(msg);
}
const midOf = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function triangleMenu(o) {
  const T = G.polyWorld(o);
  const c = C.triangleCenters(T);
  const P = (p, l, col) => mkPoint(p, l, col);
  return [
    { label: 'Medians + centroid G', action: () => addConstruction([...C.medians(T).map(([a, b]) => mkLine(a, b)), P(c.G, 'G', '#34d399')], 'Medians meet at the centroid G') },
    { label: 'Altitudes + orthocenter H', action: () => {
      const objs = [];
      for (const al of C.altitudes(T)) { objs.push(mkLine(...al.seg)); if (al.ext) { const e = mkLine(...al.ext); e.style.dash = 'dotted'; objs.push(e); } }
      if (c.H) objs.push(P(c.H, 'H', '#f87171'));
      addConstruction(objs, 'Altitudes meet at the orthocenter H');
    } },
    { label: 'Angle bisectors + incenter I', action: () => addConstruction([...C.angleBisectors(T).map(([a, b]) => mkLine(a, b)), P(c.I, 'I', '#fbbf24')], 'Angle bisectors meet at the incenter I') },
    { label: 'Perpendicular bisectors + circumcenter O', action: () => addConstruction([...C.perpBisectors(T).map(([a, b]) => mkLine(a, b)), c.O && P(c.O, 'O', '#60a5fa')], 'Perpendicular bisectors meet at the circumcenter O') },
    '-',
    { label: 'Circumcircle', action: () => c.O && addConstruction([mkCircle(c.O, c.R), P(c.O, 'O', '#60a5fa')], `Circumcircle: R = ${fmtLen(c.R)}`) },
    { label: 'Incircle', action: () => addConstruction([mkCircle(c.I, c.r, '#fbbf24'), P(c.I, 'I', '#fbbf24')], `Incircle: r = ${fmtLen(c.r)}`) },
    { label: 'Nine-point circle', action: () => c.N && addConstruction([mkCircle(c.N, c.nr, '#a78bfa'), P(c.N, 'N', '#a78bfa')], `Nine-point circle: radius ${fmtLen(c.nr)} (half of R)`) },
    { label: 'Euler line (O, G, H)', action: () => {
      if (!c.O || G.dist(c.O, c.H) < 1e-9 * Math.max(1, c.R)) { toast('In an equilateral triangle O, G and H are the same point — there is no Euler line', true); return; }
      addConstruction([mkLine(c.O, c.H, 'line', '#f472b6'), P(c.O, 'O', '#60a5fa'), P(c.G, 'G', '#34d399'), P(c.H, 'H', '#f87171')], 'Euler line passes through O, G and H');
    } },
    { label: 'All four centers', action: () => addConstruction([P(c.G, 'G', '#34d399'), c.O && P(c.O, 'O', '#60a5fa'), P(c.I, 'I', '#fbbf24'), c.H && P(c.H, 'H', '#f87171')], 'Centroid G, circumcenter O, incenter I, orthocenter H') },
  ];
}

function constructionsMenu(o) {
  if (o.type === 'line') {
    const a = { x: o.x1, y: o.y1 }, b = { x: o.x2, y: o.y2 };
    const d = { x: b.x - a.x, y: b.y - a.y };
    const m = midOf(a, b);
    return [
      { label: 'Midpoint', action: () => addConstruction([mkPoint(m, 'M')], `Midpoint (${m.x.toFixed(S.decimals)}, ${m.y.toFixed(S.decimals)})`) },
      { label: 'Perpendicular bisector', action: () => addConstruction([mkLine(m, { x: m.x - d.y, y: m.y + d.x }, 'line'), mkPoint(m, 'M')], 'Perpendicular bisector') },
      { label: 'Parallel line through a point…', action: () => startPick('point', 'Click the point the parallel line should pass through', (p) => addConstruction([mkLine(p, { x: p.x + d.x, y: p.y + d.y }, 'line')], 'Parallel line added')) },
      { label: 'Perpendicular line through a point…', action: () => startPick('point', 'Click the point the perpendicular line should pass through', (p) => {
        const f = C.footOnLine(p, a, b);
        const q = Math.hypot(f.x - p.x, f.y - p.y) > 1e-12 ? f : { x: p.x - d.y, y: p.y + d.x };
        addConstruction([mkLine(p, q, 'line'), mkPoint({ x: f.x, y: f.y }, 'F')], `Perpendicular line added (distance ${fmtLen(Math.hypot(f.x - p.x, f.y - p.y))})`);
      }) },
      '-',
      { label: 'Circle with this diameter', action: () => addConstruction([mkCircle(m, G.dist(a, b) / 2)], 'Circle on diameter') },
      { label: 'Circle with this radius (center at start)', action: () => addConstruction([mkCircle(a, G.dist(a, b))], 'Circle added') },
      { label: 'Square on this segment', action: () => {
        const q = makeShape(4, 0, 0, 1, 1);
        q.rot = Math.atan2(d.y, d.x);
        G.setPolyFromWorld(q, [a, b, { x: b.x - d.y, y: b.y + d.x }, { x: a.x - d.y, y: a.y + d.x }]);
        q.name = 'Square';
        addConstruction([q], 'Square built on the segment');
      } },
      { label: 'Equilateral triangle on this segment', action: () => {
        const q = makeShape(3, 0, 0, 1, 1);
        q.rot = Math.atan2(d.y, d.x);
        const h = Math.sqrt(3) / 2;
        G.setPolyFromWorld(q, [a, b, { x: m.x - d.y * h, y: m.y + d.x * h }]);
        addConstruction([q], 'Equilateral triangle built on the segment');
      } },
    ];
  }
  if (o.type === 'angle') {
    return [{ label: 'Angle bisector', action: () => {
      const g = angleGeom(o);
      const L = Math.min(Math.hypot(o.ax - o.vx, o.ay - o.vy), Math.hypot(o.bx - o.vx, o.by - o.vy));
      const V = { x: o.vx, y: o.vy };
      const dir = { x: Math.cos(-g.mid), y: Math.sin(-g.mid) }; // screen angle -> world (y flipped)
      addConstruction([mkLine(V, { x: V.x + dir.x * L, y: V.y + dir.y * L })], `Bisector splits it into two ${fmtAng(g.deg / 2)} angles`);
    } }];
  }
  if (o.type !== 'shape') return [];
  if (o.kind !== 'polygon') {
    const E = C.ellipseOf(o);
    const items = [
      { label: 'Center point', action: () => addConstruction([mkPoint(E.c, 'C')], 'Center point') },
      { label: G.isCircle(o) ? 'Diameters (horizontal & vertical)' : 'Major & minor axes', action: () => {
        const ux = G.rotPt({ x: E.rx, y: 0 }, E.rot), uy = G.rotPt({ x: 0, y: E.ry }, E.rot);
        const objs = [mkLine({ x: E.c.x - ux.x, y: E.c.y - ux.y }, { x: E.c.x + ux.x, y: E.c.y + ux.y })];
        objs.push(mkLine(o.kind === 'semi' ? E.c : { x: E.c.x - uy.x, y: E.c.y - uy.y }, { x: E.c.x + uy.x, y: E.c.y + uy.y }));
        addConstruction(objs, 'Axes added');
      } },
    ];
    if (o.kind === 'ellipse') items.push({ label: G.isCircle(o) ? 'Circumscribed square' : 'Circumscribed rectangle', action: () => {
      const q = makeShape(4, o.cx, o.cy, o.w, o.h);
      q.rot = o.rot; q.style = { ...q.style, stroke: S.constructColor, fillAlpha: 0, dash: 'dashed' };
      addConstruction([q], 'Circumscribed around the ' + shapeName(o).toLowerCase());
    } });
    return items;
  }
  const W = G.polyWorld(o);
  const n = W.length;
  const items = n === 3 ? [{ header: 'Triangle' }, ...triangleMenu(o), '-', { header: 'Any polygon' }] : [];
  if (n >= 4) items.push({ label: `Diagonals (${(n * (n - 3)) / 2})`, action: () => {
    const objs = [];
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) objs.push(mkLine(W[i], W[j]));
    addConstruction(objs, `${objs.length} diagonals`);
  } });
  items.push(
    { label: 'Side midpoints', action: () => addConstruction(W.map((p, i) => mkPoint(midOf(p, W[(i + 1) % n]))), 'Midpoints of every side') },
    { label: 'Corner points (A, B, C…)', action: () => addConstruction(W.map((p, i) => mkPoint(p, LETTERS(i))), 'Corner points added') },
    { label: 'Center point (centroid)', action: () => addConstruction([mkPoint(G.centroid(W), 'G')], 'Centroid added') },
    { label: 'Smallest enclosing circle', action: () => {
      const m = C.minEnclosingCircle(W);
      const cyclic = W.every((p) => Math.abs(Math.hypot(p.x - m.x, p.y - m.y) - m.r) <= 1e-7 * m.r);
      addConstruction([mkCircle(m, m.r), mkPoint(m, 'O')], cyclic ? `Circumscribed circle through every corner: R = ${fmtLen(m.r)}` : `Smallest enclosing circle: R = ${fmtLen(m.r)} (this shape has no circle through all corners)`);
    } },
  );
  return items;
}

/* ---------- transformations ---------- */

function selectionCenter(objs) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const o of objs) for (const p of objPoints(o)) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: 0, y: 0 };
}
function transformSelection(spec) {
  const objs = selected().filter((o) => o.type !== 'func' && !o.locked);
  if (!objs.length) { toast('Nothing to transform (locked objects are skipped)', true); return; }
  const c = spec.about === 'origin' ? { x: 0, y: 0 } : selectionCenter(objs);
  let T, rotMap = (r) => r, k = 1;
  if (spec.type === 'rotate') {
    const cs = Math.cos(spec.angle), sn = Math.sin(spec.angle);
    T = (p) => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs });
    rotMap = (r) => r + spec.angle;
  } else if (spec.type === 'reflect') {
    const a = spec.a || c, phi = spec.phi, c2 = Math.cos(2 * phi), s2 = Math.sin(2 * phi);
    T = (p) => { const dx = p.x - a.x, dy = p.y - a.y; return { x: a.x + dx * c2 + dy * s2, y: a.y + dx * s2 - dy * c2 }; };
    rotMap = (r, o) => 2 * phi - r - (o.kind === 'semi' ? Math.PI : 0);
  } else if (spec.type === 'scale') {
    k = spec.k;
    T = (p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k });
  } else {
    T = (p) => ({ x: p.x + spec.dx, y: p.y + spec.dy });
  }
  pushUndo();
  const ids = new Set(objs.map((o) => o.id));
  for (const o of objs) {
    if (o.type === 'shape') {
      const newRot = ((rotMap(o.rot, o) % G.TAU) + G.TAU) % G.TAU;
      if (o.kind === 'polygon') { const W = G.polyWorld(o).map(T); o.rot = newRot; G.setPolyFromWorld(o, W); }
      else { const q = T({ x: o.cx, y: o.cy }); o.cx = q.x; o.cy = q.y; o.rot = newRot; o.w *= k; o.h *= k; }
      if (o.inscribed && !ids.has(o.inscribed.parent)) detach(o);
    } else if (o.type === 'line') {
      const p1 = T({ x: o.x1, y: o.y1 }), p2 = T({ x: o.x2, y: o.y2 });
      Object.assign(o, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    } else if (o.type === 'angle') {
      for (const key of ['a', 'v', 'b']) { const q = T({ x: o[key + 'x'], y: o[key + 'y'] }); o[key + 'x'] = q.x; o[key + 'y'] = q.y; }
    } else if (o.type === 'point' || o.type === 'text') {
      const q = T(o); o.x = q.x; o.y = q.y;
    }
  }
  for (const o of objs) if (o.type === 'shape') updateInscribed(o.id);
  changed();
}
function transformMenu() {
  return [
    { label: 'Flip horizontally', action: () => transformSelection({ type: 'reflect', phi: Math.PI / 2 }) },
    { label: 'Flip vertically', action: () => transformSelection({ type: 'reflect', phi: 0 }) },
    { label: 'Rotate 90° left', action: () => transformSelection({ type: 'rotate', angle: Math.PI / 2 }) },
    { label: 'Rotate 90° right', action: () => transformSelection({ type: 'rotate', angle: -Math.PI / 2 }) },
    '-',
    { label: 'Rotate by…', action: () => transformDialog('rotate') },
    { label: 'Scale (dilate)…', action: scaleDialog },
    { label: 'Move by…', action: () => transformDialog('move') },
    { label: 'Reflect across a line…', action: () => {
      const ids = [...sel];
      startPick('line', 'Click the line to reflect across', (line) => {
        setSelection(ids.filter((id) => id !== line.id));
        transformSelection({ type: 'reflect', a: { x: line.x1, y: line.y1 }, phi: Math.atan2(line.y2 - line.y1, line.x2 - line.x1) });
        toast('Reflected across the line');
      });
    } },
  ];
}
function transformDialog(kind) {
  let f1, f2, about;
  const titles = { rotate: 'Rotate', scale: 'Scale (dilate)', move: 'Move by a vector' };
  openDialog({
    title: titles[kind],
    build(body) {
      if (kind === 'rotate') { f1 = numField('Angle in degrees (positive = counter-clockwise)', 45); body.append(f1.wrap); }
      if (kind === 'scale') { f1 = numField('Scale factor (e.g. 2 doubles, 0.5 halves)', 2, { min: 0 }); body.append(f1.wrap); }
      if (kind === 'move') { f1 = numField('Δx', 1); f2 = numField('Δy', 0); body.append(el('div', { class: 'grid2' }, f1.wrap, f2.wrap)); }
      if (kind !== 'move') {
        about = el('select', {}, el('option', { value: 'center', text: 'Center of the selection' }), el('option', { value: 'origin', text: 'Origin (0, 0)' }));
        body.append(el('label', { class: 'field', style: 'margin-top:8px' }, kind === 'rotate' ? 'Rotate around' : 'Scale from', about));
      }
      setTimeout(() => f1.input.select(), 10);
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Apply', primary: true, onClick(api) {
        const v = parseNum(f1.input.value);
        if (!isFinite(v)) { api.setError('Enter a number.'); return false; }
        if (kind === 'rotate') transformSelection({ type: 'rotate', angle: v * G.DEG, about: about.value });
        else if (kind === 'scale') { if (!(v > 0)) { api.setError('The scale factor must be greater than 0.'); return false; } transformSelection({ type: 'scale', k: v, about: about.value }); }
        else { const dy = parseNum(f2.input.value); if (!isFinite(dy)) { api.setError('Enter a number for Δy.'); return false; } transformSelection({ type: 'move', dx: v, dy }); }
        return true;
      },
    }],
  });
}

function startPick(type, hint, cb) {
  hideMenu();
  pick = { type, hint, cb };
  draft = null;
  $('#hint').textContent = hint + ' · Esc to cancel';
  canvas.style.cursor = 'crosshair';
  requestRender();
}
function endPick() { pick = null; snapHint = null; hoverId = null; setHint(toolHint()); requestRender(); }

function toggleFlag(o, flag) {
  pushUndo();
  o[flag] = !o[flag];
  if (!o[flag]) delete o[flag];
  if (flag === 'locked' && o.locked && vertexEdit === o.id) vertexEdit = null;
  changed();
}

/* ======================= tools & hints ======================= */

function toolHint() {
  if (!S.showHints) return '';
  return {
    select: 'Click to select · drag to move · right-click for options · double-click a polygon to edit corners',
    pan: 'Drag to pan · scroll to zoom',
    line: 'Drag to draw a line (or click, then click) · snaps to purple points & corners · Shift = angle snap',
    point: 'Click to place a point · snaps to purple points & corners',
    shape: `Drag to draw a ${SIDE_NAMES[shapeSides].toLowerCase()} · Shift = perfect regular shape · click for default size · keys 1–9 change sides`,
    text: 'Click to place a text label',
    polygon: 'Click each corner of your polygon · click the first corner, double-click or Enter to finish · Shift = angle snap',
    angle: 'Click a point on one arm, then the vertex, then a point on the other arm',
    measure: 'Drag between two points to measure distance and angle',
  }[tool];
}
function setHint(t) { $('#hint').textContent = S.showHints ? t : ''; }
function setTool(t) {
  tool = t;
  draft = null; snapHint = null;
  if (pick) endPick();
  if (t !== 'measure') measureShown = null;
  $$('.toolbar [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
  setHint(toolHint());
  requestRender();
}
function setShapeSides(n) {
  shapeSides = n;
  $$('#sidesGrid button').forEach((b) => b.classList.toggle('current', +b.dataset.n === n));
  if (tool === 'shape') setHint(toolHint());
}

function updateHud(wp) {
  $('#hudCoords').textContent = S.showCoords && wp ? `x ${wp.x.toFixed(S.decimals)}  y ${wp.y.toFixed(S.decimals)}` : '';
  $('#hudZoom').textContent = S.showZoom ? `${Math.round((view.scale / 48) * 100)}%` : '';
}

let toastTimer = 0;
function toast(msg, isErr = false) {
  if (!S.toasts && !isErr) return;
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), (S.toastSeconds + (isErr ? 1.8 : 0)) * 1000);
}

/* ======================= context menus ======================= */

const menuEl = $('#menu');
function showMenu(items, x, y) {
  menuEl.innerHTML = '';
  buildMenu(menuEl, items);
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  menuEl.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
}
function buildMenu(root, items) {
  for (const it of items) {
    if (it === '-') { root.append(el('div', { class: 'sep' })); continue; }
    if (it.header) { root.append(el('div', { class: 'mh', text: it.header })); continue; }
    const row = el('div', { class: `mi${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}`, role: 'menuitem' });
    row.append(el('span', { html: it.html || '' }, it.html ? null : it.label));
    if (it.kbd) row.append(el('kbd', { text: it.kbd }));
    if (it.sub) {
      row.append(el('span', { class: 'arrow', text: '▸' }));
      let subEl = null;
      const open = () => {
        $$('.ctxmenu.sub').forEach((s) => { if (!s.contains(row)) s.remove(); });
        $$('.mi.open', root).forEach((m) => m.classList.remove('open'));
        row.classList.add('open');
        subEl = el('div', { class: 'ctxmenu sub' });
        buildMenu(subEl, it.sub);
        document.body.append(subEl);
        const rr = row.getBoundingClientRect(), sr = subEl.getBoundingClientRect();
        let left = rr.right + 2;
        if (left + sr.width > innerWidth - 4) left = rr.left - sr.width - 2;
        subEl.style.left = left + 'px';
        subEl.style.top = Math.min(rr.top - 5, innerHeight - sr.height - 6) + 'px';
      };
      row.addEventListener('mouseenter', open);
      row.addEventListener('click', open);
    } else {
      row.addEventListener('mouseenter', () => { if (root === menuEl) $$('.ctxmenu.sub').forEach((s) => s.remove()); $$('.mi.open', root).forEach((m) => m.classList.remove('open')); });
      row.addEventListener('click', () => { hideMenu(); it.action?.(); });
    }
    root.append(row);
  }
}
function hideMenu() { menuEl.hidden = true; $$('.ctxmenu.sub').forEach((s) => s.remove()); }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.ctxmenu')) hideMenu(); });
window.addEventListener('blur', hideMenu);

function inscribeMenu(o) {
  const items = [
    { label: 'Circle (incircle)', action: () => doInscribe(o, 'circle', 1) },
    { label: 'Oval', action: () => doInscribe(o, 'ellipse', 1) },
    { label: 'Square', action: () => doInscribe(o, 'square', 4) },
    { label: 'Rectangle', action: () => doInscribe(o, 'rect', 4) },
    '-',
    { label: 'Semicircle', action: () => doInscribe(o, 'ngon', 2) },
    { label: 'Triangle', action: () => doInscribe(o, 'ngon', 3) },
    { label: 'Pentagon', action: () => doInscribe(o, 'ngon', 5) },
    { label: 'Hexagon', action: () => doInscribe(o, 'ngon', 6) },
    { label: 'Octagon', action: () => doInscribe(o, 'ngon', 8) },
    { label: 'Any polygon (1–20 sides)…', action: () => inscribeNDialog(o) },
  ];
  return items;
}

function objectMenu(o) {
  const common = [
    '-',
    { label: 'Scale…', action: scaleDialog },
    { label: 'Transform', sub: transformMenu() },
    { label: o.locked ? 'Unlock' : 'Lock (prevent moving)', action: () => { const on = !o.locked; pushUndo(); for (const t of selected()) { if (on) t.locked = true; else delete t.locked; } changed(); } },
    { label: 'Hide', action: () => { pushUndo(); for (const t of selected()) t.hidden = true; setSelection([]); changed(); toast('Hidden — show it again from the Objects list'); } },
    '-',
    { label: 'Duplicate', kbd: 'Ctrl+D', action: duplicateSel },
    { label: 'Copy', kbd: 'Ctrl+C', action: copySel },
    { label: 'Bring to front', action: () => reorder(o, 'front') },
    { label: 'Send to back', action: () => reorder(o, 'back') },
    '-',
    { label: 'Delete', kbd: 'Del', danger: true, action: deleteSel },
  ];
  if (sel.length > 1) return [{ header: `${sel.length} objects` }, ...common.slice(1)];
  if (o.type === 'shape') {
    const poly = o.kind === 'polygon';
    const items = [{ header: shapeName(o) }];
    if (poly) {
      items.push({ label: 'Set side lengths…', action: () => dimsDialog(o, 'sides') });
      items.push({ label: 'Set angles…', action: () => dimsDialog(o, 'angles') });
      items.push({ label: 'Edit corners', action: () => enterVertexEdit(o) });
      items.push({ label: 'Make regular', action: () => { pushUndo(); const n = o.pts.length; o.pts = G.regularUnit(n); o.h = o.w * G.regularAspect(n); detach(o); updateInscribed(o.id); changed(); } });
    } else {
      items.push({ label: 'Set radius…', action: () => radiusDialog(o) });
      items.push({ label: G.isCircle(o) ? 'Make oval' : 'Make circle', action: () => {
        pushUndo(); detach(o);
        if (G.isCircle(o)) o.h *= 0.6; else { const r = Math.max(G.ellipseRadii(o).rx, G.ellipseRadii(o).ry); o.w = 2 * r; o.h = o.kind === 'semi' ? r : 2 * r; }
        updateInscribed(o.id); changed();
      } });
    }
    items.push({ label: 'Inscribe', sub: inscribeMenu(o) });
    items.push({ label: 'Constructions', sub: constructionsMenu(o) });
    items.push({ html: `<span class="snap-dot"></span>Snap points… <span class="muted">(${o.snapN})</span>`, action: () => snapDialog(o) });
    items.push({ label: 'Style…', action: () => styleDialog(o) });
    if (o.inscribed) items.push({ label: 'Detach from parent', action: () => { pushUndo(); detach(o); changed(); } });
    return [...items, ...common];
  }
  if (o.type === 'line') {
    return [{ header: shapeName(o) }, { label: 'Set length & angle…', action: () => lineDialog(o) }, { label: 'Constructions', sub: constructionsMenu(o) }, { label: 'Style…', action: () => styleDialog(o) },
      { label: 'Type', sub: [['segment', 'Segment'], ['ray', 'Ray'], ['line', 'Infinite line']].map(([k, l]) => ({ label: (o.ext === k ? '✓ ' : '') + l, action: () => { pushUndo(); o.ext = k; changed(); } })) },
      { label: 'Arrowheads', sub: [['none', 'None'], ['end', 'End'], ['both', 'Both ends']].map(([k, l]) => ({ label: (o.arrows === k ? '✓ ' : '') + l, action: () => { pushUndo(); o.arrows = k; changed(); } })) },
      ...common];
  }
  if (o.type === 'text') return [{ header: 'Text' }, { label: 'Edit text…', action: () => editText(o) }, ...common];
  if (o.type === 'angle') return [{ header: shapeName(o) }, { label: o.reflex ? 'Show the smaller angle' : `Show the reflex angle (${fmtAng(360 - angleValue(o))})`, action: () => { pushUndo(); o.reflex = !o.reflex; changed(); } }, ...constructionsMenu(o), { label: 'Style…', action: () => styleDialog(o) }, ...common];
  if (o.type === 'point') return [{ header: 'Point' }, { label: 'Label…', action: () => pointLabelDialog(o) }, ...common];
  if (o.type === 'func') {
    const setDash = (d) => () => { pushUndo(); o.style.dash = d; changed(); };
    return [{ header: 'y = ' + o.expr },
      { label: 'Edit expression…', action: () => editFunc(o) },
      { label: 'Line style', sub: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['dashdot', 'Dash-dot']].map(([k, l]) => ({ label: (o.style.dash === k ? '✓ ' : '') + l, action: setDash(k) })) },
      { label: 'Thickness', sub: [1, 1.5, 2.5, 4, 6, 9].map((w) => ({ label: (o.style.width === w ? '✓ ' : '') + w + ' px', action: () => { pushUndo(); o.style.width = w; changed(); } })) },
      { label: 'Color…', action: () => styleDialog(o) },
      { label: o.showLabel ? 'Hide label' : 'Show label', action: () => { pushUndo(); o.showLabel = !o.showLabel; changed(); } },
      { label: o.hidden ? 'Show' : 'Hide', action: () => { pushUndo(); o.hidden = !o.hidden; changed(); } },
      '-', { label: 'Duplicate', kbd: 'Ctrl+D', action: duplicateSel },
      { label: 'Delete', danger: true, action: deleteSel }];
  }
  return common;
}

function canvasMenu(wp) {
  return [
    { label: 'Paste here', kbd: 'Ctrl+V', disabled: !clipboard, action: () => paste(wp) },
    { label: 'Add shape here', sub: Array.from({ length: 20 }, (_, i) => ({ label: `${i + 1} — ${SIDE_NAMES[i + 1]}`, action: () => insertShape(i + 1, wp) })) },
    { label: 'Add special shape here', sub: PRESETS.map((p) => ({ label: p.name, action: () => insertPreset(p, wp) })) },
    { label: 'Add point here', action: () => { pushUndo(); addObject({ id: uid(), type: 'point', x: wp.x, y: wp.y, style: { stroke: S.pointColor, width: S.pointSize, dash: 'solid' }, label: '' }); changed(); } },
    '-',
    { label: 'Select all', kbd: 'Ctrl+A', action: () => setSelection(doc.objects.filter((o) => o.type !== 'func').map((o) => o.id)) },
    { label: 'Zoom to fit', action: fitAll },
    { label: 'Reset view', kbd: '0', action: () => { view.cx = 0; view.cy = 0; view.scale = 48; requestRender(); updateHud(); } },
    { label: S.showGrid ? 'Hide grid' : 'Show grid', kbd: 'G', action: () => setSetting('showGrid', !S.showGrid) },
  ];
}

/* ======================= dialogs ======================= */

const dialogStack = [];
function openDialog({ title, wide, build, buttons = [], onClose }) {
  const overlay = el('div', { class: 'overlay' });
  const dlg = el('div', { class: `dlg${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const body = el('div', { class: 'body' });
  const err = el('div', { class: 'dlg-err', role: 'alert' });
  const close = () => { overlay.remove(); dialogStack.splice(dialogStack.indexOf(api), 1); onClose?.(); };
  const api = { close, body, setError: (m) => { err.textContent = m || ''; }, dlg };
  dlg.append(el('header', {}, el('h3', { text: title }), el('button', { class: 'x', 'aria-label': 'Close', onclick: close, text: '×' })), body, err);
  const acts = el('div', { class: 'dlg-actions' });
  let primary = null;
  for (const b of buttons) {
    const btn = el('button', { class: b.primary ? 'primary' : b.danger ? 'danger' : '', text: b.label, type: 'button' });
    btn.addEventListener('click', async () => { const r = await b.onClick?.(api); if (r !== false) close(); });
    if (b.primary) primary = btn;
    acts.append(btn);
  }
  if (buttons.length) dlg.append(acts);
  overlay.append(dlg);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && primary && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); primary.click(); }
  });
  build?.(body, api);
  $('#modalRoot').append(overlay);
  dialogStack.push(api);
  setTimeout(() => (dlg.querySelector('[autofocus]') || dlg.querySelector('input, select, textarea') || primary)?.focus(), 0);
  return api;
}
function closeTopDialog() { dialogStack[dialogStack.length - 1]?.close(); }

function numField(label, value, attrs = {}) {
  const input = el('input', { type: 'number', step: 'any', value: value, ...attrs });
  return { wrap: el('label', { class: 'field' }, label, input), input };
}
const parseNum = (s) => {
  const t = String(s).trim();
  if (!t) return NaN;
  try { return compile(t)(0); } catch { return NaN; }
};

// Sides & angles editor (requirement: set side lengths + angles with validation).
function dimsDialog(o, focus) {
  const W = G.polyWorld(o);
  const n = W.length;
  const lens = G.sideLengths(o);
  const angs = G.interiorAngles(W);
  const need = (n - 2) * 180;
  const dec = Math.max(S.decimals, 4);
  const sideIn = [], angIn = [];
  let strict;
  openDialog({
    title: `${shapeName(o)} — sides & angles`,
    build(body) {
      body.append(el('p', { class: 'muted', html: 'Type new values (you can use math like <code>sqrt(2)</code> or <code>3*pi</code>). Changed boxes are highlighted.' }));
      const tbl = el('table', { class: 'dims' });
      tbl.append(el('tr', {}, el('th', { text: 'Side' }), el('th', { text: 'Length' }), el('th', { text: 'Corner' }), el('th', { text: 'Angle (°)' })));
      for (let i = 0; i < n; i++) {
        const si = el('input', { type: 'text', inputmode: 'decimal', value: +lens[i].toFixed(dec), 'aria-label': `Side ${LETTERS(i)}${LETTERS((i + 1) % n)}` });
        const ai = el('input', { type: 'text', inputmode: 'decimal', value: +angs[i].toFixed(dec), 'aria-label': `Angle ${LETTERS(i)}` });
        si.dataset.orig = si.value; ai.dataset.orig = ai.value;
        for (const x of [si, ai]) x.addEventListener('input', () => { x.classList.toggle('changed', x.value !== x.dataset.orig); updateSum(); });
        sideIn.push(si); angIn.push(ai);
        tbl.append(el('tr', {}, el('td', { class: 'nm', text: LETTERS(i) + LETTERS((i + 1) % n) }), el('td', {}, si), el('td', { class: 'nm', text: '∠' + LETTERS(i) }), el('td', {}, ai)));
      }
      body.append(tbl);
      const sum = el('div', { class: 'sumline' });
      body.append(sum);
      strict = el('input', { type: 'checkbox' });
      body.append(el('label', { class: 'chk' }, strict, 'Keep all side lengths exactly (show an error if the angles don’t fit)'));
      body.append(el('p', { class: 'muted tiny', text: 'Changing only sides: angles adjust to fit. Changing angles: the sides you changed stay fixed and the rest adjust.' }));
      function updateSum() {
        const vals = angIn.map((x) => parseNum(x.value));
        const s = vals.reduce((a, b) => a + b, 0);
        const ok = Math.abs(s - need) < 1e-6;
        sum.className = 'sumline ' + (ok ? 'good' : 'bad');
        sum.textContent = `Angle sum: ${isFinite(s) ? +s.toFixed(6) : '?'}° (a ${n}-sided shape needs ${need}°)`;
      }
      updateSum();
      setTimeout(() => (focus === 'angles' ? angIn[0] : sideIn[0]).select(), 10);
    },
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Apply', primary: true, onClick(api) {
          const newL = sideIn.map((x) => parseNum(x.value));
          const newA = angIn.map((x) => parseNum(x.value));
          if (newL.some((v) => !isFinite(v))) { api.setError('Every side length needs a number.'); return false; }
          if (newA.some((v) => !isFinite(v))) { api.setError('Every angle needs a number.'); return false; }
          const sideChanged = sideIn.map((x) => x.value !== x.dataset.orig);
          const angChanged = angIn.some((x) => x.value !== x.dataset.orig);
          if (!angChanged && !sideChanged.some(Boolean)) return true;
          // unchanged sides keep their exact current length (not the rounded display value)
          const L = newL.map((v, i) => (sideChanged[i] ? v : lens[i]));
          let res;
          if (angChanged || strict.checked) {
            const A = angChanged ? newA.map((v, i) => (angIn[i].value !== angIn[i].dataset.orig ? v : angs[i])) : angs;
            // Snap unchanged angles into the required total if only rounding differs
            const locked = strict.checked ? L.map(() => true) : sideChanged;
            res = G.solveAngles(W, A, L, locked);
          } else {
            res = G.solveSides(W, L);
          }
          if (res.error) { api.setError(res.error); return false; }
          pushUndo();
          detach(o);
          G.setPolyFromWorld(o, res.pts);
          updateInscribed(o.id);
          changed();
          toast('Shape updated');
          return true;
        },
      },
    ],
  });
}

function radiusDialog(o) {
  const { rx, ry } = G.ellipseRadii(o);
  const circle = G.isCircle(o);
  let fr, fx, fy, keep;
  openDialog({
    title: `${shapeName(o)} — radius`,
    build(body) {
      keep = el('input', { type: 'checkbox', checked: circle });
      fr = numField('Radius', +rx.toFixed(8), { min: 0 });
      fx = numField('Horizontal radius (rx)', +rx.toFixed(8), { min: 0 });
      fy = numField('Vertical radius (ry)', +ry.toFixed(8), { min: 0 });
      const d = el('div', { class: 'muted tiny' });
      const oneBox = el('div', {}, fr.wrap), twoBox = el('div', { class: 'grid2' }, fx.wrap, fy.wrap);
      const sync = () => {
        oneBox.hidden = !keep.checked; twoBox.hidden = keep.checked;
        const r = +fr.input.value;
        d.textContent = keep.checked && r > 0 ? `Diameter ${fmtLen(2 * r)} · Circumference ${fmtLen(2 * Math.PI * r)} · Area ${fmtArea(Math.PI * r * r * (o.kind === 'semi' ? 0.5 : 1))}` : '';
      };
      keep.addEventListener('change', sync); fr.input.addEventListener('input', sync);
      body.append(el('label', { class: 'chk' }, keep, 'Keep it a circle (one radius)'), oneBox, twoBox, d);
      sync();
      setTimeout(() => (keep.checked ? fr : fx).input.select(), 10);
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Apply', primary: true, onClick(api) {
        let a, b;
        if (keep.checked) { a = b = +fr.input.value; } else { a = +fx.input.value; b = +fy.input.value; }
        if (!(a > 0) || !(b > 0) || !isFinite(a) || !isFinite(b)) { api.setError('A radius must be a positive number.'); return false; }
        pushUndo(); detach(o);
        if (o.kind === 'semi') {
          const base = G.toWorld(o, 0, -0.5);
          o.w = 2 * a; o.h = b;
          const c = G.rotPt({ x: 0, y: b / 2 }, o.rot);
          o.cx = base.x + c.x; o.cy = base.y + c.y;
        } else { o.w = 2 * a; o.h = 2 * b; }
        updateInscribed(o.id); changed();
        return true;
      },
    }],
  });
}

function lineDialog(o) {
  const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
  const ang = (Math.atan2(o.y2 - o.y1, o.x2 - o.x1) / G.DEG + 360) % 360;
  let fl, fa, anchor;
  openDialog({
    title: 'Line — length & angle',
    build(body) {
      fl = numField(`Length${S.units ? ' (' + S.units + ')' : ''}`, +L.toFixed(8), { min: 0 });
      fa = numField('Angle (° from +x axis)', +ang.toFixed(6));
      anchor = el('select', {}, el('option', { value: 'start', text: 'Keep start point fixed' }), el('option', { value: 'mid', text: 'Keep midpoint fixed' }), el('option', { value: 'end', text: 'Keep end point fixed' }));
      body.append(el('div', { class: 'grid2' }, fl.wrap, fa.wrap), el('label', { class: 'field', style: 'margin-top:8px' }, 'Anchor', anchor));
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Apply', primary: true, onClick(api) {
        const len = +fl.input.value, a = +fa.input.value * G.DEG;
        if (!(len > 0) || !isFinite(a)) { api.setError('Length must be positive and angle must be a number.'); return false; }
        pushUndo();
        const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
        if (anchor.value === 'start') { o.x2 = o.x1 + dx; o.y2 = o.y1 + dy; }
        else if (anchor.value === 'end') { o.x1 = o.x2 - dx; o.y1 = o.y2 - dy; }
        else { const mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2; o.x1 = mx - dx / 2; o.y1 = my - dy / 2; o.x2 = mx + dx / 2; o.y2 = my + dy / 2; }
        changed(); return true;
      },
    }],
  });
}

function snapDialog(o) {
  let f;
  const verts = o.kind === 'polygon' ? o.pts.length : 4;
  openDialog({
    title: 'Snap points',
    build(body) {
      body.append(el('p', { class: 'muted', html: 'Purple points are spread evenly around the outline, starting at the first corner. Lines and points snap onto them.' }));
      f = numField('Number of snap points (0 = none)', o.snapN, { min: 0, max: 500, step: 1 });
      body.append(f.wrap);
      const quick = el('div', { class: 'row-btns' });
      for (const [lab, v] of [['None', 0], [`Corners (${verts})`, verts], [`Corners + midpoints (${verts * 2})`, verts * 2], ['12', 12], ['24', 24]]) {
        quick.append(el('button', { type: 'button', text: lab, onclick: () => { f.input.value = v; } }));
      }
      body.append(quick);
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Apply', primary: true, onClick(api) {
        const v = Math.round(+f.input.value);
        if (!(v >= 0 && v <= 500)) { api.setError('Choose a whole number from 0 to 500.'); return false; }
        pushUndo(); o.snapN = v; changed();
        if (v && !S.snapPoints) toast('Snapping to snap points is off in Settings', true);
        return true;
      },
    }],
  });
}

function inscribeNDialog(o) {
  let f;
  openDialog({
    title: 'Inscribe a polygon',
    build(body) {
      f = numField('Number of sides (1 = circle, 2 = semicircle)', 3, { min: 1, max: 20, step: 1 });
      body.append(f.wrap, el('p', { class: 'muted tiny', text: 'The largest shape with that many sides that fits inside is drawn.' }));
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Inscribe', primary: true, onClick(api) {
        const n = Math.round(+f.input.value);
        if (!(n >= 1 && n <= 20)) { api.setError('Choose between 1 and 20 sides.'); return false; }
        doInscribe(o, n === 1 ? 'circle' : 'ngon', n); return true;
      },
    }],
  });
}

function styleDialog(o) {
  openDialog({ title: `${shapeName(o)} — style`, build(body) { body.append(styleEditor(o)); }, buttons: [{ label: 'Done', primary: true }] });
}

function promptText(initial, cb, title = 'Text label') {
  let ta;
  openDialog({
    title,
    build(body) { ta = el('textarea', { rows: 3, autofocus: true }); ta.value = initial; body.append(ta); },
    buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick(api) { const t = ta.value.trim(); if (!t) { api.setError('Type some text.'); return false; } cb(t.slice(0, 300)); return true; } }],
  });
}
function editText(o) { promptText(o.text, (t) => { pushUndo(); o.text = t; changed(); }, 'Edit text'); }
function pointLabelDialog(o) {
  let f;
  openDialog({
    title: 'Point label',
    build(body) { f = el('input', { type: 'text', maxlength: 20, value: o.label, autofocus: true }); body.append(el('label', { class: 'field' }, 'Label (e.g. A, P₁)', f)); },
    buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick() { pushUndo(); o.label = f.value.slice(0, 20); changed(); } }],
  });
}

function confirmDialog(title, msg, okLabel, onOk) {
  openDialog({ title, build(b) { b.append(el('p', { text: msg })); }, buttons: [{ label: 'Cancel' }, { label: okLabel, primary: true, onClick: onOk }] });
}

/* ---------- file: save / open / share / import ---------- */

function savedGraphs() { const s = store.get('vf.saves'); return s && typeof s === 'object' ? s : {}; }
let currentName = '';
function saveDialog() {
  let f;
  openDialog({
    title: 'Save graph',
    build(body) {
      f = el('input', { type: 'text', maxlength: 60, value: currentName || `Graph ${new Date().toLocaleDateString()}`, autofocus: true });
      body.append(el('label', { class: 'field' }, 'Name', f), el('p', { class: 'muted tiny', text: 'Saved in this browser only. Use Share to move a graph to another device.' }));
      setTimeout(() => f.select(), 10);
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Save', primary: true, onClick(api) {
        const name = f.value.trim();
        if (!name) { api.setError('Give it a name.'); return false; }
        const all = savedGraphs();
        all[name] = { t: Date.now(), d: docData() };
        if (!store.set('vf.saves', all)) { api.setError('Could not save — browser storage is full or blocked.'); return false; }
        currentName = name;
        toast(`Saved “${name}”`);
        return true;
      },
    }],
  });
}
function openDialogFiles() {
  openDialog({
    title: 'Open saved graph',
    wide: true,
    build(body, api) {
      const search = el('input', { class: 'search', type: 'search', placeholder: 'Search saved graphs…' });
      const list = el('div', { class: 'saved-list' });
      const draw = () => {
        list.innerHTML = '';
        const all = savedGraphs();
        const q = search.value.toLowerCase();
        const names = Object.keys(all).filter((n) => n.toLowerCase().includes(q)).sort((a, b) => all[b].t - all[a].t);
        if (!names.length) { list.append(el('div', { class: 'empty', text: Object.keys(all).length ? 'No matches.' : 'No saved graphs yet — use Save.' })); return; }
        for (const nm of names) {
          const g = all[nm];
          const count = Array.isArray(g.d?.o) ? g.d.o.length : 0;
          list.append(el('div', { class: 'saved-item' },
            el('div', { class: 'meta' }, el('b', { text: nm }), el('span', { text: `${new Date(g.t).toLocaleString()} · ${count} object${count === 1 ? '' : 's'}` })),
            el('button', { class: 'btn primary', text: 'Open', onclick: () => {
              try { pushUndo(); loadDocData(g.d); currentName = nm; applySettingsSideEffects(); changed(); updateHud(); api.close(); toast(`Opened “${nm}”`); }
              catch (err) { api.setError('That save is damaged: ' + err.message); }
            } }),
            el('button', { class: 'btn danger', text: 'Delete', onclick: () => { const a = savedGraphs(); delete a[nm]; store.set('vf.saves', a); draw(); } }),
          ));
        }
      };
      search.addEventListener('input', draw);
      body.append(search, list);
      draw();
    },
    buttons: [{ label: 'Close' }],
  });
}
async function shareDialog() {
  let code;
  try { code = await encodeShare(); } catch (e) { toast('Could not create a code: ' + e.message, true); return; }
  const link = `${location.origin}${location.pathname}#g=${code}`;
  openDialog({
    title: 'Share graph',
    build(body) {
      const ta = el('textarea', { class: 'code-box', readonly: true, rows: 5 }); ta.value = code;
      const li = el('input', { type: 'text', readonly: true, value: link });
      const copy = (txt, what) => navigator.clipboard?.writeText(txt).then(() => toast(`${what} copied`), () => toast('Select the text and copy it manually', true));
      body.append(
        el('p', { class: 'muted', text: 'Anyone can paste this code into Import (or open the link) to get an exact copy of this graph.' }),
        el('label', { class: 'field' }, `Share code (${code.length} characters)`, ta),
        el('div', { class: 'row-btns' }, el('button', { type: 'button', class: 'primary', text: 'Copy code', onclick: () => copy(code, 'Code') })),
        el('label', { class: 'field', style: 'margin-top:12px' }, 'Link', li),
        el('div', { class: 'row-btns' }, el('button', { type: 'button', text: 'Copy link', onclick: () => copy(link, 'Link') })),
      );
      if (link.length > 8000) body.append(el('p', { class: 'muted tiny', text: 'This graph is large — the link may be too long for some apps; the code always works.' }));
      setTimeout(() => ta.select(), 10);
    },
    buttons: [{ label: 'Done', primary: true }],
  });
}
function importDialog() {
  let ta;
  openDialog({
    title: 'Import a shared graph',
    build(body) {
      ta = el('textarea', { class: 'code-box', rows: 5, placeholder: 'Paste a code starting with VF1.', autofocus: true });
      body.append(el('p', { class: 'muted', text: 'Paste a share code or link. It replaces the current graph (you can undo).' }), ta);
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Import', primary: true, async onClick(api) {
        try {
          const data = await decodeShare(ta.value);
          pushUndo(); loadDocData(data); currentName = '';
          applySettingsSideEffects(); changed(); updateHud();
          toast('Graph imported');
          return true;
        } catch (e) { api.setError(e.message.startsWith('That') ? e.message : 'Could not read that code — is it complete? (' + e.message + ')'); return false; }
      },
    }],
  });
}
function newGraph() {
  const go = () => { pushUndo(); doc.objects = []; sel = []; vertexEdit = null; currentName = ''; view.cx = 0; view.cy = 0; view.scale = 48; changed(); updateHud(); };
  if (S.confirmNew && doc.objects.length) confirmDialog('Start a new graph?', 'This clears the canvas. You can still undo, and saved graphs are kept.', 'Clear', go);
  else go();
}
function exportPNG() {
  const keep = sel; sel = []; const hv = hoverId; hoverId = null;
  render();
  canvas.toBlob((b) => {
    const a = el('a', { href: URL.createObjectURL(b), download: `${(currentName || 'vertex-forge').replace(/[^\w-]+/g, '_')}.png` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  sel = keep; hoverId = hv; requestRender();
}

function exportSVG() {
  const T = theme();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = (v) => +v.toFixed(2);
  const pathD = (pts, close) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + (close ? 'Z' : '');
  const strokeAttr = (st) => {
    const d = dashFor(st.dash, st.width);
    const round = st.dash === 'dotted' || st.dash === 'dashdot';
    return `stroke="${st.stroke}" stroke-width="${st.width}" stroke-linejoin="round"${d.length ? ` stroke-dasharray="${d.map(f).join(' ')}"` : ''}${round ? ' stroke-linecap="round"' : ''}`;
  };
  const text = (s, x, y, color, size, anchor = 'middle') => `<text x="${f(x)}" y="${f(y)}" fill="${color}" font-family="Inter, sans-serif" font-size="${size}" text-anchor="${anchor}" dominant-baseline="middle">${esc(s)}</text>`;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${f(cw)}" height="${f(ch)}" viewBox="0 0 ${f(cw)} ${f(ch)}">`, `<rect width="100%" height="100%" fill="${T.bg}"/>`];
  if (S.showAxes) { const o = W2S({ x: 0, y: 0 }); out.push(`<path d="M0 ${f(o.y)}H${f(cw)}M${f(o.x)} 0V${f(ch)}" stroke="${T.muted}" stroke-opacity="0.6" stroke-width="1"/>`); }
  for (const o of doc.objects) {
    if (o.hidden) continue;
    if (o.type === 'shape') {
      const fill = o.style.fillAlpha > 0 ? `fill="${o.style.fill}" fill-opacity="${o.style.fillAlpha}"` : 'fill="none"';
      out.push(`<path d="${pathD(G.outline(o, 240).map(W2S), true)}" ${fill} ${strokeAttr(o.style)}/>`);
    } else if (o.type === 'line') {
      const [a, b] = lineScreenEnds(o);
      out.push(`<path d="${pathD([a, b])}" fill="none" ${strokeAttr(o.style)}/>`);
      const p1 = W2S({ x: o.x1, y: o.y1 }), p2 = W2S({ x: o.x2, y: o.y2 });
      const head = (from, to) => {
        const an = Math.atan2(to.y - from.y, to.x - from.x), s = 7 + o.style.width * 2.2;
        return `<path d="${pathD([to, { x: to.x - s * Math.cos(an - 0.4), y: to.y - s * Math.sin(an - 0.4) }, { x: to.x - s * Math.cos(an + 0.4), y: to.y - s * Math.sin(an + 0.4) }], true)}" fill="${o.style.stroke}"/>`;
      };
      if (o.arrows === 'end' || o.arrows === 'both') out.push(head(p1, p2));
      if (o.arrows === 'both') out.push(head(p2, p1));
    } else if (o.type === 'point') {
      const p = W2S(o), r = Math.max(3, o.style.width + 2);
      out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${r}" fill="${o.style.stroke}"/>`);
      if (o.label) out.push(text(o.label, p.x + r + 5, p.y - r - 4, o.style.stroke, S.labelSize + 1, 'start'));
    } else if (o.type === 'text') {
      const p = W2S(o);
      o.text.split('\n').forEach((ln, i) => out.push(`<text x="${f(p.x)}" y="${f(p.y + i * o.size * 1.25)}" fill="${o.style.stroke}" font-family="Inter, sans-serif" font-weight="500" font-size="${o.size}">${esc(ln)}</text>`));
    } else if (o.type === 'func' && !o.hidden) {
      const runs = funcPolylines(o) || [];
      const op = (o.alpha ?? 1) < 1 ? ` stroke-opacity="${o.alpha}"` : '';
      for (const run of runs) if (run.length > 1) out.push(`<path d="${pathD(run)}" fill="none" ${strokeAttr(o.style)}${op}/>`);
      for (const p of funcEndDots(o)) out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${Math.max(3, o.style.width + 1.5)}" fill="${o.style.stroke}"${(o.alpha ?? 1) < 1 ? ` fill-opacity="${o.alpha}"` : ''}/>`);
      const lp = funcLabelPos(runs);
      if (o.showLabel && lp) out.push(text('y = ' + o.expr, lp.x, lp.y, o.style.stroke, S.labelSize, 'end'));
    } else if (o.type === 'angle') {
      const g = angleGeom(o);
      out.push(`<path d="${pathD([g.A, g.V, g.B])}" fill="none" ${strokeAttr(o.style)}/>`);
      const arc = [];
      for (let i = 0; i <= 40; i++) { const t = g.mid - g.sweep / 2 + (g.sweep * i) / 40; arc.push({ x: g.V.x + g.r * Math.cos(t), y: g.V.y + g.r * Math.sin(t) }); }
      out.push(`<path d="${g.right ? pathD(g.sq) : pathD(arc)}" fill="none" stroke="${o.style.stroke}" stroke-width="1.6"/>`);
      out.push(text(fmtAng(g.deg), g.L.x, g.L.y, o.style.stroke, S.labelSize));
    }
  }
  out.push('</svg>');
  const blob = new Blob([out.join('\n')], { type: 'image/svg+xml' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${(currentName || 'vertex-forge').replace(/[^\w-]+/g, '_')}.svg` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('SVG downloaded');
}

/* ---------- settings dialog ---------- */

function settingsDialog() {
  openDialog({
    title: 'Settings',
    wide: true,
    build(body) {
      const search = el('input', { class: 'search', type: 'search', placeholder: `Search ${SETTINGS_DEF.length} settings… (e.g. snap, exterior, decimal, color)`, autofocus: true });
      const list = el('div');
      let onlyChanged = false;
      const chips = el('div', { class: 'chips' });
      const groupNames = [...new Set(SETTINGS_DEF.map((d) => d.group))];
      const changedChip = el('button', { type: 'button', class: 'chip', text: 'Changed only' });
      changedChip.addEventListener('click', () => { onlyChanged = !onlyChanged; changedChip.classList.toggle('on', onlyChanged); draw(); });
      for (const g of groupNames) {
        chips.append(el('button', { type: 'button', class: 'chip', text: g, onclick: () => {
          if (search.value) { search.value = ''; draw(); }
          list.querySelector(`[data-group="${g}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } }));
      }
      chips.append(changedChip);
      const draw = () => {
        list.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        const groups = {};
        for (const d of SETTINGS_DEF) {
          const hay = `${d.group} ${d.label} ${d.desc || ''} ${d.key}`.toLowerCase();
          if (q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
          if (onlyChanged && S[d.key] === d.def) continue;
          (groups[d.group] ||= []).push(d);
        }
        const gnames = Object.keys(groups);
        if (!gnames.length) { list.append(el('div', { class: 'empty', text: onlyChanged ? 'Everything is at its default.' : 'No settings match.' })); return; }
        for (const g of gnames) {
          const box = el('div', { class: 'set-group', 'data-group': g }, el('h4', { text: g }));
          for (const d of groups[g]) box.append(settingRow(d, q));
          list.append(box);
        }
      };
      search.addEventListener('input', draw);
      body.append(search, chips, list);
      draw();
    },
    buttons: [
      { label: 'Reset all', danger: true, onClick(api) { for (const d of SETTINGS_DEF) S[d.key] = d.def; store.set('vf.settings', S); applySettingsSideEffects(); api.close(); settingsDialog(); toast('Settings reset'); return false; } },
      { label: 'Done', primary: true },
    ],
  });
}
function highlight(text, q) {
  const frag = document.createDocumentFragment();
  if (!q) { frag.append(text); return frag; }
  const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  text.split(re).forEach((part, i) => frag.append(i % 2 ? el('mark', { text: part }) : part));
  return frag;
}
function settingRow(d, q) {
  let ctl;
  if (d.type === 'bool') {
    const inp = el('input', { type: 'checkbox', checked: S[d.key], 'aria-label': d.label });
    inp.addEventListener('change', () => setSetting(d.key, inp.checked));
    ctl = el('label', { class: 'switch' }, inp, el('span'));
  } else if (d.type === 'number') {
    ctl = el('input', { type: 'number', min: d.min, max: d.max, step: d.step, value: S[d.key], 'aria-label': d.label });
    ctl.addEventListener('change', () => { const v = +ctl.value; if (validSetting(d, v)) setSetting(d.key, v); else { ctl.value = S[d.key]; toast(`${d.label}: choose ${d.min}–${d.max}`, true); } });
  } else if (d.type === 'color') {
    ctl = el('input', { type: 'color', value: S[d.key], 'aria-label': d.label });
    ctl.addEventListener('input', () => setSetting(d.key, ctl.value));
  } else if (d.type === 'select') {
    ctl = el('select', { 'aria-label': d.label }, d.options.map(([k, l]) => el('option', { value: k, text: l, selected: S[d.key] === k })));
    ctl.addEventListener('change', () => setSetting(d.key, ctl.value));
  } else {
    ctl = el('input', { type: 'text', maxlength: 12, value: S[d.key], 'aria-label': d.label });
    ctl.addEventListener('input', () => setSetting(d.key, ctl.value.slice(0, 12)));
  }
  const reset = el('button', { type: 'button', class: 'reset', title: `Reset to default (${d.type === 'bool' ? (d.def ? 'on' : 'off') : d.type === 'select' ? d.options.find(([k]) => k === d.def)[1] : d.def === '' ? 'empty' : d.def})`, text: '↺' });
  const row = el('div', { class: 'set-row' },
    el('div', { class: 'lbl' }, el('b', {}, highlight(d.label, q)), d.desc ? el('span', {}, highlight(d.desc, q)) : null),
    el('div', { class: 'ctl' }, reset, ctl));
  const syncReset = () => { reset.hidden = S[d.key] === d.def; };
  row.addEventListener('change', syncReset);
  row.addEventListener('input', syncReset);
  reset.addEventListener('click', () => {
    setSetting(d.key, d.def);
    if (d.type === 'bool') ctl.querySelector('input').checked = d.def; else ctl.value = d.def;
    syncReset();
  });
  syncReset();
  return row;
}

/* ---------- help dialog ---------- */

function helpDialog(query = '') {
  openDialog({
    title: 'Help',
    wide: true,
    build(body) {
      const search = el('input', { class: 'search', type: 'search', placeholder: 'Search help… (e.g. inscribe, snap, share)', value: query, autofocus: true });
      const toc = el('div', { class: 'help-toc' });
      const main = el('div', { class: 'help-body' });
      const draw = () => {
        toc.innerHTML = ''; main.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const hits = HELP.map((h) => {
          const txt = (h.title + ' ' + h.tags + ' ' + h.body.replace(/<[^>]+>/g, ' ')).toLowerCase();
          let score = 0;
          for (const w of words) {
            if (!txt.includes(w)) return null;
            score += (h.title.toLowerCase().includes(w) ? 5 : 0) + (h.tags.includes(w) ? 3 : 0) + 1;
          }
          return { h, score };
        }).filter(Boolean).sort((a, b) => b.score - a.score);
        if (!hits.length) { main.append(el('div', { class: 'empty', text: 'Nothing found. Try another word, like “line”, “angle” or “grid”.' })); return; }
        hits.forEach(({ h }, i) => {
          const sec = el('div', { class: 'help-topic', id: 'help-' + i }, el('h4', {}, highlight(h.title, q)));
          const content = el('div', { html: h.body }); // static, trusted help text
          if (words.length) markText(content, words);
          sec.append(content);
          main.append(sec);
          toc.append(el('button', { type: 'button', text: h.title, onclick: (e) => { $$('button', toc).forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
        });
      };
      search.addEventListener('input', draw);
      body.append(search, el('div', { class: 'help-layout' }, toc, main));
      draw();
    },
    buttons: [{ label: 'Close', primary: true }],
  });
}
function markText(root, words) {
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (!re.test(n.nodeValue)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    n.nodeValue.split(re).forEach((part, i) => frag.append(i % 2 ? el('mark', { text: part }) : part));
    n.replaceWith(frag);
  }
}

/* ======================= properties panel ======================= */

let cornersOpen = false;

// Properties for a graphed function: expression, full line style, opacity, domain, label.
function funcProps(box, o, title) {
  title.textContent = 'Function';
  const expr = el('input', { type: 'text', value: o.expr, spellcheck: false, class: 'mono', 'aria-label': 'Expression' });
  const err = el('div', { class: 'err' });
  expr.addEventListener('input', () => {
    const t = expr.value.trim().replace(/^y\s*=\s*/i, '');
    try { compile(t); err.textContent = ''; beginEdit(); o.expr = t; requestRender(); }
    catch (e) { err.textContent = e.message; }
  });
  expr.addEventListener('change', () => { endEdit(); changed(); });
  box.append(el('label', { class: 'field' }, 'y =', expr), err);
  box.append(el('div', { style: 'height:8px' }), styleEditor(o));
  const aout = el('output', { text: Math.round((o.alpha ?? 1) * 100) + '%' });
  const alpha = el('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: o.alpha ?? 1 });
  alpha.addEventListener('input', () => { beginEdit(); o.alpha = +alpha.value; aout.textContent = Math.round(o.alpha * 100) + '%'; requestRender(); });
  alpha.addEventListener('change', () => { endEdit(); changed(); });
  const domIn = (key) => {
    const inp = el('input', { type: 'text', inputmode: 'decimal', value: o[key] != null ? +o[key].toFixed(6) : '', placeholder: key === 'xMin' ? '−∞' : '+∞', 'aria-label': key === 'xMin' ? 'Domain start' : 'Domain end' });
    inp.addEventListener('change', () => {
      const t = inp.value.trim();
      const v = t === '' ? null : parseNum(t);
      if (v !== null && !isFinite(v)) { toast('Enter a number (or leave it empty for no limit)', true); inp.value = o[key] ?? ''; return; }
      const other = key === 'xMin' ? o.xMax : o.xMin;
      if (v !== null && other != null && (key === 'xMin' ? v >= other : v <= other)) { toast('The domain start must be less than its end', true); inp.value = o[key] ?? ''; return; }
      pushUndo(); o[key] = v; changed();
    });
    return inp;
  };
  const chk = (key, text) => {
    const c = el('input', { type: 'checkbox', checked: !!o[key] });
    c.addEventListener('change', () => { pushUndo(); o[key] = c.checked; changed(); });
    return el('label', { class: 'chk-row' }, c, text);
  };
  box.append(el('div', { class: 'prop-grid', style: 'margin-top:6px' },
    field('Opacity', el('div', { class: 'inline' }, alpha, aout), 'full'),
    field('Domain: from x =', domIn('xMin')), field('to x =', domIn('xMax'))));
  box.append(chk('endDots', 'Dots at the domain ends'), chk('showLabel', 'Show “y = …” label on the graph'));
  box.append(el('div', { class: 'row-btns' },
    el('button', { text: o.hidden ? 'Show' : 'Hide', onclick: () => { pushUndo(); o.hidden = !o.hidden; changed(); } }),
    el('button', { text: 'Duplicate', onclick: duplicateSel }),
    el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
}
let lastScale = '2';

function lockBtn() {
  const b = el('button', { type: 'button', class: `lock-aspect${S.lockAspect ? ' on' : ''}`, title: S.lockAspect ? 'Width & height are locked together (click to unlock)' : 'Lock width & height together', text: '🔗' });
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setSetting('lockAspect', !S.lockAspect); });
  return b;
}
// Compact "Scale ×[ ] Apply ½× 2× More…" row for the Properties panel.
function scaleRow() {
  const inp = el('input', { type: 'text', inputmode: 'decimal', value: lastScale, 'aria-label': 'Scale factor', title: 'Scale factor, e.g. 1.5, 0.25 or sqrt(2)' });
  const apply = (k) => {
    if (!(k > 0) || !isFinite(k)) { toast('The scale factor must be a number greater than 0', true); return; }
    if (Math.abs(k - 1) < 1e-15) return;
    transformSelection({ type: 'scale', k, about: S.scaleAbout });
    toast(`Scaled ×${+k.toFixed(6)}`);
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lastScale = inp.value; apply(parseNum(inp.value)); } });
  return el('div', { class: 'scale-row' },
    el('span', { class: 'lbl', text: 'Scale by (factor)' }), el('span', { class: 'x', text: '×' }), inp,
    el('button', { type: 'button', class: 'primary', text: 'Apply', onclick: () => { lastScale = inp.value; apply(parseNum(inp.value)); } }),
    el('button', { type: 'button', text: '½×', title: 'Half size', onclick: () => apply(0.5) }),
    el('button', { type: 'button', text: '2×', title: 'Double size', onclick: () => apply(2) }),
    el('button', { type: 'button', text: 'To…', title: 'Scale to a target area, perimeter, width, height or length', onclick: () => scaleDialog() }));
}

// Scale the selection by a factor or to a target measurement.
function scaleDialog() {
  const objs = selected().filter((o) => o.type !== 'func' && !o.locked);
  if (!objs.length) { toast('Select something to scale first', true); return; }
  const one = objs.length === 1 ? objs[0] : null;
  const modes = [['factor', 'By a factor', null]];
  if (one?.type === 'shape') {
    const pts = G.outline(one, 64);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    modes.push(['area', 'To an area', G.area(one), 2], ['perimeter', 'To a perimeter', G.perimeter(one), 1],
      ['width', 'To a width (box W)', one.w, 1], ['height', 'To a height (box H)', one.h, 1],
      ['xspan', 'To a horizontal span', Math.max(...xs) - Math.min(...xs), 1], ['yspan', 'To a vertical span', Math.max(...ys) - Math.min(...ys), 1]);
  } else if (one?.type === 'line') {
    modes.push(['length', 'To a length', Math.hypot(one.x2 - one.x1, one.y2 - one.y1), 1]);
  } else if (one?.type === 'angle') {
    modes.push(['length', 'To an arm length (longest)', Math.max(Math.hypot(one.ax - one.vx, one.ay - one.vy), Math.hypot(one.bx - one.vx, one.by - one.vy)), 1]);
  }
  let modeSel, val, about, preview;
  const factor = () => {
    const v = parseNum(val.value);
    const m = modes.find((x) => x[0] === modeSel.value);
    if (!(v > 0) || !isFinite(v)) return NaN;
    if (m[0] === 'factor') return v;
    return Math.pow(v / m[2], 1 / m[3]);
  };
  const update = () => {
    const m = modes.find((x) => x[0] === modeSel.value);
    const k = factor();
    if (m[0] === 'factor') preview.textContent = isFinite(k) ? (one?.type === 'shape' ? `New area ${fmtArea(G.area(one) * k * k)} · perimeter ${fmtLen(G.perimeter(one) * k)}` : `Everything becomes ${+k.toFixed(6)}× as large`) : '';
    else preview.textContent = `Now ${m[0] === 'area' ? fmtArea(m[2]) : fmtLen(m[2])}` + (isFinite(k) ? ` → scale factor ×${+k.toFixed(6)}` : '');
  };
  openDialog({
    title: one ? `Scale ${shapeName(one).toLowerCase()}` : `Scale ${objs.length} objects`,
    build(body) {
      modeSel = el('select', {}, modes.map(([k, l]) => el('option', { value: k, text: l })));
      val = el('input', { type: 'text', inputmode: 'decimal', value: lastScale, autofocus: true });
      about = el('select', {}, el('option', { value: 'center', text: 'Center of the selection', selected: S.scaleAbout === 'center' }), el('option', { value: 'origin', text: 'Origin (0, 0)', selected: S.scaleAbout === 'origin' }));
      preview = el('div', { class: 'muted tiny' });
      modeSel.addEventListener('change', () => {
        const m = modes.find((x) => x[0] === modeSel.value);
        val.value = m[0] === 'factor' ? lastScale : +m[2].toFixed(Math.max(S.decimals, 4));
        update(); val.select();
      });
      val.addEventListener('input', update);
      body.append(el('div', { class: 'grid2' }, el('label', { class: 'field' }, 'Scale', modeSel), el('label', { class: 'field' }, 'Value (math allowed, e.g. 2*pi)', val)),
        el('label', { class: 'field', style: 'margin-top:8px' }, 'Keep fixed', about), preview,
        el('p', { class: 'muted tiny', text: 'Proportions are always kept — the shape only gets bigger or smaller.' }));
      update();
      setTimeout(() => val.select(), 10);
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Scale', primary: true, onClick(api) {
        const k = factor();
        if (!(k > 0) || !isFinite(k)) { api.setError('Enter a positive number.'); return false; }
        if (modeSel.value === 'factor') lastScale = val.value;
        transformSelection({ type: 'scale', k, about: about.value });
        toast(`Scaled ×${+k.toFixed(6)}`);
        return true;
      },
    }],
  });
}

const DASH_SVG = {
  solid: '<svg viewBox="0 0 34 8"><path d="M1 4h32" stroke="currentColor" stroke-width="2"/></svg>',
  dashed: '<svg viewBox="0 0 34 8"><path d="M1 4h32" stroke="currentColor" stroke-width="2" stroke-dasharray="7 4"/></svg>',
  dotted: '<svg viewBox="0 0 34 8"><path d="M2 4h31" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 5"/></svg>',
  dashdot: '<svg viewBox="0 0 34 8"><path d="M1 4h32" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="8 3 0.1 3"/></svg>',
};

function field(label, input, cls = '') { return el('label', { class: 'field ' + cls }, label, input); }
function liveNum(value, apply, attrs = {}) {
  const inp = el('input', { type: 'number', step: 'any', value: +(+value).toFixed(6), ...attrs });
  inp.addEventListener('input', () => { const v = +inp.value; if (inp.value !== '' && isFinite(v)) { beginEdit(); apply(v); requestRender(); } });
  inp.addEventListener('change', () => { endEdit(); changed(); });
  return inp;
}
function styleEditor(target, isDefaults) {
  // target: object with .style, or a pseudo object for defaults
  const s = target.style;
  const wrap = el('div', { class: 'prop-grid' });
  const apply = (fn) => { if (!isDefaults) beginEdit(); fn(); if (isDefaults) isDefaults(s); requestRender(); };
  const commit = () => { if (!isDefaults) { endEdit(); changed(); } };
  const color = el('input', { type: 'color', value: s.stroke });
  color.addEventListener('input', () => apply(() => { s.stroke = color.value; }));
  color.addEventListener('change', commit);
  const out = el('output', { text: s.width });
  const width = el('input', { type: 'range', min: 0.5, max: 16, step: 0.5, value: s.width });
  width.addEventListener('input', () => apply(() => { s.width = +width.value; out.textContent = width.value; }));
  width.addEventListener('change', commit);
  wrap.append(field(target.type === 'point' || target.type === 'text' ? 'Color' : 'Line color', color), field(target.type === 'point' ? 'Size' : target.type === 'func' ? 'Thickness' : 'Boldness', el('div', { class: 'inline' }, width, out)));
  if (target.type !== 'point' && target.type !== 'text') {
    const picker = el('div', { class: 'dash-picker' });
    for (const d of DASHES) {
      const b = el('button', { type: 'button', class: s.dash === d ? 'on' : '', title: d, html: DASH_SVG[d] });
      b.addEventListener('click', () => { apply(() => { s.dash = d; }); commit(); $$('button', picker).forEach((x) => x.classList.toggle('on', x === b)); });
      picker.append(b);
    }
    wrap.append(field('Line style', picker, 'full'));
  }
  if ('fill' in s) {
    const fill = el('input', { type: 'color', value: s.fill });
    fill.addEventListener('input', () => apply(() => { s.fill = fill.value; }));
    fill.addEventListener('change', commit);
    const aout = el('output', { text: Math.round(s.fillAlpha * 100) + '%' });
    const alpha = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.fillAlpha });
    alpha.addEventListener('input', () => apply(() => { s.fillAlpha = +alpha.value; aout.textContent = Math.round(alpha.value * 100) + '%'; }));
    alpha.addEventListener('change', commit);
    wrap.append(field('Fill', fill), field('Fill opacity', el('div', { class: 'inline' }, alpha, aout)));
  }
  return wrap;
}

function renderProps() {
  const box = $('#props');
  if (box.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;
  box.innerHTML = '';
  const objs = selected();
  const title = $('#propsTitle');
  if (!objs.length) {
    title.textContent = 'New line style';
    const pseudo = { type: 'line', style: lineStyle() };
    box.append(el('p', { class: 'muted tiny', style: 'margin:0 0 8px', text: 'Lines you draw next use this style. Select something to edit it.' }));
    box.append(styleEditor(pseudo, (s) => { S.lineColor = s.stroke; S.lineWidth = s.width; S.lineDash = s.dash; store.set('vf.settings', S); }));
    const sp = { type: 'shape', style: shapeStyle() };
    box.append(el('h2', { style: 'margin:16px 0 8px', text: 'New shape style' }));
    box.append(styleEditor(sp, (s) => { S.shapeStroke = s.stroke; S.shapeWidth = s.width; S.shapeFill = s.fill; S.shapeFillAlpha = s.fillAlpha; store.set('vf.settings', S); }));
    return;
  }
  if (objs.length > 1) {
    title.textContent = `${objs.length} selected`;
    const color = el('input', { type: 'color', value: objs[0].style.stroke });
    color.addEventListener('input', () => { beginEdit(); for (const o of objs) o.style.stroke = color.value; requestRender(); });
    color.addEventListener('change', () => { endEdit(); changed(); });
    box.append(el('div', { class: 'prop-grid' }, field('Color (all)', color)));
    box.append(scaleRow());
    box.append(el('div', { class: 'row-btns' }, el('button', { text: 'Duplicate', onclick: duplicateSel }), el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
    return;
  }
  const o = objs[0];
  title.textContent = shapeName(o);
  if (o.type === 'func') { funcProps(box, o, title); return; }
  if (o.locked) {
    box.append(el('span', { class: 'badge', text: '🔒 Locked' }), el('p', { class: 'muted tiny', style: 'margin:0 0 8px', text: 'Locked objects can’t be moved, resized or deleted.' }),
      el('div', { class: 'row-btns' }, el('button', { class: 'primary', text: 'Unlock', onclick: () => toggleFlag(o, 'locked') })));
    return;
  }
  const after = () => { if (o.type === 'shape') updateInscribed(o.id); };
  if (o.type === 'shape') {
    if (o.inscribed) {
      const p = byId(o.inscribed.parent);
      box.append(el('span', { class: 'badge link', text: `Inscribed in ${p ? shapeName(p).toLowerCase() : '?'}` }));
    }
    const nm = el('input', { type: 'text', maxlength: 40, value: o.name, placeholder: shapeName({ ...o, name: '' }) });
    nm.addEventListener('input', () => { beginEdit(); o.name = nm.value.slice(0, 40); });
    nm.addEventListener('change', () => { endEdit(); changed(); });
    const g = el('div', { class: 'prop-grid' });
    const upd = (fn) => (v) => { detach(o); fn(v); after(); };
    g.append(field('Name', nm, 'full'),
      field('Center x', liveNum(o.cx, upd((v) => { o.cx = v; }))),
      field('Center y', liveNum(o.cy, upd((v) => { o.cy = v; }))),
      field('Width', liveNum(o.w, upd((v) => { if (v > 0) { if (S.lockAspect) o.h *= v / o.w; o.w = v; } }), { min: 0 })),
      el('div', { class: 'field' }, el('span', { class: 'hlabel' }, 'Height', lockBtn()), liveNum(o.h, upd((v) => { if (v > 0) { if (S.lockAspect) o.w *= v / o.h; o.h = v; } }), { min: 0 })),
      field('Rotation °', liveNum((o.rot / G.DEG) % 360, upd((v) => { o.rot = v * G.DEG; }))),
      field('Snap points', liveNum(o.snapN, (v) => { o.snapN = clamp(Math.round(v), 0, 500); }, { min: 0, max: 500, step: 1 })));
    box.append(g);
    box.append(scaleRow());
    box.append(el('div', { style: 'height:10px' }), styleEditor(o));
    const btns = el('div', { class: 'row-btns' });
    if (o.kind === 'polygon') {
      btns.append(el('button', { text: 'Sides…', onclick: () => dimsDialog(o, 'sides') }), el('button', { text: 'Angles…', onclick: () => dimsDialog(o, 'angles') }));
    } else btns.append(el('button', { text: 'Radius…', onclick: () => radiusDialog(o) }));
    btns.append(el('button', { text: 'Inscribe…', onclick: (e) => { const r = e.target.getBoundingClientRect(); showMenu(inscribeMenu(o), r.left, r.bottom + 4); } }));
    btns.append(el('button', { class: 'danger', text: 'Delete', onclick: deleteSel }));
    box.append(btns);
    const kv = el('dl', { class: 'kv' });
    const add = (k, v) => kv.append(el('dt', { text: k }), el('dd', { text: v }));
    add('Type', C.classify(o));
    if (o.kind === 'polygon') {
      add('Sides', o.pts.length);
      const angs = G.interiorAngles(G.polyWorld(o));
      add('Angle sum', fmtAng(angs.reduce((a, b) => a + b, 0)));
    } else {
      const { rx, ry } = G.ellipseRadii(o);
      if (G.isCircle(o)) add('Radius', fmtLen(rx)); else { add('rx', fmtLen(rx)); add('ry', fmtLen(ry)); }
    }
    if (toolsOn.area) { add('Area', fmtArea(G.area(o))); add('Perimeter', fmtLen(G.perimeter(o))); }
    else kv.append(el('dt', { class: 'muted', style: 'grid-column:1/-1;font-size:11.5px', text: 'Turn on the Area tool to see area & perimeter.' }));
    box.append(kv);
    if (o.kind === 'polygon' && o.pts.length <= 30) {
      const W = G.polyWorld(o);
      const det = el('details', { class: 'corners' }, el('summary', { text: 'Corner coordinates' }));
      det.open = cornersOpen;
      det.addEventListener('toggle', () => { cornersOpen = det.open; });
      const grid = el('div', { class: 'corner-grid' });
      W.forEach((p, i) => {
        const setCoord = (key) => (v) => { const Wn = G.polyWorld(o); Wn[i][key] = v; G.setPolyFromWorld(o, Wn); detach(o); updateInscribed(o.id); };
        grid.append(el('span', { class: 'nm', text: LETTERS(i) }), liveNum(p.x, setCoord('x'), { 'aria-label': `${LETTERS(i)} x` }), liveNum(p.y, setCoord('y'), { 'aria-label': `${LETTERS(i)} y` }));
      });
      det.append(grid);
      box.append(det);
    }
  } else if (o.type === 'line') {
    const g = el('div', { class: 'prop-grid' });
    const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
    const ext = el('select', {}, [['segment', 'Segment'], ['ray', 'Ray'], ['line', 'Infinite line']].map(([k, l]) => el('option', { value: k, text: l, selected: o.ext === k })));
    ext.addEventListener('change', () => { pushUndo(); o.ext = ext.value; changed(); });
    const arr = el('select', {}, [['none', 'None'], ['end', 'End'], ['both', 'Both']].map(([k, l]) => el('option', { value: k, text: l, selected: o.arrows === k })));
    arr.addEventListener('change', () => { pushUndo(); o.arrows = arr.value; changed(); });
    g.append(
      field('x₁', liveNum(o.x1, (v) => { o.x1 = v; })), field('y₁', liveNum(o.y1, (v) => { o.y1 = v; })),
      field('x₂', liveNum(o.x2, (v) => { o.x2 = v; })), field('y₂', liveNum(o.y2, (v) => { o.y2 = v; })),
      field('Type', ext), field('Arrowheads', arr));
    box.append(g, scaleRow(), el('div', { style: 'height:10px' }), styleEditor(o));
    const kv = el('dl', { class: 'kv' });
    kv.append(el('dt', { text: 'Length' }), el('dd', { text: fmtLen(L) }), el('dt', { text: 'Angle' }), el('dd', { text: fmtAng((Math.atan2(o.y2 - o.y1, o.x2 - o.x1) / G.DEG + 360) % 360) }));
    if (Math.abs(o.x2 - o.x1) > 1e-12) kv.append(el('dt', { text: 'Slope' }), el('dd', { text: ((o.y2 - o.y1) / (o.x2 - o.x1)).toFixed(S.decimals) }));
    box.append(kv, el('div', { class: 'row-btns' }, el('button', { text: 'Length & angle…', onclick: () => lineDialog(o) }), el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
  } else if (o.type === 'angle') {
    const reflex = el('input', { type: 'checkbox', checked: o.reflex });
    reflex.addEventListener('change', () => { pushUndo(); o.reflex = reflex.checked; changed(); });
    const kv = el('dl', { class: 'kv' });
    kv.append(el('dt', { text: 'Measure' }), el('dd', { text: fmtAng(angleValue(o)) }), el('dt', { text: 'Other side' }), el('dd', { text: fmtAng(360 - angleValue(o)) }));
    const g = el('div', { class: 'prop-grid' },
      field('Vertex x', liveNum(o.vx, (v) => { o.vx = v; })), field('Vertex y', liveNum(o.vy, (v) => { o.vy = v; })));
    box.append(kv, el('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px;margin:8px 0' }, reflex, 'Show the reflex (outside) angle'), g, el('div', { style: 'height:10px' }), styleEditor(o),
      el('div', { class: 'row-btns' }, ...constructionsMenu(o).map((it) => el('button', { text: it.label, onclick: it.action })), el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
  } else if (o.type === 'point') {
    const lab = el('input', { type: 'text', maxlength: 20, value: o.label, placeholder: 'e.g. A' });
    lab.addEventListener('input', () => { beginEdit(); o.label = lab.value.slice(0, 20); requestRender(); });
    lab.addEventListener('change', () => { endEdit(); changed(); });
    box.append(el('div', { class: 'prop-grid' }, field('x', liveNum(o.x, (v) => { o.x = v; })), field('y', liveNum(o.y, (v) => { o.y = v; })), field('Label', lab, 'full')));
    box.append(el('div', { style: 'height:10px' }), styleEditor(o), el('div', { class: 'row-btns' }, el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
  } else if (o.type === 'text') {
    const ta = el('textarea', { rows: 2, style: 'width:100%' }); ta.value = o.text;
    ta.addEventListener('input', () => { beginEdit(); o.text = ta.value.slice(0, 300) || ' '; requestRender(); });
    ta.addEventListener('change', () => { endEdit(); changed(); });
    box.append(el('div', { class: 'prop-grid' }, field('Text', ta, 'full'), field('Size', liveNum(o.size, (v) => { o.size = clamp(v, 6, 120); })), field('x', liveNum(o.x, (v) => { o.x = v; }))));
    box.append(el('div', { style: 'height:10px' }), styleEditor(o), el('div', { class: 'row-btns' }, el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
  }
}

/* ======================= objects panel ======================= */

const GLYPH = { shape: '⬟', line: '╱', point: '•', text: 'T', angle: '∠' };
function renderObjList() {
  const list = $('#objList');
  if (!list) return;
  const focusIdx = list.contains(document.activeElement) ? [...list.children].indexOf(document.activeElement.closest('.obj-row')) : -1;
  queueMicrotask(() => { if (focusIdx >= 0) (list.children[focusIdx] || list.lastElementChild)?.focus?.(); });
  const objs = doc.objects.filter((o) => o.type !== 'func');
  $('#objCount').textContent = objs.length ? `${objs.length}` : '';
  list.innerHTML = '';
  if (!objs.length) { list.append(el('div', { class: 'muted tiny', text: 'Nothing here yet — insert a shape or draw a line.' })); return; }
  const ordered = S.objNewestFirst ? objs.slice().reverse() : objs;
  for (const o of ordered.slice(0, 400)) {
    const nm = o.type === 'text' ? `“${o.text.slice(0, 24)}”` : o.type === 'point' && o.label ? `Point ${o.label}` : shapeName(o);
    const row = el('div', { class: `obj-row${sel.includes(o.id) ? ' sel' : ''}${o.hidden ? ' hidden' : ''}${flash?.id === o.id ? ' flashing' : ''}`, title: o.inscribed ? 'Inscribed shape' : '', tabindex: 0, role: 'button', 'aria-label': `Select ${nm}` },
      el('span', { class: 'glyph', text: GLYPH[o.type] || '?', style: `color:${o.style?.stroke || 'inherit'}` }),
      el('span', { class: 'nm', text: nm + (o.inscribed ? ' ↳' : '') }),
      el('button', { title: o.hidden ? 'Show' : 'Hide', class: o.hidden ? 'on' : '', html: o.hidden ? EYE_OFF : EYE, onclick: (e) => { e.stopPropagation(); toggleFlag(o, 'hidden'); } }),
      el('button', { title: o.locked ? 'Unlock' : 'Lock', class: o.locked ? 'on' : '', html: o.locked ? LOCK : UNLOCK, onclick: (e) => { e.stopPropagation(); toggleFlag(o, 'locked'); } }),
      S.objDeleteButton ? el('button', { title: o.locked ? 'Locked — unlock to delete' : 'Delete', class: 'del', disabled: o.locked, html: TRASH, onclick: (e) => { e.stopPropagation(); deleteIds([o.id]); } }) : null);
    const choose = (e) => {
      if (e.shiftKey) { setSelection(sel.includes(o.id) ? sel.filter((i) => i !== o.id) : [...sel, o.id]); return; }
      if (S.objFlash) flashObject(o.id);
      setSelection([o.id]);
      focusObject(o, S.objPanTo);
      if (o.hidden) toast('This object is hidden — click the eye to show it');
    };
    row.addEventListener('click', choose);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(e); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteIds([o.id]); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling)?.focus(); }
    });
    row.addEventListener('mouseenter', () => { if (S.objHover) { listHover = o.id; requestRender(); } });
    row.addEventListener('mouseleave', () => { if (listHover === o.id) { listHover = null; requestRender(); } });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!sel.includes(o.id)) setSelection([o.id]); showMenu(objectMenu(o), e.clientX, e.clientY); });
    list.append(row);
  }
}
const ICON = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EYE = ICON('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const EYE_OFF = ICON('<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>');
const LOCK = ICON('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
const TRASH = ICON('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');
const UNLOCK = ICON('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.2"/>');

/* ======================= functions panel ======================= */

const FUNC_COLORS = ['#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
$('#funcForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#funcInput');
  const expr = inp.value.trim().replace(/^y\s*=\s*/i, '');
  if (!expr) return;
  try { compile(expr); } catch (err) { $('#funcErr').textContent = err.message; return; }
  $('#funcErr').textContent = '';
  pushUndo();
  const count = doc.objects.filter((o) => o.type === 'func').length;
  const o = { id: uid(), type: 'func', expr, style: { stroke: FUNC_COLORS[count % FUNC_COLORS.length], width: S.funcWidth, dash: S.funcDash }, hidden: false, alpha: 1, xMin: null, xMax: null, showLabel: S.funcLabels, endDots: false };
  doc.objects.push(o);
  inp.value = '';
  setSelection([o.id]);
  changed();
});
$('#funcInput').addEventListener('input', () => { $('#funcErr').textContent = ''; });

function renderFuncList() {
  const list = $('#funcList');
  list.innerHTML = '';
  for (const o of doc.objects.filter((x) => x.type === 'func')) {
    const color = el('input', { type: 'color', value: o.style.stroke, style: 'width:0;height:0;opacity:0;position:absolute' });
    const d = dashFor(o.style.dash, Math.min(o.style.width, 3)).map((v) => +v.toFixed(2)).join(' ');
    const sw = el('span', { class: 'sw-line', title: 'Change color', html: `<svg viewBox="0 0 28 10" width="28" height="10"><path d="M2 5h24" stroke="${o.style.stroke}" stroke-opacity="${o.alpha ?? 1}" stroke-width="${Math.min(o.style.width, 5)}"${d ? ` stroke-dasharray="${d}"` : ''} stroke-linecap="${o.style.dash === 'dotted' || o.style.dash === 'dashdot' ? 'round' : 'butt'}"/></svg>` });
    sw.addEventListener('click', (e) => { e.stopPropagation(); color.click(); });
    color.addEventListener('input', () => { beginEdit(); o.style.stroke = color.value; sw.querySelector('path').setAttribute('stroke', color.value); requestRender(); });
    color.addEventListener('change', () => { endEdit(); changed(); });
    const item = el('div', { class: `func-item${o.hidden ? ' hidden' : ''}${sel.includes(o.id) ? ' sel' : ''}` }, sw, color, el('code', { text: 'y = ' + o.expr, title: o.expr }),
      el('button', { title: o.hidden ? 'Show' : 'Hide', text: o.hidden ? '◌' : '●', onclick: (e) => { e.stopPropagation(); pushUndo(); o.hidden = !o.hidden; changed(); } }),
      el('button', { title: 'Edit', text: '✎', onclick: (e) => { e.stopPropagation(); editFunc(o); } }),
      el('button', { title: 'Delete', text: '✕', onclick: (e) => { e.stopPropagation(); pushUndo(); doc.objects = doc.objects.filter((x) => x !== o); sel = sel.filter((i) => i !== o.id); changed(); } }));
    item.addEventListener('click', () => setSelection([o.id]));
    list.append(item);
  }
}
function editFunc(o) {
  let f;
  openDialog({
    title: 'Edit function',
    build(body) { f = el('input', { type: 'text', value: o.expr, autofocus: true, style: 'font-family:JetBrains Mono,monospace' }); body.append(el('label', { class: 'field' }, 'y =', f)); },
    buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick(api) {
      const expr = f.value.trim().replace(/^y\s*=\s*/i, '');
      try { compile(expr); } catch (e) { api.setError(e.message); return false; }
      pushUndo(); o.expr = expr; changed(); return true;
    } }],
  });
}

/* ======================= right-triangle solver ======================= */

function rtSolve() {
  const get = (k) => { const v = $('#rt_' + k).value.trim(); return v === '' ? null : +v; };
  let a = get('a'), b = get('b'), c = get('c'), A = get('A'), B = get('B');
  const err = (m) => { $('#rtErr').textContent = m; };
  err('');
  const vals = { a, b, c, A, B };
  for (const [k, v] of Object.entries(vals)) if (v !== null && !(v > 0)) return err(`${k} must be a positive number.`);
  if (A !== null && A >= 90) return err('∠A must be less than 90°.');
  if (B !== null && B >= 90) return err('∠B must be less than 90°.');
  if (A === null && B !== null) A = 90 - B;
  const filled = [a, b, c].filter((v) => v !== null).length;
  if (filled === 0) return err('Enter at least one side length.');
  if (filled === 1 && A === null) return err('Enter one more value (a side or an angle).');
  const r = A !== null ? A * G.DEG : null;
  if (a !== null && b !== null) { c = Math.hypot(a, b); }
  else if (a !== null && c !== null) { if (c <= a) return err('The hypotenuse c must be longer than leg a.'); b = Math.sqrt(c * c - a * a); }
  else if (b !== null && c !== null) { if (c <= b) return err('The hypotenuse c must be longer than leg b.'); a = Math.sqrt(c * c - b * b); }
  else if (a !== null) { b = a / Math.tan(r); c = a / Math.sin(r); }
  else if (b !== null) { a = b * Math.tan(r); c = b / Math.cos(r); }
  else { a = c * Math.sin(r); b = c * Math.cos(r); }
  A = Math.atan2(a, b) / G.DEG; B = 90 - A;
  const d = S.decimals;
  for (const [k, v] of Object.entries({ a, b, c, A, B })) $('#rt_' + k).value = +v.toFixed(Math.max(d, 2));
  $('#rt_area').textContent = fmtArea((a * b) / 2);
  return { a, b };
}
$('#rtSolve').addEventListener('click', rtSolve);
$('#rtClear').addEventListener('click', () => { for (const k of 'abcAB') $('#rt_' + k).value = ''; $('#rt_area').textContent = '—'; $('#rtErr').textContent = ''; });
$('#rtFromSel').addEventListener('click', () => {
  const o = single();
  const k = o ? rightAngleIndex(o) : -1;
  if (k < 0) { $('#rtErr').textContent = 'Select a right triangle first.'; return; }
  const L = G.sideLengths(o);
  for (const x of 'AB') $('#rt_' + x).value = '';
  $('#rt_a').value = +L[k].toFixed(8); $('#rt_b').value = +L[(k + 2) % 3].toFixed(8); $('#rt_c').value = '';
  rtSolve();
});
$('#rtInsert').addEventListener('click', () => {
  const r = rtSolve();
  if (!r) return;
  const c = { x: view.cx, y: view.cy };
  const world = [{ x: 0, y: 0 }, { x: r.b, y: 0 }, { x: 0, y: r.a }].map((p) => ({ x: c.x + p.x - r.b / 3, y: c.y + p.y - r.a / 3 }));
  pushUndo();
  const o = makeShape(3, 0, 0, 1, 1);
  o.name = 'Right triangle';
  G.setPolyFromWorld(o, world);
  addObject(o);
  changed();
});

/* ======================= wiring ======================= */

function polyIcon(n) {
  if (n === 1) return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
  if (n === 2) return '<svg viewBox="0 0 24 24"><path d="M3 17a9 9 0 0 1 18 0z"/></svg>';
  const pts = G.regularUnit(n).map(([u, v]) => `${(12 + u * 18).toFixed(2)},${(12 - v * 18 * G.regularAspect(n)).toFixed(2)}`);
  return `<svg viewBox="0 0 24 24"><polygon points="${pts.join(' ')}"/></svg>`;
}
function presetIcon(p) {
  if (!p.pts) return '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>';
  const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), k = 20 / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0);
  const ox = (24 - (Math.max(...xs) - x0) * k) / 2, oy = (24 - (Math.max(...ys) - y0) * k) / 2;
  return `<svg viewBox="0 0 24 24"><polygon stroke-linejoin="round" points="${p.pts.map(([x, y]) => `${(ox + (x - x0) * k).toFixed(2)},${(24 - oy - (y - y0) * k).toFixed(2)}`).join(' ')}"/></svg>`;
}

function buildPanels() {
  const grid = $('#sidesGrid');
  for (let n = 1; n <= 20; n++) {
    const b = el('button', { type: 'button', title: `${SIDE_NAMES[n]} (${n} side${n > 1 ? 's' : ''})`, 'data-n': n, html: polyIcon(n) + `<span>${n}</span>` });
    b.addEventListener('click', () => { setShapeSides(n); insertShape(n); });
    grid.append(b);
  }
  setShapeSides(4);
  const list = $('#presetList');
  const allPresets = [...PRESETS, { id: 'oval', name: 'Oval (ellipse)', desc: 'A stretched circle with two radii.', kind: 'ellipse' }];
  const draw = () => {
    const q = $('#presetSearch').value.trim().toLowerCase();
    list.innerHTML = '';
    for (const p of allPresets) {
      if (q && !`${p.name} ${p.desc}`.toLowerCase().includes(q)) continue;
      const b = el('button', { type: 'button', title: p.desc, html: presetIcon(p) });
      b.append(el('div', {}, el('div', { class: 'pname', text: p.name }), el('div', { class: 'pdesc', text: p.desc })));
      b.addEventListener('click', () => insertPreset(p));
      list.append(b);
    }
    if (!list.children.length) list.append(el('div', { class: 'muted tiny', text: 'No special shapes match.' }));
  };
  $('#presetSearch').addEventListener('input', draw);
  draw();
}

function toggleTool(key, btn) {
  toolsOn[key] = !toolsOn[key];
  btn.setAttribute('aria-pressed', toolsOn[key]);
  store.set('vf.tools', toolsOn);
  if (key === 'rightTri') $('#rtSection').hidden = !toolsOn.rightTri;
  toast(`${key === 'rightTri' ? 'Right-triangle' : 'Area'} tool ${toolsOn[key] ? 'on' : 'off'}`);
  renderProps(); requestRender();
}

function wire() {
  $$('.toolbar [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#btnZoomIn').addEventListener('click', () => zoomAt({ x: cw / 2, y: ch / 2 }, 1.25));
  $('#btnZoomOut').addEventListener('click', () => zoomAt({ x: cw / 2, y: ch / 2 }, 0.8));
  $('#btnFit').addEventListener('click', fitAll);
  $('#btnPanels').addEventListener('click', () => {
    if (matchMedia('(max-width: 820px)').matches) document.body.classList.toggle('panels-shown');
    else document.body.classList.toggle('panels-hidden');
  });
  $('#btnNew').addEventListener('click', newGraph);
  $('#btnOpen').addEventListener('click', openDialogFiles);
  $('#btnSave').addEventListener('click', saveDialog);
  $('#btnShare').addEventListener('click', shareDialog);
  $('#btnImport').addEventListener('click', importDialog);
  $('#btnExport').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([{ label: 'PNG image', action: exportPNG }, { label: 'SVG (vector, for print or editing)', action: exportSVG }], r.left, r.bottom + 4);
  });
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnSettings').addEventListener('click', settingsDialog);
  $('#btnHelp').addEventListener('click', () => helpDialog());
  $('#tglGrid').addEventListener('click', () => setSetting('showGrid', !S.showGrid));
  $('#gridSizeInput').addEventListener('change', (e) => {
    const v = +e.target.value;
    if (v >= 0.01 && v <= 1000) setSetting('gridSize', v); else { e.target.value = S.gridSize; toast('Grid spacing must be between 0.01 and 1000', true); }
  });
  $('#tglRightTri').addEventListener('click', (e) => toggleTool('rightTri', e.currentTarget));
  $('#tglArea').addEventListener('click', (e) => toggleTool('area', e.currentTarget));
}

async function init() {
  loadSettings();
  const t = store.get('vf.tools');
  if (t) { toolsOn.rightTri = !!t.rightTri; toolsOn.area = !!t.area; }
  $('#tglRightTri').setAttribute('aria-pressed', toolsOn.rightTri);
  $('#tglArea').setAttribute('aria-pressed', toolsOn.area);
  $('#rtSection').hidden = !toolsOn.rightTri;
  buildPanels();
  wire();
  let loaded = false;
  if (/[#&]g=/.test(location.hash)) {
    try { loadDocData(await decodeShare(location.hash)); loaded = true; toast('Loaded shared graph'); }
    catch (e) { toast('Could not open the shared link: ' + e.message, true); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!loaded && S.autosave) {
    const cur = store.get('vf.current');
    if (cur) { try { loadDocData(cur); loaded = true; } catch { /* ignore broken autosave */ } }
  }
  if (!loaded) demo();
  applySettingsSideEffects();
  setTool('select');
  resize();
  if (cw < 700 && doc.objects.length) fitAll();
  changed();
  updateHud();
}

// First-visit starter scene.
function demo() {
  const tri = makeShape(3, 0, 0, 1, 1);
  tri.name = '3-4-5 triangle';
  G.setPolyFromWorld(tri, [{ x: -5, y: -1 }, { x: -1, y: -1 }, { x: -5, y: 2 }]);
  tri.snapN = 6;
  const hex = makeShape(6, 4, 0.5, 4, 4 * G.regularAspect(6));
  hex.snapN = 6;
  doc.objects.push(tri, hex);
  const r = G.inscribe(hex, 'circle', 1);
  const c = makeShape(1, 0, 0, 1, 1);
  c.style.stroke = S.inscribeColor; c.style.fill = S.inscribeColor; c.style.fillAlpha = 0.08;
  applyInscribeResult(c, r);
  c.inscribed = { parent: hex.id, kind: 'circle', n: 1 };
  doc.objects.push(c);
  const [p, q] = [G.polyWorld(tri)[1], G.polyWorld(hex)[3]];
  doc.objects.push({ id: uid(), type: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y, style: { stroke: '#f472b6', width: 2.5, dash: 'dashed' }, ext: 'segment', arrows: 'none', name: '' });
  doc.objects.push({ id: uid(), type: 'text', x: -5, y: 4.2, text: 'Right-click any shape to explore ✦', size: 16, style: { stroke: '#94a3b8', width: 1, dash: 'solid' } });
}

init();

// Expose a tiny hook for automated tests.
window.__vf = { get doc() { return doc; }, get sel() { return sel; }, view, S, G, C, transformSelection, snap, exportSVG, insertShape, insertPreset, doInscribe, byId, setSelection, encodeShare, decodeShare, loadDocData, W2S, S2W, toolsOn, render };
