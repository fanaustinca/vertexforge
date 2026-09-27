// Safe math-expression engine: parse to a syntax tree (no eval), compile to a fast function,
// differentiate symbolically and print back as text.
// Supports + - * / ^, unary minus, parentheses, implicit multiplication (2x, 3sin(x), (x+1)(x-1)),
// functions with one or more arguments, constants pi e tau phi, variables (x, y, t, θ) and slider
// parameters (other single letters).

const F1 = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  ln: Math.log, log2: Math.log2, exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign, sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  fact: (n) => gamma(n + 1),
};
// functions whose argument count may vary: [min args, max args, implementation]
const FN = Object.assign(Object.create(null), {
  log: [1, 2, (a, b) => (b === undefined ? Math.log10(a) : Math.log(b) / Math.log(a))], // log(x) or log(base, x)
  min: [2, 8, Math.min], max: [2, 8, Math.max],
  mod: [2, 2, (a, b) => ((a % b) + b) % b],
  root: [2, 2, (x, n) => (x < 0 && Math.round(n) % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n))],
  atan2: [2, 2, Math.atan2],
  nCr: [2, 2, (n, k) => Math.round(gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1)))],
  nPr: [2, 2, (n, k) => Math.round(gamma(n + 1) / gamma(n - k + 1))],
  normalpdf: [1, 3, (x, m = 0, s = 1) => Math.exp(-(((x - m) / s) ** 2) / 2) / (s * Math.sqrt(2 * Math.PI))],
  normalcdf: [1, 3, (x, m = 0, s = 1) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)))],
  binompdf: [3, 3, (n, p, k) => (k < 0 || k > n || k !== Math.floor(k) ? 0 : Math.round(gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1))) * p ** k * (1 - p) ** (n - k))],
});
for (const [k, f] of Object.entries(F1)) FN[k] = [1, 1, f];
const CONSTS = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 });
export const FUNCTION_NAMES = Object.keys(FN);

// Letters that can be slider parameters (x is the variable, y the output, e a constant).
export const PARAM_RE = /^[a-df-wz]$/;

function erf(x) {
  const s = Math.sign(x), a = Math.abs(x);
  if (a < 3) {
    // Maclaurin series (converges well for |x| < 3)
    let sum = a, term = a;
    for (let n = 1; n < 200; n++) { term *= -a * a / n; const t = term / (2 * n + 1); sum += t; if (Math.abs(t) < 1e-17) break; }
    return s * (2 / Math.sqrt(Math.PI)) * sum;
  }
  // continued fraction for the tail
  let f = 0;
  for (let n = 60; n >= 1; n--) f = n / 2 / (a + f);
  return s * (1 - Math.exp(-a * a) / Math.sqrt(Math.PI) / (a + f));
}
function gamma(z) {
  if (Number.isInteger(z) && z > 0 && z < 171) { let r = 1; for (let i = 2; i < z; i++) r *= i; return r; }
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

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
    if (/[a-zA-Zπθ]/.test(c)) {
      const m = /^([a-zA-Z]+[0-9]*|π|θ)/.exec(src.slice(i));
      const w = m[0] === 'π' ? 'pi' : m[0] === 'θ' ? 'theta' : m[0];
      // keep nCr / nPr as written; everything else is case-insensitive
      toks.push({ t: 'id', v: /^n[CP]r$/.test(w) ? w : w.toLowerCase() }); i += m[0].length; continue;
    }
    if ('+-*/^(),'.includes(c)) { toks.push({ t: c }); i++; continue; }
    if (c === '·' || c === '×') { toks.push({ t: '*' }); i++; continue; }
    if (c === '−') { toks.push({ t: '-' }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return toks;
}

// Split runs like "xsin", "ax", "2pi" into known names; unknown single letters become parameters.
function splitIdents(toks, vars, params, unknown) {
  const out = [];
  const declared = params ? Object.keys(params).filter((k) => !vars.includes(k)) : [];
  const names = [...Object.keys(FN), ...Object.keys(CONSTS), ...vars, ...declared].sort((a, b) => b.length - a.length);
  const known = (n) => FN[n] || CONSTS[n] !== undefined || vars.includes(n) || declared.includes(n);
  for (const tk of toks) {
    if (tk.t !== 'id' || known(tk.v)) { out.push(tk); continue; }
    let s = tk.v;
    while (s.length) {
      let n = names.find((nm) => s.startsWith(nm));
      if (!n) {
        if (!PARAM_RE.test(s[0]) || vars.includes(s[0])) throw new Error(`Unknown name "${tk.v}"`);
        n = s[0];
        unknown.add(n);
      }
      out.push({ t: 'id', v: n }); s = s.slice(n.length);
    }
  }
  return out;
}

// ---------- parsing ----------
// options: vars (variable names, default ['x']), params (object of slider values or null)
export function parse(src, { vars = ['x'], params = null } = {}) {
  if (typeof src !== 'string' || src.length > 400) throw new Error('Expression too long');
  const unknown = new Set();
  const toks = splitIdents(tokenize(src), vars, params, unknown);
  let p = 0;
  const peek = () => toks[p];
  const eat = (t) => { if (peek()?.t !== t) throw new Error(`Expected "${t}"`); return toks[p++]; };
  const startsAtom = (tk) => tk && (tk.t === 'num' || tk.t === 'id' || tk.t === '(');
  const bin = (op, a, b) => ({ t: 'bin', op, a, b });

  function expr() {
    let l = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = toks[p++].t; l = bin(op, l, term()); }
    return l;
  }
  function term() {
    let l = unary();
    for (;;) {
      const tk = peek();
      if (tk && (tk.t === '*' || tk.t === '/')) { p++; l = bin(tk.t, l, unary()); }
      else if (startsAtom(tk)) l = bin('*', l, power());
      else return l;
    }
  }
  function unary() {
    if (peek()?.t === '-') { p++; return { t: 'neg', a: unary() }; }
    if (peek()?.t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const b = atom();
    if (peek()?.t === '^') { p++; return bin('^', b, unary()); }
    return b;
  }
  function atom() {
    const tk = toks[p++];
    if (!tk) throw new Error('Unexpected end');
    if (tk.t === 'num') return { t: 'num', v: tk.v };
    if (tk.t === '(') { const e = expr(); eat(')'); return e; }
    if (tk.t === 'id') {
      if (vars.includes(tk.v)) return { t: 'var', n: tk.v };
      if (CONSTS[tk.v] !== undefined) return { t: 'const', n: tk.v };
      if (FN[tk.v]) {
        const [lo, hi] = FN[tk.v];
        let args;
        if (peek()?.t === '(') {
          p++;
          args = [expr()];
          while (peek()?.t === ',') { p++; args.push(expr()); }
          eat(')');
        } else args = [power()];
        if (args.length < lo || args.length > hi) throw new Error(`${tk.v} takes ${lo === hi ? lo : `${lo}–${hi}`} value${hi > 1 ? 's' : ''}`);
        const c = { t: 'call', f: tk.v, args };
        if (peek()?.t === '^') { p++; return bin('^', c, unary()); }
        return c;
      }
      return { t: 'par', n: tk.v };
    }
    throw new Error(`Unexpected "${tk.v ?? tk.t}"`);
  }
  const ast = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v ?? toks[p].t}"`);
  return { ast, unknown: [...unknown] };
}

function unknownError(list) {
  const e = new Error(list.length === 1 ? `Unknown name "${list[0]}" — add a slider for it` : `Unknown names ${list.map((u) => `"${u}"`).join(', ')} — add sliders for them`);
  e.unknown = list;
  return e;
}

// ---------- compiling ----------
export function compileAST(ast, vars, params) {
  const idx = Object.fromEntries(vars.map((v, i) => [v, i]));
  const go = (n) => {
    switch (n.t) {
      case 'num': { const v = n.v; return () => v; }
      case 'const': { const v = CONSTS[n.n]; return () => v; }
      case 'var': { const i = idx[n.n]; return (a) => a[i]; }
      case 'par': { const k = n.n; return () => params[k]; }
      case 'neg': { const a = go(n.a); return (x) => -a(x); }
      case 'call': {
        const f = FN[n.f][2];
        const as = n.args.map(go);
        if (as.length === 1) { const a = as[0]; return (x) => f(a(x)); }
        return (x) => f(...as.map((g) => g(x)));
      }
      case 'bin': {
        const a = go(n.a), b = go(n.b);
        switch (n.op) {
          case '+': return (x) => a(x) + b(x);
          case '-': return (x) => a(x) - b(x);
          case '*': return (x) => a(x) * b(x);
          case '/': return (x) => a(x) / b(x);
          default: return (x) => Math.pow(a(x), b(x));
        }
      }
    }
    throw new Error('bad node');
  };
  const f = go(ast);
  return (...args) => f(args);
}

// f(x) from text (the original API). params: slider values object, read live.
export function compile(src, params = null) {
  const { ast, unknown } = parse(src.replace(/^\s*y\s*=\s*/i, ''), { vars: ['x'], params });
  if (unknown.length) throw unknownError(unknown);
  return compileAST(ast, ['x'], params || {});
}
// A function of several variables, e.g. compileVars('x^2 + y^2 - 9', ['x', 'y'], params)(x, y)
export function compileVars(src, vars, params = null) {
  const { ast, unknown } = parse(src, { vars, params });
  if (unknown.length) throw unknownError(unknown);
  return compileAST(ast, vars, params || {});
}

// ---------- symbolic derivative ----------
const N = (v) => ({ t: 'num', v });
const B = (op, a, b) => ({ t: 'bin', op, a, b });
const call = (f, a) => ({ t: 'call', f, args: [a] });
const isNum = (n, v) => n.t === 'num' && (v === undefined || n.v === v);
const hasVar = (n, v) => (n.t === 'var' ? n.n === v : n.t === 'neg' ? hasVar(n.a, v) : n.t === 'bin' ? hasVar(n.a, v) || hasVar(n.b, v) : n.t === 'call' ? n.args.some((a) => hasVar(a, v)) : false);

export function derivative(n, v = 'x') {
  if (!hasVar(n, v)) return N(0);
  switch (n.t) {
    case 'var': return N(1);
    case 'neg': return { t: 'neg', a: derivative(n.a, v) };
    case 'bin': {
      const { a, b } = n, da = derivative(a, v), db = derivative(b, v);
      switch (n.op) {
        case '+': return B('+', da, db);
        case '-': return B('-', da, db);
        case '*': return B('+', B('*', da, b), B('*', a, db));
        case '/': return B('/', B('-', B('*', da, b), B('*', a, db)), B('^', b, N(2)));
        default: // ^
          if (!hasVar(b, v)) return B('*', B('*', b, B('^', a, B('-', b, N(1)))), da);
          if (!hasVar(a, v)) return B('*', B('*', n, call('ln', a)), db);
          return B('*', n, B('+', B('*', db, call('ln', a)), B('/', B('*', b, da), a)));
      }
    }
    case 'call': {
      if (n.args.length !== 1) throw new Error(`Can’t differentiate ${n.f}(…) exactly`);
      const u = n.args[0], du = derivative(u, v);
      const R = {
        sin: () => call('cos', u),
        cos: () => ({ t: 'neg', a: call('sin', u) }),
        tan: () => B('/', N(1), B('^', call('cos', u), N(2))),
        asin: () => B('/', N(1), call('sqrt', B('-', N(1), B('^', u, N(2))))),
        acos: () => ({ t: 'neg', a: B('/', N(1), call('sqrt', B('-', N(1), B('^', u, N(2))))) }),
        atan: () => B('/', N(1), B('+', N(1), B('^', u, N(2)))),
        sinh: () => call('cosh', u), cosh: () => call('sinh', u),
        tanh: () => B('-', N(1), B('^', call('tanh', u), N(2))),
        sqrt: () => B('/', N(1), B('*', N(2), call('sqrt', u))),
        cbrt: () => B('/', N(1), B('*', N(3), B('^', call('cbrt', u), N(2)))),
        abs: () => call('sign', u),
        ln: () => B('/', N(1), u),
        log: () => B('/', N(1), B('*', u, call('ln', N(10)))),
        log2: () => B('/', N(1), B('*', u, call('ln', N(2)))),
        exp: () => call('exp', u),
        sec: () => B('*', call('sec', u), call('tan', u)),
        csc: () => ({ t: 'neg', a: B('*', call('csc', u), call('cot', u)) }),
        cot: () => ({ t: 'neg', a: B('^', call('csc', u), N(2)) }),
        floor: () => N(0), ceil: () => N(0), round: () => N(0), sign: () => N(0),
      }[n.f];
      if (!R) throw new Error(`Can’t differentiate ${n.f}(…) exactly`);
      return B('*', R(), du);
    }
  }
  return N(0);
}

// ---------- simplification ----------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
export function simplify(n) {
  if (n.t === 'neg') {
    const a = simplify(n.a);
    if (isNum(a)) return N(-a.v);
    if (a.t === 'neg') return a.a;
    return { t: 'neg', a };
  }
  if (n.t === 'call') return { ...n, args: n.args.map(simplify) };
  if (n.t !== 'bin') return n;
  let a = simplify(n.a), b = simplify(n.b);
  const op = n.op;
  if (isNum(a) && isNum(b)) {
    const v = op === '+' ? a.v + b.v : op === '-' ? a.v - b.v : op === '*' ? a.v * b.v : op === '/' ? a.v / b.v : Math.pow(a.v, b.v);
    if (op !== '/' || Number.isInteger(v)) return N(v);
  }
  switch (op) {
    case '+':
      if (isNum(a, 0)) return b;
      if (isNum(b, 0)) return a;
      if (b.t === 'neg') return simplify(B('-', a, b.a));
      if (isNum(b) && b.v < 0) return B('-', a, N(-b.v));
      if (same(a, b)) return simplify(B('*', N(2), a));
      break;
    case '-':
      if (isNum(b, 0)) return a;
      if (isNum(a, 0)) return simplify({ t: 'neg', a: b });
      if (b.t === 'neg') return simplify(B('+', a, b.a));
      if (same(a, b)) return N(0);
      break;
    case '*':
      if (isNum(a, 0) || isNum(b, 0)) return N(0);
      if (isNum(a, 1)) return b;
      if (isNum(b, 1)) return a;
      if (isNum(a, -1)) return simplify({ t: 'neg', a: b });
      if (isNum(b, -1)) return simplify({ t: 'neg', a });
      if (isNum(b) && !isNum(a)) [a, b] = [b, a]; // numbers first: 3x
      if (a.t === 'neg') return simplify({ t: 'neg', a: B('*', a.a, b) });
      if (b.t === 'neg') return simplify({ t: 'neg', a: B('*', a, b.a) });
      if (isNum(a) && b.t === 'bin' && b.op === '*' && isNum(b.a)) return simplify(B('*', N(a.v * b.a.v), b.b));
      if (isNum(a) && b.t === 'bin' && b.op === '/' && isNum(b.a)) return simplify(B('/', N(a.v * b.a.v), b.b));
      if (same(a, b)) return simplify(B('^', a, N(2)));
      if (b.t === 'bin' && b.op === '^' && same(a, b.a)) return simplify(B('^', a, B('+', b.b, N(1))));
      if (a.t === 'bin' && a.op === '^' && b.t === 'bin' && b.op === '^' && same(a.a, b.a)) return simplify(B('^', a.a, B('+', a.b, b.b)));
      break;
    case '/':
      if (isNum(a, 0)) return N(0);
      if (isNum(b, 1)) return a;
      if (same(a, b)) return N(1);
      if (a.t === 'neg') return simplify({ t: 'neg', a: B('/', a.a, b) });
      if (isNum(a) && isNum(b) && Number.isInteger(a.v) && Number.isInteger(b.v)) { const g = gcd(Math.abs(a.v), Math.abs(b.v)); if (g > 1) return B('/', N(a.v / g), N(b.v / g)); }
      break;
    case '^':
      if (isNum(b, 0)) return N(1);
      if (isNum(b, 1)) return a;
      if (isNum(a, 1)) return N(1);
      if (a.t === 'bin' && a.op === '^' && isNum(a.b) && isNum(b)) return simplify(B('^', a.a, N(a.b.v * b.v)));
      break;
  }
  return B(op, a, b);
}

// ---------- printing (re-parseable) ----------
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
export function toText(n) {
  const fmtN = (v) => String(+v.toPrecision(12));
  const p = (m, minPrec, right) => {
    const s = toText(m);
    const mp = m.t === 'bin' ? PREC[m.op] : m.t === 'neg' ? 3 : m.t === 'num' && m.v < 0 ? 3 : 5;
    return mp < minPrec || (right && mp === minPrec && m.t === 'bin') ? `(${s})` : s;
  };
  switch (n.t) {
    case 'num': return fmtN(n.v);
    case 'const': return n.n;
    case 'var': return n.n === 'theta' ? 'θ' : n.n;
    case 'par': return n.n;
    case 'neg': return '-' + p(n.a, 3);
    case 'call': return `${n.f}(${n.args.map(toText).join(', ')})`;
    case 'bin': {
      if (n.op === '*') {
        // implicit multiplication when unambiguous: 3x, 2sin(x), 3x^2
        const L = p(n.a, 2), R = p(n.b, 2, true);
        const implicit = isNum(n.a) && n.a.v >= 0 && (['var', 'call', 'par', 'const'].includes(n.b.t) || (n.b.t === 'bin' && n.b.op === '^' && ['var', 'par'].includes(n.b.a.t)));
        return implicit ? L + R : `${L}*${R}`;
      }
      if (n.op === '^') return `${p(n.a, 5)}^${p(n.b, 4)}`;
      return `${p(n.a, PREC[n.op])} ${n.op} ${p(n.b, PREC[n.op], true)}`;
    }
  }
  return '?';
}

// Convenience: derivative of an expression, as simplified text.
export function derivativeText(src, v = 'x', params = null) {
  const { ast } = parse(src, { vars: [v], params });
  return toText(simplify(derivative(ast, v)));
}
