// Simple cache-first Service Worker
const cacheSuffix = new URL(self.location).searchParams.get("v") || "v1";
const CACHE_NAME = `neuro-study-pwa-${cacheSuffix}`;
const BASE_URL = self.location;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./data/questions.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
].map((path) => new URL(path, BASE_URL).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => {
      if(k !== CACHE_NAME) return caches.delete(k);
    }))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if(url.pathname.startsWith("/api/")){
    event.respondWith(fetch(req));
    return;
  }
  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(res => {
        // Optional: cache new GET requests
        const copy = res.clone();
        if(req.method === "GET"){
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
