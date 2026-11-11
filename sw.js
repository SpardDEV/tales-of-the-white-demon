const CACHE_NAME = "twd-shell-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./src/config.js",
  "./src/media.js",
  "./src/state.js",
  "./src/prompts.js",
  "./src/rules.js",
  "./src/gemini.js",
  "./src/supabase.js",
  "./src/globe.js",
  "./src/ui.js",
  "./src/main.js",
  "./src/sensory.js",
  "./assets_curated/catalog.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => null);
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
