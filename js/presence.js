// Presence system — Real-time online status & typing indicators
import { db, doc, updateDoc, setDoc, onSnapshot, serverTimestamp, deleteField } from './firebase-config.js';
import { authManager } from './auth.js';

class PresenceManager {
  constructor() {
    this.typingTimers = {};
    // Firestore unsubscribe functions keyed by userId
    this._firestoreUnsubs = {};
    // Current callbacks keyed by userId — always updated, even if Firestore listener already exists
    this._callbacks = {};
    // Latest status cache keyed by userId — so new callbacks get instant data
    this._statusCache = {};
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

  /**
   * Watch a user's online status (from dedicated presence collection).
   * 
   * KEY FIX: The callback is ALWAYS updated even if a Firestore listener
   * already exists for this userId. This is critical because the chat list
   * re-renders on every onSnapshot update (innerHTML = ''), destroying DOM.
   * The new callback references the new DOM elements, so the existing
   * Firestore listener must invoke the LATEST callback.
   */
  watchUser(userId, callback) {
    // Always update the callback reference
    this._callbacks[userId] = callback;

    // If we already have cached status, invoke the new callback immediately
    // so the UI reflects the current state right away (no flicker)
    if (this._statusCache[userId]) {
      callback(this._statusCache[userId]);
    }

    // Only create ONE Firestore listener per userId
    if (this._firestoreUnsubs[userId]) return;

    this._firestoreUnsubs[userId] = onSnapshot(doc(db, 'presence', userId), (snap) => {
      let status;
      if (snap.exists()) {
        const data = snap.data();
        const lastSeen = data.lastSeen?.toDate ? data.lastSeen.toDate() : null;
        let isOnline = data.online || false;
        // Staleness check: if heartbeat hasn't been received in 2.5 min,
        // the user likely crashed/force-closed — treat as offline
        if (isOnline && lastSeen && (Date.now() - lastSeen.getTime() > 150000)) {
          isOnline = false;
        }
        status = { online: isOnline, lastSeen };
      } else {
        status = { online: false, lastSeen: null };
      }
      // Cache the latest status
      this._statusCache[userId] = status;
      // Always invoke the LATEST callback (not the stale one from initial registration)
      if (this._callbacks[userId]) {
        this._callbacks[userId](status);
      }
    });
  }

  // Get human-readable last seen text
  getLastSeenText(status) {
    if (!status.lastSeen) return '⚫ Offline';
    const diff = Date.now() - status.lastSeen.getTime();
    // Staleness override: even if status.online is true, if heartbeat is stale (>2.5 min),
    // show as offline with last seen time
    if (status.online && diff < 150000) return '🟢 Online';
    if (diff < 60000) return '⚫ Last seen just now';
    if (diff < 3600000) return `⚫ Last seen ${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `⚫ Last seen ${Math.floor(diff / 3600000)}h ago`;
    return `⚫ Last seen ${status.lastSeen.toLocaleDateString()}`;
  }

  // Stop watching a user
  unwatchUser(userId) {
    if (this._firestoreUnsubs[userId]) {
      this._firestoreUnsubs[userId]();
      delete this._firestoreUnsubs[userId];
    }
    delete this._callbacks[userId];
    delete this._statusCache[userId];
  }

  // Cleanup all listeners
  cleanup() {
    Object.values(this._firestoreUnsubs).forEach(unsub => unsub());
    this._firestoreUnsubs = {};
    this._callbacks = {};
    this._statusCache = {};
    Object.values(this.typingTimers).forEach(t => clearTimeout(t));
    this.typingTimers = {};
  }
}

export const presenceManager = new PresenceManager();
