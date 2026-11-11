// The iPhone cards' painted grounds drift. ui.js keeps card grounds still by default (it bakes them, or
// pauses a live one once drawn), so the panels carry data-fx-live and this restarts each one's frame loop
// after it mounts, and again whenever ui.js remounts it (it frees the context off screen). No pause
// control, at the owner's request. Under reduced motion ui.js bakes a still picture and nothing runs.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

for (const panel of document.querySelectorAll('#native .panel[data-fx-live]')) {
  // ui.js pauses a live ground just after mounting it (after an await or two), so resume again a moment
  // later too; resume is idempotent
  const set = () => {
    const fx = panel.__fx;
    if (!fx || fx.baked) return;
    if (reduced.matches) fx.pause(); else fx.resume();
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
    if (info.running === reduced.matches) set();
  };
  // while the card is on screen, check once a second that it runs: ui.js also pauses or remounts grounds
  // as WebGL contexts free up when the cards above scroll away
  let poll = 0;
  new IntersectionObserver(([e]) => {
    clearInterval(poll);
    if (e.isIntersecting) { set(); poll = setInterval(check, 1000); }
  }).observe(panel);
}
