// Graph types beyond y = f(x): implicit curves, inequalities, parametric and polar curves,
// plus numeric calculus (integrals, roots, turning points, intersections).
import { compileVars, PARAM_RE } from './expr.js';

// Split at a top-level comparison/equals sign.
function splitRel(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0) {
      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=') return { lhs: s.slice(0, i), op: two, rhs: s.slice(i + 2) };
      if (c === '≤') return { lhs: s.slice(0, i), op: '<=', rhs: s.slice(i + 1) };
      if (c === '≥') return { lhs: s.slice(0, i), op: '>=', rhs: s.slice(i + 1) };
      if (c === '<' || c === '>' || c === '=') return { lhs: s.slice(0, i), op: c, rhs: s.slice(i + 1) };
    }
  }
  return null;
}
function splitTopComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return null;
}

// Work out what kind of graph some typed text is. Returns a descriptor:
//   {mode:'func', expr}           y = f(x)
//   {mode:'implicit', F}          F(x, y) = 0      e.g. x^2 + y^2 = 9
//   {mode:'ineq', F, op}          F(x, y) op 0     e.g. y > x^2, x^2 + y^2 <= 4
//   {mode:'param', X, Y, t0, t1}  (X(t), Y(t))
//   {mode:'polar', R, t0, t1}     r = R(θ)
export function classifyGraph(text) {
  let s = text.trim();
  // optional range: "..., t from 0 to 10" / "for θ from 0 to 4pi" / "t = 0..10"
  let t0 = null, t1 = null;
  s = s.replace(/[,;]?\s*(?:for\s+)?(?:t|θ|theta)\s*(?:from|=|in)\s*\[?\s*([^\s,\]]+?)\s*(?:to|\.\.|,)\s*([^\s\]]+)\s*\]?\s*$/i, (_, a, b) => { t0 = a; t1 = b; return ''; }).trim();
  const bare = (x) => x.replace(/\s+/g, '');
  // parametric: a parenthesised pair
  if (/^\(.*\)$/.test(s)) {
    const inner = s.slice(1, -1);
    const parts = splitTopComma(inner);
    if (parts && !splitTopComma(parts[1])) return { mode: 'param', X: parts[0].trim(), Y: parts[1].trim(), t0: t0 ?? '0', t1: t1 ?? '2pi' };
  }
  const rel = splitRel(s);
  if (!rel) return { mode: 'func', expr: s };
  const lhs = rel.lhs.trim(), rhs = rel.rhs.trim();
  if (!lhs || !rhs) throw new Error('Something is missing on one side of the ' + rel.op);
  if (rel.op === '=') {
    if (/^y$/i.test(bare(lhs)) && !/\by\b/i.test(rhs.replace(/[a-z]{2,}/gi, ''))) return { mode: 'func', expr: rhs };
    if (/^f\(x\)$/i.test(bare(lhs))) return { mode: 'func', expr: rhs };
    if (/^r$/i.test(bare(lhs))) return { mode: 'polar', R: rhs, t0: t0 ?? '0', t1: t1 ?? '2pi' };
    return { mode: 'implicit', F: `(${lhs}) - (${rhs})` };
  }
  return { mode: 'ineq', F: `(${lhs}) - (${rhs})`, op: rel.op };
}

// Compile a descriptor; params = live slider values. Throws with .unknown for missing sliders.
export function compileGraph(d, params) {
  if (d.mode === 'implicit' || d.mode === 'ineq') return { F: compileVars(d.F, ['x', 'y'], params) };
  if (d.mode === 'param') {
    const X = compileVars(d.X, ['t'], params), Y = compileVars(d.Y, ['t'], params);
    return { X, Y, t0: compileVars(d.t0, [], params)(), t1: compileVars(d.t1, [], params)() };
  }
  if (d.mode === 'polar') {
    const R = compileVars(d.R.replace(/\bt\b/g, 'θ'), ['theta'], params);
    return { R, t0: compileVars(d.t0, [], params)(), t1: compileVars(d.t1, [], params)() };
  }
  return null;
}
// Collect every unknown letter in a descriptor (so the app can make sliders).
export function unknownLetters(d, params) {
  const found = new Set();
  const tryCompile = (src, vars) => { try { compileVars(src, vars, params); } catch (e) { if (e.unknown) e.unknown.forEach((u) => found.add(u)); else throw e; } };
  if (d.mode === 'func') tryCompile(d.expr, ['x']);
  else if (d.mode === 'implicit' || d.mode === 'ineq') tryCompile(d.F, ['x', 'y']);
  else if (d.mode === 'param') { tryCompile(d.X, ['t']); tryCompile(d.Y, ['t']); tryCompile(d.t0, []); tryCompile(d.t1, []); }
  else if (d.mode === 'polar') { tryCompile(d.R.replace(/\bt\b/g, 'θ'), ['theta']); tryCompile(d.t0, []); tryCompile(d.t1, []); }
  return [...found].filter((u) => PARAM_RE.test(u));
}

// ---------- marching squares: segments of F(x, y) = 0 inside a world rectangle ----------
// grid: {x0, x1, y0, y1, nx, ny}. Returns [[{x,y},{x,y}], ...]
export function contour(F, g) {
  const { x0, x1, y0, y1, nx, ny } = g;
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const val = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    let v; try { v = F(x0 + i * dx, y0 + j * dy); } catch { v = NaN; }
    val[j * (nx + 1) + i] = v;
  }
  const V = (i, j) => val[j * (nx + 1) + i];
  const segs = [];
  // crossing on an edge between two grid points; refined by bisection, rejecting poles
  const cross = (xa, ya, va, xb, yb, vb) => {
    let lo = { x: xa, y: ya, v: va }, hi = { x: xb, y: yb, v: vb };
    for (let k = 0; k < 18; k++) {
      const mx = (lo.x + hi.x) / 2, my = (lo.y + hi.y) / 2;
      let mv; try { mv = F(mx, my); } catch { mv = NaN; }
      if (!isFinite(mv)) return null;
      if (Math.sign(mv) === Math.sign(lo.v)) lo = { x: mx, y: my, v: mv }; else hi = { x: mx, y: my, v: mv };
    }
    const m = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
    // a sign change through infinity (like 1/x) is a pole, not a curve
    let mv; try { mv = F(m.x, m.y); } catch { mv = NaN; }
    if (!isFinite(mv) || Math.abs(mv) > 0.5 * Math.min(Math.abs(va), Math.abs(vb)) + 1e-9) return null;
    return m;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
    if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(d))) continue;
    const xa = x0 + i * dx, ya = y0 + j * dy, xb = xa + dx, yb = ya + dy;
    const pts = [];
    if ((a > 0) !== (b > 0)) pts.push(cross(xa, ya, a, xb, ya, b));
    if ((b > 0) !== (c > 0)) pts.push(cross(xb, ya, b, xb, yb, c));
    if ((c > 0) !== (d > 0)) pts.push(cross(xb, yb, c, xa, yb, d));
    if ((d > 0) !== (a > 0)) pts.push(cross(xa, yb, d, xa, ya, a));
    const ok = pts.filter(Boolean);
    if (ok.length === 2) segs.push(ok);
    else if (ok.length === 4) { // saddle: pair up by the centre value
      let cv; try { cv = F(xa + dx / 2, ya + dy / 2); } catch { cv = 0; }
      if ((cv > 0) === (a > 0)) segs.push([ok[0], ok[3]], [ok[1], ok[2]]); else segs.push([ok[0], ok[1]], [ok[2], ok[3]]);
    }
  }
  return segs;
}

// Cells where an inequality holds, as horizontal runs [{x0, x1, y0, y1}] for shading.
export function inequalityRuns(F, op, g) {
  const { x0, x1, y0, y1, nx, ny } = g;
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const holds = (v) => (op === '<' ? v < 0 : op === '<=' ? v <= 0 : op === '>' ? v > 0 : v >= 0);
  const runs = [];
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * dy;
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      let ok = false;
      if (i < nx) { try { const v = F(x0 + (i + 0.5) * dx, y); ok = isFinite(v) && holds(v); } catch { ok = false; } }
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) { runs.push({ x0: x0 + start * dx, x1: x0 + i * dx, y0: y0 + j * dy, y1: y0 + (j + 1) * dy }); start = -1; }
    }
  }
  return runs;
}

// Points of a parametric / polar curve (world coordinates), split where it jumps or is undefined.
export function sampleCurve(fn, t0, t1, n = 1200, jump = Infinity) {
  const runs = [];
  let run = null, prev = null;
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    let p; try { p = fn(t); } catch { p = null; }
    if (!p || !isFinite(p.x) || !isFinite(p.y)) { run = null; prev = null; continue; }
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > jump) run = null;
    if (!run) { run = []; runs.push(run); }
    run.push(p);
    prev = p;
  }
  return runs;
}

// ---------- calculus ----------
// Adaptive Simpson integration.
export function integrate(f, a, b, tol = 1e-11) {
  if (a === b) return 0;
  const sign = a < b ? 1 : -1;
  if (a > b) [a, b] = [b, a];
  const S = (fa, fm, fb, h) => (h / 6) * (fa + 4 * fm + fb);
  let bad = false;
  const F = (x) => { const v = f(x); if (!isFinite(v)) bad = true; return v; };
  const rec = (a0, b0, fa, fm, fb, whole, eps, depth) => {
    const m = (a0 + b0) / 2, lm = (a0 + m) / 2, rm = (m + b0) / 2;
    const flm = F(lm), frm = F(rm);
    const left = S(fa, flm, fm, m - a0), right = S(fm, frm, fb, b0 - m);
    if (depth > 40 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return rec(a0, m, fa, flm, fm, left, eps / 2, depth + 1) + rec(m, b0, fm, frm, fb, right, eps / 2, depth + 1);
  };
  // split into pieces so narrow features aren't missed
  const pieces = 16;
  let total = 0;
  for (let k = 0; k < pieces; k++) {
    const x0 = a + ((b - a) * k) / pieces, x1 = a + ((b - a) * (k + 1)) / pieces;
    const fa = F(x0), fb = F(x1), fm = F((x0 + x1) / 2);
    total += rec(x0, x1, fa, fm, fb, S(fa, fm, fb, x1 - x0), tol / pieces, 0);
  }
  if (bad || !isFinite(total)) throw new Error('The function isn’t defined everywhere between those limits');
  return sign * total;
}

function bisect(f, a, b, fa) {
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (!isFinite(fm)) return null;
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
    if (b - a < 1e-15 * Math.max(1, Math.abs(m))) break;
  }
  return (a + b) / 2;
}
// Roots of f in [a, b]: sign changes (not poles) plus touching roots found as small |f| minima.
export function roots(f, a, b, n = 4000) {
  const out = [];
  const safe = (x) => { try { return f(x); } catch { return NaN; } };
  let px = a, pv = safe(a);
  const vals = [pv];
  for (let i = 1; i <= n; i++) {
    const x = a + ((b - a) * i) / n, v = safe(x);
    vals.push(v);
    if (isFinite(pv) && isFinite(v)) {
      if (v === 0) out.push(x);
      else if (pv !== 0 && Math.sign(v) !== Math.sign(pv)) {
        const r = bisect(safe, px, x, pv);
        if (r != null && Math.abs(safe(r)) < 1e-6 * Math.max(1, Math.abs(pv), Math.abs(v))) out.push(r);
      }
    }
    px = x; pv = v;
  }
  // touching roots (like x^2 at 0): local minima of |f| that reach ~0
  for (let i = 1; i < n; i++) {
    const l = Math.abs(vals[i - 1]), m = Math.abs(vals[i]), r = Math.abs(vals[i + 1]);
    if (m < l && m <= r && Math.sign(vals[i - 1]) === Math.sign(vals[i + 1])) {
      let lo = a + ((b - a) * (i - 1)) / n, hi = a + ((b - a) * (i + 1)) / n;
      for (let k = 0; k < 100; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (Math.abs(safe(m1)) < Math.abs(safe(m2))) hi = m2; else lo = m1; }
      const x = (lo + hi) / 2;
      if (Math.abs(safe(x)) < 1e-9) out.push(x);
    }
  }
  out.sort((p, q) => p - q);
  return out.filter((x, i) => i === 0 || Math.abs(x - out[i - 1]) > 1e-7 * Math.max(1, Math.abs(x)));
}
// Turning points (local max / min) of f in [a, b].
export function extrema(f, a, b, n = 4000) {
  const d = (x) => { const h = 1e-5 * Math.max(1, Math.abs(x)); return (f(x + h) - f(x - h)) / (2 * h); };
  const out = [];
  for (const x of roots(d, a, b, n)) {
    let y; try { y = f(x); } catch { continue; }
    if (!isFinite(y)) continue;
    const h = 1e-3 * Math.max(1, Math.abs(x));
    const l = f(x - h), r = f(x + h);
    if (l < y && r < y) out.push({ x, y, kind: 'max' });
    else if (l > y && r > y) out.push({ x, y, kind: 'min' });
  }
  return out;
}
