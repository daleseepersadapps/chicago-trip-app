// CHITOWN offline shell.
// Rule: HTML is ALWAYS network-first so a new build can never be pinned by the cache.
// Only the listed static assets are cache-first, and each is revalidated in the background.
const CACHE = 'chitown-v13';
// Only files the page requests WITHOUT a ?v= cache-buster belong here. The versioned
// scripts cache themselves on first fetch under their exact URL.
const SHELL = [
  './', './index.html',
  './itinerary.json', './manifest.webmanifest',
  './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js',
  'https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.clouds.min.js'
];
// only these filenames may ever be served from cache
const STATIC = /\/(support|photo-dome|image-slot|constellation|globe-canvas|weather|audio)\.js$|\/icon-\d+\.png$|\/theme\.mp3$|\/manifest\.webmanifest$|three\.module\.js$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Never touch Google Maps (terms forbid caching tiles; a stale SDK breaks the map),
  // and never touch the authoring documents — they must always be live.
  if (/\.googleapis\.com$|\.google\.com$|\.gstatic\.com$/.test(url.hostname)) return;
  if (/\.dc\.html$/.test(url.pathname) || url.searchParams.has('srcmap')) return;

  // The plan can change mid-trip: network first, last-known copy when there's no signal.
  if (url.pathname.endsWith('/itinerary.json')) {
    e.respondWith(caches.open(CACHE).then(async c => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh.ok) await c.put('./itinerary.json', fresh.clone());
        return fresh;
      } catch (err) {
        return (await c.match('./itinerary.json'))
          || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      }
    }));
    return;
  }

  // HTML / navigations: network first, always. Cache is only a no-signal fallback.
  const wantsHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (wantsHTML) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh.ok) c.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        return (await c.match('./index.html'))
          || new Response('<h1>Offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Known static assets: exact-URL match ONLY, so bumping ?v= always fetches fresh.
  if (url.origin === location.origin && STATIC.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
      if (hit) { net.catch(() => {}); return hit; }
      try { return await net; } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // Anything else: straight to the network, cached only as an offline fallback.
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && url.origin === location.origin) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      return hit || new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
