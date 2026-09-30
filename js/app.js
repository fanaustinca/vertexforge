import * as G from './geom.js';
import * as C from './construct.js';
import { exactForm } from './exact.js';
import * as Bool from './boolean.js';
import * as LK from './links.js';
import { parseCommand, suggest } from './commands.js';
import * as GR from './graphs.js';
import * as ST from './stats.js';
import * as PZ from './puzzle.js';
import { compile, compileVars, derivativeText, parse as parseExpr, PARAM_RE } from './expr.js';
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
  $('#tglExact')?.setAttribute('aria-pressed', S.numberForm !== 'decimal');
  if ($('#touchBar')) applyTouchBar();
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
let pick = null; // {type: 'point'|'line'|'shape', hint, cb} while a construction waits for a click
let linkPicks = []; // sides/angles chosen with the Link tool
let linkHover = null;
let clipboard = null;
const funcCache = new Map();
const params = {}; // live slider values, read by compiled functions
function syncParams() {
  for (const k of Object.keys(params)) delete params[k];
  for (const o of doc.objects) if (o.type === 'slider') params[o.name] = o.value;
}

const byId = (id) => doc.objects.find((o) => o.id === id);
const selected = () => sel.map(byId).filter(Boolean);
const single = () => (sel.length === 1 ? byId(sel[0]) : null);

// Key points of an object (for fitting, marquee selection, moving).
function objPoints(o) {
  if (o.type === 'shape') return G.outline(o, 32);
  if (o.type === 'line') return [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }];
  if (o.type === 'angle') return [{ x: o.ax, y: o.ay }, { x: o.vx, y: o.vy }, { x: o.bx, y: o.by }];
  if (o.type === 'point' || o.type === 'text') return [{ x: o.x, y: o.y }];
  if (o.type === 'locus') return (locusCache.get(o.id)?.path || []).filter(Boolean).filter((_, i) => i % 10 === 0);
  if (o.type === 'integral') return integralOutline(o)?.filter((_, i) => i % 20 === 0) || [];
  if (o.type === 'link') return o.refs.flatMap((r) => { if (LK.isSegRef(r)) return LK.segEnds(r, byId) || []; const t = byId(r.o); if (!t) return []; return r.t === 'angle' ? [{ x: t.vx, y: t.vy }] : [G.polyWorld(t)[r.i]]; });
  if (o.type === 'arc') { const pts = C.arcPoints(arcE(o), o.t0, o.sweep, 24); if (o.mode === 'sector') pts.push({ x: o.cx, y: o.cy }); return pts; }
  if (o.type === 'region') { const A = byId(o.a), B = byId(o.b); return [...(A ? objPoints(A) : []), ...(B ? objPoints(B) : [])]; }
  return [];
}
const arcE = (o) => ({ c: { x: o.cx, y: o.cy }, rx: o.rx, ry: o.ry, rot: o.rot, half: false });
function shiftObj(t, dx, dy) {
  if (t.type === 'shape') { t.cx += dx; t.cy += dy; }
  else if (t.type === 'line') { t.x1 += dx; t.y1 += dy; t.x2 += dx; t.y2 += dy; }
  else if (t.type === 'point' || t.type === 'text') { t.x += dx; t.y += dy; }
  else if (t.type === 'angle') { t.ax += dx; t.ay += dy; t.vx += dx; t.vy += dy; t.bx += dx; t.by += dy; }
  else if (t.type === 'arc') { t.cx += dx; t.cy += dy; }
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
  if (o.type === 'slider') return `Slider ${o.name}`;
  if (o.type === 'locus') return `Locus of ${byId(o.pt)?.label || 'a point'}`;
  if (o.type === 'integral') return o.g ? 'Area between graphs' : 'Area under a curve';
  if (o.type === 'link') return LK.linkLabel(o);
  if (o.type === 'arc') return o.name || { arc: 'Arc', sector: 'Sector', segment: 'Circular segment' }[o.mode];
  if (o.type === 'region') return { intersect: 'Overlap', union: 'Combined region', aminusb: 'Difference', bminusa: 'Difference', xor: 'Either but not both' }[o.op];
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

// A standalone circle sector: center at `at`, radius r, angle (degrees) or arc length.
function makeSector(at, r, deg, start = 0) {
  return { id: uid(), type: 'arc', mode: 'sector', cx: at.x, cy: at.y, rx: r, ry: r, rot: 0, t0: start * G.DEG, sweep: deg * G.DEG, style: { stroke: S.shapeStroke, width: S.shapeWidth, dash: 'solid', fill: S.shapeFill, fillAlpha: Math.max(S.shapeFillAlpha, 0.15) }, name: '' };
}
function insertSector(at) {
  const c = at || insertPoint();
  pushUndo();
  const o = addObject(makeSector({ x: c.x - S.defaultSize / 4, y: c.y - S.defaultSize / 4 }, S.defaultSize / 2, 60));
  changed();
  toast('Sector added — drag its ends to change the angle, the middle of the arc for the radius, or type values in Properties');
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
function detach(o) { if (o.inscribed) o.inscribed = null; if (o.cons) delete o.cons; }

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
  if (r && o.cons && ['line', 'point', 'shape', 'angle', 'arc'].includes(r.type)) { const c = cleanCons(o.cons); if (c) r.cons = c; }
  if (r && r.type === 'line') { if (o.showLen) r.showLen = true; if (o.showEq) r.showEq = true; }
  if (r && o.trace) r.trace = true;
  if (r && r.type === 'angle' && o.att && typeof o.att === 'object') {
    const att = {};
    for (const k of ['a', 'v', 'b']) { const c = cleanRef(o.att[k]); if (c) att[k] = c; }
    if (Object.keys(att).length) r.att = att;
  }
  if (r && o.bind && typeof o.bind === 'object') {
    const ok = {};
    for (const [k, v] of Object.entries(o.bind)) if (BIND_FIELDS.includes(k) && typeof v === 'string' && v.length <= 120) ok[k] = v;
    if (Object.keys(ok).length) r.bind = ok;
  }
  return r;
}
const ID_RE = /^[\w-]{1,20}$/;
function cleanCons(c) {
  if (!c || typeof c.k !== 'string' || !/^[a-zA-Z]{1,16}$/.test(c.k)) return null;
  const s = Array.isArray(c.s) ? c.s.filter((id) => typeof id === 'string' && ID_RE.test(id)).slice(0, 200) : [];
  if (!s.length) return null;
  const out = { k: c.k, s };
  for (const key of ['i', 'j']) if (Number.isInteger(c[key]) && c[key] >= 0 && c[key] < 200) out[key] = c[key];
  if (typeof c.c === 'string' && /^[A-Z]$/.test(c.c)) out.c = c.c;
  if (c.p && typeof c.p.x === 'number' && typeof c.p.y === 'number' && isFinite(c.p.x) && isFinite(c.p.y)) out.p = { x: c.p.x, y: c.p.y };
  for (const key of ['t0', 't1']) if (typeof c[key] === 'number' && isFinite(c[key])) out[key] = c[key];
  return out;
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
        mode: ['func', 'implicit', 'ineq', 'param', 'polar'].includes(o.mode) ? o.mode : 'func', text: str(o.text, 400),
        ...(typeof o.derivOf === 'string' && ID_RE.test(o.derivOf) ? { derivOf: o.derivOf, numeric: !!o.numeric } : {}),
        alpha: clamp(num(o.alpha, 1), 0.05, 1),
        xMin: typeof o.xMin === 'number' && isFinite(o.xMin) ? o.xMin : null,
        xMax: typeof o.xMax === 'number' && isFinite(o.xMax) ? o.xMax : null,
        showLabel: !!o.showLabel, endDots: !!o.endDots,
      };
    case 'slider': {
      if (typeof o.name !== 'string' || !PARAM_RE.test(o.name)) return null;
      const min = num(o.min, -10);
      let max = num(o.max, 10);
      if (!(max > min)) max = min + 1;
      return { id, type: 'slider', name: o.name, value: num(o.value, 1), min, max, step: clamp(num(o.step, 0.1), 1e-9, 1e9) };
    }
    case 'link': {
      if (!['equal', 'parallel', 'perp', 'equalAngle'].includes(o.kind) || !Array.isArray(o.refs)) return null;
      const refs = o.refs.slice(0, 20).map((r) => (r && ['side', 'line', 'vangle', 'angle'].includes(r.t) && typeof r.o === 'string' && ID_RE.test(r.o)
        ? { t: r.t, o: r.o, ...(Number.isInteger(r.i) && r.i >= 0 && r.i < 200 ? { i: r.i } : {}) } : null)).filter(Boolean);
      if (refs.length < 2) return null;
      return { id, type: 'link', kind: o.kind, refs, off: !!o.off };
    }
    case 'arc':
      return { id, type: 'arc', mode: ['arc', 'sector', 'segment'].includes(o.mode) ? o.mode : 'arc', cx: num(o.cx), cy: num(o.cy), rx: Math.max(num(o.rx, 1), 1e-9), ry: Math.max(num(o.ry, 1), 1e-9), rot: num(o.rot), t0: num(o.t0), sweep: clamp(num(o.sweep, Math.PI / 2), -G.TAU, G.TAU), style: cleanStyle(o.style, true), name: str(o.name, 40) };
    case 'integral':
      if (typeof o.f !== 'string' || !ID_RE.test(o.f)) return null;
      return { id, type: 'integral', f: o.f, g: typeof o.g === 'string' && ID_RE.test(o.g) ? o.g : null, a: str(o.a, 60) || '0', b: str(o.b, 60) || '1', style: cleanStyle(o.style, true) };
    case 'locus':
      if (typeof o.pt !== 'string' || typeof o.drv !== 'string' || !ID_RE.test(o.pt) || !ID_RE.test(o.drv)) return null;
      return { id, type: 'locus', pt: o.pt, drv: o.drv, style: cleanStyle(o.style) };
    case 'region':
      if (typeof o.a !== 'string' || typeof o.b !== 'string' || !ID_RE.test(o.a) || !ID_RE.test(o.b)) return null;
      return { id, type: 'region', a: o.a, b: o.b, op: ['intersect', 'union', 'aminusb', 'bminusa', 'xor'].includes(o.op) ? o.op : 'intersect', style: cleanStyle(o.style, true), hatch: !!o.hatch };
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
  renderSliders();
  clearTimeout(saveTimer);
  // never autosave a puzzle over the user's own graph
  saveTimer = setTimeout(() => { if (S.autosave && !puzzle) store.set('vf.current', docData()); }, 300);
}

/* ======================= canvas & view ======================= */

const canvas = $('#canvas');
let ctx = canvas.getContext('2d'); // swapped for an offscreen canvas while printing
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

// "y = 3/4x + 1" style equation of the line through a line object's two points.
function lineEquation(o) {
  const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
  if (Math.abs(dx) < 1e-12 * Math.max(1, Math.abs(dy))) return `x = ${fmtNum(o.x1)}`;
  const m = dy / dx, b = o.y1 - m * o.x1;
  const wrap = (s) => (/[/+−√ ]/.test(s) ? `(${s})` : s);
  let ms = Math.abs(m) < 1e-12 ? '' : Math.abs(m - 1) < 1e-12 ? 'x' : Math.abs(m + 1) < 1e-12 ? '−x' : wrap(fmtNum(m)) + 'x';
  if (m < 0 && ms.startsWith('(−')) ms = '−(' + ms.slice(2);
  if (Math.abs(b) < 1e-12) return `y = ${ms || '0'}`;
  const bs = fmtNum(Math.abs(b));
  return ms ? `y = ${ms} ${b < 0 ? '−' : '+'} ${bs}` : `y = ${b < 0 ? '−' : ''}${bs}`;
}

/* ======================= theme colors ======================= */

function theme() {
  const t = themeBase();
  if (printMode) return { ...t, bg: '#ffffff', labelBg: 'rgba(255,255,255,0.95)', sel: S.selColor, hover: 'rgba(0,0,0,0)' };
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
  const s = v.toFixed(S.decimals).replace(/^-(0(\.0*)?)$/, '$1'); // no "-0.00"
  return S.trimZeros && s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
// A number as a decimal, or in simplest radical form (√, π, fractions) when that's exact.
let puzzle = null; // the daily puzzle while it's being played
function fmtNum(v, opts) {
  if (puzzle) return '?';
  const dec = fx(v);
  if (S.numberForm === 'decimal' || (opts && opts.approx)) return (opts && opts.approx && S.numberForm !== 'decimal' ? '≈ ' : '') + dec;
  const e = exactForm(v, opts);
  if (!e) return dec;
  if (S.numberForm === 'both' && !/^−?\d+$/.test(e)) return `${e} ≈ ${dec}`;
  return e;
}
function fmtLen(v, opts) { return fmtNum(v, opts) + (S.units ? ' ' + S.units : ''); }
function fmtArea(v, opts) { return fmtNum(v, opts) + (S.units ? ' ' + S.units + '²' : ' u²'); }
function fmtAng(deg) {
  if (S.angleUnit === 'rad') { const s = fmtNum(deg * G.DEG); return s.includes('π') ? s : s + ' rad'; }
  return fmtNum(deg, { noPi: true }) + '°';
}
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

/* ---------- tick marks, parallel arrows, angle arcs ---------- */

// Screen geometry of a link reference.
function refGeom(ref) {
  if (LK.isSegRef(ref)) {
    const e = LK.segEnds(ref, byId);
    return e ? { seg: e.map(W2S) } : null;
  }
  const o = byId(ref.o);
  if (!o) return null;
  if (ref.t === 'angle') { const g = angleGeom(o); return { ang: { p: g.V, a: g.A, b: g.B, deg: g.deg, mid: g.mid } }; }
  const W = G.polyWorld(o), n = W.length, P = W.map(W2S);
  const deg = G.interiorAngles(W)[ref.i];
  const p = P[ref.i], pa = P[(ref.i - 1 + n) % n], pb = P[(ref.i + 1) % n];
  return { ang: { p, a: pa, b: pb, deg, mid: interiorMid(p, pa, pb, deg, W2S(G.centroid(W))) } };
}
function drawSegMark([a, b], kind, count, color) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 14) return;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, n = { x: -u.y, y: u.x };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.setLineDash([]);
  ctx.beginPath();
  if (kind === 'tick') {
    for (let j = 0; j < count; j++) {
      const off = (j - (count - 1) / 2) * 5;
      const c = { x: m.x + u.x * off, y: m.y + u.y * off };
      ctx.moveTo(c.x - n.x * 6, c.y - n.y * 6); ctx.lineTo(c.x + n.x * 6, c.y + n.y * 6);
    }
  } else if (kind === 'arrow') {
    for (let j = 0; j < count; j++) {
      const off = (j - (count - 1) / 2) * 7 + 3;
      const t = { x: m.x + u.x * off, y: m.y + u.y * off };
      ctx.moveTo(t.x - u.x * 7 + n.x * 5, t.y - u.y * 7 + n.y * 5); ctx.lineTo(t.x, t.y); ctx.lineTo(t.x - u.x * 7 - n.x * 5, t.y - u.y * 7 - n.y * 5);
    }
  } else { // perpendicular: a small ⊥ symbol beside the middle
    const c = { x: m.x + n.x * 12, y: m.y + n.y * 12 };
    ctx.moveTo(c.x - u.x * 6, c.y - u.y * 6); ctx.lineTo(c.x + u.x * 6, c.y + u.y * 6);
    ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + n.x * 9, c.y + n.y * 9);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}
function drawAngMark(g, count, color) {
  const la = Math.hypot(g.a.x - g.p.x, g.a.y - g.p.y), lb = Math.hypot(g.b.x - g.p.x, g.b.y - g.p.y);
  const r0 = clamp(Math.min(la, lb) * 0.22, 9, 16);
  ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.setLineDash([]);
  const sweep = g.deg * G.DEG;
  for (let j = 0; j < count; j++) {
    ctx.beginPath(); ctx.arc(g.p.x, g.p.y, r0 + j * 4, g.mid - sweep / 2, g.mid + sweep / 2); ctx.stroke();
  }
}
function drawLinkMarks(T) {
  const counters = { equal: 0, parallel: 0, perp: 0, equalAngle: 0 };
  for (const L of doc.objects) {
    if (L.type !== 'link') continue;
    const count = (counters[L.kind] % 3) + 1;
    counters[L.kind]++;
    if (L.hidden) continue;
    const color = L.off ? hexA(S.linkColor, 0.4) : S.linkColor;
    for (const r of L.refs) {
      const g = refGeom(r);
      if (!g) continue;
      if (g.seg) drawSegMark(g.seg, L.kind === 'equal' ? 'tick' : L.kind === 'parallel' ? 'arrow' : 'perp', count, color);
      else drawAngMark(g.ang, count, color);
    }
  }
}
// Equal sides, parallel sides and equal angles a shape already has, marked in its own color.
function drawAutoMarks(T) {
  if (S.autoMarks === 'off') return;
  const linked = new Set();
  for (const L of doc.objects) if (L.type === 'link') for (const r of L.refs) linked.add(`${r.t}:${r.o}:${r.i ?? ''}`);
  for (const o of doc.objects) {
    if (o.type !== 'shape' || o.kind !== 'polygon' || o.hidden) continue;
    if (S.autoMarks === 'selected' && !sel.includes(o.id)) continue;
    const W = G.polyWorld(o), n = W.length, P = W.map(W2S);
    const color = hexA(o.style.stroke, 0.95);
    const lens = G.sideLengths(o), tol = 1e-7 * Math.max(...lens);
    const groups = (vals, eq) => { const g = []; vals.forEach((v, i) => { const k = g.findIndex((grp) => eq(vals[grp[0]], v)); if (k >= 0) g[k].push(i); else g.push([i]); }); return g.filter((grp) => grp.length > 1); };
    groups(lens, (x, y) => Math.abs(x - y) <= tol).forEach((grp, gi) => {
      for (const i of grp) if (!linked.has(`side:${o.id}:${i}`)) drawSegMark([P[i], P[(i + 1) % n]], 'tick', (gi % 3) + 1, color);
    });
    // parallel sides (not neighbours)
    const dirs = W.map((p, i) => Math.atan2(W[(i + 1) % n].y - p.y, W[(i + 1) % n].x - p.x));
    const par = [];
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (Math.abs(Math.sin(dirs[i] - dirs[j])) < 1e-9) { const k = par.findIndex((grp) => grp.includes(i) || grp.includes(j)); if (k >= 0) { if (!par[k].includes(i)) par[k].push(i); if (!par[k].includes(j)) par[k].push(j); } else par.push([i, j]); }
    }
    if (n > 3) par.forEach((grp, gi) => { for (const i of grp) if (!linked.has(`side:${o.id}:${i}`)) drawSegMark([P[i], P[(i + 1) % n]], 'arrow', (gi % 3) + 1, color); });
    const angs = G.interiorAngles(W);
    groups(angs, (x, y) => Math.abs(x - y) <= 1e-7).forEach((grp, gi) => {
      if (Math.abs(angs[grp[0]] - 90) < 1e-7) return; // right angles already get their square
      for (const i of grp) if (!linked.has(`vangle:${o.id}:${i}`)) { const g = refGeom({ t: 'vangle', o: o.id, i }); if (g) drawAngMark(g.ang, (gi % 3) + 1, color); }
    });
  }
}
// Length / equation labels on lines that ask for them, plus arc and region measurements.
let printHideMeasures = false;
function drawExtraLabels(T) {
  if (printHideMeasures) return;
  for (const o of doc.objects) {
    if (o.hidden || o.collapsed) continue;
    if (o.type === 'line' && (o.showLen || o.showEq || S.lineEquations === 'always' || (S.lineEquations === 'selected' && sel.includes(o.id)))) {
      const a = W2S({ x: o.x1, y: o.y1 }), b = W2S({ x: o.x2, y: o.y2 });
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let dy = 16;
      if (o.showLen && !sel.includes(o.id)) { label(fmtLen(Math.hypot(o.x2 - o.x1, o.y2 - o.y1)), m.x, m.y - dy, T, o.style.stroke); dy += S.labelSize + 10; }
      if (o.showEq || S.lineEquations === 'always' || (S.lineEquations === 'selected' && sel.includes(o.id))) label(lineEquation(o), m.x, m.y + (sel.includes(o.id) ? -dy - S.labelSize - 10 : 18), T, o.style.stroke);
    } else if (o.type === 'arc' && (sel.includes(o.id) || toolsOn.area)) {
      const mt = arcMetrics(o);
      const pm = W2S(C.ellipsePoint(arcE(o), o.t0 + o.sweep / 2));
      const c = W2S({ x: o.cx, y: o.cy });
      const d = Math.hypot(pm.x - c.x, pm.y - c.y) || 1;
      const out = { x: pm.x + ((pm.x - c.x) / d) * 22, y: pm.y + ((pm.y - c.y) / d) * 22 };
      label(`arc ${fmtLen(mt.len, { approx: mt.approx })} · ${fmtAng(mt.deg)}`, out.x, out.y, T, o.style.stroke);
      if (mt.area != null) { const ac = W2S(G.centroid(o.mode === 'sector' ? [{ x: o.cx, y: o.cy }, ...C.arcPoints(arcE(o), o.t0, o.sweep, 60)] : C.arcPoints(arcE(o), o.t0, o.sweep, 60))); label(`A = ${fmtArea(mt.area, { approx: mt.approx })}`, ac.x, ac.y, T, toolsOn.area ? S.areaColor : o.style.stroke); }
    } else if (o.type === 'region' && (sel.includes(o.id) || toolsOn.area || S.regionLabels)) {
      const mt = regionMetrics(o);
      if (mt) { const p = W2S(mt.at); label(`A = ${fmtArea(mt.area, { approx: mt.approx })}`, p.x, p.y, T, toolsOn.area ? S.areaColor : o.style.fill); }
    }
  }
}

// Path of an arc / sector / segment in screen space.
function pathArc(o) {
  const pts = C.arcPoints(arcE(o), o.t0, o.sweep, 240).map(W2S);
  ctx.beginPath();
  if (o.mode === 'sector') { const c = W2S({ x: o.cx, y: o.cy }); ctx.moveTo(c.x, c.y); pts.forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath(); }
  else { pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (o.mode === 'segment') ctx.closePath(); }
}
// Add a shape's outline to the current path (no beginPath), for clipping.
function tracePath(o) {
  const pts = G.outline(o, 360).map(W2S);
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}
let hatchCache = null;
function regionFill(o) {
  if (!o.hatch) return hexA(o.style.fill, o.style.fillAlpha);
  const key = o.style.fill + o.style.fillAlpha;
  if (hatchCache?.key !== key) {
    const c = document.createElement('canvas');
    c.width = c.height = 10;
    const g = c.getContext('2d');
    g.fillStyle = hexA(o.style.fill, o.style.fillAlpha * 0.5); g.fillRect(0, 0, 10, 10);
    g.strokeStyle = hexA(o.style.fill, Math.min(1, o.style.fillAlpha * 2.5 + 0.2)); g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-2, 12); g.lineTo(12, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(8, 12); g.lineTo(12, 8); g.stroke();
    hatchCache = { key, pat: ctx.createPattern(c, 'repeat') };
  }
  return hatchCache.pat;
}
// Shade the overlap / union / difference of two shapes using canvas clipping (works for any shapes).
function drawRegion(o, T, hovered) {
  const A = byId(o.a), B = byId(o.b);
  if (!A || !B) return;
  const fill = regionFill(o);
  const fillShape = (s) => { ctx.beginPath(); tracePath(s); ctx.fillStyle = fill; ctx.fill(); };
  const clipTo = (s) => { ctx.beginPath(); tracePath(s); ctx.clip(); };
  const clipOut = (s) => { ctx.beginPath(); ctx.rect(-10, -10, cw + 20, ch + 20); tracePath(s); ctx.clip('evenodd'); };
  ctx.save();
  if (o.op === 'intersect') { clipTo(A); fillShape(B); }
  else if (o.op === 'union') { fillShape(A); clipOut(A); fillShape(B); }
  else if (o.op === 'aminusb') { clipOut(B); fillShape(A); }
  else if (o.op === 'bminusa') { clipOut(A); fillShape(B); }
  else { ctx.save(); clipOut(B); fillShape(A); ctx.restore(); clipOut(A); fillShape(B); }
  ctx.restore();
  if (hovered || sel.includes(o.id)) {
    for (const s of [A, B]) { ctx.beginPath(); tracePath(s); ctx.setLineDash([5, 4]); ctx.strokeStyle = hovered ? T.hover : T.sel; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
  }
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
  syncAll();
  const T = theme();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, cw, ch);
  drawGrid(T);
  textBoxes.clear();
  if (!printMode) { recordTraces(); drawTraces(T); }
  for (const o of doc.objects) drawObject(o, T);
  drawOverlayLabels(T);
  drawAutoMarks(T);
  drawLinkMarks(T);
  drawExtraLabels(T);
  drawLinkPicks(T);
  drawSnapPoints();
  drawSelection(T);
  drawFlash(T);
  drawDraft(T);
  drawHoverPt(T);
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
  if (S.showAxisNumbers && S.showAxes) {
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
  if (o.hidden || o.collapsed) return;
  const hovered = ((o.id === hoverId && S.hoverHighlight) || o.id === listHover) && !sel.includes(o.id);
  if (o.type === 'arc') {
    pathArc(o);
    if (o.mode !== 'arc' && o.style.fillAlpha > 0) { ctx.fillStyle = hexA(o.style.fill, o.style.fillAlpha); ctx.fill(); }
    if (hovered) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.stroke(); }
    strokeWith(o.style);
    return;
  }
  if (o.type === 'region') { drawRegion(o, T, hovered); return; }
  if (o.type === 'locus') {
    const path = locusPath(o);
    if (!path) return;
    ctx.beginPath();
    let prev = null;
    for (const w of path) {
      if (!w) { prev = null; continue; }
      const p = W2S(w);
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < Math.max(cw, ch) * 0.3) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      prev = p;
    }
    if (hovered || sel.includes(o.id)) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.stroke(); }
    strokeWith(o.style);
    return;
  }
  if (o.type === 'integral') {
    const poly = integralOutline(o);
    if (!poly) return;
    ctx.beginPath(); poly.map(W2S).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.fillStyle = hexA(o.style.fill, o.style.fillAlpha); ctx.fill();
    if (hovered || sel.includes(o.id)) { ctx.strokeStyle = T.hover; ctx.lineWidth = 4; ctx.stroke(); }
    const lim = integralLimits(o);
    const F = byId(o.f), Gf = o.g ? byId(o.g) : null;
    for (const x of lim ? [lim.a, lim.b] : []) {
      let y1 = 0, y2 = 0; try { y1 = fnOf(F)(x); y2 = Gf ? fnOf(Gf)(x) : 0; } catch { /* skip */ }
      if (!isFinite(y1) || !isFinite(y2)) continue;
      const p = W2S({ x, y: y1 }), q = W2S({ x, y: y2 });
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); strokeWith({ ...o.style, dash: 'dashed' });
    }
    const m = integralValue(o);
    if (!m.error && !printHideMeasures) { const c = W2S(G.centroid(poly)); label(`∫ = ${fmtNum(m.value)}`, c.x, c.y, T, o.style.stroke); }
    return;
  }
  if (o.type === 'angle') {
    const g = angleGeom(o);
    if (S.angleArms || !o.att) {
      // arms only when asked for (or when the angle isn't sitting on any lines)
      ctx.beginPath(); ctx.moveTo(g.A.x, g.A.y); ctx.lineTo(g.V.x, g.V.y); ctx.lineTo(g.B.x, g.B.y);
      if (hovered) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.stroke(); }
      if (S.angleArms) strokeWith(o.style); else strokeWith({ ...o.style, width: 1, dash: 'dotted' });
    } else if (hovered || sel.includes(o.id)) {
      ctx.beginPath(); ctx.arc(g.V.x, g.V.y, g.r + 5, g.mid - g.sweep / 2 - 0.1, g.mid + g.sweep / 2 + 0.1);
      ctx.strokeStyle = T.hover; ctx.lineWidth = 8; ctx.stroke();
    }
    ctx.beginPath();
    if (g.right) { ctx.moveTo(g.sq[0].x, g.sq[0].y); ctx.lineTo(g.sq[1].x, g.sq[1].y); ctx.lineTo(g.sq[2].x, g.sq[2].y); }
    else ctx.arc(g.V.x, g.V.y, g.r, g.mid - g.sweep / 2, g.mid + g.sweep / 2);
    ctx.strokeStyle = o.style.stroke; ctx.lineWidth = 1.6; ctx.setLineDash([]); ctx.stroke();
    if (!g.right) { ctx.lineTo(g.V.x, g.V.y); ctx.closePath(); ctx.fillStyle = hexA(o.style.stroke, 0.12); ctx.fill(); }
    if (!printHideMeasures) label(fmtAng(g.deg), g.L.x, g.L.y, T, o.style.stroke);
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
  } else if (o.type === 'func' && o.mode && o.mode !== 'func') {
    const g = graphGeom(o);
    if (!g) return;
    const hl = hovered || sel.includes(o.id);
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    if (g.runs) {
      ctx.fillStyle = hexA(o.style.stroke, 0.22);
      for (const r of g.runs) { const a = W2S({ x: r.x0, y: r.y1 }), b = W2S({ x: r.x1, y: r.y0 }); ctx.fillRect(a.x, a.y, b.x - a.x + 0.6, b.y - a.y + 0.6); }
    }
    ctx.beginPath();
    for (const s of g.segs || []) { const p = W2S(s[0]), q = W2S(s[1]); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    for (const run of g.curves || []) run.forEach((w, i) => { const p = W2S(w); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    if (hl) { ctx.strokeStyle = T.hover; ctx.lineWidth = o.style.width + 6; ctx.setLineDash([]); ctx.stroke(); }
    strokeWith(g.strict ? { ...o.style, dash: 'dashed' } : o.style);
    ctx.restore();
    if (o.showLabel) {
      const first = g.curves?.[0]?.[Math.floor((g.curves[0].length - 1) * 0.8)] || g.segs?.[Math.floor(g.segs.length * 0.8)]?.[0];
      if (first) { const p = W2S(first); label(o.text, p.x, p.y - 16, T, o.style.stroke); }
    }
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
    if (o.showLabel && lp) label(o.derivOf ? `y = ${fmtDerivName(o)}` : 'y = ' + o.expr, lp.x, lp.y, T, o.style.stroke, 'right');
  }
}
function fmtDerivName(o) { return o.numeric ? 'f′(x)' : o.expr; }

// Visible pieces of a function graph, in screen space, split at gaps and jumps.
// y = f(x) for a function object (numeric derivatives evaluate their source).
function fnOf(o) {
  if (o.mode && o.mode !== 'func') return null;
  if (o.derivOf && o.numeric) {
    const src = byId(o.derivOf);
    const f = src && fnOf(src);
    if (!f) return null;
    return (x) => { const h = 1e-5 * Math.max(1, Math.abs(x)); return (f(x + h) - f(x - h)) / (2 * h); };
  }
  return getFunc(o.expr);
}
const graphDescCache = new Map();
function graphDesc(o) {
  if (!o.mode || o.mode === 'func') return { mode: 'func', expr: o.expr };
  if (!graphDescCache.has(o.text)) { try { graphDescCache.set(o.text, GR.classifyGraph(o.text)); } catch { graphDescCache.set(o.text, null); } }
  return graphDescCache.get(o.text);
}
// Implicit curves, inequalities, parametric and polar curves, computed for the current view and cached.
const graphCache = new Map();
function graphGeom(o) {
  const d = graphDesc(o);
  if (!d) return null;
  const key = `${o.id}|${o.text}|${view.cx},${view.cy},${view.scale}|${cw}x${ch}|${JSON.stringify(params)}`;
  if (graphCache.has(key)) return graphCache.get(key);
  let res = null;
  try {
    const c = GR.compileGraph(d, params);
    const tl = S2W({ x: 0, y: 0 }), br = S2W({ x: cw, y: ch });
    const grid = (px) => ({ x0: tl.x, x1: br.x, y0: br.y, y1: tl.y, nx: Math.max(10, Math.round(cw / px)), ny: Math.max(10, Math.round(ch / px)) });
    if (d.mode === 'implicit') res = { segs: GR.contour(c.F, grid(5)) };
    else if (d.mode === 'ineq') res = { runs: GR.inequalityRuns(c.F, d.op, grid(3)), segs: GR.contour(c.F, grid(5)), strict: d.op === '<' || d.op === '>' };
    else {
      const span = Math.max(br.x - tl.x, tl.y - br.y);
      const fn = d.mode === 'param' ? (t) => ({ x: c.X(t), y: c.Y(t) }) : (t) => { const r = c.R(t); return { x: r * Math.cos(t), y: r * Math.sin(t) }; };
      res = { curves: GR.sampleCurve(fn, c.t0, c.t1, 2400, span * 0.6) };
    }
  } catch { res = null; }
  if (graphCache.size > 60) graphCache.clear();
  graphCache.set(key, res);
  return res;
}
const funcText = (o) => (!o.mode || o.mode === 'func' ? (o.derivOf ? `y = ${o.numeric ? `d/dx (${byId(o.derivOf)?.expr ?? '?'})` : o.expr}` : 'y = ' + o.expr) : o.text);

function funcPolylines(o) {
  const f = fnOf(o);
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

// Arc length / area of an arc object (exact formulas for circles).
function arcMetrics(o) {
  const th = Math.abs(o.sweep);
  const circle = Math.abs(o.rx - o.ry) <= 1e-9 * Math.max(o.rx, o.ry);
  let len, sector, segment;
  if (circle) {
    const r = o.rx;
    len = r * th; sector = (r * r * th) / 2; segment = (r * r * (th - Math.sin(th))) / 2;
  } else {
    const pts = C.arcPoints(arcE(o), o.t0, o.sweep, 4000);
    len = 0; for (let i = 1; i < pts.length; i++) len += G.dist(pts[i - 1], pts[i]);
    sector = Math.abs(G.signedArea([{ x: o.cx, y: o.cy }, ...pts]));
    segment = Math.abs(G.signedArea(pts));
  }
  const a = C.ellipsePoint(arcE(o), o.t0), b = C.ellipsePoint(arcE(o), o.t0 + o.sweep);
  return { len, area: o.mode === 'sector' ? sector : o.mode === 'segment' ? segment : null, chord: G.dist(a, b), deg: th / G.DEG, approx: !circle };
}
// Area (and a label position) for an overlap region. Exact for polygons and for two circles.
function regionMetrics(o) {
  const A = byId(o.a), B = byId(o.b);
  if (!A || !B) return null;
  const circ = (s) => s.kind === 'ellipse' && G.isCircle(s);
  const polyOf = (s) => (s.kind === 'polygon' ? G.polyWorld(s) : G.outline(s, 2048));
  const PA = polyOf(A), PB = polyOf(B);
  const aA = G.area(A), aB = G.area(B);
  // is every point of `pts` inside shape s? (exact for circles, used to spot fully-contained shapes)
  const inside = (s, pts) => {
    if (circ(s)) return pts.every((p) => Math.hypot(p.x - s.cx, p.y - s.cy) <= (s.w / 2) * (1 + 1e-12));
    const outline = s === A ? PA : PB;
    return pts.every((p) => G.pointInPoly(p, outline));
  };
  const res = Bool.polygonIntersection(PA, PB);
  let I = res.area, approx = false;
  if (circ(A) && circ(B)) I = Bool.lensArea({ x: A.cx, y: A.cy }, A.w / 2, { x: B.cx, y: B.cy }, B.w / 2);
  else if (A.kind === 'ellipse' && B.kind === 'polygon') I = Bool.ellipsePolygonArea(C.ellipseOf(A), PB);
  else if (B.kind === 'ellipse' && A.kind === 'polygon') I = Bool.ellipsePolygonArea(C.ellipseOf(B), PA);
  else if (A.kind !== 'polygon' || B.kind !== 'polygon') {
    if (B.kind === 'polygon' && inside(A, PB)) I = aB;
    else if (A.kind === 'polygon' && inside(B, PA)) I = aA;
    else if (res.area === 0) I = 0;
    else approx = true;
  }
  const cA = G.centroid(PA), cB = G.centroid(PB), cI = res.centroid || cA;
  const comb = (terms) => { const tot = terms.reduce((s, [w]) => s + w, 0); return tot > 1e-12 ? { x: terms.reduce((s, [w, c]) => s + w * c.x, 0) / tot, y: terms.reduce((s, [w, c]) => s + w * c.y, 0) / tot } : cA; };
  let area, at;
  switch (o.op) {
    case 'union': area = aA + aB - I; at = comb([[aA, cA], [aB, cB], [-I, cI]]); break;
    case 'aminusb': area = aA - I; at = comb([[aA, cA], [-I, cI]]); break;
    case 'bminusa': area = aB - I; at = comb([[aB, cB], [-I, cI]]); break;
    case 'xor': area = aA + aB - 2 * I; at = comb([[aA, cA], [aB, cB], [-2 * I, cI]]); break;
    default: area = I; at = cI;
  }
  return { area: Math.max(0, area), at, approx };
}
function inRegion(o, p) {
  const A = byId(o.a), B = byId(o.b);
  if (!A || !B) return false;
  const a = G.pointInPoly(p, G.outline(A, 180)), b = G.pointInPoly(p, G.outline(B, 180));
  return { intersect: a && b, union: a || b, aminusb: a && !b, bminusa: b && !a, xor: a !== b }[o.op];
}

// Screen points for the closed dots at the ends of a restricted domain.
function funcEndDots(o) {
  if (!o.endDots) return [];
  const f = fnOf(o);
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
  const key = expr + '|' + Object.keys(params).sort().join('');
  if (!funcCache.has(key)) {
    try { funcCache.set(key, compile(expr, params)); } catch { funcCache.set(key, null); }
    if (funcCache.size > 500) funcCache.clear();
  }
  return funcCache.get(key);
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
        const f = (v) => fmtNum(v * v);
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
  if (o.type === 'arc') {
    const E = arcE(o);
    return [
      { type: 'arcEnd', k: 0, p: W2S(C.ellipsePoint(E, o.t0)) },
      { type: 'arcEnd', k: 1, p: W2S(C.ellipsePoint(E, o.t0 + o.sweep)) },
      { type: 'arcRadius', p: W2S(C.ellipsePoint(E, o.t0 + o.sweep / 2)) },
    ];
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
// Handles grow on touch screens so fingers can grab them.
function hsize() { return lastPointerType === 'touch' ? Math.max(S.handleSize, S.touchHandleSize) : S.handleSize; }

function handleAt(sp) {
  const o = single();
  if (!o) return null;
  const tol = Math.max(8, hsize());
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
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, hsize() * 0.66, 0, G.TAU); ctx.fillStyle = T.handle; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    } else if (h.type === 'arcRadius') {
      ctx.save(); ctx.translate(h.p.x, h.p.y); ctx.rotate(Math.PI / 4);
      const hs = hsize() * 0.9;
      ctx.fillStyle = T.handle; ctx.fillRect(-hs / 2, -hs / 2, hs, hs); ctx.strokeStyle = T.sel; ctx.lineWidth = 2; ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
      ctx.restore();
    } else if (h.type === 'vertex' || h.type === 'lineEnd' || h.type === 'anglePt' || h.type === 'arcEnd') {
      ctx.beginPath(); ctx.arc(h.p.x, h.p.y, hsize() * 0.66, 0, G.TAU); ctx.fillStyle = T.handle; ctx.fill(); ctx.strokeStyle = T.sel; ctx.lineWidth = 2; ctx.stroke();
    } else {
      ctx.save(); ctx.translate(h.p.x, h.p.y); ctx.rotate(-o.rot);
      const hs = hsize();
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
  if (o.type === 'arc') { pathArc(o); return true; }
  if (o.type === 'region') { const A = byId(o.a), B = byId(o.b); if (!A || !B) return false; tracePath(A); tracePath(B); return true; }
  if (o.type === 'link') {
    for (const r of o.refs) { const g = refGeom(r); if (!g) continue; if (g.seg) { ctx.moveTo(g.seg[0].x, g.seg[0].y); ctx.lineTo(g.seg[1].x, g.seg[1].y); } else { ctx.moveTo(g.ang.p.x + 18, g.ang.p.y); ctx.arc(g.ang.p.x, g.ang.p.y, 18, 0, G.TAU); } }
    return true;
  }
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
  label(`Δx ${fmtNum(dx)}  Δy ${fmtNum(dy)}  ∠ ${fmtAng(ang)}`, (A.x + B.x) / 2, (A.y + B.y) / 2 - 8, T, '#fbbf24');
}

/* ======================= link tool ======================= */

// Which side, line or angle is under the cursor (for the Link tool)?
function pickRef(sp) {
  const wp = S2W(sp);
  for (let k = doc.objects.length - 1; k >= 0; k--) {
    const o = doc.objects[k];
    if (o.hidden || o.collapsed) continue;
    if (o.type === 'angle') {
      const g = angleGeom(o);
      if (Math.hypot(sp.x - g.V.x, sp.y - g.V.y) < 32 || Math.hypot(sp.x - g.L.x, sp.y - g.L.y) < 18) return { t: 'angle', o: o.id };
    } else if (o.type === 'line') {
      const [a, b] = lineScreenEnds(o);
      if (G.distToSeg(sp, a, b) < 8) return { t: 'line', o: o.id };
    } else if (o.type === 'shape' && o.kind === 'polygon') {
      const W = G.polyWorld(o), P = W.map(W2S), n = P.length;
      let dv = Infinity, vi = 0, de = Infinity, ei = 0;
      P.forEach((p, i) => {
        const d1 = Math.hypot(sp.x - p.x, sp.y - p.y); if (d1 < dv) { dv = d1; vi = i; }
        const d2 = G.distToSeg(sp, p, P[(i + 1) % n]); if (d2 < de) { de = d2; ei = i; }
      });
      const inside = G.pointInPoly(wp, W);
      // the clickable corner zone grows with the shape (a third of the shorter neighbouring side)
      const adj = Math.min(Math.hypot(P[vi].x - P[(vi + 1) % n].x, P[vi].y - P[(vi + 1) % n].y), Math.hypot(P[vi].x - P[(vi - 1 + n) % n].x, P[vi].y - P[(vi - 1 + n) % n].y));
      const zone = clamp(adj * 0.34, 26, 70);
      // inside a corner and clearly off its sides -> the angle; on/near a side -> the side
      if (inside && dv < zone && de > 3 && de / Math.max(dv, 1) > 0.18) return { t: 'vangle', o: o.id, i: vi };
      if (de < 8) return { t: 'side', o: o.id, i: ei };
      if (inside && dv < zone) return { t: 'vangle', o: o.id, i: vi };
    }
  }
  return null;
}
const sameRef = (a, b) => a && b && a.t === b.t && a.o === b.o && (a.i ?? -1) === (b.i ?? -1);
function refName(r) {
  const o = byId(r.o);
  if (!o) return '?';
  if (r.t === 'side') { const n = o.pts.length; return `${shapeName(o)} side ${LETTERS(r.i)}${LETTERS((r.i + 1) % n)}`; }
  if (r.t === 'vangle') return `${shapeName(o)} ∠${LETTERS(r.i)}`;
  if (r.t === 'line') return o.name || 'Line';
  return 'Angle mark';
}
function glowRef(r, color, width) {
  const g = refGeom(r);
  if (!g) return;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.setLineDash([]);
  ctx.beginPath();
  if (g.seg) { ctx.moveTo(g.seg[0].x, g.seg[0].y); ctx.lineTo(g.seg[1].x, g.seg[1].y); }
  else { const s = g.ang.deg * G.DEG; ctx.moveTo(g.ang.p.x, g.ang.p.y); ctx.arc(g.ang.p.x, g.ang.p.y, 22, g.ang.mid - s / 2, g.ang.mid + s / 2); ctx.closePath(); }
  ctx.stroke(); ctx.lineCap = 'butt';
  return g;
}
function drawLinkPicks(T) {
  if (tool !== 'link') return;
  if (linkHover && !linkPicks.some((r) => sameRef(r, linkHover))) glowRef(linkHover, hexA(S.linkColor, 0.35), 8);
  linkPicks.forEach((r, i) => {
    const g = glowRef(r, hexA(S.linkColor, 0.75), 6);
    if (!g) return;
    const at = g.seg ? { x: (g.seg[0].x + g.seg[1].x) / 2, y: (g.seg[0].y + g.seg[1].y) / 2 } : { x: g.ang.p.x + Math.cos(g.ang.mid) * 34, y: g.ang.p.y + Math.sin(g.ang.mid) * 34 };
    ctx.beginPath(); ctx.arc(at.x, at.y, 9, 0, G.TAU); ctx.fillStyle = S.linkColor; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), at.x, at.y + 0.5);
  });
}
function linkToolClick(sp, e) {
  const r = pickRef(sp);
  if (!r) { toast('Click a side, a line or an angle (click inside a corner)', true); return; }
  const k = linkPicks.findIndex((x) => sameRef(x, r));
  if (k >= 0) { linkPicks.splice(k, 1); requestRender(); return; }
  if (linkPicks.length && LK.isSegRef(linkPicks[0]) !== LK.isSegRef(r)) { toast('Link sides with sides and angles with angles', true); return; }
  linkPicks.push(r);
  requestRender();
  if (linkPicks.length >= 2) showLinkMenu(e.clientX, e.clientY);
  else setHint(LK.isSegRef(r) ? 'Now click another side or line to link it with' : 'Now click another angle to link it with');
}
function showLinkMenu(x, y) {
  const seg = LK.isSegRef(linkPicks[0]);
  const items = [{ header: `Link ${linkPicks.length} ${seg ? 'sides' : 'angles'}` }];
  if (seg) {
    items.push({ label: 'Equal lengths (| ticks)', action: () => createLink('equal') });
    items.push({ label: 'Parallel (> arrows)', action: () => createLink('parallel') });
    if (linkPicks.length === 2) items.push({ label: 'Perpendicular (⊥)', action: () => createLink('perp') });
  } else items.push({ label: 'Equal angles (arcs)', action: () => createLink('equalAngle') });
  items.push('-', { label: 'Pick another one too…', action: () => setHint('Click another one, then choose the link') }, { label: 'Cancel', action: () => { linkPicks = []; setHint(toolHint()); requestRender(); } });
  showMenu(items, x, y);
}
function createLink(kind) {
  const refs = linkPicks.slice();
  if (kind === 'parallel' || kind === 'perp') {
    // neighbouring sides of one polygon share a corner, so they can never be parallel
    for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
      const a = refs[i], b = refs[j];
      if (kind === 'parallel' && a.t === 'side' && b.t === 'side' && a.o === b.o) {
        const n = byId(a.o).pts.length;
        if ((a.i + 1) % n === b.i || (b.i + 1) % n === a.i) { toast('Sides that meet at a corner can’t be parallel', true); return; }
      }
    }
  }
  pushUndo();
  const L = { id: uid(), type: 'link', kind, refs, off: false };
  doc.objects.push(L);
  linkMem.delete(L.id);
  linkPicks = [];
  setHint(toolHint());
  changed();
  const names = refs.map(refName);
  toast(`Linked — ${names.join(' & ')} stay ${{ equal: 'equal in length', parallel: 'parallel', perp: 'perpendicular', equalAngle: 'equal' }[kind]}`);
}
/* ---------- calculus ---------- */

function calculusMenu(o) {
  const f = fnOf(o);
  const view0 = () => ({ a: S2W({ x: 0, y: 0 }).x, b: S2W({ x: cw, y: 0 }).x });
  return [
    { label: 'Derivative f′(x)', action: () => {
      const t = derivOrNumericText(o);
      pushUndo();
      const d = { id: uid(), type: 'func', expr: t || o.expr, derivOf: o.id, numeric: !t, _src: o.expr, style: { ...o.style, dash: 'dashed' }, hidden: false, alpha: 1, xMin: null, xMax: null, showLabel: true, endDots: false };
      doc.objects.push(d); setSelection([d.id]); changed();
      toast(t ? `Derivative: y = ${t}` : 'Derivative added (calculated numerically)');
    } },
    { label: 'Area under the curve…', action: () => integralDialog(o) },
    { label: 'Area between this and another graph…', action: () => startPick('func', 'Click the other graph', (g) => { if (g.id === o.id) toast('Pick a different graph', true); else integralDialog(o, g); }) },
    { label: 'Tangent line (drag its point)', action: () => {
      const x0 = view.cx;
      let y0; try { y0 = f(x0); } catch { y0 = NaN; }
      if (!isFinite(y0)) { toast('The function isn’t defined in the middle of the view — pan to where it is', true); return; }
      const pt = { ...mkPoint({ x: x0, y: y0 }, 'T', o.style.stroke), cons: { k: 'onObj', s: [o.id], t0: x0 } };
      pt.style.width = 4.5;
      const ln = cLine({ k: 'ftan', s: [o.id, pt.id] }, S.measureColor, 'line');
      ln.showEq = true;
      addConstruction([pt, ln], 'Drag the point T along the curve — the tangent follows');
    } },
    '-',
    { label: 'Roots (x-intercepts)', action: () => {
      const { a, b } = view0();
      const rs = GR.roots(f, a, b);
      if (!rs.length) { toast('No roots in view — pan or zoom out to find some', true); return; }
      addConstruction(rs.map((x, i) => cPoint({ k: 'froot', s: [o.id], p: { x, y: 0 } }, rs.length > 1 ? `x${'₁₂₃₄₅₆₇₈₉'[i] || i + 1}` : 'x₀', '#f87171')), `Roots: ${rs.map((x) => fmtNum(x)).join(', ')}`);
    } },
    { label: 'Turning points (max / min)', action: () => {
      const { a, b } = view0();
      const es = GR.extrema(f, a, b, 4000, exactDerivFn(o));
      if (!es.length) { toast('No turning points in view', true); return; }
      addConstruction(es.map((e) => cPoint({ k: 'fext', s: [o.id], p: { x: e.x, y: e.y }, c: e.kind === 'max' ? 'X' : 'N' }, e.kind === 'max' ? 'max' : 'min', '#fbbf24')), es.map((e) => `${e.kind} (${fmtNum(e.x)}, ${fmtNum(e.y)})`).join(' · '));
    } },
    { label: 'Y-intercept', action: () => { let y; try { y = f(0); } catch { y = NaN; } if (!isFinite(y)) { toast('It isn’t defined at x = 0', true); return; } addConstruction([{ ...cPoint({ k: 'onObj', s: [o.id], t0: 0 }, 'y₀', '#60a5fa') }], `y-intercept (0, ${fmtNum(y)})`); } },
    { label: 'Intersections with another object…', action: () => startPick('any', 'Click the other graph, line or shape', (g) => makeIntersections(o, g)) },
  ];
}
function makeIntersections(A, B) {
  if (!B || A.id === B.id) { toast('Pick a different object', true); return; }
  const pts = intersectionsOf(A, B);
  if (!pts.length) { toast('They don’t cross (in view)', true); return; }
  addConstruction(pts.map((q, i) => cPoint({ k: 'isect', s: [A.id, B.id], p: { x: q.x, y: q.y } }, pts.length > 1 ? `P${i + 1}` : 'P', '#f97316')), `${pts.length} intersection point${pts.length > 1 ? 's' : ''}: ${pts.slice(0, 4).map((q) => `(${fmtNum(q.x)}, ${fmtNum(q.y)})`).join(', ')}`);
}
function integralDialog(F, Gf = null) {
  let fa, fb;
  const f = fnOf(F), g = Gf ? fnOf(Gf) : () => 0;
  let a0 = 0, b0 = 1;
  const tl = S2W({ x: 0, y: 0 }).x, br = S2W({ x: cw, y: 0 }).x;
  const rs = GR.roots((x) => f(x) - g(x), tl, br);
  if (rs.length >= 2) { a0 = rs[0]; b0 = rs[rs.length - 1]; }
  openDialog({
    title: Gf ? 'Area between two graphs' : 'Area under the curve',
    build(body) {
      fa = el('input', { type: 'text', value: +a0.toFixed(6), autofocus: true });
      fb = el('input', { type: 'text', value: +b0.toFixed(6) });
      body.append(el('p', { class: 'muted', text: Gf ? `Shades between y = ${F.expr} and y = ${Gf.expr}, and works out the area (∫ of the difference).` : `Shades between y = ${F.expr} and the x-axis and works out ∫ f(x) dx (area below the axis counts as negative).` }),
        el('div', { class: 'grid2' }, el('label', { class: 'field' }, 'From x =', fa), el('label', { class: 'field' }, 'To x =', fb)),
        el('p', { class: 'muted tiny', text: 'Math and slider letters work here, e.g. pi, -2, or a.' }));
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Shade', primary: true, onClick(api) {
        for (const [inp, nm] of [[fa, 'start'], [fb, 'end']]) { try { compileVars(inp.value, [], params); } catch (e) { api.setError(`The ${nm}: ${e.message}`); return false; } }
        pushUndo();
        const o = { id: uid(), type: 'integral', f: F.id, g: Gf?.id || null, a: fa.value.trim(), b: fb.value.trim(), style: { stroke: F.style.stroke, width: 1.5, dash: 'solid', fill: F.style.stroke, fillAlpha: 0.28 } };
        const i = Math.max(doc.objects.indexOf(F), Gf ? doc.objects.indexOf(Gf) : -1);
        doc.objects.splice(i + 1, 0, o);
        setSelection([o.id]); changed();
        const m = integralValue(o);
        toast(m.error ? m.error : `∫ = ${fmtNum(m.value)}`);
        return true;
      },
    }],
  });
}
function integralLimits(o) {
  try { return { a: compileVars(o.a, [], params)(), b: compileVars(o.b, [], params)() }; } catch { return null; }
}
function integralValue(o) {
  const F = byId(o.f), Gf = o.g ? byId(o.g) : null;
  const f = F && fnOf(F), g = Gf ? fnOf(Gf) : () => 0;
  const lim = integralLimits(o);
  if (!f || !g || !lim) return { error: 'Can’t work out the limits' };
  try { return { value: GR.integrate((x) => f(x) - g(x), lim.a, lim.b), ...lim }; } catch (e) { return { error: e.message, ...lim }; }
}
function integralOutline(o) {
  const F = byId(o.f), Gf = o.g ? byId(o.g) : null;
  const f = F && fnOf(F), g = Gf ? fnOf(Gf) : () => 0;
  const lim = integralLimits(o);
  if (!f || !g || !lim) return null;
  const lo = Math.min(lim.a, lim.b), hi = Math.max(lim.a, lim.b), n = 240;
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    let y1, y2; try { y1 = f(x); y2 = g(x); } catch { continue; }
    if (!isFinite(y1) || !isFinite(y2)) continue;
    top.push({ x, y: y1 }); bot.push({ x, y: y2 });
  }
  return top.length > 1 ? [...top, ...bot.reverse()] : null;
}

const REGION_OPS = [['intersect', 'Overlap (A ∩ B)'], ['union', 'Combined (A ∪ B)'], ['aminusb', 'First minus second (A − B)'], ['bminusa', 'Second minus first (B − A)'], ['xor', 'Either but not both']];
function regionMenuFor(a, b) {
  showMenu([{ header: 'Shade…' }, ...REGION_OPS.map(([k, l]) => ({ label: l, action: () => createRegion(a, b, k) }))], lastPointer.x + canvas.getBoundingClientRect().left, lastPointer.y + canvas.getBoundingClientRect().top);
}
function createRegion(A, B, op) {
  pushUndo();
  const o = { id: uid(), type: 'region', a: A.id, b: B.id, op, style: { stroke: S.regionColor, width: 1, dash: 'solid', fill: S.regionColor, fillAlpha: 0.35 }, hatch: S.regionHatch };
  // draw it just above the higher of the two shapes
  const i = Math.max(doc.objects.indexOf(A), doc.objects.indexOf(B));
  doc.objects.splice(i + 1, 0, o);
  setSelection([o.id]);
  changed();
  const m = regionMetrics(o);
  toast(`${shapeName(o)} area: ${m ? fmtArea(m.area, { approx: m.approx }) : '?'}`);
}
function linksOf(id) { return doc.objects.filter((L) => L.type === 'link' && L.refs.some((r) => r.o === id)); }
function linksMenu(o) {
  const items = [{ label: 'Link sides or angles…', action: () => { setTool('link'); } }];
  const ls = linksOf(o.id);
  if (ls.length) items.push('-', ...ls.map((L) => ({ label: `Remove: ${LK.linkLabel(L)} (${L.refs.map(refName).join(', ').slice(0, 60)})`, action: () => { pushUndo(); doc.objects = doc.objects.filter((x) => x !== L); changed(); toast('Link removed'); } })));
  return items;
}

/* ======================= hit testing & snapping ======================= */

function hitTest(sp) {
  // points win over the lines and shapes they sit on, so they can always be grabbed
  if (!pick || pick.type === 'point') {
    for (let i = doc.objects.length - 1; i >= 0; i--) {
      const o = doc.objects[i];
      if (o.type !== 'point' || o.hidden || o.collapsed) continue;
      const p = W2S(o);
      if (Math.hypot(p.x - sp.x, p.y - sp.y) < o.style.width + 8) return o;
    }
  }
  return hitTestAll(sp);
}
function hitTestAll(sp) {
  const wp = S2W(sp);
  const tol = 7 / view.scale;
  for (let i = doc.objects.length - 1; i >= 0; i--) {
    const o = doc.objects[i];
    if (o.hidden || o.collapsed) continue;
    if (pick?.type === 'line' && o.type !== 'line') continue;
    if (pick?.type === 'shape' && o.type !== 'shape') continue;
    if (pick?.type === 'func' && o.type !== 'func') continue;
    if (o.type === 'arc') {
      const pts = C.arcPoints(arcE(o), o.t0, o.sweep, 120).map(W2S);
      for (let k = 1; k < pts.length; k++) if (G.distToSeg(sp, pts[k - 1], pts[k]) < 7) return o;
      if (o.mode !== 'arc' && o.style.fillAlpha > 0) {
        const poly = o.mode === 'sector' ? [W2S({ x: o.cx, y: o.cy }), ...pts] : pts;
        if (G.pointInPoly(sp, poly)) return o;
      }
      continue;
    }
    if (o.type === 'region') { if (inRegion(o, wp)) return o; continue; }
    if (o.type === 'locus') { const path = locusCache.get(o.id)?.path || []; for (let k = 1; k < path.length; k++) if (path[k - 1] && path[k] && G.distToSeg(sp, W2S(path[k - 1]), W2S(path[k])) < 7) return o; continue; }
    if (o.type === 'integral') { const poly = integralOutline(o); if (poly && G.pointInPoly(wp, poly)) return o; continue; }
    if (o.type === 'angle') {
      const g = angleGeom(o);
      const dv = Math.hypot(sp.x - g.V.x, sp.y - g.V.y);
      let inArc = false;
      if (dv <= g.r + 8 && dv > 3) { const a = Math.atan2(sp.y - g.V.y, sp.x - g.V.x); inArc = Math.abs(Math.atan2(Math.sin(a - g.mid), Math.cos(a - g.mid))) <= g.sweep / 2 + 0.15; }
      const arms = S.angleArms || !o.att;
      if (inArc || Math.hypot(sp.x - g.L.x, sp.y - g.L.y) < 18 || (arms && (G.distToSeg(sp, g.V, g.A) < 7 || G.distToSeg(sp, g.V, g.B) < 7))) return o;
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
    } else if (o.type === 'func' && !o.hidden && o.mode && o.mode !== 'func') {
      const g = graphGeom(o);
      if (!g) continue;
      const near = (p, q) => G.distToSeg(sp, W2S(p), W2S(q)) < 7;
      if ((g.segs || []).some(([p, q]) => near(p, q))) return o;
      for (const run of g.curves || []) for (let k = 1; k < run.length; k++) if (near(run[k - 1], run[k])) return o;
      if (g.runs && g.runs.some((r) => wp.x >= r.x0 && wp.x <= r.x1 && wp.y >= r.y0 && wp.y <= r.y1)) return o;
    } else if (o.type === 'func' && !o.hidden) {
      const f = fnOf(o);
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
    // every candidate carries `ref`: what it is, so things built on it can follow it later
    if (S.snapPoints) snapPointsOf(o).forEach((p, j) => out.push({ ...p, kind: 'snap', ref: { t: 'sn', id: o.id, j } }));
    if (o.type === 'shape') {
      if (o.kind === 'polygon') {
        const W = G.polyWorld(o);
        if (S.snapVertices) W.forEach((p, i) => out.push({ ...p, kind: 'vertex', ref: { t: 'vx', id: o.id, i } }));
        if (S.snapMidpoints) W.forEach((p, i) => { const q = W[(i + 1) % W.length]; out.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, kind: 'midpoint', ref: { t: 'mid', id: o.id, i } }); });
      }
      if (S.snapVertices && o.kind === 'semi') out.push({ ...G.toWorld(o, -0.5, -0.5), kind: 'vertex', ref: { t: 'semiEnd', id: o.id, i: 0 } }, { ...G.toWorld(o, 0.5, -0.5), kind: 'vertex', ref: { t: 'semiEnd', id: o.id, i: 1 } });
      if (S.snapCenters) {
        const ref = { t: 'ctr', id: o.id };
        if (o.kind === 'ellipse') out.push({ x: o.cx, y: o.cy, kind: 'center', ref });
        else if (o.kind === 'semi') out.push({ ...G.toWorld(o, 0, -0.5), kind: 'center', ref });
        else out.push({ ...G.centroid(G.polyWorld(o)), kind: 'center', ref });
      }
    } else if (o.type === 'arc') {
      const E = arcE(o);
      if (S.snapEndpoints) { out.push({ ...C.ellipsePoint(E, o.t0), kind: 'endpoint', ref: { t: 'arcEnd', id: o.id, i: 0 } }, { ...C.ellipsePoint(E, o.t0 + o.sweep), kind: 'endpoint', ref: { t: 'arcEnd', id: o.id, i: 1 } }); }
      if (S.snapCenters) out.push({ x: o.cx, y: o.cy, kind: 'center', ref: { t: 'ctr', id: o.id } });
    } else if (o.type === 'line') {
      if (S.snapEndpoints && o.ext !== 'line') out.push({ x: o.x1, y: o.y1, kind: 'endpoint', ref: { t: 'end', id: o.id, i: 1 } });
      if (S.snapEndpoints && o.ext === 'segment') out.push({ x: o.x2, y: o.y2, kind: 'endpoint', ref: { t: 'end', id: o.id, i: 2 } });
      if (S.snapMidpoints && o.ext === 'segment') out.push({ x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2, kind: 'midpoint', ref: { t: 'lmid', id: o.id } });
    } else if (S.snapEndpoints) {
      if (o.type === 'point') out.push({ x: o.x, y: o.y, kind: 'point', id: o.id, ref: { t: 'pt', id: o.id } });
      else if (o.type === 'angle') out.push({ x: o.vx, y: o.vy, kind: 'vertex', ref: { t: 'ang', id: o.id, k: 'v' } }, { x: o.ax, y: o.ay, kind: 'endpoint', ref: { t: 'ang', id: o.id, k: 'a' } }, { x: o.bx, y: o.by, kind: 'endpoint', ref: { t: 'ang', id: o.id, k: 'b' } });
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
  } else if (o.type === 'arc') {
    // the curve as short straight pieces, plus the sector's two radii / the segment's chord
    const pts = C.arcPoints(arcE(o), o.t0, o.sweep, 120);
    for (let i = 1; i < pts.length; i++) pieces.push({ a: pts[i - 1], b: pts[i], t0: 0, t1: 1 });
    const c0 = { x: o.cx, y: o.cy };
    if (o.mode === 'sector') pieces.push({ a: c0, b: pts[0], t0: 0, t1: 1 }, { a: c0, b: pts[pts.length - 1], t0: 0, t1: 1 });
    if (o.mode === 'segment') pieces.push({ a: pts[0], b: pts[pts.length - 1], t0: 0, t1: 1 });
  }
  return { pieces, curves };
}
function nearbyGeometry(wp, R, exclude) {
  const out = [];
  for (const o of doc.objects) {
    if (o.id === exclude) continue;
    const { pieces, curves } = geometryOf(o);
    for (const p of pieces) { const q = C.nearestOnPiece(wp, p); const d = Math.hypot(q.x - wp.x, q.y - wp.y); if (d < R) out.push({ id: o.id, piece: p, q, d }); }
    if (o.type === 'func' && (!o.mode || o.mode === 'func') && !o.hidden) {
      const f = fnOf(o);
      if (f) { let y; try { y = f(wp.x); } catch { y = NaN; } if (isFinite(y) && Math.abs(y - wp.y) < R) out.push({ id: o.id, q: { x: wp.x, y }, d: Math.abs(y - wp.y), graph: true }); }
    }
    for (const E of curves) { const q = C.nearestOnEllipse(E, wp); const d = Math.hypot(q.x - wp.x, q.y - wp.y); if (d < R) out.push({ id: o.id, curve: E, q, d }); }
  }
  return out;
}
function intersectionsNear(near, wp, R) {
  const out = [];
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const g = near[i], h = near[j];
    if (g.id === h.id || g.graph || h.graph) continue;
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
    for (const x of pts) if (Math.hypot(x.x - wp.x, x.y - wp.y) < R) out.push({ x: x.x, y: x.y, kind: 'intersection', ref: { t: 'isect', ids: [g.id, h.id], p: { x: x.x, y: x.y } } });
  }
  return out;
}
// The nearest corner / endpoint / point / center / midpoint / intersection to the cursor, if any.
function keyPointNear(wp) {
  const R = 9 / view.scale;
  const near = S.snapIntersections ? nearbyGeometry(wp, R) : [];
  let best = null, bd = R;
  for (const c of [...snapCandidates(null), ...intersectionsNear(near, wp, R)]) {
    const d = Math.hypot(c.x - wp.x, c.y - wp.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function drawHoverPt(T) {
  if (!hoverPt || drag || printMode) return;
  const p = W2S(hoverPt);
  ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, G.TAU); ctx.strokeStyle = T.sel; ctx.lineWidth = 2; ctx.stroke();
  label(`(${fmtNum(hoverPt.x)}, ${fmtNum(hoverPt.y)})`, p.x + 10, p.y - 16, T, T.text, 'left');
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
  if (best) return { x: best.x, y: best.y, kind: best.kind, id: best.id, ref: best.ref, snapped: true };
  if (S.snapOnOutline && near.length) {
    const n = near.reduce((m, g) => (g.d < m.d ? g : m));
    if (n.d < R * 0.75) return { x: n.q.x, y: n.q.y, kind: n.graph ? 'on graph' : 'on outline', id: n.id, snapped: true };
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
let hoverPt = null; // key point under the cursor, shown with its coordinates
let lastPointerType = 'mouse';
let longPress = null;
let printMode = false; // rendering a printable page
let flash = null; // {id, t0} pulsing highlight after clicking in the Objects panel
let lastPointer = { x: 0, y: 0 };
const pointers = new Map();

function spOf(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointerdown', (e) => {
  altHeld = e.altKey;
  lastPointerType = e.pointerType || 'mouse';
  if (lastPointerType === 'touch' && !document.body.classList.contains('touch')) { document.body.classList.add('touch'); applyTouchBar(); }
  cancelLongPress();
  hideMenu();
  if (lastPointerType !== 'mouse') {
    const sp0 = spOf(e);
    longPress = { x: sp0.x, y: sp0.y, cx: e.clientX, cy: e.clientY, timer: setTimeout(() => fireLongPress(), S.longPressMs) };
  }
  canvas.focus?.();
  const sp = spOf(e);
  pointers.set(e.pointerId, sp);
  if (pointers.size === 2) { // pinch start (zoom, or twist to rotate the selected shape)
    cancelLongPress();
    const [p1, p2] = [...pointers.values()];
    const o = single();
    drag = { mode: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), a0: Math.atan2(p2.y - p1.y, p2.x - p1.x), scale0: view.scale, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, twistId: S.touchRotate && o?.type === 'shape' && !o.locked ? o.id : null, rot0: o?.rot, twist: null, view0: { cx: view.cx, cy: view.cy } };
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
    if (pick.type === 'point') { const s = snap(wp); const cb = pick.cb; endPick(); cb({ x: s.x, y: s.y }, s.kind === 'point' ? s.id : null); }
    else {
      const hit = hitTest(sp);
      if (hit && (pick.type === 'any' ? hit.type !== 'point' : hit.type === pick.type)) { const cb = pick.cb; endPick(); cb(hit); }
      else toast(`Click a ${{ shape: 'shape', func: 'graph', any: 'graph, line or shape' }[pick.type] || 'line'} (or press Esc to cancel)`, true);
    }
    return;
  }
  if (tool === 'link') { linkToolClick(sp, e); return; }
  if (tool === 'polygon' || tool === 'angle') {
    let s = snap(wp);
    if (draft && draft.pts?.length && e.shiftKey && !s.snapped) s = constrainAngle(draft.pts[draft.pts.length - 1], s, S.lineAngleSnap);
    const p = { x: s.x, y: s.y, id: s.kind === 'point' ? s.id : null, on: s.kind === 'on outline' ? s.id : null };
    if (tool === 'polygon') {
      if (draft?.mode === 'poly') {
        const first = W2S(draft.pts[0]);
        if (draft.pts.length >= 3 && Math.hypot(first.x - sp.x, first.y - sp.y) < 10) { finishPoly(); return; }
        const last = draft.pts[draft.pts.length - 1];
        if (Math.hypot(last.x - p.x, last.y - p.y) * view.scale > 2) draft.pts.push(p);
      } else draft = { mode: 'poly', pts: [p], cur: p };
      setHint(`${draft.pts.length} corner${draft.pts.length > 1 ? 's' : ''} · click the first corner, double-click or Enter to finish · Backspace undoes a corner`);
    } else {
      if (draft?.mode !== 'angle') draft = { mode: 'angle', pts: [], refs: [], cur: p };
      draft.pts.push(p);
      draft.refs.push(e.shiftKey ? null : refFromSnap(s));
      if (draft.pts.length === 3) finishAngle();
      else setHint(draft.pts.length === 1 ? 'Now click the vertex (corner) of the angle' : 'Now click a point on the second arm');
    }
    requestRender();
    return;
  }
  if (tool === 'line') {
    const s = snap(wp);
    if (draft && draft.mode === 'line' && draft.clickMode) { finishLine(e); return; }
    draft = { mode: 'line', a: { x: s.x, y: s.y, id: s.kind === 'point' ? s.id : null, on: s.kind === 'on outline' ? s.id : null }, b: null, sp };
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
    const pt = addObject({ id: uid(), type: 'point', x: s.x, y: s.y, style: { stroke: S.pointColor, width: S.pointSize, dash: 'solid' }, label: '' });
    if (S.gliders && (s.kind === 'on outline' || s.kind === 'on graph') && byId(s.id)) { pt.cons = { k: 'onObj', s: [s.id], t0: gliderParam(byId(s.id), s) }; toast('Point on the object — drag it and it slides along'); }
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
    // objects built on points move by moving their points
    for (const id of [...moving]) { const t = byId(id); if (t?.cons && ['seg2', 'polyPts', 'circ2'].includes(t.cons.k)) for (const s of t.cons.s) if (!byId(s)?.locked) moving.add(s); }
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
  const bound = o.cons && ((h.type === 'vertex' && o.cons.k === 'polyPts') || (h.type === 'lineEnd' && o.cons.k === 'seg2'));
  if (!bound) detach(o);
  const orig = JSON.parse(JSON.stringify(o));
  if (h.type === 'resize') drag = { mode: 'resize', id: o.id, hx: h.hx, hy: h.hy, orig };
  else if (h.type === 'rotate') drag = { mode: 'rotate', id: o.id, orig, a0: Math.atan2(wp.y - o.cy, wp.x - o.cx) };
  else if (h.type === 'vertex') drag = { mode: 'vertex', id: o.id, i: h.i, orig, bound };
  else if (h.type === 'lineEnd') drag = { mode: 'lineEnd', id: o.id, end: h.end, orig, bound };
  else if (h.type === 'anglePt') drag = { mode: 'anglePt', id: o.id, k: h.k, orig };
  else if (h.type === 'arcEnd') drag = { mode: 'arcEnd', id: o.id, k: h.k, orig };
  else if (h.type === 'arcRadius') drag = { mode: 'arcRadius', id: o.id, orig };
}

canvas.addEventListener('pointermove', (e) => {
  altHeld = e.altKey;
  const sp = spOf(e);
  lastPointer = sp;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sp);
  const wp = S2W(sp);
  updateHud(wp);
  if (longPress && Math.hypot(sp.x - longPress.x, sp.y - longPress.y) > 10) cancelLongPress();
  if (drag?.mode === 'pinch') {
    const [p1, p2] = [...pointers.values()];
    if (!p2) return;
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const da = Math.atan2(p2.y - p1.y, p2.x - p1.x) - drag.a0;
    const dang = Math.atan2(Math.sin(da), Math.cos(da));
    const ratio = d / drag.d0;
    if (drag.twist === null && drag.twistId) {
      if (Math.abs(dang) > 12 * G.DEG && Math.abs(ratio - 1) < 0.15) { drag.twist = true; pushUndo(); detach(byId(drag.twistId)); view.scale = drag.scale0; }
      else if (Math.abs(ratio - 1) > 0.08) drag.twist = false;
    }
    if (drag.twist) {
      const o = byId(drag.twistId);
      if (o) { let r = drag.rot0 - dang; if (S.rotateSnap) { const st = S.rotateSnap * G.DEG; if (Math.abs(r / st - Math.round(r / st)) < 0.08) r = Math.round(r / st) * st; } o.rot = r; updateInscribed(o.id); requestRender(); throttleProps(); }
    } else zoomAt(drag.mid, (drag.scale0 * d) / drag.d0 / view.scale);
    return;
  }
  if (!drag) {
    snapHint = null;
    const hp = S.hoverCoords && e.pointerType !== 'touch' ? keyPointNear(wp) : null;
    if ((hp?.x !== hoverPt?.x) || (hp?.y !== hoverPt?.y)) { hoverPt = hp; requestRender(); }
    if (tool === 'link' && !pick) {
      const r = pickRef(sp);
      if (!sameRef(r, linkHover)) { linkHover = r; requestRender(); }
      canvas.style.cursor = r ? 'pointer' : 'crosshair';
      return;
    }
    if (pick && pick.type !== 'point') {
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
        draft.b = e.shiftKey ? constrainAngle(draft.a, s, S.lineAngleSnap) : { x: s.x, y: s.y, id: s.kind === 'point' ? s.id : null, on: s.kind === 'on outline' ? s.id : null };
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
      draft.b = e.shiftKey ? constrainAngle(draft.a, s, S.lineAngleSnap) : { x: s.x, y: s.y, id: s.kind === 'point' ? s.id : null, on: s.kind === 'on outline' ? s.id : null };
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
        // a point on an object slides along it instead of coming off
        if (t.cons?.k === 'onObj' && !drag.orig.has(t.cons.s[0]) && byId(t.cons.s[0])) { const A = byId(t.cons.s[0]); t.cons.t0 = gliderParam(A, { x: t.x, y: t.y }); applyCons(t); continue; }
        // moving an inscribed shape or a construction without its source detaches it
        if (t.inscribed && !drag.orig.has(t.inscribed.parent)) detach(t);
        if (t.cons && !t.cons.s.every((id) => drag.orig.has(id))) delete t.cons;
        if (t.att) delete t.att;
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
      if (drag.bound) { const pt = byId(o.cons.s[drag.i]); if (pt) { pt.x = s.x; pt.y = s.y; } break; }
      const W = G.polyWorld(drag.orig);
      W[drag.i] = { x: s.x, y: s.y };
      G.setPolyFromWorld(o, W);
      updateInscribed(o.id);
      break;
    }
    case 'arcEnd': case 'arcRadius': {
      const O = drag.orig;
      const l = G.rotPt({ x: wp.x - O.cx, y: wp.y - O.cy }, -O.rot);
      if (drag.mode === 'arcRadius') {
        // uniform scale: the radius follows the pointer, the angles stay
        const E0 = arcE(O), q0 = C.ellipsePoint(E0, O.t0 + O.sweep / 2);
        const k = Math.max(1e-3, Math.hypot(wp.x - O.cx, wp.y - O.cy) / (Math.hypot(q0.x - O.cx, q0.y - O.cy) || 1));
        let rx = O.rx * k, ry = O.ry * k;
        if (S.snapGrid && Math.abs(O.rx - O.ry) < 1e-12) rx = ry = Math.max(S.gridSize, Math.round(rx / S.gridSize) * S.gridSize);
        o.rx = rx; o.ry = ry;
        break;
      }
      const ang = Math.atan2(l.y / O.ry, l.x / O.rx);
      const st = e.shiftKey ? S.rotateSnap * G.DEG : 0;
      const snapA = (x) => (st ? Math.round(x / st) * st : x);
      const norm = (x) => { let v = ((x % G.TAU) + G.TAU) % G.TAU; if (v < 1e-9) v = G.TAU; return v; };
      if (drag.k === 1) o.sweep = snapA(norm(ang - O.t0));
      else { const end = O.t0 + O.sweep; const t0 = st ? end - snapA(norm(end - ang)) : ang; o.t0 = t0; o.sweep = norm(end - t0); }
      break;
    }
    case 'anglePt': {
      const s = snap(wp, o.id);
      snapHint = s.snapped ? s : null;
      o[drag.k + 'x'] = s.x; o[drag.k + 'y'] = s.y;
      if (o.att) { const r = refFromSnap(s); if (r) o.att[drag.k] = r; else delete o.att[drag.k]; if (!Object.keys(o.att).length) delete o.att; }
      break;
    }
    case 'lineEnd': {
      let s = snap(wp, o.id);
      snapHint = s.snapped ? s : null;
      if (drag.bound) { const pt = byId(o.cons.s[drag.end - 1]); if (pt) { pt.x = s.x; pt.y = s.y; } break; }
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

function cancelLongPress() { if (longPress) { clearTimeout(longPress.timer); longPress = null; } }
// Touch: holding a finger still opens the right-click menu.
function fireLongPress() {
  const lp = longPress;
  longPress = null;
  if (!lp || pointers.size > 1) return;
  if (drag?.mode === 'move' && drag.moved) return;
  drag = null; draft = null; snapHint = null;
  const hit = hitTest(lp);
  if (hit && !sel.includes(hit.id)) setSelection([hit.id]);
  navigator.vibrate?.(12);
  menuGuardUntil = performance.now() + 600;
  // open beside the finger so it isn't hidden under it
  showMenu(hit ? objectMenu(hit) : canvasMenu(S2W(lp)), lp.cx + 22, lp.cy - 30);
  requestRender();
}

function endPointer(e) {
  pointers.delete(e.pointerId);
  cancelLongPress();
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.style.cursor = '';
  if (d.mode === 'pinch') { if (d.twist) changed(); return; }
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
canvas.addEventListener('pointerleave', () => { if (!drag) { hoverId = null; snapHint = null; hoverPt = null; linkHover = null; requestRender(); updateHud(); } });

// With "build from points", ends that land on points attach to them (and new points can be made).
function endPoint(q) {
  if (!S.bindToPoints) return null;
  if (q.id && byId(q.id)?.type === 'point') return q.id;
  if (!S.autoPoints) return null;
  const pt = { id: uid(), type: 'point', x: q.x, y: q.y, style: { stroke: S.pointColor, width: S.pointSize, dash: 'solid' }, label: '' };
  if (q.on && byId(q.on) && S.gliders) { pt.cons = { k: 'onObj', s: [q.on], t0: gliderParam(byId(q.on), q) }; }
  doc.objects.push(pt);
  return pt.id;
}
function finishLine(e) {
  if (!draft || !draft.b || G.dist(draft.a, draft.b) < 1e-9) return;
  pushUndo();
  const ia = endPoint(draft.a), ib = ia ? endPoint(draft.b) : null;
  const ln = addObject({ id: uid(), type: 'line', x1: draft.a.x, y1: draft.a.y, x2: draft.b.x, y2: draft.b.y, style: lineStyle(), ext: 'segment', arrows: 'none', name: '' }, false);
  if (ia && ib) ln.cons = { k: 'seg2', s: [ia, ib] };
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
  if (S.bindToPoints) {
    const ids = pts.map((q) => (q.id && byId(q.id)?.type === 'point' ? q.id : null));
    if (ids.every(Boolean) || S.autoPoints) o.cons = { k: 'polyPts', s: pts.map((q, i) => ids[i] || endPoint({ ...q, id: null })) };
  }
  addObject(o);
  draft = null; snapHint = null;
  setHint(toolHint());
  changed();
  toast(`Created ${C.classify(o).toLowerCase()}${G.isSimple(pts) ? '' : ' (its sides cross)'}`);
  afterDraw();
}
function finishAngle() {
  const [A, V, B] = draft.pts;
  const [ra, rv, rb] = draft.refs || [];
  draft = null; snapHint = null;
  setHint(toolHint());
  if (Math.hypot(A.x - V.x, A.y - V.y) < 1e-12 || Math.hypot(B.x - V.x, B.y - V.y) < 1e-12) { toast('The arms must not start at the vertex', true); return; }
  pushUndo();
  const o = addObject({ id: uid(), type: 'angle', ax: A.x, ay: A.y, vx: V.x, vy: V.y, bx: B.x, by: B.y, style: { stroke: S.angleColor, width: 2, dash: 'solid' }, reflex: false, name: '' }, false);
  const att = {};
  if (ra) att.a = ra; if (rv) att.v = rv; if (rb) att.b = rb;
  if (Object.keys(att).length) o.att = att;
  changed();
  toast(`Angle: ${fmtAng(angleValue(o))}` + (o.att ? ' — it follows the sides you measured' : ' — right-click it to show the reflex angle'));
  afterDraw();
}

function cursorForHandle(h) {
  if (h.type === 'arcEnd' || h.type === 'arcRadius') return 'grab';
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
  if (puzzle && hit) return; // no measuring dialogs during the puzzle
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
  if (mod && k === 'k') { e.preventDefault(); openCmd(); return; }
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
    if (linkPicks.length) { linkPicks = []; setHint(toolHint()); }
    else if (pick) endPick();
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
  if (e.key === '/') { e.preventDefault(); openCmd(); return; }
  if (e.key === '+' || e.key === '=') { zoomAt({ x: cw / 2, y: ch / 2 }, 1.25); return; }
  if (e.key === '-' || e.key === '_') { zoomAt({ x: cw / 2, y: ch / 2 }, 0.8); return; }
  if (e.key === '0') { view.cx = 0; view.cy = 0; view.scale = 48; requestRender(); updateHud(); return; }
  if (tool === 'shape' && /^[1-9]$/.test(e.key)) { setShapeSides(+e.key); return; }
  const tools = { v: 'select', h: 'pan', l: 'line', p: 'point', s: 'shape', n: 'polygon', a: 'angle', k: 'link', t: 'text', m: 'measure' };
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
    if (t.cons && !t.cons.s.every((id) => all.has(id))) delete t.cons;
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
  for (const c of out) {
    if (c.inscribed) c.inscribed = map.has(c.inscribed.parent) ? { ...c.inscribed, parent: map.get(c.inscribed.parent) } : null;
    if (c.cons) { if (c.cons.s.every((id) => map.has(id))) c.cons.s = c.cons.s.map((id) => map.get(id)); else delete c.cons; }
    if (c.att) { for (const k of Object.keys(c.att)) { const r = c.att[k]; const ids = r.ids || [r.id]; if (ids.every((id) => map.has(id))) { if (r.ids) r.ids = r.ids.map((id) => map.get(id)); else r.id = map.get(r.id); } else delete c.att[k]; } if (!Object.keys(c.att).length) delete c.att; }
    if (c.type === 'region' && map.has(c.a) && map.has(c.b)) { c.a = map.get(c.a); c.b = map.get(c.b); }
    if (c.type === 'link') c.refs = c.refs.map((r) => ({ ...r, o: map.get(r.o) || r.o }));
  }
  // a copied link only makes sense if its members were copied too
  return out.filter((c) => c.type !== 'link' || c.refs.every((r) => [...map.values()].includes(r.o)));
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
  o.snapN = 0;
  return o;
}
const midOf = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const P0 = { x: 0, y: 0 };

// Constructions remember what they were built from (o.cons) and are rebuilt from it every frame,
// so they follow their shape when it moves or changes.
const cLine = (cons, color, ext = 'segment') => Object.assign(mkLine(P0, P0, ext, color), { cons });
const cPoint = (cons, lab, color) => Object.assign(mkPoint(P0, lab, color), { cons });
const cCircle = (cons, color) => Object.assign(mkCircle(P0, 1, color), { cons });
function cPoly(cons, n, name, color) {
  const o = makeShape(Math.max(3, n), 0, 0, 1, 1);
  o.name = name || '';
  o.snapN = 0;
  if (color) o.style = { ...o.style, stroke: color, fill: color };
  o.cons = cons;
  return o;
}

function applyCons(o) {
  const c = o.cons;
  if (!c) return false;
  const src = c.s.map(byId);
  const bad = () => { delete o.cons; return false; };
  if (src.some((x) => !x)) return bad();
  const A = src[0];
  const poly = A.type === 'shape' && A.kind === 'polygon' ? G.polyWorld(A) : null;
  const tri = poly && poly.length === 3 ? poly : null;
  const E = A.type === 'shape' && A.kind !== 'polygon' ? C.ellipseOf(A) : null;
  const L = A.type === 'line' ? [{ x: A.x1, y: A.y1 }, { x: A.x2, y: A.y2 }] : null;
  const setLine = (a, b, collapsed = false) => { Object.assign(o, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }); o.collapsed = collapsed || undefined; };
  const setPoint = (p, collapsed = false) => { o.x = p.x; o.y = p.y; o.collapsed = collapsed || undefined; };
  const setCircle = (p, r) => Object.assign(o, { cx: p.x, cy: p.y, w: 2 * r, h: 2 * r, rot: 0 });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y }), sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y }), mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  // ---- point-based and function-based constructions ----
  const P = (i) => (src[i]?.type === 'point' ? { x: src[i].x, y: src[i].y } : null);
  switch (c.k) {
    case 'seg2': { const a = P(0), b = P(1); if (!a || !b) return bad(); setLine(a, b); return true; }
    case 'mid2': { const a = P(0), b = P(1); if (!a || !b) return bad(); setPoint(midOf(a, b)); return true; }
    case 'circ2': { const a = P(0), b = P(1); if (!a || !b) return bad(); setCircle(a, Math.max(G.dist(a, b), 1e-9)); return true; }
    case 'polyPts': {
      const pts = src.map((s2) => (s2.type === 'point' ? { x: s2.x, y: s2.y } : null));
      if (pts.some((q) => !q) || pts.length < 3) return bad();
      G.setPolyFromWorld(o, pts);
      return true;
    }
    case 'onObj': { const q = gliderPos(A, c.t0); if (!q) { setPoint({ x: o.x, y: o.y }, true); return true; } setPoint(q); return true; }
    case 'ftan': {
      const f = fnOf(A), pt = src[1];
      if (!f || !pt) return bad();
      const x0 = pt.x, h = 1e-5 * Math.max(1, Math.abs(x0));
      let y0, m;
      try { y0 = f(x0); m = (f(x0 + h) - f(x0 - h)) / (2 * h); } catch { y0 = NaN; }
      if (!isFinite(y0) || !isFinite(m)) { setLine({ x: x0, y: 0 }, { x: x0, y: 0 }, true); return true; }
      setLine({ x: x0, y: y0 }, { x: x0 + 1, y: y0 + m });
      return true;
    }
    case 'froot': case 'fext': case 'isect': {
      const q = trackPoint(c, src);
      if (!q) { setPoint(c.p || { x: 0, y: 0 }, true); return true; }
      c.p = { x: q.x, y: q.y };
      setPoint(q);
      return true;
    }
  }
  const needTri = ['median', 'altitude', 'altExt', 'bisector', 'perpbis', 'tcenter', 'circum', 'incircle', 'ninept', 'euler'];
  if (needTri.includes(c.k) && !tri) return bad();
  if (['diag', 'sidemid', 'corner', 'centroid', 'mec', 'mecCenter'].includes(c.k) && (!poly || (c.i ?? 0) >= poly.length || (c.j ?? 0) >= poly.length)) return bad();
  if (['lmid', 'lperpbis', 'lpar', 'lperp', 'lfoot', 'ldiam', 'lrad', 'lsquare', 'ltri', 'dist', 'lineAngle'].includes(c.k) && !L) return bad();
  if (['ecenter', 'eaxis', 'ebox', 'tanFrom', 'tanPt', 'tanAt', 'arc', 'chord'].includes(c.k) && !E) return bad();
  const K = tri ? C.triangleCenters(tri) : null;
  switch (c.k) {
    case 'median': setLine(...C.medians(tri)[c.i]); break;
    case 'altitude': setLine(...C.altitudes(tri)[c.i].seg); break;
    case 'altExt': { const al = C.altitudes(tri)[c.i]; if (al.ext) setLine(...al.ext); else setLine(al.seg[1], al.seg[1], true); break; }
    case 'bisector': setLine(...C.angleBisectors(tri)[c.i]); break;
    case 'perpbis': setLine(...C.perpBisectors(tri)[c.i]); break;
    case 'tcenter': { const p = K[c.c]; if (!p) return bad(); setPoint(p); break; }
    case 'circum': if (!K.O) return bad(); setCircle(K.O, K.R); break;
    case 'incircle': setCircle(K.I, K.r); break;
    case 'ninept': if (!K.N) return bad(); setCircle(K.N, K.nr); break;
    case 'euler': if (K.O && G.dist(K.O, K.H) > 1e-9 * Math.max(1, K.R)) setLine(K.O, K.H); else setLine(K.G, K.G, true); break;
    case 'diag': setLine(poly[c.i], poly[c.j]); break;
    case 'sidemid': setPoint(midOf(poly[c.i], poly[(c.i + 1) % poly.length])); break;
    case 'corner': setPoint(poly[c.i]); break;
    case 'centroid': setPoint(G.centroid(poly)); break;
    case 'mec': { const m = C.minEnclosingCircle(poly); setCircle(m, m.r); break; }
    case 'mecCenter': setPoint(C.minEnclosingCircle(poly)); break;
    case 'lmid': setPoint(midOf(L[0], L[1])); break;
    case 'lperpbis': { const m = midOf(L[0], L[1]), d = sub(L[1], L[0]); setLine(m, add(m, { x: -d.y, y: d.x })); break; }
    case 'lpar': setLine(c.p, add(c.p, sub(L[1], L[0]))); break;
    case 'lperp': { const d = sub(L[1], L[0]); setLine(c.p, add(c.p, { x: -d.y, y: d.x })); break; }
    case 'lfoot': { const f = C.footOnLine(c.p, L[0], L[1]); setPoint(f); break; }
    case 'ldiam': setCircle(midOf(L[0], L[1]), G.dist(L[0], L[1]) / 2); break;
    case 'lrad': setCircle(L[0], G.dist(L[0], L[1])); break;
    case 'lsquare': { const d = sub(L[1], L[0]), n = { x: -d.y, y: d.x }; o.rot = Math.atan2(d.y, d.x); G.setPolyFromWorld(o, [L[0], L[1], add(L[1], n), add(L[0], n)]); break; }
    case 'ltri': { const d = sub(L[1], L[0]), m = midOf(L[0], L[1]), h = Math.sqrt(3) / 2; o.rot = Math.atan2(d.y, d.x); G.setPolyFromWorld(o, [L[0], L[1], add(m, { x: -d.y * h, y: d.x * h })]); break; }
    case 'ecenter': setPoint(E.c); break;
    case 'eaxis': {
      const ux = G.rotPt({ x: E.rx, y: 0 }, E.rot), uy = G.rotPt({ x: 0, y: E.ry }, E.rot);
      if (c.i === 0) setLine(sub(E.c, ux), add(E.c, ux)); else setLine(E.half ? E.c : sub(E.c, uy), add(E.c, uy));
      break;
    }
    case 'ebox': o.rot = A.rot; G.setPolyFromWorld(o, [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => G.toWorld(A, u, v))); break;
    case 'abis': {
      if (A.type !== 'angle') return bad();
      const V = { x: A.vx, y: A.vy }, a = { x: A.ax, y: A.ay }, b = { x: A.bx, y: A.by };
      const la = G.dist(a, V) || 1, lb = G.dist(b, V) || 1;
      let bis = add(mul(sub(a, V), 1 / la), mul(sub(b, V), 1 / lb));
      if (Math.hypot(bis.x, bis.y) < 1e-9) { const u = mul(sub(a, V), 1 / la); bis = { x: -u.y, y: u.x }; }
      if (A.reflex) bis = mul(bis, -1);
      const k = Math.min(la, lb) / (Math.hypot(bis.x, bis.y) || 1);
      setLine(V, add(V, mul(bis, k)));
      break;
    }
    case 'tanFrom': {
      const q = C.tangentsFrom(E, c.p).points[c.i];
      if (!q) setLine(c.p, c.p, true); else setLine(c.p, add(q, mul(sub(q, c.p), 0.35)));
      break;
    }
    case 'tanPt': { const q = C.tangentsFrom(E, c.p).points[c.i]; if (q) setPoint(q); else setPoint(c.p, true); break; }
    case 'tanAt': { const t = C.tangentAt(E, c.p); const k = Math.max(E.rx, E.ry); setLine(sub(t.p, mul(t.d, k)), add(t.p, mul(t.d, k))); break; }
    case 'dist': {
      const pt = src[1] && src[1].type === 'point' ? { x: src[1].x, y: src[1].y } : c.p;
      if (!pt) return bad();
      const f = C.footOnLine(pt, L[0], L[1]);
      setLine(pt, { x: f.x, y: f.y }, G.dist(pt, f) < 1e-12);
      break;
    }
    case 'lineAngle': {
      const B2 = src[1];
      if (!B2 || B2.type !== 'line') return bad();
      const M = [{ x: B2.x1, y: B2.y1 }, { x: B2.x2, y: B2.y2 }];
      const X = C.intersectPieces({ a: L[0], b: L[1], t0: -Infinity, t1: Infinity }, { a: M[0], b: M[1], t0: -Infinity, t1: Infinity });
      if (!X) { o.collapsed = true; break; }
      const far = (P) => (G.dist(P[0], X) > G.dist(P[1], X) ? P[0] : P[1]);
      Object.assign(o, { vx: X.x, vy: X.y, ax: far(L).x, ay: far(L).y, bx: far(M).x, by: far(M).y });
      o.collapsed = undefined;
      break;
    }
    case 'arc': Object.assign(o, { cx: E.c.x, cy: E.c.y, rx: E.rx, ry: E.ry, rot: E.rot }); break;
    case 'chord': setLine(C.ellipsePoint(E, c.t0), C.ellipsePoint(E, c.t1)); break;
    default: return bad();
  }
  return true;
}

/* ---------- references to points on other objects ---------- */

// A reference that follows whatever a click snapped onto (null when it snapped to nothing).
function refFromSnap(s) {
  if (!s || !s.snapped) return null;
  if (s.ref) return JSON.parse(JSON.stringify(s.ref));
  if ((s.kind === 'on outline' || s.kind === 'on graph') && byId(s.id)) {
    const A = byId(s.id);
    if (A.type === 'shape' && A.kind === 'polygon') {
      // remember the side and how far along it, so the point stays on that side
      const W = G.polyWorld(A);
      let best = Infinity, side = 0, t = 0;
      W.forEach((p, i) => { const q = W[(i + 1) % W.length], L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 || 1; const k = clamp(((s.x - p.x) * (q.x - p.x) + (s.y - p.y) * (q.y - p.y)) / L2, 0, 1); const d = Math.hypot(p.x + (q.x - p.x) * k - s.x, p.y + (q.y - p.y) * k - s.y); if (d < best) { best = d; side = i; t = k; } });
      return { t: 'side', id: A.id, i: side, u: t };
    }
    return { t: 'on', id: A.id, u: gliderParam(A, s) };
  }
  return null;
}
function resolveRef(r) {
  if (r.t === 'isect') {
    const [A, B] = r.ids.map(byId);
    if (!A || !B) return null;
    const pts = intersectionsOf(A, B);
    if (!pts.length) return null;
    const q = pts.reduce((b, p) => (Math.hypot(p.x - r.p.x, p.y - r.p.y) < Math.hypot(b.x - r.p.x, b.y - r.p.y) ? p : b));
    r.p = { x: q.x, y: q.y };
    return q;
  }
  const o = byId(r.id);
  if (!o) return null;
  switch (r.t) {
    case 'pt': return o.type === 'point' ? { x: o.x, y: o.y } : null;
    case 'vx': case 'mid': case 'side': {
      if (o.type !== 'shape' || o.kind !== 'polygon' || r.i >= o.pts.length) return null;
      const W = G.polyWorld(o), p = W[r.i], q = W[(r.i + 1) % W.length];
      if (r.t === 'vx') return p;
      const k = r.t === 'mid' ? 0.5 : r.u;
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    }
    case 'semiEnd': return o.type === 'shape' ? G.toWorld(o, r.i ? 0.5 : -0.5, -0.5) : null;
    case 'arcEnd': return o.type === 'arc' ? C.ellipsePoint(arcE(o), o.t0 + (r.i ? o.sweep : 0)) : null;
    case 'ctr': if (o.type === 'arc') return { x: o.cx, y: o.cy }; return o.type !== 'shape' ? null : o.kind === 'ellipse' ? { x: o.cx, y: o.cy } : o.kind === 'semi' ? G.toWorld(o, 0, -0.5) : G.centroid(G.polyWorld(o));
    case 'end': return o.type === 'line' ? (r.i === 1 ? { x: o.x1, y: o.y1 } : { x: o.x2, y: o.y2 }) : null;
    case 'lmid': return o.type === 'line' ? { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 } : null;
    case 'ang': return o.type === 'angle' ? { x: o[r.k + 'x'], y: o[r.k + 'y'] } : null;
    case 'sn': return snapPointsOf(o)[r.j] || null;
    case 'on': return gliderPos(o, r.u);
  }
  return null;
}
const REF_TYPES = ['arcEnd', 'pt', 'vx', 'mid', 'side', 'semiEnd', 'ctr', 'end', 'lmid', 'ang', 'sn', 'on', 'isect'];
function cleanRef(r) {
  if (!r || !REF_TYPES.includes(r.t)) return null;
  const out = { t: r.t };
  if (r.t === 'isect') {
    if (!Array.isArray(r.ids) || r.ids.length !== 2 || !r.ids.every((id) => typeof id === 'string' && ID_RE.test(id))) return null;
    out.ids = r.ids.slice();
    out.p = { x: num(r.p?.x), y: num(r.p?.y) };
    return out;
  }
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  out.id = r.id;
  if (Number.isInteger(r.i) && r.i >= 0 && r.i < 200) out.i = r.i;
  if (Number.isInteger(r.j) && r.j >= 0 && r.j < 500) out.j = r.j;
  if (typeof r.u === 'number' && isFinite(r.u)) out.u = r.u;
  if (['a', 'v', 'b'].includes(r.k)) out.k = r.k;
  return out;
}
// Angle marks made on existing sides and corners follow them.
function syncAngleAttachments() {
  for (const o of doc.objects) {
    if (o.type !== 'angle' || !o.att) continue;
    for (const k of ['a', 'v', 'b']) {
      const r = o.att[k];
      if (!r) continue;
      if (r.t !== 'isect' && !byId(r.id)) { delete o.att[k]; continue; }
      const q = resolveRef(r);
      if (q && isFinite(q.x) && isFinite(q.y)) { o[k + 'x'] = q.x; o[k + 'y'] = q.y; }
    }
  }
}

/* ---------- gliders & tracked points ---------- */

// Where a point gliding on object `A` sits for parameter t.
function gliderPos(A, t) {
  if (A.type === 'func') { const f = fnOf(A); if (!f) return null; let y; try { y = f(t); } catch { return null; } return isFinite(y) ? { x: t, y } : null; }
  if (A.type === 'line') return { x: A.x1 + (A.x2 - A.x1) * t, y: A.y1 + (A.y2 - A.y1) * t };
  if (A.type === 'shape' && A.kind === 'polygon') {
    const W = G.polyWorld(A);
    const lens = W.map((p, i) => G.dist(p, W[(i + 1) % W.length]));
    const total = lens.reduce((s, l) => s + l, 0);
    let d = (((t % 1) + 1) % 1) * total;
    for (let i = 0; i < W.length; i++) {
      if (d <= lens[i] || i === W.length - 1) { const k = lens[i] ? d / lens[i] : 0; const q = W[(i + 1) % W.length]; return { x: W[i].x + (q.x - W[i].x) * k, y: W[i].y + (q.y - W[i].y) * k }; }
      d -= lens[i];
    }
  }
  if (A.type === 'shape') return C.ellipsePoint(C.ellipseOf(A), t);
  return null;
}
// The glider parameter for the point of `A` nearest to p.
function gliderParam(A, p) {
  if (A.type === 'func') return p.x;
  if (A.type === 'line') {
    const dx = A.x2 - A.x1, dy = A.y2 - A.y1, L = dx * dx + dy * dy || 1;
    let t = ((p.x - A.x1) * dx + (p.y - A.y1) * dy) / L;
    if (A.ext !== 'line') t = Math.max(0, t);
    if (A.ext === 'segment') t = Math.min(1, t);
    return t;
  }
  if (A.type === 'shape' && A.kind === 'polygon') {
    const W = G.polyWorld(A);
    const lens = W.map((q, i) => G.dist(q, W[(i + 1) % W.length]));
    const total = lens.reduce((s, l) => s + l, 0) || 1;
    let best = Infinity, at = 0, acc = 0;
    W.forEach((q, i) => {
      const r = W[(i + 1) % W.length], L = lens[i] || 1e-12;
      const k = clamp(((p.x - q.x) * (r.x - q.x) + (p.y - q.y) * (r.y - q.y)) / (L * L), 0, 1);
      const d = Math.hypot(q.x + (r.x - q.x) * k - p.x, q.y + (r.y - q.y) * k - p.y);
      if (d < best) { best = d; at = (acc + k * L) / total; }
      acc += lens[i];
    });
    return at;
  }
  if (A.type === 'shape') {
    const E = C.ellipseOf(A);
    let t = C.ellipseParam(E, p);
    if (E.half) t = clamp(((t % G.TAU) + G.TAU) % G.TAU > Math.PI ? (t < 0 && t > -Math.PI / 2 ? 0 : Math.PI) : ((t % G.TAU) + G.TAU) % G.TAU, 0, Math.PI);
    return t;
  }
  return 0;
}
// All intersection points of two objects (lines, shapes, angle arms, and y = f(x) graphs).
function intersectionsOf(A, B) {
  const out = [];
  const isF = (o) => o.type === 'func' && (!o.mode || o.mode === 'func');
  if (isF(A) || isF(B)) {
    const [F, other] = isF(A) ? [A, B] : [B, A];
    const f = fnOf(F);
    if (!f) return out;
    const tl = S2W({ x: 0, y: 0 }), br = S2W({ x: cw, y: ch });
    const span = br.x - tl.x, x0 = tl.x - span, x1 = br.x + span;
    if (isF(other)) {
      const g = fnOf(other);
      if (g) for (const x of GR.roots((x) => f(x) - g(x), x0, x1)) out.push({ x, y: f(x) });
    } else {
      const { pieces, curves } = geometryOf(other);
      for (const pc of pieces) {
        const dx = pc.b.x - pc.a.x, dy = pc.b.y - pc.a.y;
        if (Math.abs(dx) < 1e-12) { const x = pc.a.x; try { const y = f(x); const t = (y - pc.a.y) / (dy || 1); if (isFinite(y) && t >= pc.t0 - 1e-9 && t <= pc.t1 + 1e-9) out.push({ x, y }); } catch { /* skip */ } continue; }
        const lo = isFinite(pc.t0) ? pc.a.x + dx * pc.t0 : dx > 0 ? x0 : x1, hi = isFinite(pc.t1) ? pc.a.x + dx * pc.t1 : dx > 0 ? x1 : x0;
        for (const x of GR.roots((x) => f(x) - (pc.a.y + (dy / dx) * (x - pc.a.x)), Math.min(lo, hi), Math.max(lo, hi), 600)) out.push({ x, y: f(x) });
      }
      for (const E of curves) {
        // upper and lower halves of the ellipse as functions of x (axis-aligned-ish handled by sampling the curve)
        const pts = C.arcPoints(E, 0, E.half ? Math.PI : G.TAU, 720);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], q = pts[i];
          const sp = p.y - f(p.x), sq = q.y - f(q.x);
          if (isFinite(sp) && isFinite(sq) && Math.sign(sp) !== Math.sign(sq)) {
            let lo = 0, hi = 1;
            const tt = (k) => { const x = p.x + (q.x - p.x) * k, y = p.y + (q.y - p.y) * k; return y - f(x); };
            for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (Math.sign(tt(m)) === Math.sign(sp)) lo = m; else hi = m; }
            let r = { x: p.x + (q.x - p.x) * lo, y: p.y + (q.y - p.y) * lo };
            for (let it = 0; it < 30; it++) { r = C.nearestOnEllipse(E, r); const y = f(r.x); r = { x: r.x, y: (r.y + y) / 2 }; }
            out.push(C.nearestOnEllipse(E, r));
          }
        }
      }
    }
    return out;
  }
  const ga = geometryOf(A), gb = geometryOf(B);
  for (const p of ga.pieces) for (const q of gb.pieces) { const x = C.intersectPieces(p, q); if (x) out.push(x); }
  for (const p of ga.pieces) for (const E of gb.curves) out.push(...C.pieceEllipse(p, E));
  for (const p of gb.pieces) for (const E of ga.curves) out.push(...C.pieceEllipse(p, E));
  for (const E1 of ga.curves) for (const E2 of gb.curves) {
    const pts = C.arcPoints(E1, 0, G.TAU, 720);
    for (let i = 1; i < pts.length; i++) {
      for (const x of C.pieceEllipse({ a: pts[i - 1], b: pts[i], t0: 0, t1: 1 }, E2)) {
        let r = x;
        for (let k = 0; k < 60; k++) { r = C.nearestOnEllipse(E1, r); r = C.nearestOnEllipse(E2, r); }
        out.push(r);
      }
    }
  }
  // drop duplicates (shared corners, chord endpoints)
  return out.filter((p, i) => out.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-7 * Math.max(1, Math.hypot(p.x, p.y))) === i);
}
// Roots, turning points and intersections that stay live: re-found near where they were last.
function trackPoint(c, src) {
  const hint = c.p || { x: 0, y: 0 };
  const nearest = (list) => list.reduce((best, q) => (!best || Math.hypot(q.x - hint.x, q.y - hint.y) < Math.hypot(best.x - hint.x, best.y - hint.y) ? q : best), null);
  if (c.k === 'isect') { const [A, B] = src; if (!A || !B) return null; return nearest(intersectionsOf(A, B)); }
  const f = fnOf(src[0]);
  if (!f) return null;
  const w = Math.max(1, Math.abs(hint.x) * 0.2, 60 / view.scale);
  if (c.k === 'froot') return nearest(GR.roots(f, hint.x - w, hint.x + w, 400).map((x) => ({ x, y: 0 })));
  return nearest(GR.extrema(f, hint.x - w, hint.x + w, 400, exactDerivFn(src[0])).filter((e) => !c.c || (c.c === 'X' ? e.kind === 'max' : e.kind === 'min')));
}

/* ---------- sliders drive any number (bindings) ---------- */

const BIND_FIELDS = ['cx', 'cy', 'w', 'h', 'rot', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 't0', 'sweep'];
const bindCache = new Map();
function evalBound(text) {
  const key = text + '|' + Object.keys(params).sort().join('');
  if (!bindCache.has(key)) { try { bindCache.set(key, compileVars(text, [], params)); } catch { bindCache.set(key, null); } if (bindCache.size > 500) bindCache.clear(); }
  const f = bindCache.get(key);
  if (!f) return NaN;
  try { return f(); } catch { return NaN; }
}
function setField(o, f, v) {
  if (!isFinite(v)) return;
  if (f === 'rot') o.rot = v * G.DEG;
  else if (f === 't0' || f === 'sweep') { if (f === 'sweep' && (v === 0 || Math.abs(v) > 360)) return; o[f] = v * G.DEG; }
  else if (f === 'r') { if (!(v > 0)) return; if (o.type === 'arc') { o.rx = o.ry = v; } else if (o.kind === 'semi') { o.w = 2 * v; o.h = v; } else { o.w = o.h = 2 * v; } }
  else if ((f === 'w' || f === 'h') && !(v > 0)) return;
  else o[f] = v;
}
function applyBindings() {
  for (const o of doc.objects) {
    if (!o.bind) continue;
    for (const [f, text] of Object.entries(o.bind)) setField(o, f, evalBound(text));
    if (o.type === 'shape') updateInscribed(o.id);
  }
}
// Does this text use slider letters? (then it becomes a live binding)
function usesSliders(text) {
  try {
    const { ast } = parseExpr(text, { vars: [], params });
    const walk = (n) => n.t === 'par' || (n.a && walk(n.a)) || (n.b && walk(n.b)) || (n.args && n.args.some(walk));
    return walk(ast);
  } catch { return false; }
}

/* ---------- traces ---------- */

const traces = new Map(); // id -> [{x,y}] for points, or [[{x,y}...]] outlines for other objects
function toggleTrace(o) {
  pushUndo();
  if (o.trace) { delete o.trace; traces.delete(o.id); } else o.trace = true;
  changed();
  toast(o.trace ? 'Tracing on — move it (or its slider) to leave a trail' : 'Tracing off');
}
function recordTraces() {
  for (const o of doc.objects) {
    if (!o.trace || o.hidden || o.collapsed) continue;
    let t = traces.get(o.id);
    if (!t) traces.set(o.id, (t = []));
    if (o.type === 'point') {
      const last = t[t.length - 1];
      if (!last || Math.hypot(last.x - o.x, last.y - o.y) * view.scale > 1.5) { if (last && Math.hypot(last.x - o.x, last.y - o.y) * view.scale > 80) t.push(null); t.push({ x: o.x, y: o.y }); }
      if (t.length > 6000) t.splice(0, t.length - 6000);
    } else {
      const pts = o.type === 'shape' ? G.outline(o, 90) : objPoints(o);
      const last = t[t.length - 1];
      if (!last || Math.hypot(last[0].x - pts[0].x, last[0].y - pts[0].y) * view.scale > 6) t.push(pts);
      if (t.length > 400) t.shift();
    }
  }
}
function drawTraces(T) {
  for (const [id, t] of traces) {
    const o = byId(id);
    if (!o || !o.trace || !t.length) continue;
    const col = o.style?.stroke || T.sel;
    ctx.setLineDash([]);
    if (o.type === 'point') {
      ctx.beginPath();
      let pen = false;
      for (const w of t) { if (!w) { pen = false; continue; } const p = W2S(w); if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); pen = true; }
      ctx.strokeStyle = hexA(col, 0.7); ctx.lineWidth = 2; ctx.stroke();
    } else {
      ctx.strokeStyle = hexA(col, 0.22); ctx.lineWidth = 1;
      for (const pts of t) { ctx.beginPath(); pts.map(W2S).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (o.type === 'shape') ctx.closePath(); ctx.stroke(); }
    }
  }
}
function clearTraces() { traces.clear(); requestRender(); toast('Traces cleared'); }

/* ---------- locus ---------- */

// The dependency-only part of syncAll (no links), used while sweeping a driver.
function syncCore() {
  syncParams();
  applyBindings();
  for (let pass = 0; pass < 2; pass++) for (const o of doc.objects) if (o.cons) applyCons(o);
}
function locusDriverRange(drv) {
  if (drv.type === 'slider') return [drv.min, drv.max];
  const A = byId(drv.cons?.s?.[0]);
  if (!A) return null;
  if (A.type === 'func') return [S2W({ x: 0, y: 0 }).x, S2W({ x: cw, y: 0 }).x];
  if (A.type === 'line') return A.ext === 'segment' ? [0, 1] : [-3, 4];
  if (A.type === 'shape' && A.kind === 'polygon') return [0, 1];
  if (A.type === 'shape') return [0, A.kind === 'semi' ? Math.PI : G.TAU];
  return null;
}
const locusCache = new Map();
let inLocus = false;
function locusPath(L) {
  const pt = byId(L.pt), drv = byId(L.drv);
  if (!pt || !drv || inLocus) return null;
  const getV = () => (drv.type === 'slider' ? drv.value : drv.cons?.t0);
  const setV = (v) => { if (drv.type === 'slider') drv.value = v; else drv.cons.t0 = v; };
  const v0 = getV();
  if (v0 == null) return null;
  setV(0);
  const key = JSON.stringify(doc.objects) + (byId(drv.cons?.s?.[0])?.type === 'func' ? `${view.cx},${view.scale},${cw}` : '');
  setV(v0);
  const hit = locusCache.get(L.id);
  if (hit && hit.key === key) return hit.path;
  const range = locusDriverRange(drv);
  if (!range) return null;
  inLocus = true;
  const path = [];
  try {
    const N = 300;
    for (let i = 0; i <= N; i++) {
      setV(range[0] + ((range[1] - range[0]) * i) / N);
      syncCore();
      path.push(pt.collapsed || !isFinite(pt.x) || !isFinite(pt.y) ? null : { x: pt.x, y: pt.y });
    }
  } finally {
    setV(v0);
    syncCore();
    inLocus = false;
  }
  locusCache.set(L.id, { key, path });
  return path;
}
function locusMenu(o) {
  const items = [];
  for (const s of doc.objects.filter((x) => x.type === 'slider')) items.push({ label: `As slider ${s.name} moves`, action: () => createLocus(o, s) });
  for (const g of doc.objects.filter((x) => x.type === 'point' && x.cons?.k === 'onObj' && x.id !== o.id)) items.push({ label: `As point ${g.label || '(glider)'} slides`, action: () => createLocus(o, g) });
  if (!items.length) items.push({ label: 'Needs a slider or a point sliding on an object', disabled: true });
  return items;
}
function createLocus(pt, drv) {
  pushUndo();
  const L = { id: uid(), type: 'locus', pt: pt.id, drv: drv.id, style: { stroke: S.measureColor, width: 2.5, dash: 'solid' } };
  doc.objects.push(L);
  setSelection([L.id]); changed();
  toast('Locus drawn — the path the point follows');
}

// Rebuild everything that depends on something else: slider values, links, constructions.
const linkMem = new Map();
function syncAll() {
  if (inLocus) return;
  syncParams();
  applyBindings();
  const links = doc.objects.filter((o) => o.type === 'link' && !o.off);
  if (links.length) {
    const busy = !drag ? null : drag.mode === 'vertex' ? { id: drag.id, vertex: drag.i } : drag.mode === 'lineEnd' ? { id: drag.id, end: drag.end } : drag.mode === 'anglePt' ? { id: drag.id, k: drag.k } : null;
    const { invalid, touched } = LK.solveLinks(links, byId, linkMem, busy);
    if (invalid.length) doc.objects = doc.objects.filter((o) => !invalid.includes(o.id));
    for (const id of touched) if (byId(id)?.type === 'shape') updateInscribed(id);
  }
  // derivatives follow their function
  for (const o of doc.objects) {
    if (o.type !== 'func' || !o.derivOf) continue;
    const src = byId(o.derivOf);
    if (!src) { if (o.numeric) o.hidden = true; delete o.derivOf; continue; }
    if (!o.numeric && o._src !== src.expr) {
      const t = derivOrNumericText(src);
      if (t) { o.expr = t; o._src = src.expr; } else { o.numeric = true; }
    }
  }
  // integrals whose functions are gone disappear
  if (doc.objects.some((o) => o.type === 'integral' && (!byId(o.f) || (o.g && !byId(o.g))))) doc.objects = doc.objects.filter((o) => o.type !== 'integral' || (byId(o.f) && (!o.g || byId(o.g))));
  // regions whose shapes are gone disappear
  if (doc.objects.some((o) => o.type === 'region' && (!byId(o.a) || !byId(o.b)))) doc.objects = doc.objects.filter((o) => o.type !== 'region' || (byId(o.a) && byId(o.b)));
  syncAngleAttachments();
  if (!S.liveConstructions) return;
  for (let pass = 0; pass < 2; pass++) for (const o of doc.objects) if (o.cons) applyCons(o);
  syncAngleAttachments();
}

// f′ as a compiled function when it can be worked out exactly (cached per expression).
const derivFnCache = new Map();
function exactDerivFn(o) {
  if (!o || (o.mode && o.mode !== 'func') || (o.derivOf && o.numeric)) return null;
  const key = o.expr + '|' + Object.keys(params).sort().join('');
  if (!derivFnCache.has(key)) { const t = derivOrNumericText(o); let fn = null; try { fn = t ? compile(t, params) : null; } catch { fn = null; } derivFnCache.set(key, fn); if (derivFnCache.size > 200) derivFnCache.clear(); }
  return derivFnCache.get(key);
}
function derivOrNumericText(src) {
  if (!src || (src.mode && src.mode !== 'func')) return null;
  if (src.derivOf && src.numeric) return null;
  try { const t = derivativeText(src.expr, 'x', params); compile(t, params); return t; } catch { return null; }
}

function addConstruction(objs, msg) {
  objs = objs.filter(Boolean);
  if (!objs.length) return;
  pushUndo();
  // add first, so constructions built on each other (a tangent on its own point) can find their sources
  doc.objects.push(...objs);
  for (let pass = 0; pass < 2; pass++) for (const o of objs) if (o.cons) applyCons(o);
  if (!S.liveConstructions) for (const o of objs) if (o.cons?.k !== 'onObj') delete o.cons;
  setSelection(objs.map((o) => o.id));
  changed();
  toast(msg + (S.liveConstructions ? ' — it follows the shape' : ''));
}

function triangleMenu(o) {
  const T = G.polyWorld(o);
  const k = C.triangleCenters(T);
  const s = [o.id];
  const center = (c, color) => cPoint({ k: 'tcenter', s, c }, c, color);
  return [
    { label: 'Medians + centroid G', action: () => addConstruction([0, 1, 2].map((i) => cLine({ k: 'median', s, i })).concat(center('G', '#34d399')), 'Medians meet at the centroid G') },
    { label: 'Altitudes + orthocenter H', action: () => {
      const objs = [];
      for (let i = 0; i < 3; i++) { objs.push(cLine({ k: 'altitude', s, i })); const e = cLine({ k: 'altExt', s, i }); e.style.dash = 'dotted'; objs.push(e); }
      objs.push(center('H', '#f87171'));
      addConstruction(objs, 'Altitudes meet at the orthocenter H');
    } },
    { label: 'Angle bisectors + incenter I', action: () => addConstruction([0, 1, 2].map((i) => cLine({ k: 'bisector', s, i })).concat(center('I', '#fbbf24')), 'Angle bisectors meet at the incenter I') },
    { label: 'Perpendicular bisectors + circumcenter O', action: () => addConstruction([0, 1, 2].map((i) => cLine({ k: 'perpbis', s, i })).concat(center('O', '#60a5fa')), 'Perpendicular bisectors meet at the circumcenter O') },
    '-',
    { label: 'Circumcircle', action: () => addConstruction([cCircle({ k: 'circum', s }), center('O', '#60a5fa')], `Circumcircle: R = ${fmtLen(k.R)}`) },
    { label: 'Incircle', action: () => addConstruction([cCircle({ k: 'incircle', s }, '#fbbf24'), center('I', '#fbbf24')], `Incircle: r = ${fmtLen(k.r)}`) },
    { label: 'Nine-point circle', action: () => addConstruction([cCircle({ k: 'ninept', s }, '#a78bfa'), center('N', '#a78bfa')], `Nine-point circle: radius ${fmtLen(k.nr)} (half of R)`) },
    { label: 'Euler line (O, G, H)', action: () => {
      if (!k.O || G.dist(k.O, k.H) < 1e-9 * Math.max(1, k.R)) { toast('In an equilateral triangle O, G and H are the same point — there is no Euler line', true); return; }
      addConstruction([cLine({ k: 'euler', s }, '#f472b6', 'line'), center('O', '#60a5fa'), center('G', '#34d399'), center('H', '#f87171')], 'Euler line passes through O, G and H');
    } },
    { label: 'All four centers', action: () => addConstruction([center('G', '#34d399'), center('O', '#60a5fa'), center('I', '#fbbf24'), center('H', '#f87171')], 'Centroid G, circumcenter O, incenter I, orthocenter H') },
  ];
}

function constructionsMenu(o) {
  const s = [o.id];
  if (o.type === 'line') {
    const a = { x: o.x1, y: o.y1 }, b = { x: o.x2, y: o.y2 };
    const m = midOf(a, b);
    return [
      { label: 'Midpoint', action: () => addConstruction([cPoint({ k: 'lmid', s }, 'M')], `Midpoint (${fmtNum(m.x)}, ${fmtNum(m.y)})`) },
      { label: 'Perpendicular bisector', action: () => addConstruction([cLine({ k: 'lperpbis', s }, null, 'line'), cPoint({ k: 'lmid', s }, 'M')], 'Perpendicular bisector') },
      { label: 'Parallel line through a point…', action: () => startPick('point', 'Click the point the parallel line should pass through', (p) => addConstruction([cLine({ k: 'lpar', s, p }, null, 'line')], 'Parallel line added')) },
      { label: 'Perpendicular line through a point…', action: () => startPick('point', 'Click the point the perpendicular line should pass through', (p) => {
        const f = C.footOnLine(p, a, b);
        addConstruction([cLine({ k: 'lperp', s, p }, null, 'line'), cPoint({ k: 'lfoot', s, p }, 'F')], `Perpendicular line added (distance ${fmtLen(Math.hypot(f.x - p.x, f.y - p.y))})`);
      }) },
      '-',
      { label: 'Distance to a point…', action: () => startPick('point', 'Click the point to measure the distance from', (p, pid) => {
        const d = cLine({ k: 'dist', s: pid ? [o.id, pid] : s, p }, S.measureColor);
        d.showLen = true;
        addConstruction([d], `Distance: ${fmtLen(G.dist(p, C.footOnLine(p, a, b)))}`);
      }) },
      { label: 'Angle with another line…', action: () => startPick('line', 'Click the other line', (l2) => {
        if (l2.id === o.id) { toast('Pick a different line', true); return; }
        const g = { id: uid(), type: 'angle', ax: 0, ay: 0, vx: 0, vy: 0, bx: 0, by: 0, style: { stroke: S.angleColor, width: 2, dash: 'solid' }, reflex: false, name: '', cons: { k: 'lineAngle', s: [o.id, l2.id] } };
        applyCons(g);
        if (g.collapsed) { toast('Those lines are parallel — the angle between them is 0°', true); return; }
        addConstruction([g], `Angle between the lines: ${fmtAng(angleValue(g))}`);
      }) },
      '-',
      { label: 'Circle with this diameter', action: () => addConstruction([cCircle({ k: 'ldiam', s })], 'Circle on diameter') },
      { label: 'Circle with this radius (center at start)', action: () => addConstruction([cCircle({ k: 'lrad', s })], 'Circle added') },
      { label: 'Square on this segment', action: () => addConstruction([cPoly({ k: 'lsquare', s }, 4, 'Square')], 'Square built on the segment') },
      { label: 'Equilateral triangle on this segment', action: () => addConstruction([cPoly({ k: 'ltri', s }, 3, '')], 'Equilateral triangle built on the segment') },
    ];
  }
  if (o.type === 'point') {
    const pickPt = (hint, fn) => () => startPick('point', hint, (p, pid) => { if (!pid) { toast('Click an existing point (it turns into a snap target)', true); return; } if (pid === o.id) { toast('Pick a different point', true); return; } fn(pid); });
    return [
      { label: 'Segment to another point…', action: pickPt('Click the other point', (pid) => { const l = cLine({ k: 'seg2', s: [o.id, pid] }, S.lineColor); l.style = lineStyle(); addConstruction([l], 'Segment between the points — move either point and it follows'); }) },
      { label: 'Line through another point…', action: pickPt('Click the other point', (pid) => { const l = cLine({ k: 'seg2', s: [o.id, pid] }, S.lineColor, 'line'); l.style = lineStyle(); addConstruction([l], 'Line through both points'); }) },
      { label: 'Circle centered here, through a point…', action: pickPt('Click a point on the circle', (pid) => { const c0 = cCircle({ k: 'circ2', s: [o.id, pid] }, S.shapeStroke); c0.style = shapeStyle(); addConstruction([c0], 'Circle — drag either point to resize it'); }) },
      { label: 'Midpoint with another point…', action: pickPt('Click the other point', (pid) => addConstruction([cPoint({ k: 'mid2', s: [o.id, pid] }, 'M')], 'Midpoint')) },
      ...(o.cons || o.bind ? [{ label: 'Locus (path) as something moves…', sub: locusMenu(o) }] : []),
      { label: o.trace ? 'Stop tracing' : 'Trace (leave a trail)', action: () => toggleTrace(o) },
      '-',
      { label: 'Distance to a line…', action: () => startPick('line', 'Click the line to measure the distance to', (l) => {
      const d = cLine({ k: 'dist', s: [l.id, o.id] }, S.measureColor);
      d.showLen = true;
      applyCons(d);
      addConstruction([d], `Distance: ${fmtLen(Math.hypot(d.x2 - d.x1, d.y2 - d.y1))}`);
    }) }];
  }
  if (o.type === 'angle') return [{ label: 'Angle bisector', action: () => addConstruction([cLine({ k: 'abis', s })], `Bisector splits it into two ${fmtAng(angleValue(o) / 2)} angles`) }];
  if (o.type !== 'shape') return [];
  if (o.kind !== 'polygon') {
    const circle = G.isCircle(o);
    const items = [
      { label: 'Center point', action: () => addConstruction([cPoint({ k: 'ecenter', s }, 'C')], 'Center point') },
      { label: circle ? 'Diameters (horizontal & vertical)' : 'Major & minor axes', action: () => addConstruction([cLine({ k: 'eaxis', s, i: 0 }), cLine({ k: 'eaxis', s, i: 1 })], 'Axes added') },
      '-',
      { label: 'Tangent lines from a point…', action: () => startPick('point', 'Click a point outside the curve', (p) => {
        const r = C.tangentsFrom(C.ellipseOf(o), p);
        if (r.inside) { toast('That point is inside — tangent lines only come from points outside', true); return; }
        const objs = [];
        r.points.forEach((q, i) => { objs.push(cLine({ k: 'tanFrom', s, p, i }, S.measureColor)); objs.push(cPoint({ k: 'tanPt', s, p, i }, i ? 'T₂' : 'T₁', S.measureColor)); });
        const len = r.points.length ? G.dist(p, r.points[0]) : 0;
        addConstruction(objs, r.points.length === 2 ? `Two tangents, each ${fmtLen(len)} long to the curve` : 'Tangent added');
      }) },
      { label: 'Tangent at a point on the curve…', action: () => startPick('point', 'Click on the curve where the tangent should touch', (p) => addConstruction([cLine({ k: 'tanAt', s, p }, S.measureColor, 'line')], 'Tangent line added')) },
    ];
    if (o.kind === 'ellipse') {
      items.push({ label: 'Arc, sector or chord…', action: () => arcDialog(o) });
      items.push({ label: circle ? 'Circumscribed square' : 'Circumscribed rectangle', action: () => {
        const q = cPoly({ k: 'ebox', s }, 4, circle ? 'Square' : 'Rectangle', S.constructColor);
        q.style = { ...q.style, fillAlpha: 0, dash: S.constructDash };
        addConstruction([q], 'Circumscribed around the ' + shapeName(o).toLowerCase());
      } });
    }
    return items;
  }
  const W = G.polyWorld(o);
  const n = W.length;
  const items = n === 3 ? [{ header: 'Triangle' }, ...triangleMenu(o), '-', { header: 'Any polygon' }] : [];
  if (n >= 4) items.push({ label: `Diagonals (${(n * (n - 3)) / 2})`, action: () => {
    const objs = [];
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) objs.push(cLine({ k: 'diag', s, i, j }));
    addConstruction(objs, `${objs.length} diagonals`);
  } });
  items.push(
    { label: 'Side midpoints', action: () => addConstruction(W.map((_, i) => cPoint({ k: 'sidemid', s, i })), 'Midpoints of every side') },
    { label: 'Corner points (A, B, C…)', action: () => addConstruction(W.map((_, i) => cPoint({ k: 'corner', s, i }, LETTERS(i))), 'Corner points added') },
    { label: 'Center point (centroid)', action: () => addConstruction([cPoint({ k: 'centroid', s }, 'G')], 'Centroid added') },
    { label: 'Smallest enclosing circle', action: () => {
      const m = C.minEnclosingCircle(W);
      const cyclic = W.every((p) => Math.abs(Math.hypot(p.x - m.x, p.y - m.y) - m.r) <= 1e-7 * m.r);
      addConstruction([cCircle({ k: 'mec', s }), cPoint({ k: 'mecCenter', s }, 'O')], cyclic ? `Circumscribed circle through every corner: R = ${fmtLen(m.r)}` : `Smallest enclosing circle: R = ${fmtLen(m.r)} (no circle passes through all corners)`);
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
  const objs = selected().filter((o) => !['func', 'link', 'region', 'slider'].includes(o.type) && !o.locked);
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
  for (const o of objs) if (o.cons && !o.cons.s.every((id) => ids.has(id))) delete o.cons;
  for (const o of objs) {
    if (o.type === 'shape') {
      const newRot = ((rotMap(o.rot, o) % G.TAU) + G.TAU) % G.TAU;
      if (o.kind === 'polygon') { const W = G.polyWorld(o).map(T); o.rot = newRot; G.setPolyFromWorld(o, W); }
      else { const q = T({ x: o.cx, y: o.cy }); o.cx = q.x; o.cy = q.y; o.rot = newRot; o.w *= k; o.h *= k; }
      if (o.inscribed && !ids.has(o.inscribed.parent)) detach(o);
    } else if (o.type === 'line') {
      const p1 = T({ x: o.x1, y: o.y1 }), p2 = T({ x: o.x2, y: o.y2 });
      Object.assign(o, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    } else if (o.type === 'arc') {
      const q = T({ x: o.cx, y: o.cy }); o.cx = q.x; o.cy = q.y;
      if (spec.type === 'rotate') o.rot += spec.angle;
      else if (spec.type === 'reflect') { o.rot = 2 * spec.phi - o.rot; o.t0 = -(o.t0 + o.sweep); }
      else if (spec.type === 'scale') { o.rx *= k; o.ry *= k; }
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
    link: 'Click two sides or lines (or two angles — click inside a corner), then choose Equal, Parallel or Perpendicular',
    measure: 'Drag between two points to measure distance and angle',
  }[tool];
}
function setHint(t) { $('#hint').textContent = S.showHints ? t : ''; }
function setTool(t) {
  if (puzzle && (t === 'measure' || t === 'angle')) { toast('Measuring tools are off during the daily puzzle', true); t = 'select'; }
  tool = t;
  draft = null; snapHint = null;
  linkPicks = []; linkHover = null;
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
  $('#hudCoords').textContent = S.showCoords && wp && !puzzle ? `x ${wp.x.toFixed(S.decimals)}  y ${wp.y.toFixed(S.decimals)}` : '';
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
let menuJustOpened = false; // a menu opened by a pointerdown must survive that same event
let menuGuardUntil = 0; // after a touch long-press, ignore the "click" the lifting finger produces
function showMenu(items, x, y) {
  menuJustOpened = true;
  setTimeout(() => { menuJustOpened = false; }, 0);
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
      row.addEventListener('click', () => { if (performance.now() >= menuGuardUntil) open(); });
    } else {
      row.addEventListener('mouseenter', () => { if (root === menuEl) $$('.ctxmenu.sub').forEach((s) => s.remove()); $$('.mi.open', root).forEach((m) => m.classList.remove('open')); });
      row.addEventListener('click', () => { if (performance.now() < menuGuardUntil) return; hideMenu(); it.action?.(); });
    }
    root.append(row);
  }
}
function hideMenu() { menuEl.hidden = true; $$('.ctxmenu.sub').forEach((s) => s.remove()); }
document.addEventListener('pointerdown', (e) => { if (!menuJustOpened && !e.target.closest('.ctxmenu')) hideMenu(); });
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
  if (puzzle) {
    if (o.puzzle) return [{ header: 'Part of the puzzle' }, { label: 'Constructions', sub: constructionsMenu(o).filter((it) => it === '-' || it.header || !/distance|angle with|circumscribed|smallest/i.test(it.label || '')) }];
    return objectMenuFull(o).filter((it) => it === '-' || it.header || !/^(Set |Scale|Snap points|Overlap|Links)/.test(it.label || ''));
  }
  return objectMenuFull(o);
}
function objectMenuFull(o) {
  const common = [
    '-',
    ...(['shape', 'line', 'angle', 'arc'].includes(o.type) ? [{ label: o.trace ? 'Stop tracing' : 'Trace (leave a trail)', action: () => toggleTrace(o) }] : []),
    ...(traces.size ? [{ label: 'Clear all traces', action: clearTraces }] : []),
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
  if (sel.length > 1) {
    const shapes = selected().filter((x) => x.type === 'shape');
    const two = selected().filter((x) => !['point', 'text', 'slider', 'link', 'region', 'integral'].includes(x.type));
    if (two.length === 2) common.splice(1, 0, { label: 'Intersection points', action: () => makeIntersections(two[0], two[1]) });
    const extra = shapes.length === 2 ? [{ label: 'Overlap of the two shapes', sub: REGION_OPS.map(([k, l]) => ({ label: l, action: () => createRegion(shapes[0], shapes[1], k) })) }] : [];
    return [{ header: `${sel.length} objects` }, ...extra, ...common.slice(1)];
  }
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
    if (poly) items.push({ label: 'Links (equal / parallel)', sub: linksMenu(o) });
    items.push({ label: 'Overlap with another shape…', action: () => startPick('shape', 'Click the other shape', (b) => { if (b.id === o.id) toast('Pick a different shape', true); else regionMenuFor(o, b); }) });
    items.push({ html: `<span class="snap-dot"></span>Snap points… <span class="muted">(${o.snapN})</span>`, action: () => snapDialog(o) });
    items.push({ label: 'Style…', action: () => styleDialog(o) });
    if (o.inscribed) items.push({ label: 'Detach from parent', action: () => { pushUndo(); detach(o); changed(); } });
    return [...items, ...common];
  }
  if (o.type === 'line') {
    return [{ header: shapeName(o) }, { label: 'Set length & angle…', action: () => lineDialog(o) }, { label: 'Constructions & measuring', sub: constructionsMenu(o) }, { label: 'Links (equal / parallel)', sub: linksMenu(o) }, { label: 'Style…', action: () => styleDialog(o) },
      { label: 'Type', sub: [['segment', 'Segment'], ['ray', 'Ray'], ['line', 'Infinite line']].map(([k, l]) => ({ label: (o.ext === k ? '✓ ' : '') + l, action: () => { pushUndo(); o.ext = k; changed(); } })) },
      { label: 'Arrowheads', sub: [['none', 'None'], ['end', 'End'], ['both', 'Both ends']].map(([k, l]) => ({ label: (o.arrows === k ? '✓ ' : '') + l, action: () => { pushUndo(); o.arrows = k; changed(); } })) },
      ...common];
  }
  if (o.type === 'text') return [{ header: 'Text' }, { label: 'Edit text…', action: () => editText(o) }, ...common];
  if (o.type === 'angle') return [{ header: shapeName(o) }, { label: o.reflex ? 'Show the smaller angle' : `Show the reflex angle (${fmtAng(360 - angleValue(o))})`, action: () => { pushUndo(); o.reflex = !o.reflex; changed(); } }, ...constructionsMenu(o), { label: 'Style…', action: () => styleDialog(o) }, ...common];
  if (o.type === 'point') return [{ header: 'Point' }, { label: 'Label…', action: () => pointLabelDialog(o) }, ...constructionsMenu(o), ...common];
  if (o.type === 'link') return [{ header: LK.linkLabel(o) }, { label: o.off ? 'Turn on' : 'Pause (stop enforcing)', action: () => { pushUndo(); o.off = !o.off; changed(); } }, { label: 'Remove link', danger: true, action: () => { pushUndo(); doc.objects = doc.objects.filter((x) => x !== o); sel = sel.filter((i) => i !== o.id); changed(); } }];
  if (o.type === 'region') return [{ header: shapeName(o) }, { label: 'Type', sub: REGION_OPS.map(([k, l]) => ({ label: (o.op === k ? '✓ ' : '') + l, action: () => { pushUndo(); o.op = k; changed(); } })) }, { label: o.hatch ? 'Solid fill' : 'Hatched fill', action: () => { pushUndo(); o.hatch = !o.hatch; changed(); } }, { label: 'Style…', action: () => styleDialog(o) }, ...common.slice(3)];
  if (o.type === 'arc') return [{ header: shapeName(o) }, { label: 'Radius, angle & arc length…', action: () => arcEditDialog(o) }, { label: 'Type', sub: [['arc', 'Arc'], ['sector', 'Sector'], ['segment', 'Segment']].map(([k, l]) => ({ label: (o.mode === k ? '✓ ' : '') + l, action: () => { pushUndo(); o.mode = k; changed(); } })) }, { label: 'Style…', action: () => styleDialog(o) }, ...common];
  if (o.type === 'func') {
    const setDash = (d) => () => { pushUndo(); o.style.dash = d; changed(); };
    const calc = !o.mode || o.mode === 'func' ? [{ label: 'Calculus', sub: calculusMenu(o) }] : [];
    return [{ header: funcText(o) }, ...calc,
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
    if (o.hidden || o.collapsed) continue;
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
    } else if (o.type === 'func' && !o.hidden && o.mode && o.mode !== 'func') {
      const g = graphGeom(o);
      if (!g) continue;
      const op = (o.alpha ?? 1) < 1 ? ` stroke-opacity="${o.alpha}"` : '';
      if (g.runs) out.push(`<path d="${g.runs.map((r) => { const a = W2S({ x: r.x0, y: r.y1 }), b = W2S({ x: r.x1, y: r.y0 }); return `M${f(a.x)} ${f(a.y)}H${f(b.x)}V${f(b.y)}H${f(a.x)}Z`; }).join('')}" fill="${o.style.stroke}" fill-opacity="0.22"/>`);
      const d = [...(g.segs || []).map(([p, q]) => pathD([W2S(p), W2S(q)])), ...(g.curves || []).map((run) => pathD(run.map(W2S)))].join('');
      if (d) out.push(`<path d="${d}" fill="none" ${strokeAttr(g.strict ? { ...o.style, dash: 'dashed' } : o.style)}${op}/>`);
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
    } else if (o.type === 'arc' && !o.collapsed) {
      const pts = C.arcPoints(arcE(o), o.t0, o.sweep, 240).map(W2S);
      const d = o.mode === 'sector' ? pathD([W2S({ x: o.cx, y: o.cy }), ...pts], true) : pathD(pts, o.mode === 'segment');
      const fill = o.mode !== 'arc' && o.style.fillAlpha > 0 ? `fill="${o.style.fill}" fill-opacity="${o.style.fillAlpha}"` : 'fill="none"';
      out.push(`<path d="${d}" ${fill} ${strokeAttr(o.style)}/>`);
    } else if (o.type === 'region') {
      const A = byId(o.a), B = byId(o.b);
      if (!A || !B) continue;
      const pa = pathD(G.outline(A, 360).map(W2S), true), pb = pathD(G.outline(B, 360).map(W2S), true);
      const uidr = o.id.replace(/\W/g, '');
      const fill = `fill="${o.style.fill}"`;
      const all = `<rect width="100%" height="100%" fill="white"/>`;
      out.push(`<defs><clipPath id="ca${uidr}"><path d="${pa}"/></clipPath><mask id="mA${uidr}">${all}<path d="${pa}" fill="black"/></mask><mask id="mB${uidr}">${all}<path d="${pb}" fill="black"/></mask></defs>`);
      const op = o.style.fillAlpha;
      if (o.op === 'intersect') out.push(`<path d="${pb}" ${fill} fill-opacity="${op}" clip-path="url(#ca${uidr})"/>`);
      else if (o.op === 'union') out.push(`<g opacity="${op}"><path d="${pa}" ${fill}/><path d="${pb}" ${fill}/></g>`);
      else if (o.op === 'aminusb') out.push(`<path d="${pa}" ${fill} fill-opacity="${op}" mask="url(#mB${uidr})"/>`);
      else if (o.op === 'bminusa') out.push(`<path d="${pb}" ${fill} fill-opacity="${op}" mask="url(#mA${uidr})"/>`);
      else out.push(`<path d="${pa}" ${fill} fill-opacity="${op}" mask="url(#mB${uidr})"/><path d="${pb}" ${fill} fill-opacity="${op}" mask="url(#mA${uidr})"/>`);
    }
  }
  out.push('</svg>');
  const blob = new Blob([out.join('\n')], { type: 'image/svg+xml' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${(currentName || 'vertex-forge').replace(/[^\w-]+/g, '_')}.svg` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('SVG downloaded');
}

/* ---------- settings dialog ---------- */

function settingsDialog(query = '') {
  openDialog({
    title: 'Settings',
    wide: true,
    build(body) {
      const search = el('input', { class: 'search', type: 'search', placeholder: `Search ${SETTINGS_DEF.length} settings… (e.g. snap, exterior, decimal, color)`, autofocus: true, value: query });
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
    buttons: [{ label: 'Take the quick tour', onClick: () => { setTimeout(() => startTour(), 50); } }, { label: 'Close', primary: true }],
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

function integralProps(box, o) {
  $('#propsTitle').textContent = o.g ? 'Area between graphs' : 'Area under a curve';
  const lim = (key) => {
    const inp = el('input', { type: 'text', value: o[key], class: 'mono' });
    inp.addEventListener('change', () => { try { compileVars(inp.value, [], params); } catch (e) { toast(e.message, true); inp.value = o[key]; return; } pushUndo(); o[key] = inp.value.trim(); changed(); });
    return inp;
  };
  box.append(el('div', { class: 'prop-grid' }, field('From x =', lim('a')), field('To x =', lim('b'))), el('p', { class: 'muted tiny', text: 'Slider letters work, e.g. a — then drag the slider to move the edge.' }));
  box.append(el('div', { style: 'height:8px' }), styleEditor(o));
  const m = integralValue(o);
  const kv = el('dl', { class: 'kv' });
  kv.append(el('dt', { text: o.g ? '∫ (f − g) dx' : '∫ f(x) dx' }), el('dd', { text: m.error ? m.error : fmtNum(m.value) }));
  if (!m.error && !o.g) {
    // total shaded area counts parts below the axis as positive
    const F = byId(o.f), f = fnOf(F);
    try { const abs = GR.integrate((x) => Math.abs(f(x)), m.a, m.b); if (Math.abs(abs - Math.abs(m.value)) > 1e-9) kv.append(el('dt', { text: 'Total shaded area' }), el('dd', { text: fmtNum(abs) })); } catch { /* skip */ }
  }
  box.append(kv, el('div', { class: 'row-btns' }, el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
}
function graphProps(box, o, title) {
  title.textContent = { implicit: 'Curve', ineq: 'Inequality', param: 'Parametric curve', polar: 'Polar curve' }[o.mode] || 'Graph';
  const inp = el('input', { type: 'text', value: o.text, spellcheck: false, class: 'mono', 'aria-label': 'Equation' });
  const err = el('div', { class: 'err' });
  inp.addEventListener('change', () => {
    let d;
    try { d = GR.classifyGraph(inp.value); if (d.mode === 'func') throw new Error('That’s a plain function — add it as y = … instead'); const miss = GR.unknownLetters(d, params); if (miss.length) throw new Error(`Unknown: ${miss.join(', ')} — add sliders for them`); GR.compileGraph(d, params); }
    catch (e) { err.textContent = e.message; inp.value = o.text; return; }
    err.textContent = '';
    pushUndo(); o.text = inp.value.trim(); o.mode = d.mode; changed();
  });
  const hint = { implicit: 'An equation in x and y, e.g. x^2 + y^2 = 9', ineq: 'Shaded where it’s true. < and > draw a dashed edge; ≤ and ≥ a solid one.', param: '(x(t), y(t)) — add “, t from 0 to 10” to set the range', polar: 'r in terms of θ (or t) — add “, θ from 0 to 4pi” to set the range' }[o.mode];
  box.append(el('label', { class: 'field' }, 'Equation', inp), err, el('p', { class: 'muted tiny', text: hint }));
  box.append(el('div', { style: 'height:8px' }), styleEditor(o));
  const aout = el('output', { text: Math.round((o.alpha ?? 1) * 100) + '%' });
  const alpha = el('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: o.alpha ?? 1 });
  alpha.addEventListener('input', () => { beginEdit(); o.alpha = +alpha.value; aout.textContent = Math.round(o.alpha * 100) + '%'; requestRender(); });
  alpha.addEventListener('change', () => { endEdit(); changed(); });
  const lab = el('input', { type: 'checkbox', checked: !!o.showLabel });
  lab.addEventListener('change', () => { pushUndo(); o.showLabel = lab.checked; changed(); });
  box.append(el('div', { class: 'prop-grid', style: 'margin-top:6px' }, field('Opacity', el('div', { class: 'inline' }, alpha, aout), 'full')), el('label', { class: 'chk-row' }, lab, 'Show the equation on the graph'),
    el('div', { class: 'row-btns' }, el('button', { text: o.hidden ? 'Show' : 'Hide', onclick: () => { pushUndo(); o.hidden = !o.hidden; changed(); } }), el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
}

function linkProps(box, o) {
  const seg = LK.isSegRef(o.refs[0]);
  const kinds = seg ? [['equal', 'Equal lengths'], ['parallel', 'Parallel'], ...(o.refs.length === 2 ? [['perp', 'Perpendicular']] : [])] : [['equalAngle', 'Equal angles']];
  const kindSel = el('select', {}, kinds.map(([k, l]) => el('option', { value: k, text: l, selected: o.kind === k })));
  kindSel.addEventListener('change', () => { pushUndo(); o.kind = kindSel.value; linkMem.delete(o.id); changed(); });
  const on = el('input', { type: 'checkbox', checked: !o.off });
  on.addEventListener('change', () => { pushUndo(); o.off = !on.checked; changed(); });
  box.append(el('p', { class: 'muted tiny', style: 'margin:0 0 8px', text: 'Linked items stay related: change one and the others follow. Their marks are drawn in the link color.' }),
    field('Relationship', kindSel, 'full'),
    el('label', { class: 'chk-row' }, on, 'Keep enforcing this link'));
  const list = el('div', { class: 'member-list' });
  o.refs.forEach((r, i) => list.append(el('button', { class: 'member', text: `${i + 1}. ${refName(r)}`, title: 'Show it', onclick: () => { if (S.objFlash) flashObject(r.o); } })));
  box.append(el('div', { class: 'tiny muted', style: 'margin-top:10px', text: 'Members' }), list,
    el('div', { class: 'row-btns' }, el('button', { class: 'danger', text: 'Remove link', onclick: () => { pushUndo(); doc.objects = doc.objects.filter((x) => x !== o); sel = []; changed(); } })));
}
function arcProps(box, o) {
  const mode = el('select', {}, [['arc', 'Arc'], ['sector', 'Sector (pie slice)'], ['segment', 'Segment (cut by a chord)']].map(([k, l]) => el('option', { value: k, text: l, selected: o.mode === k })));
  mode.addEventListener('change', () => { pushUndo(); o.mode = mode.value; changed(); });
  const circle = Math.abs(o.rx - o.ry) <= 1e-9 * Math.max(o.rx, o.ry);
  const arcLen = el('input', { type: 'text', inputmode: 'decimal', value: +arcMetrics(o).len.toFixed(6), title: 'Type an arc length (math works, e.g. 2pi) — the angle changes to fit' });
  arcLen.addEventListener('change', () => {
    const L = parseNum(arcLen.value);
    if (!(L > 0) || !circle) { toast(circle ? 'The arc length must be a positive number' : 'Arc length can be typed for circle sectors', true); arcLen.value = +arcMetrics(o).len.toFixed(6); return; }
    const sw = L / o.rx;
    if (sw > G.TAU + 1e-9) { toast(`That’s longer than the whole circle (${fmtLen(G.TAU * o.rx)}) — make the radius bigger first`, true); arcLen.value = +arcMetrics(o).len.toFixed(6); return; }
    pushUndo(); detach(o); o.sweep = Math.sign(o.sweep || 1) * sw; changed();
  });
  box.append(el('div', { class: 'prop-grid' },
    field('Type', mode, 'full'),
    ...(circle ? [field('Radius', liveNum(o.rx, (v) => { if (v > 0) { detach(o); o.rx = o.ry = v; } }, {}, { o, f: 'r' }))] : []),
    field('Angle °', liveNum(o.sweep / G.DEG, (v) => { if (Math.abs(v) <= 360 && v !== 0) { detach(o); o.sweep = v * G.DEG; } }, {}, { o, f: 'sweep' })),
    ...(circle ? [field('Arc length', arcLen)] : []),
    field('Start angle °', liveNum(o.t0 / G.DEG, (v) => { detach(o); o.t0 = v * G.DEG; }, {}, { o, f: 't0' }))));
  box.append(el('div', { style: 'height:10px' }), styleEditor(o));
  const m = arcMetrics(o);
  const kv = el('dl', { class: 'kv' });
  const add = (k, v) => kv.append(el('dt', { text: k }), el('dd', { text: v }));
  add('Central angle', fmtAng(m.deg)); add('Arc length', fmtLen(m.len, { approx: m.approx })); add('Chord', fmtLen(m.chord));
  if (m.area != null) add('Area', fmtArea(m.area, { approx: m.approx }));
  box.append(kv, el('div', { class: 'row-btns' }, el('button', { text: 'Radius, angle, arc…', onclick: () => arcEditDialog(o) }), el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
}
function regionProps(box, o) {
  const op = el('select', {}, REGION_OPS.map(([k, l]) => el('option', { value: k, text: l, selected: o.op === k })));
  op.addEventListener('change', () => { pushUndo(); o.op = op.value; changed(); });
  const hatch = el('input', { type: 'checkbox', checked: o.hatch });
  hatch.addEventListener('change', () => { pushUndo(); o.hatch = hatch.checked; changed(); });
  const A = byId(o.a), B = byId(o.b);
  box.append(field('Shade', op, 'full'), el('label', { class: 'chk-row' }, hatch, 'Hatched (striped) fill'), el('div', { style: 'height:8px' }), styleEditor(o));
  const m = regionMetrics(o);
  const kv = el('dl', { class: 'kv' });
  kv.append(el('dt', { text: 'Shape A' }), el('dd', { text: A ? shapeName(A) : '—' }), el('dt', { text: 'Shape B' }), el('dd', { text: B ? shapeName(B) : '—' }));
  if (m) kv.append(el('dt', { text: 'Area' }), el('dd', { text: fmtArea(m.area, { approx: m.approx }) }));
  box.append(kv);
  if (m?.approx) box.append(el('p', { class: 'muted tiny', text: '≈ Curved shapes overlap here, so the area is measured very precisely rather than exactly.' }));
  box.append(el('div', { class: 'row-btns' }, el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
}

// Arc / sector / segment / chord on a circle or ellipse, by angles or by picking two points.
function arcDialog(circle, init = {}) {
  const E = C.ellipseOf(circle);
  let mode, start, sweep, preview;
  const makeTmp = () => ({ mode: mode.value === 'chord' ? 'segment' : mode.value, cx: E.c.x, cy: E.c.y, rx: E.rx, ry: E.ry, rot: E.rot, t0: parseNum(start.value) * G.DEG, sweep: parseNum(sweep.value) * G.DEG });
  const update = () => {
    const t = makeTmp();
    if (!isFinite(t.t0) || !isFinite(t.sweep) || !t.sweep) { preview.textContent = ''; return; }
    const m = arcMetrics(t);
    preview.textContent = mode.value === 'chord' ? `Chord length ${fmtLen(m.chord)}` : `Arc length ${fmtLen(m.len, { approx: m.approx })}` + (mode.value !== 'arc' ? ` · area ${fmtArea(m.area, { approx: m.approx })}` : '');
  };
  openDialog({
    title: `Arc, sector or chord on the ${shapeName(circle).toLowerCase()}`,
    build(body, api) {
      mode = el('select', {}, [['sector', 'Sector (pie slice)'], ['arc', 'Arc (just the curve)'], ['segment', 'Segment (cut off by a chord)'], ['chord', 'Chord (straight line)']].map(([k, l]) => el('option', { value: k, text: l, selected: (init.mode || 'sector') === k })));
      start = el('input', { type: 'text', inputmode: 'decimal', value: init.t0 != null ? +(init.t0 / G.DEG).toFixed(6) : 0 });
      sweep = el('input', { type: 'text', inputmode: 'decimal', value: init.sweep != null ? +(init.sweep / G.DEG).toFixed(6) : 90 });
      preview = el('div', { class: 'muted tiny', style: 'margin-top:8px' });
      for (const x of [mode, start, sweep]) x.addEventListener('input', update);
      body.append(el('label', { class: 'field' }, 'Type', mode),
        el('div', { class: 'grid2', style: 'margin-top:8px' }, el('label', { class: 'field' }, 'Start angle (° from the right, counter-clockwise)', start), el('label', { class: 'field' }, 'Sweep (°, negative = clockwise)', sweep)),
        preview,
        el('div', { class: 'row-btns' }, el('button', { type: 'button', text: 'Pick two points on the curve instead…', onclick: () => {
          const m = mode.value;
          api.close();
          startPick('point', 'Click the first point on the curve', (p1) => startPick('point', 'Click the second point (the arc goes counter-clockwise)', (p2) => {
            const t0 = C.ellipseParam(E, p1), t1 = C.ellipseParam(E, p2);
            let sw = ((t1 - t0) % G.TAU + G.TAU) % G.TAU;
            if (sw < 1e-9) sw = G.TAU;
            arcDialog(circle, { mode: m, t0, sweep: sw });
          }));
        } })));
      update();
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Add', primary: true, onClick(api) {
        const t0 = parseNum(start.value) * G.DEG, sw = parseNum(sweep.value) * G.DEG;
        if (!isFinite(t0) || !isFinite(sw) || !sw || Math.abs(sw) > G.TAU + 1e-9) { api.setError('The sweep must be a non-zero angle up to 360°.'); return false; }
        if (mode.value === 'chord') {
          const l = cLine({ k: 'chord', s: [circle.id], t0, t1: t0 + sw }, S.arcColor);
          l.showLen = true; l.style.dash = 'solid'; l.style.width = 2.5;
          addConstruction([l], 'Chord added');
        } else {
          const o = { id: uid(), type: 'arc', mode: mode.value, cx: 0, cy: 0, rx: 1, ry: 1, rot: 0, t0, sweep: sw, style: { stroke: S.arcColor, width: 2.5, dash: 'solid', fill: S.arcColor, fillAlpha: mode.value === 'arc' ? 0 : 0.25 }, name: '', cons: { k: 'arc', s: [circle.id] } };
          const m = arcMetrics({ ...o, cx: E.c.x, cy: E.c.y, rx: E.rx, ry: E.ry, rot: E.rot });
          addConstruction([o], `${shapeName(o)}: arc ${fmtLen(m.len, { approx: m.approx })}${m.area != null ? ', area ' + fmtArea(m.area, { approx: m.approx }) : ''}`);
        }
        return true;
      },
    }],
  });
}
function arcEditDialog(o) {
  const circle = Math.abs(o.rx - o.ry) <= 1e-9 * Math.max(o.rx, o.ry);
  const f = {};
  const val = (x) => String(+x.toFixed(6));
  openDialog({
    title: `${shapeName(o)} — size`,
    build(body) {
      const inp = (k, v, label) => { f[k] = el('input', { type: 'text', inputmode: 'decimal', value: val(v) }); f[k].dataset.orig = f[k].value; return el('label', { class: 'field' }, label, f[k]); };
      body.append(el('p', { class: 'muted tiny', style: 'margin-top:0', text: circle ? 'Change any two of radius, angle and arc length — the third is worked out (arc length = radius × angle in radians). Math works: 2pi, sqrt(2).' : 'This arc sits on an oval, so only its angles can be set here.' }),
        el('div', { class: 'grid2' },
          ...(circle ? [inp('r', o.rx, 'Radius'), inp('len', arcMetrics(o).len, 'Arc length')] : []),
          inp('sweep', o.sweep / G.DEG, 'Angle (°)'), inp('t0', o.t0 / G.DEG, 'Start angle (°, from the right)')));
    },
    buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick(api) {
      const changedK = (k) => f[k] && f[k].value.trim() !== f[k].dataset.orig;
      const get = (k) => parseNum(f[k].value);
      let r = circle ? get('r') : o.rx, sw = get('sweep') * G.DEG, t0 = get('t0') * G.DEG;
      const L = circle ? get('len') : null;
      if (circle && changedK('len')) {
        if (!(L > 0)) { api.setError('The arc length must be positive.'); return false; }
        if (changedK('sweep') && !changedK('r')) r = L / Math.abs(sw); // angle + length → radius
        else sw = Math.sign(sw || 1) * (L / r); // length (+ radius) → angle
      }
      if (!(r > 0)) { api.setError('The radius must be positive.'); return false; }
      if (!isFinite(sw) || sw === 0 || Math.abs(sw) > G.TAU + 1e-9) { api.setError(circle && changedK('len') ? `That arc is longer than the whole circle (${fmtLen(G.TAU * r)}).` : 'The angle must be between 0° and 360°.'); return false; }
      if (!isFinite(t0)) { api.setError('The start angle must be a number.'); return false; }
      pushUndo(); detach(o);
      if (circle) { o.rx = o.ry = r; }
      o.sweep = sw; o.t0 = t0; changed();
      return true;
    } }],
  });
}

// Properties for a graphed function: expression, full line style, opacity, domain, label.
function funcProps(box, o, title) {
  if (o.mode && o.mode !== 'func') { graphProps(box, o, title); return; }
  title.textContent = o.derivOf ? 'Derivative' : 'Function';
  if (o.derivOf) box.append(el('div', { class: 'follow-row' }, el('span', { class: 'badge link', text: `⟲ Derivative of y = ${byId(o.derivOf)?.expr ?? '?'}` }), el('button', { class: 'btn', text: 'Detach', onclick: () => { pushUndo(); if (o.numeric) { o.expr = derivOrNumericText(byId(o.derivOf)); } delete o.derivOf; delete o.numeric; changed(); } })));
  const expr = el('input', { type: 'text', value: o.numeric ? '(numeric derivative)' : o.expr, spellcheck: false, class: 'mono', 'aria-label': 'Expression', disabled: !!o.derivOf });
  const err = el('div', { class: 'err' });
  expr.addEventListener('input', () => {
    const t = expr.value.trim().replace(/^y\s*=\s*/i, '');
    try { compile(t, params); err.textContent = ''; beginEdit(); o.expr = t; requestRender(); }
    catch (e) { err.textContent = e.unknown ? e.message + ' — add it with the + in Sliders' : e.message; }
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
// A number box. With `bind` = {o, f} it also accepts slider expressions (like 2a + 1), which then
// drive that value live.
function liveNum(value, apply, attrs = {}, bind = null) {
  if (!bind) {
    const inp = el('input', { type: 'number', step: 'any', value: +(+value).toFixed(6), ...attrs });
    inp.addEventListener('input', () => { const v = +inp.value; if (inp.value !== '' && isFinite(v)) { beginEdit(); apply(v); requestRender(); } });
    inp.addEventListener('change', () => { endEdit(); changed(); });
    return inp;
  }
  const bound = bind.o.bind?.[bind.f];
  const inp = el('input', { type: 'text', inputmode: 'decimal', value: bound ?? +(+value).toFixed(6), class: bound ? 'bound' : '', title: bound ? `Driven by sliders: ${bound}` : 'A number — or type an expression with a slider letter (e.g. 2a) to drive it with a slider' });
  inp.addEventListener('input', () => { const v = +inp.value; if (inp.value !== '' && isFinite(v) && !bind.o.bind?.[bind.f]) { beginEdit(); apply(v); requestRender(); } });
  inp.addEventListener('change', () => {
    endEdit();
    const t = inp.value.trim();
    if (!t) { inp.value = bind.o.bind?.[bind.f] ?? +(+value).toFixed(6); return; }
    // letters that aren't sliders yet become sliders (setting); anything using a slider becomes a binding
    let missing = [];
    try { compileVars(t, [], params); }
    catch (e) {
      if (!e.unknown) { toast(e.message, true); inp.value = bind.o.bind?.[bind.f] ?? +(+value).toFixed(6); return; }
      if (!S.autoSliders) { toast(e.message, true); return; }
      missing = e.unknown;
    }
    if (missing.length || usesSliders(t)) {
      pushUndo();
      for (const n of missing) doc.objects.push(newSlider(n));
      syncParams();
      bind.o.bind = { ...(bind.o.bind || {}), [bind.f]: t };
      detach(bind.o);
      changed();
      toast(`Now driven by ${missing.length ? 'new slider ' + missing.join(', ') : 'a slider'} — drag it to see`);
      return;
    }
    const v = parseNum(t);
    if (!isFinite(v)) { toast(`“${t}” isn’t a number`, true); inp.value = +(+value).toFixed(6); return; }
    pushUndo();
    if (bind.o.bind) { delete bind.o.bind[bind.f]; if (!Object.keys(bind.o.bind).length) delete bind.o.bind; }
    apply(v);
    changed();
  });
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

// Left-panel card: area (and friends) of whatever is selected, always visible.
function renderMeasure() {
  const body = $('#measureBody');
  if (!body) return;
  $('#measureSection').hidden = !S.showMeasureCard;
  if (!S.showMeasureCard) return;
  body.innerHTML = '';
  const what = $('#measureWhat');
  const rows = [];
  const add = (k, v, big) => rows.push(el('div', { class: `m-row${big ? ' big' : ''}` }, el('span', { text: k }), el('b', { text: v })));
  const objs = selected();
  const shapes = objs.filter((o) => o.type === 'shape');
  if (!objs.length) {
    const all = doc.objects.filter((o) => o.type === 'shape' && !o.hidden);
    what.textContent = '';
    if (!all.length) { body.append(el('p', { class: 'muted tiny', style: 'margin:0', text: 'Select a shape to see its area and perimeter here.' })); return; }
    add('Shapes on the graph', String(all.length));
    add('Total area', fmtArea(all.reduce((s, o) => s + G.area(o), 0)), true);
    body.append(...rows, el('p', { class: 'muted tiny', style: 'margin:6px 0 0', text: 'Select a shape for its own measurements.' }));
    return;
  }
  if (objs.length > 1) {
    what.textContent = `${objs.length} selected`;
    if (shapes.length) {
      add('Total area', fmtArea(shapes.reduce((s, o) => s + G.area(o), 0)), true);
      add('Total perimeter', fmtLen(shapes.reduce((s, o) => s + G.perimeter(o), 0)));
      if (shapes.length === 2) {
        const m = regionMetrics({ a: shapes[0].id, b: shapes[1].id, op: 'intersect' });
        if (m) add('Overlap area', fmtArea(m.area, { approx: m.approx }));
      }
    } else add('Shapes selected', '0');
    body.append(...rows);
    return;
  }
  const o = objs[0];
  what.textContent = shapeName(o).toLowerCase();
  if (o.type === 'shape') {
    add('Area', fmtArea(G.area(o)), true);
    add('Perimeter', fmtLen(G.perimeter(o)));
    if (o.kind === 'polygon') {
      add('Type', C.classify(o));
      const L = G.sideLengths(o);
      if (L.length <= 8) add('Sides', L.map((l) => fmtNum(l)).join(', '));
    } else {
      const { rx, ry } = G.ellipseRadii(o);
      if (G.isCircle(o)) { add('Radius', fmtLen(rx)); add('Diameter', fmtLen(2 * rx)); }
      else { add('Radii', `${fmtNum(rx)}, ${fmtNum(ry)}`); }
    }
  } else if (o.type === 'arc') {
    const m = arcMetrics(o);
    if (m.area != null) add('Area', fmtArea(m.area, { approx: m.approx }), true);
    add('Arc length', fmtLen(m.len, { approx: m.approx }), m.area == null);
    add('Central angle', fmtAng(m.deg));
  } else if (o.type === 'region') {
    const m = regionMetrics(o);
    if (m) add('Area', fmtArea(m.area, { approx: m.approx }), true);
  } else if (o.type === 'line') {
    add('Length', fmtLen(Math.hypot(o.x2 - o.x1, o.y2 - o.y1)), true);
    add('Equation', lineEquation(o));
  } else if (o.type === 'angle') {
    add('Angle', fmtAng(angleValue(o)), true);
  } else if (o.type === 'point') {
    add('Coordinates', `(${fmtNum(o.x)}, ${fmtNum(o.y)})`, true);
  } else {
    body.append(el('p', { class: 'muted tiny', style: 'margin:0', text: 'No area for this kind of object.' }));
    return;
  }
  body.append(...rows);
}

function renderProps() {
  renderMeasure();
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
  if (puzzle) {
    // no numbers during the daily puzzle — just styling
    if (o.puzzle) { box.append(el('p', { class: 'muted tiny', style: 'margin:0', text: 'Part of today’s puzzle. Draw, construct and graph on top of it to work out the answer.' })); return; }
    if (o.style) box.append(styleEditor(o));
    box.append(el('div', { class: 'row-btns' }, el('button', { class: 'danger', text: 'Delete', onclick: deleteSel })));
    return;
  }
  if (o.locked) {
    box.append(el('span', { class: 'badge', text: '🔒 Locked' }), el('p', { class: 'muted tiny', style: 'margin:0 0 8px', text: 'Locked objects can’t be moved, resized or deleted.' }),
      el('div', { class: 'row-btns' }, el('button', { class: 'primary', text: 'Unlock', onclick: () => toggleFlag(o, 'locked') })));
    return;
  }
  if (o.cons) {
    const srcs = o.cons.s.map(byId).filter(Boolean);
    box.append(el('div', { class: 'follow-row' }, el('span', { class: 'badge link', text: `⟲ Follows ${srcs.map((s) => shapeName(s).toLowerCase()).join(' & ')}` }),
      el('button', { class: 'btn', text: 'Detach', title: 'Stop following — keep it where it is', onclick: () => { pushUndo(); delete o.cons; changed(); } })));
  }
  if (o.bind) box.append(el('div', { class: 'follow-row' }, el('span', { class: 'badge link', text: `⚯ Driven by sliders: ${Object.entries(o.bind).map(([k, v]) => `${k} = ${v}`).join(', ').slice(0, 60)}` }), el('button', { class: 'btn', text: 'Unbind', onclick: () => { pushUndo(); delete o.bind; changed(); } })));
  if (o.type === 'link') { linkProps(box, o); return; }
  if (o.type === 'locus') { box.append(el('p', { class: 'muted tiny', text: `The path point ${byId(o.pt)?.label || ''} follows as ${byId(o.drv)?.type === 'slider' ? 'slider ' + byId(o.drv).name : 'its driving point'} moves through its whole range.` }), styleEditor(o), el('div', { class: 'row-btns' }, el('button', { class: 'danger', text: 'Delete', onclick: deleteSel }))); return; }
  if (o.type === 'integral') { integralProps(box, o); return; }
  if (o.type === 'arc') { arcProps(box, o); return; }
  if (o.type === 'region') { regionProps(box, o); return; }
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
      field('Center x', liveNum(o.cx, upd((v) => { o.cx = v; }), {}, { o, f: 'cx' })),
      field('Center y', liveNum(o.cy, upd((v) => { o.cy = v; }), {}, { o, f: 'cy' })),
      field('Width', liveNum(o.w, upd((v) => { if (v > 0) { if (S.lockAspect) o.h *= v / o.w; o.w = v; } }), { min: 0 }, { o, f: 'w' })),
      el('div', { class: 'field' }, el('span', { class: 'hlabel' }, 'Height', lockBtn()), liveNum(o.h, upd((v) => { if (v > 0) { if (S.lockAspect) o.w *= v / o.h; o.h = v; } }), { min: 0 }, { o, f: 'h' })),
      ...(o.kind !== 'polygon' && G.isCircle(o) ? [field('Radius', liveNum(G.ellipseRadii(o).rx, upd((v) => setField(o, 'r', v)), {}, { o, f: 'r' }))] : []),
      field('Rotation °', liveNum((o.rot / G.DEG) % 360, upd((v) => { o.rot = v * G.DEG; }), {}, { o, f: 'rot' })),
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
      field('x₁', liveNum(o.x1, (v) => { detach(o); o.x1 = v; }, {}, { o, f: 'x1' })), field('y₁', liveNum(o.y1, (v) => { detach(o); o.y1 = v; }, {}, { o, f: 'y1' })),
      field('x₂', liveNum(o.x2, (v) => { detach(o); o.x2 = v; }, {}, { o, f: 'x2' })), field('y₂', liveNum(o.y2, (v) => { detach(o); o.y2 = v; }, {}, { o, f: 'y2' })),
      field('Type', ext), field('Arrowheads', arr));
    const flag = (key, text) => { const c = el('input', { type: 'checkbox', checked: !!o[key] }); c.addEventListener('change', () => { pushUndo(); if (c.checked) o[key] = true; else delete o[key]; changed(); }); return el('label', { class: 'chk-row' }, c, text); };
    box.append(g, flag('showLen', 'Always show its length'), flag('showEq', 'Show its equation on the graph'), scaleRow(), el('div', { style: 'height:10px' }), styleEditor(o));
    const kv = el('dl', { class: 'kv' });
    kv.append(el('dt', { text: 'Length' }), el('dd', { text: fmtLen(L) }), el('dt', { text: 'Angle' }), el('dd', { text: fmtAng((Math.atan2(o.y2 - o.y1, o.x2 - o.x1) / G.DEG + 360) % 360) }));
    if (Math.abs(o.x2 - o.x1) > 1e-12) kv.append(el('dt', { text: 'Slope' }), el('dd', { text: fmtNum((o.y2 - o.y1) / (o.x2 - o.x1)) }));
    kv.append(el('dt', { text: 'Equation' }), el('dd', { text: lineEquation(o) }));
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
    box.append(el('div', { class: 'prop-grid' }, field('x', liveNum(o.x, (v) => { detach(o); o.x = v; }, {}, { o, f: 'x' })), field('y', liveNum(o.y, (v) => { detach(o); o.y = v; }, {}, { o, f: 'y' })), field('Label', lab, 'full')));
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

const GLYPH = { shape: '⬟', line: '╱', point: '•', text: 'T', angle: '∠', arc: '◠', region: '◩', link: '⛓', integral: '∫', locus: '∿' };
function renderObjList() {
  const list = $('#objList');
  if (!list) return;
  const focusIdx = list.contains(document.activeElement) ? [...list.children].indexOf(document.activeElement.closest('.obj-row')) : -1;
  queueMicrotask(() => { if (focusIdx >= 0) (list.children[focusIdx] || list.lastElementChild)?.focus?.(); });
  const objs = doc.objects.filter((o) => o.type !== 'func' && o.type !== 'slider');
  $('#objCount').textContent = objs.length ? `${objs.length}` : '';
  list.innerHTML = '';
  if (!objs.length) { list.append(el('div', { class: 'muted tiny', text: 'Nothing here yet — insert a shape or draw a line.' })); return; }
  const ordered = S.objNewestFirst ? objs.slice().reverse() : objs;
  for (const o of ordered.slice(0, 400)) {
    const nm = o.type === 'text' ? `“${o.text.slice(0, 24)}”` : o.type === 'point' && o.label ? `Point ${o.label}` : o.type === 'link' ? `${LK.linkLabel(o)}${o.off ? ' (paused)' : ''}` : shapeName(o) + (o.cons ? ' ⟲' : '');
    const row = el('div', { class: `obj-row${sel.includes(o.id) ? ' sel' : ''}${o.hidden ? ' hidden' : ''}${flash?.id === o.id ? ' flashing' : ''}`, title: o.inscribed ? 'Inscribed shape' : '', tabindex: 0, role: 'button', 'aria-label': `Select ${nm}` },
      el('span', { class: 'glyph', text: GLYPH[o.type] || '?', style: `color:${o.type === 'link' ? S.linkColor : o.type === 'region' ? o.style.fill : o.style?.stroke || 'inherit'}` }),
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
// Add y = expr. Letters like a, b, k become sliders automatically (setting). Returns an error message or null.
function addFunction(text) {
  text = text.trim();
  if (!text) return 'Type an expression in x (or an equation like x^2 + y^2 = 9)';
  let d;
  try { d = GR.classifyGraph(text); } catch (e) { return e.message; }
  if (d.mode !== 'func') return addGraph(text, d);
  let expr = d.expr;
  syncParams();
  let missing = [];
  try { compile(expr, params); }
  catch (err) {
    if (!err.unknown) return err.message;
    if (!S.autoSliders) return err.message + ' (or turn on “Make sliders automatically” in Settings)';
    missing = err.unknown;
    const tmp = { ...params };
    for (const n of missing) tmp[n] = 1;
    try { compile(expr, tmp); } catch (e2) { return e2.message; }
  }
  pushUndo();
  for (const n of missing) doc.objects.push(newSlider(n));
  const count = doc.objects.filter((o) => o.type === 'func').length;
  const o = { id: uid(), type: 'func', expr, style: { stroke: FUNC_COLORS[count % FUNC_COLORS.length], width: S.funcWidth, dash: S.funcDash }, hidden: false, alpha: 1, xMin: null, xMax: null, showLabel: S.funcLabels, endDots: false };
  doc.objects.push(o);
  setSelection([o.id]);
  changed();
  if (missing.length) toast(`Made slider${missing.length > 1 ? 's' : ''} ${missing.join(', ')} — drag ${missing.length > 1 ? 'them' : 'it'} (or type a value) to change the graph`);
  return null;
}
// Implicit curves, inequalities, parametric and polar curves.
function addGraph(text, d) {
  syncParams();
  let missing;
  try { missing = GR.unknownLetters(d, params); } catch (e) { return e.message; }
  if (missing.length && !S.autoSliders) return `Unknown name${missing.length > 1 ? 's' : ''} ${missing.join(', ')} (or turn on “Make sliders automatically” in Settings)`;
  const tmp = { ...params };
  for (const n of missing) tmp[n] = 1;
  try { GR.compileGraph(d, tmp); } catch (e) { return e.message; }
  pushUndo();
  for (const n of missing) doc.objects.push(newSlider(n));
  const count = doc.objects.filter((o) => o.type === 'func').length;
  const o = { id: uid(), type: 'func', mode: d.mode, text, expr: '', style: { stroke: FUNC_COLORS[count % FUNC_COLORS.length], width: S.funcWidth, dash: S.funcDash }, hidden: false, alpha: 1, xMin: null, xMax: null, showLabel: S.funcLabels, endDots: false };
  doc.objects.push(o);
  setSelection([o.id]);
  changed();
  const what = { implicit: 'Curve', ineq: 'Inequality (shaded where it’s true)', param: 'Parametric curve', polar: 'Polar curve' }[d.mode];
  toast(`${what} added${missing.length ? ` — sliders ${missing.join(', ')} made for you` : ''}`);
  return null;
}
$('#funcForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#funcInput');
  const err = addFunction(inp.value);
  $('#funcErr').textContent = err || '';
  if (!err) inp.value = '';
});
$('#funcInput').addEventListener('input', () => { $('#funcErr').textContent = ''; });

/* ======================= sliders ======================= */

function newSlider(name, value = 1, min = -10, max = 10) {
  if (!(max > min)) max = min + 1;
  return { id: uid(), type: 'slider', name, value: clamp(value, min, max), min, max, step: +((max - min) / 200).toPrecision(2) };
}
function freeSliderName() {
  const used = new Set(doc.objects.filter((o) => o.type === 'slider').map((o) => o.name));
  return 'abcdfghjkmnpqrstuvwz'.split('').find((c) => !used.has(c));
}
let sliderAnim = null; // {id, dir, last}
function renderSliders() {
  const box = $('#sliderList');
  if (!box) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'range') return;
  box.innerHTML = '';
  const sliders = doc.objects.filter((o) => o.type === 'slider');
  $('#sliderSection').hidden = !S.showFunctionsPanel;
  if (!sliders.length) { box.append(el('div', { class: 'muted tiny', text: 'Use letters like a or k in a function (e.g. a·sin(kx)) and sliders appear here — or press +.' })); return; }
  for (const o of sliders) {
    const valIn = el('input', { type: 'text', inputmode: 'decimal', class: 'mono', value: +o.value.toPrecision(8), 'aria-label': `Value of ${o.name}`, title: 'Type any value (math allowed, e.g. pi/2)' });
    const range = el('input', { type: 'range', min: o.min, max: o.max, step: 'any', value: o.value, 'aria-label': `Slider ${o.name}` });
    const setVal = (v, commit) => {
      if (!isFinite(v)) return;
      if (v < o.min) o.min = v;
      if (v > o.max) o.max = v;
      o.value = v;
      range.min = o.min; range.max = o.max; range.value = v;
      if (document.activeElement !== valIn) valIn.value = +v.toPrecision(8);
      requestRender();
      if (commit) changed();
    };
    range.addEventListener('input', () => { beginEdit(); setVal(+range.value); });
    range.addEventListener('change', () => { endEdit(); changed(); });
    valIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valIn.blur(); } });
    valIn.addEventListener('change', () => {
      const v = parseNum(valIn.value);
      if (!isFinite(v)) { toast(`“${valIn.value}” isn’t a number`, true); valIn.value = +o.value.toPrecision(8); return; }
      pushUndo(); setVal(v, true);
    });
    const play = el('button', { type: 'button', class: 'sl-btn', title: 'Animate', text: sliderAnim?.id === o.id ? '❚❚' : '▶' });
    play.addEventListener('click', () => { if (sliderAnim?.id === o.id) sliderAnim = null; else startSliderAnim(o); renderSliders(); });
    const more = el('div', { class: 'sl-more', hidden: !o._open });
    const lim = (key, label) => {
      const inp = el('input', { type: 'text', inputmode: 'decimal', value: +o[key].toPrecision(8), 'aria-label': `${label} of ${o.name}` });
      inp.addEventListener('change', () => {
        const v = parseNum(inp.value);
        if (!isFinite(v) || (key === 'step' && !(v > 0)) || (key === 'min' && v >= o.max) || (key === 'max' && v <= o.min)) { toast(`That ${label.toLowerCase()} doesn’t work here`, true); inp.value = +o[key].toPrecision(8); return; }
        pushUndo(); o[key] = v; o.value = clamp(o.value, o.min, o.max); changed();
      });
      return el('label', { class: 'field' }, label, inp);
    };
    more.append(lim('min', 'Min'), lim('max', 'Max'), lim('step', 'Step'));
    const gear = el('button', { type: 'button', class: 'sl-btn', title: 'Range & step', text: '⚙' });
    gear.addEventListener('click', () => { o._open = !o._open; more.hidden = !o._open; });
    const del = el('button', { type: 'button', class: 'sl-btn', title: 'Delete slider', text: '✕' });
    del.addEventListener('click', () => {
      pushUndo(); doc.objects = doc.objects.filter((x) => x !== o); changed();
      if (doc.objects.some((f) => f.type === 'func' && new RegExp(`(^|[^a-z])${o.name}([^a-z]|$)`, 'i').test(f.expr))) toast(`Functions that use ${o.name} stop drawing until you add a slider named ${o.name} again`, true);
    });
    box.append(el('div', { class: 'slider-card' },
      el('div', { class: 'sl-top' }, el('b', { class: 'sl-name', text: o.name }), el('span', { class: 'muted', text: '=' }), valIn, play, gear, del),
      el('div', { class: 'sl-range' }, el('span', { class: 'muted tiny', text: +o.min.toPrecision(6) }), range, el('span', { class: 'muted tiny', text: +o.max.toPrecision(6) })),
      more));
  }
}
function startSliderAnim(o) {
  sliderAnim = { id: o.id, dir: 1, last: performance.now() };
  const tick = (now) => {
    if (!sliderAnim || sliderAnim.id !== o.id || !byId(o.id)) { sliderAnim = null; return; }
    const dt = Math.min(0.05, (now - sliderAnim.last) / 1000);
    sliderAnim.last = now;
    let v = o.value + sliderAnim.dir * (o.max - o.min) * 0.25 * S.sliderSpeed * dt;
    if (v >= o.max) { v = o.max; sliderAnim.dir = -1; }
    if (v <= o.min) { v = o.min; sliderAnim.dir = 1; }
    o.value = v;
    const card = [...document.querySelectorAll('.slider-card')].find((c) => c.querySelector('.sl-name')?.textContent === o.name);
    if (card) { card.querySelector('input[type=range]').value = v; const t = card.querySelector('input.mono'); if (document.activeElement !== t) t.value = +v.toPrecision(6); }
    requestRender();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
$('#btnAddSlider')?.addEventListener('click', () => {
  const n = freeSliderName();
  if (!n) { toast('All slider letters are in use', true); return; }
  pushUndo(); doc.objects.push(newSlider(n)); changed();
  toast(`Slider ${n} added — use ${n} in a function, e.g. y = ${n}x`);
});

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
    const item = el('div', { class: `func-item${o.hidden ? ' hidden' : ''}${sel.includes(o.id) ? ' sel' : ''}` }, sw, color, el('code', { text: funcText(o), title: funcText(o) }),
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

/* ======================= command bar ======================= */

let cmdSel = -1, cmdHist = store.get('vf.cmdHistory') || [], cmdHistIdx = -1;
function openCmd(prefill = '') {
  const bar = $('#cmdBar');
  bar.hidden = false;
  const inp = $('#cmdInput');
  inp.value = prefill;
  $('#cmdErr').textContent = '';
  cmdSel = -1; cmdHistIdx = -1;
  renderCmdSug();
  inp.focus();
}
function closeCmd() { $('#cmdBar').hidden = true; $('#cmdInput').blur(); }
function renderCmdSug() {
  const box = $('#cmdSug');
  box.innerHTML = '';
  const list = suggest($('#cmdInput').value, 7);
  list.forEach(([cmd, desc], i) => {
    const row = el('div', { class: `cmd-row${i === cmdSel ? ' on' : ''}` }, el('code', { text: cmd }), el('span', { class: 'muted', text: desc }));
    row.addEventListener('mousedown', (e) => { e.preventDefault(); $('#cmdInput').value = cmd; cmdSel = -1; renderCmdSug(); $('#cmdInput').focus(); });
    box.append(row);
  });
  box.hidden = !list.length;
}
function runCmdText(text) {
  let d;
  try { d = parseCommand(text); runCommand(d); }
  catch (err) { $('#cmdErr').textContent = err.message; return false; }
  cmdHist = [text, ...cmdHist.filter((h) => h !== text)].slice(0, 30);
  store.set('vf.cmdHistory', cmdHist);
  closeCmd();
  return true;
}
function placePoly(pts, at, rotDeg) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const c0 = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const r = (rotDeg || 0) * G.DEG;
  return pts.map((p) => { const q = G.rotPt({ x: p.x - c0.x, y: p.y - c0.y }, r); return { x: at.x + q.x, y: at.y + q.y }; });
}
function runCommand(d) {
  const at = d.at || insertPoint();
  switch (d.do) {
    case 'shape': {
      pushUndo();
      let o;
      if (d.kind === 'polygon') {
        o = makeShape(3, 0, 0, 1, 1);
        o.rot = (d.rot || 0) * G.DEG;
        G.setPolyFromWorld(o, placePoly(d.pts, at, d.rot));
        o.name = d.name || '';
      } else if (d.kind === 'ellipse') {
        o = makeShape(1, at.x, at.y, 2 * d.rx, 2 * d.ry);
        o.rot = (d.rot || 0) * G.DEG;
      } else {
        o = makeShape(2, 0, 0, 2 * d.rx, d.rx);
        o.rot = (d.rot || 0) * G.DEG;
        const c = G.rotPt({ x: 0, y: d.rx / 2 }, o.rot);
        o.cx = at.x + c.x; o.cy = at.y + c.y;
      }
      addObject(o);
      changed();
      toast(`Created ${(o.kind === 'polygon' ? C.classify(o) : shapeName(o)).toLowerCase()} — area ${fmtArea(G.area(o))}`);
      if (!d.at) focusObject(o, 'offscreen');
      return;
    }
    case 'sector': {
      pushUndo();
      const o = addObject(makeSector(at, d.r, d.deg, d.start || 0));
      o.t0 += (d.rot || 0) * G.DEG;
      changed();
      const m = arcMetrics(o);
      toast(`Sector: arc ${fmtLen(m.len)}, area ${fmtArea(m.area)}`);
      if (!d.at) focusObject(o, 'offscreen');
      return;
    }
    case 'polygon': {
      pushUndo();
      const o = makeShape(3, 0, 0, 1, 1);
      G.setPolyFromWorld(o, d.pts);
      addObject(o); changed();
      toast(`Created ${C.classify(o).toLowerCase()}`);
      focusObject(o, 'offscreen');
      return;
    }
    case 'point': {
      pushUndo();
      const o = addObject({ id: uid(), type: 'point', x: d.p.x, y: d.p.y, style: { stroke: S.pointColor, width: S.pointSize, dash: 'solid' }, label: d.label || '' });
      changed(); focusObject(o, 'offscreen');
      return;
    }
    case 'line': {
      pushUndo();
      const o = addObject({ id: uid(), type: 'line', x1: d.a.x, y1: d.a.y, x2: d.b.x, y2: d.b.y, style: lineStyle(), ext: d.ext, arrows: 'none', name: '' });
      changed(); focusObject(o, 'offscreen');
      toast(`Length ${fmtLen(G.dist(d.a, d.b))} · ${lineEquation(o)}`);
      return;
    }
    case 'angle': {
      pushUndo();
      const o = addObject({ id: uid(), type: 'angle', ax: d.a.x, ay: d.a.y, vx: d.v.x, vy: d.v.y, bx: d.b.x, by: d.b.y, style: { stroke: S.angleColor, width: 2, dash: 'solid' }, reflex: false, name: '' });
      changed(); toast(`Angle ${fmtAng(angleValue(o))}`);
      return;
    }
    case 'text': {
      pushUndo();
      addObject({ id: uid(), type: 'text', x: (d.at || { x: view.cx, y: view.cy }).x, y: (d.at || { x: view.cx, y: view.cy }).y, text: d.text, size: S.textSize, style: { stroke: theme().text, width: 1, dash: 'solid' } });
      changed();
      return;
    }
    case 'func': { const err = addFunction(d.expr); if (err) throw new Error(err); return; }
    case 'solve': {
      const [l, r] = d.eq.split('=');
      const ex = r === undefined ? l : `(${l}) - (${r})`;
      let f;
      try { f = compile(ex, params); } catch (e) { throw new Error(e.message); }
      const rs = GR.roots(f, -1000, 1000, 200000);
      if (!rs.length) throw new Error('No real solutions between −1000 and 1000');
      toast(`x = ${rs.slice(0, 8).map((x) => fmtNum(x)).join(', ')}${rs.length > 8 ? ' …' : ''}`);
      return;
    }
    case 'deriv': {
      let t;
      try { t = derivativeText(d.expr, 'x', params); } catch (e) { throw new Error(e.message); }
      const err = addFunction(t);
      if (err) throw new Error(err);
      toast(`d/dx (${d.expr}) = ${t}`);
      return;
    }
    case 'integrate': {
      let f, a0, b0;
      try { f = compile(d.expr, params); a0 = compileVars(d.a, [], params)(); b0 = compileVars(d.b, [], params)(); } catch (e) { throw new Error(e.message); }
      const v = GR.integrate(f, a0, b0);
      toast(`∫ from ${d.a} to ${d.b} of ${d.expr} dx = ${fmtNum(v)}`);
      return;
    }
    case 'slider': {
      const ex = doc.objects.find((o) => o.type === 'slider' && o.name === d.name);
      pushUndo();
      if (ex) {
        if (d.min != null) ex.min = d.min;
        if (d.max != null) ex.max = d.max;
        if (!(ex.max > ex.min)) ex.max = ex.min + 1;
        if (d.value != null) { ex.value = d.value; ex.min = Math.min(ex.min, d.value); ex.max = Math.max(ex.max, d.value); }
      } else {
        const lo = d.min ?? Math.min(-10, d.value ?? 0), hi = d.max ?? Math.max(10, d.value ?? 0);
        doc.objects.push(newSlider(d.name, d.value ?? (d.min != null ? (lo + hi) / 2 : 1), lo, hi));
      }
      changed();
      toast(`${d.name} = ${fmtNum(doc.objects.find((o) => o.type === 'slider' && o.name === d.name).value)}`);
      return;
    }
    case 'action': return runAction(d.name, d.arg);
  }
}
function runAction(name, arg) {
  const tools = ['select', 'pan', 'line', 'point', 'shape', 'polygon', 'angle', 'link', 'text', 'measure'];
  switch (name) {
    case 'undo': return undo();
    case 'redo': return redo();
    case 'share': return shareDialog();
    case 'save': return saveDialog();
    case 'open': return openDialogFiles();
    case 'print': return printDialog();
    case 'tour': return startTour();
    case 'new': return newGraph();
    case 'delete': return deleteSel();
    case 'selectAll': return setSelection(doc.objects.filter((o) => !['func', 'slider'].includes(o.type)).map((o) => o.id));
    case 'zoom':
      if (arg === 'in') return zoomAt({ x: cw / 2, y: ch / 2 }, 1.25);
      if (arg === 'out') return zoomAt({ x: cw / 2, y: ch / 2 }, 0.8);
      if (arg === 'reset') { view.cx = 0; view.cy = 0; view.scale = 48; requestRender(); return updateHud(); }
      return fitAll();
    case 'grid': return setSetting('showGrid', arg === 'toggle' ? !S.showGrid : arg);
    case 'gridSize': return setSetting('gridSize', arg);
    case 'axes': return setSetting('showAxes', arg);
    case 'exact': setSetting('numberForm', arg ? 'radical' : 'decimal'); return toast(arg ? 'Showing simplest radical form when exact' : 'Showing decimals');
    case 'theme': return setSetting('theme', arg);
    case 'export': return arg === 'svg' ? exportSVG() : exportPNG();
    case 'settings': return settingsDialog(arg || '');
    case 'help': return helpDialog(arg || '');
    case 'data': return dataDialog();
    case 'puzzle': return enterPuzzle(PZ.todayStr());
    case 'install': return installApp();
    case 'examples': return examplesDialog();
    case 'traces': return clearTraces();
    case 'tool': if (!tools.includes(arg)) throw new Error(`Tools: ${tools.join(', ')}`); return setTool(arg);
  }
}
$('#cmdInput').addEventListener('input', () => { cmdSel = -1; $('#cmdErr').textContent = ''; renderCmdSug(); });
$('#cmdInput').addEventListener('keydown', (e) => {
  const rows = $$('#cmdSug .cmd-row');
  if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const v = cmdSel >= 0 && rows[cmdSel] ? rows[cmdSel].querySelector('code').textContent : $('#cmdInput').value;
    if (cmdSel >= 0) { $('#cmdInput').value = v; cmdSel = -1; renderCmdSug(); return; }
    runCmdText(v);
  } else if (e.key === 'ArrowDown') { e.preventDefault(); cmdSel = Math.min(rows.length - 1, cmdSel + 1); renderCmdSug(); }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdSel > 0) { cmdSel--; renderCmdSug(); }
    else if (cmdHist.length) { cmdHistIdx = Math.min(cmdHist.length - 1, cmdHistIdx + 1); $('#cmdInput').value = cmdHist[cmdHistIdx]; cmdSel = -1; renderCmdSug(); }
  } else if (e.key === 'Tab' && rows.length) { e.preventDefault(); $('#cmdInput').value = rows[Math.max(0, cmdSel)].querySelector('code').textContent; cmdSel = -1; renderCmdSug(); }
});
$('#cmdInput').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('#cmdInput') && !$('.overlay')) closeCmd(); }, 150));

/* ======================= quick tour ======================= */

const TOUR = [
  { sel: '#sidesGrid', title: 'Insert shapes', text: 'Click any button to drop a shape: 1 = circle, 2 = semicircle, 3–20 = regular polygons. Special shapes like the 30-60-90 triangle are just below.' },
  { sel: '#stage', title: 'Resize & rotate', text: 'Select a shape and drag its square handles to resize it — hold Shift to keep its proportions. Drag the round handle to rotate.', center: true },
  { sel: '#stage', title: 'Right-click anything', text: 'Right-click a shape for exact side lengths and angles, inscribed shapes, constructions, links, arcs, overlaps and more. (On touch screens, press and hold.)', center: true },
  { sel: '[data-tool="line"]', title: 'Lines that snap', text: 'Lines snap to corners, midpoints, intersections and purple snap points, so everything lines up exactly.' },
  { sel: '#btnCmd', title: 'Just type it', text: 'Press / and type things like “triangle 3 4 5”, “circle r=2 at (1,1)” or “y = a·sin(x)”. Share your graph with the Share button. Have fun!' },
];
function startTour(i = 0) {
  $('.tour')?.remove();
  const step = TOUR[i];
  if (!step) { store.set('vf.toured', true); return; }
  const target = $(step.sel);
  const r = target && target.offsetParent !== null ? target.getBoundingClientRect() : null;
  const wrap = el('div', { class: 'tour', role: 'dialog', 'aria-label': 'Quick tour' });
  const spot = el('div', { class: 'tour-spot' });
  if (r && !step.center) Object.assign(spot.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
  else if (r) Object.assign(spot.style, { left: r.left + r.width / 2 - 120 + 'px', top: r.top + r.height / 2 - 80 + 'px', width: '240px', height: '160px', borderRadius: '50%' });
  else Object.assign(spot.style, { left: '50%', top: '40%', width: '0', height: '0' });
  const end = () => { wrap.remove(); store.set('vf.toured', true); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') end(); else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', key); startTour(i + 1); } else if (e.key === 'ArrowLeft' && i > 0) { document.removeEventListener('keydown', key); startTour(i - 1); } };
  document.addEventListener('keydown', key);
  const bubble = el('div', { class: 'tour-bubble' },
    el('div', { class: 'tour-step', text: `${i + 1} / ${TOUR.length}` }),
    el('h4', { text: step.title }), el('p', { text: step.text }),
    el('div', { class: 'tour-actions' },
      el('button', { type: 'button', class: 'btn', text: 'Skip', onclick: end }),
      i > 0 ? el('button', { type: 'button', class: 'btn', text: 'Back', onclick: () => { document.removeEventListener('keydown', key); startTour(i - 1); } }) : null,
      el('button', { type: 'button', class: 'btn primary', text: i === TOUR.length - 1 ? 'Done' : 'Next', onclick: () => { document.removeEventListener('keydown', key); startTour(i + 1); } })));
  wrap.append(spot, bubble);
  document.body.append(wrap);
  // place the bubble beside the highlighted area, kept on screen
  const b = bubble.getBoundingClientRect();
  let x, y;
  if (r && !step.center) {
    x = r.right + 16; y = r.top;
    if (x + b.width > innerWidth - 12) { x = r.left - b.width - 16; }
    if (x < 12) { x = Math.min(innerWidth - b.width - 12, Math.max(12, r.left)); y = r.bottom + 16; }
  } else { x = innerWidth / 2 - b.width / 2; y = innerHeight / 2 + 90; }
  bubble.style.left = clamp(x, 12, innerWidth - b.width - 12) + 'px';
  bubble.style.top = clamp(y, 12, innerHeight - b.height - 12) + 'px';
  bubble.querySelector('.primary').focus();
}

/* ======================= worksheet / print ======================= */

const PAPER = { letter: [816, 1056], a4: [794, 1123] };
// Render the drawing to an image for a printed page; measurements shown (answer key) or hidden (practice).
function renderPage(opt, showMeasures) {
  let [pw, ph] = PAPER[opt.paper];
  if (opt.landscape) [pw, ph] = [ph, pw];
  const W = pw - 96, H = ph - 96 - (opt.header ? 150 : 40);
  const scale = 2.5;
  const off = document.createElement('canvas');
  off.width = Math.round(W * scale); off.height = Math.round(H * scale);
  const saved = { ctx, cw, ch, dpr, view: { ...view }, sel, hoverId, listHover, flash, snapHint, draft, measureShown, hoverPt, linkPicks, S: { ...S }, tools: { ...toolsOn } };
  try {
    ctx = off.getContext('2d');
    if (opt.area === 'fit') {
      const pts = doc.objects.filter((o) => !o.hidden && o.type !== 'func').flatMap(objPoints);
      if (pts.length) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
        view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
        view.scale = Math.min((W - 90) / Math.max(x1 - x0, 1e-6), (H - 90) / Math.max(y1 - y0, 1e-6));
      }
    } else view.scale = view.scale * Math.min(W / cw, H / ch);
    cw = W; ch = H; dpr = scale;
    sel = []; hoverId = null; listHover = null; flash = null; snapHint = null; draft = null; measureShown = null; hoverPt = null; linkPicks = [];
    printMode = true;
    Object.assign(S, { theme: 'light', showSnapPoints: false, showGrid: opt.grid, showAxes: opt.axes });
    if (showMeasures) Object.assign(S, { sideLabels: 'always', angleLabels: 'always' });
    else { Object.assign(S, { sideLabels: 'never', angleLabels: 'never' }); toolsOn.area = false; toolsOn.rightTri = false; printHideMeasures = true; }
    render();
    return off.toDataURL('image/png');
  } finally {
    printMode = false; printHideMeasures = false;
    ({ ctx, cw, ch, dpr, sel, hoverId, listHover, flash, snapHint, draft, measureShown, hoverPt, linkPicks } = saved);
    Object.assign(view, saved.view);
    Object.assign(S, saved.S);
    Object.assign(toolsOn, saved.tools);
    requestRender();
  }
}
function printDialog() {
  let f = {};
  openDialog({
    title: 'Worksheet & print',
    wide: true,
    build(body) {
      f.title = el('input', { type: 'text', maxlength: 80, value: currentName || 'Geometry worksheet' });
      f.instr = el('textarea', { rows: 2, placeholder: 'Instructions, e.g. “Find the area of each shaded region.”' });
      f.paper = el('select', {}, el('option', { value: 'letter', text: 'US Letter' }), el('option', { value: 'a4', text: 'A4' }));
      f.orient = el('select', {}, el('option', { value: 'portrait', text: 'Portrait' }), el('option', { value: 'landscape', text: 'Landscape' }));
      f.area = el('select', {}, el('option', { value: 'fit', text: 'Fit everything on the page' }), el('option', { value: 'view', text: 'What’s on screen now' }));
      f.meas = el('select', {}, el('option', { value: 'both', text: 'Worksheet + answer key (2 pages)' }), el('option', { value: 'practice', text: 'Practice only (measurements hidden)' }), el('option', { value: 'answer', text: 'With measurements (answer key)' }));
      const chk = (key, text, on) => { f[key] = el('input', { type: 'checkbox', checked: on }); return el('label', { class: 'chk' }, f[key], text); };
      body.append(
        el('div', { class: 'grid2' }, el('label', { class: 'field' }, 'Title', f.title), el('label', { class: 'field' }, 'Pages', f.meas)),
        el('label', { class: 'field', style: 'margin-top:8px' }, 'Instructions (optional)', f.instr),
        el('div', { class: 'grid3', style: 'margin-top:8px' }, el('label', { class: 'field' }, 'Paper', f.paper), el('label', { class: 'field' }, 'Orientation', f.orient), el('label', { class: 'field' }, 'Area', f.area)),
        el('div', { class: 'grid2' }, chk('header', 'Name & date lines', true), chk('grid', 'Show the grid', S.showGrid), chk('axes', 'Show the axes', S.showAxes)),
        el('p', { class: 'muted tiny', text: 'Practice pages hide side lengths, angles, areas and other measurements; tick marks and labels you added stay. The answer key shows every side and angle.' }));
    },
    buttons: [
      { label: 'Cancel' },
      { label: 'Download images', onClick() { const pages = buildPages(f); pages.forEach((pg, i) => { const a = el('a', { href: pg.img, download: `${(f.title.value || 'worksheet').replace(/[^\w-]+/g, '_')}${pages.length > 1 ? (pg.key ? '-answer-key' : '-worksheet') : ''}.png` }); setTimeout(() => a.click(), i * 400); }); } },
      { label: 'Print…', primary: true, onClick(api) {
        const pages = buildPages(f);
        const w = window.open('', '_blank');
        if (!w) { api.setError('Your browser blocked the print window — allow pop-ups for this site, or use “Download images”.'); return false; }
        const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const [pw, ph] = PAPER[f.paper.value];
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.title.value)}</title><style>
          @page { size: ${f.paper.value === 'a4' ? 'A4' : 'letter'} ${f.orient.value}; margin: 0.5in; }
          body { font-family: system-ui, sans-serif; color: #111; margin: 0; }
          .page { page-break-after: always; break-after: page; ${f.orient.value === 'landscape' ? `width:${ph - 96}px` : `width:${pw - 96}px`}; margin: 0 auto; }
          .page:last-child { page-break-after: auto; }
          h1 { font-size: 22px; margin: 0 0 6px; display: flex; justify-content: space-between; align-items: baseline; }
          h1 small { font-size: 12px; font-weight: 600; color: #b45309; border: 1px solid #b45309; border-radius: 4px; padding: 1px 6px; }
          .lines { display: flex; gap: 24px; font-size: 13px; margin: 8px 0 10px; }
          .lines span { flex: 1; border-bottom: 1px solid #555; padding-bottom: 2px; }
          p { font-size: 14px; margin: 4px 0 10px; }
          img { width: 100%; display: block; }
          .foot { font-size: 10px; color: #888; text-align: right; margin-top: 4px; }
        </style></head><body>${pages.map((pg) => `<section class="page"><h1>${esc(f.title.value)}${pg.key ? '<small>ANSWER KEY</small>' : ''}</h1>${f.header.checked ? '<div class="lines"><span>Name:</span><span>Date:</span></div>' : ''}${f.instr.value.trim() ? `<p>${esc(f.instr.value.trim())}</p>` : ''}<img src="${pg.img}" alt=""><div class="foot">Made with Vertex Forge</div></section>`).join('')}</body></html>`;
        w.document.open(); w.document.write(html); w.document.close();
        const imgs = [...w.document.images];
        Promise.all(imgs.map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(() => { w.focus(); w.print(); });
        return true;
      } },
    ],
  });
}
function buildPages(f) {
  const opt = { paper: f.paper.value, landscape: f.orient.value === 'landscape', area: f.area.value, header: f.header.checked, grid: f.grid.checked, axes: f.axes.checked };
  const m = f.meas.value;
  const pages = [];
  if (m !== 'answer') pages.push({ img: renderPage(opt, false), key: false });
  if (m !== 'practice') pages.push({ img: renderPage(opt, true), key: m === 'both' });
  return pages;
}

/* ======================= data & statistics ======================= */

const SAMPLE_1VAR = '72, 85, 90, 66, 85, 78, 95, 88, 70, 85, 60, 92, 81, 77, 99';
const SAMPLE_2VAR = 'hours score\n1 52\n2 58\n2.5 61\n3 67\n4 70\n4.5 78\n5 81\n6 88';
function dataDialog() {
  let ta, out, opts = {};
  const refresh = () => {
    out.innerHTML = '';
    let d;
    try { d = ST.parseData(ta.value); } catch (e) { out.append(el('div', { class: 'err', text: e.message })); return null; }
    const kv = el('dl', { class: 'kv stats-kv' });
    const add = (k, v) => kv.append(el('dt', { text: k }), el('dd', { text: v }));
    if (d.kind === 'values') {
      const s = ST.summary(d.values);
      add('Count', s.n); add('Mean', fmtNum(s.mean)); add('Median', fmtNum(s.median)); add('Mode', s.mode.length ? s.mode.map((v) => fmtNum(v)).join(', ') : 'none');
      add('Min / Max', `${fmtNum(s.min)} / ${fmtNum(s.max)}`); add('Range', fmtNum(s.range)); add('Q1 / Q3', `${fmtNum(s.q1)} / ${fmtNum(s.q3)}`); add('IQR', fmtNum(s.iqr));
      add('Std. dev. (population σ)', fmtNum(s.popSD)); add('Std. dev. (sample s)', fmtNum(s.sampleSD)); add('Sum', fmtNum(s.sum));
      if (s.outliers.length) add('Outliers (1.5·IQR)', s.outliers.map((v) => fmtNum(v)).join(', '));
    } else {
      add('Points', d.pairs.length);
      try { const r = ST.linearRegression(d.pairs); add('Best-fit line', `y = ${fmtNum(r.m)}x ${r.b < 0 ? '−' : '+'} ${fmtNum(Math.abs(r.b))}`); add('Correlation r', fmtNum(r.r)); add('r²', fmtNum(r.r2)); }
      catch (e) { add('Best-fit line', e.message); }
      const sx = ST.summary(d.pairs.map((q) => q[0])), sy = ST.summary(d.pairs.map((q) => q[1]));
      add('Mean x / y', `${fmtNum(sx.mean)} / ${fmtNum(sy.mean)}`);
    }
    out.append(kv);
    for (const [k, box] of Object.entries(opts)) box.parentElement.hidden = (d.kind === 'values') !== ['dot', 'box', 'hist', 'bins'].includes(k);
    return d;
  };
  openDialog({
    title: 'Data & statistics',
    wide: true,
    build(body) {
      ta = el('textarea', { rows: 6, class: 'code-box', placeholder: 'Numbers separated by commas or spaces — or two columns (x y) per line', autofocus: true });
      out = el('div', { class: 'stats-out' });
      ta.addEventListener('input', refresh);
      const chk = (k, text, on) => { opts[k] = el('input', { type: 'checkbox', checked: on }); return el('label', { class: 'chk' }, opts[k], text); };
      opts.bins = el('input', { type: 'number', min: 1, max: 50, step: 1, value: '', placeholder: 'auto', style: 'width:70px' });
      body.append(
        el('div', { class: 'row-btns', style: 'margin-top:0' }, el('button', { type: 'button', text: 'Sample: test scores', onclick: () => { ta.value = SAMPLE_1VAR; refresh(); } }), el('button', { type: 'button', text: 'Sample: hours vs. score', onclick: () => { ta.value = SAMPLE_2VAR; refresh(); } })),
        el('div', { class: 'grid2', style: 'margin-top:8px' }, ta, out),
        el('div', { class: 'grid2' },
          el('div', {}, chk('dot', 'Dot plot', true), chk('box', 'Box plot', true), chk('hist', 'Histogram', false), el('label', { class: 'chk' }, 'Bins ', opts.bins)),
          el('div', {}, chk('scatter', 'Scatter plot', true), chk('fit', 'Line of best fit', true))),
        el('p', { class: 'muted tiny', text: 'Tip: probability functions work in any graph — normalpdf(x, μ, σ), normalcdf(x, μ, σ), binompdf(n, p, k), nCr(n, k). Shade a normal curve with Calculus → Area under the curve.' }));
      refresh();
    },
    buttons: [{ label: 'Cancel' }, {
      label: 'Add to graph', primary: true, onClick(api) {
        const d = refresh();
        if (!d) { api.setError('Fix the data first'); return false; }
        pushUndo();
        const made = [];
        const pt = (x, y, col) => { const o = { id: uid(), type: 'point', x, y, style: { stroke: col, width: 3.5, dash: 'solid' }, label: '' }; made.push(o); return o; };
        const poly = (pts, col, alpha = 0.3) => { const o = makeShape(3, 0, 0, 1, 1); G.setPolyFromWorld(o, pts); o.style = { stroke: col, width: 1.5, dash: 'solid', fill: col, fillAlpha: alpha }; o.snapN = 0; made.push(o); return o; };
        const seg = (p1, p2, col) => { const o = { id: uid(), type: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, style: { stroke: col, width: 2, dash: 'solid' }, ext: 'segment', arrows: 'none', name: '' }; made.push(o); return o; };
        if (d.kind === 'values') {
          const s = ST.summary(d.values);
          const unit = Math.max(s.range / 20, 0.5);
          if (opts.dot.checked) { const seen = new Map(); for (const v of s.sorted) { const k = (seen.get(v) || 0) + 1; seen.set(v, k); pt(v, k * unit * 0.6, '#38bdf8'); } }
          if (opts.box.checked) {
            const y0 = -unit * 2.2, y1 = -unit * 0.6, ym = (y0 + y1) / 2, col = '#fbbf24';
            const inside = s.sorted.filter((v) => !s.outliers.includes(v));
            const lo = inside[0], hi = inside[inside.length - 1];
            poly([{ x: s.q1, y: y0 }, { x: s.q3, y: y0 }, { x: s.q3, y: y1 }, { x: s.q1, y: y1 }], col, 0.18);
            seg({ x: s.median, y: y0 }, { x: s.median, y: y1 }, col);
            seg({ x: lo, y: ym }, { x: s.q1, y: ym }, col); seg({ x: s.q3, y: ym }, { x: hi, y: ym }, col);
            seg({ x: lo, y: ym - unit * 0.3 }, { x: lo, y: ym + unit * 0.3 }, col); seg({ x: hi, y: ym - unit * 0.3 }, { x: hi, y: ym + unit * 0.3 }, col);
            for (const v of s.outliers) pt(v, ym, '#f87171');
          }
          if (opts.hist.checked) {
            const bins = ST.histogram(d.values, +opts.bins.value || undefined);
            for (const b of bins) if (b.count) poly([{ x: b.x0, y: 0 }, { x: b.x1, y: 0 }, { x: b.x1, y: b.count * unit }, { x: b.x0, y: b.count * unit }], '#a78bfa', 0.25);
          }
          made.push({ id: uid(), type: 'text', x: s.min, y: -unit * 3.4, text: `n = ${s.n}   mean = ${fmtNum(s.mean)}   median = ${fmtNum(s.median)}   σ = ${fmtNum(s.popSD)}`, size: 14, style: { stroke: theme().text, width: 1, dash: 'solid' } });
        } else {
          if (opts.scatter.checked) for (const [x, y] of d.pairs) pt(x, y, '#38bdf8');
          if (opts.fit.checked) {
            try {
              const r = ST.linearRegression(d.pairs);
              const expr = `${+r.m.toPrecision(8)}x ${r.b < 0 ? '-' : '+'} ${+Math.abs(r.b).toPrecision(8)}`;
              made.push({ id: uid(), type: 'func', expr, style: { stroke: '#f472b6', width: 2.5, dash: 'solid' }, hidden: false, alpha: 1, xMin: null, xMax: null, showLabel: true, endDots: false });
              const xs = d.pairs.map((q) => q[0]);
              made.push({ id: uid(), type: 'text', x: Math.min(...xs), y: Math.max(...d.pairs.map((q) => q[1])) + 2, text: `r = ${fmtNum(r.r)}   r² = ${fmtNum(r.r2)}`, size: 14, style: { stroke: theme().text, width: 1, dash: 'solid' } });
            } catch (e) { toast(e.message, true); }
          }
        }
        doc.objects.push(...made);
        setSelection([]);
        changed();
        fitAll();
        toast(`Added ${made.length} objects — tip: drag a box around them to move them together`);
        return true;
      },
    }],
  });
}

/* ======================= examples library ======================= */

function cmdAll(list) { for (const c of list) runCommand(parseCommand(c)); }
const EXAMPLES = [
  { title: 'Pythagorean theorem', desc: 'A 3-4-5 right triangle with the right-triangle tool on: a² + b² = c².', tools: { rightTri: true, area: true }, build() { cmdAll(['triangle 3 4 5 at (0,0)']); } },
  { title: 'Parabola family', desc: 'y = a(x − h)² + k — drag the sliders to move and stretch it.', build() { cmdAll(['slider a -3 3 1', 'slider h -5 5 1', 'slider k -5 5 -2']); addFunction('a(x - h)^2 + k'); } },
  { title: 'Unit circle', desc: 'A point on the unit circle driven by an angle slider; its x is cos, its y is sin.', build() {
    cmdAll(['circle 1 at (0,0)', 'slider t 0 6.2832 0.8']);
    const p = addObject({ id: uid(), type: 'point', x: 0, y: 0, label: 'P', style: { stroke: '#f472b6', width: 4, dash: 'solid' }, bind: { x: 'cos(t)', y: 'sin(t)' } });
    const o = addObject({ id: uid(), type: 'point', x: 0, y: 0, label: 'O', style: { stroke: '#94a3b8', width: 3, dash: 'solid' } });
    addObject({ ...mkLine({ x: 0, y: 0 }, { x: 1, y: 0 }), cons: { k: 'seg2', s: [o.id, p.id] }, showLen: false });
    const foot = addObject({ id: uid(), type: 'point', x: 0, y: 0, label: '', style: { stroke: '#94a3b8', width: 2, dash: 'solid' }, bind: { x: 'cos(t)', y: '0' } });
    addObject({ ...mkLine({ x: 0, y: 0 }, { x: 1, y: 0 }, 'segment', '#34d399'), cons: { k: 'seg2', s: [foot.id, p.id] } });
    addObject({ ...mkLine({ x: 0, y: 0 }, { x: 1, y: 0 }, 'segment', '#60a5fa'), cons: { k: 'seg2', s: [o.id, foot.id] } });
    p.trace = true;
  } },
  { title: 'Area under a curve', desc: '∫ from 0 to 2 of x² = 8/3, shaded.', build() { addFunction('x^2'); const f = doc.objects.at(-1); doc.objects.push({ id: uid(), type: 'integral', f: f.id, g: null, a: '0', b: '2', style: { stroke: f.style.stroke, width: 1.5, dash: 'solid', fill: f.style.stroke, fillAlpha: 0.28 } }); } },
  { title: 'Tangent line', desc: 'y = x³ − 3x with its derivative and a tangent you can drag along the curve.', build() {
    addFunction('x^3 - 3x');
    const f = doc.objects.at(-1);
    doc.objects.push({ id: uid(), type: 'func', expr: derivOrNumericText(f), derivOf: f.id, numeric: false, _src: f.expr, style: { ...f.style, dash: 'dashed', stroke: '#34d399' }, hidden: false, alpha: 1, xMin: null, xMax: null, showLabel: true, endDots: false });
    const pt = { ...mkPoint({ x: 1.5, y: 0 }, 'T', f.style.stroke), cons: { k: 'onObj', s: [f.id], t0: 1.5 } };
    doc.objects.push(pt, { ...cLine({ k: 'ftan', s: [f.id, pt.id] }, S.measureColor, 'line'), showEq: true });
  } },
  { title: 'Euler line', desc: 'A triangle’s circumcenter, centroid and orthocenter always line up. Drag a corner!', build() {
    cmdAll(['triangle 5 6 7 at (0,0)']);
    const t = doc.objects.at(-1);
    const s = [t.id];
    for (const [c, col] of [['O', '#60a5fa'], ['G', '#34d399'], ['H', '#f87171']]) doc.objects.push(cPoint({ k: 'tcenter', s, c }, c, col));
    doc.objects.push(cLine({ k: 'euler', s }, '#f472b6', 'line'), cCircle({ k: 'circum', s }));
  } },
  { title: 'Overlapping circles', desc: 'The lens where two circles overlap — area 2π/3 − √3/2 exactly.', build() { cmdAll(['circle 1 at (0,0)', 'circle 1 at (1,0)']); const [c1, c2] = doc.objects.slice(-2); createRegion(c1, c2, 'intersect'); } },
  { title: 'Inequalities', desc: 'The region where y > x² − 4 and y < 2x overlap.', build() { addFunction('y > x^2 - 4'); addFunction('y < 2x + 1'); } },
  { title: 'Polar rose', desc: 'r = cos(kθ) — change k to change the petals.', build() { cmdAll(['slider k 1 8 4']); addFunction('r = 2cos(kθ)'); } },
  { title: 'Linked parallelogram', desc: 'Opposite sides linked parallel — drag any corner and it stays a parallelogram.', build() {
    cmdAll(['polygon (0,0) (5,0) (6,3) (1,3)']);
    const q = doc.objects.at(-1);
    doc.objects.push({ id: uid(), type: 'link', kind: 'parallel', refs: [{ t: 'side', o: q.id, i: 0 }, { t: 'side', o: q.id, i: 2 }], off: false }, { id: uid(), type: 'link', kind: 'parallel', refs: [{ t: 'side', o: q.id, i: 1 }, { t: 'side', o: q.id, i: 3 }], off: false });
  } },
  { title: 'Scatter plot & best fit', desc: 'Study hours vs. test score with a line of best fit and r.', build() {
    const d = ST.parseData(SAMPLE_2VAR);
    for (const [x, y] of d.pairs) doc.objects.push({ id: uid(), type: 'point', x, y: y / 10, style: { stroke: '#38bdf8', width: 3.5, dash: 'solid' }, label: '' });
    const r = ST.linearRegression(d.pairs.map(([x, y]) => [x, y / 10]));
    doc.objects.push({ id: uid(), type: 'func', expr: `${+r.m.toPrecision(6)}x + ${+r.b.toPrecision(6)}`, style: { stroke: '#f472b6', width: 2.5, dash: 'solid' }, hidden: false, alpha: 1, xMin: null, xMax: null, showLabel: true, endDots: false });
    doc.objects.push({ id: uid(), type: 'text', x: 0.5, y: 10, text: `score ÷ 10 against hours · r = ${fmtNum(r.r)}`, size: 14, style: { stroke: theme().text, width: 1, dash: 'solid' } });
  } },
  { title: 'Locus: a point on a rolling wheel', desc: 'The path of a point on a turning circle (a cycloid).', build() {
    cmdAll(['slider t 0 12.566 2']);
    const c = addObject({ ...makeShape(1, 0, 1, 2, 2), bind: { cx: 't', cy: '1' } });
    const p = addObject({ id: uid(), type: 'point', x: 0, y: 0, label: 'P', style: { stroke: '#f472b6', width: 4, dash: 'solid' }, bind: { x: 't - sin(t)', y: '1 - cos(t)' } });
    doc.objects.push({ id: uid(), type: 'locus', pt: p.id, drv: doc.objects.find((o) => o.type === 'slider').id, style: { stroke: '#fb923c', width: 2.5, dash: 'solid' } });
    void c;
  } },
];
function examplesDialog() {
  openDialog({
    title: 'Examples',
    wide: true,
    build(body, api) {
      const grid = el('div', { class: 'ex-grid' });
      EXAMPLES.forEach((ex) => grid.append(el('button', { type: 'button', class: 'ex-card', onclick: () => { api.close(); loadExample(ex); } }, el('b', { text: ex.title }), el('span', { text: ex.desc }))));
      body.append(el('p', { class: 'muted', text: 'Open a ready-made graph to explore. It replaces what’s on the canvas (Undo brings your work back).' }), grid);
    },
    buttons: [{ label: 'Close' }],
  });
}
function loadExample(ex) {
  pushUndo();
  doc.objects = []; sel = []; vertexEdit = null; traces.clear();
  view.cx = 0; view.cy = 0; view.scale = 48;
  toolsOn.rightTri = !!ex.tools?.rightTri; toolsOn.area = !!ex.tools?.area;
  ex.build();
  sel = [];
  changed();
  render(); // computes loci so zoom-to-fit includes them
  fitAll();
  applySettingsSideEffects();
  $('#tglRightTri').setAttribute('aria-pressed', toolsOn.rightTri); $('#tglArea').setAttribute('aria-pressed', toolsOn.area);
  $('#rtSection').hidden = !toolsOn.rightTri;
  toast(`${ex.title} — ${ex.desc}`);
}

/* ======================= daily puzzle ======================= */

function puzzleProgress() { const s = store.get('vf.puzzle'); return s && typeof s === 'object' ? s : { solved: {}, streak: 0, last: null }; }
function puzzleMenu(x, y) {
  const today = PZ.todayStr();
  const prog = puzzleProgress();
  const done = prog.solved[today];
  const yest = PZ.todayStr(new Date(Date.now() - 86400000));
  showMenu([
    { header: `🧩 Daily puzzle #${PZ.puzzleNumber(today)} · ${PZ.STARS[PZ.levelFor(today)]}` },
    { label: done ? 'Today’s puzzle ✓ — play it again' : 'Give me today’s puzzle', action: () => enterPuzzle(today) },
    { label: `Yesterday’s puzzle${prog.solved[yest] ? ' ✓' : ''}`, action: () => enterPuzzle(yest) },
    { header: prog.streak ? `Streak: ${prog.streak} day${prog.streak > 1 ? 's' : ''} 🔥` : 'Solve one to start a streak' },
  ], x, y);
}
function enterPuzzle(date, tpl = null, lvl = null) {
  if (puzzle) exitPuzzle(true);
  const spec = PZ.generatePuzzle(date, tpl, lvl);
  puzzle = {
    spec, attempts: 0, solved: false,
    stash: { objects: JSON.stringify(doc.objects), view: { ...view }, sel, tools: { ...toolsOn }, tool, S: { sideLabels: S.sideLabels, angleLabels: S.angleLabels, hoverCoords: S.hoverCoords, lineEquations: S.lineEquations, numberForm: S.numberForm, regionLabels: S.regionLabels } },
  };
  undoStack = []; redoStack = [];
  Object.assign(S, { sideLabels: 'never', angleLabels: 'never', hoverCoords: false, lineEquations: 'never', regionLabels: false });
  toolsOn.area = false; toolsOn.rightTri = false;
  doc.objects = buildPuzzleFigure(spec);
  sel = []; vertexEdit = null; traces.clear();
  document.body.classList.add('puzzle-mode');
  $('#rtSection').hidden = true;
  setTool('select');
  const bar = $('#puzzleBar');
  bar.hidden = false;
  $('#pzTitle').textContent = `🧩 Daily puzzle #${spec.number} · ${spec.stars} · ${spec.title}`;
  $('#pzQuestion').textContent = spec.question;
  $('#pzInput').value = '';
  $('#pzResult').textContent = '';
  $('#pzResult').className = 'pz-result';
  $('#pzHint').disabled = false;
  changed();
  render();
  // fit the figure into the space below the question box
  fitAll();
  const barH = bar.getBoundingClientRect().height + 20;
  view.scale *= Math.max(0.3, (ch - barH - 30) / ch) * 0.9;
  view.cy += barH / 2 / view.scale;
  requestRender(); updateHud();
  setTimeout(() => $('#pzInput').focus(), 50);
}
function exitPuzzle(silent) {
  if (!puzzle) return;
  const st = puzzle.stash;
  puzzle = null;
  doc.objects = JSON.parse(st.objects);
  Object.assign(view, st.view);
  Object.assign(S, st.S);
  Object.assign(toolsOn, st.tools);
  sel = st.sel.filter((id) => byId(id));
  undoStack = []; redoStack = [];
  document.body.classList.remove('puzzle-mode');
  $('#puzzleBar').hidden = true;
  $('#rtSection').hidden = !toolsOn.rightTri;
  $('#tglRightTri').setAttribute('aria-pressed', toolsOn.rightTri); $('#tglArea').setAttribute('aria-pressed', toolsOn.area);
  setTool(st.tool || 'select');
  changed();
  if (!silent) toast('Back to your graph');
}
function buildPuzzleFigure(spec) {
  const out = [];
  const col = '#38bdf8', ink = theme().text;
  const lock = (o) => Object.assign(o, { locked: true, puzzle: true });
  const shapes = [];
  for (const it of spec.figure) {
    if (it.kind === 'poly') {
      const o = makeShape(3, 0, 0, 1, 1); G.setPolyFromWorld(o, it.pts); o.snapN = 0;
      o.style = { stroke: col, width: 2.5, dash: 'solid', fill: col, fillAlpha: 0.06 };
      out.push(lock(o)); shapes.push(o);
    } else if (it.kind === 'circle') {
      const o = makeShape(1, it.c.x, it.c.y, 2 * it.r, 2 * it.r); o.snapN = 0;
      o.style = { stroke: it.faint ? hexA(col, 1) : col, width: it.faint ? 1.2 : 2.5, dash: it.faint ? 'dashed' : 'solid', fill: col, fillAlpha: 0.04 };
      out.push(lock(o)); shapes.push(o);
    } else if (it.kind === 'semi') {
      const o = makeShape(2, it.c.x, it.c.y + it.r / 2, 2 * it.r, it.r); o.snapN = 0;
      o.style = { stroke: col, width: 2.5, dash: 'solid', fill: col, fillAlpha: 0.06 };
      out.push(lock(o)); shapes.push(o);
    } else if (it.kind === 'line') {
      out.push(lock({ id: uid(), type: 'line', x1: it.a.x, y1: it.a.y, x2: it.b.x, y2: it.b.y, style: { stroke: '#94a3b8', width: 2, dash: it.dash || 'solid' }, ext: it.ext || 'segment', arrows: 'none', name: '' }));
    } else if (it.kind === 'label') {
      out.push(lock({ id: uid(), type: 'text', x: it.at.x - 0.12 * it.text.length, y: it.at.y - 0.18, text: it.text, size: 17, style: { stroke: it.text === '?' ? '#facc15' : ink, width: 1, dash: 'solid' } }));
    } else if (it.kind === 'point') {
      out.push(lock({ id: uid(), type: 'point', x: it.p.x, y: it.p.y, style: { stroke: '#f472b6', width: 4, dash: 'solid' }, label: it.label || '' }));
    } else if (it.kind === 'right') {
      const s = 0.35, p = it.p;
      const o = makeShape(4, 0, 0, 1, 1);
      G.setPolyFromWorld(o, [p, { x: p.x + it.u.x * s, y: p.y + it.u.y * s }, { x: p.x + (it.u.x + it.v.x) * s, y: p.y + (it.u.y + it.v.y) * s }, { x: p.x + it.v.x * s, y: p.y + it.v.y * s }]);
      o.style = { stroke: '#94a3b8', width: 1.5, dash: 'solid', fill: col, fillAlpha: 0 }; o.snapN = 0;
      out.push(lock(o));
    } else if (it.kind === 'shade') {
      const A = shapes[it.a], B = shapes[it.b];
      if (A && B) out.push(lock({ id: uid(), type: 'region', a: A.id, b: B.id, op: it.op, style: { stroke: '#facc15', width: 1, dash: 'solid', fill: '#facc15', fillAlpha: 0.35 }, hatch: false }));
    } else if (it.kind === 'parallel') {
      // ">" arrow mark showing a line is parallel to its partner
      const d = it.dir, n = { x: -d.y, y: d.x }, s = 0.22, tip = { x: it.at.x + d.x * s, y: it.at.y + d.y * s };
      for (const sg of [-1, 1]) out.push(lock({ id: uid(), type: 'line', x1: tip.x - d.x * s * 1.6 + n.x * s * sg, y1: tip.y - d.y * s * 1.6 + n.y * s * sg, x2: tip.x, y2: tip.y, style: { stroke: '#facc15', width: 2.2, dash: 'solid' }, ext: 'segment', arrows: 'none', name: '' }));
    } else if (it.kind === 'segmentShade') {
      out.push(lock({ id: uid(), type: 'arc', mode: 'segment', cx: it.c.x, cy: it.c.y, rx: it.r, ry: it.r, rot: 0, t0: it.t0, sweep: it.sweep, style: { stroke: '#facc15', width: 1.5, dash: 'solid', fill: '#facc15', fillAlpha: 0.4 }, name: '' }));
    } else if (it.kind === 'tick') {
      const m = { x: (it.a.x + it.b.x) / 2, y: (it.a.y + it.b.y) / 2 }, L = Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y) || 1;
      const n = { x: -(it.b.y - it.a.y) / L * 0.22, y: (it.b.x - it.a.x) / L * 0.22 };
      out.push(lock({ id: uid(), type: 'line', x1: m.x - n.x, y1: m.y - n.y, x2: m.x + n.x, y2: m.y + n.y, style: { stroke: '#facc15', width: 2.5, dash: 'solid' }, ext: 'segment', arrows: 'none', name: '' }));
    } else if (it.kind === 'sector') {
      out.push(lock({ id: uid(), type: 'arc', mode: 'arc', cx: it.c.x, cy: it.c.y, rx: it.r, ry: it.r, rot: 0, t0: it.t0, sweep: it.sweep, style: { stroke: '#fb923c', width: 4, dash: 'solid', fill: '#fb923c', fillAlpha: 0 }, name: '' }));
    }
  }
  return out;
}
function answerText(spec) {
  const deg = spec.unit === '°';
  const ex = exactForm(spec.answer);
  const dec = +spec.answer.toFixed(2);
  const s = ex && ex !== String(dec) ? `${ex} (≈ ${dec})` : String(ex || dec);
  return (spec.question.includes('Find x') ? 'x = ' : '') + s + (deg ? '°' : '');
}
function checkPuzzle() {
  if (!puzzle) return;
  const inp = $('#pzInput'), res = $('#pzResult');
  const t = inp.value.trim();
  if (!t) { inp.focus(); return; }
  let v;
  try { v = compile(PZ.readAnswer(t))(0); } catch { v = NaN; }
  if (!isFinite(v)) { res.textContent = 'Type a number (you can use √ and π, like 3√2 or 9 − π)'; res.className = 'pz-result bad'; return; }
  puzzle.attempts++;
  if (PZ.isCorrect(v, puzzle.spec.answer)) {
    const first = !puzzle.solved;
    puzzle.solved = true;
    res.textContent = `✓ Correct! ${answerText(puzzle.spec)} — ${puzzle.spec.explain}`;
    res.className = 'pz-result good';
    if (first) {
      const prog = puzzleProgress();
      const today = PZ.todayStr();
      if (puzzle.spec.date === today && !prog.solved[today]) {
        const yest = PZ.todayStr(new Date(Date.now() - 86400000));
        prog.streak = prog.last === yest ? prog.streak + 1 : 1;
        prog.last = today;
      }
      prog.solved[puzzle.spec.date] = { attempts: puzzle.attempts };
      store.set('vf.puzzle', prog);
      confetti();
      toast(prog.streak > 1 && puzzle.spec.date === today ? `Solved! ${prog.streak}-day streak 🔥` : 'Solved! 🎉 Come back tomorrow for a new one');
    }
  } else {
    res.textContent = puzzle.attempts >= 3 ? `Not quite (${puzzle.attempts} tries). Try the hint — or show the answer.` : 'Not quite — try again!';
    res.className = 'pz-result bad';
    $('#pzInput').select();
  }
}
function confetti() {
  const box = el('div', { class: 'confetti' });
  const colors = ['#38bdf8', '#f472b6', '#facc15', '#34d399', '#a78bfa', '#fb923c'];
  for (let i = 0; i < 70; i++) {
    const s = el('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.4 + 's';
    s.style.animationDuration = 1.2 + Math.random() * 1.2 + 's';
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.append(s);
  }
  $('#stage').append(box);
  setTimeout(() => box.remove(), 3000);
}
$('#pzCheck').addEventListener('click', checkPuzzle);
$('#pzInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checkPuzzle(); } e.stopPropagation(); });
$('#pzHint').addEventListener('click', () => { if (!puzzle) return; $('#pzResult').textContent = '💡 ' + puzzle.spec.hint; $('#pzResult').className = 'pz-result'; });
$('#pzReveal').addEventListener('click', () => {
  if (!puzzle) return;
  confirmDialog('Show the answer?', 'You can still keep exploring afterwards.', 'Show it', () => { $('#pzResult').textContent = `Answer: ${answerText(puzzle.spec)} — ${puzzle.spec.explain}`; $('#pzResult').className = 'pz-result'; });
});
$('#pzExit').addEventListener('click', () => exitPuzzle());
$('.brand').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); puzzleMenu(r.left, r.bottom + 6); });
$('.brand').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } });

/* ======================= install & offline ======================= */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#btnInstall').hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('#btnInstall').hidden = true; toast('Installed! Vertex Forge now works offline too.'); });
async function installApp() {
  if (installPrompt) { installPrompt.prompt(); const r = await installPrompt.userChoice; if (r.outcome === 'accepted') $('#btnInstall').hidden = true; installPrompt = null; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openDialog({ title: 'Install Vertex Forge', build(b) { b.append(el('p', { text: ios ? 'In Safari, tap the Share button, then “Add to Home Screen”.' : 'Use your browser’s menu → “Install app” (or “Add to Home screen”). Once installed it opens in its own window and works offline.' }), el('p', { class: 'muted tiny', text: 'It already works offline in this browser after the first visit.' })); }, buttons: [{ label: 'OK', primary: true }] });
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready — it loads next time you open the app'); });
    });
  }).catch(() => { /* offline support unavailable */ });
}
window.addEventListener('offline', () => toast('You’re offline — everything still works'));

/* ======================= touch bar ======================= */

function applyTouchBar() {
  const show = S.touchButtons === 'always' || (S.touchButtons === 'auto' && document.body.classList.contains('touch'));
  $('#touchBar').hidden = !show;
}

/* ======================= wiring ======================= */

function polyIcon(n) {
  if (n === 1) return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
  if (n === 2) return '<svg viewBox="0 0 24 24"><path d="M3 17a9 9 0 0 1 18 0z"/></svg>';
  const pts = G.regularUnit(n).map(([u, v]) => `${(12 + u * 18).toFixed(2)},${(12 - v * 18 * G.regularAspect(n)).toFixed(2)}`);
  return `<svg viewBox="0 0 24 24"><polygon points="${pts.join(' ')}"/></svg>`;
}
function presetIcon(p) {
  if (p.kind === 'sector') return '<svg viewBox="0 0 24 24"><path d="M5 19 V5 A14 14 0 0 1 19 19 Z" stroke-linejoin="round"/></svg>';
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
  const allPresets = [{ id: 'sector', name: 'Circle sector (pie slice)', desc: 'Set its radius, angle or arc length.', kind: 'sector' }, ...PRESETS, { id: 'oval', name: 'Oval (ellipse)', desc: 'A stretched circle with two radii.', kind: 'ellipse' }];
  const draw = () => {
    const q = $('#presetSearch').value.trim().toLowerCase();
    list.innerHTML = '';
    for (const p of allPresets) {
      if (q && !`${p.name} ${p.desc}`.toLowerCase().includes(q)) continue;
      const b = el('button', { type: 'button', title: p.desc, html: presetIcon(p) });
      b.append(el('div', {}, el('div', { class: 'pname', text: p.name }), el('div', { class: 'pdesc', text: p.desc })));
      b.addEventListener('click', () => (p.kind === 'sector' ? insertSector() : insertPreset(p)));
      list.append(b);
    }
    if (!list.children.length) list.append(el('div', { class: 'muted tiny', text: 'No special shapes match.' }));
  };
  $('#presetSearch').addEventListener('input', draw);
  draw();
}

function toggleTool(key, btn) {
  if (puzzle) { toast('Measuring tools are off during the daily puzzle — work it out!', true); return; }
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
    showMenu([{ label: 'PNG image', action: exportPNG }, { label: 'SVG (vector, for print or editing)', action: exportSVG }, '-', { label: 'Worksheet / print…', action: printDialog }], r.left, r.bottom + 4);
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
  $('#tglExact').addEventListener('click', () => { setSetting('numberForm', S.numberForm === 'decimal' ? 'radical' : 'decimal'); toast(S.numberForm === 'decimal' ? 'Showing decimals' : 'Showing simplest radical form (√, π, fractions) when exact'); });
  $('#btnCmd').addEventListener('click', () => openCmd());
  $('#btnInstall').addEventListener('click', installApp);
  $('#btnData').addEventListener('click', dataDialog);
  $('#btnExamples').addEventListener('click', examplesDialog);
  $('#tbUndo').addEventListener('click', undo);
  $('#tbRedo').addEventListener('click', redo);
  $('#tbDelete').addEventListener('click', deleteSel);
  $('#tbMenu').addEventListener('click', (e) => { const o = single(); const r = e.currentTarget.getBoundingClientRect(); showMenu(o ? objectMenu(o) : canvasMenu({ x: view.cx, y: view.cy }), r.left - 160, r.top - 10); });
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
  if (!store.get('vf.toured') && S.tourOnStart) setTimeout(() => { if (!$('.overlay')) startTour(); }, 900);
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
window.__vf = { get puzzle() { return puzzle; }, PZ, enterPuzzle, exitPuzzle, get doc() { return doc; }, get sel() { return sel; }, view, S, G, C, transformSelection, snap, exportSVG, insertShape, insertPreset, insertSector, arcMetrics, doInscribe, byId, setSelection, encodeShare, decodeShare, loadDocData, W2S, S2W, toolsOn, render };
