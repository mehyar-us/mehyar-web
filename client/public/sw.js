// MehyarSoft service worker — app-shell offline cache only.
// Strategy: precache the SPA shell at install, network-first for navigations
// with shell fallback, stale-while-revalidate for static assets.
// NO caching of /api/, /admin, /billing/*, or any function POST endpoint —
// conversion paths always go straight to the network.

const VERSION = 'mehyar-shell-v4';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/assets/mehyarsoft-mark.svg',
  '/assets/mehyarsoft-mark-192.png',
  '/assets/mehyarsoft-mark-512.png',
  '/assets/mehyarsoft-favicon.svg',
  '/assets/mehyarsoft-logo.svg',
  '/assets/mehyarsoft-logo-dark.svg',
  '/assets/mehyarsoft-logo-1024.svg',
  '/assets/mehyarsoft-social.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
  // Tell all open tabs to reload so they get the fresh app shell
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => c.postMessage({ type: 'SW_UPDATED', version: VERSION }));
  });
});

function isConversionPath(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/billing/') ||
    url.pathname.startsWith('/dashboard')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isConversionPath(url)) return;

  // Navigations: network-first, fall back to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
