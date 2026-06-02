const CACHE_NAME = 'class-memories-v7';
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
  '/manifest.json'
];

// Install — cache all static assets
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
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
