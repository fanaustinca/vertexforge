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

const TEMPLATES = [
  // 1. hypotenuse (often a radical)
  (r) => {
    const a = int(r, 2, 9), b = int(r, 2, 9);
    const [A, B, C] = center([P(0, 0), P(b, 0), P(0, a)]);
    return {
      title: 'Hypotenuse hunt', question: 'How long is the side marked ?', answer: Math.hypot(a, b),
      hint: 'a² + b² = c²', explain: `${a}² + ${b}² = ${a * a + b * b}, so the side is √${a * a + b * b}.`,
      figure: [{ kind: 'poly', pts: [A, B, C] }, { kind: 'right', p: A, u: P(1, 0), v: P(0, 1) }, sideLabel(A, B, C, String(b)), sideLabel(A, C, B, String(a)), sideLabel(B, C, A, '?')],
    };
  },
  // 2. missing leg from a Pythagorean triple
  (r) => {
    const [a, b, c] = pick(r, TRIPLES); const k = a > 12 ? 0.25 : 0.5;
    const [A, B, C] = center([P(0, 0), P(b * k, 0), P(0, a * k)]);
    return {
      title: 'Missing leg', question: 'How long is the side marked ?', answer: a,
      hint: 'The longest side is the hypotenuse: a² + b² = c²', explain: `${c}² − ${b}² = ${c * c - b * b} = ${a}².`,
      figure: [{ kind: 'poly', pts: [A, B, C] }, { kind: 'right', p: A, u: P(1, 0), v: P(0, 1) }, sideLabel(A, B, C, String(b)), sideLabel(A, C, B, '?'), sideLabel(B, C, A, String(c))],
    };
  },
  // 3. third angle
  (r) => {
    const A = int(r, 6, 16) * 5, B = int(r, 6, Math.min(16, 34 - A / 5)) * 5;
    const [p, q, s] = triFromAngles(A, B, 6);
    return {
      title: 'Angle sum', question: 'What is the angle marked ? (in degrees)', answer: 180 - A - B,
      hint: 'A triangle’s angles add up to 180°', explain: `180° − ${A}° − ${B}° = ${180 - A - B}°.`,
      figure: [{ kind: 'poly', pts: [p, q, s] }, cornerLabel(p, q, s, `${A}°`), cornerLabel(q, p, s, `${B}°`), cornerLabel(s, p, q, '?', 0.8)],
    };
  },
  // 4. exterior angle
  (r) => {
    const A = int(r, 6, 14) * 5, B = int(r, 6, Math.min(14, 30 - A / 5)) * 5;
    const [p, q, s] = triFromAngles(A, B, 6);
    const ext = P(q.x + 3, q.y);
    return {
      title: 'Outside angle', question: 'What is the exterior angle marked ? (in degrees)', answer: A + (180 - A - B),
      hint: 'An exterior angle equals the sum of the two opposite interior angles', explain: `It equals ${A}° + ${180 - A - B}° = ${180 - B}°.`,
      figure: [{ kind: 'poly', pts: [p, q, s] }, { kind: 'line', a: q, b: ext, ext: 'segment', dash: 'dashed' }, cornerLabel(p, q, s, `${A}°`), cornerLabel(s, p, q, `${180 - A - B}°`, 0.8), cornerLabel(q, ext, s, '?', 0.9)],
    };
  },
  // 5. isosceles base angle
  (r) => {
    const V = int(r, 2, 14) * 10, base = (180 - V) / 2;
    const pts = triFromAngles(base, base, 6);
    const [p, q, s] = pts;
    return {
      title: 'Isosceles', question: 'The two marked sides are equal. What is the angle marked ?', answer: base,
      hint: 'The two base angles of an isosceles triangle are equal', explain: `(180° − ${V}°) ÷ 2 = ${base}°.`,
      figure: [{ kind: 'poly', pts }, cornerLabel(s, p, q, `${V}°`, 0.9), cornerLabel(p, q, s, '?'), { kind: 'tick', a: p, b: s }, { kind: 'tick', a: q, b: s }],
    };
  },
  // 6. regular polygon interior angle
  (r) => {
    const n = int(r, 5, 12);
    const R = 3.2, pts = Array.from({ length: n }, (_, i) => { const t = -Math.PI / 2 - Math.PI / n + (2 * Math.PI * i) / n; return P(R * Math.cos(t), R * Math.sin(t)); });
    return {
      title: `Regular ${n}-gon`, question: `This is a regular polygon with ${n} sides. What is each interior angle? (degrees)`, answer: ((n - 2) * 180) / n,
      hint: 'The angles of an n-sided polygon add up to (n − 2) × 180°', explain: `(${n} − 2) × 180° ÷ ${n} = ${+(((n - 2) * 180) / n).toFixed(4)}°.`,
      figure: [{ kind: 'poly', pts }, cornerLabel(pts[0], pts[n - 1], pts[1], '?', 0.9)],
    };
  },
  // 7. square inscribed in a circle
  (r) => {
    const R = int(r, 2, 6), s = R * Math.SQRT2 / 2;
    return {
      title: 'Square in a circle', question: 'The circle has radius shown. What is the area of the square?', answer: 2 * R * R,
      hint: 'The square’s diagonal is a diameter of the circle', explain: `Diagonal = ${2 * R}, so area = diagonal² ÷ 2 = ${2 * R * R}.`,
      figure: [{ kind: 'circle', c: P(0, 0), r: R }, { kind: 'poly', pts: [P(-s, -s), P(s, -s), P(s, s), P(-s, s)] }, { kind: 'line', a: P(0, 0), b: P(R, 0), ext: 'segment', dash: 'dashed' }, { kind: 'label', at: P(R / 2, -0.45), text: `r = ${R}` }],
    };
  },
  // 8. shaded corners: square minus inscribed circle
  (r) => {
    const s = int(r, 1, 5) * 2;
    return {
      title: 'Shaded corners', question: 'What is the total shaded area? (use π)', answer: s * s - (Math.PI * s * s) / 4,
      hint: 'Square area minus circle area', explain: `${s}² − π(${s / 2})² = ${s * s} − ${(s * s) / 4}π.`,
      figure: [{ kind: 'poly', pts: [P(-s / 2, -s / 2), P(s / 2, -s / 2), P(s / 2, s / 2), P(-s / 2, s / 2)] }, { kind: 'circle', c: P(0, 0), r: s / 2 }, { kind: 'shade', a: 0, b: 1, op: 'aminusb' }, sideLabel(P(-s / 2, -s / 2), P(s / 2, -s / 2), P(0, 0), String(s))],
    };
  },
  // 9. distance between two points
  (r) => {
    const x1 = int(r, -5, 0), y1 = int(r, -4, 1), x2 = int(r, 1, 6), y2 = int(r, 0, 5);
    const d2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    return {
      title: 'Point to point', question: `How far apart are A(${x1}, ${y1}) and B(${x2}, ${y2})?`, answer: Math.sqrt(d2), noCenter: true,
      hint: 'Make a right triangle with horizontal and vertical legs', explain: `√(${x2 - x1}² + ${y2 - y1}²) = √${d2}.`,
      figure: [{ kind: 'point', p: P(x1, y1), label: 'A' }, { kind: 'point', p: P(x2, y2), label: 'B' }, { kind: 'line', a: P(x1, y1), b: P(x2, y2), ext: 'segment', dash: 'dashed' }],
    };
  },
  // 10. arc length
  (r) => {
    const R = int(r, 2, 6), th = int(r, 1, 10) * 30;
    return {
      title: 'Arc length', question: 'How long is the orange arc? (use π)', answer: (R * Math.PI * th) / 180,
      hint: 'Arc length = (angle ÷ 360) × 2πr', explain: `${th}/360 × 2π × ${R} = ${+((R * th) / 180).toFixed(4)}π.`,
      figure: [{ kind: 'circle', c: P(0, 0), r: R, faint: true }, { kind: 'sector', c: P(0, 0), r: R, t0: 0, sweep: th * DEG }, { kind: 'label', at: P(R / 2, -0.45), text: `r = ${R}` }, { kind: 'label', at: P(0.9 * Math.cos((th * DEG) / 2), 0.9 * Math.sin((th * DEG) / 2)), text: `${th}°` }],
    };
  },
  // 11. rectangle with a semicircle on top
  (r) => {
    const w = int(r, 1, 4) * 2, h = int(r, 2, 6);
    const x0 = -w / 2, y0 = -h / 2;
    return {
      title: 'Arched window', question: 'What is the total area of the window? (use π)', answer: w * h + (Math.PI * w * w) / 8,
      hint: 'Rectangle plus half a circle with diameter equal to the width', explain: `${w}×${h} + ½π(${w / 2})² = ${w * h} + ${(w * w) / 8}π.`,
      figure: [{ kind: 'poly', pts: [P(x0, y0), P(-x0, y0), P(-x0, -y0), P(x0, -y0)] }, { kind: 'semi', c: P(0, -y0), r: w / 2 }, sideLabel(P(x0, y0), P(-x0, y0), P(0, 0), String(w)), sideLabel(P(-x0, y0), P(-x0, -y0), P(0, 0), String(h))],
    };
  },
  // 12. parallel lines cut by a transversal
  (r) => {
    const x = int(r, 7, 16) * 5, same = r() < 0.5;
    const t = x * DEG, d = P(Math.cos(t), Math.sin(t));
    const p1 = P(-1.5 / Math.tan(t), -1.5), p2 = P(1.5 / Math.tan(t), 1.5);
    return {
      title: 'Parallel lines', question: `The two horizontal lines are parallel. What is the angle marked ? (degrees)`, answer: same ? 180 - x : x,
      hint: same ? 'Co-interior (same-side) angles add up to 180°' : 'Alternate angles are equal', explain: same ? `180° − ${x}° = ${180 - x}°.` : `Alternate angles are equal: ${x}°.`,
      figure: [{ kind: 'line', a: P(-5, -1.5), b: P(5, -1.5), ext: 'line' }, { kind: 'line', a: P(-5, 1.5), b: P(5, 1.5), ext: 'line' }, { kind: 'line', a: P(p1.x - d.x * 3, p1.y - d.y * 3), b: P(p2.x + d.x * 3, p2.y + d.y * 3), ext: 'line' },
        cornerLabel(p1, P(p1.x + 5, p1.y), P(p1.x + d.x, p1.y + d.y), `${x}°`, 1.1),
        same ? cornerLabel(p2, P(p2.x + 5, p2.y), P(p2.x - d.x, p2.y - d.y), '?', 1.1) : cornerLabel(p2, P(p2.x - 5, p2.y), P(p2.x - d.x, p2.y - d.y), '?', 1.1)],
    };
  },
  // 13. incircle of a right triangle
  (r) => {
    const [a, b, c] = pick(r, TRIPLES.slice(0, 6)); const k = 0.6;
    const [A, B, C] = center([P(0, 0), P(b * k, 0), P(0, a * k)]);
    const rin = (a + b - c) / 2;
    const I = P(A.x + rin * k, A.y + rin * k);
    return {
      title: 'Circle inside', question: `The circle touches all three sides. What is its radius? (sides ${a}, ${b}, ${c})`, answer: rin,
      hint: 'For a right triangle, r = (a + b − c) ÷ 2', explain: `(${a} + ${b} − ${c}) ÷ 2 = ${rin}.`,
      figure: [{ kind: 'poly', pts: [A, B, C] }, { kind: 'circle', c: I, r: rin * k }, { kind: 'right', p: A, u: P(1, 0), v: P(0, 1) }, sideLabel(A, B, C, String(b)), sideLabel(A, C, B, String(a)), sideLabel(B, C, A, String(c))],
    };
  },
  // 14. circle area from circumference
  (r) => {
    const k = int(r, 2, 12);
    return {
      title: 'Round and round', question: `A circle’s circumference is ${k}π. What is its area? (use π)`, answer: Math.PI * (k / 2) ** 2,
      hint: 'C = 2πr, then A = πr²', explain: `r = ${k / 2}, so A = ${(k * k) / 4}π.`,
      figure: [{ kind: 'circle', c: P(0, 0), r: Math.max(1.5, k / 3) }, { kind: 'label', at: P(0, -Math.max(1.5, k / 3) - 0.6), text: `C = ${k}π` }],
    };
  },
  // 15. similar triangles
  (r) => {
    const [a, b, c] = pick(r, [[3, 4, 5], [6, 8, 10], [5, 12, 13]]);
    const sc = pick(r, [1.5, 2, 2.5, 3]);
    const k = 3.2 / c; // drawing scale so both fit
    const tri = (m, dx) => [P(dx, 0), P(dx + b * k * m, 0), P(dx, a * k * m)];
    const T1 = tri(1, -6.5), T2 = tri(sc, -1.5);
    return {
      title: 'Similar triangles', question: 'The two right triangles are similar. How long is the side marked ?', answer: c * sc,
      hint: 'Find the scale factor from the matching bottom sides', explain: `Scale factor ${b * sc} ÷ ${b} = ${sc}, so ? = ${c} × ${sc} = ${c * sc}.`,
      figure: [{ kind: 'poly', pts: T1 }, { kind: 'poly', pts: T2 }, { kind: 'right', p: T1[0], u: P(1, 0), v: P(0, 1) }, { kind: 'right', p: T2[0], u: P(1, 0), v: P(0, 1) },
        sideLabel(T1[0], T1[1], T1[2], String(b)), sideLabel(T1[0], T1[2], T1[1], String(a)), sideLabel(T1[1], T1[2], T1[0], String(c)),
        sideLabel(T2[0], T2[1], T2[2], String(b * sc)), sideLabel(T2[1], T2[2], T2[0], '?')],
    };
  },
];

export const TEMPLATE_COUNT = TEMPLATES.length;

export function generatePuzzle(dateStr, templateIndex = null) {
  const r = rngFor(hashStr('vertex-forge|' + dateStr));
  const idx = templateIndex ?? Math.floor(r() * TEMPLATES.length);
  const p = TEMPLATES[idx](r);
  return { number: puzzleNumber(dateStr), date: dateStr, template: idx, ...p };
}

// Read an answer typed as a number or simple expression: 12, 4.5, 3√2, 9 - 2.25π, 900/7
export function readAnswer(text) {
  let s = String(text).trim().replace(/°/g, '').replace(/,/g, '.').replace(/−/g, '-').replace(/[×·]/g, '*');
  s = s.replace(/√\s*(\d+(?:\.\d+)?|\([^)]*\))/g, 'sqrt($1)');
  return s;
}
export function isCorrect(value, answer) {
  if (!isFinite(value)) return false;
  return Math.abs(value - answer) <= Math.max(0.011, Math.abs(answer) * 1e-3);
}
