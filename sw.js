// Simple offline-first Service Worker with network-first for mutable data
const cacheSuffix = new URL(self.location).searchParams.get("v") || "v1";
const CACHE_NAME = `neuro-study-pwa-${cacheSuffix}`;
const BASE_URL = self.location;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./data/decks.json",
  "./data/questions.json",
  "./data/questions_forensics_v1.json",
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
  if(req.method !== "GET"){
    event.respondWith(fetch(req));
    return;
  }

  const isNavigation = req.mode === "navigate";
  const isIndexHtml = url.pathname.endsWith("/index.html") || url.pathname === "/";
  const isDataRequest = url.pathname.startsWith("/data/");

  if(isNavigation || isIndexHtml || isDataRequest){
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function networkFirst(req){
  try{
    const res = await fetch(req);
    if(res && res.ok){
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
    }
    return res;
  }catch(e){
    return caches.match(req);
  }
}

async function cacheFirst(req){
  const cached = await caches.match(req);
  if(cached) return cached;
  try{
    const res = await fetch(req);
    if(res && res.ok){
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
    }
    return res;
  }catch(e){
    return cached;
  }
}
