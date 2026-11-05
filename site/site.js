// Seatfold: the live seat map in #seats, drawn from the product's own layout fixture
// (shared/fixtures/layouts/curved.json: 226 seats, curved rows, two entrances).
// Colours are the Northlight demo operator's resolved dark theme tokens.
const T = {
  free: '#263046', freeLine: '#71757C', sel: '#2DD4BF', sold: '#1A1F27', soldLine: '#2a2f38',
  prem: '#F5C451', screen: '#B9BCC1', label: '#8E9AB0', feature: '#71757C',
};
const NS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };

async function seatMap(svg) {
  const res = await fetch(svg.dataset.layout);
  if (!res.ok) return;
  const L = await res.json();
  const W = 1000, H = Math.round(W / L.aspectRatio);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // the screen: a curved line with its label under it
  const s = L.screen, sx = s.center.x * W, sy = s.center.y * H, half = (s.width * W) / 2, bow = s.curvature * W * 0.5;
  svg.append(el('path', { d: `M${sx - half} ${sy} Q${sx} ${sy - bow * 2} ${sx + half} ${sy}`, fill: 'none', stroke: T.screen, 'stroke-width': 5, 'stroke-linecap': 'round' }));
  const lab = el('text', { x: sx, y: sy + 8, 'text-anchor': 'middle', fill: T.label, 'font-size': 18, 'letter-spacing': 8, 'font-family': 'Onest, sans-serif' });
  lab.textContent = 'SCREEN';
  svg.append(lab);

  for (const f of L.features || []) {
    const g = el('g');
    g.append(el('rect', { x: f.x * W, y: f.y * H, width: f.width * W, height: f.height * H * 1.4, rx: 6, fill: 'none', stroke: T.feature, 'stroke-dasharray': '4 4' }));
    const t = el('text', { x: (f.x + f.width / 2) * W, y: f.y * H + f.height * H * 0.95, 'text-anchor': 'middle', fill: T.label, 'font-size': 14, 'font-family': 'Onest, sans-serif' });
    t.textContent = f.label;
    g.append(t);
    svg.append(g);
  }

  // a fixed pattern of taken seats, so every visitor sees the same house
  const taken = id => { let h = 7; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997; return h % 10 < 4; };
  const chosen = new Set();
  const sum = document.querySelector('[data-seat-sum]');
  const say = () => {
    const ids = [...chosen].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(i => i.replace('-', ''));
    sum.textContent = ids.length ? `${ids.length} ${ids.length === 1 ? 'seat' : 'seats'}: ${ids.join(', ')}` : 'Tap a free seat to choose it';
  };

  const rowsSeen = new Set();
  for (const seat of L.seats) {
    const w = seat.width * W, h = seat.height * H * 1.1, cx = seat.x * W, cy = seat.y * H;
    const sold = taken(seat.id), prem = seat.priceCategory === 'premium';
    const r = el('rect', {
      class: 'seat' + (sold ? ' is-sold' : ''), x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: w * 0.28,
      transform: `rotate(${seat.rotation || 0} ${cx} ${cy})`,
      fill: sold ? T.sold : T.free, stroke: sold ? T.soldLine : prem ? T.prem : T.freeLine, 'stroke-width': prem && !sold ? 2.5 : 1.5,
      tabindex: sold ? -1 : 0, role: 'checkbox', 'aria-checked': 'false',
      'aria-label': `Row ${seat.rowId}, seat ${seat.label}, ${prem ? 'premium' : 'standard'}, ${sold ? 'taken' : 'free'}`,
    });
    if (sold) r.setAttribute('aria-disabled', 'true');
    const toggle = () => {
      if (sold) return;
      const on = !chosen.has(seat.id);
      if (on && chosen.size >= 8) { sum.textContent = 'Up to 8 seats in one booking'; return; }
      on ? chosen.add(seat.id) : chosen.delete(seat.id);
      r.setAttribute('fill', on ? T.sel : T.free);
      r.setAttribute('stroke', on ? T.sel : prem ? T.prem : T.freeLine);
      r.setAttribute('aria-checked', String(on));
      say();
    };
    r.addEventListener('click', toggle);
    r.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    svg.append(r);

    // the row letter left of each row's leftmost seat
    if (!rowsSeen.has(seat.rowId)) {
      rowsSeen.add(seat.rowId);
      const first = L.seats.filter(o => o.rowId === seat.rowId).reduce((a, o) => (o.x < a.x ? o : a));
      const t = el('text', { x: first.x * W - w * 1.3, y: first.y * H + 5, 'text-anchor': 'middle', fill: T.label, 'font-size': 14, 'font-family': 'Onest, sans-serif', 'aria-hidden': 'true' });
      t.textContent = seat.rowId;
      svg.append(t);
    }
  }
}

const svg = document.querySelector('.seatmap__svg[data-layout]');
if (svg) seatMap(svg).catch(() => {});
