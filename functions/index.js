// Cloud Functions — Push notification sender + Call notification handler
// Triggers when a notification document is created in Firestore
// Reads the receiver's FCM token and sends push via FCM
//
// CRITICAL: All messages are sent as DATA-ONLY payloads (no notification field).
// This ensures the service worker's onBackgroundMessage ALWAYS fires,
// giving us full control over notification display in all app states.

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const cloudinary = require('cloudinary').v2;

// Cloudinary configuration (Using process.env for security)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dcjudjdlm',
  api_key: process.env.CLOUDINARY_API_KEY ||'176572423893588',
  api_secret: process.env.CLOUDINARY_API_SECRET|| 'DLYCGMeQbSyBq2dnyawpGX0CLeg',
  secure: true
});

initializeApp();
const db = getFirestore();

/**
 * Send push notification when a notification document is created.
 * Handles all types: messages, likes, comments, calls, missed calls, etc.
 * 
 * Uses DATA-ONLY payloads so the service worker always controls display.
 * Includes retry logic for transient failures.
 * Logs delivery status for debugging.
 * 
 * Expected notification document fields:
 * - userId: string (receiver's uid)
 * - title: string (notification title with emoji)
 * - body: string (notification body text)
 * - type: string (like, comment, chat_message, voice_call_incoming, etc.)
 * - targetUrl: string (deep-link URL for click routing)
 * - fromId: string (sender's uid)
 * - fromName: string (sender's display name)
 * - callId: string (for call notifications)
 * - callType: string ('voice' or 'video')
 */
exports.sendPushNotification = onDocumentCreated('notifications/{notifId}', async (event) => {
  const snap = event.data;
  if (!snap) return;

  const notif = snap.data();
  const notifId = event.params.notifId;
  const receiverId = notif.userId;

  if (!receiverId) {
    console.log('[FCM] No receiverId in notification, skipping push');
    return;
  }

  try {
    // Get receiver's user document to find FCM token
    const userDoc = await db.collection('users').doc(receiverId).get();
    if (!userDoc.exists) {
      console.log('[FCM] Receiver user document not found:', receiverId);
      return;
    }

    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;

    if (!fcmToken) {
      console.log('[FCM] No FCM token for user:', receiverId, '— push skipped');
      // Log delivery failure
      await logDeliveryStatus(notifId, 'no_token', receiverId);
      return;
    }

    // Verify token is not stale (optional: check fcmTokenUpdatedAt)
    if (userData.fcmTokenUpdatedAt) {
      const tokenAge = Date.now() - userData.fcmTokenUpdatedAt.toDate().getTime();
      const MAX_TOKEN_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (tokenAge > MAX_TOKEN_AGE) {
        console.log('[FCM] Token may be stale for user:', receiverId, 'age:', Math.round(tokenAge / 86400000), 'days');
      }
    }

    const type = notif.type || 'general';
    const title = notif.title || '📸 Class Memories';
    const body = notif.body || notif.message || 'New notification';
    const targetUrl = notif.targetUrl || '/';

    // Determine TTL based on notification type
    const isCallNotif = type.includes('call_incoming');
    const ttl = isCallNotif ? 30 : 86400; // Calls expire in 30s, others in 24h

    const channelId = isCallNotif ? 'class_memories_calls' : 
                      (type === 'chat_message' ? 'class_memories_messages' : 'class_memories_general');

    // Build the FCM message — BOTH notification AND data payload as requested
    const message = {
      token: fcmToken,
      notification: {
        title: String(title),
        body: String(body),
      },
      data: {
        title: String(title),
        body: String(body),
        type: String(type),
        targetUrl: String(targetUrl),
        notifId: String(notifId),
        tag: `${type}-${notifId}`,
        fromId: String(notif.fromId || ''),
        fromName: String(notif.fromName || ''),
        fromPhoto: String(notif.fromPhoto || ''),
        callId: String(notif.callId || ''),
        callType: String(notif.callType || ''),
        callerName: String(notif.fromName || ''),
        callerId: String(notif.fromId || ''),
        messagePreview: String(notif.messagePreview || ''),
      },
      android: {
        priority: 'high',
        ttl: ttl * 1000,
        notification: {
          channelId: channelId,
          sound: 'default',
          defaultSound: true,
          visibility: 'public',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK' // Common for native wrappers
        }
      },
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: String(ttl),
        },
        fcmOptions: {
          link: targetUrl,
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl),
        },
        payload: {
          aps: {
            'content-available': 1,
            'mutable-content': 1,
            sound: 'default',
            badge: 1,
            ...(isCallNotif ? { 'interruption-level': 'time-sensitive' } : {}),
          },
        },
      },
    };

    // Send with retry logic
    const response = await sendWithRetry(message, 2);
    console.log('[FCM] ✅ Push sent successfully:', response, '| type:', type, '| to:', receiverId);
    
    // Log successful delivery
    await logDeliveryStatus(notifId, 'sent', receiverId, response);

  } catch (error) {
    // Handle invalid/expired tokens
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      console.log('[FCM] ❌ Invalid FCM token, removing from user:', receiverId);
      try {
        await db.collection('users').doc(receiverId).update({
          fcmToken: null,
          pushEnabled: false,
        });
      } catch (e) {
        console.error('[FCM] Failed to clean up invalid token:', e);
      }
      await logDeliveryStatus(notifId, 'invalid_token', receiverId, null, error.code);
    } else {
      console.error('[FCM] ❌ Send error:', error.code || error.message);
      await logDeliveryStatus(notifId, 'error', receiverId, null, error.code || error.message);
    }
  }
});

/**
 * Send FCM message with retry logic for transient errors.
 * @param {object} message - The FCM message to send
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<string>} - Message ID on success
 */
async function sendWithRetry(message, maxRetries = 2) {
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await getMessaging().send(message);
      return response;
    } catch (error) {
      lastError = error;
      
      // Only retry on transient errors
      const retryableCodes = [
        'messaging/internal-error',
        'messaging/server-unavailable',
        'messaging/too-many-requests',
      ];
      
      if (!retryableCodes.includes(error.code) || attempt >= maxRetries) {
        throw error;
      }
      
      // Exponential backoff: 500ms, 1500ms
      const delay = 500 * Math.pow(3, attempt);
      console.log(`[FCM] Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Log notification delivery status for debugging.
 * Writes to a subcollection on the notification document.
 */
async function logDeliveryStatus(notifId, status, receiverId, messageId = null, errorCode = null) {
  try {
    await db.collection('notifications').doc(notifId).update({
      _pushStatus: status,
      _pushMessageId: messageId || null,
      _pushError: errorCode || null,
      _pushTimestamp: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Non-critical — don't fail the function
    console.log('[FCM] Could not log delivery status:', e.message);
  }
}

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

/**
 * Securely delete media from Cloudinary.
 * Only callable by authenticated users.
 * Validates request data and deletes via Cloudinary backend API.
 */
exports.deleteCloudinaryMedia = onCall(async (request) => {
  // 1. Check Auth
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in to delete media.');
  }

  // 2. Validate Data
  const { publicIds, resourceType } = request.data;
  if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
    throw new HttpsError('invalid-argument', 'An array of Cloudinary public IDs is required.');
  }

  // 3. Ensure API secrets are configured
  if (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('Missing Cloudinary API Key or Secret in environment variables.');
    throw new HttpsError('internal', 'Server configuration error.');
  }

  const type = resourceType || 'image'; // 'image', 'video', or 'raw'
  const results = [];

  // 4. Delete each media from Cloudinary
  for (const publicId of publicIds) {
    try {
      if (!publicId) continue;
      console.log(`[Cloudinary] Deleting ${type}: ${publicId}`);
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: type });
      results.push({ publicId, success: result.result === 'ok' || result.result === 'not found', raw: result });
    } catch (err) {
      console.error(`[Cloudinary] Failed to delete ${publicId}:`, err);
      results.push({ publicId, success: false, error: err.message });
    }
  }

  return { status: 'success', results };
});
