// Notification system — FCM push + real-time Firestore + in-app notifications
// Supports: background push, lock screen, foreground toast, badge count, dedup, delete
import { db, app, collection, doc, addDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, updateDoc, serverTimestamp, getDocs } from './firebase-config.js';
import { authManager } from './auth.js';
import { showToast } from './utils.js';

// Notification type configurations with titles, bodies, and target URLs
const NOTIF_CONFIG = {
  like: {
    title: '❤️ New Like',
    bodyTemplate: (name) => `${name} liked your memory.`,
    getUrl: (data) => `/?page=home&postId=${data.postId || ''}`,
  },
  comment: {
    title: '💬 New Comment',
    bodyTemplate: (name) => `${name} commented on your memory.`,
    getUrl: (data) => `/?page=home&postId=${data.postId || ''}`,
  },
  chat_message: {
    title: '💬 New Message',
    bodyTemplate: (name, data) => `${name}: ${data.messagePreview || 'sent you a message'}`,
    getUrl: (data) => `/?page=chat&userId=${data.fromId || ''}`,
  },
  birthday_wish: {
    title: '🎂 New Birthday Wish',
    bodyTemplate: (name) => `${name} sent you a birthday wish.`,
    getUrl: () => `/?page=birthday`,
  },
  birthday: {
    title: '🎂 Birthday Today',
    bodyTemplate: (name) => `It's ${name}'s birthday today! 🎉`,
    getUrl: () => `/?page=birthday`,
  },
  birthday_bonus: {
    title: '🎂 Birthday Bonus',
    bodyTemplate: () => `You received birthday bonus points! 🎂✨`,
    getUrl: () => `/?page=leaderboard`,
  },
  friend_bonus: {
    title: '🎁 Birthday Gift',
    bodyTemplate: (name, data) => `${name} gifted you ${data.points || 5} points.`,
    getUrl: () => `/?page=leaderboard`,
  },
  time_capsule_unlock: {
    title: '📦 Time Capsule Opened',
    bodyTemplate: () => `Your memory capsule is ready.`,
    getUrl: (data) => `/?page=timecapsule&id=${data.capsuleId || ''}`,
  },
  poll_created: {
    title: '📊 New Poll',
    bodyTemplate: (name) => `Vote in the latest class poll.`,
    getUrl: (data) => `/?page=polls&id=${data.pollId || ''}`,
  },
  announcement: {
    title: '📢 School Announcement',
    bodyTemplate: () => `New announcement available.`,
    getUrl: () => `/?page=home`,
  },
  diary_entry: {
    title: '📖 New Diary Entry',
    bodyTemplate: (name) => `${name} wrote in the diary.`,
    getUrl: () => `/?page=diary`,
  },
  call_incoming: {
    title: '📞 Incoming Call',
    bodyTemplate: (name) => `Incoming call from ${name}.`,
    getUrl: () => `/?page=chat`,
  },
  game_challenge: {
    title: '🎮 Game Challenge',
    bodyTemplate: (name) => `${name} challenged you!`,
    getUrl: () => `/?page=games`,
  },
  badge_suggestion: {
    title: '🏷 New Badge',
    bodyTemplate: (name) => `${name} suggested a new title for you.`,
    getUrl: () => `/?page=profile`,
  },
  tag: {
    title: '📸 Tagged',
    bodyTemplate: (name) => `${name} tagged you in a memory.`,
    getUrl: (data) => `/?page=home&postId=${data.postId || ''}`,
  },
  miss_you: {
    title: '❤️ Someone Misses You',
    bodyTemplate: (name) => `${name} misses you ❤️🥺`,
    getUrl: (data) => `/?page=profile&userId=${data.fromId || ''}`,
  },
};

class NotificationManager {
  constructor() {
    this.unsubscribe = null;
    this.unreadCount = 0;
    this.notifications = [];
    this.listeners = [];
    this.badgeElement = null;
    this.pushPermission = 'default';
    this._messaging = null;
    this._soundAudio = null;
    this._soundUnlocked = false;
  }

  onChange(cb) { this.listeners.push(cb); }
  _notify() { this.listeners.forEach(cb => cb(this.unreadCount, this.notifications)); }

  setBadgeElement(el) { this.badgeElement = el; }

  // ===== FCM INITIALIZATION =====

  // Initialize Firebase Cloud Messaging
  async initFCM() {
    try {
      // Register the FCM service worker
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/'
      });
      console.log('[Notifications] FCM SW registered:', swReg.scope);

      // Dynamic import of Firebase Messaging
      const { getMessaging, getToken, onMessage } = await import(
        'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js'
      );

      this._messaging = getMessaging(app);

      // Handle foreground messages
      onMessage(this._messaging, (payload) => {
        console.log('[Notifications] Foreground message:', payload);
        const data = payload.data || {};
        const notifPayload = payload.notification || {};

        // Show in-app notification (toast + sound) for foreground
        this._showForegroundNotification({
          title: data.title || notifPayload.title || '📸 Class Memories',
          body: data.body || notifPayload.body || 'New notification',
          type: data.type || 'general',
          targetUrl: data.targetUrl || '/',
          notifId: data.notifId || '',
        });
      });

      // Listen for notification clicks from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NOTIFICATION_CLICK') {
          this._handleNotificationClick(event.data.url, event.data.notifId);
        }
      });

      return swReg;
    } catch (e) {
      console.warn('[Notifications] FCM init failed:', e);
      return null;
    }
  }

  // Request push notification permission + get FCM token
  async requestPushPermission() {
    if (!('Notification' in window)) return 'denied';

    try {
      const permission = await Notification.requestPermission();
      this.pushPermission = permission;

      if (permission === 'granted') {
        console.log('[Notifications] Push permission granted');
        await this._registerFCMToken();
      }
      return permission;
    } catch (e) {
      console.error('[Notifications] Push permission error:', e);
      return 'denied';
    }
  }

  // Register FCM token and save to user document
  async _registerFCMToken() {
    if (!this._messaging || !authManager.currentUser) return;

    try {
      const { getToken } = await import(
        'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js'
      );

      const swReg = await navigator.serviceWorker.getRegistration('/');

      // Get FCM token — VAPID key placeholder (replace with your key from Firebase Console)
      const token = await getToken(this._messaging, {
        vapidKey: 'qxHBJtuRVh-UdDL4nGmIEJplitZyHDQ_viFI22ibmQc',
        serviceWorkerRegistration: swReg,
      }).catch((err) => {
        console.warn('[Notifications] Token generation failed:', err);
        return null;
      });

      if (token && authManager.currentUser) {
        // Save token to user document
        await updateDoc(doc(db, 'users', authManager.currentUser.uid), {
          fcmToken: token,
          pushEnabled: true,
        });
        console.log('[Notifications] FCM token saved');
      }
    } catch (e) {
      console.log('[Notifications] FCM token registration failed:', e.message);
    }
  }

  // Remove FCM token on logout
  async removeFCMToken() {
    if (!authManager.currentUser) return;
    try {
      await updateDoc(doc(db, 'users', authManager.currentUser.uid), {
        fcmToken: null,
        pushEnabled: false,
      });
    } catch (e) { /* non-critical */ }
  }

  // ===== NOTIFICATION LISTENING =====

  // Start listening for notifications in real-time
  startListening() {
    if (!authManager.currentUser) return;
    if (this.unsubscribe) this.unsubscribe();

    // Request push permission after a short delay (not too aggressive)
    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(() => this.requestPushPermission(), 3000);
    }
    this.pushPermission = 'Notification' in window ? Notification.permission : 'denied';

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', authManager.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    this.unsubscribe = onSnapshot(q, (snap) => {
      const prevCount = this.notifications.length;
      const prevIds = new Set(this.notifications.map(n => n.id));
      this.notifications = [];
      this.unreadCount = 0;

      snap.forEach(d => {
        const notif = { id: d.id, ...d.data() };
        this.notifications.push(notif);
        if (!notif.read) this.unreadCount++;
      });

      this._updateBadge();
      this._notify();

      // Detect genuinely new notifications (not initial load)
      if (prevCount > 0) {
        const newNotifs = this.notifications.filter(n => !prevIds.has(n.id) && !n.read);
        if (newNotifs.length > 0) {
          const newest = newNotifs[0];
          // Only show in-app notification if app is focused (push handles background)
          if (document.hasFocus()) {
            this._showInAppNotification(newest);
            this._playNotificationSound();
          }
        }
      }
    }, (err) => {
      console.error('[Notifications] Listener error:', err);
    });
  }

  stopListening() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // ===== BADGE =====

  _updateBadge() {
    if (this.badgeElement) {
      if (this.unreadCount > 0) {
        this.badgeElement.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
        this.badgeElement.classList.remove('hidden');
      } else {
        this.badgeElement.classList.add('hidden');
      }
    }
    // Update PWA app icon badge
    if ('setAppBadge' in navigator) {
      if (this.unreadCount > 0) {
        navigator.setAppBadge(this.unreadCount).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }

  // ===== IN-APP NOTIFICATIONS =====

  _getNotifConfig(type) {
    return NOTIF_CONFIG[type] || {
      title: '🔔 Notification',
      bodyTemplate: () => 'New notification',
      getUrl: () => '/',
    };
  }

  _getNotificationText(notif) {
    const config = this._getNotifConfig(notif.type);
    const name = notif.fromName || 'Someone';
    // Use stored body if available, otherwise generate from template
    if (notif.body) return notif.body;
    return config.bodyTemplate(name, notif);
  }

  _getNotificationTitle(notif) {
    const config = this._getNotifConfig(notif.type);
    return notif.title || config.title;
  }

  _getNotificationUrl(notif) {
    if (notif.targetUrl) return notif.targetUrl;
    const config = this._getNotifConfig(notif.type);
    return config.getUrl(notif);
  }

  _showInAppNotification(notif) {
    const body = this._getNotificationText(notif);
    showToast(body, 'info');
  }

  _showForegroundNotification(data) {
    // Show toast for foreground messages
    showToast(data.body || 'New notification', 'info');
    this._playNotificationSound();
  }

  // ===== NOTIFICATION SOUND =====

  // Initialize the notification sound audio element
  _initSound() {
    if (this._soundAudio) return;
    try {
      this._soundAudio = new Audio('/assets/notification.mp3');
      this._soundAudio.volume = 0.6;
      this._soundAudio.preload = 'auto';
    } catch (e) { /* Audio not supported */ }
  }

  // Unlock audio on first user interaction (required by mobile browsers)
  unlockAudio() {
    if (this._soundUnlocked) return;
    this._initSound();
    if (this._soundAudio) {
      // Play a silent sound to unlock audio context
      this._soundAudio.volume = 0;
      this._soundAudio.play().then(() => {
        this._soundAudio.pause();
        this._soundAudio.currentTime = 0;
        this._soundAudio.volume = 0.6;
        this._soundUnlocked = true;
      }).catch(() => {});
    }
  }

  _playNotificationSound() {
    // Try audio element first (preferred — works with fixed mp3)
    this._initSound();
    if (this._soundAudio) {
      this._soundAudio.currentTime = 0;
      this._soundAudio.play().catch(() => {
        // Fallback to Web Audio API synthesis
        this._playWebAudioFallback();
      });
      return;
    }
    this._playWebAudioFallback();
  }

  _playWebAudioFallback() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;

      // Pleasant school-bell chime (3 ascending tones)
      const notes = [
        { freq: 880, start: 0, dur: 0.12, gain: 0.25 },
        { freq: 1109, start: 0.12, dur: 0.12, gain: 0.2 },
        { freq: 1318, start: 0.24, dur: 0.2, gain: 0.3 },
      ];

      notes.forEach(n => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, now + n.start);
        gain.gain.setValueAtTime(0, now + n.start);
        gain.gain.linearRampToValueAtTime(n.gain, now + n.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.05);
      });

      setTimeout(() => ctx.close().catch(() => {}), 600);
    } catch (e) { /* Web Audio not supported */ }
  }

  // ===== CLICK HANDLING / DEEP LINKS =====

  _handleNotificationClick(url, notifId) {
    // Mark notification as read
    if (notifId) this.markRead(notifId);

    // Parse URL and navigate
    const urlObj = new URL(url, window.location.origin);
    const page = urlObj.searchParams.get('page') || 'home';
    const { router } = window.__appRouter || {};

    if (router) {
      const data = {};
      urlObj.searchParams.forEach((val, key) => {
        if (key !== 'page') data[key] = val;
      });
      router.navigate(page, Object.keys(data).length > 0 ? data : null);
    }
  }

  navigateToNotification(notif) {
    const url = this._getNotificationUrl(notif);
    this._handleNotificationClick(url, notif.id);
  }

  // ===== MARK AS READ =====

  async markRead(notifId) {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (e) { console.error('Mark read error:', e); }
  }

  async markAllRead() {
    if (!authManager.currentUser) return;
    try {
      const unread = this.notifications.filter(n => !n.read);
      await Promise.all(unread.map(n =>
        updateDoc(doc(db, 'notifications', n.id), { read: true })
      ));
    } catch (e) { console.error('Mark all read error:', e); }
  }

  // ===== DELETE =====

  async deleteNotification(notifId) {
    try {
      await deleteDoc(doc(db, 'notifications', notifId));
    } catch (e) { console.error('Delete notification error:', e); }
  }

  async deleteAllNotifications() {
    if (!authManager.currentUser) return;
    try {
      await Promise.all(this.notifications.map(n =>
        deleteDoc(doc(db, 'notifications', n.id))
      ));
    } catch (e) { console.error('Delete all notifications error:', e); }
  }

  // ===== CREATE NOTIFICATION =====

  /**
   * Create a notification for another user.
   * @param {string} type — notification type (like, comment, chat_message, etc.)
   * @param {string} targetUserId — the user who will receive the notification
   * @param {object} data — additional data (postId, messagePreview, points, etc.)
   */
  static async create(type, targetUserId, data = {}) {
    if (!authManager.currentUser || targetUserId === authManager.currentUser.uid) return;

    const config = NOTIF_CONFIG[type] || {
      title: '🔔 Notification',
      bodyTemplate: () => 'New notification',
      getUrl: () => '/',
    };

    const senderName = authManager.userData?.fullName || 'Someone';
    const title = config.title;
    const body = config.bodyTemplate(senderName, data);
    const targetUrl = config.getUrl({ ...data, fromId: authManager.currentUser.uid });

    // Deduplication key — prevents duplicate notifications for same action
    const dedupKey = data.deduplicationKey || `${type}_${authManager.currentUser.uid}_${targetUserId}_${data.postId || data.pollId || data.capsuleId || ''}`;

    // Check for existing duplicate within last 60 seconds
    try {
      const dedupQuery = query(
        collection(db, 'notifications'),
        where('userId', '==', targetUserId),
        where('deduplicationKey', '==', dedupKey),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      const existing = await getDocs(dedupQuery);
      if (!existing.empty) {
        const lastNotif = existing.docs[0].data();
        if (lastNotif.createdAt?.toDate) {
          const elapsed = Date.now() - lastNotif.createdAt.toDate().getTime();
          if (elapsed < 60000) {
            console.log('[Notifications] Duplicate suppressed:', dedupKey);
            return; // Skip duplicate
          }
        }
      }
    } catch (e) {
      // Dedup query failed — proceed anyway (index might not exist yet)
      console.warn('[Notifications] Dedup check failed:', e.message);
    }

    // Create the notification document
    try {
      await addDoc(collection(db, 'notifications'), {
        type,
        userId: targetUserId,
        fromId: authManager.currentUser.uid,
        fromName: senderName,
        fromPhoto: authManager.userData?.profilePic || '',
        title,
        body,
        targetUrl,
        deduplicationKey: dedupKey,
        read: false,
        createdAt: serverTimestamp(),
        ...data,
      });
    } catch (e) { console.error('Create notification error:', e); }
  }
}

export const notificationManager = new NotificationManager();
export const createNotification = NotificationManager.create;
