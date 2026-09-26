// Construction geometry: triangle centers, enclosing circles, intersections,
// nearest-point projection and shape classification.
import * as G from './geom.js';

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function footOnLine(p, a, b) {
  const d = sub(b, a);
  const L = d.x * d.x + d.y * d.y || 1e-300;
  const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / L;
  return { x: a.x + d.x * t, y: a.y + d.y * t, t };
}

export function circumcircle(A, B, C) {
  const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(d) < 1e-300) return null;
  const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
  const x = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d;
  const y = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
  return { x, y, r: Math.hypot(A.x - x, A.y - y) };
}

// All the classic centers of a triangle.
export function triangleCenters([A, B, C]) {
  const a = G.dist(B, C), b = G.dist(A, C), c = G.dist(A, B);
  const s = a + b + c;
  const cen = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };
  const O = circumcircle(A, B, C);
  const I = { x: (a * A.x + b * B.x + c * C.x) / s, y: (a * A.y + b * B.y + c * C.y) / s };
  const r = (2 * Math.abs(G.signedArea([A, B, C]))) / s;
  const H = O ? { x: A.x + B.x + C.x - 2 * O.x, y: A.y + B.y + C.y - 2 * O.y } : null;
  const N = O ? mid(O, H) : null;
  return { G: cen, O, R: O?.r, I, r, H, N, nr: O ? O.r / 2 : null };
}

export function medians([A, B, C]) {
  return [[A, mid(B, C)], [B, mid(A, C)], [C, mid(A, B)]];
}
export function altitudes(T) {
  return T.map((p, i) => {
    const a = T[(i + 1) % 3], b = T[(i + 2) % 3];
    const f = footOnLine(p, a, b);
    // when the foot is outside the side, also return the extension of the side
    const ext = f.t < 0 ? [a, f] : f.t > 1 ? [b, f] : null;
    return { seg: [p, { x: f.x, y: f.y }], ext };
  });
}
export function angleBisectors(T) {
  return T.map((p, i) => {
    const B = T[(i + 1) % 3], C = T[(i + 2) % 3];
    const b = G.dist(p, C), c = G.dist(p, B);
    return [p, { x: (b * B.x + c * C.x) / (b + c), y: (b * B.y + c * C.y) / (b + c) }];
  });
}
// Perpendicular bisectors drawn from each side midpoint through the circumcenter (a bit beyond).
export function perpBisectors(T) {
  const O = circumcircle(...T);
  return T.map((p, i) => {
    const q = T[(i + 1) % 3];
    const m = mid(p, q);
    const d = sub(q, p);
    const n = G.dist(p, q) || 1;
    const u = { x: -d.y / n, y: d.x / n };
    let lo = -n / 4, hi = n / 4;
    if (O) {
      const t = (O.x - m.x) * u.x + (O.y - m.y) * u.y;
      lo = Math.min(lo, t * 1.15); hi = Math.max(hi, t * 1.15);
    }
    return [add(m, mul(u, lo)), add(m, mul(u, hi))];
  });
}

// Smallest circle containing all points (Welzl, iterative, deterministic shuffle).
export function minEnclosingCircle(pts) {
  const P = pts.map((p) => ({ x: p.x, y: p.y }));
  let seed = 7;
  for (let i = P.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [P[i], P[j]] = [P[j], P[i]];
  }
  const inside = (c, p) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r * (1 + 1e-12) + 1e-12;
  const two = (a, b) => ({ ...mid(a, b), r: G.dist(a, b) / 2 });
  let c = { x: P[0].x, y: P[0].y, r: 0 };
  for (let i = 1; i < P.length; i++) {
    if (inside(c, P[i])) continue;
    c = { x: P[i].x, y: P[i].y, r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(c, P[j])) continue;
      c = two(P[i], P[j]);
      for (let k = 0; k < j; k++) {
        if (inside(c, P[k])) continue;
        c = circumcircle(P[i], P[j], P[k]) || c;
      }
    }
  }
  return c;
}

/* ---------- intersections ---------- */

// Segment-like pieces: {a, b, t0, t1} where the piece is a + t(b - a) for t in [t0, t1].
export function intersectPieces(p, q) {
  const r = sub(p.b, p.a), s = sub(q.b, q.a);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-14 * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) return null;
  const qp = sub(q.a, p.a);
  const t = (qp.x * s.y - qp.y * s.x) / den;
  const u = (qp.x * r.y - qp.y * r.x) / den;
  const e = 1e-9;
  if (t < p.t0 - e || t > p.t1 + e || u < q.t0 - e || u > q.t1 + e) return null;
  return { x: p.a.x + r.x * t, y: p.a.y + r.y * t };
}

// Ellipse description {c, rx, ry, rot, half}; half = upper half only (semicircle arc).
export function ellipseOf(o) {
  if (o.kind === 'ellipse') return { c: { x: o.cx, y: o.cy }, rx: o.w / 2, ry: o.h / 2, rot: o.rot, half: false };
  if (o.kind === 'semi') return { c: G.toWorld(o, 0, -0.5), rx: o.w / 2, ry: o.h, rot: o.rot, half: true };
  return null;
}
function toUnit(E, p) { const l = G.rotPt(sub(p, E.c), -E.rot); return { x: l.x / E.rx, y: l.y / E.ry }; }
function fromUnit(E, u) { return add(E.c, G.rotPt({ x: u.x * E.rx, y: u.y * E.ry }, E.rot)); }

// Exact intersections of a straight piece with an ellipse (or semicircle arc).
export function pieceEllipse(piece, E) {
  const a = toUnit(E, piece.a), b = toUnit(E, piece.b);
  const d = sub(b, a);
  const A = d.x * d.x + d.y * d.y, B = 2 * (a.x * d.x + a.y * d.y), C = a.x * a.x + a.y * a.y - 1;
  const disc = B * B - 4 * A * C;
  if (A < 1e-300 || disc < 0) return [];
  const out = [];
  for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) {
    if (t < piece.t0 - 1e-9 || t > piece.t1 + 1e-9) continue;
    const u = { x: a.x + d.x * t, y: a.y + d.y * t };
    if (E.half && u.y < -1e-9) continue;
    out.push(fromUnit(E, u));
  }
  return out;
}

// Nearest point on an ellipse (or its upper half) to p.
export function nearestOnEllipse(E, p) {
  const l = G.rotPt(sub(p, E.c), -E.rot);
  let t = Math.atan2(l.y / E.ry, l.x / E.rx);
  for (let i = 0; i < 12; i++) {
    const c = Math.cos(t), s = Math.sin(t);
    const f = (E.ry * E.ry - E.rx * E.rx) * c * s + l.x * E.rx * s - l.y * E.ry * c;
    const df = (E.ry * E.ry - E.rx * E.rx) * (c * c - s * s) + l.x * E.rx * c + l.y * E.ry * s;
    if (Math.abs(df) < 1e-300) break;
    const nt = t - f / df;
    if (!isFinite(nt)) break;
    t = nt;
  }
  if (E.half) { t = ((t % G.TAU) + G.TAU) % G.TAU; if (t > Math.PI) t = t > 1.5 * Math.PI ? 0 : Math.PI; }
  return add(E.c, G.rotPt({ x: E.rx * Math.cos(t), y: E.ry * Math.sin(t) }, E.rot));
}

export function nearestOnPiece(p, piece) {
  const d = sub(piece.b, piece.a);
  const L = d.x * d.x + d.y * d.y || 1e-300;
  let t = ((p.x - piece.a.x) * d.x + (p.y - piece.a.y) * d.y) / L;
  t = Math.max(piece.t0, Math.min(piece.t1, t));
  return { x: piece.a.x + d.x * t, y: piece.a.y + d.y * t };
}

/* ---------- classification ---------- */

export function classify(o) {
  if (o.kind === 'ellipse') return G.isCircle(o) ? 'Circle' : 'Ellipse (oval)';
  if (o.kind === 'semi') return G.isCircle(o) ? 'Semicircle' : 'Half-ellipse';
  const P = G.polyWorld(o);
  const n = P.length;
  const L = G.sideLengths(o);
  const A = G.interiorAngles(P);
  const tolL = 1e-7 * Math.max(...L), tolA = 1e-6;
  const eqL = (x, y) => Math.abs(x - y) <= tolL;
  const eqA = (x, y) => Math.abs(x - y) <= tolA;
  const convex = G.isConvex(P);
  const simple = G.isSimple(P);
  if (!simple) return `Self-crossing ${n}-gon`;
  if (n === 3) {
    const eqCount = [eqL(L[0], L[1]), eqL(L[1], L[2]), eqL(L[0], L[2])].filter(Boolean).length;
    const bySide = eqCount >= 2 ? 'equilateral' : eqCount === 1 ? 'isosceles' : 'scalene';
    const mx = Math.max(...A);
    const byAng = eqA(mx, 90) ? 'right' : mx > 90 ? 'obtuse' : 'acute';
    if (bySide === 'equilateral') return 'Equilateral triangle';
    return `${byAng[0].toUpperCase() + byAng.slice(1)} ${bySide} triangle`;
  }
  if (n === 4) {
    if (!convex) {
      const kite = (eqL(L[0], L[1]) && eqL(L[2], L[3])) || (eqL(L[1], L[2]) && eqL(L[3], L[0]));
      return kite ? 'Dart (concave kite)' : 'Concave quadrilateral';
    }
    const allL = L.every((l) => eqL(l, L[0]));
    const allA = A.every((a) => eqA(a, 90));
    const par = (i) => {
      const u = sub(P[(i + 1) % 4], P[i]), v = sub(P[(i + 3) % 4], P[(i + 2) % 4]);
      return Math.abs(u.x * v.y - u.y * v.x) <= 1e-7 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    };
    const p0 = par(0), p1 = par(1);
    if (allL && allA) return 'Square';
    if (allA) return 'Rectangle';
    if (allL) return 'Rhombus';
    if (p0 && p1) return 'Parallelogram';
    if ((eqL(L[0], L[1]) && eqL(L[2], L[3])) || (eqL(L[1], L[2]) && eqL(L[3], L[0]))) return 'Kite';
    if (p0 || p1) {
      const legsEq = p0 ? eqL(L[1], L[3]) : eqL(L[0], L[2]);
      const right = A.some((a) => eqA(a, 90));
      return legsEq ? 'Isosceles trapezoid' : right ? 'Right trapezoid' : 'Trapezoid';
    }
    return 'Irregular quadrilateral';
  }
  const names = { 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon', 9: 'nonagon', 10: 'decagon', 12: 'dodecagon' };
  const nm = names[n] || `${n}-gon`;
  if (G.isRegular(o, 1e-7)) return `Regular ${nm}`;
  if (L.every((l) => eqL(l, L[0]))) return `Equilateral ${convex ? '' : 'concave '}${nm}`;
  return `${convex ? 'Irregular' : 'Concave'} ${nm}`;
}

/* ---------- tangents & arcs ---------- */

export function ellipsePoint(E, t) {
  return add(E.c, G.rotPt({ x: E.rx * Math.cos(t), y: E.ry * Math.sin(t) }, E.rot));
}
// Parameter angle (radians) of the point on the ellipse nearest to p.
export function ellipseParam(E, p) {
  const u = toUnit(E, p);
  return Math.atan2(u.y, u.x);
}

// Tangent points on an ellipse for tangent lines through an outside point p.
export function tangentsFrom(E, p) {
  const u = toUnit(E, p);
  const d = Math.hypot(u.x, u.y);
  if (d < 1 - 1e-12) return { inside: true, points: [] };
  if (d <= 1 + 1e-12) return { on: true, points: [fromUnit(E, { x: u.x / d, y: u.y / d })] };
  const th = Math.atan2(u.y, u.x), al = Math.acos(1 / d);
  const pts = [th - al, th + al].map((a) => ({ x: Math.cos(a), y: Math.sin(a) })).filter((q) => !E.half || q.y >= -1e-12).map((q) => fromUnit(E, q));
  return { points: pts };
}

// Tangent line at the point of the ellipse nearest to q: {p, d} (point + unit direction).
export function tangentAt(E, q) {
  const t = ellipseParam(E, q);
  const p = ellipsePoint(E, t);
  const d = G.rotPt({ x: -E.rx * Math.sin(t), y: E.ry * Math.cos(t) }, E.rot);
  const L = Math.hypot(d.x, d.y) || 1;
  return { p, d: { x: d.x / L, y: d.y / L }, t };
}

// Points along an ellipse arc from parameter t0 sweeping `sweep` radians.
export function arcPoints(E, t0, sweep, n = 96) {
  const out = [];
  const k = Math.max(2, Math.ceil(n * Math.abs(sweep) / (2 * Math.PI)) + 1);
  for (let i = 0; i <= k; i++) out.push(ellipsePoint(E, t0 + (sweep * i) / k));
  return out;
}
