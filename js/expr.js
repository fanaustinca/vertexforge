// Tiny safe math-expression compiler: no eval, only whitelisted functions.
// Supports + - * / ^, unary minus, parentheses, implicit multiplication (2x, 3sin(x), (x+1)(x-1)),
// constants pi, e, tau, phi and the variable x.

const FUNCS = Object.assign(Object.create(null), {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign, sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
});
const CONSTS = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 });

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`Bad number near "${src.slice(i, i + 5)}"`);
      toks.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (/[a-zA-Zπ]/.test(c)) {
      const m = /^([a-zA-Z]+[0-9]*|π)/.exec(src.slice(i));
      toks.push({ t: 'id', v: m[0] === 'π' ? 'pi' : m[0].toLowerCase() }); i += m[0].length; continue;
    }
    if ('+-*/^(),'.includes(c)) { toks.push({ t: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return splitIdents(toks);
}

// "xsin" -> x * sin, "2pi" handled by implicit mult, "sinx" -> sin x
function splitIdents(toks) {
  const out = [];
  const names = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x'].sort((a, b) => b.length - a.length);
  for (const tk of toks) {
    if (tk.t !== 'id' || FUNCS[tk.v] || CONSTS[tk.v] !== undefined || tk.v === 'x') { out.push(tk); continue; }
    let s = tk.v;
    while (s.length) {
      const n = names.find((nm) => s.startsWith(nm));
      if (!n) throw new Error(`Unknown name "${tk.v}"`);
      out.push({ t: 'id', v: n }); s = s.slice(n.length);
    }
  }
  return out;
}

export function compile(src) {
  if (typeof src !== 'string' || src.length > 300) throw new Error('Expression too long');
  const toks = tokenize(src.replace(/^\s*y\s*=\s*/i, ''));
  let p = 0;
  const peek = () => toks[p];
  const eat = (t) => { if (peek()?.t !== t) throw new Error(`Expected "${t}"`); return toks[p++]; };
  const startsAtom = (tk) => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === '(');

  function expr() {
    let l = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = toks[p++].t, r = term(), a = l;
      l = op === '+' ? (x) => a(x) + r(x) : (x) => a(x) - r(x);
    }
    return l;
  }
  function term() {
    let l = unary();
    for (;;) {
      const tk = peek();
      if (tk && (tk.t === '*' || tk.t === '/')) {
        p++; const r = unary(), a = l;
        l = tk.t === '*' ? (x) => a(x) * r(x) : (x) => a(x) / r(x);
      } else if (startsAtom(tk)) {
        const r = power(), a = l; l = (x) => a(x) * r(x);
      } else return l;
    }
  }
  function unary() {
    if (peek()?.t === '-') { p++; const a = unary(); return (x) => -a(x); }
    if (peek()?.t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const b = atom();
    if (peek()?.t === '^') { p++; const e = unary(); return (x) => Math.pow(b(x), e(x)); }
    return b;
  }
  function atom() {
    const tk = toks[p++];
    if (!tk) throw new Error('Unexpected end');
    if (tk.t === 'num') { const v = tk.v; return () => v; }
    if (tk.t === '(') { const e = expr(); eat(')'); return e; }
    if (tk.t === 'id') {
      if (tk.v === 'x') return (x) => x;
      if (CONSTS[tk.v] !== undefined) { const v = CONSTS[tk.v]; return () => v; }
      const f = FUNCS[tk.v];
      if (f) {
        let arg;
        if (peek()?.t === '(') { p++; arg = expr(); eat(')'); } else arg = power();
        if (peek()?.t === '^') { p++; const e = unary(); const a = arg; return (x) => Math.pow(f(a(x)), e(x)); }
        return (x) => f(arg(x));
      }
    }
    throw new Error(`Unexpected "${tk.v ?? tk.t}"`);
  }
  const fn = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v ?? toks[p].t}"`);
  return fn;
}
