// ========================================================================
// STUB — All caching + push logic is now in firebase-messaging-sw.js
// ========================================================================
// This file exists only to prevent 404 errors from old cached references.
// The unified service worker (firebase-messaging-sw.js) handles everything.
// Do NOT add any logic here — it will conflict with the FCM service worker.
// ========================================================================

// If this SW somehow gets installed, immediately hand off to the unified SW
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
  // Unregister this SW in favor of firebase-messaging-sw.js
  self.registration.unregister().then(() => {
    console.log('[sw.js] Unregistered stub SW — firebase-messaging-sw.js is the unified SW');
  });
});
