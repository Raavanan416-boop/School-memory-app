// Screenshot Detection System
// Detects screenshot keyboard shortcuts, logs activity to Firebase,
// shows warning animation, and sends notifications to owner/all users.
// Does NOT access or upload screenshot images — only detects the event.

import { db, doc, getDoc, setDoc, addDoc, collection, getDocs, query, where,
  serverTimestamp, onSnapshot, orderBy } from '../firebase-config.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { showToast } from '../utils.js';

// Owner email for identifying the owner user
const OWNER_EMAIL = 'kaviraj@school.com';

// Map router page IDs to friendly display names
const PAGE_NAME_MAP = {
  home: 'Home',
  diary: 'Story Book',
  slambook: 'Question Book',
  upload: 'Posts',
  chat: 'Chat',
  search: 'Gallery',
  notifications: 'Memories',
  profile: 'Profile',
  birthday: 'Birthday Intro',
  // Friendship intro is handled separately (it's a modal, not a routed page)
};

// Pages where screenshot detection is active
const MONITORED_PAGES = [
  'home', 'diary', 'slambook', 'upload', 'chat',
  'search', 'notifications', 'profile', 'birthday'
];

class ScreenshotDetector {
  constructor() {
    this._initialized = false;
    this._cooldown = false; // Prevent rapid-fire detections
    this._boundKeyHandler = null;
    this._settingsCache = null;
    this._settingsCacheTime = 0;
  }

  /**
   * Initialize screenshot detection. Call after user is logged in.
   */
  init() {
    if (this._initialized) return;
    if (!authManager.currentUser) {
      console.log('[ScreenshotDetector] No user logged in, skipping init');
      return;
    }

    this._initialized = true;
    this._boundKeyHandler = this._onKeyDown.bind(this);

    // Listen for screenshot keyboard shortcuts
    document.addEventListener('keydown', this._boundKeyHandler, true);

    // Some browsers fire beforeprint on screenshot (rare but worth catching)
    window.addEventListener('afterprint', () => this._onScreenshotDetected('print_event'));

    console.log('[ScreenshotDetector] ✅ Initialized for user:', authManager.userData?.fullName);
  }

  /**
   * Destroy listeners (call on logout)
   */
  destroy() {
    if (this._boundKeyHandler) {
      document.removeEventListener('keydown', this._boundKeyHandler, true);
      this._boundKeyHandler = null;
    }
    this._initialized = false;
    this._settingsCache = null;
    console.log('[ScreenshotDetector] Destroyed');
  }

  /**
   * Keyboard handler — detects common screenshot key combos
   */
  _onKeyDown(e) {
    const key = e.key || '';
    const code = e.code || '';

    let isScreenshot = false;

    // Windows: PrintScreen key
    if (key === 'PrintScreen' || code === 'PrintScreen') {
      isScreenshot = true;
    }

    // Windows: Win+Shift+S (Snipping Tool) — key is 'S' with Meta+Shift
    if ((e.metaKey || e.getModifierState?.('OS')) && e.shiftKey && (key === 's' || key === 'S')) {
      isScreenshot = true;
    }

    // Mac: Cmd+Shift+3 (full screenshot)
    if (e.metaKey && e.shiftKey && (key === '3' || code === 'Digit3')) {
      isScreenshot = true;
    }

    // Mac: Cmd+Shift+4 (area screenshot)
    if (e.metaKey && e.shiftKey && (key === '4' || code === 'Digit4')) {
      isScreenshot = true;
    }

    // Mac: Cmd+Shift+5 (screenshot toolbar)
    if (e.metaKey && e.shiftKey && (key === '5' || code === 'Digit5')) {
      isScreenshot = true;
    }

    // Ctrl+Shift+S (some tools use this)
    if (e.ctrlKey && e.shiftKey && (key === 's' || key === 'S') && !e.metaKey) {
      isScreenshot = true;
    }

    if (isScreenshot) {
      this._onScreenshotDetected('keyboard_' + (code || key));
    }
  }

  /**
   * Core handler when a screenshot is detected
   */
  async _onScreenshotDetected(method) {
    // Cooldown: ignore rapid-fire events (3 second window)
    if (this._cooldown) return;
    this._cooldown = true;
    setTimeout(() => { this._cooldown = false; }, 3000);

    const currentPage = router.getCurrentPage();
    if (!currentPage || !MONITORED_PAGES.includes(currentPage)) {
      console.log('[ScreenshotDetector] Not a monitored page:', currentPage);
      return;
    }

    if (!authManager.currentUser || !authManager.userData) return;

    const pageName = PAGE_NAME_MAP[currentPage] || currentPage;
    const userName = authManager.userData.fullName || 'Unknown User';
    const userId = authManager.currentUser.uid;
    const userPhoto = authManager.userData.profilePic || authManager.userData.photoURL || '';
    const contentTitle = this._getContentTitle(currentPage);
    const now = new Date();

    console.log(`[ScreenshotDetector] 📸 Screenshot detected! User: ${userName}, Page: ${pageName}, Method: ${method}`);

    // 1. Show warning animation immediately
    this._showWarningAnimation();

    // 2. Log to Firebase (non-blocking)
    this._logToFirebase({ userId, userName, userPhoto, pageName, pageId: currentPage, contentTitle, now });

    // 3. Send notifications (non-blocking)
    this._sendNotifications({ userId, userName, userPhoto, pageName, contentTitle, now });
  }

  /**
   * Try to extract content title from the current page
   */
  _getContentTitle(pageId) {
    try {
      // Try to find a prominent title on the current page
      const container = document.getElementById('page-container');
      if (!container) return '';

      // Common patterns for content titles
      const selectors = [
        'h1', 'h2', '.post-caption', '.story-title', '.memory-title',
        '.chat-header-name', '.diary-title', '[data-content-title]'
      ];

      for (const sel of selectors) {
        const el = container.querySelector(sel);
        if (el && el.textContent.trim()) {
          const text = el.textContent.trim();
          // Don't return navigation items or very long text
          if (text.length > 2 && text.length < 100) {
            return text;
          }
        }
      }
    } catch (e) { /* non-critical */ }
    return '';
  }

  /**
   * Show the red warning animation overlay
   */
  _showWarningAnimation() {
    // Don't show duplicate warnings
    if (document.querySelector('.screenshot-warning-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'screenshot-warning-overlay';
    overlay.innerHTML = `
      <div class="screenshot-warning-content">
        <div class="screenshot-warning-icon">⚠️</div>
        <h3 class="screenshot-warning-title">This is a School Memory App</h3>
        <p class="screenshot-warning-text">Please don't take screenshots.</p>
        <p class="screenshot-warning-subtext">Respect everyone's memories. ❤️</p>
      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      overlay.classList.add('screenshot-warning-visible');
    });

    // Auto-hide after 3 seconds
    setTimeout(() => {
      overlay.classList.add('screenshot-warning-hiding');
      setTimeout(() => {
        overlay.remove();
      }, 500);
    }, 3000);
  }

  /**
   * Log screenshot event to Firebase
   */
  async _logToFirebase({ userId, userName, userPhoto, pageName, pageId, contentTitle, now }) {
    try {
      await addDoc(collection(db, 'screenshotActivity'), {
        userId,
        userName,
        userPhoto,
        pageName,
        pageId,
        contentTitle: contentTitle || '',
        date: now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        timestamp: serverTimestamp(),
        deviceInfo: navigator.userAgent.substring(0, 100)
      });
      console.log('[ScreenshotDetector] Activity logged to Firebase');
    } catch (e) {
      console.error('[ScreenshotDetector] Failed to log activity:', e);
    }
  }

  /**
   * Fetch screenshot alert mode setting from Firebase (with 30-second cache)
   */
  async _getAlertMode() {
    // Use cached value if fresh (within 30 seconds)
    if (this._settingsCache !== null && (Date.now() - this._settingsCacheTime) < 30000) {
      return this._settingsCache;
    }

    try {
      const settingsRef = doc(db, 'settings', 'features');
      const snap = await getDoc(settingsRef);
      if (snap.exists()) {
        this._settingsCache = snap.data().screenshotAlertMode ?? false;
      } else {
        this._settingsCache = false;
      }
      this._settingsCacheTime = Date.now();
      return this._settingsCache;
    } catch (e) {
      console.error('[ScreenshotDetector] Failed to fetch settings:', e);
      return false;
    }
  }

  /**
   * Send notifications — owner always, all users if alert mode is ON
   */
  async _sendNotifications({ userId, userName, userPhoto, pageName, contentTitle, now }) {
    try {
      const alertMode = await this._getAlertMode();
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      // Find the owner user ID
      const ownerUid = await this._getOwnerUid();
      if (!ownerUid) {
        console.warn('[ScreenshotDetector] Could not find owner UID');
        return;
      }

      // Don't send notification to yourself
      const isOwner = (userId === ownerUid);

      // Always send to owner (unless the owner took the screenshot)
      if (!isOwner) {
        await this._createNotification(ownerUid, {
          type: 'screenshot_alert',
          fromId: userId,
          fromName: userName,
          fromPhoto: userPhoto,
          title: '📸 Screenshot Alert',
          body: `${userName} took a screenshot on ${pageName}.`,
          targetUrl: '/?page=owner',
          screenshotPage: pageName,
          screenshotContent: contentTitle || '',
          screenshotTime: timeStr,
          read: false,
          createdAt: serverTimestamp()
        });
      }

      // If alert mode is ON, notify ALL other users
      if (alertMode) {
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          const batch = [];
          usersSnap.forEach(userDoc => {
            const uid = userDoc.id;
            // Skip the screenshot taker and the owner (already notified)
            if (uid === userId || uid === ownerUid) return;

            batch.push(this._createNotification(uid, {
              type: 'screenshot_alert',
              fromId: userId,
              fromName: userName,
              fromPhoto: userPhoto,
              title: '📸 Screenshot Alert',
              body: `${userName} took a screenshot on ${pageName}.`,
              targetUrl: '/',
              screenshotPage: pageName,
              screenshotContent: contentTitle || '',
              screenshotTime: timeStr,
              read: false,
              createdAt: serverTimestamp()
            }));
          });

          // Send in parallel (fire-and-forget)
          await Promise.allSettled(batch);
          console.log(`[ScreenshotDetector] Sent alert to ${batch.length} users (alert mode ON)`);
        } catch (e) {
          console.error('[ScreenshotDetector] Failed to send broadcast alerts:', e);
        }
      }
    } catch (e) {
      console.error('[ScreenshotDetector] Notification error:', e);
    }
  }

  /**
   * Create a single notification document
   */
  async _createNotification(targetUserId, data) {
    try {
      await addDoc(collection(db, 'notifications'), {
        userId: targetUserId,
        ...data
      });
    } catch (e) {
      console.error('[ScreenshotDetector] Create notification error:', e);
    }
  }

  /**
   * Find the owner's user ID by email
   */
  async _getOwnerUid() {
    // Check if current user is the owner
    if (authManager.currentUser?.email?.toLowerCase() === OWNER_EMAIL) {
      return authManager.currentUser.uid;
    }

    // Query for owner by email
    try {
      const q = query(collection(db, 'users'), where('email', '==', OWNER_EMAIL));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs[0].id;
      }

      // Fallback: check all users for the owner email pattern
      const allSnap = await getDocs(collection(db, 'users'));
      let ownerUid = null;
      allSnap.forEach(d => {
        const data = d.data();
        if (data.email?.toLowerCase() === OWNER_EMAIL || data.role === 'admin') {
          ownerUid = d.id;
        }
      });
      return ownerUid;
    } catch (e) {
      console.error('[ScreenshotDetector] Failed to find owner:', e);
      return null;
    }
  }
}

export const screenshotDetector = new ScreenshotDetector();
