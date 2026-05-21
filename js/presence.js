// Presence system — Real-time online status & typing indicators
import { db, doc, updateDoc, onSnapshot, serverTimestamp, deleteField } from './firebase-config.js';
import { authManager } from './auth.js';

class PresenceManager {
  constructor() {
    this.typingTimers = {};
    this.presenceListeners = {};
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

  // Watch a user's online status
  watchUser(userId, callback) {
    if (this.presenceListeners[userId]) return;
    this.presenceListeners[userId] = onSnapshot(doc(db, 'users', userId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback({
          online: data.online || false,
          lastSeen: data.lastSeen?.toDate ? data.lastSeen.toDate() : null
        });
      }
    });
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
