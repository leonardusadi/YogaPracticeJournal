// Figure engine: turns a compact pose description (joint angles) into
// a drawn mannequin (SVG) and into plain skeleton strokes for the recognizer.
//
// Angles are degrees, 0 = right, 90 = up. Side-view figures face right.
// A segment is either a number (angle) or [angle, lengthScale] for foreshortening.

const LEN = { s1: 1.45, s2: 1.45, neck: 1.15, head: 0.85, ua: 1.95, fa: 2.05, th: 2.35, sh: 2.25, ft: 0.8 };
const LINE = 0.26; // stroke width, in figure units
const HALF = LINE / 2;
const NOSE = 0.38; // length of the nose tick

const rad = (d) => (d * Math.PI) / 180;
const vec = (deg, len = 1) => [Math.cos(rad(deg)) * len, Math.sin(rad(deg)) * len];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const seg = (s) => (Array.isArray(s) ? s : [s, 1]);

function ik(shoulder, target, l1, l2, bend) {
  const dx = target[0] - shoulder[0];
  const dy = target[1] - shoulder[1];
  const dist = Math.hypot(dx, dy) || 1e-6;
  const base = Math.atan2(dy, dx);
  const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const a = base + bend * Math.acos(Math.min(1, Math.max(-1, cosA)));
  const elbow = [shoulder[0] + Math.cos(a) * l1, shoulder[1] + Math.sin(a) * l1];
  const hx = target[0] - elbow[0];
  const hy = target[1] - elbow[1];
  const hl = Math.hypot(hx, hy) || 1e-6;
  return [elbow, [elbow[0] + (hx / hl) * l2, elbow[1] + (hy / hl) * l2]];
}

// Solve a pose description into joint positions (y up, ground at y = 0).
export function solve(p) {
  const front = p.v === 'f';
  const sw = p.sw ?? 0;
  const hw = p.hw ?? (front ? 0.2 : 0);
  const J = {};
  const s = p.s ?? [90, 90];
  const [a1, k1] = seg(s[0]);
  const [a2, k2] = seg(s[1]);
  J.P = [0, 0];
  J.M = add(J.P, vec(a1, LEN.s1 * k1));
  J.C = add(J.M, vec(a2, LEN.s2 * k2));
  const [ha, hk] = seg(p.h ?? a2);
  J.H = add(J.C, vec(ha, LEN.neck * hk));
  J.shL = add(J.C, vec(a2 + 90, sw));
  J.shR = add(J.C, vec(a2 - 90, sw));
  const pt = p.pt ?? 0;
  J.hipL = add(J.P, vec(pt + 180, hw));
  J.hipR = add(J.P, vec(pt, hw));

  for (const side of ['L', 'R']) {
    const spec = p['l' + side] ?? p.l ?? [-90, -90];
    const [ta, tk] = seg(spec[0]);
    const [sa, sk] = seg(spec[1]);
    const footDefault = front ? [side === 'L' ? -160 : -20, 0.5] : 0;
    const [fa, fk] = seg(spec[2] ?? footDefault);
    J['knee' + side] = add(J['hip' + side], vec(ta, LEN.th * tk));
    J['ankle' + side] = add(J['knee' + side], vec(sa, LEN.sh * sk));
    J['toe' + side] = add(J['ankle' + side], vec(fa, LEN.ft * fk));
  }

  const armSpec = (side) => p['a' + side] ?? p.a ?? (front ? (side === 'L' ? [-107, -100] : [-73, -80]) : [-90, -90]);
  const deferred = [];
  for (const side of ['L', 'R']) {
    const spec = armSpec(side);
    if (Array.isArray(spec)) {
      const [ua, uk] = seg(spec[0]);
      const [fa, fk] = seg(spec[1]);
      J['elbow' + side] = add(J['sh' + side], vec(ua, LEN.ua * uk));
      J['hand' + side] = add(J['elbow' + side], vec(fa, LEN.fa * fk));
    } else deferred.push([side, spec]);
  }

  const lowest = () => {
    let m = Infinity;
    for (const [key, pt2] of Object.entries(J)) m = Math.min(m, pt2[1] - (key === 'H' ? LEN.head : HALF));
    return m;
  };

  if (deferred.length) {
    const ground = lowest();
    for (const [side, spec] of deferred) {
      const sh = J['sh' + side];
      let target;
      if (spec.to === 'floor') target = [sh[0] + (spec.dx ?? 0), ground + HALF];
      else target = add(J[spec.to], spec.off ?? [0, 0]);
      let k = spec.k ?? 1;
      if (spec.fit) {
        const dist = Math.hypot(target[0] - sh[0], target[1] - sh[1]);
        k = Math.min(1, Math.max(0.3, (dist / (LEN.ua + LEN.fa)) * 1.015));
      }
      const [e, hnd] = ik(sh, target, LEN.ua * k, LEN.fa * k, spec.b ?? 1);
      J['elbow' + side] = e;
      J['hand' + side] = hnd;
    }
  }

  const g = lowest();
  for (const key of Object.keys(J)) J[key] = [J[key][0], J[key][1] - g];
  return J;
}

// --- drawing ---------------------------------------------------------------

function bounds(J) {
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [k, pt] of Object.entries(J)) {
    const r = k === 'H' ? LEN.head + HALF + NOSE : HALF;
    x0 = Math.min(x0, pt[0] - r);
    x1 = Math.max(x1, pt[0] + r);
    y1 = Math.max(y1, pt[1] + r);
  }
  return { x0, x1, y1 };
}

// Returns an SVG string for a pose: a line stick figure with an open round
// head and tick feet. opts.mirror flips left/right.
export function poseSVG(p, opts = {}) {
  const J = solve(p);
  const { x0, x1, y1 } = bounds(J);
  const w = x1 - x0;
  const hgt = y1;
  const size = Math.max(w, hgt, 6.6) + 1.0;
  const ox = (size - w) / 2 - x0;
  const oy = (size + hgt) / 2; // screen y of the ground
  const S = (pt) => [pt[0] + ox, oy - pt[1]];
  const f = (n) => n.toFixed(2);
  const line = (...pts) => pts.map((pt, i) => { const q = S(pt); return `${i ? 'L' : 'M'}${f(q[0])} ${f(q[1])}`; }).join('');

  // spine: a smooth curve from the pelvis through the waist to the neck
  const P = S(J.P), M = S(J.M), C = S(J.C);
  const ctrl = [2 * M[0] - (P[0] + C[0]) / 2, 2 * M[1] - (P[1] + C[1]) / 2];
  let d = `M${f(P[0])} ${f(P[1])}Q${f(ctrl[0])} ${f(ctrl[1])} ${f(C[0])} ${f(C[1])}`;
  d += line(J.C, J.H) + line(J.hipL, J.hipR);
  for (const sd of ['L', 'R']) {
    d += line(J['hip' + sd], J['knee' + sd], J['ankle' + sd], J['toe' + sd]);
    d += line(J['sh' + sd], J['elbow' + sd], J['hand' + sd]);
  }
  const H = S(J.H);
  // nose: shows which way the figure faces. Side views face along the body's
  // front; front and top views face the viewer (a dot) unless the pose says
  // where the head is turned (p.n = angle, or null for a hidden face).
  const headAngle = seg(p.h ?? seg((p.s ?? [90, 90])[1])[0])[0];
  const facing = p.n !== undefined ? p.n : p.v === 'f' ? 'c' : headAngle - 90;
  let nose = '';
  if (facing === 'c') nose = `<circle class="fd" cx="${f(H[0])}" cy="${f(H[1])}" r="0.17"/>`;
  else if (facing !== null) nose = `<path class="fk" d="${line(add(J.H, vec(facing, LEN.head)), add(J.H, vec(facing, LEN.head + NOSE)))}"/>`;
  let props = '';
  for (const pr of p.props ?? []) {
    if (pr[0] === 'wall') {
      const x = S(add(J[pr[1]], [pr[2], 0]))[0];
      props += `<line class="fw" x1="${f(x)}" y1="0.4" x2="${f(x)}" y2="${f(oy)}"/>`;
    }
  }
  const flip = opts.mirror ? ` transform="translate(${f(size)} 0) scale(-1 1)"` : '';
  return `<svg class="fig" viewBox="0 0 ${f(size)} ${f(size)}" aria-hidden="true"><g${flip} stroke-width="${LINE}">${props}` +
    `<path class="fk" d="${d}"/><circle class="fh" cx="${f(H[0])}" cy="${f(H[1])}" r="${LEN.head}"/>${nose}</g></svg>`;
}

// Plain skeleton as strokes (screen coords, y down) for seeding the recognizer.
export function poseStrokes(p, { head = true } = {}) {
  const J = solve(p);
  const S = (pt) => [pt[0], -pt[1]];
  const strokes = [];
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.25;
  const neckEnd = add(J.H, vec(seg(p.h ?? seg((p.s ?? [90, 90])[1])[0])[0] + 180, LEN.head));
  strokes.push([J.P, J.M, J.C, neckEnd].map(S));
  const limbs = [];
  for (const sd of ['L', 'R']) {
    limbs.push([J['hip' + sd], J['knee' + sd], J['ankle' + sd]]);
    limbs.push([J['sh' + sd], J['elbow' + sd], J['hand' + sd]]);
  }
  const kept = [];
  for (const l of limbs) {
    if (kept.some((q) => q.every((pt, i) => same(pt, l[i])))) continue;
    kept.push(l);
    strokes.push(l.map(S));
  }
  if (head) {
    const c = [];
    for (let i = 0; i <= 14; i++) c.push(S(add(J.H, vec((i / 14) * 360, LEN.head))));
    strokes.push(c);
  }
  return strokes;
}

// Free-hand strokes (custom asanas, saved scribbles) as an SVG thumbnail.
export function strokesSVG(strokes, opts = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) for (const [x, y] of st) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (!isFinite(x0)) return '<svg class="fig" viewBox="0 0 10 10"></svg>';
  const span = Math.max(x1 - x0, y1 - y0, 1);
  const pad = span * 0.14;
  const size = span + pad * 2;
  const ox = (size - (x1 - x0)) / 2 - x0;
  const oy = (size - (y1 - y0)) / 2 - y0;
  const sw = size * (opts.weight ?? 0.045);
  let d = '';
  for (const st of strokes) {
    st.forEach(([x, y], i) => { d += `${i ? 'L' : 'M'}${(x + ox).toFixed(1)} ${(y + oy).toFixed(1)}`; });
    if (st.length === 1) d += 'l0.01 0';
  }
  const flip = opts.mirror ? ` transform="translate(${size.toFixed(1)} 0) scale(-1 1)"` : '';
  return `<svg class="fig" viewBox="0 0 ${size.toFixed(1)} ${size.toFixed(1)}" aria-hidden="true"><path${flip} class="fs" style="stroke-width:${sw.toFixed(2)}" d="${d}"/></svg>`;
}
