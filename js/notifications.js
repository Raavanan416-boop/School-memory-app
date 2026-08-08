// Notification system — FCM push + real-time Firestore + in-app notifications
// Supports: background push, lock screen, foreground toast, badge count, dedup, delete
// Fixed: token refresh, call types, ringtone management, foreground notification
// v2: Unified SW registration, data-only payloads, robust token lifecycle
import { db, app, collection, doc, addDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, updateDoc, setDoc, serverTimestamp, getDocs } from './firebase-config.js';
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
  share: {
    title: '🚀 Memory Shared',
    bodyTemplate: (name) => `${name} shared a memory with you!`,
    getUrl: (data) => `/?page=chat&userId=${data.fromId || ''}`,
  },
  birthday_wish: {
    title: '🎂 New Birthday Wish',
    bodyTemplate: (name) => `${name} sent you a birthday wish.`,
    getUrl: (data) => `/?page=birthday&action=open_wish&wishId=${data.wishId || ''}&birthdayUserId=${data.birthdayUserId || ''}`,
  },
  birthday_reply: {
    title: '❤️ Birthday Wish Reply',
    bodyTemplate: (name) => `${name} replied to your birthday wish.`,
    getUrl: (data) => `/?page=birthday&action=open_wish&wishId=${data.wishId || ''}&birthdayUserId=${data.birthdayUserId || ''}`,
  },
  birthday_reaction: {
    title: '❤️ Birthday Reaction',
    bodyTemplate: (name, data) => `${name} reacted to your birthday wish.`,
    getUrl: (data) => `/?page=birthday&action=open_wish&wishId=${data.wishId || ''}&birthdayUserId=${data.birthdayUserId || ''}`,
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
    getUrl: (data) => `/?page=timecapsule&capsuleId=${data.capsuleId || ''}`,
  },
  // Backward compat alias (old notifications may have this type)
  capsule_unlock: {
    title: '📦 Time Capsule Opened',
    bodyTemplate: () => `Your memory capsule is ready.`,
    getUrl: (data) => `/?page=timecapsule&capsuleId=${data.capsuleId || ''}`,
  },
  capsule_message: {
    title: '💬 Capsule Comment',
    bodyTemplate: (name) => `${name} commented on your Time Capsule.`,
    getUrl: (data) => `/?page=timecapsule&capsuleId=${data.capsuleId || ''}`,
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
    bodyTemplate: (name) => `${name} published a new diary entry.`,
    getUrl: (data) => `/?page=diary&entryId=${data.diaryId || ''}`,
  },
  new_memory: {
    title: '📸 New Memory',
    bodyTemplate: (name) => `${name} added a new memory.`,
    getUrl: (data) => `/?page=home&postId=${data.postId || ''}`,
  },
  admin_announcement: {
    title: '📢 Announcement',
    bodyTemplate: () => `New announcement from admin.`,
    getUrl: () => `/?page=home`,
  },
  // Call notifications
  voice_call_incoming: {
    title: '📞 Incoming Voice Call',
    bodyTemplate: (name) => `Incoming voice call from ${name}`,
    getUrl: () => `/?page=chat`,
  },
  video_call_incoming: {
    title: '📹 Incoming Video Call',
    bodyTemplate: (name) => `Incoming video call from ${name}`,
    getUrl: () => `/?page=chat`,
  },
  missed_voice_call: {
    title: '📵 Missed Voice Call',
    bodyTemplate: (name) => `Missed voice call from ${name}`,
    getUrl: (data) => `/?page=chat&userId=${data.fromId || ''}`,
  },
  missed_video_call: {
    title: '📵 Missed Video Call',
    bodyTemplate: (name) => `Missed video call from ${name}`,
    getUrl: (data) => `/?page=chat&userId=${data.fromId || ''}`,
  },
  // Legacy call type (for backwards compatibility)
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
  tag_request: {
    title: '📸 Tag Request',
    bodyTemplate: (name) => `${name} tagged you in a memory. Approve to add to your profile.`,
    getUrl: (data) => `/?page=home&postId=${data.postId || ''}`,
  },
  tag_accepted: {
    title: '✅ Tag Accepted',
    bodyTemplate: (name) => `${name} accepted your tag.`,
    getUrl: (data) => `/?page=home&postId=${data.postId || ''}`,
  },
  tag_declined: {
    title: '❌ Tag Declined',
    bodyTemplate: (name) => `${name} declined your tag.`,
    getUrl: (data) => `/?page=home&postId=${data.postId || ''}`,
  },
  miss_you: {
    title: '❤️ Someone Misses You',
    bodyTemplate: (name) => `${name} misses you ❤️🥺`,
    getUrl: (data) => `/?page=profile&userId=${data.fromId || ''}`,
  },
  slambook_share: {
    title: '📖 Slam Book Shared',
    bodyTemplate: (name) => `${name} shared a Slam Book with you!`,
    getUrl: (data) => `/?page=profile&userId=${data.fromId || ''}&tab=slambook`,
  },
  slambook_response: {
    title: '✍️ Slam Book Signed',
    bodyTemplate: (name) => `${name} wrote in your Slam Book!`,
    getUrl: (data) => `/?page=profile&tab=slambook`,
  },
  slambook_pinned: {
    title: '📌 Response Pinned',
    bodyTemplate: (name) => `${name} pinned your Slam Book response!`,
    getUrl: (data) => `/?page=profile&userId=${data.fromId || ''}&tab=slambook`,
  },
  friend_request: {
    title: '👋 Friend Request',
    bodyTemplate: (name) => `${name} sent you a friend request.`,
    getUrl: (data) => `/?page=profile&userId=${data.fromId || ''}`,
  },
  friend_accepted: {
    title: '✅ Request Accepted',
    bodyTemplate: (name) => `${name} accepted your friend request.`,
    getUrl: (data) => `/?page=profile&userId=${data.fromId || ''}`,
  },
  group_message: {
    title: '👥 Group Message',
    bodyTemplate: (name) => `${name} sent a message to the group.`,
    getUrl: (data) => `/?page=chat&groupId=${data.groupId || ''}`,
  },
  poll_vote: {
    title: '📊 Poll Vote',
    bodyTemplate: (name) => `${name} voted in your poll.`,
    getUrl: (data) => `/?page=polls&id=${data.pollId || ''}`,
  },
  screenshot_alert: {
    title: '📸 Screenshot Alert',
    bodyTemplate: (name, data) => `${name} took a screenshot${data.screenshotPage ? ' on ' + data.screenshotPage : ''}.`,
    getUrl: () => `/?page=home`,
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
    this._ringtoneAudio = null;
    this._soundUnlocked = false;
    this._tokenRefreshInterval = null;
    this._swRegistration = null;
    this._fcmInitialized = false; // Prevent double init
  }

  onChange(cb) { this.listeners.push(cb); }
  _notify() { this.listeners.forEach(cb => cb(this.unreadCount, this.notifications)); }

  setBadgeElement(el) { this.badgeElement = el; }

  // ===== FCM INITIALIZATION =====

  async initFCM() {
    // Prevent double initialization
    if (this._fcmInitialized) {
      console.log('[Notifications] FCM already initialized, skipping');
      return this._swRegistration;
    }

    try {
      if (!('serviceWorker' in navigator)) {
        console.warn('[Notifications] Service Workers not supported');
        return null;
      }

      // Register the SOLE service worker
      console.log('[Notifications] Registering firebase-messaging-sw.js...');
      let swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/'
      });
      console.log('[Notifications] SW registered, scope:', swReg.scope);

      // Wait for it to become active
      if (swReg.installing) {
        console.log('[Notifications] SW is installing, waiting for activation...');
        await new Promise((resolve, reject) => {
          const sw = swReg.installing;
          sw.addEventListener('statechange', function handler(e) {
            console.log('[Notifications] SW state changed to:', e.target.state);
            if (e.target.state === 'activated') {
              resolve();
              e.target.removeEventListener('statechange', handler);
            }
            if (e.target.state === 'redundant') {
              reject(new Error('SW became redundant'));
              e.target.removeEventListener('statechange', handler);
            }
          });
          setTimeout(() => resolve(), 10000); // Timeout fallback
        });
      } else if (swReg.waiting) {
        console.log('[Notifications] SW is waiting, sending SKIP_WAITING...');
        swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
        await new Promise(resolve => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }

      // Re-fetch registration to get the active one
      swReg = await navigator.serviceWorker.getRegistration('/');
      if (!swReg || !swReg.active) {
        console.warn('[Notifications] SW not active after registration');
        return null;
      }

      this._swRegistration = swReg;
      console.log('[Notifications] SW is active:', swReg.active.scriptURL);

      // Verify push subscription
      const pushSub = await swReg.pushManager.getSubscription();
      if (pushSub) {
        console.log('[Notifications] Push subscription exists:', pushSub.endpoint.substring(0, 60) + '...');
      } else {
        console.log('[Notifications] No push subscription yet — will be created when token is requested');
      }

      // Dynamic import of Firebase Messaging
      const { getMessaging, getToken, onMessage } = await import(
        'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js'
      );

      this._messaging = getMessaging(app);
      console.log('[Notifications] Firebase Messaging initialized');

      // Handle foreground messages — show in-app toast only (no system notification)
      onMessage(this._messaging, (payload) => {
        console.log('[Notifications] 📩 Foreground message received:', JSON.stringify(payload));
        const data = payload.data || {};
        const notifPayload = payload.notification || {};
        const type = data.type || 'general';

        // For incoming calls in foreground, don't show toast — the call UI handles it
        if (type === 'voice_call_incoming' || type === 'video_call_incoming') {
          console.log('[Notifications] Call notification in foreground — call UI will handle');
          return;
        }

        // Show in-app toast + sound only (no system notification to avoid duplicates)
        this._showForegroundNotification({
          title: data.title || notifPayload.title || '📸 Class Memories',
          body: data.body || notifPayload.body || 'New notification',
          type: type,
          targetUrl: data.targetUrl || '/',
          notifId: data.notifId || '',
          fromName: data.fromName || '',
        });
      });

      // Listen for notification clicks from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NOTIFICATION_CLICK') {
          this._handleNotificationClick(event.data.url, event.data.notifId);
        }
        if (event.data?.type === 'ACCEPT_CALL') {
          this._handleCallAcceptFromNotification(event.data);
        }
        if (event.data?.type === 'REJECT_CALL') {
          this._handleCallRejectFromNotification(event.data);
        }
      });

      this._fcmInitialized = true;
      console.log('[Notifications] ✅ FCM fully initialized');
      return swReg;
    } catch (e) {
      console.error('[Notifications] FCM init failed:', e);
      return null;
    }
  }

  // Handle call accept from push notification action
  _handleCallAcceptFromNotification(data) {
    import('./calls.js').then(({ callManager }) => {
      if (callManager.onIncomingCall) {
        callManager.onIncomingCall({
          id: data.callId,
          callerId: data.callerId,
          callerName: data.callerName,
          type: 'voice',
          autoAccept: true
        });
      }
    }).catch(console.error);
  }

  // Handle call reject from push notification action
  _handleCallRejectFromNotification(data) {
    import('./calls.js').then(({ callManager }) => {
      callManager.rejectCall(data.callId);
    }).catch(console.error);
  }

  // Request push notification permission + get FCM token
  async requestPushPermission() {
    if (!('Notification' in window)) return 'denied';

    try {
      const permission = await Notification.requestPermission();
      this.pushPermission = permission;
      console.log('[Notifications] Permission result:', permission);

      if (permission === 'granted') {
        await this._registerFCMToken();
        this._startTokenRefresh();
      }
      return permission;
    } catch (e) {
      console.error('[Notifications] Push permission error:', e);
      return 'denied';
    }
  }

  // Register FCM token and save to Firestore + localStorage
  async _registerFCMToken() {
    if (!this._messaging || !authManager.currentUser) {
      console.log('[Notifications] Cannot register token — messaging or user not ready');
      return;
    }

    try {
      const { getToken } = await import(
        'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js'
      );

      let swReg = this._swRegistration || await navigator.serviceWorker.getRegistration('/');
      if (!swReg) {
        console.warn('[Notifications] No SW registration found');
        return;
      }

      // Wait for SW to be active
      if (!swReg.active) {
        console.log('[Notifications] Waiting for SW to activate...');
        await new Promise((resolve, reject) => {
          const sw = swReg.installing || swReg.waiting;
          if (!sw) { reject(new Error('No SW installing/waiting')); return; }
          sw.addEventListener('statechange', function handler(e) {
            if (e.target.state === 'activated') {
              resolve();
              e.target.removeEventListener('statechange', handler);
            }
            if (e.target.state === 'redundant') {
              reject(new Error('SW became redundant'));
              e.target.removeEventListener('statechange', handler);
            }
          });
          setTimeout(() => reject(new Error('SW activation timeout')), 10000);
        });
      }

      // Verify push subscription exists
      let pushSub = await swReg.pushManager.getSubscription();
      if (!pushSub) {
        console.log('[Notifications] No push subscription — getToken will create one');
      }

      const VAPID_KEY = 'BB2IVcpFQwoPKSYh7PdqMIyB7Zl8xjFxlmRTGVTDehFTzsGZiFwvlez9O4BxuPCSfyt_VG8N3FS65pqliTYH3wY';

      console.log('[Notifications] Requesting FCM token...');
      const token = await getToken(this._messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swReg,
      }).catch((err) => {
        console.error('[Notifications] ❌ Token generation failed:', err);
        return null;
      });

      if (token && authManager.currentUser) {
        const oldToken = localStorage.getItem('fcmToken');

        // Save to localStorage
        localStorage.setItem('fcmToken', token);
        console.log('[Notifications] Token saved to localStorage');

        // Only write to Firestore if token changed
        if (token !== oldToken) {
          console.log('[Notifications] Token changed, updating Firestore...');
          await setDoc(doc(db, 'users', authManager.currentUser.uid), {
            fcmToken: token,
            pushEnabled: true,
            fcmTokenUpdatedAt: serverTimestamp(),
          }, { merge: true });
          console.log('[Notifications] ✅ FCM Token saved to Firestore');
        } else {
          console.log('[Notifications] Token unchanged, skipping Firestore write');
        }

        // Log the push subscription for debugging
        const sub = await swReg.pushManager.getSubscription();
        if (sub) {
          console.log('[Notifications] Push subscription endpoint:', sub.endpoint.substring(0, 80) + '...');
        }

        console.log('[Notifications] ✅ FCM Token:', token.substring(0, 30) + '...');
      } else if (!token) {
        console.warn('[Notifications] ❌ No token returned');
      }
    } catch (e) {
      console.error('[Notifications] FCM token registration failed:', e.message);
      console.error('[Notifications] Stack:', e.stack);
    }
  }

  // Periodically refresh FCM token (Google rotates tokens)
  _startTokenRefresh() {
    if (this._tokenRefreshInterval) clearInterval(this._tokenRefreshInterval);
    this._tokenRefreshInterval = setInterval(() => {
      console.log('[Notifications] Periodic token refresh...');
      this._registerFCMToken();
    }, 6 * 60 * 60 * 1000); // Every 6 hours
  }

  _stopTokenRefresh() {
    if (this._tokenRefreshInterval) {
      clearInterval(this._tokenRefreshInterval);
      this._tokenRefreshInterval = null;
    }
  }

  // Remove FCM token on logout
  async removeFCMToken() {
    this._stopTokenRefresh();
    localStorage.removeItem('fcmToken');
    if (!authManager.currentUser) return;
    try {
      await updateDoc(doc(db, 'users', authManager.currentUser.uid), {
        fcmToken: null,
        pushEnabled: false,
      });
      console.log('[Notifications] FCM token removed from Firestore');
    } catch (e) { /* non-critical */ }
  }

  // ===== NOTIFICATION LISTENING =====

  // Start listening for notifications in real-time
  startListening() {
    if (!authManager.currentUser) return;
    if (this.unsubscribe) this.unsubscribe();

    // Request push permission if not yet granted
    if ('Notification' in window && Notification.permission === 'default') {
      // Request permission after a short delay (not too aggressive)
      setTimeout(() => this.requestPushPermission(), 3000);
    } else if ('Notification' in window && Notification.permission === 'granted') {
      // Already granted — ensure token is fresh
      this._registerFCMToken();
      this._startTokenRefresh();
    }
    this.pushPermission = 'Notification' in window ? Notification.permission : 'denied';

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', authManager.currentUser.uid)
    );

    this.unsubscribe = onSnapshot(q, (snap) => {
      const prevCount = this.notifications.length;
      const prevIds = new Set(this.notifications.map(n => n.id));
      
      // Get all docs, sort locally, take top 100
      let allDocs = [];
      snap.forEach(d => allDocs.push({ id: d.id, ...d.data() }));
      allDocs.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });
      
      this.notifications = allDocs.slice(0, 100);
      
      this.unreadCount = 0;
      this.notifications.forEach(notif => {
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
            // Don't show toast for call notifications — call UI handles those
            const callTypes = ['voice_call_incoming', 'video_call_incoming', 'call_incoming'];
            if (!callTypes.includes(newest.type)) {
              this._showInAppNotification(newest);
              this._playNotificationSound();
            }
          } else {
            // FALLBACK: App is in background tab! Show system notification locally (Bypasses the need for Firebase Blaze!)
            if ('Notification' in window && Notification.permission === 'granted') {
              navigator.serviceWorker.ready.then(reg => {
                const title = newest.title || this._getNotificationTitle(newest);
                const body = newest.body || this._getNotificationText(newest);
                const url = newest.targetUrl || this._getNotificationUrl(newest);
                
                reg.showNotification(title, {
                  body: body,
                  icon: '/icons/icon-192.png',
                  badge: '/icons/icon-192.png',
                  vibrate: [200, 100, 200, 100, 200],
                  tag: 'local-' + newest.id,
                  data: { url: url, notifId: newest.id }
                });
                this._playNotificationSound();
              }).catch(e => console.error('Fallback notification failed:', e));
            }
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
    this._stopTokenRefresh();
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
    const displayText = data.fromName ? `${data.fromName}: ${data.body}` : (data.body || 'New notification');
    showToast(displayText, 'info');
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

  // ===== INCOMING CALL RINGTONE =====

  // Play a ringtone that loops until stopped (for incoming calls)
  playIncomingRingtone() {
    this.stopIncomingRingtone(); // Stop any existing ringtone

    try {
      // Try notification.mp3 as ringtone first (looped)
      this._ringtoneAudio = new Audio('/assets/notification.mp3');
      this._ringtoneAudio.loop = true;
      this._ringtoneAudio.volume = 0.8;
      this._ringtoneAudio.play().catch(() => {
        // Fallback: synthesized ringtone using Web Audio API
        this._playSynthRingtone();
      });
    } catch (e) {
      this._playSynthRingtone();
    }

    // Also vibrate if supported (WhatsApp-style vibration pattern)
    if (navigator.vibrate) {
      this._vibrationInterval = setInterval(() => {
        navigator.vibrate([500, 200, 500, 200, 500]);
      }, 2000);
    }
  }

  // Synthesized ringtone using Web Audio API (fallback)
  _playSynthRingtone() {
    try {
      this._ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._ringtoneCtx;
      
      // Attempt to resume immediately in case it was suspended
      ctx.resume().catch(() => {});

      const playRingCycle = () => {
        if (!this._ringtoneCtx) return;
        const now = ctx.currentTime;

        // Classic phone ring pattern: two quick tones
        const ringNotes = [
          { freq: 440, start: 0, dur: 0.4 },
          { freq: 480, start: 0, dur: 0.4 },
          { freq: 440, start: 0.6, dur: 0.4 },
          { freq: 480, start: 0.6, dur: 0.4 },
        ];

        ringNotes.forEach(n => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(n.freq, now + n.start);
          gain.gain.setValueAtTime(0, now + n.start);
          gain.gain.linearRampToValueAtTime(0.15, now + n.start + 0.02);
          gain.gain.setValueAtTime(0.15, now + n.start + n.dur - 0.02);
          gain.gain.linearRampToValueAtTime(0, now + n.start + n.dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + n.start);
          osc.stop(now + n.start + n.dur);
        });
      };

      playRingCycle();
      this._ringtoneRepeat = setInterval(playRingCycle, 2000);
    } catch (e) { /* Web Audio not supported */ }
  }

  // ===== OUTGOING DIAL TONE =====
  playDialTone() {
    this.stopIncomingRingtone();
    try {
      this._ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._ringtoneCtx;
      ctx.resume().catch(() => {});

      const playDialCycle = () => {
        if (!this._ringtoneCtx) return;
        const now = ctx.currentTime;
        
        // Classic European/UK dial ringing tone: 400Hz + 450Hz, 0.4s on, 0.2s off, 0.4s on, 2s off
        [400, 450].forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          
          gain.gain.setValueAtTime(0, now);
          // First ring
          gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
          gain.gain.setValueAtTime(0.1, now + 0.35);
          gain.gain.linearRampToValueAtTime(0, now + 0.4);
          // Second ring
          gain.gain.setValueAtTime(0, now + 0.6);
          gain.gain.linearRampToValueAtTime(0.1, now + 0.65);
          gain.gain.setValueAtTime(0.1, now + 0.95);
          gain.gain.linearRampToValueAtTime(0, now + 1.0);
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 1.0);
        });
      };
      
      playDialCycle();
      this._ringtoneRepeat = setInterval(playDialCycle, 3000);
    } catch (e) {}
  }

  // Stop the incoming call ringtone
  stopIncomingRingtone() {
    if (this._ringtoneAudio) {
      this._ringtoneAudio.pause();
      this._ringtoneAudio.currentTime = 0;
      this._ringtoneAudio = null;
    }
    if (this._ringtoneCtx) {
      this._ringtoneCtx.close().catch(() => {});
      this._ringtoneCtx = null;
    }
    if (this._ringtoneRepeat) {
      clearInterval(this._ringtoneRepeat);
      this._ringtoneRepeat = null;
    }
    if (this._vibrationInterval) {
      clearInterval(this._vibrationInterval);
      this._vibrationInterval = null;
    }
    // Stop vibration
    if (navigator.vibrate) {
      navigator.vibrate(0);
    }
  }

  // Close incoming call push notification (when handled in-app)
  closeCallNotification(callId) {
    if (!callId) return;
    navigator.serviceWorker.getRegistration('/').then(reg => {
      if (reg && reg.active) {
        reg.active.postMessage({
          type: 'CLOSE_CALL_NOTIFICATION',
          callId: callId
        });
      }
    }).catch(() => {});
  }

  // ===== CLICK HANDLING / DEEP LINKS =====

  _handleNotificationClick(url, notifId) {
    // Automatically mark notification as read when clicked
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
      await updateDoc(doc(db, 'notifications', notifId), { 
        read: true,
        readAt: serverTimestamp()
      });
    } catch (e) { console.error('Mark read error:', e); }
  }

  async markAllRead() {
    if (!authManager.currentUser) return;
    try {
      const unread = this.notifications.filter(n => !n.read);
      await Promise.all(unread.map(n =>
        updateDoc(doc(db, 'notifications', n.id), { 
          read: true,
          readAt: serverTimestamp()
        })
      ));
    } catch (e) { console.error('Mark all read error:', e); }
  }

  async markRelatedAsRead(criteria) {
    if (!authManager.currentUser) return;
    try {
      // Find all unread notifications matching criteria
      const unreadMatch = this.notifications.filter(n => {
        if (n.read) return false;
        for (const [key, value] of Object.entries(criteria)) {
          if (n[key] !== value) return false;
        }
        return true;
      });
      
      if (unreadMatch.length === 0) return;
      
      await Promise.all(unreadMatch.map(n => 
        updateDoc(doc(db, 'notifications', n.id), { 
          read: true, 
          readAt: serverTimestamp() 
        })
      ));
    } catch (e) { console.error('Mark related read error:', e); }
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

  async clearChatNotifications(chatId) {
    if (!authManager.currentUser || !chatId) return;
    try {
      // Mark as read instead of deleting to keep history intact
      await this.markRelatedAsRead({ type: 'chat_message', chatId: chatId });
    } catch (e) { console.error('Clear chat notifs error:', e); }
  }

  async clearCallNotification(callId) {
    if (!authManager.currentUser || !callId) return;
    try {
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', authManager.currentUser.uid),
        where('callId', '==', callId)
      );
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } catch (e) { console.error('Clear call notifs error:', e); }
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
    // For calls, use callId as the dedup key
    const dedupKey = data.deduplicationKey ||
      data.callId ||
      `${type}_${authManager.currentUser.uid}_${targetUserId}_${data.postId || data.pollId || data.capsuleId || (type === 'chat_message' ? Date.now() : '')}`;

    // Check for existing duplicate within last 60 seconds (skip for calls — they need to be fast)
    const isCallType = type.includes('call');
    if (!isCallType) {
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
    }

    // Create the notification document
    // This triggers the Cloud Function which sends the FCM push
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
