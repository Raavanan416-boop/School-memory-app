const CACHE_NAME = 'class-memories-v8';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/router.js',
  '/js/utils.js',
  '/js/tailwind-config.js',
  '/js/firebase-config.js',
  '/js/notifications.js',
  '/js/presence.js',
  '/js/calls.js',
  '/js/cinematic-intro.js',
  '/js/festival-themes.js',
  '/js/security.js',
  '/js/pages/home.js',
  '/js/pages/upload.js',
  '/js/pages/search.js',
  '/js/pages/chat.js',
  '/js/pages/games.js',
  '/js/pages/profile.js',
  '/js/pages/notifications.js',
  '/js/pages/timecapsule.js',
  '/js/pages/diary.js',
  '/js/pages/birthday.js',
  '/js/pages/leaderboard.js',
  '/js/pages/polls.js',
  '/assets/notification.mp3',
  '/assets/class-memories-logo.png',
  '/icons/favicon-32.png',
  '/icons/icon-48.png',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-144.png',
  '/icons/icon-192.png',
  '/icons/icon-256.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/manifest.json'
];

// Install — cache all static assets (including new icons)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

// Activate — purge ALL old caches aggressively to remove stale icons
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

// Fetch — Network first, fallback to cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Skip Firebase and external API requests from cache
  if (e.request.url.includes('firebaseio.com') ||
      e.request.url.includes('googleapis.com') ||
      e.request.url.includes('gstatic.com') ||
      e.request.url.includes('firebasestorage.app') ||
      e.request.url.includes('fcm/')) {
    return;
  }

  // Force network-first for manifest and icon files to ensure fresh icons
  if (e.request.url.includes('manifest.json') ||
      e.request.url.includes('/icons/') ||
      e.request.url.includes('favicon')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// NOTE: Push notifications and notificationclick are handled exclusively
// by firebase-messaging-sw.js to avoid conflicts between service workers.
// Do NOT add push or notificationclick handlers here.
