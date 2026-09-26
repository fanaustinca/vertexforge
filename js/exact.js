// Recognise "nice" exact values: fractions, simplest radical form and multiples of π.
// e.g. 1.4142135623730951 -> "√2", 2.598076211353316 -> "3√3/2", 7.0685834705770345 -> "9π/4",
// 1.618033988749895 -> "(1 + √5)/2".

const SQUAREFREE = [];
for (let n = 2; n <= 300; n++) {
  let ok = true;
  for (let k = 2; k * k <= n; k++) if (n % (k * k) === 0) { ok = false; break; }
  if (ok) SQUAREFREE.push(n);
}

// Best rational p/q with q <= maxDen, via continued fractions. Returns null if not within tol.
export function rational(t, maxDen = 100, tol = 1e-9) {
  if (!isFinite(t)) return null;
  const sign = t < 0 ? -1 : 1;
  let x = Math.abs(t);
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(h1 / k1 - Math.abs(t)) <= tol * Math.max(1, Math.abs(t))) return { p: sign * h1, q: k1 };
    const f = x - a;
    if (f < 1e-15) break;
    x = 1 / f;
  }
  return null;
}

function frac(p, q, body) {
  // p/q * body, where body is '' (plain number), '√r', 'π', 'π√r'
  const neg = p < 0;
  const ap = Math.abs(p);
  let s;
  if (!body) s = q === 1 ? `${ap}` : `${ap}/${q}`;
  else s = `${ap === 1 ? '' : ap}${body}${q === 1 ? '' : '/' + q}`;
  return (neg ? '−' : '') + s;
}

const cache = new Map();

// Returns an exact string for v, or null when no simple exact form fits.
export function exactForm(v, opts = {}) {
  if (!isFinite(v)) return null;
  const key = v.toPrecision(15) + (opts.noPi ? 'n' : '');
  if (cache.has(key)) return cache.get(key);
  const out = find(v, opts);
  if (cache.size > 5000) cache.clear();
  cache.set(key, out);
  return out;
}

// Geometry here is accurate to ~1e-13, so a tight tolerance keeps random decimals from
// being mistaken for exact values; small numerators/denominators keep the forms readable.
function find(v, { noPi } = {}) {
  const tol = 1e-11;
  if (Math.abs(v) < 1e-12) return '0';
  // 1. plain fraction
  let r = rational(v, 100, tol);
  if (r && (r.q <= 16 || Math.abs(r.p) <= 1000)) return frac(r.p, r.q, '');
  // 2. (p/q)·√n
  for (const n of SQUAREFREE) {
    r = rational(v / Math.sqrt(n), 64, tol);
    if (r && Math.abs(r.p) <= 300) return frac(r.p, r.q, `√${n}`);
  }
  if (!noPi) {
    // 3. (p/q)·π  and  (p/q)·π·√n
    r = rational(v / Math.PI, 100, tol);
    if (r && Math.abs(r.p) <= 300) return frac(r.p, r.q, 'π');
    for (const n of SQUAREFREE.slice(0, 40)) {
      r = rational(v / (Math.PI * Math.sqrt(n)), 60, tol);
      if (r && Math.abs(r.p) <= 100) return frac(r.p, r.q, `π√${n}`);
    }
  }
  // 4. (a + b√n)/d  — golden ratio, 2 + √3, (√6 − √2)/4 style values are covered partly
  for (const n of SQUAREFREE.slice(0, 20)) {
    const s = Math.sqrt(n);
    for (let d = 1; d <= 8; d++) {
      for (let b = 1; b <= 12; b++) {
        for (const sb of [1, -1]) {
          const a = v * d - sb * b * s;
          const ai = Math.round(a);
          if (Math.abs(a - ai) <= tol * Math.max(1, Math.abs(v * d)) && ai !== 0 && Math.abs(ai) <= 200) {
            if (gcd(gcd(Math.abs(ai), b), d) !== 1) continue;
            const inner = `${ai < 0 ? '−' : ''}${Math.abs(ai)} ${sb > 0 ? '+' : '−'} ${b === 1 ? '' : b}√${n}`;
            return d === 1 ? inner : `(${inner})/${d}`;
          }
        }
      }
    }
  }
  // 5. rational + rational·π  (e.g. 4 − π, π − 2, (π − 2)/2, 2π + 3)
  if (!noPi) {
    for (let d = 1; d <= 12; d++) {
      for (let b = 1; b <= 24; b++) {
        for (const sb of [1, -1]) {
          const rem = v - (sb * b * Math.PI) / d;
          const rr = rational(rem, 12, tol);
          if (!rr || rr.p === 0 || Math.abs(rr.p) > 200 || gcd(b, d) !== 1) continue;
          const piTerm = `${b === 1 ? '' : b}π${d === 1 ? '' : '/' + d}`;
          const ratTerm = rr.q === 1 ? `${Math.abs(rr.p)}` : `${Math.abs(rr.p)}/${rr.q}`;
          if (rr.p > 0 && sb > 0) return `${ratTerm} + ${piTerm}`;
          if (rr.p > 0 && sb < 0) return `${ratTerm} − ${piTerm}`;
          if (rr.p < 0 && sb > 0) return `${piTerm} − ${ratTerm}`;
          return `−(${ratTerm} + ${piTerm})`;
        }
      }
    }
  }
  // 6. (b/d)·π + (p/q)·√n  (e.g. the lens 2π/3 − √3/2, sector minus triangle π/3 − √3/4)
  if (!noPi) {
    for (const n of SQUAREFREE.slice(0, 12)) {
      const sq = Math.sqrt(n);
      for (let d = 1; d <= 12; d++) {
        for (let b = 1; b <= 12; b++) {
          if (gcd(b, d) !== 1) continue;
          for (const sb of [1, -1]) {
            const rr = rational((v - (sb * b * Math.PI) / d) / sq, 12, tol);
            if (!rr || rr.p === 0 || Math.abs(rr.p) > 24) continue;
            const piTerm = `${b === 1 ? '' : b}π${d === 1 ? '' : '/' + d}`;
            const rt = `${Math.abs(rr.p) === 1 ? '' : Math.abs(rr.p)}√${n}${rr.q === 1 ? '' : '/' + rr.q}`;
            if (sb > 0) return `${piTerm} ${rr.p > 0 ? '+' : '−'} ${rt}`;
            return rr.p > 0 ? `${rt} − ${piTerm}` : `−(${piTerm} + ${rt})`;
          }
        }
      }
    }
  }
  // 7. √p/√q style: v² rational (e.g. √(3/2) = √6/2 is caught above), and cube roots aren't handled
  return null;
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
