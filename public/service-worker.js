/*
  Legacy service worker (deprecated).

  The app now uses the VitePWA (Workbox) generated service worker.
  This file remains only to safely retire older installations that had
  registered /service-worker.js, which could lead to stale-cache issues.
*/

const LEGACY_CACHE_PREFIXES = ['pmx-sw-'];

self.addEventListener('install', (event) => {
  // Activate immediately so we can unregister quickly.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((k) => {
            if (LEGACY_CACHE_PREFIXES.some((p) => k.startsWith(p))) return caches.delete(k);
            return Promise.resolve();
          })
        );
      } catch {
        // ignore
      }

      // Stop controlling the app going forward.
      try {
        await self.registration.unregister();
      } catch {
        // ignore
      }

      try {
        await self.clients.claim();
      } catch {
        // ignore
      }
    })()
  );
});

// Pass-through: let the network and the new SW handle caching.
self.addEventListener('fetch', () => {});
