// The pointer light in the page's ambient layer (site.css, .ambient__light). It eases towards the pointer
// rather than sticking to it, fades in on the first move and out when the pointer leaves the window, and
// only moves with transform and opacity, so it never repaints the page. Mouse and pen only; none under
// reduced motion.
const light = document.querySelector('.ambient__light');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
if (light && fine.matches && !calm.matches) {
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, a = 0, ta = 0, raf = 0;
  const tick = () => {
    x += (tx - x) * 0.09; y += (ty - y) * 0.09; a += (ta - a) * 0.06;
    light.style.setProperty('--px', x.toFixed(1) + 'px');
    light.style.setProperty('--py', y.toFixed(1) + 'px');
    light.style.setProperty('--pa', a.toFixed(3));
    raf = (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3 || Math.abs(ta - a) > 0.003) ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; tx = e.clientX; ty = e.clientY; ta = 1; kick(); }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { ta = 0; kick(); });
}
