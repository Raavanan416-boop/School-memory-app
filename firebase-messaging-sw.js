// Firebase Messaging Service Worker — SOLE handler for all push notifications
// This file MUST be at the root of the domain for FCM to work
// NOTE: sw.js handles ONLY caching. All push/notification logic lives here.
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

// ===== BACKGROUND MESSAGE HANDLER =====
// Handles messages when app is closed, backgrounded, or phone is locked
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM-SW] Background message:', payload);

  const notifData = payload.notification || {};
  const data = payload.data || {};

  const title = data.title || notifData.title || '📸 Class Memories';
  const body = data.body || notifData.body || 'New notification';
  const tag = data.tag || data.type || 'cm-notif-' + Date.now();
  const type = data.type || 'general';

  // Duplicate prevention — skip if same tag shown in last 5 seconds
  if (recentTags.has(tag)) {
    console.log('[FCM-SW] Skipping duplicate:', tag);
    return;
  }
  recentTags.add(tag);
  setTimeout(() => recentTags.delete(tag), 5000);

  // ===== CALL NOTIFICATIONS =====
  if (type === 'voice_call_incoming' || type === 'video_call_incoming') {
    const callerName = data.fromName || data.callerName || 'Someone';
    const callType = type === 'video_call_incoming' ? 'Video' : 'Voice';
    const callId = data.callId || '';

    const options = {
      body: `Incoming ${callType} Call`,
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      vibrate: [500, 200, 500, 200, 500, 200, 500],
      tag: 'incoming-call-' + callId,
      renotify: true,
      requireInteraction: true,
      silent: false,
      ongoing: true,
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
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
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
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
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
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    vibrate: [200, 100, 200, 100, 200],
    tag: tag,
    renotify: true,
    requireInteraction: true,
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
});

// ===== NOTIFICATION CLICK HANDLER =====
// Deep link to correct page based on notification type and action
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action;

  notification.close();

  // Dismiss action — just close
  if (action === 'dismiss') return;

  // Reject call — close notification, notify app
  if (action === 'reject_call') {
    // Post message to any open client to reject the call
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
        // Try to focus existing window
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
        // No window — open new one
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
      // Try to focus an existing window and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          // Post message to client for in-app navigation
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: targetUrl,
            notifId: data.notifId || ''
          });
          return;
        }
      }
      // No existing window — open new one
      return clients.openWindow(fullUrl);
    })
  );
});

// ===== MESSAGE HANDLER =====
// Receive messages from main thread (e.g. show notification from foreground)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, data } = event.data;
    self.registration.showNotification(title || 'Class Memories', {
      body: body || 'New notification',
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
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
});
