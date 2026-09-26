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
  return toks;
}

// Letters that can be slider parameters (x is the variable, y the output, e a constant).
export const PARAM_RE = /^[a-df-wz]$/;

// "xsin" -> x * sin, "2pi" handled by implicit mult, "sinx" -> sin x, "ax" -> a * x
function splitIdents(toks, params, unknown) {
  const out = [];
  const declared = params ? Object.keys(params) : [];
  const names = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x', ...declared].sort((a, b) => b.length - a.length);
  const isParam = (n) => declared.includes(n);
  for (const tk of toks) {
    if (tk.t !== 'id' || FUNCS[tk.v] || CONSTS[tk.v] !== undefined || tk.v === 'x' || isParam(tk.v)) { out.push(tk); continue; }
    let s = tk.v;
    while (s.length) {
      let n = names.find((nm) => s.startsWith(nm));
      if (!n) {
        if (!PARAM_RE.test(s[0])) throw new Error(`Unknown name "${tk.v}"`);
        n = s[0];
        unknown.add(n);
      }
      out.push({ t: 'id', v: n }); s = s.slice(n.length);
    }
  }
  return out;
}

// params: optional object of slider values, read live when the function runs.
// Unknown single letters throw an error with .unknown = ['a', ...] so the app can offer sliders.
export function compile(src, params = null) {
  if (typeof src !== 'string' || src.length > 300) throw new Error('Expression too long');
  const unknown = new Set();
  const toks = splitIdents(tokenize(src.replace(/^\s*y\s*=\s*/i, '')), params, unknown);
  if (unknown.size) {
    const list = [...unknown];
    const e = new Error(list.length === 1 ? `Unknown name "${list[0]}" — add a slider for it` : `Unknown names ${list.map((u) => `"${u}"`).join(', ')} — add sliders for them`);
    e.unknown = list;
    throw e;
  }
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
      if (params && Object.prototype.hasOwnProperty.call(params, tk.v)) { const name = tk.v; return () => params[name]; }
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
