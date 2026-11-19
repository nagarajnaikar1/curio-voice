// Offline support: cache the app files and the voice engine library.
// (The voice model itself is cached by the engine in the browser's Cache Storage.)
const CACHE = "curio-voice-v2";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const isShell = url.origin === location.origin;
  const isLib = url.hostname === "cdn.jsdelivr.net";
  if (!isShell && !isLib) return;               // model files: handled by the engine's own cache
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return isShell ? (hit ? (net, hit) : net) : (hit || net);
    })
  );
});
