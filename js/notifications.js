// Notification system — Real-time in-app + browser push notifications
import { db, collection, doc, addDoc, query, where, orderBy, limit, onSnapshot,
  updateDoc, serverTimestamp, getDocs } from './firebase-config.js';
import { authManager } from './auth.js';
import { showToast } from './utils.js';

class NotificationManager {
  constructor() {
    this.unsubscribe = null;
    this.unreadCount = 0;
    this.notifications = [];
    this.listeners = [];
    this.badgeElement = null;
    this.pushPermission = 'default';
  }

  onChange(cb) { this.listeners.push(cb); }
  _notify() { this.listeners.forEach(cb => cb(this.unreadCount, this.notifications)); }

  setBadgeElement(el) { this.badgeElement = el; }

  // Request browser push notification permission
  async requestPushPermission() {
    if (!('Notification' in window)) return 'denied';
    
    try {
      const permission = await Notification.requestPermission();
      this.pushPermission = permission;
      
      if (permission === 'granted') {
        console.log('Push notifications enabled');
        // Register for FCM if available
        this._registerFCM();
      }
      return permission;
    } catch (e) {
      console.error('Push permission error:', e);
      return 'denied';
    }
  }

  // Register Firebase Cloud Messaging token
  async _registerFCM() {
    try {
      // Check if Firebase messaging is available
      const { getMessaging, getToken } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js').catch(() => ({}));
      if (!getMessaging || !authManager.currentUser) return;

      const { app } = await import('./firebase-config.js');
      const messaging = getMessaging(app);
      
      // Get FCM token
      const token = await getToken(messaging, {
        vapidKey: '' // User needs to add their VAPID key from Firebase Console
      }).catch(() => null);

      if (token && authManager.currentUser) {
        // Save token to user document for server-side push
        await updateDoc(doc(db, 'users', authManager.currentUser.uid), {
          fcmToken: token,
          pushEnabled: true
        });
      }
    } catch (e) {
      // FCM not configured — fallback to in-app + browser notifications
      console.log('FCM not configured, using in-app notifications');
    }
  }

  // Start listening for notifications
  startListening() {
    if (!authManager.currentUser) return;
    if (this.unsubscribe) this.unsubscribe();

    // Auto-request push permission on first listen
    if ('Notification' in window && Notification.permission === 'default') {
      // Wait a bit before requesting to not be too aggressive
      setTimeout(() => this.requestPushPermission(), 3000);
    }
    this.pushPermission = 'Notification' in window ? Notification.permission : 'denied';

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', authManager.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    this.unsubscribe = onSnapshot(q, (snap) => {
      const prev = this.notifications.length;
      this.notifications = [];
      this.unreadCount = 0;

      snap.forEach(d => {
        const notif = { id: d.id, ...d.data() };
        this.notifications.push(notif);
        if (!notif.read) this.unreadCount++;
      });

      this._updateBadge();
      this._notify();

      // Show notification for new items
      if (prev > 0 && this.notifications.length > prev) {
        const newest = this.notifications[0];
        if (newest && !newest.read) {
          this._showInAppNotification(newest);
          this._sendBrowserNotification(newest);
          this._playNotificationSound();
        }
      }
    }, (err) => {
      console.error('Notification listener error:', err);
    });
  }

  stopListening() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  _updateBadge() {
    if (this.badgeElement) {
      if (this.unreadCount > 0) {
        this.badgeElement.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
        this.badgeElement.classList.remove('hidden');
      } else {
        this.badgeElement.classList.add('hidden');
      }
    }
    // Update browser badge count (if supported)
    if ('setAppBadge' in navigator) {
      if (this.unreadCount > 0) {
        navigator.setAppBadge(this.unreadCount).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }

  _getNotificationText(notif) {
    const name = notif.fromName || 'Someone';
    const messages = {
      like: `${name} liked your memory ❤️`,
      comment: `${name} commented on your post ✍️`,
      chat_message: `${name} sent you a message 💬`,
      birthday: `It's ${name}'s birthday today! 🎂`,
      time_capsule_unlock: `A time capsule has been unlocked ⏳`,
      poll_created: `${name} created a new poll 📊`,
      diary_entry: `${name} wrote in the diary 📖`,
      call_incoming: `Incoming call from ${name} 📞`,
      game_challenge: `${name} challenged you! 🎮`,
      badge_suggestion: `${name} suggested a new title for you 🏷`,
      tag: `${name} tagged you in a memory 📸`,
      birthday_bonus: `You received birthday bonus points! 🎂✨`,
      friend_bonus: `${name} sent you birthday bonus points! 🎁`,
      miss_you: `${name} misses you ❤️🥺`
    };
    return messages[notif.type] || notif.message || 'New notification';
  }

  _showInAppNotification(notif) {
    const msg = this._getNotificationText(notif);
    showToast(msg, 'info');
  }

  // Send browser push notification (works when app is minimized/background)
  _sendBrowserNotification(notif) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.hasFocus()) return; // Don't show browser notif if app is focused

    try {
      const msg = this._getNotificationText(notif);
      const notification = new Notification('Class Memories', {
        body: msg,
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-192.svg',
        tag: notif.type + '-' + (notif.id || Date.now()),
        renotify: true,
        vibrate: [100, 50, 100],
        data: {
          type: notif.type,
          url: this._getNotificationUrl(notif)
        },
        silent: false
      });

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);

      // Click handler — open correct page
      notification.onclick = () => {
        window.focus();
        notification.close();
        this._navigateToNotification(notif);
      };
    } catch (e) {
      // Fallback: try service worker notification
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: 'Class Memories',
          body: this._getNotificationText(notif),
          data: { type: notif.type, url: this._getNotificationUrl(notif) }
        });
      }
    }
  }

  _getNotificationUrl(notif) {
    switch (notif.type) {
      case 'chat_message': return '/#chat';
      case 'like': case 'comment': case 'tag': return '/#home';
      case 'poll_created': return '/#polls';
      case 'diary_entry': return '/#diary';
      case 'time_capsule_unlock': return '/#timecapsule';
      case 'birthday': return '/#home';
      case 'miss_you': return '/#profile';
      default: return '/';
    }
  }

  _navigateToNotification(notif) {
    const { router } = window.__appRouter || {};
    switch (notif.type) {
      case 'chat_message':
        if (router) router.navigate('chat');
        break;
      case 'like': case 'comment': case 'tag':
        if (router) router.navigate('home');
        break;
      case 'poll_created':
        if (router) router.navigate('polls');
        break;
      case 'diary_entry':
        if (router) router.navigate('diary');
        break;
      case 'time_capsule_unlock':
        if (router) router.navigate('timecapsule');
        break;
      case 'miss_you':
        if (router) router.navigate('profile', { userId: notif.fromId });
        break;
      default:
        if (router) router.navigate('home');
    }
    // Mark as read when clicked
    this.markRead(notif.id);
  }

  // Mark a single notification as read
  async markRead(notifId) {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (e) { console.error('Mark read error:', e); }
  }

  // Mark all as read
  async markAllRead() {
    if (!authManager.currentUser) return;
    try {
      const unread = this.notifications.filter(n => !n.read);
      await Promise.all(unread.map(n =>
        updateDoc(doc(db, 'notifications', n.id), { read: true })
      ));
    } catch (e) { console.error('Mark all read error:', e); }
  }

  // Create a notification for another user
  static async create(type, targetUserId, data = {}) {
    if (!authManager.currentUser || targetUserId === authManager.currentUser.uid) return;
    try {
      await addDoc(collection(db, 'notifications'), {
        type,
        userId: targetUserId,
        fromId: authManager.currentUser.uid,
        fromName: authManager.userData?.fullName || 'Someone',
        fromPhoto: authManager.userData?.profilePic || '',
        read: false,
        createdAt: serverTimestamp(),
        ...data
      });
    } catch (e) { console.error('Create notification error:', e); }
  }

  // Premium notification sound using Web Audio API
  _playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;

      // Modern notification chime (like WhatsApp/Instagram)
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

      // Close context after sound finishes
      setTimeout(() => ctx.close().catch(() => {}), 500);
    } catch (e) { /* Web Audio not supported */ }
  }
}

export const notificationManager = new NotificationManager();
export const createNotification = NotificationManager.create;
