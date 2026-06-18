// Presence system — Real-time online status & typing indicators
import { db, rtdb, ref, rtdbSet, onValue, onDisconnect, rtdbServerTimestamp, doc, updateDoc, setDoc, serverTimestamp, deleteField } from './firebase-config.js';
import { authManager } from './auth.js';

class PresenceManager {
  constructor() {
    this.typingTimers = {};
    // RTDB unsubscribe functions keyed by userId
    this._rtdbUnsubs = {};
    // Current callbacks keyed by userId — always updated
    this._callbacks = {};
    // Latest status cache keyed by userId
    this._statusCache = {};
    this._boundBeforeUnload = null;
    this._boundVisChange = null;
  }

  // Set current user online
  async setOnline() {
    if (!authManager.currentUser) return;
    try {
      const uid = authManager.currentUser.uid;
      // Setup RTDB presence
      if (rtdb) {
        const myConnectionsRef = ref(rtdb, `presence/${uid}/online`);
        const lastOnlineRef = ref(rtdb, `presence/${uid}/lastSeen`);
        const connectedRef = ref(rtdb, '.info/connected');

        onValue(connectedRef, (snap) => {
          if (snap.val() === true) {
            rtdbSet(myConnectionsRef, true);
            onDisconnect(myConnectionsRef).set(false);
            onDisconnect(lastOnlineRef).set(rtdbServerTimestamp());
          }
        });
      }
      
      // Update Firestore for legacy queries
      await setDoc(doc(db, 'presence', uid), {
        online: true,
        lastSeen: serverTimestamp()
      }, { merge: true });
    } catch (e) { console.error('Presence setOnline error:', e); }
  }

  // Set current user offline
  async setOffline() {
    if (!authManager.currentUser) return;
    try {
      const uid = authManager.currentUser.uid;
      if (rtdb) {
        const myConnectionsRef = ref(rtdb, `presence/${uid}/online`);
        const lastOnlineRef = ref(rtdb, `presence/${uid}/lastSeen`);
        rtdbSet(myConnectionsRef, false);
        rtdbSet(lastOnlineRef, rtdbServerTimestamp());
      }
      
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
   * Watch a user's online status using RTDB.
   */
  watchUser(userId, callback) {
    this._callbacks[userId] = callback;

    if (this._statusCache[userId]) {
      callback(this._statusCache[userId]);
    }

    if (this._rtdbUnsubs[userId]) return;

    if (!rtdb) return;

    const userPresenceRef = ref(rtdb, `presence/${userId}`);
    this._rtdbUnsubs[userId] = onValue(userPresenceRef, (snap) => {
      let status;
      if (snap.exists()) {
        const data = snap.val();
        const lastSeen = data.lastSeen ? new Date(data.lastSeen) : null;
        let isOnline = data.online || false;
        
        // Safety check if heartbeat is extremely stale (e.g. 5 mins)
        if (isOnline && lastSeen && (Date.now() - lastSeen.getTime() > 300000)) {
          isOnline = false;
        }
        status = { online: isOnline, lastSeen };
      } else {
        status = { online: false, lastSeen: null };
      }
      
      this._statusCache[userId] = status;
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
    if (this._rtdbUnsubs[userId]) {
      this._rtdbUnsubs[userId]();
      delete this._rtdbUnsubs[userId];
    }
    delete this._callbacks[userId];
    delete this._statusCache[userId];
  }

  // Cleanup all listeners
  cleanup() {
    Object.values(this._rtdbUnsubs).forEach(unsub => unsub());
    this._rtdbUnsubs = {};
    this._callbacks = {};
    this._statusCache = {};
    Object.values(this.typingTimers).forEach(t => clearTimeout(t));
    this.typingTimers = {};
  }
}

export const presenceManager = new PresenceManager();
