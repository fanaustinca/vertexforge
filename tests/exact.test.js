import assert from 'node:assert/strict';
import { exactForm, rational } from '../js/exact.js';
const cases = [
  [4, '4'], [1.5, '3/2'], [-0.25, '−1/4'], [Math.SQRT2, '√2'], [2 * Math.SQRT2, '2√2'], [Math.sqrt(8), '2√2'],
  [Math.sqrt(3) / 2, '√3/2'], [3 * Math.sqrt(3) / 2, '3√3/2'], [Math.sqrt(50), '5√2'], [Math.PI, 'π'],
  [9 * Math.PI / 4, '9π/4'], [Math.PI / 2, 'π/2'], [2 * Math.PI, '2π'], [Math.PI * Math.sqrt(3), 'π√3'],
  [(1 + Math.sqrt(5)) / 2, '(1 + √5)/2'], [2 + Math.sqrt(3), '2 + √3'], [Math.sqrt(13), '√13'], [0, '0'],
  [Math.sqrt(2) / 4 * 6, '3√2/2'],
  [4 - Math.PI, '4 − π'], [Math.PI - 2, 'π − 2'], [(Math.PI - 2) / 2, 'π/2 − 1'], [2 * Math.PI + 3, '3 + 2π'], [16 - 4 * Math.PI, '16 − 4π'], [2 * Math.PI / 3 - Math.sqrt(3) / 2, '2π/3 − √3/2'], [Math.PI / 3 - Math.sqrt(3) / 4, 'π/3 − √3/4'], [Math.sqrt(3) - Math.PI / 2, '√3 − π/2'],
];
for (const [v, want] of cases) assert.equal(exactForm(v), want, `${v}`);
// values that are not "nice" stay decimal
for (const v of [1.2345678901, Math.E, Math.PI + 0.123456789, 3.605551275463989 * 1.0001]) assert.equal(exactForm(v), null, `${v}`);
// geometry sanity: diagonal of unit square, equilateral triangle side 2 area, circle r=3 area
assert.equal(exactForm(Math.hypot(1, 1)), '√2');
assert.equal(exactForm(Math.sqrt(3) / 4 * 4), '√3');
assert.equal(exactForm(Math.PI * 9), '9π');
assert.deepEqual(rational(0.3333333333333333), { p: 1, q: 3 });
console.log(`✓ exact forms (${cases.length} cases)`);
