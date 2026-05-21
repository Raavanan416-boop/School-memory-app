// Notification system — Real-time in-app notifications + push support
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
  }

  onChange(cb) { this.listeners.push(cb); }
  _notify() { this.listeners.forEach(cb => cb(this.unreadCount, this.notifications)); }

  setBadgeElement(el) { this.badgeElement = el; }

  // Start listening for notifications
  startListening() {
    if (!authManager.currentUser) return;
    if (this.unsubscribe) this.unsubscribe();

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

      // Show toast + play sound for new notifications
      if (prev > 0 && this.notifications.length > prev) {
        const newest = this.notifications[0];
        if (newest && !newest.read) {
          this._showInAppNotification(newest);
          this._playSchoolBell();
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
  }

  _showInAppNotification(notif) {
    const messages = {
      like: `❤️ ${notif.fromName || 'Someone'} liked your memory`,
      comment: `💬 ${notif.fromName || 'Someone'} commented on your post`,
      chat_message: `✉️ New message from ${notif.fromName || 'Someone'}`,
      birthday: `🎂 It's ${notif.fromName || "someone's"} birthday today!`,
      time_capsule_unlock: `🔓 A time capsule has been unlocked!`,
      poll_created: `📊 New poll: ${notif.title || 'Check it out!'}`,
      diary_entry: `📖 ${notif.fromName || 'Someone'} wrote in the diary`,
      call_incoming: `📞 Incoming call from ${notif.fromName || 'Someone'}`,
      game_challenge: `🎮 ${notif.fromName || 'Someone'} challenged you!`,
      badge_suggestion: `🏷 ${notif.fromName || 'Someone'} suggested a new title for you`
    };
    const msg = messages[notif.type] || notif.message || 'New notification';
    showToast(msg, 'info');
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
}

export const notificationManager = new NotificationManager();
export const createNotification = NotificationManager.create;

// School bell sound generator using Web Audio API
NotificationManager.prototype._playSchoolBell = function() {
  if (document.hidden) return; // Only play when app is visible
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // Bell strike — fundamental + harmonics
    const freqs = [830, 1660, 2490]; // Bell harmonics
    const gains = [0.3, 0.15, 0.08];

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gains[i], now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.2);
    });

    // Second bell hit (school bell double ring)
    setTimeout(() => {
      const now2 = ctx.currentTime;
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 1.02, now2); // Slightly detuned
        gain.gain.setValueAtTime(gains[i] * 0.7, now2);
        gain.gain.exponentialRampToValueAtTime(0.001, now2 + 1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now2);
        osc.stop(now2 + 1);
      });
    }, 250);
  } catch (e) { /* Web Audio not supported */ }
};
