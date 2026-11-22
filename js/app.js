import { ASANAS, CATEGORIES, SKETCH_SEEDS } from './asanas.js';
import { poseSVG, poseStrokes, strokesSVG } from './figure.js';
import { toCloud, mirrorCloud, distance, recognize } from './recognizer.js';
import { createPad } from './pad.js';
import * as store from './store.js';

const VERSION = '1.4.0';
const app = document.getElementById('app');
const layer = document.getElementById('layer');

// ---------------------------------------------------------------- helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  timer: svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 3h5"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  undo: svg('<path d="M8 5L4 9l4 4"/><path d="M4 9h10a6 6 0 0 1 0 12H9"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  list: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  book: svg('<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h10"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
  down: svg('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'),
  up: svg('<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>'),
  type: svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  left: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  right: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  insert: svg('<path d="M12 8v8M8 12h8"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>'),
  restart: svg('<path d="M5 12a7 7 0 1 0 2.2-5.1"/><path d="M5 4v4h4"/>'),
  note: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 8h4M9 12h7M9 16h7"/>'),
};
const icon = (name) => h('span', { class: 'ic', html: ICON[name] });
const iconBtn = (name, label, onclick, cls = '') => h('button', { class: 'iconbtn ' + cls, 'aria-label': label, onclick }, icon(name));

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 1900);
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}
function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  if (sec < 60) return sec + ' s';
  return m + ' min';
}

// ---------------------------------------------------------------- overlays
function openSheet(build, { full = false, title = '' } = {}) {
  const close = () => { back.remove(); onClose?.(); };
  let onClose = null;
  const body = h('div', { class: 'sbody' });
  const sheet = h('div', { class: 'sheet' + (full ? ' full' : '') },
    h('div', { class: 'grab' }),
    h('div', { class: 'shead' }, h('h2', { class: 'grow' }, title), iconBtn('x', 'Close', () => close())),
    body);
  const back = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === back) close(); } }, sheet);
  layer.append(back);
  const api = { close, body, sheet, set onClose(fn) { onClose = fn; } };
  build(api);
  return api;
}

function menuSheet(title, items) {
  openSheet((s) => {
    s.body.append(h('div', { class: 'menu' }, items.filter(Boolean).map((it) =>
      h('button', { class: 'btn' + (it.danger ? ' danger' : ''), onclick: () => { s.close(); it.run(); } }, icon(it.icon), it.label))));
  }, { title });
}

function dialog({ title, text, input, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const field = input != null ? h('input', { type: 'text', value: input, maxlength: 80, enterkeyhint: 'done' }) : null;
    const done = (val) => { back.remove(); resolve(val); };
    const confirm = () => done(field ? field.value.trim() : true);
    const box = h('div', { class: 'dialog' },
      h('h3', {}, title),
      text ? h('div', { class: 'muted' }, text) : null,
      field,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: confirm }, ok)));
    const back = h('div', { class: 'backdrop', style: { alignItems: 'center' }, onclick: (e) => { if (e.target === back) done(null); } }, box);
    layer.append(back);
    if (field) {
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); });
      setTimeout(() => { field.focus(); field.select(); }, 60);
    }
  });
}

// ---------------------------------------------------------------- library
const builtinById = new Map(ASANAS.map((a) => [a.id, a]));
const customAsanas = () => store.db().custom.map((c) => ({ id: c.id, name: c.name, en: 'My asana', cat: 'custom', sided: false, strokes: c.strokes }));
const allAsanas = () => [...ASANAS, ...customAsanas()];
const asana = (id) => builtinById.get(id) ?? customAsanas().find((c) => c.id === id);
const nameOf = (a) => store.db().names[a.id] || a.name;

const figCache = new Map();
function figure(a, mirror = false) {
  if (!a) return '';
  if (!a.pose) return strokesSVG(a.strokes, { mirror });
  const key = a.id + (mirror ? '|m' : '');
  if (!figCache.has(key)) figCache.set(key, poseSVG(a.pose, { mirror }));
  return figCache.get(key);
}
const figBox = (a, mirror) => h('div', { class: 'figbox', html: figure(a, mirror) });

// ---- recognition templates
let seedTemplates = null;
let templates = [];
function buildSeeds() {
  seedTemplates = [];
  const pushBoth = (id, strokes, weight) => {
    const cloud = toCloud(strokes);
    if (!cloud) return;
    seedTemplates.push({ id, cloud, weight });
    const m = mirrorCloud(cloud);
    if (distance(cloud, m) > 1.2) seedTemplates.push({ id, cloud: m, weight });
  };
  for (const a of ASANAS) {
    pushBoth(a.id, poseStrokes(a.pose, { head: true }), 1);
    pushBoth(a.id, poseStrokes(a.pose, { head: false }), 1);
  }
  for (const [id, list] of Object.entries(SKETCH_SEEDS)) for (const strokes of list) pushBoth(id, strokes, 0.85);
}
function rebuildTemplates() {
  if (!seedTemplates) buildSeeds();
  const user = [];
  const d = store.db();
  for (const c of d.custom) {
    const cloud = toCloud(c.strokes);
    if (cloud) user.push({ id: c.id, cloud, weight: 0.85 });
  }
  const known = new Set(allAsanas().map((a) => a.id));
  for (const [id, list] of Object.entries(d.samples)) {
    if (!known.has(id)) continue;
    for (const strokes of list) {
      const cloud = toCloud(strokes);
      if (cloud) user.push({ id, cloud, weight: 0.8 });
    }
  }
  templates = seedTemplates.concat(user);
}

// ---------------------------------------------------------------- router
let cleanup = null;
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function route() {
  cleanup?.();
  cleanup = null;
  layer.replaceChildren();
  const [, view = '', id, extra] = location.hash.split('/');
  const seq = id ? store.getSequence(id) : null;
  const entry = view === 'j' && id ? store.getEntry(id) : null;
  app.replaceChildren();
  if (view === 's' && seq) viewSequence(seq);
  else if (view === 'e' && seq) viewEdit(seq);
  else if (view === 'p' && seq) viewPlay(seq, extra === 'timed');
  else if (view === 'asanas') viewAsanas();
  else if (view === 'j' && entry) viewNote(entry);
  else if (view === 'journal' || view === 'j') viewJournal();
  else if (view === 'settings') viewSettings();
  else viewHome();
}
window.addEventListener('hashchange', route);

function tabs(active) {
  const tab = (key, hash, ic, label) => h('button', { class: active === key ? 'on' : '', onclick: () => go(hash) }, icon(ic), label);
  return h('nav', { class: 'tabs' },
    tab('home', '#/', 'list', 'Sequences'),
    tab('journal', '#/journal', 'note', 'Journal'),
    tab('asanas', '#/asanas', 'book', 'Asanas'),
    tab('settings', '#/settings', 'gear', 'Settings'));
}

// ---------------------------------------------------------------- sequences
function expandSteps(seq) {
  const out = [];
  for (const st of seq.steps) {
    const a = asana(st.asana);
    if (!a) continue;
    if (a.sided && st.side === 'both') out.push({ st, a, side: 'R' }, { st, a, side: 'L' });
    else out.push({ st, a, side: a.sided ? st.side : null });
  }
  return out;
}
const holdOf = (st) => st.hold ?? store.db().settings.hold;
const totalSeconds = (seq) => expandSteps(seq).reduce((sum, x) => sum + holdOf(x.st), 0);
const validSteps = (seq) => seq.steps.filter((st) => asana(st.asana));

async function renameSequence(seq, then) {
  const name = await dialog({ title: 'Rename sequence', input: seq.title, ok: 'Save' });
  if (!name) return;
  seq.title = name;
  store.touch(seq);
  then?.();
}
async function removeSequence(seq, then) {
  const ok = await dialog({ title: 'Delete this sequence?', text: `“${seq.title}” will be removed from this phone.`, ok: 'Delete', danger: true });
  if (!ok) return;
  store.deleteSequence(seq.id);
  then?.();
}
function sequenceMenu(seq, { fromList }) {
  const has = validSteps(seq).length > 0;
  menuSheet(seq.title, [
    fromList && has && { icon: 'play', label: 'Practice', run: () => go(`#/p/${seq.id}`) },
    fromList && { icon: 'edit', label: 'Edit', run: () => go(`#/e/${seq.id}`) },
    { icon: 'type', label: 'Rename', run: () => renameSequence(seq, route) },
    { icon: 'copy', label: 'Duplicate', run: () => { const c = store.duplicateSequence(seq.id); toast('Duplicated'); go(fromList ? '#/' : `#/s/${c.id}`); } },
    { icon: 'trash', label: 'Delete', danger: true, run: () => removeSequence(seq, () => go('#/')) },
  ]);
}

function viewHome() {
  const s = store.db().settings;
  const list = [...store.db().sequences];
  if (s.sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  else list.sort((a, b) => b.updatedAt - a.updatedAt);

  const width0 = window.innerWidth;
  const perRow = Math.max(4, Math.floor((width0 - 58 + 2) / 40));
  const onResize = () => { if (window.innerWidth !== width0) route(); };
  window.addEventListener('resize', onResize);
  cleanup = () => window.removeEventListener('resize', onResize);

  const sortBtn = (key, label) => h('button', { class: s.sort === key ? 'on' : '', onclick: () => { s.sort = key; store.save(); route(); } }, label);
  const cards = list.map((seq) => {
    const steps = validSteps(seq);
    // preview: up to two rows of figures, the last cell becoming "+N" when there are more
    const shown = steps.length <= perRow * 2 ? steps : steps.slice(0, perRow * 2 - 1);
    return h('div', { class: 'card', onclick: () => go(`#/s/${seq.id}`) },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('h3', {}, seq.title),
          h('div', { class: 'meta' }, `${steps.length} ${steps.length === 1 ? 'asana' : 'asanas'} · edited ${fmtDate(seq.updatedAt)}`)),
        iconBtn('more', 'More', (e) => { e.stopPropagation(); sequenceMenu(seq, { fromList: true }); })),
      steps.length ? h('div', { class: 'thumbs' },
        shown.map((st) => figBox(asana(st.asana))),
        steps.length > shown.length ? h('div', { class: 'more' }, `+${steps.length - shown.length}`) : null) : null);
  });

  const create = () => { const seq = store.newSequence(); go(`#/e/${seq.id}`); };
  app.append(h('div', { class: 'view', style: { position: 'relative' } },
    h('header', { class: 'top big' },
      h('h1', { class: 'grow' }, 'Practice Journal'),
      list.length > 1 ? h('div', { class: 'seg' }, sortBtn('edited', 'Recent'), sortBtn('name', 'A–Z')) : null),
    h('div', { class: 'scroll' },
      list.length ? h('div', { class: 'cards' }, cards)
        : h('div', { class: 'empty' },
          h('div', { html: figure(builtinById.get('vrksasana')) }),
          h('h3', {}, 'No sequences yet'),
          h('div', {}, 'Scribble stick figures and string them into a sequence for your home practice.'))),
    h('button', { class: 'fab', onclick: create }, icon('plus'), 'New sequence'),
    tabs('home')));
}

// ---- overview: the whole sequence on one page, with arrows
function viewSequence(seq) {
  const steps = validSteps(seq);
  const flow = h('div', { class: 'flow' }, steps.map((st) => {
    const a = asana(st.asana);
    const sub = [];
    if (a.sided) sub.push(st.side === 'both' ? 'R · L' : st.side === 'R' ? 'Right' : 'Left');
    if (st.hold != null) sub.push(st.hold + ' s');
    if (st.note) sub.push(st.note);
    return h('div', { class: 'ftile' }, figBox(a), h('div', { class: 'nm' }, nameOf(a)), sub.length ? h('div', { class: 'sub' }, sub.join(' · ')) : null);
  }));
  const scroll = h('div', { class: 'scroll' },
    steps.length ? flow : h('div', { class: 'empty' }, h('h3', {}, 'Empty sequence'), h('div', {}, 'Tap Edit to scribble some asanas in.')));

  const fit = () => {
    const n = steps.length;
    if (!n) return;
    const w = scroll.clientWidth - 40;
    const hgt = scroll.clientHeight - 30;
    let cols = 3;
    for (let c = 2; c <= 8; c++) {
      cols = c;
      const tile = (w - (c - 1) * 14) / c;
      if (Math.ceil(n / c) * (tile + 40) <= hgt) break;
      if (tile < 58) { cols = Math.min(c, 5); break; }
    }
    if (n < cols) cols = Math.max(n, 2);
    flow.style.setProperty('--cols', cols);
  };

  app.append(h('div', { class: 'view' },
    h('header', { class: 'top' },
      iconBtn('back', 'Back', () => go('#/')),
      h('h2', { class: 'grow' }, seq.title),
      iconBtn('more', 'More', () => sequenceMenu(seq, { fromList: false }))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', disabled: !steps.length, onclick: () => go(`#/p/${seq.id}`) }, icon('play'), 'Practice'),
      h('button', { class: 'btn', disabled: !steps.length, onclick: () => go(`#/p/${seq.id}/timed`) }, icon('timer'), 'Timed'),
      h('button', { class: 'btn', onclick: () => go(`#/e/${seq.id}`) }, icon('edit'), 'Edit')),
    steps.length ? h('div', { class: 'note', style: { padding: '0 18px 6px' } },
      `${steps.length} asanas · about ${fmtDuration(totalSeconds(seq))} timed`) : null,
    scroll));
  fit();
  window.addEventListener('resize', fit);
  cleanup = () => window.removeEventListener('resize', fit);
}

// ---------------------------------------------------------------- asana picker / library
function asanaBrowser(container, onPick) {
  let cat = 'all';
  let q = '';
  const grid = h('div', { class: 'scroll' });
  const chips = h('div', { class: 'chips' });
  const input = h('input', { type: 'search', placeholder: 'Search asanas', autocapitalize: 'off', autocomplete: 'off', oninput: () => { q = input.value.trim().toLowerCase(); draw(); } });

  function draw() {
    const d = store.db();
    const cats = [['all', 'All'], ...CATEGORIES.filter(([k]) => k !== 'custom' || d.custom.length)];
    chips.replaceChildren(...cats.map(([k, label]) => h('button', { class: 'chip' + (cat === k ? ' on' : ''), onclick: () => { cat = k; draw(); } }, label)));
    const list = allAsanas().filter((a) => (cat === 'all' || a.cat === cat) &&
      (!q || nameOf(a).toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.en.toLowerCase().includes(q)));
    grid.replaceChildren();
    if (!list.length) { grid.append(h('div', { class: 'empty' }, 'No asana matches “' + q + '”.')); return; }
    for (const [k, label] of CATEGORIES) {
      const items = list.filter((a) => a.cat === k);
      if (!items.length) continue;
      if (cat === 'all') grid.append(h('div', { class: 'cathead' }, label));
      grid.append(h('div', { class: 'grid' }, items.map((a) => {
        const n = d.samples[a.id]?.length;
        return h('button', { class: 'acard', onclick: () => onPick(a) }, figBox(a), h('div', { class: 'nm' }, nameOf(a)), n ? h('span', { class: 'badge' }, n) : null);
      })));
    }
  }
  draw();
  container.append(h('div', { class: 'search' }, icon('search'), input), chips, grid);
  return { redraw: draw };
}

function viewAsanas() {
  const view = h('div', { class: 'view' },
    h('header', { class: 'top big' }, h('h1', { class: 'grow' }, 'Asanas'),
      h('button', { class: 'btn small', onclick: () => customAsanaSheet(() => browser.redraw()) }, icon('plus'), 'My own')));
  const browser = asanaBrowser(view, (a) => asanaSheet(a, () => browser.redraw()));
  view.append(tabs('asanas'));
  app.append(view);
}

function padBlock({ short = true, hint }) {
  const canvas = h('canvas', { class: 'pad' + (short ? ' short' : '') });
  let pad;
  const tools = h('div', { class: 'padtools' },
    iconBtn('undo', 'Undo stroke', () => pad.undo()),
    iconBtn('x', 'Clear', () => pad.clear()));
  const wrap = h('div', { class: 'padwrap', style: { padding: '0', background: 'none' } }, canvas, tools,
    hint ? h('div', { class: 'note' }, hint) : null);
  return { wrap, canvas, init: (onChange) => (pad = createPad(canvas, onChange)), get pad() { return pad; } };
}

// Teach: an asana's details, your scribbles for it, and a pad to add more.
function asanaSheet(a, onChange) {
  openSheet((s) => {
    const d = store.db();
    const samplesBox = h('div', { class: 'samples' });
    const drawSamples = () => {
      const list = d.samples[a.id] ?? [];
      samplesBox.replaceChildren(...(list.length ? list.map((strokes, i) =>
        h('div', { class: 'sample', html: strokesSVG(strokes) },
          h('button', { 'aria-label': 'Delete scribble', html: ICON.x, onclick: () => { store.removeSample(a.id, i); rebuildTemplates(); drawSamples(); onChange?.(); } })))
        : [h('div', { class: 'muted small' }, a.pose ? 'None yet — the app is matching against the illustration’s outline.' : 'None yet — the app is matching against your drawing above.')]));
    };
    const pb = padBlock({ hint: 'Draw this asana the way you would scribble it, then save. A few samples make matching more reliable.' });
    const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => {
      store.addSample(a.id, pb.pad.strokes);
      rebuildTemplates();
      pb.pad.clear();
      drawSamples();
      onChange?.();
      toast('Scribble saved');
    } }, 'Save scribble');
    const title = h('h3', {}, nameOf(a));
    const notes = entriesFor(a.id);
    const noteList = h('div', { class: 'nlist' },
      notes.map((e) => h('button', { class: 'nrow', onclick: () => { s.close(); go(`#/j/${e.id}`); } },
        h('b', {}, fmtDay(e.date)), h('span', {}, e.text.trim() || 'No text'))),
      h('button', { class: 'btn small', style: { alignSelf: 'flex-start' }, onclick: () => { const e = store.newEntry({ asanas: [a.id] }); s.close(); go(`#/j/${e.id}`); } }, icon('plus'), 'Write a note'));
    s.body.append(
      h('div', { class: 'hero' }, figBox(a), h('div', { class: 'grow' }, title, h('div', { class: 'muted' }, a.en),
        a.sided ? h('div', { class: 'muted small' }, 'Practised on both sides') : null)),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn small', onclick: async () => {
          const name = await dialog({ title: 'Rename asana', text: a.pose ? `Standard name: ${a.name}. Leave empty to restore it.` : '', input: nameOf(a), ok: 'Save' });
          if (name == null) return;
          if (a.pose) { if (!name || name === a.name) delete d.names[a.id]; else d.names[a.id] = name; }
          else if (name) d.custom.find((c) => c.id === a.id).name = name;
          store.save();
          title.textContent = nameOf(asana(a.id));
          onChange?.();
        } }, icon('type'), 'Rename'),
        !a.pose ? h('button', { class: 'btn small danger', onclick: async () => {
          const ok = await dialog({ title: 'Delete this asana?', text: 'It will also disappear from any sequence that uses it.', ok: 'Delete', danger: true });
          if (!ok) return;
          store.removeCustom(a.id);
          rebuildTemplates();
          s.close();
          onChange?.();
        } }, icon('trash'), 'Delete') : null),
      h('div', { class: 'field' }, h('label', {}, notes.length ? `Journal notes (${notes.length})` : 'Journal notes'), noteList),
      h('div', { class: 'field' }, h('label', {}, 'My scribbles for this asana'), samplesBox),
      h('div', { class: 'field' }, h('label', {}, 'Teach a new scribble'), pb.wrap),
      h('div', { class: 'row', style: { marginTop: '10px', justifyContent: 'flex-end' } }, saveBtn));
    drawSamples();
    pb.init((strokes) => { saveBtn.disabled = !strokes.length; });
    s.onClose = () => pb.pad.destroy();
  }, { title: 'Asana' });
}

function customAsanaSheet(onDone, initial) {
  openSheet((s) => {
    const name = h('input', { type: 'text', placeholder: 'e.g. Supta Tadasana', maxlength: 60, autocapitalize: 'words' });
    const pb = padBlock({ hint: 'Your drawing becomes this asana’s picture and its first scribble.' });
    const check = () => { saveBtn.disabled = !name.value.trim() || !pb.pad || pb.pad.isEmpty(); };
    const saveBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => {
      const c = store.addCustom(name.value.trim(), pb.pad.strokes);
      rebuildTemplates();
      s.close();
      toast('Asana added');
      onDone?.(asana(c.id));
    } }, 'Add asana');
    name.addEventListener('input', check);
    s.body.append(
      h('div', { class: 'field', style: { marginTop: '0' } }, h('label', {}, 'Name'), name),
      h('div', { class: 'field' }, h('label', {}, 'Stick figure'), pb.wrap),
      h('div', { class: 'row', style: { marginTop: '10px', justifyContent: 'flex-end' } }, saveBtn));
    pb.init(check);
    s.onClose = () => pb.pad.destroy();
  }, { title: 'My own asana' });
}


// ---------------------------------------------------------------- journal
const jFilter = { tag: null, q: '' };
const HASH_RE = /(^|[^\p{L}\p{N}_#])#([\p{L}\p{N}_-]{1,40})/gu;

function fmtDay(date) {
  const d = new Date(date + 'T12:00:00');
  if (isNaN(d)) return date;
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}
// Note text with its #hashtags turned into tappable links.
function richText(text, onTag) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(HASH_RE)) {
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    const tag = m[2].toLowerCase();
    out.push(h('span', { class: 'hash', onclick: (e) => { e.stopPropagation(); onTag(tag); } }, '#' + m[2]));
    last = start + 1 + m[2].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
const entriesFor = (asanaId) => store.db().journal.filter((e) => e.asanas.includes(asanaId))
  .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);

function viewJournal() {
  const all = [...store.db().journal].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  const list = h('div', { class: 'cards' });
  const chips = h('div', { class: 'chips' });
  const input = h('input', { type: 'search', placeholder: 'Search notes', value: jFilter.q, autocapitalize: 'off', autocomplete: 'off',
    oninput: () => { jFilter.q = input.value.trim().toLowerCase(); draw(); } });

  function draw() {
    const counts = new Map();
    for (const e of all) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (jFilter.tag && !counts.has(jFilter.tag)) jFilter.tag = null;
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    chips.replaceChildren(...(tags.length ? [h('button', { class: 'chip' + (jFilter.tag ? '' : ' on'), onclick: () => { jFilter.tag = null; draw(); } }, 'All'),
      ...tags.map(([t, n]) => h('button', { class: 'chip' + (jFilter.tag === t ? ' on' : ''), onclick: () => { jFilter.tag = jFilter.tag === t ? null : t; draw(); } }, `#${t} ${n}`))] : []));
    chips.hidden = !tags.length;
    const shown = all.filter((e) => (!jFilter.tag || e.tags.includes(jFilter.tag)) &&
      (!jFilter.q || e.text.toLowerCase().includes(jFilter.q) || e.asanas.some((id) => { const a = asana(id); return a && nameOf(a).toLowerCase().includes(jFilter.q); })));
    list.replaceChildren(...shown.map((e) => {
      const figs = e.asanas.map(asana).filter(Boolean);
      return h('div', { class: 'card jcard', onclick: () => go(`#/j/${e.id}`) },
        h('div', { class: 'jdate' }, fmtDay(e.date)),
        e.text.trim() ? h('div', { class: 'jtext' }, richText(e.text.trim(), (t) => { jFilter.tag = t; draw(); })) : null,
        figs.length ? h('div', { class: 'jfigs' }, figs.map((a) =>
          h('button', { class: 'jfig', 'aria-label': nameOf(a), html: figure(a), onclick: (ev) => { ev.stopPropagation(); asanaSheet(a, route); } }))) : null);
    }));
    if (!shown.length) list.append(h('div', { class: 'empty' }, all.length ? 'No notes match.' : [
      h('h3', {}, 'No notes yet'),
      h('div', {}, 'Write what you noticed in practice. Tag asanas with a scribble, and add your own #hashtags in the text.')]));
  }
  draw();

  app.append(h('div', { class: 'view', style: { position: 'relative' } },
    h('header', { class: 'top big' }, h('h1', { class: 'grow' }, 'Journal')),
    all.length ? h('div', { class: 'search' }, icon('search'), input) : null,
    chips,
    h('div', { class: 'scroll' }, list),
    h('button', { class: 'fab', onclick: () => go(`#/j/${store.newEntry().id}`) }, icon('plus'), 'New note'),
    tabs('journal')));
}

// Pick an asana by scribbling it (or browsing), used to tag journal notes.
function scribblePicker(onPick) {
  openSheet((s) => {
    s.body.classList.add('flush');
    const settings = store.db().settings;
    const cands = h('div', { class: 'cands' });
    const canvas = h('canvas', { class: 'pad short' });
    let pad;
    let results = [];
    const choose = (a, rank) => {
      if (settings.learn && !pad.isEmpty() && rank !== 0) { store.addSample(a.id, pad.strokes); rebuildTemplates(); }
      s.close();
      onPick(a);
    };
    const draw = () => {
      cands.replaceChildren();
      if (pad.isEmpty()) { cands.append(h('div', { class: 'hint' }, 'Draw the asana below, or browse')); return; }
      results.forEach((r, i) => {
        const a = asana(r.id);
        if (a) cands.append(h('button', { class: 'cand', onclick: () => choose(a, i) }, figBox(a), h('div', { class: 'nm' }, nameOf(a))));
      });
    };
    const browse = () => {
      const strokes = pad.strokes.map((st) => st.map((p) => [...p]));
      s.close();
      openSheet((b) => {
        b.body.classList.add('flush');
        asanaBrowser(b.body, (a) => {
          if (settings.learn && strokes.length) { store.addSample(a.id, strokes); rebuildTemplates(); }
          b.close();
          onPick(a);
        });
      }, { full: true, title: 'Choose an asana' });
    };
    s.body.append(cands, h('div', { class: 'padwrap', style: { paddingTop: '8px' } }, canvas,
      h('div', { class: 'padtools left', style: { top: '14px' } }, h('button', { class: 'lbl', onclick: browse }, icon('search'), 'Browse')),
      h('div', { class: 'padtools', style: { top: '14px' } }, iconBtn('undo', 'Undo stroke', () => pad.undo()), iconBtn('x', 'Clear drawing', () => pad.clear()))));
    pad = createPad(canvas, (strokes) => { results = strokes.length ? recognize(strokes, templates, 10) : []; draw(); });
    draw();
    s.onClose = () => pad.destroy();
  }, { title: 'Tag an asana' });
}

function viewNote(entry) {
  const changed = () => store.touchEntry(entry);
  const text = h('textarea', { class: 'jarea', placeholder: 'What did you notice today?\nWrite #words for your own tags, like #shoulders or #morning.', 'aria-label': 'Note' });
  text.value = entry.text;
  const grow = () => { text.style.height = 'auto'; text.style.height = Math.max(180, text.scrollHeight + 2) + 'px'; };
  const tagBox = h('div', { class: 'chips', style: { padding: '0', flexWrap: 'wrap' } });
  const drawTags = () => tagBox.replaceChildren(...(entry.tags.length
    ? entry.tags.map((t) => h('button', { class: 'chip', onclick: () => { jFilter.tag = t; jFilter.q = ''; go('#/journal'); } }, '#' + t))
    : [h('div', { class: 'muted small' }, 'None yet. Any #word you type in the note becomes a tag.')]));
  text.addEventListener('input', () => { entry.text = text.value; changed(); grow(); drawTags(); });

  const date = h('input', { type: 'date', value: entry.date, 'aria-label': 'Date', onchange: () => { if (date.value) { entry.date = date.value; changed(); } } });
  const figs = h('div', { class: 'samples' });
  const drawFigs = () => {
    const valid = entry.asanas.filter((id) => asana(id));
    figs.replaceChildren(...valid.map((id) => {
      const a = asana(id);
      return h('div', { class: 'sample', role: 'button', 'aria-label': nameOf(a), html: figure(a), onclick: () => asanaSheet(a, drawFigs) },
        h('button', { 'aria-label': 'Remove ' + nameOf(a), html: ICON.x, onclick: (e) => { e.stopPropagation(); entry.asanas = entry.asanas.filter((x) => x !== id); changed(); drawFigs(); } }));
    }), h('button', { class: 'sample add', 'aria-label': 'Tag an asana', html: ICON.plus, onclick: () => scribblePicker(addAsana) }));
  };
  const addAsana = (a) => {
    if (!entry.asanas.includes(a.id)) { entry.asanas.push(a.id); changed(); }
    drawFigs();
  };

  app.append(h('div', { class: 'view' },
    h('header', { class: 'top' },
      iconBtn('back', 'Back to journal', () => go('#/journal')),
      h('h2', { class: 'grow' }, 'Note'),
      iconBtn('trash', 'Delete note', async () => {
        if (!await dialog({ title: 'Delete this note?', ok: 'Delete', danger: true })) return;
        store.deleteEntry(entry.id);
        go('#/journal');
      })),
    h('div', { class: 'scroll jedit' },
      date,
      text,
      h('div', { class: 'field' }, h('label', {}, 'Asanas in this note'), figs),
      h('div', { class: 'field' }, h('label', {}, 'My hashtags'), tagBox))));
  drawFigs();
  drawTags();
  grow();
  cleanup = () => { if (!entry.text.trim() && !entry.asanas.length) store.deleteEntry(entry.id); };
}

// ---------------------------------------------------------------- composer
function viewEdit(seq) {
  let cursor = seq.steps.length;
  let lastResults = [];
  let pad;
  const settings = store.db().settings;

  const title = h('input', { class: 'title-input', value: seq.title, maxlength: 80, 'aria-label': 'Sequence title', enterkeyhint: 'done',
    oninput: () => { seq.title = title.value.trim() || 'Untitled sequence'; store.touch(seq); },
    onkeydown: (e) => { if (e.key === 'Enter') title.blur(); },
    onfocus: () => { if (title.value === 'Untitled sequence') title.select(); } });
  const strip = h('div', { class: 'strip' });
  const inserting = h('div', { class: 'inserting', style: { display: 'none' } });
  const cands = h('div', { class: 'cands' });
  const canvas = h('canvas', { class: 'pad' });

  function drawStrip(scrollToCursor) {
    strip.replaceChildren();
    if (!seq.steps.length) {
      strip.append(h('div', { class: 'strip-hint' }, 'Draw a stick figure in the box below. Tap the matching asana and it joins your sequence here.'));
    }
    const caret = h('div', { class: 'caret' });
    seq.steps.forEach((st, i) => {
      if (i === cursor) strip.append(caret);
      const a = asana(st.asana);
      const marks = [];
      if (st.note) marks.push(h('i'));
      if (st.hold != null) marks.push(h('i'));
      const tile = h('div', { class: 'tile', 'data-id': st.id },
        h('span', { class: 'num' }, i + 1),
        marks.length ? h('span', { class: 'dots' }, marks) : null,
        a ? figBox(a) : h('div', { class: 'figbox' }),
        h('div', { class: 'nm' }, a ? nameOf(a) : 'Removed asana'));
      bindTile(tile, st);
      strip.append(tile);
    });
    if (cursor >= seq.steps.length && seq.steps.length) strip.append(caret);
    const atEnd = cursor >= seq.steps.length;
    inserting.style.display = atEnd ? 'none' : 'flex';
    if (!atEnd) inserting.replaceChildren(h('span', {}, `Adding after asana ${cursor}`), h('button', { onclick: () => { cursor = seq.steps.length; drawStrip(true); } }, 'Add at end'));
    if (scrollToCursor) caret.scrollIntoView?.({ block: 'nearest' });
  }

  function drawCands() {
    cands.replaceChildren();
    if (!pad || pad.isEmpty()) {
      cands.append(h('div', { class: 'hint' }, 'Matches appear here as you draw'));
      return;
    }
    for (const r of lastResults) {
      const a = asana(r.id);
      if (!a) continue;
      cands.append(h('button', { class: 'cand', onclick: () => pick(a, r) }, figBox(a), h('div', { class: 'nm' }, nameOf(a))));
    }
    cands.scrollLeft = 0;
  }

  function pick(a, result) {
    const strokes = pad.strokes;
    const rank = result ? lastResults.indexOf(result) : -1;
    if (settings.learn && strokes.length && rank !== 0) {
      store.addSample(a.id, strokes);
      rebuildTemplates();
      if (rank === -1) toast('Learned your scribble for ' + nameOf(a));
    }
    seq.steps.splice(cursor, 0, store.newStep(a.id));
    cursor++;
    store.touch(seq);
    pad.clear();
    drawStrip(true);
  }

  function browse() {
    openSheet((s) => {
      s.body.classList.add('flush');
      const hasInk = !pad.isEmpty();
      if (hasInk && settings.learn) s.body.append(h('div', { class: 'note', style: { padding: '0 18px 8px' } }, 'Pick the asana you drew — the app will remember your scribble for it.'));
      s.body.append(h('div', { style: { padding: '0 16px 8px' } },
        h('button', { class: 'btn small', onclick: () => { s.close(); customAsanaSheet((a) => { if (a) pick(a, null); }); } }, icon('plus'), 'My own asana')));
      asanaBrowser(s.body, (a) => { s.close(); pick(a, null); });
    }, { full: true, title: 'Choose an asana' });
  }

  function stepSheet(st) {
    const a = asana(st.asana);
    openSheet((s) => {
      const idx = () => seq.steps.indexOf(st);
      const changed = () => { store.touch(seq); drawStrip(); };
      const holdLabel = h('span');
      const drawHold = () => { holdLabel.textContent = st.hold == null ? `${settings.hold} s` : `${st.hold} s`; reset.style.visibility = st.hold == null ? 'hidden' : 'visible'; };
      const bump = (d) => { st.hold = Math.max(5, Math.min(1800, (st.hold ?? settings.hold) + d)); drawHold(); changed(); };
      const reset = h('button', { class: 'btn small', onclick: () => { st.hold = null; drawHold(); changed(); } }, 'Use default');
      const sideBtn = (key, label) => h('button', { class: st.side === key ? 'on' : '', onclick: (e) => {
        st.side = key; changed();
        e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      } }, label);
      const note = h('input', { type: 'text', value: st.note, maxlength: 80, placeholder: 'e.g. at wall, with chair, heels on block', enterkeyhint: 'done',
        oninput: () => { st.note = note.value.trim(); changed(); }, onkeydown: (e) => { if (e.key === 'Enter') note.blur(); } });
      const move = (d) => {
        const i = idx();
        const j = i + d;
        if (j < 0 || j >= seq.steps.length) return;
        seq.steps.splice(i, 1);
        seq.steps.splice(j, 0, st);
        cursor = seq.steps.length;
        changed();
        pos.textContent = `Position ${j + 1} of ${seq.steps.length}`;
      };
      const pos = h('div', { class: 'muted small' }, `Position ${idx() + 1} of ${seq.steps.length}`);
      s.body.append(
        h('div', { class: 'hero' }, a ? figBox(a) : null, h('div', { class: 'grow' }, h('h3', {}, a ? nameOf(a) : 'Removed asana'), a ? h('div', { class: 'muted' }, a.en) : null, pos)),
        h('div', { class: 'field' }, h('label', {}, 'Hold in timed practice' + (a?.sided ? ' (each side)' : '')),
          h('div', { class: 'row' }, h('div', { class: 'stepper' }, h('button', { onclick: () => bump(-5), 'aria-label': 'Shorter' }, '−'), holdLabel, h('button', { onclick: () => bump(5), 'aria-label': 'Longer' }, '+')), reset)),
        a?.sided ? h('div', { class: 'field' }, h('label', {}, 'Sides'), h('div', { class: 'seg' }, sideBtn('both', 'Right then left'), sideBtn('R', 'Right only'), sideBtn('L', 'Left only'))) : null,
        h('div', { class: 'field' }, h('label', {}, 'Note / props'), note),
        h('div', { class: 'field menu' },
          h('div', { class: 'row' },
            h('button', { class: 'btn grow', onclick: () => move(-1) }, icon('left'), 'Earlier'),
            h('button', { class: 'btn grow', onclick: () => move(1) }, 'Later', icon('right'))),
          h('button', { class: 'btn', onclick: () => { cursor = idx() + 1; drawStrip(true); s.close(); } }, icon('insert'), 'Add next asana after this one'),
          h('button', { class: 'btn', onclick: () => { const i = idx(); seq.steps.splice(i + 1, 0, { ...st, id: store.uid() }); cursor = seq.steps.length; changed(); s.close(); } }, icon('copy'), 'Duplicate'),
          h('button', { class: 'btn danger', onclick: () => { seq.steps.splice(idx(), 1); cursor = seq.steps.length; changed(); s.close(); } }, icon('trash'), 'Remove from sequence')));
      drawHold();
    }, { title: 'Step' });
  }

  // tap = options, long-press + drag = reorder
  let drag = null;
  function bindTile(tile, st) {
    tile.addEventListener('pointerdown', (e) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const start = [e.clientX, e.clientY];
      const state = { tile, st, start, active: false, pid: e.pointerId, moved: false };
      state.timer = setTimeout(() => beginDrag(state, start), 320);
      drag = state;
    });
    tile.addEventListener('click', () => { if (!tile.dataset.dragged) stepSheet(st); delete tile.dataset.dragged; });
  }
  function beginDrag(state, at) {
    state.active = true;
    const r = state.tile.getBoundingClientRect();
    state.off = [at[0] - r.left, at[1] - r.top];
    state.ghost = state.tile.cloneNode(true);
    state.ghost.classList.add('ghost');
    state.ghost.style.left = r.left + 'px';
    state.ghost.style.top = r.top + 'px';
    document.body.append(state.ghost);
    state.tile.classList.add('placeholder');
    state.tile.dataset.dragged = '1';
    strip.querySelector('.caret')?.remove();
    navigator.vibrate?.(8);
  }
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.start[0];
    const dy = e.clientY - drag.start[1];
    if (!drag.active) {
      if (Math.hypot(dx, dy) > 8) { clearTimeout(drag.timer); drag = null; }
      return;
    }
    drag.ghost.style.left = e.clientX - drag.off[0] + 'px';
    drag.ghost.style.top = e.clientY - drag.off[1] + 'px';
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tile');
    if (over && over !== drag.tile && over.parentNode === strip) {
      const r = over.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      strip.insertBefore(drag.tile, before ? over : over.nextSibling);
    }
    const sr = strip.getBoundingClientRect();
    if (e.clientY < sr.top + 24) strip.scrollTop -= 8;
    else if (e.clientY > sr.bottom - 24) strip.scrollTop += 8;
  };
  const onUp = (e) => {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.pid)) return;
    clearTimeout(drag.timer);
    const state = drag;
    drag = null;
    if (!state.active) return;
    state.ghost.remove();
    state.tile.classList.remove('placeholder');
    const order = [...strip.querySelectorAll('.tile')].map((t) => t.dataset.id);
    seq.steps.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
    cursor = seq.steps.length;
    store.touch(seq);
    drawStrip();
    if (e.type === 'pointercancel') delete state.tile.dataset.dragged;
  };
  const onTouchMove = (e) => { if (drag?.active) e.preventDefault(); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  strip.addEventListener('touchmove', onTouchMove, { passive: false });
  strip.addEventListener('contextmenu', (e) => e.preventDefault());

  app.append(h('div', { class: 'view' },
    h('header', { class: 'top' },
      iconBtn('back', 'Done', () => go(`#/s/${seq.id}`)),
      title,
      h('button', { class: 'btn small primary', onclick: () => go(`#/s/${seq.id}`) }, 'Done')),
    strip, inserting, cands,
    h('div', { class: 'padwrap' }, canvas,
      h('div', { class: 'padtools left' }, h('button', { class: 'lbl', onclick: browse }, icon('search'), 'Browse')),
      h('div', { class: 'padtools' },
        iconBtn('undo', 'Undo stroke', () => pad.undo()),
        iconBtn('x', 'Clear drawing', () => pad.clear())))));

  pad = createPad(canvas, (strokes) => {
    lastResults = strokes.length ? recognize(strokes, templates, 10) : [];
    drawCands();
  });
  drawStrip();
  drawCands();
  cleanup = () => {
    pad.destroy();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    drag?.ghost?.remove();
  };
}

// ---------------------------------------------------------------- practice
let audioCtx = null;
function bell(times = 1) {
  if (!store.db().settings.sound) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
    for (let i = 0; i < times; i++) {
      const t = audioCtx.currentTime + i * 0.55;
      for (const [freq, gain] of [[660, 0.22], [1320, 0.08], [1985, 0.04]]) {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        osc.connect(g).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 1.9);
      }
    }
  } catch (e) { /* no audio available */ }
}

function viewPlay(seq, startTimed) {
  const steps = expandSteps(seq);
  if (!steps.length) { go(`#/s/${seq.id}`); return; }
  let i = 0;
  let timed = startTimed;
  let running = false;
  let remaining = 0;     // ms
  let lastTick = 0;
  let finished = false;
  let wake = null;

  const root = h('div', { class: 'play' });
  const CIRC = 2 * Math.PI * 42;

  const requestWake = async () => {
    try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* not supported */ }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') requestWake(); };

  function show(n, ring = false) {
    if (n < 0) return;
    if (n >= steps.length) { finish(); return; }
    i = n;
    remaining = holdOf(steps[i].st) * 1000;
    lastTick = performance.now();
    if (ring) bell(1);
    draw();
  }
  function finish() {
    finished = true;
    running = false;
    if (timed) bell(2);
    draw();
  }
  function toggleRun() {
    running = !running;
    lastTick = performance.now();
    if (running) { bell(1); requestWake(); }
    draw();
  }
  const exit = () => go(`#/s/${seq.id}`);

  function draw() {
    root.replaceChildren();
    const total = steps.length;
    root.append(h('div', { class: 'ptop' },
      iconBtn('x', 'Close', exit),
      h('div', { class: 'mid' }, h('b', {}, seq.title), h('span', {}, finished ? 'Complete' : `${i + 1} / ${total}`)),
      iconBtn('timer', 'Timed mode', () => { timed = !timed; running = false; remaining = holdOf(steps[Math.min(i, total - 1)].st) * 1000; draw(); toast(timed ? 'Timed mode' : 'Manual mode'); }, timed ? 'on' : '')));
    root.querySelector('.ptop .iconbtn.on')?.style.setProperty('color', 'var(--accent)');
    root.append(h('div', { class: 'bar' }, steps.map((_, k) => h('i', { class: k <= i || finished ? 'on' : '' }))));

    if (finished) {
      root.append(h('div', { class: 'done' },
        h('div', { class: 'figbox', style: { width: '160px', height: '160px', margin: '0 auto 10px' }, html: figure(builtinById.get('savasana')) }),
        h('h2', {}, 'Sequence complete'),
        h('div', { class: 'muted' }, `${validSteps(seq).length} asanas practised`),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { finished = false; running = false; show(0); } }, icon('restart'), 'Start again'),
          h('button', { class: 'btn primary', onclick: exit }, 'Close'))));
      return;
    }

    const { st, a, side } = steps[i];
    root.append(
      h('div', { class: 'stage' },
        figBox(a, side === 'L'),
        h('div', { class: 'tap l', onclick: () => show(i - 1) }),
        h('div', { class: 'tap r', onclick: () => show(i + 1, timed && running) })),
      h('div', { class: 'caption' },
        h('h2', {}, nameOf(a)),
        h('div', { class: 'en' }, a.en),
        side ? h('span', { class: 'pill' }, side === 'R' ? 'Right side' : 'Left side') : null,
        st.note ? h('div', { class: 'nt' }, st.note) : null));

    const clock = timed ? h('button', { class: 'clock', onclick: toggleRun, 'aria-label': running ? 'Pause' : 'Start' },
      h('span', { html: `<svg class="ring" viewBox="0 0 92 92"><circle class="trk" cx="46" cy="46" r="42"/><circle class="arc" cx="46" cy="46" r="42" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg>` }),
      h('div', { class: 'inner' }, h('div', { class: 'secs' }), h('div', { class: 'state' }, running ? 'Pause' : 'Start'))) : h('div', { class: 'muted small' }, 'Tap or swipe');
    root.append(h('div', { class: 'pctl' },
      h('button', { class: 'nav', disabled: i === 0, 'aria-label': 'Previous', onclick: () => show(i - 1), html: ICON.back }),
      clock,
      h('button', { class: 'nav', 'aria-label': 'Next', onclick: () => show(i + 1, timed && running), html: ICON.next })));
    paintClock();
  }

  function paintClock() {
    const secs = root.querySelector('.secs');
    if (!secs) return;
    const full = holdOf(steps[i].st) * 1000;
    const s = Math.ceil(remaining / 1000);
    secs.textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : s;
    root.querySelector('.arc').setAttribute('stroke-dashoffset', (CIRC * (1 - remaining / full)).toFixed(1));
  }

  const ticker = setInterval(() => {
    if (!timed || !running || finished) return;
    const now = performance.now();
    remaining -= now - lastTick;
    lastTick = now;
    if (remaining <= 0) show(i + 1, i + 1 < steps.length);
    else paintClock();
  }, 200);

  // swipe + keyboard
  let sx = null;
  root.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (sx == null || finished) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 60) { e.preventDefault(); show(dx < 0 ? i + 1 : i - 1, dx < 0 && timed && running); }
  });
  const onKey = (e) => {
    if (finished) return;
    if (e.key === 'ArrowRight') show(i + 1, timed && running);
    else if (e.key === 'ArrowLeft') show(i - 1);
    else if (e.key === ' ' && timed) { e.preventDefault(); toggleRun(); }
  };
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisible);
  requestWake();

  app.append(root);
  show(0);
  cleanup = () => {
    clearInterval(ticker);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    wake?.release?.().catch(() => {});
  };
}

// ---------------------------------------------------------------- settings
async function exportBackup() {
  const text = store.exportJSON();
  const name = `yoga-practice-journal-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}
function importBackup() {
  const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    let text;
    try { text = await file.text(); JSON.parse(text); } catch (e) { toast('That file could not be read'); return; }
    const apply = (mode) => {
      try { store.importJSON(text, mode); rebuildTemplates(); toast('Backup imported'); route(); } catch (e) { toast(e.message); }
    };
    menuSheet('Import backup', [
      { icon: 'plus', label: 'Add to what is on this phone', run: () => apply('merge') },
      { icon: 'restart', label: 'Replace everything on this phone', danger: true, run: async () => {
        if (await dialog({ title: 'Replace everything?', text: 'Sequences and scribbles on this phone will be overwritten by the backup.', ok: 'Replace', danger: true })) apply('replace');
      } },
    ]);
  });
  document.body.append(input);
  input.click();
}

function viewSettings() {
  const d = store.db();
  const s = d.settings;
  const sw = (key) => {
    const el = h('button', { class: 'switch' + (s[key] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!s[key]), onclick: () => { s[key] = !s[key]; store.save(); el.classList.toggle('on', s[key]); el.setAttribute('aria-checked', String(s[key])); } });
    return el;
  };
  const holdLabel = h('span', {}, s.hold + ' s');
  const bump = (n) => { s.hold = Math.max(5, Math.min(600, s.hold + n)); store.save(); holdLabel.textContent = s.hold + ' s'; };
  const sampleCount = Object.values(d.samples).reduce((n, l) => n + l.length, 0);
  const item = (t, desc, control) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, t), desc ? h('div', { class: 'd' }, desc) : null), control);

  app.append(h('div', { class: 'view' },
    h('header', { class: 'top big' }, h('h1', {}, 'Settings')),
    h('div', { class: 'scroll' },
      h('div', { class: 'group' },
        item('Default hold', 'Used in timed practice unless a step sets its own', h('div', { class: 'stepper' }, h('button', { onclick: () => bump(-5), 'aria-label': 'Shorter' }, '−'), holdLabel, h('button', { onclick: () => bump(5), 'aria-label': 'Longer' }, '+'))),
        item('Bell', 'Chime when the asana changes in timed practice', sw('sound')),
        item('Learn from my picks', 'When you choose an asana that was not the first match, remember that scribble', sw('learn'))),
      h('div', { class: 'group' },
        item('Export backup', 'Save all sequences, notes and scribbles to a file', h('button', { class: 'btn small', onclick: exportBackup }, icon('up'), 'Export')),
        item('Import backup', 'Restore from a file you exported', h('button', { class: 'btn small', onclick: importBackup }, icon('down'), 'Import')),
        item('Forget my scribbles', `${sampleCount} saved scribble${sampleCount === 1 ? '' : 's'}`, h('button', { class: 'btn small danger', disabled: !sampleCount, onclick: async () => {
          if (!await dialog({ title: 'Forget all scribbles?', text: 'Sequences and your own asanas are kept. Matching goes back to the built-in outlines.', ok: 'Forget', danger: true })) return;
          d.samples = {}; store.save(); rebuildTemplates(); route();
        } }, 'Forget'))),
      h('div', { class: 'note' }, 'Your sequences, journal notes and scribbles are stored only on this device. Nothing is uploaded. Deleting the app from the Home Screen or clearing website data erases them, so export a backup now and then.'),
      h('div', { class: 'note' }, `Yoga Practice Journal ${VERSION} · ${ASANAS.length} asanas · works offline once installed.`)),
    tabs('settings')));
}

// ---------------------------------------------------------------- boot
store.load();
rebuildTemplates();
route();
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline support unavailable', e));
}
// Debug handle for automated checks.
window.__ypj = { store, recognize: (strokes) => recognize(strokes, templates, 10), templates: () => templates };
