import assert from 'node:assert/strict';
import * as G from '../js/geom.js';
import * as C from '../js/construct.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} != ${b}`);
const poly = (world) => { const o = { kind: 'polygon', rot: 0, cx: 0, cy: 0, w: 1, h: 1, pts: [] }; G.setPolyFromWorld(o, world); return o; };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };
const P = (x, y) => ({ x, y });

t('triangle centers (3-4-5)', () => {
  const T = [P(0, 0), P(4, 0), P(0, 3)];
  const c = C.triangleCenters(T);
  near(c.O.x, 2); near(c.O.y, 1.5); near(c.R, 2.5);
  near(c.I.x, 1); near(c.I.y, 1); near(c.r, 1);
  near(c.H.x, 0); near(c.H.y, 0); // right angle vertex
  near(c.G.x, 4 / 3); near(c.G.y, 1);
  near(c.nr, 1.25);
});

t('altitude feet & angle bisectors', () => {
  const T = [P(0, 0), P(4, 0), P(1, 3)];
  const alts = C.altitudes(T);
  const f = alts[2].seg[1]; near(f.x, 1); near(f.y, 0);
  const obtuse = [P(0, 0), P(4, 0), P(-2, 2)];
  assert.ok(C.altitudes(obtuse).some((a) => a.ext), 'obtuse altitude needs extension');
  const [, D] = C.angleBisectors([P(0, 0), P(4, 0), P(0, 4)])[0];
  near(D.x, 2); near(D.y, 2);
});

t('min enclosing circle', () => {
  const c = C.minEnclosingCircle([P(0, 0), P(2, 0), P(1, 0.2)]);
  near(c.x, 1); near(c.r, 1);
  const sq = C.minEnclosingCircle([P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)]);
  near(sq.r, Math.SQRT2);
});

t('intersections', () => {
  const p = { a: P(0, 0), b: P(2, 2), t0: 0, t1: 1 }, q = { a: P(0, 2), b: P(2, 0), t0: 0, t1: 1 };
  const x = C.intersectPieces(p, q); near(x.x, 1); near(x.y, 1);
  assert.equal(C.intersectPieces({ ...p, t1: 0.4 }, q), null);
  const inf = { a: P(0, 0), b: P(1, 0), t0: -Infinity, t1: Infinity };
  const E = C.ellipseOf({ kind: 'ellipse', cx: 0, cy: 0, w: 4, h: 2, rot: 0 });
  const pts = C.pieceEllipse(inf, E).map((q) => q.x).sort((a, b) => a - b);
  near(pts[0], -2); near(pts[1], 2);
  const semi = C.ellipseOf({ kind: 'semi', cx: 0, cy: 0.5, w: 2, h: 1, rot: 0 });
  const vert = { a: P(0, -5), b: P(0, 5), t0: 0, t1: 1 };
  const hits = C.pieceEllipse(vert, semi);
  assert.equal(hits.length, 1); near(hits[0].y, 1);
});

t('nearest points', () => {
  const E = C.ellipseOf({ kind: 'ellipse', cx: 0, cy: 0, w: 6, h: 2, rot: 0.3 });
  const q = C.nearestOnEllipse(E, P(5, 4));
  const l = G.rotPt(q, -0.3);
  near((l.x / 3) ** 2 + l.y ** 2, 1, 1e-9, 'on ellipse');
  const c = C.nearestOnEllipse(C.ellipseOf({ kind: 'ellipse', cx: 1, cy: 1, w: 2, h: 2, rot: 0 }), P(3, 1));
  near(c.x, 2); near(c.y, 1);
  const s = C.nearestOnPiece(P(5, 5), { a: P(0, 0), b: P(1, 0), t0: 0, t1: 1 });
  near(s.x, 1); near(s.y, 0);
});

t('classification', () => {
  const cases = [
    [[P(0, 0), P(1, 0), P(0.5, Math.sqrt(3) / 2)], 'Equilateral triangle'],
    [[P(0, 0), P(4, 0), P(0, 3)], 'Right scalene triangle'],
    [[P(0, 0), P(1, 0), P(0, 1)], 'Right isosceles triangle'],
    [[P(0, 0), P(4, 0), P(-1, 1)], 'Obtuse scalene triangle'],
    [[P(0, 0), P(1, 0), P(1, 1), P(0, 1)], 'Square'],
    [[P(0, 0), P(2, 0), P(2, 1), P(0, 1)], 'Rectangle'],
    [[P(0, 0), P(1, 0), P(1.5, Math.sqrt(3) / 2), P(0.5, Math.sqrt(3) / 2)], 'Rhombus'],
    [[P(0, 0), P(3, 0), P(4, 1), P(1, 1)], 'Parallelogram'],
    [[P(0, 0), P(1, 1), P(0, 3), P(-1, 1)], 'Kite'],
    [[P(0, 0), P(4, 0), P(3, 2), P(1, 2)], 'Isosceles trapezoid'],
    [[P(0, 0), P(4, 0), P(2.5, 2), P(0, 2)], 'Right trapezoid'],
    [[P(0, 0), P(1.2, -0.6), P(0, 2.4), P(-1.2, -0.6)], 'Dart (concave kite)'],
  ];
  for (const [pts, name] of cases) assert.equal(C.classify(poly(pts)), name);
  const hex = { kind: 'polygon', rot: 0, cx: 0, cy: 0, w: 2, h: 2 * G.regularAspect(6), pts: G.regularUnit(6) };
  assert.equal(C.classify(hex), 'Regular hexagon');
});

console.log(`\n${n} construction test groups passed`);

t('tangents', () => {
  const E = C.ellipseOf({ kind: 'ellipse', cx: 0, cy: 0, w: 2, h: 2, rot: 0 });
  const r = C.tangentsFrom(E, P(2, 0));
  assert.equal(r.points.length, 2);
  for (const q of r.points) { near(Math.hypot(q.x, q.y), 1); near((q.x - 2) * q.x + q.y * q.y, 0, 1e-9, 'radius ⟂ tangent'); }
  assert.ok(C.tangentsFrom(E, P(0.2, 0)).inside);
  // ellipse: tangent points satisfy the tangency condition in the ellipse's own equation
  const E2 = C.ellipseOf({ kind: 'ellipse', cx: 1, cy: -1, w: 6, h: 2, rot: 0.4 });
  const p = P(6, 3);
  for (const q of C.tangentsFrom(E2, p).points) {
    const ta = C.tangentAt(E2, q);
    const cr = (p.x - ta.p.x) * ta.d.y - (p.y - ta.p.y) * ta.d.x;
    near(cr, 0, 1e-9, 'p lies on the tangent line');
  }
  const ta = C.tangentAt(E, P(0, 5)); near(ta.p.y, 1); near(Math.abs(ta.d.x), 1);
});
console.log('tangent tests done');
