// Prima la rete (versione sempre fresca), la cache solo se la rete non risponde (offline).
// ponytail: 3 s di attesa se il PC è spento ma il tailnet è su; abbassare se dà fastidio
const CACHE = 'retrovoce';
const NETWORK_TIMEOUT_MS = 3000;
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'audio.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(caches.open(CACHE).then(cache =>
    fetch(e.request, { cache: 'no-store', signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) })
      .then(r => (r.ok && cache.put(e.request, r.clone()), r))
      .catch(async err => (await cache.match(e.request, { ignoreSearch: true })) ?? Promise.reject(err)),
  ));
});
