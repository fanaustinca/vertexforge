// Command bar: turns short typed commands into descriptors the app can execute.
//   "triangle 3 4 5", "circle r=2 at (1,1)", "regular 7 side 3", "line (0,0) (4,3)", "y = x^2", ...
import { compile, PARAM_RE } from './expr.js';

const DEG = Math.PI / 180;
const NGON = { triangle: 3, square: 4, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, nonagon: 9, decagon: 10, hendecagon: 11, dodecagon: 12 };

export const SUGGESTIONS = [
  ['triangle 3 4 5', 'Triangle from three side lengths'],
  ['triangle sas 5 60 4', 'Triangle from side, angle (°), side'],
  ['triangle asa 50 6 70', 'Triangle from angle, side, angle'],
  ['right triangle 3 4', 'Right triangle from its two legs'],
  ['equilateral 4', 'Equilateral triangle with this side'],
  ['isosceles 5 6', 'Isosceles triangle: leg, base'],
  ['square 3', 'Square with this side'],
  ['rectangle 4 2', 'Rectangle: width, height'],
  ['rhombus 3 60', 'Rhombus: side, angle (°)'],
  ['parallelogram 4 2 60', 'Parallelogram: base, side, angle (°)'],
  ['trapezoid 6 3 2', 'Isosceles trapezoid: bottom, top, height'],
  ['regular 7 side 3', 'Regular polygon (3–20 sides) with a side length'],
  ['hexagon r 2', 'Regular polygon by name, with circumradius'],
  ['circle 2', 'Circle with radius 2'],
  ['circle r=2 at (1,1)', 'Circle with a radius and center'],
  ['semicircle 2', 'Semicircle with radius 2'],
  ['sector 3 60', 'Circle sector: radius, angle (°)'],
  ['sector r=3 arc=pi', 'Circle sector from its arc length'],
  ['ellipse 3 2', 'Ellipse (oval): horizontal and vertical radius'],
  ['polygon (0,0) (4,0) (3,3) (0,2)', 'Polygon through the given corners'],
  ['point A (2,3)', 'A labelled point'],
  ['line (0,0) (4,3)', 'Line segment between two points'],
  ['ray (0,0) (1,1)', 'Ray starting at the first point'],
  ['infinite line (0,0) (1,2)', 'Line through two points'],
  ['angle (3,0) (0,0) (0,3)', 'Angle mark: arm, vertex, arm'],
  ['y = x^2 - 3', 'Graph a function'],
  ['x^2 + y^2 = 9', 'Curve from an equation in x and y'],
  ['y > x^2', 'Shade an inequality'],
  ['r = 1 + cos(θ)', 'Polar curve'],
  ['(cos(t), sin(2t))', 'Parametric curve'],
  ['solve x^2 - 5x + 6 = 0', 'Solve an equation'],
  ['derivative x^3 - 3x', 'Graph a derivative'],
  ['integrate x^2 from 0 to 2', 'Work out a definite integral'],
  ['normal 0 1', 'Normal distribution curve'],
  ['data', 'Data & statistics'], ['examples', 'Ready-made example graphs'], ['clear traces', 'Remove traced trails'],
  ['slider a 0 10', 'Slider named a (from 0 to 10)'],
  ['a = 2', 'Set slider a (creates it if needed)'],
  ['text Hello at (0,4)', 'Text label'],
  ['grid 0.5', 'Grid spacing (or: grid on / grid off)'],
  ['axes off', 'Hide or show the axes'],
  ['exact on', 'Simplest radical form on/off'],
  ['zoom fit', 'Zoom to fit everything (or: zoom in / zoom out / reset)'],
  ['theme light', 'Light or dark theme'],
  ['undo', 'Undo'], ['redo', 'Redo'],
  ['select all', 'Select everything'], ['delete', 'Delete the selection'],
  ['share', 'Share with a code'], ['save', 'Save locally'], ['open', 'Open a saved graph'],
  ['export svg', 'Download SVG (or: export png)'], ['print', 'Worksheet / print mode'],
  ['settings snap', 'Open settings (with a search)'], ['help sliders', 'Open help (with a search)'],
  ['tour', 'Take the quick tour'], ['new', 'Start a new graph'],
  ['tool line', 'Switch tool: select, pan, line, point, shape, polygon, angle, link, text, measure'],
];

export function suggest(text, limit = 8) {
  const q = text.trim().toLowerCase();
  if (!q) return SUGGESTIONS.slice(0, limit);
  const words = q.split(/\s+/);
  const scored = [];
  for (const [cmd, desc] of SUGGESTIONS) {
    const hay = (cmd + ' ' + desc).toLowerCase();
    if (!words.every((w) => hay.includes(w) || /^[\d.()=,*\-+^/]+$/.test(w))) continue;
    scored.push([cmd.startsWith(words[0]) ? 0 : 1, cmd, desc]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, c, d]) => [c, d]);
}

function num(s, what = 'number') {
  let v;
  try { v = compile(String(s))(0); } catch { v = NaN; }
  if (!isFinite(v)) throw new Error(`“${s}” isn’t a ${what}`);
  return v;
}
const pos = (v, what) => { if (!(v > 0)) throw new Error(`The ${what} must be greater than 0`); return v; };

function regular(n, side) {
  const R = side / (2 * Math.sin(Math.PI / n));
  const out = [];
  const start = -Math.PI / 2 - Math.PI / n;
  for (let i = 0; i < n; i++) { const a = start + (2 * Math.PI * i) / n; out.push({ x: R * Math.cos(a), y: R * Math.sin(a) }); }
  return out;
}
function tri(A, B, C) { return [A, B, C]; }

export function parseCommand(raw) {
  let text = raw.trim().replace(/[×]/g, '*').replace(/°/g, '');
  if (!text) throw new Error('Type a command, e.g. triangle 3 4 5');
  // functions first (keep the expression untouched)
  let m = /^(?:y\s*=|f\s*\(\s*x\s*\)\s*=|graph\s+|plot\s+)(.+)$/i.exec(text);
  if (m) return { do: 'func', expr: /^(graph|plot)/i.test(text) ? m[1].trim() : text };
  m = /^solve\s+(.+)$/i.exec(text);
  if (m) return { do: 'solve', eq: m[1].trim() };
  m = /^(?:derivative|d\/dx|diff)\s+(?:of\s+)?(.+)$/i.exec(text);
  if (m) return { do: 'deriv', expr: m[1].trim() };
  m = /^(?:integrate|integral)\s+(.+?)\s+from\s+(\S+)\s+to\s+(\S+)\s*$/i.exec(text);
  if (m) return { do: 'integrate', expr: m[1].trim(), a: m[2], b: m[3] };
  m = /^normal\s+(\S+)\s+(\S+)\s*$/i.exec(text);
  if (m) return { do: 'func', expr: `normalpdf(x, ${m[1]}, ${m[2]})` };
  // polar, parametric, implicit curves and inequalities go straight to the grapher
  if (/^r\s*=.*(θ|theta|\bt\b)/i.test(text) || /^\(.*\bt\b.*,.*\)/.test(text) || (/[<>≤≥]/.test(text) && /\b[xy]\b/.test(text)) || (/=/.test(text) && /\by\b/.test(text) && /\bx\b/.test(text))) return { do: 'func', expr: text };
  // named point: "A = (1, 2)" (any right-hand side with a comma is a point)
  m = /^([A-Za-z][\w']{0,3})\s*=\s*(\(.+\))\s*$/.exec(text);
  if (m && m[2].includes(',')) return parseCommand(`point ${m[1]} ${m[2]}`);
  // slider value: "a = 3" / "a = pi/2"
  m = /^([a-z])\s*=\s*(.+)$/i.exec(text);
  if (m && PARAM_RE.test(m[1].toLowerCase())) return { do: 'slider', name: m[1].toLowerCase(), value: num(m[2]) };

  // pull out points "(x, y)"
  const points = [];
  text = text.replace(/\(\s*([^(),]+(?:\([^()]*\))?[^(),]*)\s*,\s*([^(),]+(?:\([^()]*\))?[^(),]*)\s*\)/g, (_, a, b) => { points.push({ x: num(a, 'coordinate'), y: num(b, 'coordinate') }); return ` @${points.length - 1} `; });
  let at = null, rot = 0;
  text = text.replace(/\b(?:at|center|centre)\s+@(\d+)/i, (_, i) => { at = points[+i]; points[+i] = null; return ' '; });
  text = text.replace(/\b(?:rotated|rotate|rot)\s+(\S+)/i, (_, v) => { rot = num(v, 'angle'); return ' '; });
  const pts = points.filter(Boolean);
  const lower = text.toLowerCase().replace(/\s+/g, ' ').trim();
  // key=value pairs
  const kv = {};
  const rest = lower.replace(/\b(r|d|side|s|radius|diameter|w|h|angle|arc|a|start)\s*=\s*(\S+)/g, (_, k, v) => { kv[k] = num(v); return ' '; });
  const words = rest.split(/[\s,]+/).filter((w) => w && !/^@\d+$/.test(w));
  const [w0 = '', w1 = ''] = words;
  const nums = () => words.filter((w) => /^[-+\d.(]|^(pi|sqrt|phi|tau|e$)/.test(w) && !/^(r|d|s|side|radius)$/.test(w)).map((w) => num(w));
  const shape = (kind, extra) => ({ do: 'shape', kind, at, rot, ...extra });

  // ----- actions -----
  const ACT = { puzzle: 'puzzle', install: 'install', data: 'data', stats: 'data', statistics: 'data', examples: 'examples', gallery: 'examples', undo: 'undo', redo: 'redo', share: 'share', save: 'save', open: 'open', print: 'print', worksheet: 'print', tour: 'tour', new: 'new', clear: 'new', delete: 'delete' };
  if (ACT[w0] && words.length === 1) return { do: 'action', name: ACT[w0] };
  if (w0 === 'select' && w1 === 'all') return { do: 'action', name: 'selectAll' };
  if (w0 === 'clear' && w1 === 'traces') return { do: 'action', name: 'traces' };
  if (w0 === 'zoom' || w0 === 'fit' || (w0 === 'reset' && w1 === 'view')) return { do: 'action', name: 'zoom', arg: w0 === 'fit' ? 'fit' : w0 === 'reset' ? 'reset' : w1 || 'fit' };
  if (w0 === 'grid') {
    if (w1 === 'on' || w1 === 'off') return { do: 'action', name: 'grid', arg: w1 === 'on' };
    if (!w1) return { do: 'action', name: 'grid', arg: 'toggle' };
    return { do: 'action', name: 'gridSize', arg: pos(num(w1), 'grid spacing') };
  }
  if (w0 === 'axes' || w0 === 'axis') return { do: 'action', name: 'axes', arg: w1 !== 'off' };
  if (w0 === 'exact' || w0 === 'radical' || w0 === 'radicals') return { do: 'action', name: 'exact', arg: w1 !== 'off' };
  if (w0 === 'theme') return { do: 'action', name: 'theme', arg: w1 === 'light' ? 'light' : 'dark' };
  if (w0 === 'dark' || w0 === 'light') return { do: 'action', name: 'theme', arg: w0 };
  if (w0 === 'export') return { do: 'action', name: 'export', arg: w1 === 'svg' ? 'svg' : 'png' };
  if (w0 === 'settings' || w0 === 'help') return { do: 'action', name: w0, arg: raw.trim().slice(w0.length).trim() };
  if (w0 === 'tool') return { do: 'action', name: 'tool', arg: w1 };

  // ----- objects -----
  if (w0 === 'slider') {
    if (!PARAM_RE.test(w1)) throw new Error('Slider names are single letters (not x, y or e), e.g. slider a 0 10');
    const n = words.slice(2).map((w) => num(w));
    return { do: 'slider', name: w1, min: n[0], max: n[1], value: n[2] };
  }
  if (w0 === 'text' || w0 === 'label') {
    const t = raw.trim().replace(/^(text|label)\s+/i, '').replace(/\s+(at|center)\s*\([^)]*\)\s*$/i, '').replace(/^["“](.*)["”]$/, '$1');
    if (!t) throw new Error('Add the text, e.g. text Hello at (0,4)');
    return { do: 'text', text: t, at };
  }
  if (w0 === 'point' || (words.length === 0 && pts.length === 1) || (words.length === 1 && pts.length === 1 && /^[A-Za-z][\w']{0,3}$/.test(words[0]) && w0 !== 'point')) {
    const p = pts[0] || at;
    if (!p) throw new Error('Give the point’s coordinates, e.g. point (2, 3)');
    const label = w0 === 'point' ? (raw.trim().match(/^point\s+([A-Za-z][\w']{0,3})\s*\(/i)?.[1] || '') : (words[0] && words[0] !== 'point' ? raw.trim().split(/\s|\(/)[0] : '');
    return { do: 'point', p, label };
  }
  if (['line', 'segment', 'seg', 'ray', 'infinite'].includes(w0)) {
    if (pts.length < 2) throw new Error('A line needs two points, e.g. line (0,0) (4,3)');
    const ext = w0 === 'ray' ? 'ray' : w0 === 'infinite' || w1 === 'through' ? 'line' : 'segment';
    return { do: 'line', a: pts[0], b: pts[1], ext };
  }
  if (w0 === 'polygon' || w0 === 'poly' || (w0 === 'triangle' && pts.length === 3)) {
    if (pts.length < 3) throw new Error('A polygon needs at least 3 corners, e.g. polygon (0,0) (4,0) (2,3)');
    return { do: 'polygon', pts };
  }
  if (w0 === 'angle') {
    if (pts.length !== 3) throw new Error('An angle needs three points: arm, vertex, arm');
    return { do: 'angle', a: pts[0], v: pts[1], b: pts[2] };
  }

  // ----- shapes by measurements -----
  if (w0 === 'right' || (w0 === 'triangle' && w1 === 'right')) {
    const [a, b] = nums();
    pos(a, 'first leg'); pos(b, 'second leg');
    return shape('polygon', { name: 'Right triangle', pts: tri({ x: 0, y: 0 }, { x: a, y: 0 }, { x: 0, y: b }) });
  }
  if (w0 === 'equilateral') {
    const [s] = nums(); pos(s, 'side');
    return shape('polygon', { name: 'Equilateral triangle', pts: tri({ x: 0, y: 0 }, { x: s, y: 0 }, { x: s / 2, y: s * Math.sqrt(3) / 2 }) });
  }
  if (w0 === 'isosceles') {
    const [leg, base] = nums(); pos(leg, 'leg'); pos(base, 'base');
    if (leg <= base / 2) throw new Error('The legs must be longer than half the base');
    return shape('polygon', { name: 'Isosceles triangle', pts: tri({ x: 0, y: 0 }, { x: base, y: 0 }, { x: base / 2, y: Math.sqrt(leg * leg - base * base / 4) }) });
  }
  if (w0 === 'triangle' || w0 === 'tri') {
    const mode = ['sss', 'sas', 'asa'].includes(w1) ? w1 : 'sss';
    const v = nums();
    if (v.length === 1 && mode === 'sss') return parseCommand(`equilateral ${v[0]}`);
    if (v.length < 3) throw new Error('Give three values, e.g. triangle 3 4 5, triangle sas 5 60 4 or triangle asa 50 6 70');
    if (mode === 'sss') {
      const [c, a, b] = v; // AB, BC, CA
      [a, b, c].forEach((x) => pos(x, 'side'));
      const mx = Math.max(a, b, c);
      if (mx >= a + b + c - mx) throw new Error(`No triangle has sides ${v.join(', ')} — the longest side must be shorter than the other two added together`);
      const cosA = (b * b + c * c - a * a) / (2 * b * c);
      const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
      return shape('polygon', { name: 'Triangle', pts: tri({ x: 0, y: 0 }, { x: c, y: 0 }, { x: b * Math.cos(A), y: b * Math.sin(A) }) });
    }
    if (mode === 'sas') {
      const [b, Adeg, c] = v; pos(b, 'side'); pos(c, 'side');
      if (!(Adeg > 0 && Adeg < 180)) throw new Error('The angle must be between 0 and 180°');
      return shape('polygon', { name: 'Triangle', pts: tri({ x: 0, y: 0 }, { x: c, y: 0 }, { x: b * Math.cos(Adeg * DEG), y: b * Math.sin(Adeg * DEG) }) });
    }
    const [Adeg, c, Bdeg] = v; pos(c, 'side');
    const Cdeg = 180 - Adeg - Bdeg;
    if (!(Adeg > 0 && Bdeg > 0 && Cdeg > 0)) throw new Error('The two angles must be positive and add up to less than 180°');
    const b = (c * Math.sin(Bdeg * DEG)) / Math.sin(Cdeg * DEG);
    return shape('polygon', { name: 'Triangle', pts: tri({ x: 0, y: 0 }, { x: c, y: 0 }, { x: b * Math.cos(Adeg * DEG), y: b * Math.sin(Adeg * DEG) }) });
  }
  if (w0 === 'square') {
    const s = kv.side ?? kv.s ?? nums()[0]; pos(s, 'side');
    return shape('polygon', { name: 'Square', pts: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }] });
  }
  if (w0 === 'rectangle' || w0 === 'rect') {
    const wx = /(\S+)\s*x\s*(\S+)/.exec(rest);
    const [w, h] = wx ? [num(wx[1]), num(wx[2])] : [kv.w ?? nums()[0], kv.h ?? nums()[1]];
    pos(w, 'width'); pos(h, 'height');
    return shape('polygon', { name: 'Rectangle', pts: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] });
  }
  if (w0 === 'rhombus' || w0 === 'parallelogram') {
    const v = nums();
    const [a, b, t] = w0 === 'rhombus' ? [v[0], v[0], v[1] ?? 60] : [v[0], v[1], v[2] ?? 60];
    pos(a, 'side'); pos(b, 'side');
    if (!(t > 0 && t < 180)) throw new Error('The angle must be between 0 and 180°');
    const dx = b * Math.cos(t * DEG), dy = b * Math.sin(t * DEG);
    return shape('polygon', { name: w0 === 'rhombus' ? 'Rhombus' : 'Parallelogram', pts: [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a + dx, y: dy }, { x: dx, y: dy }] });
  }
  if (w0 === 'trapezoid' || w0 === 'trapezium') {
    const [a, b, h] = nums(); pos(a, 'bottom'); pos(b, 'top'); pos(h, 'height');
    return shape('polygon', { name: 'Isosceles trapezoid', pts: [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: (a + b) / 2, y: h }, { x: (a - b) / 2, y: h }] });
  }
  let n = NGON[w0] ?? (/^(\d+)-?gon$/.exec(w0) ? +/^(\d+)/.exec(w0)[1] : null);
  let sizeWords = words.slice(1);
  if (w0 === 'regular') { n = num(w1); sizeWords = words.slice(2); }
  if (n != null) {
    if (!(n >= 3 && n <= 20 && Number.isInteger(n))) throw new Error('Regular polygons have 3 to 20 sides');
    let side;
    const R = kv.r ?? kv.radius ?? (/^(r|radius)$/.test(sizeWords[0]) ? num(sizeWords[1]) : null);
    if (R != null) side = 2 * pos(R, 'radius') * Math.sin(Math.PI / n);
    else side = kv.side ?? kv.s ?? num((/^(side|s)$/.test(sizeWords[0]) ? sizeWords[1] : sizeWords[0]) ?? 'nan');
    pos(side, 'side');
    return shape('polygon', { name: '', regularN: n, pts: regular(n, side) });
  }
  if (w0 === 'sector' || w0 === 'pie' || w0 === 'wedge') {
    const n = nums();
    const r = kv.r ?? kv.radius ?? n[0];
    pos(r, 'radius');
    let deg = kv.angle ?? kv.a ?? n[1];
    if (kv.arc != null) deg = (pos(kv.arc, 'arc length') / r) * 180 / Math.PI;
    if (deg == null) deg = 60;
    if (!(deg > 0 && deg <= 360)) throw new Error(kv.arc != null ? 'That arc is longer than the whole circle' : 'The angle must be between 0° and 360°');
    if (!at && pts.length) at = pts[0];
    return { do: 'sector', at, rot, r, deg, start: kv.start ?? 0 };
  }
  if (w0 === 'circle') {
    let r = kv.r ?? kv.radius ?? (kv.d != null ? kv.d / 2 : kv.diameter != null ? kv.diameter / 2 : nums()[0]);
    if (!at && pts.length) at = pts[0];
    pos(r, 'radius');
    return shape('ellipse', { rx: r, ry: r });
  }
  if (w0 === 'semicircle') {
    const r = kv.r ?? nums()[0]; pos(r, 'radius');
    if (!at && pts.length) at = pts[0];
    return shape('semi', { rx: r, ry: r });
  }
  if (w0 === 'ellipse' || w0 === 'oval') {
    const [rx, ry] = nums(); pos(rx, 'horizontal radius'); pos(ry, 'vertical radius');
    if (!at && pts.length) at = pts[0];
    return shape('ellipse', { rx, ry });
  }
  throw new Error(`I don’t know “${words[0] || raw.trim()}”. Try: triangle 3 4 5 · circle 2 · regular 6 side 2 · y = x^2 · help`);
}
