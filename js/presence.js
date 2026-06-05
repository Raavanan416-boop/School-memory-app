// Presence system — Real-time online status & typing indicators
import { db, doc, updateDoc, setDoc, onSnapshot, serverTimestamp, deleteField } from './firebase-config.js';
import { authManager } from './auth.js';

class PresenceManager {
  constructor() {
    this.typingTimers = {};
    this.presenceListeners = {};
    this._boundBeforeUnload = null;
    this._boundVisChange = null;
  }

  // Set current user online
  async setOnline() {
    if (!authManager.currentUser) return;
    try {
      const uid = authManager.currentUser.uid;
      await setDoc(doc(db, 'presence', uid), {
        online: true,
        lastSeen: serverTimestamp()
      }, { merge: true });
    } catch (e) { /* ignore */ }
  }

  // Set current user offline
  async setOffline() {
    if (!authManager.currentUser) return;
    try {
      const uid = authManager.currentUser.uid;
      await setDoc(doc(db, 'presence', uid), {
        online: false,
        lastSeen: serverTimestamp()
      }, { merge: true });
    } catch (e) { /* ignore */ }
  }

  // Start listening for browser close/tab switch to update presence
  startPresenceTracking() {
    this._boundBeforeUnload = () => {
      // Use sendBeacon for reliable offline-set on page close
      this.setOffline();
    };
    this._boundVisChange = () => {
      if (document.visibilityState === 'hidden') {
        this.setOffline();
      } else if (document.visibilityState === 'visible') {
        this.setOnline();
      }
    };
    window.addEventListener('beforeunload', this._boundBeforeUnload);
    document.addEventListener('visibilitychange', this._boundVisChange);
    this.setOnline();
  }

  stopPresenceTracking() {
    if (this._boundBeforeUnload) window.removeEventListener('beforeunload', this._boundBeforeUnload);
    if (this._boundVisChange) document.removeEventListener('visibilitychange', this._boundVisChange);
    this.setOffline();
  }

  // Set typing status in a chat
  async setTyping(chatId, isTyping) {
    if (!authManager.currentUser || !chatId) return;
    const uid = authManager.currentUser.uid;
    try {
      if (isTyping) {
        await updateDoc(doc(db, 'chats', chatId), {
          [`typing.${uid}`]: serverTimestamp()
        });
        // Auto-clear typing after 3s
        clearTimeout(this.typingTimers[chatId]);
        this.typingTimers[chatId] = setTimeout(() => {
          this.setTyping(chatId, false);
        }, 3000);
      } else {
        await updateDoc(doc(db, 'chats', chatId), {
          [`typing.${uid}`]: deleteField()
        });
        clearTimeout(this.typingTimers[chatId]);
      }
    } catch (e) { /* ignore errors */ }
  }

  // Check if someone is typing (returns array of typing user IDs)
  getTypingUsers(chatData) {
    if (!chatData?.typing || !authManager.currentUser) return [];
    const myUid = authManager.currentUser.uid;
    const now = Date.now();
    return Object.entries(chatData.typing)
      .filter(([uid, ts]) => {
        if (uid === myUid) return false;
        // Consider typing if timestamp is within last 5 seconds
        const t = ts?.toDate ? ts.toDate().getTime() : ts?.seconds ? ts.seconds * 1000 : 0;
        return (now - t) < 5000;
      })
      .map(([uid]) => uid);
  }

  // Watch a user's online status (from dedicated presence collection)
  watchUser(userId, callback) {
    if (this.presenceListeners[userId]) return;
    this.presenceListeners[userId] = onSnapshot(doc(db, 'presence', userId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback({
          online: data.online || false,
          lastSeen: data.lastSeen?.toDate ? data.lastSeen.toDate() : null
        });
      } else {
        callback({ online: false, lastSeen: null });
      }
    });
  }

  // Get human-readable last seen text
  getLastSeenText(status) {
    if (status.online) return '🟢 Online';
    if (!status.lastSeen) return '⚫ Offline';
    const diff = Date.now() - status.lastSeen.getTime();
    if (diff < 60000) return '⚫ Last seen just now';
    if (diff < 3600000) return `⚫ Last seen ${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `⚫ Last seen ${Math.floor(diff / 3600000)}h ago`;
    return `⚫ Last seen ${status.lastSeen.toLocaleDateString()}`;
  }

  // Stop watching a user
  unwatchUser(userId) {
    if (this.presenceListeners[userId]) {
      this.presenceListeners[userId]();
      delete this.presenceListeners[userId];
    }
  }

  // Cleanup all listeners
  cleanup() {
    Object.values(this.presenceListeners).forEach(unsub => unsub());
    this.presenceListeners = {};
    Object.values(this.typingTimers).forEach(t => clearTimeout(t));
    this.typingTimers = {};
  }
}

export const presenceManager = new PresenceManager();
