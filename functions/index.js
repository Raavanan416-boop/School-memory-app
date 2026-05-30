// Cloud Functions — Push notification sender
// Triggers when a notification document is created in Firestore
// Reads the receiver's FCM token and sends push via FCM

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

/**
 * Send push notification when a notification document is created.
 * 
 * Expected notification document fields:
 * - userId: string (receiver's uid)
 * - title: string (notification title with emoji)
 * - body: string (notification body text)
 * - type: string (like, comment, chat_message, etc.)
 * - targetUrl: string (deep-link URL for click routing)
 * - fromId: string (sender's uid)
 * - fromName: string (sender's display name)
 */
exports.sendPushNotification = onDocumentCreated('notifications/{notifId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const notif = snap.data();
  const notifId = event.params.notifId;
  const receiverId = notif.userId;

  if (!receiverId) {
    console.log('No receiverId in notification, skipping push');
    return;
  }

  try {
    // Get receiver's user document to find FCM token
    const userDoc = await db.collection('users').doc(receiverId).get();
    if (!userDoc.exists) {
      console.log('Receiver user document not found:', receiverId);
      return;
    }

    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;

    if (!fcmToken) {
      console.log('No FCM token for user:', receiverId);
      return;
    }

    // Build the FCM message
    const title = notif.title || '📸 Class Memories';
    const body = notif.body || notif.message || 'New notification';
    const targetUrl = notif.targetUrl || '/';

    const message = {
      token: fcmToken,
      notification: {
        title: title,
        body: body,
      },
      data: {
        title: title,
        body: body,
        type: notif.type || 'general',
        targetUrl: targetUrl,
        notifId: notifId,
        tag: `${notif.type || 'general'}-${notifId}`,
        fromId: notif.fromId || '',
        fromName: notif.fromName || '',
      },
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: '86400',
        },
        notification: {
          title: title,
          body: body,
          icon: '/icons/icon-192.svg',
          badge: '/icons/icon-192.svg',
          vibrate: [200, 100, 200, 100, 200],
          tag: `${notif.type || 'general'}-${notifId}`,
          renotify: true,
          requireInteraction: true,
          data: {
            url: targetUrl,
            type: notif.type || 'general',
            notifId: notifId,
          },
          actions: [
            { action: 'open', title: 'Open' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        },
        fcmOptions: {
          link: targetUrl,
        },
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'class_memories_notifications',
          priority: 'max',
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: 'public',
        },
      },
    };

    // Send the push notification
    const response = await getMessaging().send(message);
    console.log('Push sent successfully:', response, 'to:', receiverId);

  } catch (error) {
    // Handle invalid/expired tokens
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      console.log('Invalid FCM token, removing from user:', receiverId);
      try {
        await db.collection('users').doc(receiverId).update({
          fcmToken: null,
          pushEnabled: false,
        });
      } catch (e) {
        console.error('Failed to clean up invalid token:', e);
      }
    } else {
      console.error('FCM send error:', error);
    }
  }
});

/**
 * Clean up old notifications (older than 30 days) — runs on schedule
 * Uncomment and deploy if you want automatic cleanup
 */
// const { onSchedule } = require('firebase-functions/v2/scheduler');
// exports.cleanOldNotifications = onSchedule('every 24 hours', async () => {
//   const cutoff = new Date();
//   cutoff.setDate(cutoff.getDate() - 30);
//   const snap = await db.collection('notifications')
//     .where('createdAt', '<', cutoff)
//     .limit(500)
//     .get();
//   const batch = db.batch();
//   snap.docs.forEach(doc => batch.delete(doc.ref));
//   await batch.commit();
//   console.log(`Cleaned ${snap.size} old notifications`);
// });
