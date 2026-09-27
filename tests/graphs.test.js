import assert from 'node:assert/strict';
import * as GR from '../js/graphs.js';
import { compile, compileVars } from '../js/expr.js';
const near = (a, b, t = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= t * Math.max(1, Math.abs(b)), `${m} ${a} != ${b}`);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };
t('classify', () => {
  assert.equal(GR.classifyGraph('x^2').mode, 'func');
  assert.equal(GR.classifyGraph('y = 2x + 1').mode, 'func');
  assert.deepEqual(GR.classifyGraph('x^2 + y^2 = 9'), { mode: 'implicit', F: '(x^2 + y^2) - (9)' });
  assert.deepEqual(GR.classifyGraph('y > x^2'), { mode: 'ineq', F: '(y) - (x^2)', op: '>' });
  assert.equal(GR.classifyGraph('x^2 + y^2 <= 4').op, '<=');
  assert.equal(GR.classifyGraph('y ≥ 2x').op, '>=');
  const p = GR.classifyGraph('(cos(t), sin(2t))'); assert.equal(p.mode, 'param'); assert.equal(p.Y, 'sin(2t)');
  const p2 = GR.classifyGraph('(t, t^2), t from -2 to 2'); assert.deepEqual([p2.t0, p2.t1], ['-2', '2']);
  assert.equal(GR.classifyGraph('r = 1 + cos(θ)').mode, 'polar');
  assert.equal(GR.classifyGraph('x = y^2').mode, 'implicit');
  assert.equal(GR.classifyGraph('y = x*y').mode, 'implicit');
});
t('contour of a circle', () => {
  const F = compileVars('x^2 + y^2 - 9', ['x', 'y']);
  const segs = GR.contour(F, { x0: -5, x1: 5, y0: -5, y1: 5, nx: 60, ny: 60 });
  assert.ok(segs.length > 50);
  for (const s of segs) for (const p of s) near(Math.hypot(p.x, p.y), 3, 1e-6);
  // 1/x = 0 has no curve (the pole must not be drawn)
  assert.equal(GR.contour(compileVars('1/x', ['x', 'y']), { x0: -5, x1: 5, y0: -5, y1: 5, nx: 40, ny: 40 }).length, 0);
});
t('inequality runs', () => {
  const F = compileVars('x^2 + y^2 - 4', ['x', 'y']);
  const runs = GR.inequalityRuns(F, '<', { x0: -3, x1: 3, y0: -3, y1: 3, nx: 300, ny: 300 });
  const area = runs.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  near(area, 4 * Math.PI, 0.01);
});
t('integrals, roots, extrema', () => {
  near(GR.integrate(compile('x^2'), 0, 2), 8 / 3, 1e-10);
  near(GR.integrate(compile('sin(x)'), 0, Math.PI), 2, 1e-10);
  near(GR.integrate(compile('normalpdf(x)'), -1.96, 1.96), 0.9500042097035593, 1e-9);
  near(GR.integrate(compile('x'), 2, 0), -2, 1e-12);
  assert.throws(() => GR.integrate(compile('1/x'), -1, 1));
  const r = GR.roots(compile('x^2 - 2'), -5, 5); assert.equal(r.length, 2); near(r[1], Math.SQRT2, 1e-12);
  const r2 = GR.roots(compile('x^2'), -3, 3.1); assert.equal(r2.length, 1); near(r2[0], 0, 1e-6);
  assert.equal(GR.roots(compile('1/x'), -1, 1).length, 0);
  const e = GR.extrema(compile('x^3 - 3x'), -3, 3);
  assert.deepEqual(e.map((p) => p.kind), ['max', 'min']); near(e[0].x, -1, 1e-6); near(e[1].y, -2, 1e-9);
});
t('parametric & polar sampling', () => {
  const runs = GR.sampleCurve((tt) => ({ x: Math.cos(tt), y: Math.sin(tt) }), 0, 2 * Math.PI, 360);
  assert.equal(runs.length, 1); assert.equal(runs[0].length, 361);
});
console.log(`${n} graph test groups passed`);
