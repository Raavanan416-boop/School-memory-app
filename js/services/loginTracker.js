import { db, collection, doc, setDoc, updateDoc, serverTimestamp, rtdb, ref, onDisconnect, rtdbSet } from '../firebase-config.js';
import { authManager } from '../auth.js';

class LoginTracker {
  constructor() {
    this.sessionId = null;
    this.sessionRef = null;
    this.presenceRef = null;
    this.heartbeatTimer = null;
    this.loginTimeClient = null;
    
    // Bind to window close events for graceful exit
    window.addEventListener('beforeunload', () => this.endSession());
    window.addEventListener('pagehide', () => this.endSession());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.endSession();
      } else if (authManager.currentUser) {
        this.startSession();
      }
    });
  }

  getBrowserInfo() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
    else if (ua.includes('Firefox/')) browser = 'Firefox';

    let os = 'Unknown OS';
    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('X11')) os = 'UNIX';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';

    let device = 'Desktop';
    if (/Mobile|Android|iPhone|iPad/i.test(ua)) device = 'Mobile';

    return { browser, os, device };
  }

  async startSession() {
    if (!authManager.currentUser) return;
    if (this.sessionId) return; // already active

    this.sessionId = 'sesh_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    this.loginTimeClient = Date.now();
    const uid = authManager.currentUser.uid;
    const userData = authManager.userData || {};

    const { browser, os, device } = this.getBrowserInfo();
    const userAgentStr = navigator.userAgent;

    this.sessionRef = doc(db, 'loginHistory', uid, 'sessions', this.sessionId);
    
    const sessionData = {
      sessionId: this.sessionId,
      uid: uid,
      name: userData.fullName || authManager.currentUser.email || 'Unknown',
      photo: userData.photoURL || '',
      email: authManager.currentUser.email || '',
      loginTime: serverTimestamp(),
      loginTimeClient: this.loginTimeClient,
      logoutTime: null,
      duration: '',
      durationSeconds: 0,
      device: device,
      browser: browser,
      os: os,
      userAgent: userAgentStr,
      status: 'Online',
      lastActive: serverTimestamp(),
      createdAt: serverTimestamp()
    };

    try {
      await setDoc(this.sessionRef, sessionData);

      // Setup RTDB onDisconnect hook for hard crashes
      if (rtdb) {
        this.presenceRef = ref(rtdb, `loginPresence/${this.sessionId}`);
        await onDisconnect(this.presenceRef).set({
          status: 'Offline',
          logoutTime: { '.sv': 'timestamp' },
          uid: uid
        });
        await rtdbSet(this.presenceRef, { status: 'Online', uid: uid });
      }

      // Start heartbeat
      this.heartbeatTimer = setInterval(() => this._heartbeat(), 30000);

    } catch (e) {
      console.error('[LoginTracker] Failed to start session:', e);
      this.sessionId = null;
      this.sessionRef = null;
    }
  }

  _formatDuration(ms) {
    if (!ms || ms < 0) return '0 Seconds';
    const totalSecs = Math.floor(ms / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    
    let parts = [];
    if (h > 0) parts.push(`${h} Hour${h !== 1 ? 's' : ''}`);
    if (m > 0) parts.push(`${m} Minute${m !== 1 ? 's' : ''}`);
    if (s > 0 || parts.length === 0) parts.push(`${s} Second${s !== 1 ? 's' : ''}`);
    
    return parts.join(' ');
  }

  async _heartbeat() {
    if (!this.sessionRef) return;
    try {
      // Fire and forget
      updateDoc(this.sessionRef, { lastActive: serverTimestamp() });
    } catch (e) { /* silent */ }
  }

  async endSession() {
    if (!this.sessionId || !this.sessionRef) return;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const durationMs = Date.now() - this.loginTimeClient;
    const durationText = this._formatDuration(durationMs);
    const durationSecs = Math.floor(durationMs / 1000);

    const dataToUpdate = {
      logoutTime: serverTimestamp(),
      status: 'Offline',
      duration: durationText,
      durationSeconds: durationSecs,
      lastActive: serverTimestamp()
    };

    try {
      // Best effort update
      updateDoc(this.sessionRef, dataToUpdate);

      if (this.presenceRef) {
        onDisconnect(this.presenceRef).cancel();
        rtdbSet(this.presenceRef, { status: 'Offline', logoutTime: Date.now(), uid: authManager.currentUser?.uid });
      }
    } catch(e) { /* silent on page unload */ }

    this.sessionId = null;
    this.sessionRef = null;
    this.presenceRef = null;
  }
}

export const loginTracker = new LoginTracker();
