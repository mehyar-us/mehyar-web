// Only public application-shell assets are cached. Never intercept API or OAuth.
const CACHE = "mayor-shell-v1";
const SHELL = ["/", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("mayor-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.includes("auth") || url.search) return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(fetch(request).catch(() => caches.match("/").then((cached) => cached || Response.error())));
    return;
  }
  if (SHELL.slice(1).includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.headers.has("set-cookie")) await cache.put(request, response.clone());
      return response;
    }));
  }
});
