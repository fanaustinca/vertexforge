import assert from 'node:assert/strict';
import * as G from '../js/geom.js';
import { compile } from '../js/expr.js';

const near = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} ${a} != ${b}`);
const poly = (world, rot = 0) => { const o = { kind: 'polygon', rot, cx: 0, cy: 0, w: 1, h: 1, pts: [] }; G.setPolyFromWorld(o, world); return o; };
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✓', name); };

t('regular polygon unit is regular', () => {
  for (let n = 3; n <= 20; n++) {
    const o = { kind: 'polygon', rot: 0, cx: 0, cy: 0, w: 4, h: 4 * G.regularAspect(n), pts: G.regularUnit(n) };
    const L = G.sideLengths(o);
    L.forEach((l) => near(l, L[0], 1e-9, `n=${n}`));
    const A = G.interiorAngles(G.polyWorld(o));
    A.forEach((a) => near(a, ((n - 2) * 180) / n, 1e-9));
  }
});

t('area & perimeter', () => {
  const sq = poly([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]);
  near(G.area(sq), 4); near(G.perimeter(sq), 8);
  const c = { kind: 'ellipse', cx: 0, cy: 0, w: 2, h: 2, rot: 0 };
  near(G.area(c), Math.PI); near(G.perimeter(c), 2 * Math.PI, 1e-9);
  const semi = { kind: 'semi', cx: 0, cy: 0, w: 2, h: 1, rot: 0 };
  near(G.area(semi), Math.PI / 2); near(G.perimeter(semi), Math.PI + 2, 1e-9);
});

t('rotated frame round-trips', () => {
  const world = [{ x: 1, y: 1 }, { x: 4, y: 2 }, { x: 2, y: 5 }];
  const o = poly(world, 0.7);
  G.polyWorld(o).forEach((p, i) => { near(p.x, world[i].x, 1e-9); near(p.y, world[i].y, 1e-9); });
});

t('solveSides triangle & quad & errors', () => {
  const tri = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  let r = G.solveSides(tri, [3, 5, 4]);
  assert.ok(!r.error, r.error);
  const o = poly(r.pts); const L = G.sideLengths(o);
  near(L[0], 3); near(L[1], 5); near(L[2], 4);
  assert.ok(G.solveSides(tri, [1, 1, 5]).error);
  const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  r = G.solveSides(sq, [3, 2, 3, 2]);
  assert.ok(!r.error, r.error);
  G.sideLengths(poly(r.pts)).forEach((l, i) => near(l, [3, 2, 3, 2][i], 1e-6));
  assert.ok(G.solveSides(sq, [10, 1, 1, 1]).error);
});

t('solveAngles', () => {
  const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  let r = G.solveAngles(sq, [60, 120, 60, 120], [2, 2, 2, 2], [false, false, false, false]);
  assert.ok(!r.error, r.error);
  const A = G.interiorAngles(r.pts);
  [60, 120, 60, 120].forEach((a, i) => near(A[i], a, 1e-6));
  // strict: rhombus angles with equal sides is consistent
  r = G.solveAngles(sq, [60, 120, 60, 120], [2, 2, 2, 2], [true, true, true, true]);
  assert.ok(!r.error, r.error);
  // strict mismatch -> error
  r = G.solveAngles(sq, [60, 120, 60, 120], [2, 3, 2, 2], [true, true, true, true]);
  assert.ok(r.error);
  // wrong sum
  assert.match(G.solveAngles(sq, [90, 90, 90, 80], [2, 2, 2, 2], [false, false, false, false]).error, /add up to 360/);
  // clockwise input keeps vertex mapping
  const cw = sq.slice().reverse();
  r = G.solveAngles(cw, [100, 80, 100, 80], [2, 2, 2, 2], [false, false, false, false]);
  assert.ok(!r.error, r.error);
  G.interiorAngles(r.pts).forEach((a, i) => near(a, [100, 80, 100, 80][i], 1e-6));
  // triangle 30-60-90 keeping one side
  const tri = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1.5 }];
  r = G.solveAngles(tri, [30, 60, 90], [2, 1, 1], [true, false, false]);
  assert.ok(!r.error, r.error);
  const L = G.sideLengths(poly(r.pts));
  near(L[0], 2); near(L[1], 1, 1e-6); near(L[2], Math.sqrt(3), 1e-6);
});

t('inscribe', () => {
  const tri = poly([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]);
  let r = G.inscribe(tri, 'circle', 1);
  near(r.w / 2, 1, 1e-9, 'incircle r');
  const sq = poly([{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]);
  r = G.inscribe(sq, 'circle', 1); near(r.w, 2, 1e-6);
  r = G.inscribe(sq, 'square', 4); // midpoint square
  near(Math.abs(G.signedArea(r.world)), 2, 1e-9);
  const t0 = performance.now();
  r = G.inscribe(tri, 'rect', 4); // max rect in right triangle = half area
  near(Math.abs(G.signedArea(r.world)), 3, 2e-3, 'rect in tri');
  r = G.inscribe(sq, 'ngon', 3);
  assert.equal(r.world.length, 3);
  const circle = { kind: 'ellipse', cx: 0, cy: 0, w: 2, h: 2, rot: 0 };
  r = G.inscribe(circle, 'ngon', 6);
  r.world.forEach((p) => near(Math.hypot(p.x, p.y), 1, 1e-9));
  const semi = { kind: 'semi', cx: 0, cy: 0.5, w: 2, h: 1, rot: 0 };
  r = G.inscribe(semi, 'circle', 1);
  near(r.w, 1, 1e-9); near(r.cy, 0.5, 1e-9);
  r = G.inscribe(semi, 'ngon', 5);
  assert.ok(!r.error);
  console.log('   inscribe timings ms', (performance.now() - t0).toFixed(0));
});

t('pointsAlong', () => {
  const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const p = G.pointsAlong(sq, 8);
  assert.equal(p.length, 8);
  near(p[1].x, 0.5); near(p[2].x, 1); near(p[2].y, 0);
});

t('expressions', () => {
  near(compile('x^2 - 3')(2), 1);
  near(compile('2x')(3), 6);
  near(compile('2sin(x)')(Math.PI / 2), 2);
  near(compile('sqrt(9 - x^2)')(0), 3);
  near(compile('-x^2')(3), -9);
  near(compile('(x+1)(x-1)')(3), 8);
  near(compile('y = pi')(0), Math.PI);
  near(compile('sinx')(0), 0);
  near(compile('2^3^2')(0), 512);
  assert.throws(() => compile('alert(1)'));
  assert.throws(() => compile('x +'));
  assert.throws(() => compile('constructor'));
});

console.log(`\n${passed} test groups passed`);
