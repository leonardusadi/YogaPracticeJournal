// Everything the app remembers lives in this browser's localStorage, on the
// device. Nothing is sent anywhere.

const KEY = 'ypj.v1';
const MAX_SAMPLES = 8;

const blank = () => ({
  sequences: [],
  samples: {},      // asanaId -> [strokes, ...]
  custom: [],       // [{ id, name, strokes }]
  names: {},        // asanaId -> renamed title
  journal: [],      // [{ id, date, text, asanas: [asanaId], tags: [word], createdAt, updatedAt }]
  settings: { sort: 'edited', hold: 30, learn: true, sound: true },
});

let data = blank();
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = { ...blank(), ...JSON.parse(raw) };
    data.settings = { ...blank().settings, ...data.settings };
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return data;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Could not save', e);
    return false;
  }
  listeners.forEach((fn) => fn());
  return true;
}

export const db = () => data;
export const onChange = (fn) => listeners.add(fn);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- sequences ----
export function newSequence(title = 'Untitled sequence') {
  const now = Date.now();
  const seq = { id: uid(), title, createdAt: now, updatedAt: now, steps: [] };
  data.sequences.push(seq);
  save();
  return seq;
}
export const getSequence = (id) => data.sequences.find((s) => s.id === id);
export function touch(seq) { seq.updatedAt = Date.now(); save(); }
export function deleteSequence(id) { data.sequences = data.sequences.filter((s) => s.id !== id); save(); }
export function duplicateSequence(id) {
  const src = getSequence(id);
  if (!src) return null;
  const now = Date.now();
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.title = src.title + ' copy';
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.steps.forEach((st) => { st.id = uid(); });
  data.sequences.push(copy);
  save();
  return copy;
}
export const newStep = (asana) => ({ id: uid(), asana, hold: null, side: 'both', note: '' });

// ---- journal ----
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Words written as #word in a note are its hashtags.
export function parseTags(text) {
  const tags = new Set();
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}_#])#([\p{L}\p{N}_-]{1,40})/gu)) tags.add(m[2].toLowerCase());
  return [...tags];
}
export function newEntry(pre = {}) {
  const now = Date.now();
  const entry = { id: uid(), date: today(), text: '', asanas: [], tags: [], createdAt: now, updatedAt: now, ...pre };
  data.journal.push(entry);
  save();
  return entry;
}
export const getEntry = (id) => data.journal.find((e) => e.id === id);
export function touchEntry(entry) {
  entry.tags = parseTags(entry.text);
  entry.updatedAt = Date.now();
  save();
}
export function deleteEntry(id) { data.journal = data.journal.filter((e) => e.id !== id); save(); }

// ---- scribble samples ----
const round = (strokes) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) for (const [x, y] of st) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = 200 / (Math.max(x1 - x0, y1 - y0) || 1);
  return strokes.map((st) => {
    const out = [];
    let last = null;
    for (const [x, y] of st) {
      const p = [Math.round((x - x0) * k), Math.round((y - y0) * k)];
      if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= 3) { out.push(p); last = p; }
    }
    if (out.length === 1) out.push([out[0][0], out[0][1]]);
    return out;
  }).filter((st) => st.length);
};
export function addSample(asanaId, strokes) {
  if (!strokes?.length) return;
  const list = (data.samples[asanaId] ??= []);
  list.push(round(strokes));
  while (list.length > MAX_SAMPLES) list.shift();
  save();
}
export function removeSample(asanaId, index) {
  const list = data.samples[asanaId];
  if (!list) return;
  list.splice(index, 1);
  if (!list.length) delete data.samples[asanaId];
  save();
}

// ---- custom asanas ----
export function addCustom(name, strokes) {
  const c = { id: 'c_' + uid(), name, strokes: round(strokes) };
  data.custom.push(c);
  save();
  return c;
}
export function removeCustom(id) {
  data.custom = data.custom.filter((c) => c.id !== id);
  delete data.samples[id];
  delete data.names[id];
  save();
}

// ---- backup ----
export const exportJSON = () => JSON.stringify({ app: 'YogaPracticeJournal', version: 1, exportedAt: new Date().toISOString(), data }, null, 1);
export function importJSON(text, mode) {
  const parsed = JSON.parse(text);
  const incoming = parsed?.data;
  if (parsed?.app !== 'YogaPracticeJournal' || !incoming || !Array.isArray(incoming.sequences)) throw new Error('Not a Yoga Practice Journal backup file');
  if (mode === 'replace') {
    data = { ...blank(), ...incoming, settings: { ...blank().settings, ...incoming.settings } };
  } else {
    const have = new Set(data.sequences.map((s) => s.id));
    for (const s of incoming.sequences) if (!have.has(s.id)) data.sequences.push(s);
    const haveC = new Set(data.custom.map((c) => c.id));
    for (const c of incoming.custom ?? []) if (!haveC.has(c.id)) data.custom.push(c);
    const haveJ = new Set(data.journal.map((e) => e.id));
    for (const e of incoming.journal ?? []) if (!haveJ.has(e.id)) data.journal.push(e);
    for (const [id, list] of Object.entries(incoming.samples ?? {})) {
      const mine = (data.samples[id] ??= []);
      const seen = new Set(mine.map((m) => JSON.stringify(m)));
      for (const smp of list) if (!seen.has(JSON.stringify(smp)) && mine.length < MAX_SAMPLES) mine.push(smp);
    }
    data.names = { ...(incoming.names ?? {}), ...data.names };
  }
  save();
  return data;
}
