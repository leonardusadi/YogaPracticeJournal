// A finger-drawing pad on a canvas. Reports strokes after every lift.

export function createPad(canvas, onChange) {
  const ctx = canvas.getContext('2d');
  let strokes = [];
  let current = null;
  let ink = '#222';

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function drawStroke(st) {
    if (!st.length) return;
    ctx.beginPath();
    ctx.moveTo(st[0][0], st[0][1]);
    if (st.length === 1) ctx.lineTo(st[0][0] + 0.1, st[0][1]);
    for (let i = 1; i < st.length - 1; i++) {
      const mx = (st[i][0] + st[i + 1][0]) / 2;
      const my = (st[i][1] + st[i + 1][1]) / 2;
      ctx.quadraticCurveTo(st[i][0], st[i][1], mx, my);
    }
    if (st.length > 1) ctx.lineTo(st[st.length - 1][0], st[st.length - 1][1]);
    ctx.stroke();
  }

  function redraw() {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ink = getComputedStyle(canvas).color || ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokes.forEach(drawStroke);
    if (current) drawStroke(current);
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (current) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    current = [pos(e)];
    current.pid = e.pointerId;
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current || e.pointerId !== current.pid) return;
    e.preventDefault();
    const p = pos(e);
    const last = current[current.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
    current.push(p);
    redraw();
  });
  const end = (e) => {
    if (!current || e.pointerId !== current.pid) return;
    const st = current.map((p) => [p[0], p[1]]);
    current = null;
    strokes.push(st);
    redraw();
    onChange?.(strokes);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // Stop iOS from scrolling or selecting while drawing.
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  return {
    get strokes() { return strokes; },
    clear() { strokes = []; current = null; redraw(); onChange?.(strokes); },
    undo() { strokes.pop(); redraw(); onChange?.(strokes); },
    isEmpty: () => strokes.length === 0,
    destroy() { ro.disconnect(); },
  };
}
