import assert from 'node:assert/strict';
import * as PZ from '../js/puzzle.js';
import { compile } from '../js/expr.js';
import { exactForm } from '../js/exact.js';
const a = PZ.generatePuzzle('2026-09-27'), b = PZ.generatePuzzle('2026-09-27'), c = PZ.generatePuzzle('2026-09-28');
assert.deepEqual(a, b, 'same date, same puzzle');
assert.notDeepEqual(a, c);
assert.equal(PZ.puzzleNumber('2026-01-01'), 1);
assert.equal(PZ.puzzleNumber('2026-09-27'), 270);
// every template, many seeds: finite answers, sane figures, and a readable exact answer where expected
const used = new Set();
for (let d = 0; d < 400; d++) {
  const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
  const p = PZ.generatePuzzle(date);
  used.add(p.template);
  assert.ok(isFinite(p.answer) && p.answer > 0, `${date} ${p.title} answer ${p.answer}`);
  assert.ok(p.figure.length >= 1 && p.question && p.hint && p.explain);
  for (const it of p.figure) for (const k of ['pts', 'p', 'c', 'a', 'b', 'at']) {
    const v = it[k];
    if (!v || typeof v !== 'object') continue;
    for (const q of Array.isArray(v) ? v : [v]) assert.ok(isFinite(q.x) && isFinite(q.y), `${p.title} ${k}`);
  }
}
assert.equal(used.size, PZ.TEMPLATE_COUNT, 'every puzzle type shows up');
for (let t = 0; t < PZ.TEMPLATE_COUNT; t++) {
  const p = PZ.generatePuzzle('2026-05-05', t);
  const exact = exactForm(p.answer);
  assert.ok(exact, `${p.title}: ${p.answer} should have an exact form`);
}
// answer reading
const val = (s) => compile(PZ.readAnswer(s))(0);
assert.ok(PZ.isCorrect(val('3√2'), 3 * Math.SQRT2));
assert.ok(PZ.isCorrect(val('4.24'), 3 * Math.SQRT2));
assert.ok(!PZ.isCorrect(val('4.2'), 3 * Math.SQRT2));
assert.ok(PZ.isCorrect(val('36 − 9π'), 36 - 9 * Math.PI));
assert.ok(PZ.isCorrect(val('900/7'), 900 / 7));
assert.ok(PZ.isCorrect(val('128.57'), 900 / 7));
assert.ok(PZ.isCorrect(val('√(58)'), Math.sqrt(58)));
console.log('✓ daily puzzles (' + PZ.TEMPLATE_COUNT + ' kinds)');
