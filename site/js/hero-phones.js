// The hero's three phones: the same app in three brands, painted by the product's theme engine.
// Left: Northlight, Midnight Cinema. Right: Kestrel, Classic, light. Centre: a new cinema whose brand
// colour and theme change every 3 s (the white-label pitch, shown). The cycle runs only while the hero is
// on screen and the tab is visible, has a pause button (WCAG 2.2.2), and rests under reduced motion.
import { PALETTES, paint } from './phone.js';

const root = document.querySelector('.hero-phones');
if (root) {
  const phone = id => root.querySelector(`[data-hero-phone="${id}"]`);
  paint(phone('northlight'), PALETTES.northlight, 'midnight', 'dark');
  paint(phone('kestrel'), PALETTES.kestrel, 'classic', 'light');

  const own = (accent, secondary = '#F5C451') => ({ name: 'Your cinema', accent: { dark: accent, light: accent }, secondary: { dark: secondary, light: secondary } });
  // each step passes all 23 contrast checks in its theme and appearance
  const STEPS = [
    [own('#FF8A3D'), 'premium', 'dark'],
    [own('#1D4ED8', '#9A6700'), 'classic', 'light'],
    [own('#F2D04B'), 'midnight', 'dark'],
    [own('#0F766E', '#9A6700'), 'light', 'light'],
    [own('#FF5A6A'), 'classic', 'dark'],
  ];
  // the screens are laid out at 196px wide; each scales with its phone, so a large phone shows a large screen
  const BASE = 196;
  const fit = el => { const w = el.parentElement.clientWidth - 6; el.style.width = BASE + 'px'; el.style.zoom = String(Math.max(0.6, w / BASE)); };
  const screens = [...root.querySelectorAll('[data-hero-phone]')];
  screens.forEach(fit);
  new ResizeObserver(() => screens.forEach(fit)).observe(root);
  const centre = phone('cycle');
  let i = 0, timer = 0, paused = false, onScreen = false;
  const show = () => paint(centre, ...STEPS[i]);
  show();

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pause = root.querySelector('[data-hero-pause]');
  const run = () => !paused && onScreen && !document.hidden && !reduced.matches;
  const sync = () => {
    clearInterval(timer);
    if (run()) timer = setInterval(() => { i = (i + 1) % STEPS.length; show(); }, 3000);
  };
  if (!reduced.matches) {
    pause.hidden = false;
    pause.addEventListener('click', () => {
      paused = !paused;
      pause.setAttribute('aria-pressed', String(paused));
      pause.setAttribute('aria-label', paused ? 'Play the brand preview' : 'Pause the brand preview');
      pause.innerHTML = paused
        ? '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.5v9l7.5-4.5z"/></svg>'
        : '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" rx="1"/><rect x="8" y="2" width="3" height="10" rx="1"/></svg>';
      sync();
    });
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }).observe(root);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener?.('change', sync);
  }
}
