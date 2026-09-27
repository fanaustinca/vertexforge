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

t('expression parameters', () => {
  const P = { a: 2, b: 3 };
  const f = compile('a*sin(bx)', P);
  near(f(Math.PI / 6), 2);
  P.a = 5; near(f(Math.PI / 6), 5); // live values
  near(compile('ax^2 + b', P)(2), 23);
  near(compile('cos(x)', P)(0), 1); // functions still win over letters
  try { compile('k x + m'); assert.fail('should throw'); } catch (e) { assert.deepEqual(e.unknown, ['k', 'm']); }
  near(compile('ex')(2), 2 * Math.E);
});
console.log('parameter tests done');

import { compileVars, derivativeText, parse, toText } from '../js/expr.js';
t('expression engine v2', () => {
  near(compileVars('x^2 + y^2 - 9', ['x', 'y'])(3, 0), 0);
  near(compileVars('cos(t)', ['t'])(0), 1);
  near(compileVars('1 + cos(θ)', ['theta'])(Math.PI), 0);
  near(compile('log(2, 8)')(0), 3);
  near(compile('log(100)')(0), 2);
  near(compile('nCr(5, 2)')(0), 10);
  near(compile('fact(5)')(0), 120);
  near(compile('normalcdf(0)')(0), 0.5);
  near(compile('normalcdf(1.96)')(0), 0.9750021048517795, 1e-9);
  near(compile('normalpdf(0)')(0), 1 / Math.sqrt(2 * Math.PI));
  near(compile('max(x, 2, 7)')(3), 7);
  near(compile('root(-8, 3)')(0), -2);
  near(compile('3·x')(2), 6);
  // derivatives (check numerically at several points, and the text for simple ones)
  assert.equal(derivativeText('x^3'), '3x^2');
  assert.equal(derivativeText('3x^2 + 2x + 1'), '6x + 2');
  assert.equal(derivativeText('sin(x)'), 'cos(x)');
  const exprs = ['x^3 - 3x', 'sin(x)^2', 'x*exp(x)', 'ln(x^2 + 1)', 'sqrt(x)', 'x^x', 'tan(x)/x', 'atan(2x)', '1/x', 'cos(x^2)'];
  for (const e of exprs) {
    const f = compile(e), d = compile(derivativeText(e));
    for (const x of [0.7, 1.3, 2.1]) {
      const num = (f(x + 1e-6) - f(x - 1e-6)) / 2e-6;
      near(d(x), num, 1e-5, `d/dx ${e} at ${x} (${derivativeText(e)})`);
    }
  }
  // round trip printing
  for (const e of ['2sin(x)', '(x + 1)/(x - 1)', '-x^2', 'x^(1/2)', '2^x']) near(compile(toText(parse(e).ast))(1.7), compile(e)(1.7), 1e-12, e);
});
console.log('engine v2 tests done');
