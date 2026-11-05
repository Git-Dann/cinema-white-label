// The portal demo in #portal: pick an operator (or your own colour), a theme and an appearance, and the
// phone preview and the contrast checks update. Every colour and ratio comes from the product's own
// theme engine (js/theme-engine.js), the same code the portal and the iPhone app use.
import { resolveTheme, CONTRAST_REQUIREMENTS, contrastRatio, themeTemplates } from './theme-engine.js';

const root = document.querySelector('[data-theme-demo]');
if (root) {
  // the two demo operators' approved palettes (shared/fixtures/tenant-config)
  const PALETTES = {
    northlight: { name: 'Northlight', accent: { dark: '#2DD4BF', light: '#0F766E' }, secondary: { dark: '#F5C451', light: '#9A6700' } },
    kestrel: { name: 'Kestrel', accent: { dark: '#FF5A6A', light: '#B0102A' }, secondary: { dark: '#D4AF37', light: '#8A6A12' } },
  };
  const THEMES = Object.fromEntries(themeTemplates().map(t => [t.id, t]));
  // the checks shown when everything passes: the pairs a customer notices first
  const KEY = ['Primary text on background', 'Muted text on surface', 'Primary button label', 'Selected seat', 'Held seat'];

  const state = { op: 'northlight', theme: 'midnight', ap: 'dark', colour: root.querySelector('[data-demo-colour]').value };
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];
  const screen = $('[data-demo-screen]');

  const palette = () => state.op === 'custom'
    ? { name: 'Your cinema', accent: { dark: state.colour, light: state.colour }, secondary: PALETTES.northlight.secondary }
    : PALETTES[state.op];

  function render() {
    const policy = THEMES[state.theme].appearancePolicy;
    if (policy === 'alwaysDark') state.ap = 'dark';
    if (policy === 'alwaysLight') state.ap = 'light';
    const pal = palette();
    const r = resolveTheme(state.theme, { id: state.op, ...pal });
    const t = r[state.ap];

    // the phone: semantic tokens only, as the app reads them
    const set = (k, v) => screen.style.setProperty(k, v);
    set('--d-bg', t.background); set('--d-surface', t.surface); set('--d-surface2', t.surfaceElevated);
    set('--d-text', t.textPrimary); set('--d-text2', t.textSecondary); set('--d-muted', t.textMuted);
    set('--d-accent', t.actionPrimary); set('--d-accent-text', t.actionPrimaryText); set('--d-divider', t.divider);
    set('--d-seat', t.seatAvailable); set('--d-seat-line', t.seatAvailableBorder); set('--d-sel', t.seatSelected);
    set('--d-held', t.seatHeld); set('--d-sold', t.seatSold); set('--d-prem', t.seatPremium);
    set('--d-r', r.cornerRadius.medium / 2 + 'px');
    $('[data-demo-brand]').textContent = pal.name;

    // the checks: all 23 pairs for this appearance, failures first
    const rows = CONTRAST_REQUIREMENTS.map(q => ({ label: q.label, min: q.min, ratio: contrastRatio(t[q.fg], t[q.bg]) }));
    const fails = rows.filter(x => x.ratio + 1e-9 < x.min);
    const show = [...fails, ...rows.filter(x => KEY.includes(x.label) && !fails.includes(x))].slice(0, 5);
    $('[data-demo-checks]').innerHTML = show.map(x => {
      const ok = x.ratio + 1e-9 >= x.min;
      return `<li class="${ok ? 'is-pass' : 'is-fail'}"><span>${x.label}</span><code>${x.ratio.toFixed(1)}:1${ok ? '' : ` <em>needs ${x.min}:1</em>`}</code></li>`;
    }).join('');
    const pass = rows.length - fails.length;
    $('[data-demo-count]').textContent = `${pass} of ${rows.length} pass`;
    $('[data-demo-bar]').style.setProperty('--k', String(pass / rows.length));
    root.classList.toggle('has-fail', fails.length > 0);
    $('[data-demo-publish]').textContent = fails.length ? `Fix ${fails.length} to publish` : 'Ready to publish';
    $('[data-demo-label]').textContent = `${pal.name}, ${THEMES[state.theme].name}`;

    // the controls
    $$('[data-op]').forEach(b => { const on = b.dataset.op === state.op; b.classList.toggle('is-on', on); if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(on)); });
    $$('[data-theme]').forEach(b => { const on = b.dataset.theme === state.theme; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    $$('[data-ap]').forEach(b => {
      const on = b.dataset.ap === state.ap;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
      b.disabled = policy !== 'system' && !on;
    });
  }

  $$('button[data-op]').forEach(b => b.addEventListener('click', () => { state.op = b.dataset.op; render(); }));
  const pick = $('[data-demo-colour]');
  pick.addEventListener('input', () => { state.colour = pick.value; state.op = 'custom'; render(); });
  pick.addEventListener('click', () => { if (state.op !== 'custom') { state.op = 'custom'; render(); } });
  $$('[data-theme]').forEach(b => b.addEventListener('click', () => { state.theme = b.dataset.theme; render(); }));
  $$('[data-ap]').forEach(b => b.addEventListener('click', () => { state.ap = b.dataset.ap; render(); }));
  render();
}
