// Pre-launch passcode gate for the marketing site (Vercel Routing Middleware).
// Nothing in site/ is served until a visitor enters the passcode held in the
// SITE_PASSCODE environment variable. The cookie holds an HMAC of the passcode,
// never the passcode itself, so changing SITE_PASSCODE signs everyone out.
// Delete this file (and the vercel.json ignoreCommand entry) to launch.

const COOKIE = 'seatfold_gate';
const UNLOCK = '/__unlock';
const REMEMBER_SECONDS = 60 * 60 * 24 * 30;
const PUBLIC = /^\/(?:fonts\/.+|favicon\.(?:ico|svg)|apple-touch-icon\.png|icon-(?:192|512)\.png|site\.webmanifest|og-image\.jpg)$/;

const enc = new TextEncoder();

async function tokenFor(passcode) {
  const key = await crypto.subtle.importKey('raw', enc.encode(passcode), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('seatfold-gate-v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// Only same-site paths, so the form cannot be used to redirect elsewhere.
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') && !value.startsWith(UNLOCK) ? value : '/';
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MARK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='6.5' cy='6.5' r='4.5'/%3E%3Ccircle cx='17.5' cy='6.5' r='4.5'/%3E%3Ccircle cx='6.5' cy='17.5' r='4.5'/%3E%3Crect x='13' y='13' width='9' height='9' rx='1.5'/%3E%3C/svg%3E";

function gatePage({ next, error, remember }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>Seatfold: your cinema’s own booking app</title>
<meta name="description" content="Native iOS and Android booking apps in your brand, run from one portal, with every show forecast by Pulse. For national chains and independents.">
<meta name="theme-color" content="#000000">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Seatfold">
<meta property="og:url" content="https://www.seatfold.uk/">
<meta property="og:title" content="Seatfold: your cinema’s own booking app">
<meta property="og:description" content="Native iOS and Android booking apps in your brand, run from one portal, with every show forecast by Pulse. For national chains and independents.">
<meta property="og:image" content="https://www.seatfold.uk/og-image.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Seatfold: your cinema’s own booking app. Three phones show the same booking app in three cinema brands.">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Seatfold: your cinema’s own booking app">
<meta name="twitter:description" content="Native iOS and Android booking apps in your brand, run from one portal, with every show forecast by Pulse.">
<meta name="twitter:image" content="https://www.seatfold.uk/og-image.jpg">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<style>
@font-face { font-family: Onest; font-weight: 100 900; font-display: swap; src: url(/fonts/onest-latin.woff2) format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 400 500; font-display: swap; src: url(/fonts/jetbrains-mono-latin.woff2) format('woff2'); }
:root { --bg: #000; --surface: #0d0d0d; --ink: #fff; --muted: #a3a3a3; --accent: #93f1f7; --line: rgb(255 255 255 / .12); --line-strong: rgb(255 255 255 / .22); --danger: #ffb4a8; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink);
  font: 400 16px/1.5 Onest, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
body::before { content: ""; position: fixed; inset: -20%; z-index: -1; pointer-events: none;
  background: radial-gradient(40% 35% at 30% 30%, rgb(147 241 247 / .10), transparent 70%), radial-gradient(35% 30% at 72% 70%, rgb(154 225 135 / .07), transparent 70%); }
main { width: 100%; max-width: 400px; }
.logo { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; font-size: 20px; letter-spacing: -.01em; margin: 0 0 40px; }
.logo i { width: 22px; height: 22px; background: var(--accent); -webkit-mask: url("${MARK}") center / contain no-repeat; mask: url("${MARK}") center / contain no-repeat; }
h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.15; font-weight: 600; letter-spacing: -.02em; }
p { margin: 0 0 32px; color: var(--muted); }
label.field { display: block; font-size: 14px; font-weight: 500; margin: 0 0 8px; }
input[type=text] { width: 100%; height: 64px; padding: 0 20px; border-radius: 16px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink);
  font: 500 28px/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: .5em; text-indent: .25em; transition: border-color .2s ease, box-shadow .2s ease; }
input[type=text]::placeholder { color: rgb(255 255 255 / .22); }
input[type=text]:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px rgb(147 241 247 / .16); }
input[aria-invalid=true] { border-color: var(--danger); }
.error { margin: 10px 0 0; font-size: 14px; color: var(--danger); }
.remember { display: flex; align-items: center; gap: 12px; margin: 20px 0 28px; min-height: 44px; font-size: 15px; cursor: pointer; user-select: none; }
.remember input { appearance: none; margin: 0; width: 22px; height: 22px; flex: none; border-radius: 7px; border: 1px solid var(--line-strong); background: var(--surface); display: grid; place-items: center; cursor: pointer; }
.remember input::after { content: ""; width: 12px; height: 12px; background: #000; transform: scale(0); transition: transform .15s ease;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 6.2 4.8 9 10 3' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 6.2 4.8 9 10 3' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
.remember input:checked { background: var(--accent); border-color: var(--accent); }
.remember input:checked::after { transform: scale(1); }
.remember input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.remember small { color: var(--muted); font-size: 14px; }
button { width: 100%; height: 52px; border: 0; border-radius: 999px; background: var(--accent); color: #000; font: 600 16px/1 Onest, ui-sans-serif, system-ui, sans-serif; cursor: pointer; transition: background .2s ease; }
button:hover { background: #b6f6fa; }
button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <div class="logo"><i aria-hidden="true"></i>Seatfold</div>
  <h1>Coming soon</h1>
  <p>This preview is private. Enter the six-digit passcode to continue.</p>
  <form method="post" action="${UNLOCK}" novalidate>
    <input type="hidden" name="next" value="${esc(next)}">
    <label class="field" for="code">Passcode</label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="••••••" required autofocus${error ? ' aria-invalid="true" aria-describedby="err"' : ''}>
    ${error ? '<p class="error" id="err" role="alert">That code didn’t work. Check it and try again.</p>' : ''}
    <label class="remember"><input type="checkbox" name="remember" value="1"${remember ? ' checked' : ''}><span>Remember this device <small>for 30 days</small></span></label>
    <button type="submit">Continue</button>
  </form>
</main>
<script>
  var f = document.querySelector('form'), c = document.getElementById('code');
  if (location.hash) f.elements.next.value += location.hash;
  c.addEventListener('input', function () { c.value = c.value.replace(/\\D/g, '').slice(0, 6); if (c.value.length === 6) f.requestSubmit ? f.requestSubmit() : f.submit(); });
</script>
</body>
</html>`;
}

function gate(status, opts) {
  return new Response(gatePage(opts), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'same-origin',
    },
  });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  if (PUBLIC.test(url.pathname)) return;

  const passcode = process.env.SITE_PASSCODE || '';
  // Fail closed: with no passcode configured the site stays locked.
  const token = passcode ? await tokenFor(passcode) : '';

  if (url.pathname === UNLOCK) {
    if (request.method !== 'POST') return Response.redirect(new URL('/', url), 303);
    let form;
    try { form = await request.formData(); } catch { form = new FormData(); }
    const code = String(form.get('code') || '').trim();
    const remember = form.get('remember') === '1';
    const next = safeNext(String(form.get('next') || '/'));
    if (token && /^\d{6}$/.test(code) && same(await tokenFor(code), token)) {
      const cookie = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
      if (remember) cookie.push(`Max-Age=${REMEMBER_SECONDS}`);
      return new Response(null, { status: 303, headers: { location: next, 'set-cookie': cookie.join('; '), 'cache-control': 'no-store' } });
    }
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 800));
    return gate(401, { next, error: true, remember });
  }

  if (token && same(readCookie(request, COOKIE), token)) return;

  // 200 so link-preview bots read the meta tags; still noindex.
  return gate(200, { next: safeNext(url.pathname + url.search), error: false, remember: false });
}
