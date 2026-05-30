const CACHE_NAME = 'class-memories-v6';
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

// Track recently shown tags to prevent duplicate notifications
const recentPushTags = new Set();

// Push notification handler (from FCM or server)
self.addEventListener('push', (event) => {
  // If firebase-messaging-sw.js already handled this, skip
  const data = event.data ? event.data.json() : {};

  // Check if this is an FCM message (has fcm field) — let firebase-messaging-sw handle it
  if (data.fcmMessageId || data.from) {
    return; // Firebase Messaging SW will handle this
  }

  const notifData = data.notification || data;
  const title = notifData.title || data.title || 'Class Memories';
  const tag = notifData.tag || data.tag || 'cm-notification-' + Date.now();

  // Duplicate prevention
  if (recentPushTags.has(tag)) return;
  recentPushTags.add(tag);
  setTimeout(() => recentPushTags.delete(tag), 5000);

  const options = {
    body: notifData.body || data.body || 'New notification',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    vibrate: [200, 100, 200, 100, 200],
    tag: tag,
    renotify: true,
    requireInteraction: true,
    data: {
      url: data.url || data.targetUrl || '/',
      type: data.type || 'general',
      notifId: data.notifId || ''
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Message handler — show notifications from main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, data } = event.data;
    self.registration.showNotification(title || 'Class Memories', {
      body: body || 'New notification',
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      vibrate: [200, 100, 200, 100, 200],
      tag: 'cm-' + Date.now(),
      renotify: true,
      requireInteraction: true,
      data: data || {}
    });
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';
  const notifId = event.notification.data?.notifId || '';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          // Send message for in-app navigation
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: targetUrl,
            notifId: notifId
          });
          return;
        }
      }
      // Otherwise open new window
      const fullUrl = new URL(targetUrl, self.location.origin).href;
      return clients.openWindow(fullUrl);
    })
  );
});
