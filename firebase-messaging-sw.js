// Firebase Messaging Service Worker — Background push notifications
// This file MUST be at the root of the domain for FCM to work
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase config (same as main app)
firebase.initializeApp({
  apiKey: "AIzaSyDs9bqr8xcafukYgVLPg9Z9q5V50gI7i8g",
  authDomain: "school-memory-app.firebaseapp.com",
  projectId: "school-memory-app",
  storageBucket: "school-memory-app.firebasestorage.app",
  messagingSenderId: "310068830991",
  appId: "1:310068830991:web:3c89f62e765843fd4c147a"
});

const messaging = firebase.messaging();

// Track recently shown notification tags to prevent duplicates
const recentTags = new Set();

// Handle background messages (app closed / backgrounded / phone locked)
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM-SW] Background message:', payload);

  const notifData = payload.notification || {};
  const data = payload.data || {};

  const title = data.title || notifData.title || '📸 Class Memories';
  const body = data.body || notifData.body || 'New notification';
  const tag = data.tag || data.type || 'cm-notif-' + Date.now();

  // Duplicate prevention — skip if same tag shown in last 5 seconds
  if (recentTags.has(tag)) {
    console.log('[FCM-SW] Skipping duplicate:', tag);
    return;
  }
  recentTags.add(tag);
  setTimeout(() => recentTags.delete(tag), 5000);

  const options = {
    body: body,
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    vibrate: [200, 100, 200, 100, 200],
    tag: tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: {
      url: data.targetUrl || data.url || '/',
      type: data.type || 'general',
      notifId: data.notifId || ''
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  return self.registration.showNotification(title, options);
});

// Handle notification clicks — deep link to correct page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Try to focus an existing window and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          // Post message to client for in-app navigation
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: targetUrl,
            notifId: event.notification.data?.notifId || ''
          });
          return;
        }
      }
      // No existing window — open new one
      return clients.openWindow(fullUrl);
    })
  );
});
