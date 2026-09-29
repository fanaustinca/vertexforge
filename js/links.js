// Links: permanent relationships between sides and angles.
//   equal       — segments keep equal lengths
//   parallel    — segments stay parallel
//   perp        — two segments stay perpendicular
//   equalAngle  — angles stay equal
// A reference is one of:
//   {t:'side', o, i}    side i (vertex i -> i+1) of polygon o
//   {t:'line', o}       a line object
//   {t:'vangle', o, i}  interior angle at vertex i of polygon o
//   {t:'angle', o}      an angle-marker object
// Whichever member the user changed last "drives"; the others are adjusted to match.
import * as G from './geom.js';

export const SEG_KINDS = ['equal', 'parallel', 'perp'];
export const isSegRef = (r) => r.t === 'side' || r.t === 'line';
export const isAngRef = (r) => r.t === 'vangle' || r.t === 'angle';

const TAU = Math.PI * 2;
const normPi = (a) => ((a % Math.PI) + Math.PI) % Math.PI;
const diffPi = (a, b) => { const d = Math.abs(normPi(a) - normPi(b)); return Math.min(d, Math.PI - d); };

export function segEnds(ref, byId) {
  const o = byId(ref.o);
  if (!o) return null;
  if (ref.t === 'line' && o.type === 'line') return [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }];
  if (ref.t === 'side' && o.type === 'shape' && o.kind === 'polygon' && ref.i < o.pts.length) {
    const W = G.polyWorld(o);
    return [W[ref.i], W[(ref.i + 1) % W.length]];
  }
  return null;
}
export function angleOf(ref, byId) {
  const o = byId(ref.o);
  if (!o) return null;
  if (ref.t === 'vangle' && o.type === 'shape' && o.kind === 'polygon' && ref.i < o.pts.length) return G.interiorAngles(G.polyWorld(o))[ref.i];
  if (ref.t === 'angle' && o.type === 'angle') {
    const a1 = Math.atan2(o.ay - o.vy, o.ax - o.vx), a2 = Math.atan2(o.by - o.vy, o.bx - o.vx);
    let d = Math.abs(a1 - a2) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    return o.reflex ? 360 - d : d;
  }
  return null;
}
function read(ref, byId) {
  if (isSegRef(ref)) {
    const e = segEnds(ref, byId);
    if (!e) return null;
    return { len: Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y), dir: Math.atan2(e[1].y - e[0].y, e[1].x - e[0].x) };
  }
  const a = angleOf(ref, byId);
  return a == null ? null : { deg: a };
}
const sig = (v) => (v.deg != null ? [v.deg] : [v.len, normPi(v.dir)]);
const sigChanged = (a, b) => !b || a.some((x, i) => Math.abs(x - b[i]) > 1e-9 * Math.max(1, Math.abs(x)));

// Enforce all links together. Every point that belongs to a linked item is a variable, except points
// that are locked or being dragged. We take minimum-norm Gauss-Newton steps, so all links hold at once
// while everything moves as little as possible. Whatever the user just changed (or a locked member)
// keeps its value.
// `mem` (Map) remembers each link's last values so we know what the user changed.
// busy = {id, vertex} | {id, end} | {id, k}: the handle being dragged right now (never moved).
// Returns {invalid: [link ids whose members no longer exist], touched: Set of object ids moved}.
export function solveLinks(links, byId, mem, busy = null) {
  const invalid = [];
  const live = [];
  for (const L of links) {
    if (L.refs.length < 2 || L.refs.some((r) => !read(r, byId))) invalid.push(L.id);
    else live.push(L);
  }
  const touched = new Set();
  if (!live.length) return { invalid, touched };

  // ---- state: points of every object involved ----
  const objs = new Map(); // id -> {o, pts:[{x,y}], kind}
  for (const L of live) for (const r of L.refs) {
    if (objs.has(r.o)) continue;
    const o = byId(r.o);
    if (o.type === 'shape') objs.set(r.o, { o, kind: 'poly', pts: G.polyWorld(o) });
    else if (o.type === 'line') objs.set(r.o, { o, kind: 'line', pts: [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }] });
    else objs.set(r.o, { o, kind: 'angle', pts: [{ x: o.ax, y: o.ay }, { x: o.vx, y: o.vy }, { x: o.bx, y: o.by }] });
  }
  let scale = 0;
  for (const { pts } of objs.values()) for (const p of pts) scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
  for (const { pts } of objs.values()) for (let i = 1; i < pts.length; i++) scale = Math.max(scale, Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y));
  scale = scale || 1;

  // measure a reference on the working state
  const meas = (r) => {
    const st = objs.get(r.o);
    const P = st.pts;
    if (r.t === 'side' || r.t === 'line') {
      const a = r.t === 'line' ? P[0] : P[r.i], b = r.t === 'line' ? P[1] : P[(r.i + 1) % P.length];
      return { len: Math.hypot(b.x - a.x, b.y - a.y), dir: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    if (r.t === 'vangle') return { deg: G.interiorAngles(P)[r.i] };
    const [A, V, B] = P;
    let d = Math.abs(Math.atan2(A.y - V.y, A.x - V.x) - Math.atan2(B.y - V.y, B.x - V.x)) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    return { deg: st.o.reflex ? 360 - d : d };
  };

  // ---- which member drives each link ----
  const drivers = live.map((L) => {
    const prev = mem.get(L.id) || [];
    const sigs = L.refs.map((r) => sig(meas(r)));
    const lockedIdx = L.refs.findIndex((r) => byId(r.o)?.locked);
    let d = lockedIdx >= 0 ? lockedIdx : sigs.findIndex((sg, i) => sigChanged(sg, prev[i]));
    if (d < 0) d = 0;
    return { d, val: meas(L.refs[d]) };
  });

  const residuals = () => {
    const r = [];
    live.forEach((L, li) => {
      const m = L.refs.map(meas);
      const m0 = m[0];
      for (let i = 1; i < m.length; i++) {
        if (L.kind === 'equal') r.push(m[i].len - m0.len);
        else if (L.kind === 'parallel') r.push(Math.sin(m[i].dir - m0.dir) * scale);
        else if (L.kind === 'perp') r.push(Math.cos(m[i].dir - m0.dir) * scale);
        else r.push((m[i].deg - m0.deg) * Math.PI / 180 * scale);
      }
      // the driving member keeps the value the user gave it
      const { d, val } = drivers[li];
      const md = m[d];
      if (L.kind === 'equal') r.push(md.len - val.len);
      else if (L.kind === 'parallel' || L.kind === 'perp') r.push(Math.sin(md.dir - val.dir) * scale);
      else r.push((md.deg - val.deg) * Math.PI / 180 * scale);
    });
    return r;
  };

  // Secondary goals (only pursued inside the freedom the links leave): followers keep their other
  // properties — a side made parallel keeps its length, a side made equal keeps its direction,
  // and an angle that is matched keeps the lengths of its arms.
  const keep = [];
  live.forEach((L, li) => L.refs.forEach((rf, i) => {
    if (i === drivers[li].d) return;
    const st = objs.get(rf.o);
    const P = st.pts;
    if (rf.t === 'side' || rf.t === 'line') {
      const m0 = meas(rf);
      if (L.kind === 'equal') keep.push(() => Math.sin(meas(rf).dir - m0.dir) * scale);
      else keep.push(() => meas(rf).len - m0.len);
    } else if (rf.t === 'vangle') {
      const n = P.length, k = rf.i;
      for (const j of [(k - 1 + n) % n, k]) { const a = P[j], b = P[(j + 1) % n]; const L0 = Math.hypot(b.x - a.x, b.y - a.y); keep.push(() => { const Q = objs.get(rf.o).pts; return Math.hypot(Q[(j + 1) % n].x - Q[j].x, Q[(j + 1) % n].y - Q[j].y) - L0; }); }
    } else {
      const [A, V, B] = P; const la = Math.hypot(A.x - V.x, A.y - V.y), lb = Math.hypot(B.x - V.x, B.y - V.y);
      keep.push(() => { const [A2, V2] = objs.get(rf.o).pts; return Math.hypot(A2.x - V2.x, A2.y - V2.y) - la; });
      keep.push(() => { const [, V2, B2] = objs.get(rf.o).pts; return Math.hypot(B2.x - V2.x, B2.y - V2.y) - lb; });
    }
  }));
  const keepRes = () => keep.map((f) => f());

  const tol = 1e-13 * scale;
  let r = residuals();
  let err = Math.hypot(...r);
  if (err <= tol) { rememberSigs(); return { invalid, touched }; }

  // ---- variables: every point except locked objects and the dragged handle ----
  const vars = []; // {st, i, c:'x'|'y'}
  for (const [id, st] of objs) {
    if (st.o.locked) continue;
    st.pts.forEach((p, i) => {
      if (busy && busy.id === id) {
        if (busy.vertex === i && st.kind === 'poly') return;
        if (busy.end && st.kind === 'line' && busy.end - 1 === i) return;
        if (busy.k && st.kind === 'angle' && ['a', 'v', 'b'][i] === busy.k) return;
      }
      vars.push({ st, i, c: 'x' }, { st, i, c: 'y' });
    });
  }
  if (!vars.length) { rememberSigs(); return { invalid, touched }; }
  const get = () => vars.map((v) => v.st.pts[v.i][v.c]);
  const set = (x) => vars.forEach((v, k) => { v.st.pts[v.i] = { ...v.st.pts[v.i], [v.c]: x[k] }; });
  const jac = (fn, x, base) => {
    const m = base.length, n = x.length;
    const J = Array.from({ length: m }, () => new Float64Array(n));
    for (let k = 0; k < n; k++) {
      const save = x[k];
      x[k] = save + h; set(x);
      const r2 = fn();
      for (let i = 0; i < m; i++) J[i][k] = (r2[i] - base[i]) / h;
      x[k] = save;
    }
    set(x);
    return J;
  };
  // (M Mᵀ + λI)⁻¹ v, for a small m×n matrix M
  const gramSolve = (M, v) => {
    const m = M.length, n = M[0]?.length || 0;
    const A = Array.from({ length: m }, () => new Float64Array(m));
    for (let i = 0; i < m; i++) for (let j = i; j < m; j++) { let s = 0; for (let k = 0; k < n; k++) s += M[i][k] * M[j][k]; A[i][j] = A[j][i] = s; }
    let tr = 0; for (let i = 0; i < m; i++) tr += A[i][i];
    const lam = 1e-9 * (tr / Math.max(m, 1)) + 1e-300;
    for (let i = 0; i < m; i++) A[i][i] += lam;
    return solveSym(A, Array.from(v));
  };
  const tmul = (M, y) => { const n = M[0].length; const out = new Float64Array(n); for (let i = 0; i < M.length; i++) for (let k = 0; k < n; k++) out[k] += M[i][k] * y[i]; return out; };

  let x = get();
  const h = 1e-7 * scale;
  for (let it = 0; it < 60; it++) {
    const J1 = jac(residuals, x, r);
    const y1 = gramSolve(J1, r);
    if (!y1) break;
    const d1 = tmul(J1, y1).map((v) => -v);
    let d2 = null;
    if (keep.length) {
      // secondary step inside the null space of J1:  M = J2 − (J2 J1ᵀ)(J1 J1ᵀ)⁻¹ J1
      const r2 = keepRes();
      const J2 = jac(keepRes, x, r2);
      const n = x.length;
      const r2p = r2.map((v, i) => v + J2[i].reduce((s, jv, k) => s + jv * d1[k], 0));
      const M = J2.map((row) => {
        const c = gramSolve(J1, J1.map((j1row) => j1row.reduce((s, v, k) => s + v * row[k], 0)));
        const out = Float64Array.from(row);
        if (c) for (let i = 0; i < J1.length; i++) for (let k = 0; k < n; k++) out[k] -= c[i] * J1[i][k];
        return out;
      });
      const y2 = gramSolve(M, r2p);
      if (y2) d2 = tmul(M, y2).map((v) => -v);
    }
    // try the combined step first; fall back to the pure link step if it doesn't help
    let done = false, used = null;
    for (const step of d2 ? [d1.map((v, k) => v + d2[k]), d1] : [d1]) {
      let t = 1;
      while (t > 1e-4) {
        const xn = x.map((v, k) => v + step[k] * t);
        set(xn);
        const rn = residuals(), en = Math.hypot(...rn);
        if (en <= Math.max(err * (1 - 1e-6), tol)) { x = xn; r = rn; err = en; done = true; used = step; break; }
        t /= 2;
      }
      set(x);
      if (done) break;
    }
    if (!done) break;
    if (err <= tol && Math.hypot(...used) < 1e-9 * scale) break;
  }
  // write back (a polygon must stay a proper, non-crossing polygon)
  for (const [id, st] of objs) {
    const o = st.o;
    if (st.kind === 'poly') {
      const W0 = G.polyWorld(o);
      if (st.pts.every((p, i) => p.x === W0[i].x && p.y === W0[i].y)) continue;
      if (!G.isSimple(st.pts)) continue;
      G.setPolyFromWorld(o, st.pts);
    } else if (st.kind === 'line') {
      const [a, b] = st.pts;
      if (a.x === o.x1 && a.y === o.y1 && b.x === o.x2 && b.y === o.y2) continue;
      Object.assign(o, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    } else {
      const [A, V, B] = st.pts;
      if (A.x === o.ax && A.y === o.ay && V.x === o.vx && V.y === o.vy && B.x === o.bx && B.y === o.by) continue;
      Object.assign(o, { ax: A.x, ay: A.y, vx: V.x, vy: V.y, bx: B.x, by: B.y });
    }
    touched.add(id);
  }
  rememberSigs();
  return { invalid, touched };

  function rememberSigs() {
    for (const L of live) mem.set(L.id, L.refs.map((rf) => { const v = read(rf, byId); return v ? sig(v) : null; }));
  }
}

// Solve a small symmetric positive-definite system (Gaussian elimination with partial pivoting).
function solveSym(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    if (Math.abs(A[p][c]) < 1e-300) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let i = c + 1; i < n; i++) {
      const f = A[i][c] / A[c][c];
      if (!f) continue;
      for (let j = c; j < n; j++) A[i][j] -= f * A[c][j];
      b[i] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}

export function linkLabel(L) {
  return { equal: 'Equal lengths', parallel: 'Parallel', perp: 'Perpendicular', equalAngle: 'Equal angles' }[L.kind] || 'Link';
}
