// Geometry core: shape model, measurements, solvers and inscribing.
// Coordinates are world units with y pointing up.

export const EPS = 1e-9;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const rotPt = (p, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/* ---------- normalized outlines (u, v in [-0.5, 0.5]) ---------- */

// Regular n-gon with a flat bottom edge, normalized to its bounding box.
export function regularUnit(n) {
  const raw = [];
  const start = -Math.PI / 2 - Math.PI / n;
  for (let i = 0; i < n; i++) {
    const a = start + (TAU * i) / n;
    raw.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return normalizeRaw(raw);
}

// Height / width ratio of a regular n-gon's bounding box.
export function regularAspect(n) {
  const { w, h } = normalizeRaw(regularRawForAspect(n), true);
  return h / w;
}
function regularRawForAspect(n) {
  const raw = [];
  const start = -Math.PI / 2 - Math.PI / n;
  for (let i = 0; i < n; i++) {
    const a = start + (TAU * i) / n;
    raw.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return raw;
}

function normalizeRaw(raw, dimsOnly) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of raw) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const w = Math.max(x1 - x0, EPS), h = Math.max(y1 - y0, EPS);
  if (dimsOnly) return { w, h };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return raw.map((p) => [(p.x - cx) / w, (p.y - cy) / h]);
}

/* ---------- shape <-> world ---------- */

export function toWorld(o, u, v) {
  const lx = u * o.w, ly = v * o.h;
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return { x: o.cx + lx * c - ly * s, y: o.cy + lx * s + ly * c };
}
export function toLocal(o, p) {
  const dx = p.x - o.cx, dy = p.y - o.cy;
  const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function polyWorld(o) {
  return o.pts.map(([u, v]) => toWorld(o, u, v));
}

// Rebuild a polygon's frame (keeping its rotation) from world vertices.
export function setPolyFromWorld(o, world) {
  const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
  const loc = world.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of loc) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const lcx = (x0 + x1) / 2, lcy = (y0 + y1) / 2;
  const w = x1 - x0, h = y1 - y0;
  const center = rotPt({ x: lcx, y: lcy }, o.rot);
  o.cx = center.x; o.cy = center.y;
  o.w = Math.max(w, 1e-6); o.h = Math.max(h, 1e-6);
  o.pts = loc.map((p) => [w < 1e-6 ? 0 : (p.x - lcx) / w, h < 1e-6 ? 0 : (p.y - lcy) / h]);
}

// Dense closed outline (world) for any shape; polygons return exact vertices.
export function outline(o, samples = 180) {
  if (o.kind === 'polygon') return polyWorld(o);
  const out = [];
  if (o.kind === 'ellipse') {
    for (let i = 0; i < samples; i++) {
      const t = (TAU * i) / samples;
      out.push(toWorld(o, 0.5 * Math.cos(t), 0.5 * Math.sin(t)));
    }
  } else if (o.kind === 'semi') {
    const half = Math.ceil(samples / 2);
    for (let i = 0; i <= half; i++) {
      const t = (Math.PI * i) / half;
      out.push(toWorld(o, 0.5 * Math.cos(t), -0.5 + Math.sin(t)));
    }
  }
  return out;
}

export function ellipseRadii(o) {
  if (o.kind === 'semi') return { rx: o.w / 2, ry: o.h };
  return { rx: o.w / 2, ry: o.h / 2 };
}
export function isCircle(o) {
  const { rx, ry } = ellipseRadii(o);
  return Math.abs(rx - ry) < 1e-7 * Math.max(rx, ry, 1);
}

/* ---------- measurements ---------- */

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(pts) {
  const A = signedArea(pts);
  if (Math.abs(A) < EPS) {
    const s = pts.reduce((m, p) => ({ x: m.x + p.x, y: m.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / pts.length, y: s.y / pts.length };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

function ellipsePerimeter(a, b) {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

export function area(o) {
  if (o.kind === 'polygon') return Math.abs(signedArea(polyWorld(o)));
  const { rx, ry } = ellipseRadii(o);
  return o.kind === 'semi' ? (Math.PI * rx * ry) / 2 : Math.PI * rx * ry;
}

export function perimeter(o) {
  if (o.kind === 'polygon') return sideLengths(o).reduce((a, b) => a + b, 0);
  const { rx, ry } = ellipseRadii(o);
  const full = ellipsePerimeter(rx, ry);
  return o.kind === 'semi' ? full / 2 + 2 * rx : full;
}

export function sideLengths(o) {
  const p = polyWorld(o);
  if (p.length < 2) return [];
  if (p.length === 2) return [dist(p[0], p[1])];
  return p.map((a, i) => dist(a, p[(i + 1) % p.length]));
}

// Interior angles in degrees (handles concave vertices).
export function interiorAngles(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const ccw = signedArea(pts) > 0;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
    // angle measured from v2 to v1 going counter-clockwise for a CCW polygon
    let ang = Math.atan2(v1.y, v1.x) - Math.atan2(v2.y, v2.x);
    if (!ccw) ang = -ang;
    ang = ((ang % TAU) + TAU) % TAU;
    return ang / DEG;
  });
}

export function isSimple(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const c = pts[j], d = pts[(j + 1) % n];
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  return true;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
export function segmentsCross(a, b, c, d) {
  const d1 = orient(c, d, a), d2 = orient(c, d, b), d3 = orient(a, b, c), d4 = orient(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Signed distance: positive inside the polygon.
function insideDepth(p, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) d = Math.min(d, distToSeg(p, pts[i], pts[(i + 1) % pts.length]));
  return pointInPoly(p, pts) ? d : -d;
}

export function isConvex(pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const o = orient(pts[i], pts[(i + 1) % pts.length], pts[(i + 2) % pts.length]);
    if (Math.abs(o) < EPS) continue;
    if (!sign) sign = Math.sign(o);
    else if (Math.sign(o) !== sign) return false;
  }
  return true;
}

// Evenly spaced points along a closed outline (by arc length), starting at vertex 0.
export function pointsAlong(pts, count, closed = true) {
  if (count <= 0 || pts.length < 2) return [];
  const segs = [];
  let total = 0;
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = dist(a, b);
    segs.push({ a, b, L, s: total });
    total += L;
  }
  if (total < EPS) return [];
  const out = [];
  const step = closed ? total / count : total / Math.max(count - 1, 1);
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = Math.min(i * step, total);
    while (k < segs.length - 1 && segs[k].s + segs[k].L < s - 1e-12) k++;
    const g = segs[k];
    const t = g.L ? (s - g.s) / g.L : 0;
    out.push({ x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t });
  }
  return out;
}

/* ---------- solvers ---------- */

function ensureCCW(pts) {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts.slice();
}

function recenter(newPts, oldPts) {
  const c0 = centroid(oldPts), c1 = centroid(newPts);
  return newPts.map((p) => ({ x: p.x - c1.x + c0.x, y: p.y - c1.y + c0.y }));
}

// Find a polygon with the requested side lengths that stays close to the current shape.
export function solveSides(pts, lengths) {
  const n = pts.length;
  if (lengths.some((L) => !(L > 0) || !isFinite(L))) return { error: 'Every side length must be a positive number.' };
  if (n === 2) {
    const d = dist(pts[0], pts[1]) || 1;
    const m = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    const ux = (pts[1].x - pts[0].x) / d, uy = (pts[1].y - pts[0].y) / d;
    const h = lengths[0] / 2;
    return { pts: [{ x: m.x - ux * h, y: m.y - uy * h }, { x: m.x + ux * h, y: m.y + uy * h }] };
  }
  const total = lengths.reduce((a, b) => a + b, 0);
  const max = Math.max(...lengths);
  if (max >= total - max - 1e-9) {
    return { error: `Impossible shape: the longest side (${fmt(max)}) must be shorter than the sum of the others (${fmt(total - max)}).` };
  }
  let P = pts.map((p) => ({ ...p }));
  if (n === 3) {
    // Law of cosines, keeping the first edge's direction.
    const [a, b, c] = lengths; // a = |P0P1|, b = |P1P2|, c = |P2P0|
    const dir = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x);
    const ccw = signedArea(P) > 0 ? 1 : -1;
    const ang0 = Math.acos(Math.max(-1, Math.min(1, (a * a + c * c - b * b) / (2 * a * c))));
    const p0 = P[0];
    const p1 = { x: p0.x + a * Math.cos(dir), y: p0.y + a * Math.sin(dir) };
    const p2 = { x: p0.x + c * Math.cos(dir + ccw * ang0), y: p0.y + c * Math.sin(dir + ccw * ang0) };
    return { pts: recenter([p0, p1, p2], pts) };
  }
  // Iterative constraint projection (position based dynamics).
  const scale = total / Math.max(perimeterOf(P), EPS);
  const c0 = centroid(P);
  P = P.map((p) => ({ x: c0.x + (p.x - c0.x) * scale, y: c0.y + (p.y - c0.y) * scale }));
  for (let it = 0; it < 6000; it++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      const diff = (d - lengths[i]) / d / 2;
      worst = Math.max(worst, Math.abs(d - lengths[i]) / lengths[i]);
      a.x += dx * diff; a.y += dy * diff;
      b.x -= dx * diff; b.y -= dy * diff;
    }
    if (worst < 1e-12) break;
  }
  const err = Math.max(...P.map((a, i) => Math.abs(dist(a, P[(i + 1) % n]) - lengths[i]) / lengths[i]));
  if (err > 1e-6) return { error: 'Could not find a shape with those side lengths. Try values closer to the current ones.' };
  if (!isSimple(P)) return { error: 'Those side lengths make the shape cross over itself.' };
  return { pts: recenter(P, pts) };
}

function perimeterOf(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) s += dist(P[i], P[(i + 1) % P.length]);
  return s;
}

// Build a polygon from interior angles; sides in `locked` keep their value, the rest adjust.
export function solveAngles(pts, angles, lengths, locked) {
  const n = pts.length;
  if (n < 3) return { error: 'Angles can only be set on shapes with 3 or more sides.' };
  if (angles.some((a) => !(a > 0) || !(a < 360))) return { error: 'Every angle must be between 0° and 360°.' };
  const need = (n - 2) * 180;
  const sum = angles.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - need) > 1e-3) {
    return { error: `The angles of a ${n}-sided shape must add up to ${need}°, but these add up to ${fmt(sum)}°.` };
  }
  // absorb tiny rounding differences
  angles = angles.map((a) => a + (need - sum) / n);
  const ccw = signedArea(pts) > 0;
  const idx = pts.map((_, i) => (ccw ? i : (n - i) % n)); // new index -> old vertex
  const P = idx.map((i) => pts[i]);
  const flipped = !ccw;
  const ang = idx.map((i) => angles[i]);
  // side k (new) goes from new vertex k to k+1; old side i connects vertex i to i+1
  const oldSide = (k) => {
    const a = idx[k], b = idx[(k + 1) % n];
    return (a + 1) % n === b ? a : b;
  };
  const L0 = [], lock = [];
  for (let k = 0; k < n; k++) { const s = oldSide(k); L0.push(lengths[s]); lock.push(!!locked[s]); }
  // edge directions
  const dirs = [];
  let theta = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x);
  dirs.push(theta);
  for (let k = 1; k < n; k++) { theta += (180 - ang[k]) * DEG; dirs.push(theta); }
  const ex = dirs.map(Math.cos), ey = dirs.map(Math.sin);
  const free = [], fixed = [];
  for (let k = 0; k < n; k++) (lock[k] ? fixed : free).push(k);
  let rx = 0, ry = 0;
  for (const k of fixed) { rx -= L0[k] * ex[k]; ry -= L0[k] * ey[k]; }
  const L = L0.slice();
  if (free.length === 0) {
    if (Math.hypot(rx, ry) > 1e-6 * Math.max(...L0)) return { error: "These angles and side lengths don't fit together — the shape wouldn't close. Unlock (clear) at least two side lengths so they can adjust." };
  } else {
    // minimise sum (L_k - L0_k)^2 over free k subject to A L_free = r  (A is 2 x f)
    const a = free.map((k) => [ex[k], ey[k]]);
    const res = [rx, ry];
    for (let i = 0; i < 2; i++) for (const k of free) res[i] -= a[free.indexOf(k)][i] * L0[k];
    // M = A A^T
    let m00 = 0, m01 = 0, m11 = 0;
    for (const [x, y] of a) { m00 += x * x; m01 += x * y; m11 += y * y; }
    const det = m00 * m11 - m01 * m01;
    if (Math.abs(det) < 1e-10) {
      // Free sides are parallel: only solvable if residual is along them.
      const [x, y] = a[0];
      const along = res[0] * x + res[1] * y;
      if (Math.hypot(res[0] - along * x, res[1] - along * y) > 1e-6 * Math.max(...L0)) {
        return { error: "These angles and side lengths don't fit together. Unlock (clear) another side length that isn't parallel." };
      }
      // distribute along the free sides
      free.forEach((k, j) => { L[k] = L0[k] + (a[j][0] * res[0] + a[j][1] * res[1]) / (m00 + m11); });
    } else {
      const lx = (m11 * res[0] - m01 * res[1]) / det;
      const ly = (-m01 * res[0] + m00 * res[1]) / det;
      free.forEach((k, j) => { L[k] = L0[k] + a[j][0] * lx + a[j][1] * ly; });
    }
    if (free.length === 1) {
      const k = free[0];
      const cx = rx - L[k] * ex[k], cy = ry - L[k] * ey[k];
      if (Math.hypot(cx, cy) > 1e-6 * Math.max(...L0)) return { error: "These angles and side lengths don't fit together. Unlock (clear) at least two side lengths." };
    }
    if (free.some((k) => !(L[k] > 1e-9))) {
      return { error: "These angles can't form a valid shape with those side lengths (a side would need a zero or negative length)." };
    }
  }
  const out = [{ ...P[0] }];
  for (let k = 0; k < n - 1; k++) {
    const p = out[k];
    out.push({ x: p.x + L[k] * ex[k], y: p.y + L[k] * ey[k] });
  }
  if (!isSimple(out)) return { error: 'Those angles make the shape cross over itself, so it is not a valid polygon.' };
  let result = recenter(out, P);
  if (flipped) {
    const back = new Array(n);
    idx.forEach((oldI, newI) => { back[oldI] = result[newI]; });
    result = back;
  }
  return { pts: result };
}

export function isRegular(o, tol = 1e-6) {
  if (o.kind !== 'polygon') return false;
  const L = sideLengths(o), A = interiorAngles(polyWorld(o));
  const l0 = L[0];
  return L.every((l) => Math.abs(l - l0) <= tol * l0) && A.every((a) => Math.abs(a - A[0]) <= 1e-4);
}

export function fmt(x, d = 4) {
  if (!isFinite(x)) return '—';
  const s = x.toFixed(d);
  return d > 0 ? s.replace(/\.?0+$/, '') : s;
}

/* ---------- inscribing ---------- */

function triIncircle(p) {
  const a = dist(p[1], p[2]), b = dist(p[0], p[2]), c = dist(p[0], p[1]);
  const s = a + b + c;
  const x = (a * p[0].x + b * p[1].x + c * p[2].x) / s;
  const y = (a * p[0].y + b * p[1].y + c * p[2].y) / s;
  const r = (2 * Math.abs(signedArea(p))) / s;
  return { x, y, r };
}

// Largest circle inside a polygon (pole of inaccessibility, grid + refinement).
export function maxInscribedCircle(pts) {
  if (pts.length === 3) return triIncircle(pts);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  let best = { ...centroid(pts) };
  let bestD = insideDepth(best, pts);
  const G = 24;
  for (let i = 0; i <= G; i++) for (let j = 0; j <= G; j++) {
    const p = { x: x0 + ((x1 - x0) * i) / G, y: y0 + ((y1 - y0) * j) / G };
    const d = insideDepth(p, pts);
    if (d > bestD) { bestD = d; best = p; }
  }
  let step = Math.max(x1 - x0, y1 - y0) / G;
  while (step > 1e-10 * Math.max(x1 - x0, y1 - y0, 1)) {
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const a = (TAU * k) / 8;
      const p = { x: best.x + step * Math.cos(a), y: best.y + step * Math.sin(a) };
      const d = insideDepth(p, pts);
      if (d > bestD + 1e-15) { bestD = d; best = p; moved = true; }
    }
    if (!moved) step /= 2;
  }
  return { x: best.x, y: best.y, r: Math.max(bestD, 0) };
}

// Unit outlines (radius ~1, centered at origin) for candidate inscribed shapes.
function unitShape(kind, n, aspect) {
  if (kind === 'circle' || kind === 'ellipse' || (kind === 'ngon' && n === 1)) {
    const out = [];
    const ar = kind === 'ellipse' ? aspect : 1;
    for (let i = 0; i < 72; i++) { const t = (TAU * i) / 72; out.push({ x: Math.cos(t), y: ar * Math.sin(t) }); }
    return out;
  }
  if (kind === 'ngon' && n === 2) {
    const out = [];
    for (let i = 0; i <= 36; i++) { const t = (Math.PI * i) / 36; out.push({ x: Math.cos(t), y: Math.sin(t) - 0.5 }); }
    return out;
  }
  if (kind === 'rect' || kind === 'square') {
    const a = kind === 'square' ? 1 : aspect;
    return [{ x: -1, y: -a }, { x: 1, y: -a }, { x: 1, y: a }, { x: -1, y: a }];
  }
  const out = [];
  const start = -Math.PI / 2 - Math.PI / n;
  for (let i = 0; i < n; i++) { const t = start + (TAU * i) / n; out.push({ x: Math.cos(t), y: Math.sin(t) }); }
  return out;
}

function placed(unit, c, rot, s) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  return unit.map((p) => ({ x: c.x + s * (p.x * cs - p.y * sn), y: c.y + s * (p.x * sn + p.y * cs) }));
}

function fitsInside(pts, host, convex) {
  for (const p of pts) if (!pointInPoly(p, host)) return false;
  if (!convex) {
    for (let i = 0; i < pts.length; i++) for (let j = 0; j < host.length; j++) {
      if (segmentsCross(pts[i], pts[(i + 1) % pts.length], host[j], host[(j + 1) % host.length])) return false;
    }
  }
  return true;
}

function maxScale(unit, c, rot, host, convex, hi) {
  let lo = 0;
  if (!pointInPoly(c, host)) return 0;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (fitsInside(placed(unit, c, rot, mid), host, convex)) lo = mid; else hi = mid;
  }
  return lo;
}

// Maximise the area of a shape family inside the host polygon.
function optimizeInside(host, kind, n, frameRot) {
  const convex = isConvex(host);
  const mic = maxInscribedCircle(host);
  let span = 0;
  for (const p of host) span = Math.max(span, dist(p, mic));
  const hi = span * 2 + 1e-9;
  const hasAspect = kind === 'rect' || kind === 'ellipse';
  const areaOf = (s, asp) => s * s * (hasAspect ? asp : 1);
  const evalP = (x) => {
    const u = unitShape(kind, n, x.asp);
    const s = maxScale(u, { x: x.cx, y: x.cy }, x.rot, host, convex, hi);
    return { s, score: areaOf(s, x.asp) };
  };
  const rots = [frameRot];
  for (let i = 0; i < host.length && rots.length < 40; i++) {
    const a = host[i], b = host[(i + 1) % host.length];
    rots.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  const c = centroid(host);
  const starts = [];
  const asps = hasAspect ? [0.3, 0.6, 1, 1.7, 3.3] : [1];
  for (const r of rots) for (const ctr of [mic, c]) for (const asp of asps) starts.push({ cx: ctr.x, cy: ctr.y, rot: r, asp });
  const scored = starts.map((st) => ({ ...st, ...evalP(st) })).sort((a, b) => b.score - a.score);
  const keys = ['cx', 'cy'];
  if (kind !== 'circle') keys.push('rot');
  if (hasAspect) keys.push('asp');
  // Random-direction pattern search from the best few starts (seeded, so results are repeatable).
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let best = null;
  for (const st of scored.slice(0, 4)) {
    let cur = st;
    let step = 0.25;
    let fails = 0;
    for (let it = 0; it < 900 && step > 1e-7; it++) {
      const dir = keys.map(() => rnd() * 2 - 1);
      const L = Math.hypot(...dir) || 1;
      const cand = { cx: cur.cx, cy: cur.cy, rot: cur.rot, asp: cur.asp };
      keys.forEach((k, i) => {
        const d = (dir[i] / L) * step;
        if (k === 'cx' || k === 'cy') cand[k] += d * span;
        else if (k === 'rot') cand.rot += d * 2;
        else cand.asp = cur.asp * Math.exp(d * 2);
      });
      const e = evalP(cand);
      if (e.score > cur.score * (1 + 1e-10)) { cur = { ...cand, ...e }; fails = 0; step *= 1.3; }
      else if (++fails > 10 + keys.length * 3) { step /= 2; fails = 0; }
    }
    if (!best || cur.score > best.score) best = cur;
  }
  if (!(best.s > 0)) return null;
  return { pts: placed(unitShape(kind, n, best.asp), { x: best.cx, y: best.cy }, best.rot, best.s), rot: best.rot, center: { x: best.cx, y: best.cy }, s: best.s, asp: best.asp };
}

// Largest rectangle (or square) inside a convex polygon; the rectangle is aligned to `rot`.
function rectInConvex(host, rot, square) {
  const P = host.map((p) => rotPt(p, -rot));
  let xmin = Infinity, xmax = -Infinity;
  for (const p of P) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); }
  const span = xmax - xmin;
  if (!(span > EPS)) return null;
  const env = (x) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if ((a.x - x) * (b.x - x) > 0) continue;
      if (Math.abs(b.x - a.x) < EPS) { lo = Math.min(lo, a.y, b.y); hi = Math.max(hi, a.y, b.y); continue; }
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return [lo, hi];
  };
  const evalI = (x0, x1) => {
    if (!(x1 > x0) || x0 < xmin || x1 > xmax) return { score: -1 };
    const [l0, h0] = env(x0), [l1, h1] = env(x1);
    const bot = Math.max(l0, l1), top = Math.min(h0, h1);
    let w = x1 - x0, h = top - bot;
    if (!(h > 0)) return { score: -1 };
    if (square) { const s = Math.min(w, h); return { score: s * s, x0, x1: x0 + s, bot: bot + (h - s) / 2, top: bot + (h - s) / 2 + s }; }
    return { score: w * h, x0, x1, bot, top };
  };
  let best = { score: -1 };
  const N = 48;
  for (let i = 0; i <= N; i++) for (let j = i + 1; j <= N; j++) {
    const e = evalI(xmin + (span * i) / N, xmin + (span * j) / N);
    if (e.score > best.score) best = e;
  }
  if (best.score <= 0) return null;
  let step = span / N;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  while (step > span * 1e-12) {
    let moved = false;
    for (const [a, b] of dirs) {
      const e = evalI(best.x0 + a * step, (square ? best.x0 + (best.x1 - best.x0) : best.x1) + b * step);
      if (e.score > best.score * (1 + 1e-14)) { best = e; moved = true; }
    }
    if (!moved) step /= 2;
  }
  const corners = [{ x: best.x0, y: best.bot }, { x: best.x1, y: best.bot }, { x: best.x1, y: best.top }, { x: best.x0, y: best.top }];
  return { score: best.score, world: corners.map((p) => rotPt(p, rot)), rot };
}

function bestRectInConvex(host, frameRot, square) {
  const rots = [frameRot];
  for (let i = 0; i < host.length && rots.length < 60; i++) {
    const a = host[i], b = host[(i + 1) % host.length];
    rots.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  let best = null;
  for (const r of rots) { const e = rectInConvex(host, r, square); if (e && (!best || e.score > best.score * (1 + 1e-9))) best = e; }
  if (!best) return null;
  // local refinement of the rotation
  let step = 0.05;
  while (step > 1e-7) {
    let moved = false;
    for (const d of [step, -step]) {
      const e = rectInConvex(host, best.rot + d, square);
      if (e && e.score > best.score * (1 + 1e-12)) { best = e; moved = true; }
    }
    if (!moved) step /= 2;
  }
  return best;
}

// Returns a description of the new shape: {kind:'polygon', world, rot} or {kind:'ellipse'|'semi', cx, cy, w, h, rot}
export function inscribe(host, kind, n) {
  // kind: 'circle' | 'ellipse' | 'square' | 'rect' | 'ngon' (n = 1..20)
  if (kind === 'ngon' && n === 1) kind = 'circle';
  // Same number of sides as a polygon host: classic midpoint (medial) polygon.
  if (host.kind === 'polygon' && ((kind === 'ngon' && n === host.pts.length) || (kind === 'square' && host.pts.length === 4 && isRegular(host)))) {
    const P = polyWorld(host);
    const m = P.length;
    return { kind: 'polygon', world: P.map((p, i) => { const q = P[(i + 1) % m]; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; }), rot: host.rot };
  }
  if (kind === 'ngon' && n === 4) kind = 'square';
  const hostIsEllipse = host.kind === 'ellipse';
  if (hostIsEllipse) {
    const { rx, ry } = ellipseRadii(host);
    if (kind === 'circle') {
      const r = Math.min(rx, ry);
      return { kind: 'ellipse', cx: host.cx, cy: host.cy, w: 2 * r, h: 2 * r, rot: host.rot };
    }
    if (kind === 'ellipse') return { kind: 'ellipse', cx: host.cx, cy: host.cy, w: host.w * 0.7071, h: host.h * 0.7071, rot: host.rot };
    if (kind === 'rect' || (kind === 'square' && isCircle(host))) {
      const world = [0.25, 0.75, 1.25, 1.75].map((t) => toWorld(host, 0.5 * Math.cos(t * Math.PI), 0.5 * Math.sin(t * Math.PI)));
      return { kind: 'polygon', world, rot: host.rot };
    }
    if (kind === 'ngon' && n >= 3) {
      const world = [];
      const start = -Math.PI / 2 - Math.PI / n;
      for (let i = 0; i < n; i++) { const t = start + (TAU * i) / n; world.push(toWorld(host, 0.5 * Math.cos(t), 0.5 * Math.sin(t))); }
      return { kind: 'polygon', world, rot: host.rot };
    }
  }
  if (host.kind === 'semi' && kind === 'circle' && isCircle(host)) {
    const r = host.w / 4;
    const c = toWorld(host, 0, -0.5 + r / host.h);
    return { kind: 'ellipse', cx: c.x, cy: c.y, w: 2 * r, h: 2 * r, rot: host.rot };
  }
  const H = ensureCCW(outline(host, 120));
  if (H.length < 3 || Math.abs(signedArea(H)) < EPS) return { error: 'This shape has no area to inscribe into.' };
  if (kind === 'circle') {
    const m = maxInscribedCircle(H);
    if (!(m.r > 0)) return { error: 'Could not fit a circle inside this shape.' };
    return { kind: 'ellipse', cx: m.x, cy: m.y, w: 2 * m.r, h: 2 * m.r, rot: 0 };
  }
  if ((kind === 'rect' || kind === 'square') && isConvex(H)) {
    const b = bestRectInConvex(H, host.rot, kind === 'square');
    if (b) return { kind: 'polygon', world: b.world, rot: b.rot };
  }
  const r = optimizeInside(H, kind, n, host.rot);
  if (!r) return { error: 'Could not fit that shape inside.' };
  if (kind === 'ellipse') return { kind: 'ellipse', cx: r.center.x, cy: r.center.y, w: 2 * r.s, h: 2 * r.s * r.asp, rot: r.rot };
  if (kind === 'ngon' && n === 2) {
    const c = { x: r.center.x, y: r.center.y };
    // unit semicircle spans y in [-0.5, 0.5] with radius 1 → box w = 2s, h = s
    return { kind: 'semi', cx: c.x, cy: c.y, w: 2 * r.s, h: r.s, rot: r.rot };
  }
  return { kind: 'polygon', world: r.pts, rot: r.rot };
}
