// Scribble recognizer: a point-cloud matcher. Stroke order, stroke count,
// size and position do not matter; orientation and proportions do.

const N = 48;

function pathLength(strokes) {
  let len = 0;
  for (const st of strokes) for (let i = 1; i < st.length; i++) len += Math.hypot(st[i][0] - st[i - 1][0], st[i][1] - st[i - 1][1]);
  return len;
}

function resample(strokes, n) {
  const total = pathLength(strokes);
  if (total < 1e-6) {
    const p = strokes[0]?.[0] ?? [0, 0];
    return Array.from({ length: n }, () => [p[0], p[1]]);
  }
  const step = total / (n - 1);
  const out = [];
  let carry = 0;
  for (const st of strokes) {
    if (!st.length) continue;
    let prev = st[0];
    if (!out.length) out.push([prev[0], prev[1]]);
    for (let i = 1; i < st.length; i++) {
      let cur = st[i];
      let d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      while (carry + d >= step && d > 0) {
        const t = (step - carry) / d;
        const q = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
        out.push(q);
        prev = q;
        d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
        carry = 0;
      }
      carry += d;
      prev = cur;
    }
  }
  const last = strokes[strokes.length - 1];
  while (out.length < n) out.push([...last[last.length - 1]]);
  return out.slice(0, n);
}

// Normalized cloud: Float32Array [x0, y0, x1, y1, ...]
export function toCloud(strokes) {
  const clean = strokes.filter((s) => s && s.length);
  if (!clean.length) return null;
  const pts = resample(clean, N);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const scale = Math.max(x1 - x0, y1 - y0) || 1;
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= N; cy /= N;
  const cloud = new Float32Array(N * 2);
  pts.forEach(([x, y], i) => { cloud[i * 2] = (x - cx) / scale; cloud[i * 2 + 1] = (y - cy) / scale; });
  return cloud;
}

export function mirrorCloud(cloud) {
  const m = new Float32Array(cloud.length);
  for (let i = 0; i < cloud.length; i += 2) { m[i] = -cloud[i]; m[i + 1] = cloud[i + 1]; }
  return m;
}

const used = new Uint8Array(N);
function cloudDistance(a, b, start) {
  used.fill(0);
  let sum = 0;
  let i = start;
  let k = 0;
  do {
    let best = Infinity;
    let idx = -1;
    const ax = a[i * 2];
    const ay = a[i * 2 + 1];
    for (let j = 0; j < N; j++) {
      if (used[j]) continue;
      const dx = ax - b[j * 2];
      const dy = ay - b[j * 2 + 1];
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; idx = j; }
    }
    used[idx] = 1;
    sum += (1 - k / N) * Math.sqrt(best);
    k++;
    i = (i + 1) % N;
  } while (i !== start);
  return sum;
}

export function distance(a, b) {
  const step = Math.floor(Math.pow(N, 0.5));
  let min = Infinity;
  for (let i = 0; i < N; i += step) {
    min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  }
  return min;
}

// templates: [{ id, cloud, weight }] — returns asana ids ordered best first.
export function recognize(strokes, templates, limit = 8) {
  const cloud = toCloud(strokes);
  if (!cloud) return [];
  const best = new Map();
  for (const t of templates) {
    const d = distance(cloud, t.cloud) * (t.weight ?? 1);
    if (!best.has(t.id) || d < best.get(t.id)) best.set(t.id, d);
  }
  return [...best.entries()].sort((x, y) => x[1] - y[1]).slice(0, limit).map(([id, score]) => ({ id, score }));
}
