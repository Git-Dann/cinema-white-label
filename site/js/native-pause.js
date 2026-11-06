// The iPhone cards' painted grounds drift slowly. ui.js keeps card grounds still by default (it bakes them,
// or pauses a live one once drawn), so the panels carry data-fx-live and this restarts each one's frame
// loop after it mounts, and again whenever ui.js remounts it (it frees the context off screen).
// Anything that moves for more than 5 s gets a pause control (WCAG 2.2.2): the system's .loop-pause disc,
// one per card. Under reduced motion ui.js bakes a still picture and system.css hides the disc.
const ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" rx="1"/><rect x="8" y="2" width="3" height="10" rx="1"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.5v9l7.5-4.5z"/></svg>';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

for (const panel of document.querySelectorAll('#native .panel[data-fx-live]')) {
  let paused = false;
  // ui.js pauses a live ground just after mounting it (after an await or two), so set the state again
  // a moment later too; resume and pause are idempotent
  const set = () => {
    const fx = panel.__fx;
    if (!fx || fx.baked) return;
    if (paused || reduced.matches) fx.pause(); else fx.resume();
  };
  const apply = () => [0, 120, 500].forEach(ms => setTimeout(set, ms));
  new MutationObserver(apply).observe(panel, { attributes: true, attributeFilter: ['data-fx-mounted'] });
  apply();
  // a card that came into view while the cards above still held every WebGL context shows its still
  // CSS picture (fallback "gl-budget") for good; mount it again once a context is free
  let remounting = false;
  const check = async () => {
    const fx = panel.__fx, info = fx?.info;
    if (!info || remounting) return;
    if (info.fallback === 'gl-budget' && !reduced.matches && (window.__tpGl || 0) < 3) {
      remounting = true;
      try {
        const lib = await import('../assets/effects/fx.js');
        await lib.mount(panel, panel.dataset.fx, { params: fx.params, seed: fx.seed, palette: fx.palette });
      } catch { /* keeps the still picture */ }
      remounting = false;
      apply();
      return;
    }
    if (info.running === (paused || reduced.matches)) set();
  };
  // while the card is on screen, check once a second that it is in the state it should be: ui.js also
  // pauses or remounts grounds as WebGL contexts free up when the cards above scroll away
  let poll = 0;
  new IntersectionObserver(([e]) => {
    clearInterval(poll);
    if (e.isIntersecting) { set(); poll = setInterval(check, 1000); }
  }).observe(panel);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'loop-pause';
  const show = () => {
    btn.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
    btn.setAttribute('aria-label', paused ? 'Play the background animation' : 'Pause the background animation');
    btn.setAttribute('aria-pressed', String(paused));
  };
  btn.addEventListener('click', () => { paused = !paused; show(); apply(); });
  show();
  panel.append(btn);
}
