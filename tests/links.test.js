import assert from 'node:assert/strict';
import * as G from '../js/geom.js';
import { solveLinks } from '../js/links.js';
const near = (a, b, tol = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${m} ${a} != ${b}`);
const P = (x, y) => ({ x, y });
const poly = (id, pts) => { const o = { id, type: 'shape', kind: 'polygon', rot: 0, cx: 0, cy: 0, w: 1, h: 1, pts: [] }; G.setPolyFromWorld(o, pts); return o; };
const objs = [];
const byId = (id) => objs.find((o) => o.id === id);
const mem = new Map();

// 1) equal sides: quad side 0 (len 4) and side 2 (len 2) -> side 2 becomes 4
const q = poly('q', [P(0, 0), P(4, 0), P(3, 2), P(1, 2)]);
objs.push(q);
let links = [{ id: 'L1', kind: 'equal', refs: [{ t: 'side', o: 'q', i: 0 }, { t: 'side', o: 'q', i: 2 }] }];
solveLinks(links, byId, mem);
let L = G.sideLengths(q); near(L[2], 4, 1e-9, 'equal after link');
// user stretches side 0 (move vertex 1): side 2 follows
let W = G.polyWorld(q); W[1] = P(6, 0); G.setPolyFromWorld(q, W);
solveLinks(links, byId, mem, { id: 'q', vertex: 1 });
L = G.sideLengths(q); near(L[0], 6); near(L[2], 6, 1e-9, 'follows driver');

// 2) parallel lines
const a = { id: 'a', type: 'line', x1: 0, y1: 0, x2: 4, y2: 1 }, b = { id: 'b', type: 'line', x1: 0, y1: 3, x2: 2, y2: 6 };
objs.push(a, b);
links = [{ id: 'L2', kind: 'parallel', refs: [{ t: 'line', o: 'a' }, { t: 'line', o: 'b' }] }];
solveLinks(links, byId, mem);
const dir = (l) => Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
near(Math.sin(dir(a) - dir(b)), 0, 1e-9, 'parallel');
near(Math.hypot(b.x2 - b.x1, b.y2 - b.y1), Math.hypot(2, 3), 1e-9, 'length kept');
// rotate b by user -> a follows (b is driver now)
b.x2 = b.x1 + 3; b.y2 = b.y1 - 1;
solveLinks(links, byId, mem);
near(Math.sin(dir(a) - dir(b)), 0, 1e-9, 'a followed b');

// 3) perpendicular
const c = { id: 'c', type: 'line', x1: 5, y1: 5, x2: 8, y2: 7 };
objs.push(c);
links = [{ id: 'L3', kind: 'perp', refs: [{ t: 'line', o: 'a' }, { t: 'line', o: 'c' }] }];
solveLinks(links, byId, mem);
near(Math.cos(dir(a) - dir(c)), 0, 1e-9, 'perpendicular');

// 4) equal angles inside a triangle -> isosceles
const t = poly('t', [P(0, 0), P(5, 0), P(1, 3)]);
objs.push(t);
links = [{ id: 'L4', kind: 'equalAngle', refs: [{ t: 'vangle', o: 't', i: 0 }, { t: 'vangle', o: 't', i: 1 }] }];
solveLinks(links, byId, mem);
let A = G.interiorAngles(G.polyWorld(t)); near(A[0], A[1], 1e-9, 'equal angles');
near(A[0] + A[1] + A[2], 180, 1e-9);
// angle object linked to polygon angle
const ang = { id: 'g', type: 'angle', ax: 3, ay: 0, vx: 0, vy: 0, bx: 0, by: 3, reflex: false };
objs.push(ang);
links = [{ id: 'L5', kind: 'equalAngle', refs: [{ t: 'vangle', o: 't', i: 2 }, { t: 'angle', o: 'g' }] }];
solveLinks(links, byId, mem);
let gdeg = Math.abs(Math.atan2(ang.by - ang.vy, ang.bx - ang.vx) - Math.atan2(ang.ay - ang.vy, ang.ax - ang.vx)) * 180 / Math.PI; if (gdeg > 180) gdeg = 360 - gdeg;
near(gdeg, G.interiorAngles(G.polyWorld(t))[2], 1e-9, 'angle marker matches');

// 5) locked member wins; missing member -> invalid
const r = poly('r', [P(0, 0), P(2, 0), P(2, 1), P(0, 1)]);
r.locked = true; objs.push(r);
const l2 = { id: 'l2', type: 'line', x1: 0, y1: 5, x2: 1, y2: 5 };
objs.push(l2);
links = [{ id: 'L6', kind: 'equal', refs: [{ t: 'line', o: 'l2' }, { t: 'side', o: 'r', i: 0 }] }];
solveLinks(links, byId, mem);
near(Math.hypot(l2.x2 - l2.x1, l2.y2 - l2.y1), 2, 1e-9, 'locked side drives');
near(G.sideLengths(r)[0], 2);
const res = solveLinks([{ id: 'L7', kind: 'equal', refs: [{ t: 'line', o: 'nope' }, { t: 'line', o: 'l2' }] }], byId, mem);
assert.deepEqual(res.invalid, ['L7']);

// 6) two links on one parallelogram-ish quad: opposite sides parallel both ways -> parallelogram
const pq = poly('pq', [P(0, 0), P(5, 0), P(6, 3), P(0.5, 2)]);
objs.push(pq);
links = [{ id: 'L8', kind: 'parallel', refs: [{ t: 'side', o: 'pq', i: 0 }, { t: 'side', o: 'pq', i: 2 }] }, { id: 'L9', kind: 'parallel', refs: [{ t: 'side', o: 'pq', i: 1 }, { t: 'side', o: 'pq', i: 3 }] }];
solveLinks(links, byId, mem);
W = G.polyWorld(pq);
const sd = (i) => Math.atan2(W[(i + 1) % 4].y - W[i].y, W[(i + 1) % 4].x - W[i].x);
near(Math.sin(sd(0) - sd(2)), 0, 1e-7, 'pair 1 parallel'); near(Math.sin(sd(1) - sd(3)), 0, 1e-7, 'pair 2 parallel');
console.log('✓ links');

// 7) two links sharing a dragged corner must both keep holding
{
  const g = poly('gg', [P(0, 0), P(6, 0), P(5, 3), P(1, 2)]);
  objs.push(g);
  const ls = [{ id: 'G1', kind: 'parallel', refs: [{ t: 'side', o: 'gg', i: 0 }, { t: 'side', o: 'gg', i: 2 }] }, { id: 'G2', kind: 'equal', refs: [{ t: 'side', o: 'gg', i: 1 }, { t: 'side', o: 'gg', i: 3 }] }];
  solveLinks(ls, byId, mem);
  let W = G.polyWorld(g); W[1] = P(W[1].x + 1.3, W[1].y - 0.6); G.setPolyFromWorld(g, W);
  const dragged = { ...G.polyWorld(g)[1] };
  solveLinks(ls, byId, mem, { id: 'gg', vertex: 1 });
  W = G.polyWorld(g);
  const d = (i) => Math.atan2(W[(i + 1) % 4].y - W[i].y, W[(i + 1) % 4].x - W[i].x);
  const L = G.sideLengths(g);
  near(Math.sin(d(0) - d(2)), 0, 1e-8, 'still parallel'); near(L[1], L[3], 1e-8, 'still equal');
  near(W[1].x, dragged.x, 1e-12, 'dragged corner stays put'); near(W[1].y, dragged.y, 1e-12);
  console.log('✓ joint solve with shared corner');
}
