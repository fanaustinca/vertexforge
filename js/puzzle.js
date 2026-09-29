// Daily geometry puzzle: the same date always gives the same puzzle.
// generatePuzzle('2026-09-27') -> { number, title, question, answer, answerText, hint, explain, figure: [...] }
// Figure items (world coordinates):
//   {kind:'poly', pts:[{x,y}...]}          {kind:'circle', c:{x,y}, r}
//   {kind:'line', a, b, ext:'segment'|'line'|'ray', dash?}
//   {kind:'label', at:{x,y}, text}          {kind:'point', p, label}
//   {kind:'right', p, u, v}  (right-angle mark at p between unit directions u and v)
//   {kind:'shade', a:index, b:index, op}    (overlap region of two earlier poly/circle items)
//   {kind:'sector', c, r, t0, sweep}        (angles in radians)
//   {kind:'tick', a, b}                     (equal-length tick mark on side a–b)
//   {kind:'parallel', at, dir}              (parallel-line arrow mark)
//   {kind:'segmentShade', c, r, t0, sweep}  (shaded circular segment)

const DEG = Math.PI / 180;
const P = (x, y) => ({ x, y });

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFor(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function puzzleNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400000) + 1;
}
export function todayStr(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const mid = (a, b) => P((a.x + b.x) / 2, (a.y + b.y) / 2);
const unit = (a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return P((b.x - a.x) / d, (b.y - a.y) / d); };
// label just outside a side (away from point `away`)
function sideLabel(a, b, away, text, off = 0.55) {
  const m = mid(a, b), u = unit(a, b);
  let n = P(-u.y, u.x);
  if ((away.x - m.x) * n.x + (away.y - m.y) * n.y > 0) n = P(-n.x, -n.y);
  return { kind: 'label', at: P(m.x + n.x * off, m.y + n.y * off), text };
}
// label inside a corner
function cornerLabel(p, a, b, text, dist = 0.9) {
  const u = unit(p, a), v = unit(p, b);
  let d = P(u.x + v.x, u.y + v.y);
  const L = Math.hypot(d.x, d.y) || 1;
  d = P(d.x / L, d.y / L);
  return { kind: 'label', at: P(p.x + d.x * dist, p.y + d.y * dist), text };
}
// triangle with base `base` on the x-axis and base angles A (left) and B (right), centred
function triFromAngles(A, B, base) {
  const C = 180 - A - B;
  const left = (base * Math.sin(B * DEG)) / Math.sin(C * DEG);
  const apex = P(left * Math.cos(A * DEG), left * Math.sin(A * DEG));
  const pts = [P(0, 0), P(base, 0), apex];
  const cx = (base + apex.x) / 3, cy = apex.y / 3;
  return pts.map((q) => P(q.x - cx, q.y - cy));
}
const center = (pts) => { const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length, cy = pts.reduce((s, q) => s + q.y, 0) / pts.length; return pts.map((q) => P(q.x - cx, q.y - cy)); };
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const TRIPLES = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15], [20, 21, 29], [9, 40, 41]];

// ---------- figure helpers for parallel lines & transversals ----------
const lin = (a, b) => `${a === 1 ? '' : a}x${b === 0 ? '' : b > 0 ? ` + ${b}` : ` − ${-b}`}`;
const angleExpr = (a, b) => `(${lin(a, b)})°`;
// Two horizontal parallel lines y = ±h, crossed by a transversal at angle th (degrees) through the origin.
function parallelScene(th, h = 1.9, w = 6.5) {
  const t = th * DEG, d = P(Math.cos(t), Math.sin(t));
  const T = P((h * d.x) / d.y, h), B = P((-h * d.x) / d.y, -h);
  const fig = [
    { kind: 'line', a: P(-w, h), b: P(w, h), ext: 'line' },
    { kind: 'line', a: P(-w, -h), b: P(w, -h), ext: 'line' },
    { kind: 'line', a: P(B.x - d.x * 3, B.y - d.y * 3), b: P(T.x + d.x * 3, T.y + d.y * 3), ext: 'line' },
    { kind: 'parallel', at: P(-w * 0.72, h), dir: P(1, 0) }, { kind: 'parallel', at: P(-w * 0.72, -h), dir: P(1, 0) },
  ];
  // rays from the two crossing points
  const ray = (p, v) => P(p.x + v.x, p.y + v.y);
  const up = d, down = P(-d.x, -d.y), right = P(1, 0), left = P(-1, 0);
  return { fig, T, B, ray, up, down, right, left };
}
const TRIPLES_SMALL = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20], [7, 24, 25]];
// pairs of triples sharing a leg: [left (leg a shared), right]
const SHARED = [[[5, 12, 13], [9, 12, 15]], [[6, 8, 10], [15, 8, 17]], [[9, 12, 15], [16, 12, 20]], [[16, 12, 20], [5, 12, 13]], [[8, 15, 17], [20, 15, 25]], [[7, 24, 25], [18, 24, 30]], [[3, 4, 5], [3, 4, 5]], [[12, 5, 13], [12, 9, 15]]];
const niceTheta = (r) => pick(r, [40, 45, 50, 55, 60, 65, 70, 75, 105, 110, 115, 120, 125, 130, 135]);

// Each template: {levels: [...], make(r, level)} -> puzzle fields. Levels: 2 = ★★, 3 = ★★★, 4 = ★★★★.
const TEMPLATES = [
  // --- parallel lines & algebra ---
  { levels: [2], make(r) { // corresponding angles
    const th = niceTheta(r), x = int(r, 6, 22), a1 = int(r, 2, 5), a2 = int(r, 1, a1 - 1), b1 = th - a1 * x, b2 = th - a2 * x;
    const S = parallelScene(th);
    return {
      title: 'Corresponding angles', principle: 'Corresponding angles', question: 'The horizontal lines are parallel. Find x.', answer: x, unit: '',
      hint: 'Corresponding angles are equal when lines are parallel — set the two expressions equal', explain: `${angleExpr(a1, b1)} = ${angleExpr(a2, b2)} → ${a1 - a2}x = ${b2 - b1} → x = ${x}.`,
      figure: [...S.fig, cornerLabel(S.T, S.ray(S.T, S.up), S.ray(S.T, S.right), angleExpr(a1, b1), 1.3), cornerLabel(S.B, S.ray(S.B, S.up), S.ray(S.B, S.right), angleExpr(a2, b2), 1.3)],
    };
  } },
  { levels: [3, 4], make(r, level) { // alternate interior angles
    const th = niceTheta(r), x = int(r, 6, 22), a1 = int(r, 2, 6), a2 = int(r, 1, a1 - 1), b1 = th - a1 * x, b2 = th - a2 * x;
    const S = parallelScene(th);
    const askAngle = level === 4;
    // the other angle at the bottom crossing: its linear pair
    return {
      title: 'Alternate interior angles', principle: 'AIA', question: askAngle ? 'The horizontal lines are parallel. What is the angle marked ?' : 'The horizontal lines are parallel. Find x.',
      answer: askAngle ? 180 - th : x, unit: askAngle ? '°' : '',
      hint: askAngle ? 'Alternate interior angles are equal → solve for x, find that angle, then use the linear pair (180°)' : 'Alternate interior angles (AIA) are equal when lines are parallel',
      explain: `${angleExpr(a1, b1)} = ${angleExpr(a2, b2)} (AIA) → x = ${x}, so each is ${th}°.` + (askAngle ? ` The marked angle makes a straight line with it: 180° − ${th}° = ${180 - th}°.` : ''),
      figure: [...S.fig, cornerLabel(S.T, S.ray(S.T, S.down), S.ray(S.T, S.left), angleExpr(a1, b1), 1.35), cornerLabel(S.B, S.ray(S.B, S.up), S.ray(S.B, S.right), angleExpr(a2, b2), 1.35),
        ...(askAngle ? [cornerLabel(S.B, S.ray(S.B, S.up), S.ray(S.B, S.left), '?', 1.0)] : [])],
    };
  } },
  { levels: [3, 4], make(r, level) { // same-side interior angles
    const th = niceTheta(r), x = int(r, 6, 20), a1 = int(r, 2, 5), a2 = int(r, 1, 4);
    const top = 180 - th, b1 = top - a1 * x, b2 = th - a2 * x;
    const S = parallelScene(th);
    const askAngle = level === 4;
    return {
      title: 'Same-side interior angles', principle: 'SSIA', question: askAngle ? 'The horizontal lines are parallel. What is the angle marked ?' : 'The horizontal lines are parallel. Find x.',
      answer: askAngle ? th : x, unit: askAngle ? '°' : '',
      hint: 'Same-side (co-interior) angles add up to 180° when lines are parallel' + (askAngle ? ' — then look for vertical angles' : ''),
      explain: `${angleExpr(a1, b1)} + ${angleExpr(a2, b2)} = 180° (SSIA) → ${a1 + a2}x = ${180 - b1 - b2} → x = ${x}.` + (askAngle ? ` The bottom angle is ${th}°, and the marked angle is vertical to it: ${th}°.` : ''),
      figure: [...S.fig, cornerLabel(S.T, S.ray(S.T, S.down), S.ray(S.T, S.right), angleExpr(a1, b1), 1.35), cornerLabel(S.B, S.ray(S.B, S.up), S.ray(S.B, S.right), angleExpr(a2, b2), 1.35),
        ...(askAngle ? [cornerLabel(S.B, S.ray(S.B, S.down), S.ray(S.B, S.left), '?', 1.0)] : [])],
    };
  } },
  { levels: [3], make(r) { // AIA inside a triangle between parallel lines
    const x = int(r, 7, 13) * 5, y = int(r, 8, Math.min(15, 30 - x / 5)) * 5, h = 2;
    const A = P(0, h), Bp = P(-(2 * h) / Math.tan(x * DEG), -h), Cp = P((2 * h) / Math.tan(y * DEG), -h);
    return {
      title: 'Zig-zag', principle: 'AIA + triangle sum', question: 'The horizontal lines are parallel. What is the angle marked ?', answer: 180 - x - y, unit: '°',
      hint: 'Use alternate interior angles to move the top angle into the triangle, then the angles add to 180°', explain: `By AIA the angle at the bottom left is ${x}°. So ? = 180° − ${x}° − ${y}° = ${180 - x - y}°.`,
      figure: [{ kind: 'line', a: P(-6.5, h), b: P(6.5, h), ext: 'line' }, { kind: 'line', a: P(-6.5, -h), b: P(6.5, -h), ext: 'line' }, { kind: 'parallel', at: P(-5, h), dir: P(1, 0) }, { kind: 'parallel', at: P(-5, -h), dir: P(1, 0) },
        { kind: 'poly', pts: [A, Bp, Cp] }, cornerLabel(A, P(A.x - 3, A.y), Bp, `${x}°`, 1.1), cornerLabel(Cp, Bp, A, `${y}°`, 1.0), cornerLabel(A, Bp, Cp, '?', 0.9)],
    };
  } },
  { levels: [2, 3], make(r, level) { // vertical angles + linear pair
    const th = pick(r, [40, 50, 55, 65, 70, 115, 125, 130]), x = int(r, 5, 20), a1 = int(r, 3, 6), a2 = int(r, 1, a1 - 1), b1 = th - a1 * x, b2 = th - a2 * x;
    const t = th * DEG, d = P(Math.cos(t), Math.sin(t)), O = P(0, 0);
    const askAngle = level === 3;
    return {
      title: 'Crossing lines', principle: 'Vertical angles', question: askAngle ? 'Two lines cross. What is the angle marked ?' : 'Two lines cross. Find x.', answer: askAngle ? 180 - th : x, unit: askAngle ? '°' : '',
      hint: 'Vertical (opposite) angles are equal' + (askAngle ? '; angles on a straight line add to 180°' : ''), explain: `${angleExpr(a1, b1)} = ${angleExpr(a2, b2)} → x = ${x}, so they are ${th}°.` + (askAngle ? ` ? = 180° − ${th}° = ${180 - th}°.` : ''),
      figure: [{ kind: 'line', a: P(-6, 0), b: P(6, 0), ext: 'line' }, { kind: 'line', a: P(-d.x * 5, -d.y * 5), b: P(d.x * 5, d.y * 5), ext: 'line' }, { kind: 'point', p: O, label: '' },
        cornerLabel(O, d, P(1, 0), angleExpr(a1, b1), 1.4), cornerLabel(O, P(-d.x, -d.y), P(-1, 0), angleExpr(a2, b2), 1.4), ...(askAngle ? [cornerLabel(O, d, P(-1, 0), '?', 1.1)] : [])],
    };
  } },
  // --- special right triangles ---
  { levels: [3], make(r) { // 30-60-90
    const s = int(r, 2, 8), v = int(r, 0, 2);
    const k = 3.2 / s, C = P(-(s * Math.sqrt(3) * k) / 2, -(s * k) / 2), A = P(C.x + s * Math.sqrt(3) * k, C.y), B = P(C.x, C.y + s * k);
    const variants = [
      { given: [[B, A, `${2 * s}`]], ask: [C, A], answer: s * Math.sqrt(3), q: 'hypotenuse', ex: `Hypotenuse ${2 * s} → short leg ${s} → long leg ${s}√3.` },
      { given: [[C, A, `${3 * s}`]], ask: [C, B], answer: s * Math.sqrt(3), q: 'long leg', ex: `Long leg = short leg × √3, so short leg = ${3 * s} ÷ √3 = ${s}√3.`, big: true },
      { given: [[C, B, `${s}`]], ask: [B, A], answer: 2 * s, q: 'short leg', ex: `Hypotenuse = 2 × short leg = ${2 * s}.`, alt: true },
    ];
    const V = variants[v];
    if (V.big) { // redraw so the long leg is 3s
      const L = 3 * s, sh = L / Math.sqrt(3), kk = 5 / L; const C2 = P(-(L * kk) / 2, -(sh * kk) / 2), A2 = P(C2.x + L * kk, C2.y), B2 = P(C2.x, C2.y + sh * kk);
      return { title: '30-60-90 triangle', principle: '30-60-90', question: 'How long is the side marked ?', answer: L / Math.sqrt(3), unit: '', hint: 'In a 30-60-90 triangle the sides are x, x√3 and 2x', explain: V.ex,
        figure: [{ kind: 'poly', pts: [C2, A2, B2] }, { kind: 'right', p: C2, u: P(1, 0), v: P(0, 1) }, cornerLabel(A2, C2, B2, '30°', 1.3), sideLabel(C2, A2, B2, String(L)), sideLabel(C2, B2, A2, '?')] };
    }
    const lab = (pq, t) => sideLabel(pq[0], pq[1], [C, A, B].find((q) => q !== pq[0] && q !== pq[1]), t);
    return {
      title: '30-60-90 triangle', principle: '30-60-90', question: 'How long is the side marked ?', answer: V.answer, unit: '',
      hint: 'In a 30-60-90 triangle the sides are x (short), x√3 (long) and 2x (hypotenuse)', explain: V.ex,
      figure: [{ kind: 'poly', pts: [C, A, B] }, { kind: 'right', p: C, u: P(1, 0), v: P(0, 1) }, cornerLabel(A, C, B, '30°', 1.3), lab(V.given[0], V.given[0][2]), lab(V.ask, '?')],
    };
  } },
  { levels: [2, 3], make(r, level) { // 45-45-90 in a square
    const dgl = int(r, 3, 12), k = 4.5 / dgl, s = (dgl * k) / Math.SQRT2;
    const pts = [P(-s / 2, -s / 2), P(s / 2, -s / 2), P(s / 2, s / 2), P(-s / 2, s / 2)];
    const askArea = level === 3;
    return {
      title: 'Square diagonal', principle: '45-45-90', question: askArea ? `The diagonal of this square is ${dgl}. What is its area?` : `The diagonal of this square is ${dgl}. How long is one side?`,
      answer: askArea ? (dgl * dgl) / 2 : dgl / Math.SQRT2, unit: '',
      hint: 'The diagonal cuts the square into two 45-45-90 triangles: sides x, x, x√2', explain: askArea ? `Side = ${dgl}/√2, so area = ${dgl}²/2 = ${(dgl * dgl) / 2}.` : `Side = ${dgl} ÷ √2 = ${dgl}√2/2.`,
      figure: [{ kind: 'poly', pts }, { kind: 'line', a: pts[0], b: pts[2], ext: 'segment', dash: 'dashed' }, { kind: 'right', p: pts[0], u: P(1, 0), v: P(0, 1) }, { kind: 'label', at: P(0.35, -0.35), text: String(dgl) }, ...(askArea ? [] : [sideLabel(pts[0], pts[1], pts[2], '?')])],
    };
  } },
  { levels: [4], make(r) { // 45° and 30° sharing an altitude
    const k = int(r, 2, 7), asks = int(r, 0, 1);
    const D = P(0, 0), A = P(0, k), B = P(-k, 0), C = P(k * Math.sqrt(3), 0);
    const sh = (q) => P(q.x - (C.x - k) / 2 * 0.6, q.y - k / 2);
    const [A2, B2, C2, D2] = [A, B, C, D].map(sh);
    const fig = [{ kind: 'poly', pts: [B2, C2, A2] }, { kind: 'line', a: A2, b: D2, ext: 'segment', dash: 'dashed' }, { kind: 'right', p: D2, u: P(1, 0), v: P(0, 1) }, cornerLabel(B2, C2, A2, '45°', 1.2), cornerLabel(C2, B2, A2, '30°', 1.6)];
    if (asks === 0) return { title: 'Two special triangles', principle: '45-45-90 + 30-60-90', question: 'How long is the base marked ?', answer: k + k * Math.sqrt(3), unit: '', hint: 'The altitude splits it into a 45-45-90 and a 30-60-90 triangle. Find the altitude first.',
      explain: `AB = ${k}√2 → altitude = ${k} (45-45-90) → left part ${k}, right part ${k}√3 (30-60-90). Base = ${k} + ${k}√3.`, figure: [...fig, sideLabel(B2, A2, C2, `${k}√2`), sideLabel(B2, C2, A2, '?')] };
    return { title: 'Two special triangles', principle: '30-60-90 + 45-45-90', question: 'How long is the side marked ?', answer: k * Math.SQRT2, unit: '', hint: 'The altitude splits it into a 30-60-90 and a 45-45-90 triangle. Find the altitude first.',
      explain: `AC = ${2 * k} → altitude = ${k} (half the hypotenuse, 30-60-90) → the 45-45-90 side is ${k}√2.`, figure: [...fig, sideLabel(C2, A2, B2, String(2 * k)), sideLabel(B2, A2, C2, '?')] };
  } },
  { levels: [3], make(r) { // equilateral triangle area
    const s = int(r, 1, 6) * 2;
    const k = 5 / s, pts = center([P(0, 0), P(s * k, 0), P((s * k) / 2, (s * k * Math.sqrt(3)) / 2)]);
    return {
      title: 'Equilateral area', principle: '30-60-90', question: `Each side is ${s}. What is the area?`, answer: (s * s * Math.sqrt(3)) / 4, unit: '',
      hint: 'Drop the height: it makes a 30-60-90 triangle with short leg half a side', explain: `Height = ${s / 2}√3, area = ½ × ${s} × ${s / 2}√3 = ${(s * s) / 4}√3.`,
      figure: [{ kind: 'poly', pts }, { kind: 'tick', a: pts[0], b: pts[1] }, { kind: 'tick', a: pts[1], b: pts[2] }, { kind: 'tick', a: pts[2], b: pts[0] }, sideLabel(pts[0], pts[1], pts[2], String(s))],
    };
  } },
  { levels: [4], make(r) { // incircle of an equilateral triangle
    const k = int(r, 1, 4), s = 6 * k;
    const kk = 5.5 / s, pts = center([P(0, 0), P(s * kk, 0), P((s * kk) / 2, (s * kk * Math.sqrt(3)) / 2)]);
    const rin = (s * Math.sqrt(3)) / 6;
    return {
      title: 'Circle in a triangle', principle: '30-60-90', question: `The equilateral triangle has sides of ${s}. What is the radius of the circle inside it?`, answer: rin, unit: '',
      hint: 'The center is the centroid: the radius is ⅓ of the height', explain: `Height = ${s / 2}√3, radius = height ÷ 3 = ${k}√3.`,
      figure: [{ kind: 'poly', pts }, { kind: 'circle', c: P(0, 0), r: rin * kk }, { kind: 'tick', a: pts[0], b: pts[1] }, { kind: 'tick', a: pts[1], b: pts[2] }, { kind: 'tick', a: pts[2], b: pts[0] }, sideLabel(pts[0], pts[1], pts[2], String(s))],
    };
  } },
  // --- Pythagorean theorem ---
  { levels: [4], make(r) { // two right triangles sharing an altitude
    const [L, R] = pick(r, SHARED); const [bd, ad, ab] = L, [dc, , ac] = R;
    const k = 7 / Math.max(bd + dc, ad * 1.4);
    const D = P(0, 0), A = P(0, ad * k), B = P(-bd * k, 0), C = P(dc * k, 0);
    const sh = (q) => P(q.x - ((dc - bd) * k) / 2, q.y - (ad * k) / 2);
    const [A2, B2, C2, D2] = [A, B, C, D].map(sh);
    return {
      title: 'Double Pythagoras', principle: 'Pythagorean theorem ×2', question: 'The dashed line is an altitude. How long is the base marked ?', answer: bd + dc, unit: '',
      hint: 'Use a² + b² = c² in each right triangle to find the two pieces of the base', explain: `Left: √(${ab}² − ${ad}²) = ${bd}. Right: √(${ac}² − ${ad}²) = ${dc}. Base = ${bd + dc}.`,
      figure: [{ kind: 'poly', pts: [B2, C2, A2] }, { kind: 'line', a: A2, b: D2, ext: 'segment', dash: 'dashed' }, { kind: 'right', p: D2, u: P(1, 0), v: P(0, 1) }, sideLabel(B2, A2, C2, String(ab)), sideLabel(C2, A2, B2, String(ac)), { kind: 'label', at: P(D2.x + 0.35, D2.y + (ad * k) / 2), text: String(ad) }, sideLabel(B2, C2, A2, '?')],
    };
  } },
  { levels: [4], make(r) { // isosceles trapezoid area
    const [o, h, L] = pick(r, [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 6, 10], [4, 3, 5]]);
    const top = int(r, 2, 8), bottom = top + 2 * o;
    const k = 7 / bottom;
    const pts = [P(-(bottom * k) / 2, -(h * k) / 2), P((bottom * k) / 2, -(h * k) / 2), P((top * k) / 2, (h * k) / 2), P(-(top * k) / 2, (h * k) / 2)];
    return {
      title: 'Trapezoid area', principle: 'Pythagorean theorem', question: 'This isosceles trapezoid has parallel sides ' + top + ' and ' + bottom + ' and legs ' + L + '. What is its area?', answer: ((top + bottom) / 2) * h, unit: '',
      hint: 'Drop heights from the top corners: each overhang is (bottom − top) ÷ 2, then use a² + b² = c²', explain: `Overhang ${o}, height √(${L}² − ${o}²) = ${h}, area = ½(${top} + ${bottom}) × ${h} = ${((top + bottom) / 2) * h}.`,
      figure: [{ kind: 'poly', pts }, { kind: 'parallel', at: mid(pts[0], pts[1]), dir: P(1, 0) }, { kind: 'parallel', at: mid(pts[2], pts[3]), dir: P(1, 0) }, { kind: 'tick', a: pts[1], b: pts[2] }, { kind: 'tick', a: pts[3], b: pts[0] },
        sideLabel(pts[0], pts[1], pts[2], String(bottom)), sideLabel(pts[2], pts[3], pts[0], String(top)), sideLabel(pts[1], pts[2], pts[0], String(L))],
    };
  } },
  { levels: [3], make(r) { // rhombus from diagonals
    const [a, b, c] = pick(r, TRIPLES_SMALL.slice(0, 5));
    const k = 3.2 / Math.max(a, b), pts = [P(-b * k, 0), P(0, -a * k), P(b * k, 0), P(0, a * k)];
    return {
      title: 'Rhombus', principle: 'Pythagorean theorem', question: `A rhombus has diagonals ${2 * a} and ${2 * b}. What is its perimeter?`, answer: 4 * c, unit: '',
      hint: 'A rhombus’s diagonals cut each other in half at right angles', explain: `Half-diagonals ${a} and ${b} → side √(${a}² + ${b}²) = ${c} → perimeter ${4 * c}.`,
      figure: [{ kind: 'poly', pts }, { kind: 'line', a: pts[0], b: pts[2], ext: 'segment', dash: 'dashed' }, { kind: 'line', a: pts[1], b: pts[3], ext: 'segment', dash: 'dashed' }, ...pts.map((p, i) => ({ kind: 'tick', a: p, b: pts[(i + 1) % 4] }))],
    };
  } },
  // --- circles ---
  { levels: [3], make(r) { // Thales: angle in a semicircle
    const [a, b, c] = pick(r, TRIPLES_SMALL);
    const R = 3.3, k = (2 * R) / c;
    const A = P(-R, 0), B = P(R, 0), al = Math.acos(a / c), C = P(A.x + a * k * Math.cos(al), A.y + a * k * Math.sin(al));
    return {
      title: 'Angle in a semicircle', principle: 'Thales + Pythagoras', question: `AB is a diameter of length ${c}. How long is the side marked ?`, answer: b, unit: '',
      hint: 'An angle inscribed in a semicircle is a right angle (Thales’ theorem)', explain: `∠C = 90°, so ? = √(${c}² − ${a}²) = ${b}.`,
      figure: [{ kind: 'circle', c: P(0, 0), r: R, faint: true }, { kind: 'poly', pts: [A, B, C] }, { kind: 'point', p: A, label: 'A' }, { kind: 'point', p: B, label: 'B' }, { kind: 'point', p: C, label: 'C' }, sideLabel(A, C, B, String(a)), sideLabel(B, C, A, '?')],
    };
  } },
  { levels: [3], make(r) { // inscribed angle theorem
    const x = int(r, 5, 14) * 5, rev = r() < 0.5, R = 3.2;
    const a1 = -Math.PI / 2 - x * DEG, a2 = -Math.PI / 2 + x * DEG; // central angle 2x around the bottom
    const A = P(R * Math.cos(a1), R * Math.sin(a1)), B = P(R * Math.cos(a2), R * Math.sin(a2)), Cc = P(R * Math.cos(Math.PI / 2 + 0.5), R * Math.sin(Math.PI / 2 + 0.5)), O = P(0, 0);
    return {
      title: 'Inscribed angle', principle: 'Inscribed angle theorem', question: rev ? 'O is the center. What is the central angle marked ?' : 'O is the center. What is the inscribed angle marked ?', answer: rev ? 2 * x : x, unit: '°',
      hint: 'An inscribed angle is half the central angle on the same arc', explain: rev ? `Central = 2 × ${x}° = ${2 * x}°.` : `Inscribed = ${2 * x}° ÷ 2 = ${x}°.`,
      figure: [{ kind: 'circle', c: O, r: R }, { kind: 'line', a: O, b: A, ext: 'segment' }, { kind: 'line', a: O, b: B, ext: 'segment' }, { kind: 'line', a: Cc, b: A, ext: 'segment' }, { kind: 'line', a: Cc, b: B, ext: 'segment' }, { kind: 'point', p: O, label: 'O' },
        cornerLabel(O, A, B, rev ? '?' : `${2 * x}°`, 0.8), cornerLabel(Cc, A, B, rev ? `${x}°` : '?', 1.2)],
    };
  } },
  { levels: [3], make(r) { // tangent ⟂ radius
    const [a, b, c] = pick(r, TRIPLES_SMALL);
    const k = 5 / c, R = a * k, O = P(-2.4, 0), Pp = P(O.x + c * k, 0), ang = Math.acos(a / c), Tt = P(O.x + R * Math.cos(ang), R * Math.sin(ang));
    return {
      title: 'Tangent', principle: 'Tangent ⟂ radius', question: `PT touches the circle at T. The radius is ${a} and OP = ${c}. How long is PT?`, answer: b, unit: '',
      hint: 'A tangent is perpendicular to the radius at the point where it touches', explain: `OT ⟂ PT, so PT = √(${c}² − ${a}²) = ${b}.`,
      figure: [{ kind: 'circle', c: O, r: R }, { kind: 'line', a: O, b: Tt, ext: 'segment' }, { kind: 'line', a: Tt, b: Pp, ext: 'segment' }, { kind: 'line', a: O, b: Pp, ext: 'segment', dash: 'dashed' }, { kind: 'point', p: O, label: 'O' }, { kind: 'point', p: Pp, label: 'P' }, { kind: 'point', p: Tt, label: 'T' }],
    };
  } },
  { levels: [4], make(r) { // circular segment area (60°)
    const R = pick(r, [2, 4, 6]), sc = 3.6 / R;
    const a0 = Math.PI / 3, A = P(R * sc, 0), B = P(R * sc * Math.cos(a0), R * sc * Math.sin(a0));
    return {
      title: 'Circle segment', principle: 'Sector − triangle', question: `The radius is ${R} and the central angle is 60°. What is the shaded area? (use π)`, answer: (Math.PI * R * R) / 6 - (Math.sqrt(3) / 4) * R * R, unit: '',
      hint: 'Shaded = sector − triangle. With 60° and two radii, the triangle is equilateral.', explain: `Sector = ${R * R}π/6, triangle = ${R * R}√3/4.`,
      figure: [{ kind: 'circle', c: P(0, 0), r: R * sc, faint: true }, { kind: 'segmentShade', c: P(0, 0), r: R * sc, t0: 0, sweep: a0 }, { kind: 'line', a: P(0, 0), b: A, ext: 'segment' }, { kind: 'line', a: P(0, 0), b: B, ext: 'segment' }, { kind: 'line', a: A, b: B, ext: 'segment' },
        { kind: 'label', at: P(0.9, 0.3), text: '60°' }, { kind: 'label', at: P((R * sc) / 2, -0.45), text: String(R) }],
    };
  } },
  // --- other classics ---
  { levels: [3], make(r) { // triangle proportionality
    const a = int(r, 2, 6), b = int(r, 1, 6), m = int(r, 1, 3), c = a * m, bc = m * (a + b);
    const k = 6 / (a + b), A = P(0.6, 2.4), Bp = P(-3, -2.2), Cp = P(3.5, -2.2);
    const t = a / (a + b), D = P(A.x + (Bp.x - A.x) * t, A.y + (Bp.y - A.y) * t), E = P(A.x + (Cp.x - A.x) * t, A.y + (Cp.y - A.y) * t);
    void k;
    return {
      title: 'Parallel inside a triangle', principle: 'Similar triangles', question: `DE is parallel to BC. AD = ${a}, DB = ${b}, DE = ${c}. How long is BC?`, answer: bc, unit: '',
      hint: 'DE ∥ BC makes triangle ADE similar to triangle ABC', explain: `Scale factor AB/AD = ${a + b}/${a}, so BC = ${c} × ${a + b}/${a} = ${bc}.`,
      figure: [{ kind: 'poly', pts: [A, Bp, Cp] }, { kind: 'line', a: D, b: E, ext: 'segment' }, { kind: 'parallel', at: mid(D, E), dir: unit(D, E) }, { kind: 'parallel', at: mid(Bp, Cp), dir: unit(Bp, Cp) },
        { kind: 'point', p: A, label: 'A' }, { kind: 'point', p: Bp, label: 'B' }, { kind: 'point', p: Cp, label: 'C' }, { kind: 'point', p: D, label: 'D' }, { kind: 'point', p: E, label: 'E' }],
    };
  } },
  { levels: [3], make(r) { // exterior angle + isosceles
    const ext = int(r, 11, 16) * 10, base = 180 - ext, apex = 180 - 2 * base;
    const pts = triFromAngles(base, base, 6), [p, q, s] = pts, far = P(q.x + 3, q.y);
    return {
      title: 'Isosceles outside angle', principle: 'Linear pair + isosceles', question: 'The marked sides are equal. What is the top angle ?', answer: apex, unit: '°',
      hint: 'The exterior angle and the base angle make 180°; the two base angles are equal', explain: `Base angle = 180° − ${ext}° = ${base}°, top = 180° − 2 × ${base}° = ${apex}°.`,
      figure: [{ kind: 'poly', pts }, { kind: 'line', a: q, b: far, ext: 'segment', dash: 'dashed' }, { kind: 'tick', a: p, b: s }, { kind: 'tick', a: q, b: s }, cornerLabel(q, far, s, `${ext}°`, 1.0), cornerLabel(s, p, q, '?', 0.9)],
    };
  } },
  { levels: [3], make(r) { // regular polygon from its angle
    const n = pick(r, [5, 6, 8, 9, 10, 12, 15, 18, 20]), X = ((n - 2) * 180) / n;
    const V = P(0, -0.5), a = P(V.x - 3.2, V.y + 0.2), t = Math.PI - X * DEG, b = P(V.x + 3.2 * Math.cos(Math.PI - (X * DEG - Math.atan2(0.2, 3.2))), V.y + 3.2 * Math.sin(Math.PI - (X * DEG - Math.atan2(0.2, 3.2))));
    void t;
    return {
      title: 'How many sides?', principle: 'Polygon angle sum', question: `Each interior angle of a regular polygon is ${X}°. How many sides does it have?`, answer: n, unit: '',
      hint: 'Each exterior angle is 180° − interior, and the exterior angles add up to 360°', explain: `Exterior = ${180 - X}°, sides = 360 ÷ ${180 - X} = ${n}.`,
      figure: [{ kind: 'line', a: V, b: a, ext: 'segment' }, { kind: 'line', a: V, b, ext: 'segment' }, cornerLabel(V, a, b, `${X}°`, 1.0), { kind: 'point', p: V, label: '' }],
    };
  } },
];

export const TEMPLATE_COUNT = TEMPLATES.length;
export const STARS = { 2: '★★', 3: '★★★', 4: '★★★★' };
// Difficulty follows the week: Monday warm-up, Tuesday–Thursday ★★★, Friday–Sunday ★★★★.
export function levelFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return [4, 2, 3, 3, 3, 4, 4][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function generatePuzzle(dateStr, templateIndex = null, levelOverride = null) {
  const r = rngFor(hashStr('vertex-forge|' + dateStr));
  let level = levelOverride ?? levelFor(dateStr);
  let idx = templateIndex;
  if (idx == null) {
    const pool = TEMPLATES.map((t, i) => i).filter((i) => TEMPLATES[i].levels.includes(level));
    idx = pool[Math.floor(r() * pool.length)];
  } else if (!TEMPLATES[idx].levels.includes(level)) level = TEMPLATES[idx].levels[TEMPLATES[idx].levels.length - 1];
  const p = TEMPLATES[idx].make(r, level);
  return { number: puzzleNumber(dateStr), date: dateStr, template: idx, level, stars: STARS[level], ...p };
}

// Read an answer typed as a number or simple expression: 12, 4.5, 3√2, 9 - 2.25π, 900/7
export function readAnswer(text) {
  let s = String(text).trim().replace(/^[a-z?]\s*=\s*/i, '').replace(/°/g, '').replace(/,/g, '.').replace(/−/g, '-').replace(/[×·]/g, '*');
  s = s.replace(/√\s*(\d+(?:\.\d+)?|\([^)]*\))/g, 'sqrt($1)');
  return s;
}
export function isCorrect(value, answer) {
  if (!isFinite(value)) return false;
  return Math.abs(value - answer) <= Math.max(0.011, Math.abs(answer) * 1e-3);
}
