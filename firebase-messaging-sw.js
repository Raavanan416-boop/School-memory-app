// ========================================================================
// UNIFIED Service Worker — Caching + Firebase Cloud Messaging (FCM)
// ========================================================================
// This is the SOLE service worker for the app.
// Handles: static asset caching, push notifications (background + foreground),
// notification clicks, incoming call alerts, and message forwarding.
//
// IMPORTANT: Do NOT register sw.js separately — it will conflict.
// ========================================================================

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ===== Firebase Config =====
const firebaseConfig = {
  apiKey: "AIzaSyDs9bqr8xcafukYgVLPg9Z9q5V50gI7i8g",
  authDomain: "school-memory-app.firebaseapp.com",
  databaseURL: "https://school-memory-app-default-rtdb.firebaseio.com",
  projectId: "school-memory-app",
  storageBucket: "school-memory-app.firebasestorage.app",
  messagingSenderId: "310068830991",
  appId: "1:310068830991:web:3c89f62e765843fd4c147a"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ===== CACHING =====
const CACHE_NAME = 'class-memories-v10';
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

// URLs that must NEVER be cached
function shouldSkipCache(url) {
  return url.includes('firebaseio.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('firebasestorage.app') ||
    url.includes('fcm.googleapis.com') ||
    url.includes('fcm/') ||
    url.includes('identitytoolkit') ||
    url.includes('securetoken');
}

// ===== INSTALL =====
self.addEventListener('install', (e) => {
  console.log('[SW] Installing unified service worker...');
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => console.log('[SW] Static assets cached'))
      .catch(err => console.warn('[SW] Cache addAll failed (non-fatal):', err.message))
  );
  self.skipWaiting();
});

// ===== ACTIVATE =====
self.addEventListener('activate', (e) => {
  console.log('[SW] Activating unified service worker...');
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
     .then(() => {
       console.log('[SW] Claimed all clients');
       // Verify push subscription is still alive
       return self.registration.pushManager.getSubscription();
     })
     .then(sub => {
       if (sub) {
         console.log('[SW] Push subscription active:', sub.endpoint.substring(0, 60) + '...');
       } else {
         console.warn('[SW] No push subscription found — client will re-subscribe on next load');
       }
     })
  );
});

// ===== FETCH — Network first, cache fallback =====
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (shouldSkipCache(e.request.url)) return;

  e.respondWith(
    fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return r;
    }).catch(() => caches.match(e.request))
  );
});


// ========================================================================
// PUSH EVENT — Raw push handler (safety net)
// ========================================================================
// This fires for EVERY push event before Firebase SDK processes it.
// For data-only payloads, Firebase SDK calls onBackgroundMessage.
// This listener ensures we always show a notification even if
// onBackgroundMessage doesn't fire for any reason.
// ========================================================================
let _pushHandledByFirebase = false;

self.addEventListener('push', (event) => {
  console.log('[SW] 🔔 Push event received!');
  _pushHandledByFirebase = false;

  if (!event.data) {
    console.log('[SW] Push event has no data, skipping');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
    console.log('[SW] Push payload:', JSON.stringify(payload));
  } catch (err) {
    console.warn('[SW] Could not parse push data as JSON:', err);
    return;
  }

  // Give Firebase SDK a moment to handle via onBackgroundMessage
  // If it does, _pushHandledByFirebase will be set to true
  const data = payload.data || {};

  // If there's a top-level notification field, the browser will auto-display it.
  // For data-only messages, we need to ensure showNotification is called.
  if (payload.notification) {
    console.log('[SW] Push has notification field — browser will auto-display');
    return; // Let browser handle it
  }

  // Data-only message — show notification via our handler
  // Wait briefly to let onBackgroundMessage fire first
  event.waitUntil(
    new Promise(resolve => setTimeout(resolve, 500)).then(() => {
      if (_pushHandledByFirebase) {
        console.log('[SW] Push already handled by onBackgroundMessage');
        return;
      }
      console.log('[SW] Push NOT handled by onBackgroundMessage — showing notification via safety net');
      return showNotificationFromData(data);
    })
  );
});


// ========================================================================
// FCM BACKGROUND MESSAGE HANDLER
// ========================================================================
// Handles data-only messages when app is closed, backgrounded, or locked
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] 📩 onBackgroundMessage fired!', JSON.stringify(payload));
  _pushHandledByFirebase = true;

  const notifData = payload.notification || {};
  const data = payload.data || {};

  return showNotificationFromData({
    ...data,
    title: data.title || notifData.title,
    body: data.body || notifData.body,
  });
});


// ========================================================================
// SHOW NOTIFICATION — Unified handler for all notification types
// ========================================================================
async function showNotificationFromData(data) {
  const title = data.title || '📸 Class Memories';
  const body = data.body || 'New notification';
  const tag = data.tag || data.type || 'cm-notif-' + Date.now();
  const type = data.type || 'general';

  console.log(`[SW] showNotification → Title: "${title}", Type: "${type}", Tag: "${tag}"`);

  // ===== CALL NOTIFICATIONS =====
  if (type === 'voice_call_incoming' || type === 'video_call_incoming') {
    const callerName = data.fromName || data.callerName || 'Someone';
    const callType = type === 'video_call_incoming' ? 'Video' : 'Voice';
    const callId = data.callId || '';

    console.log(`[SW] 📞 Incoming ${callType} call from ${callerName}`);

    const options = {
      body: `Incoming ${callType} Call`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000, 500, 1000],
      tag: 'incoming-call-' + callId,
      renotify: true,
      requireInteraction: true,
      silent: false,
      data: {
        url: `/?page=chat`,
        type: type,
        callId: callId,
        callerId: data.fromId || data.callerId || '',
        callerName: callerName,
        notifId: data.notifId || ''
      },
      actions: [
        { action: 'accept_call', title: '✅ Accept' },
        { action: 'reject_call', title: '❌ Reject' }
      ]
    };

    return self.registration.showNotification(
      `${callType === 'Video' ? '📹' : '📞'} ${callerName}`,
      options
    );
  }

  // ===== MISSED CALL NOTIFICATIONS =====
  if (type === 'missed_voice_call' || type === 'missed_video_call') {
    const callerName = data.fromName || 'Someone';
    const callType = type === 'missed_video_call' ? 'Video' : 'Voice';

    const options = {
      body: `Missed ${callType} Call`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'missed-call-' + (data.callId || Date.now()),
      renotify: true,
      requireInteraction: false,
      silent: false,
      data: {
        url: data.targetUrl || `/?page=chat&userId=${data.fromId || ''}`,
        type: type,
        notifId: data.notifId || '',
        fromId: data.fromId || ''
      },
      actions: [
        { action: 'open', title: 'View' },
        { action: 'call_back', title: '📞 Call Back' }
      ]
    };

    return self.registration.showNotification(
      `📵 Missed ${callType} Call from ${callerName}`,
      options
    );
  }

  // ===== CHAT MESSAGE NOTIFICATIONS =====
  if (type === 'chat_message') {
    const senderName = data.fromName || 'Someone';
    const preview = data.messagePreview || body;

    const options = {
      body: preview,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: 'chat-' + (data.fromId || Date.now()),
      renotify: true,
      requireInteraction: false,
      silent: false,
      data: {
        url: data.targetUrl || `/?page=chat&userId=${data.fromId || ''}`,
        type: 'chat_message',
        notifId: data.notifId || '',
        fromId: data.fromId || ''
      },
      actions: [
        { action: 'open', title: 'Open Chat' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    };

    return self.registration.showNotification(senderName, options);
  }

  // ===== DEFAULT NOTIFICATIONS (likes, comments, etc.) =====
  const options = {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: tag,
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: {
      url: data.targetUrl || data.url || '/',
      type: type,
      notifId: data.notifId || ''
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  return self.registration.showNotification(title, options);
}


// ========================================================================
// NOTIFICATION CLICK HANDLER
// ========================================================================
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action;

  console.log(`[SW] Notification clicked! Action: "${action}", Type: "${data.type}", URL: "${data.url}"`);

  notification.close();

  // Dismiss action — just close
  if (action === 'dismiss') return;

  // Reject call — close notification, notify app
  if (action === 'reject_call') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        for (const client of clientList) {
          client.postMessage({
            type: 'REJECT_CALL',
            callId: data.callId || ''
          });
        }
      })
    );
    return;
  }

  // Accept call — open app and signal call accept
  if (action === 'accept_call') {
    const targetUrl = `/?page=chat&acceptCallId=${data.callId || ''}`;
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({
              type: 'ACCEPT_CALL',
              callId: data.callId || '',
              callerId: data.callerId || '',
              callerName: data.callerName || 'Unknown'
            });
            return;
          }
        }
        return clients.openWindow(new URL(targetUrl, self.location.origin).href);
      })
    );
    return;
  }

  // Call back action
  if (action === 'call_back') {
    const targetUrl = `/?page=chat&userId=${data.fromId || ''}`;
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url: targetUrl,
              notifId: data.notifId || ''
            });
            return;
          }
        }
        return clients.openWindow(new URL(targetUrl, self.location.origin).href);
      })
    );
    return;
  }

  // Default click / "open" action — navigate to target URL
  const targetUrl = data.url || '/';
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: targetUrl,
            notifId: data.notifId || ''
          });
          return;
        }
      }
      return clients.openWindow(fullUrl);
    })
  );
});


// ========================================================================
// NOTIFICATION CLOSE HANDLER
// ========================================================================
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification.tag);
});


// ========================================================================
// MESSAGE HANDLER — Receive messages from main thread
// ========================================================================
self.addEventListener('message', (event) => {
  // Show notification from foreground code
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, data } = event.data;
    self.registration.showNotification(title || 'Class Memories', {
      body: body || 'New notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: data?.tag || 'cm-' + Date.now(),
      renotify: true,
      requireInteraction: data?.requireInteraction || false,
      data: data || {}
    });
  }

  // Close incoming call notification (when call is answered/rejected in-app)
  if (event.data && event.data.type === 'CLOSE_CALL_NOTIFICATION') {
    const callId = event.data.callId;
    self.registration.getNotifications({ tag: 'incoming-call-' + callId }).then(notifications => {
      notifications.forEach(n => n.close());
    });
  }

  // Force skip waiting (for SW updates)
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
