// Statistics for the Data tool: parse pasted data, summary numbers, regression.

// Accepts "3, 5, 8" / one number per line / "x, y" pairs per line / "(1,2) (3,4)".
export function parseData(text) {
  const t = text.trim();
  if (!t) throw new Error('Paste or type some numbers');
  const pairRe = /\(\s*(-?[\d.e+-]+)\s*[,;]\s*(-?[\d.e+-]+)\s*\)/gi;
  const pairs = [...t.matchAll(pairRe)].map((m) => [+m[1], +m[2]]);
  if (pairs.length) return check({ kind: 'pairs', pairs });
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => l.split(/[\s,;\t]+/).filter(Boolean));
  // two columns on every line -> pairs (a header line of words is skipped)
  const body = rows.filter((r) => r.some((c) => /\d/.test(c)));
  if (body.length >= 2 && body.every((r) => r.length === 2)) return check({ kind: 'pairs', pairs: body.map((r) => [+r[0], +r[1]]) });
  const values = body.flat().map(Number);
  return check({ kind: 'values', values });
}
function check(d) {
  const bad = d.kind === 'pairs' ? d.pairs.flat().some((v) => !isFinite(v)) : d.values.some((v) => !isFinite(v));
  if (bad) throw new Error('Some entries aren’t numbers');
  if ((d.kind === 'pairs' ? d.pairs : d.values).length < 1) throw new Error('No numbers found');
  return d;
}

const median = (s) => { const n = s.length, m = n >> 1; return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function summary(values) {
  const s = values.slice().sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const ss = s.reduce((a, v) => a + (v - mean) ** 2, 0);
  // quartiles: medians of the lower and upper halves (the middle value is left out when n is odd)
  const lower = s.slice(0, n >> 1), upper = s.slice(n % 2 ? (n >> 1) + 1 : n >> 1);
  const q1 = n > 1 ? median(lower) : s[0], q3 = n > 1 ? median(upper) : s[0];
  const counts = new Map();
  for (const v of s) counts.set(v, (counts.get(v) || 0) + 1);
  const top = Math.max(...counts.values());
  const mode = top > 1 ? [...counts].filter(([, c]) => c === top).map(([v]) => v) : [];
  const iqr = q3 - q1;
  const outliers = s.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
  return {
    n, sum, mean, median: median(s), mode, min: s[0], max: s[n - 1], range: s[n - 1] - s[0], q1, q3, iqr,
    popSD: Math.sqrt(ss / n), sampleSD: n > 1 ? Math.sqrt(ss / (n - 1)) : 0, variance: ss / n, sorted: s, outliers,
  };
}

// Least-squares line y = m x + b with correlation r.
export function linearRegression(pairs) {
  const n = pairs.length;
  if (n < 2) throw new Error('A line of best fit needs at least 2 points');
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n, my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pairs) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  if (sxx === 0) throw new Error('All the x values are the same, so there is no line of best fit');
  const m = sxy / sxx, b = my - m * mx;
  const r = syy === 0 ? 1 : sxy / Math.sqrt(sxx * syy);
  return { m, b, r, r2: r * r, mx, my };
}

// Histogram bins (Sturges' rule by default).
export function histogram(values, bins) {
  const s = summary(values);
  const k = bins || Math.max(1, Math.ceil(Math.log2(s.n) + 1));
  const w = s.range === 0 ? 1 : s.range / k;
  const out = Array.from({ length: k }, (_, i) => ({ x0: s.min + i * w, x1: s.min + (i + 1) * w, count: 0 }));
  for (const v of values) out[Math.min(k - 1, Math.floor((v - s.min) / w))].count++;
  return out;
}
