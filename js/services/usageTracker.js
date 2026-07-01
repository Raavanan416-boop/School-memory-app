import { db, rtdb, ref, rtdbSet, onDisconnect, rtdbServerTimestamp, doc, setDoc, updateDoc, serverTimestamp } from '../firebase-config.js';
import { authManager } from '../auth.js';

class UsageTracker {
  constructor() {
    this.sessionId = null;
    this.heartbeatTimer = null;
    this.startTime = null;
    
    this._boundHandleClose = this._handleClose.bind(this);
    this._boundVisChange = this._handleVisChange.bind(this);
  }

  getDeviceInfo() {
    const ua = navigator.userAgent;
    let browser = "Unknown Browser";
    
    if (ua.includes("Firefox/")) browser = "Firefox";
    else if (ua.includes("Edg/")) browser = "Edge";
    else if (ua.includes("Chrome/")) browser = "Chrome";
    else if (ua.includes("Safari/")) browser = "Safari";
    else if (ua.includes("MSIE ") || ua.includes("Trident/")) browser = "Internet Explorer";
    
    // Determine platform
    let platform = "Unknown Platform";
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      platform = navigator.userAgentData.platform;
    } else if (navigator.platform) {
      platform = navigator.platform;
    }

    // Determine device type
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const device = isMobile ? "Mobile" : "Desktop";

    return { browser, platform, device };
  }

  async startSession() {
    if (!authManager.currentUser) return;
    
    // Check if session already started
    if (this.sessionId) return;
    
    const uid = authManager.currentUser.uid;
    const userData = authManager.userData || {};
    
    this.startTime = Date.now();
    this.sessionId = `${uid}_${this.startTime}`;
    
    const { browser, platform, device } = this.getDeviceInfo();
    
    const dateStr = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY

    try {
      // 1. Create Firestore Record
      await setDoc(doc(db, 'appUsage', this.sessionId), {
        sessionId: this.sessionId,
        uid: uid,
        userName: userData.name || authManager.currentUser.displayName || 'Unknown User',
        photoURL: userData.profilePic || userData.photoURL || authManager.currentUser.photoURL || '',
        device,
        browser,
        platform,
        loginTime: serverTimestamp(),
        loginDate: dateStr,
        loginTimeClient: this.startTime, // useful for calculating duration locally if needed
        lastActive: serverTimestamp(),
        logoutTime: null,
        totalDuration: null,
        status: "Online"
      });

      // 2. Setup RTDB onDisconnect presence mirror
      if (rtdb) {
        const presenceRef = ref(rtdb, `usagePresence/${this.sessionId}`);
        rtdbSet(presenceRef, { status: 'Online' });
        onDisconnect(presenceRef).update({
          status: 'Offline',
          logoutTime: rtdbServerTimestamp()
        });
      }

      // 3. Start Heartbeat (every 30 seconds)
      this.heartbeatTimer = setInterval(() => {
        if (!this.sessionId) return;
        updateDoc(doc(db, 'appUsage', this.sessionId), {
          lastActive: serverTimestamp()
        }).catch(() => {}); // ignore errors silently
      }, 30000);

      // 4. Attach Close Listeners
      window.addEventListener('beforeunload', this._boundHandleClose);
      window.addEventListener('pagehide', this._boundHandleClose);
      document.addEventListener('visibilitychange', this._boundVisChange);

    } catch (e) {
      console.error('[UsageTracker] Failed to start session', e);
    }
  }

  async endSession() {
    if (!this.sessionId || !this.startTime) return;
    
    const durationMs = Date.now() - this.startTime;
    const currentSessionId = this.sessionId;
    
    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    // Remove listeners
    window.removeEventListener('beforeunload', this._boundHandleClose);
    window.removeEventListener('pagehide', this._boundHandleClose);
    document.removeEventListener('visibilitychange', this._boundVisChange);

    this.sessionId = null;
    this.startTime = null;

    try {
      // 1. Update Firestore
      await updateDoc(doc(db, 'appUsage', currentSessionId), {
        status: "Offline",
        logoutTime: serverTimestamp(),
        totalDuration: durationMs
      });
      
      // 2. Update RTDB
      if (rtdb) {
        const presenceRef = ref(rtdb, `usagePresence/${currentSessionId}`);
        rtdbSet(presenceRef, { status: 'Offline', logoutTime: rtdbServerTimestamp() });
        onDisconnect(presenceRef).cancel();
      }
    } catch (e) {
      console.error('[UsageTracker] Failed to end session', e);
    }
  }

  _handleClose() {
    // This is fired when the page is unloading
    // updateDoc might get aborted, which is why we have the RTDB onDisconnect fallback
    if (this.sessionId) {
      const durationMs = Date.now() - this.startTime;
      updateDoc(doc(db, 'appUsage', this.sessionId), {
        status: "Offline",
        logoutTime: serverTimestamp(),
        totalDuration: durationMs
      }).catch(()=>{});
    }
  }

  _handleVisChange() {
    // Treat visibility hidden as a potential close, but don't fully end session,
    // just update lastActive aggressively.
    if (document.visibilityState === 'hidden' && this.sessionId) {
      updateDoc(doc(db, 'appUsage', this.sessionId), {
        lastActive: serverTimestamp()
      }).catch(()=>{});
    }
  }
}

export const usageTracker = new UsageTracker();
