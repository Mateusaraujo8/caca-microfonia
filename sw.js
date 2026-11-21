const CACHE = "caca-microfonia-v9";
const FILES = ["./", "index.html", "comum.js", "medir.js", "caixas.js", "planta.js", "planta-foto.js", "marcador.html", "manifest.json", "icon.svg"];
const CDN = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      const u = new URL(e.request.url);
      if ((r.ok && u.origin === location.origin) || ((r.ok || r.type === "opaque") && CDN.includes(u.hostname))) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
