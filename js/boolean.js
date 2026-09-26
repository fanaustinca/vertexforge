// Areas of overlapping shapes: intersection area (and so union / difference areas) of two
// polygons, exact for polygons of any shape via triangulation + convex clipping,
// plus the exact lens formula for two circles.
import * as G from './geom.js';

const ccw = (P) => (G.signedArea(P) < 0 ? P.slice().reverse() : P.slice());
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// Ear-clipping triangulation of a simple polygon.
export function triangulate(pts) {
  const P = ccw(pts);
  const idx = P.map((_, i) => i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = P[i0], b = P[i1], c = P[i2];
      if (cross(a, b, c) <= 1e-14 * (Math.abs(a.x) + Math.abs(a.y) + 1)) continue; // reflex or flat
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = P[j];
        if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate input; stop gracefully
  }
  if (idx.length === 3) tris.push(idx.map((i) => P[i]));
  return tris;
}

// Sutherland–Hodgman: clip `subject` (any polygon) by a convex polygon `clip`.
export function clipConvex(subject, clip) {
  const C = ccw(clip);
  let out = subject.slice();
  for (let i = 0; i < C.length && out.length; i++) {
    const a = C[i], b = C[(i + 1) % C.length];
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length];
      const pin = cross(a, b, p) >= 0, qin = cross(a, b, q) >= 0;
      if (pin) out.push(p);
      if (pin !== qin) {
        const d1 = cross(a, b, p), d2 = cross(a, b, q);
        const t = d1 / (d1 - d2);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

function areaCentroid(P) {
  const A = G.signedArea(P);
  if (Math.abs(A) < 1e-300) return { area: 0, cx: 0, cy: 0 };
  let cx = 0, cy = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  return { area: Math.abs(A), cx: cx / (6 * A), cy: cy / (6 * A) };
}

// Intersection of two simple polygons: total area, area-weighted centroid and the pieces.
export function polygonIntersection(A, B) {
  let pieces;
  if (G.isConvex(B)) pieces = [clipConvex(A, B)];
  else if (G.isConvex(A)) pieces = [clipConvex(B, A)];
  else pieces = triangulate(B).map((t) => clipConvex(A, t));
  let area = 0, sx = 0, sy = 0;
  const kept = [];
  for (const p of pieces) {
    if (p.length < 3) continue;
    const r = areaCentroid(p);
    if (r.area < 1e-15) continue;
    area += r.area; sx += r.cx * r.area; sy += r.cy * r.area;
    kept.push(p);
  }
  return { area, centroid: area ? { x: sx / area, y: sy / area } : null, pieces: kept };
}

// Exact area of the lens where two circles overlap.
export function lensArea(c1, r1, c2, r2) {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const a2 = Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}

// Exact area of (circle centred at the origin, radius r) ∩ triangle (origin, a, b), signed.
function circleTri(a, b, r) {
  const crs = (u, v) => u.x * v.y - u.y * v.x;
  const sector = (u, v) => (r * r * Math.atan2(crs(u, v), u.x * v.x + u.y * v.y)) / 2;
  const da = Math.hypot(a.x, a.y), db = Math.hypot(b.x, b.y);
  if (da <= r && db <= r) return crs(a, b) / 2;
  const d = { x: b.x - a.x, y: b.y - a.y };
  const A = d.x * d.x + d.y * d.y, B = 2 * (a.x * d.x + a.y * d.y), C = a.x * a.x + a.y * a.y - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-300 || disc <= 0) return sector(a, b);
  const s = Math.sqrt(disc), t1 = (-B - s) / (2 * A), t2 = (-B + s) / (2 * A);
  const at = (t) => ({ x: a.x + d.x * t, y: a.y + d.y * t });
  if (da <= r) { const p = at(t2); return crs(a, p) / 2 + sector(p, b); }
  if (db <= r) { const p = at(t1); return sector(a, p) + crs(p, b) / 2; }
  if (t1 > 0 && t2 < 1) { const p1 = at(t1), p2 = at(t2); return sector(a, p1) + crs(p1, p2) / 2 + sector(p2, b); }
  return sector(a, b);
}
// Exact area where an ellipse (circle if rx = ry) and a simple polygon overlap.
// The ellipse is mapped to the unit circle (an affine map), where the overlap is exact, then scaled back.
export function ellipsePolygonArea(E, poly) {
  const c = Math.cos(-E.rot), s = Math.sin(-E.rot);
  const P = poly.map((p) => { const x = p.x - E.c.x, y = p.y - E.c.y; return { x: (x * c - y * s) / E.rx, y: (x * s + y * c) / E.ry }; });
  let sum = 0;
  for (let i = 0; i < P.length; i++) sum += circleTri(P[i], P[(i + 1) % P.length], 1);
  return Math.abs(sum) * E.rx * E.ry;
}
