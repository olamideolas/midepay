/**
 * MidePay PWA Service Worker (v4.2)
 * - Cache-First (with background refresh) for static UI assets:
 *   index.html, style.css, liquid-glass.css, loading-animation.css,
 *   app.js, liquid-glass.js, midepay-icon.png, midepay-logo.svg, favicon.svg, manifest.json
 * - Network-First for Supabase API / Auth / Edge Functions & runtime config.js
 * - Clean offline fallback notification when mobile data is unavailable
 */

const CACHE_NAME = 'midepay-pwa-static-v5.2-preview-navigation';
// Protected staging navigation must stay with the browser so auth redirects work.
const IS_PROTECTED_PREVIEW = new URL(self.location.origin).hostname === 'midepay-staging-ola-f90f.vercel.app';

const STATIC_ASSETS = [
  '/payment-review.css',
  '/payment-review.js',
  '/refund-review.js',
  "/assets/banks/opay.png",
  "/assets/banks/palmpay.png",
  "/assets/banks/kuda.png",
  "/assets/banks/moniepoint.png",
  "/assets/banks/gtbank.png",
  "/assets/banks/access.png",
  "/assets/banks/zenith.png",
  "/assets/banks/uba.png",
  "/assets/banks/firstbank.png",
  "/assets/banks/providus.png",
  '/',
  '/index.html',
  '/style.css',
  '/ui-polish.css',
  '/ui-polish.js',
  '/liquid-glass.css',
  '/loading-animation.css',
  '/vendor/supabase.js',
  '/app.js',
  '/liquid-glass.js',
  '/midepay-icon.png',
  '/midepay-logo.svg',
  '/favicon.svg',
  '/manifest.json'
];

const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MidePay — Offline</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      background: #0B0F19;
      color: #F8FAFC;
      font-family: system-ui, -apple-system, sans-serif;
      text-align: center;
    }
    .offline-card {
      max-width: 420px;
      padding: 2rem 1.75rem;
      border-radius: 20px;
      background: #111827;
      border: 1px solid rgba(16, 185, 129, 0.28);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
    }
    .badge {
      display: inline-block;
      padding: 0.28rem 0.75rem;
      border-radius: 999px;
      background: rgba(245, 158, 11, 0.16);
      color: #FBBF24;
      font-size: 0.75rem;
      font-weight: 700;
      margin-bottom: 1rem;
    }
    h1 { font-size: 1.3rem; margin: 0 0 0.6rem; }
    p { font-size: 0.9rem; color: #94A3B8; line-height: 1.55; margin: 0 0 1.4rem; }
    button {
      background: #00D492;
      color: #0B0F19;
      border: none;
      border-radius: 12px;
      padding: 0.75rem 1.4rem;
      font-weight: 700;
      font-size: 0.92rem;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="offline-card">
    <span class="badge">Connection unavailable</span>
    <h1>MidePay could not load</h1>
    <p>The current page is unavailable. Check your connection and preview access, then try again. Current balances and payment status cannot be confirmed on this screen.</p>
    <button onclick="window.location.reload()">Retry Connection</button>
  </div>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    // UI code is network-only. A missing optional image must never block an update.
    Promise.resolve().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('midepay-pwa-static-') && key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

function isSupabaseOrApiRequest(url) {
  return (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/functions/') ||
    url.pathname === '/config.js' ||
    url.pathname === '/supabaseClient.js'
  );
}

self.addEventListener('fetch', (event) => {
  // No synthetic offline page or cached financial code on the protected preview.
  // Let the browser handle the request, including any deployment login redirect.
  if (IS_PROTECTED_PREVIEW) return;
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Financial screens must use the deployed code, never an older cached shell.
  // Only images/fonts below may use the offline cache. Fail closed without a network.
  if (url.origin === self.location.origin &&
      (request.mode === 'navigate' || /\.(?:html|js|css)$/.test(url.pathname) || url.pathname.startsWith('/api/'))) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => {
      if (request.mode === 'navigate') return new Response(OFFLINE_FALLBACK_HTML, {
        status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
      return new Response('Network required to load current MidePay code', { status: 503 });
    }));
    return;
  }

  // 1. Network-First for Supabase API calls & dynamic runtime config
  if (isSupabaseOrApiRequest(url)) {
    event.respondWith(
      fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.ok && url.origin === self.location.origin) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          return new Response(
            JSON.stringify({
              offline: true,
              error: 'Network unavailable. MidePay is running in offline mode.'
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }
          );
        })
    );
    return;
  }

  // 2. Cache-First for Static UI Shell & Brand Assets (same-origin + CDN libs)
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedRes) => {
      const fetchPromise = fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200 && url.origin === self.location.origin) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkRes;
        })
        .catch(() => null);

      if (cachedRes) {
        return cachedRes;
      }

      return fetchPromise.then(async (netRes) => {
        if (netRes) return netRes;
        if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
          const cachedShell = await caches.match('/index.html', { ignoreSearch: true });
          if (cachedShell) return cachedShell;
          return new Response(OFFLINE_FALLBACK_HTML, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

