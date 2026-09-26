import assert from 'node:assert/strict';
import * as B from '../js/boolean.js';
import * as G from '../js/geom.js';
const near = (a, b, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${m} ${a} != ${b}`);
const P = (x, y) => ({ x, y });
const sq = (x, y, s) => [P(x, y), P(x + s, y), P(x + s, y + s), P(x, y + s)];
// overlapping squares
near(B.polygonIntersection(sq(0, 0, 2), sq(1, 1, 2)).area, 1);
near(B.polygonIntersection(sq(0, 0, 2), sq(5, 5, 2)).area, 0);
near(B.polygonIntersection(sq(0, 0, 4), sq(1, 1, 1)).area, 1);
// concave vs concave: L-shape ∩ L-shape
const L = [P(0, 0), P(3, 0), P(3, 1), P(1, 1), P(1, 3), P(0, 3)];
const L2 = L.map((p) => P(p.x + 0.5, p.y + 0.5));
// brute-force check by sampling
const inside = (p, poly) => G.pointInPoly(p, poly);
let hits = 0; const N = 600;
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = P((i + 0.5) / N * 4, (j + 0.5) / N * 4); if (inside(p, L) && inside(p, L2)) hits++; }
const est = hits / (N * N) * 16;
const r = B.polygonIntersection(L, L2);
assert.ok(Math.abs(r.area - est) < 0.01, `concave ${r.area} vs ${est}`);
near(r.area, 2.25, 1e-9, 'L∩L exact');
// triangulation area
const star = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.4 : 1; star.push(P(rr * Math.cos(a), rr * Math.sin(a))); }
near(B.triangulate(star).reduce((s, t) => s + Math.abs(G.signedArea(t)), 0), Math.abs(G.signedArea(star)));
// lens
near(B.lensArea(P(0, 0), 1, P(1, 0), 1), 2 * Math.PI / 3 - Math.sqrt(3) / 2);
near(B.lensArea(P(0, 0), 2, P(0.5, 0), 1), Math.PI);
near(B.lensArea(P(0, 0), 1, P(3, 0), 1), 0);
console.log('✓ boolean areas');
// circle ∩ polygon exact
near(B.ellipsePolygonArea({ c: P(0, 0), rx: 2, ry: 2, rot: 0 }, [P(0, 0), P(3, 0), P(3, 3), P(0, 3)]), Math.PI, 1e-12, 'quarter disc');
near(B.ellipsePolygonArea({ c: P(0, 0), rx: 1, ry: 1, rot: 0 }, [P(-5, -5), P(5, -5), P(5, 5), P(-5, 5)]), Math.PI, 1e-12, 'circle inside square');
near(B.ellipsePolygonArea({ c: P(0, 0), rx: 5, ry: 5, rot: 0 }, [P(0, 0), P(1, 0), P(0, 1)]), 0.5, 1e-12, 'triangle inside circle');
near(B.ellipsePolygonArea({ c: P(0, 0), rx: 1, ry: 1, rot: 0 }, [P(-1, 0), P(1, 0), P(1, 2), P(-1, 2)]), Math.PI / 2, 1e-12, 'half disc');
near(B.ellipsePolygonArea({ c: P(1, 1), rx: 3, ry: 1, rot: 0.3 }, [P(-9, -9), P(9, -9), P(9, 9), P(-9, 9)]), 3 * Math.PI, 1e-12, 'ellipse inside');
near(B.ellipsePolygonArea({ c: P(0, 0), rx: 3, ry: 1, rot: 0 }, [P(0, -5), P(5, -5), P(5, 5), P(0, 5)]), 1.5 * Math.PI, 1e-12, 'half ellipse');
console.log('✓ exact circle/ellipse ∩ polygon');
