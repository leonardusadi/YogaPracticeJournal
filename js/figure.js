// Figure engine: turns a compact pose description (joint angles) into
// a drawn mannequin (SVG) and into plain skeleton strokes for the recognizer.
//
// Angles are degrees, 0 = right, 90 = up. Side-view figures face right.
// A segment is either a number (angle) or [angle, lengthScale] for foreshortening.

const LEN = { s1: 1.45, s2: 1.45, neck: 1.0, head: 0.6, ua: 1.95, fa: 2.05, th: 2.35, sh: 2.25, ft: 0.8 };
const R = {
  hip: 0.5, waist: 0.45, chest: 0.56, neck: 0.2,
  th0: 0.42, th1: 0.29, sh1: 0.18, ft1: 0.14,
  ua0: 0.27, ua1: 0.21, fa1: 0.15, hand: 0.19,
};

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
  const sw = p.sw ?? (front ? 0.9 : 0);
  const hw = p.hw ?? (front ? 0.45 : 0);
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

  const armSpec = (side) => p['a' + side] ?? p.a ?? (front ? (side === 'L' ? [-97, -94] : [-83, -86]) : [-90, -90]);
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
    const chk = (pt2, r) => { if (pt2) m = Math.min(m, pt2[1] - r); };
    chk(J.P, R.hip); chk(J.M, R.waist); chk(J.C, R.chest); chk(J.H, LEN.head);
    for (const sd of ['L', 'R']) {
      chk(J['knee' + sd], R.th1); chk(J['ankle' + sd], R.sh1); chk(J['toe' + sd], R.ft1);
      chk(J['elbow' + sd], R.ua1); chk(J['hand' + sd], R.hand);
    }
    return m;
  };

  if (deferred.length) {
    const ground = lowest();
    for (const [side, spec] of deferred) {
      const sh = J['sh' + side];
      let target;
      if (spec.to === 'floor') target = [sh[0] + (spec.dx ?? 0), ground + R.hand];
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

function capsule(a, b, r1, r2) {
  // a, b in screen coords (y down)
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy);
  const f = (n) => n.toFixed(2);
  if (d < 1e-3) {
    const r = Math.max(r1, r2);
    return `M${f(a[0] - r)} ${f(a[1])}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }
  const nx = -dy / d;
  const ny = dx / d;
  return (
    `M${f(a[0] + nx * r1)} ${f(a[1] + ny * r1)}` +
    `L${f(b[0] + nx * r2)} ${f(b[1] + ny * r2)}` +
    `A${f(r2)} ${f(r2)} 0 0 0 ${f(b[0] - nx * r2)} ${f(b[1] - ny * r2)}` +
    `L${f(a[0] - nx * r1)} ${f(a[1] - ny * r1)}` +
    `A${f(r1)} ${f(r1)} 0 0 0 ${f(a[0] + nx * r1)} ${f(a[1] + ny * r1)}Z`
  );
}

function bounds(J) {
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [k, pt] of Object.entries(J)) {
    const r = k === 'H' ? LEN.head : k === 'P' || k === 'M' || k === 'C' ? 0.56 : 0.3;
    x0 = Math.min(x0, pt[0] - r);
    x1 = Math.max(x1, pt[0] + r);
    y1 = Math.max(y1, pt[1] + r);
  }
  return { x0, x1, y1 };
}

// Returns an SVG string for a pose. opts.mirror flips left/right.
export function poseSVG(p, opts = {}) {
  const J = solve(p);
  const front = p.v === 'f';
  const { x0, x1, y1 } = bounds(J);
  const w = x1 - x0;
  const hgt = y1;
  const size = Math.max(w, hgt, 6.2) + 1.0;
  const ox = (size - w) / 2 - x0;
  const oy = (size + hgt) / 2; // screen y of the ground
  const S = (pt) => [pt[0] + ox, oy - pt[1]];

  const limbLeg = (sd) =>
    capsule(S(J['hip' + sd]), S(J['knee' + sd]), R.th0, R.th1) +
    capsule(S(J['knee' + sd]), S(J['ankle' + sd]), R.th1 - 0.01, R.sh1) +
    capsule(S(J['ankle' + sd]), S(J['toe' + sd]), R.sh1 - 0.01, R.ft1);
  const limbArm = (sd) =>
    capsule(S(J['sh' + sd]), S(J['elbow' + sd]), R.ua0, R.ua1) +
    capsule(S(J['elbow' + sd]), S(J['hand' + sd]), R.ua1 - 0.01, R.fa1) +
    capsule(S(J['hand' + sd]), S(J['hand' + sd]), R.hand, R.hand);
  const torso = () => {
    let d = capsule(S(J.P), S(J.M), R.hip, R.waist) + capsule(S(J.M), S(J.C), R.waist, R.chest);
    if (front) d += capsule(S(J.shL), S(J.shR), 0.3, 0.3) + capsule(S(J.hipL), S(J.hipR), 0.42, 0.42);
    return d;
  };
  const head = () => capsule(S(J.H), S(J.H), LEN.head, LEN.head);

  const order = (p.z ?? (front ? 'lL lR t h aL aR' : 'aL lL t h lR aR')).split(' ');
  const tone = (key) => {
    if (key === 't' || key === 'h') return 'fb';
    if (front) return 'fn';
    return key.endsWith('L') ? 'ff' : 'fn';
  };
  let out = '';
  for (const key of order) {
    const d = key === 't' ? torso() : key === 'h' ? head() : key[0] === 'l' ? limbLeg(key[1]) : limbArm(key[1]);
    out += `<path class="fg" d="${d}"/><path class="${tone(key)}" d="${d}"/>`;
  }
  let props = '';
  if (!p.top) props += `<line class="fl" x1="0.4" y1="${oy.toFixed(2)}" x2="${(size - 0.4).toFixed(2)}" y2="${oy.toFixed(2)}"/>`;
  for (const pr of p.props ?? []) {
    if (pr[0] === 'wall') {
      const x = S(add(J[pr[1]], [pr[2], 0]))[0];
      props += `<line class="fw" x1="${x.toFixed(2)}" y1="0.3" x2="${x.toFixed(2)}" y2="${oy.toFixed(2)}"/>`;
    }
  }
  const flip = opts.mirror ? ` transform="translate(${size.toFixed(2)} 0) scale(-1 1)"` : '';
  return `<svg class="fig" viewBox="0 0 ${size.toFixed(2)} ${size.toFixed(2)}" aria-hidden="true"><g${flip}>${props}${out}</g></svg>`;
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
