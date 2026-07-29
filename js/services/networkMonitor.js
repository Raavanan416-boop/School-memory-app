/**
 * Global Internet Connection Monitor & Firebase Sync Queue
 * Class Memories Application
 */

import { rtdb, ref, onValue, db, collection, doc, addDoc, setDoc, updateDoc } from '../firebase-config.js';

class NetworkMonitor {
  constructor() {
    this.state = 'ONLINE'; // 'ONLINE' | 'SLOW' | 'OFFLINE'
    this.previousState = 'ONLINE';
    this.bannerEl = null;
    this.autoHideTimer = null;
    this.pingInterval = null;
    this.isSyncingQueue = false;
    this.actionHandlers = new Map();
    this.queueKey = 'cm_pending_offline_actions';
  }

  init() {
    this.createBannerDOM();
    this.setupDefaultHandlers();
    this.setupListeners();
    this.startPingCheck();
    this.checkInitialState();
    
    // Process any previously persisted offline queue
    setTimeout(() => {
      if (this.isOnline()) {
        this.processQueue();
      }
    }, 2000);
  }

  setupDefaultHandlers() {
    // 1. Generic Firestore Add
    this.registerHandler('FIRESTORE_ADD', async (payload) => {
      if (!payload || !payload.collectionPath || !payload.data) return;
      await addDoc(collection(db, payload.collectionPath), payload.data);
    });

    // 2. Generic Firestore Set
    this.registerHandler('FIRESTORE_SET', async (payload) => {
      if (!payload || !payload.docPath || !payload.data) return;
      await setDoc(doc(db, payload.docPath), payload.data, { merge: payload.merge !== false });
    });

    // 3. Generic Firestore Update
    this.registerHandler('FIRESTORE_UPDATE', async (payload) => {
      if (!payload || !payload.docPath || !payload.data) return;
      await updateDoc(doc(db, payload.docPath), payload.data);
    });

    // 4. Comments
    this.registerHandler('COMMENT', async (payload) => {
      if (!payload) return;
      const targetPath = payload.collectionPath || `posts/${payload.postId}/comments`;
      await addDoc(collection(db, targetPath), payload.commentData || payload.data);
    });

    // 5. Likes
    this.registerHandler('LIKE', async (payload) => {
      if (!payload || !payload.docPath) return;
      await updateDoc(doc(db, payload.docPath), payload.updateData || payload.data);
    });

    // 6. Reactions
    this.registerHandler('REACTION', async (payload) => {
      if (!payload || !payload.docPath) return;
      await updateDoc(doc(db, payload.docPath), payload.updateData || payload.data);
    });

    // 7. Chat Messages
    this.registerHandler('CHAT_MESSAGE', async (payload) => {
      if (!payload || !payload.chatPath) return;
      await addDoc(collection(db, payload.chatPath), payload.messageData || payload.data);
    });

    // 8. Story Book Updates
    this.registerHandler('STORYBOOK_UPDATE', async (payload) => {
      if (!payload || !payload.docPath) return;
      await setDoc(doc(db, payload.docPath), payload.data || payload.updateData, { merge: true });
    });
  }

  createBannerDOM() {
    if (document.getElementById('network-status-banner')) {
      this.bannerEl = document.getElementById('network-status-banner');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'network-status-banner';
    wrapper.className = 'net-banner-wrapper';
    wrapper.setAttribute('role', 'alert');
    wrapper.setAttribute('aria-live', 'assertive');
    
    wrapper.innerHTML = `
      <div id="net-banner-content" class="net-banner-content net-banner-online">
        <div id="net-banner-icon" class="net-banner-icon">
          <!-- Icon injected dynamically -->
        </div>
        <div class="net-banner-text-group">
          <p id="net-banner-title" class="net-banner-title">🟢 Back Online</p>
          <p id="net-banner-subtitle" class="net-banner-subtitle">Connection restored successfully.</p>
        </div>
        <button type="button" id="net-banner-close" class="net-banner-close" aria-label="Dismiss banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(wrapper);
    this.bannerEl = wrapper;

    const closeBtn = wrapper.querySelector('#net-banner-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideBanner());
    }
  }

  setupListeners() {
    // 1. Browser Window online/offline events
    window.addEventListener('online', () => {
      console.log('[NetworkMonitor] Window online event');
      this.evaluateState();
    });

    window.addEventListener('offline', () => {
      console.log('[NetworkMonitor] Window offline event');
      this.updateState('OFFLINE');
    });

    // 2. Firebase RTDB .info/connected listener
    try {
      const connectedRef = ref(rtdb, '.info/connected');
      onValue(connectedRef, (snap) => {
        const isConnected = snap.val() === true;
        console.log('[NetworkMonitor] Firebase RTDB connected state:', isConnected);
        if (!isConnected && !navigator.onLine) {
          this.updateState('OFFLINE');
        } else {
          this.evaluateState();
        }
      });
    } catch (err) {
      console.warn('[NetworkMonitor] Could not attach RTDB listener:', err);
    }

    // 3. Network Information API (if available)
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      conn.addEventListener('change', () => {
        console.log('[NetworkMonitor] Network Information API change event:', conn.effectiveType);
        this.evaluateState();
      });
    }
  }

  startPingCheck() {
    // Periodic light ping every 12 seconds to catch silent packet loss / severe lag
    if (this.pingInterval) clearInterval(this.pingInterval);
    
    this.pingInterval = setInterval(async () => {
      if (!navigator.onLine) {
        this.updateState('OFFLINE');
        return;
      }
      
      const isSlow = await this.pingNetwork();
      if (isSlow === 'OFFLINE') {
        this.updateState('OFFLINE');
      } else if (isSlow === 'SLOW') {
        this.updateState('SLOW');
      } else if (this.state === 'SLOW' || this.state === 'OFFLINE') {
        this.evaluateState();
      }
    }, 12000);
  }

  async pingNetwork() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) {
      return 'SLOW';
    }

    const startTime = Date.now();
    try {
      // Use cache-busting HEAD request to a fast reliable endpoint or logo asset
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

      const response = await fetch(`/assets/class-memories-logo.png?r=${Math.random()}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (!response.ok) return 'SLOW';
      if (duration > 2500) return 'SLOW';
      return 'ONLINE';
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('[NetworkMonitor] Ping request timed out (slow connection)');
        return 'SLOW';
      }
      if (!navigator.onLine) return 'OFFLINE';
      return 'SLOW';
    }
  }

  checkInitialState() {
    if (!navigator.onLine) {
      this.updateState('OFFLINE');
    } else {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) {
        this.updateState('SLOW');
      }
    }
  }

  evaluateState() {
    if (!navigator.onLine) {
      this.updateState('OFFLINE');
      return;
    }

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')) {
      this.updateState('SLOW');
      return;
    }

    this.updateState('ONLINE');
  }

  updateState(newState) {
    if (this.state === newState) return; // Prevent spam / redundant updates

    this.previousState = this.state;
    this.state = newState;
    console.log(`[NetworkMonitor] State changed from ${this.previousState} -> ${this.state}`);

    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }

    if (this.state === 'OFFLINE') {
      this.showBanner('OFFLINE');
    } else if (this.state === 'SLOW') {
      this.showBanner('SLOW');
    } else if (this.state === 'ONLINE') {
      // Only show "Back Online" if coming from an offline or slow state
      if (this.previousState === 'OFFLINE' || this.previousState === 'SLOW') {
        this.showBanner('ONLINE');
        this.autoHideTimer = setTimeout(() => {
          this.hideBanner();
        }, 2000);

        // Auto-sync pending queued Firebase operations
        this.processQueue();
      } else {
        this.hideBanner();
      }
    }
  }

  showBanner(status) {
    if (!this.bannerEl) this.createBannerDOM();

    const contentEl = this.bannerEl.querySelector('#net-banner-content');
    const iconEl = this.bannerEl.querySelector('#net-banner-icon');
    const titleEl = this.bannerEl.querySelector('#net-banner-title');
    const subtitleEl = this.bannerEl.querySelector('#net-banner-subtitle');

    if (!contentEl || !titleEl || !subtitleEl) return;

    // Reset classes
    contentEl.className = 'net-banner-content';

    if (status === 'OFFLINE') {
      contentEl.classList.add('net-banner-offline');
      iconEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
      `;
      titleEl.textContent = '🔴 No Internet Connection';
      subtitleEl.textContent = 'Please check your network.';
    } else if (status === 'SLOW') {
      contentEl.classList.add('net-banner-slow');
      iconEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      `;
      titleEl.textContent = '🟡 Slow Internet Connection';
      subtitleEl.textContent = 'Some features may take longer to load.';
    } else if (status === 'ONLINE') {
      contentEl.classList.add('net-banner-online');
      iconEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
          <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
      `;
      titleEl.textContent = '🟢 Back Online';
      subtitleEl.textContent = 'Connection restored successfully.';
    }

    // Trigger animation
    requestAnimationFrame(() => {
      this.bannerEl.classList.add('net-banner-visible');
    });
  }

  hideBanner() {
    if (this.bannerEl) {
      this.bannerEl.classList.remove('net-banner-visible');
    }
  }

  isOnline() {
    return this.state === 'ONLINE';
  }

  // ===== FIREBASE ACTION QUEUEING & AUTO-SYNC =====

  registerHandler(actionType, handlerFn) {
    this.actionHandlers.set(actionType, handlerFn);
  }

  enqueueAction(actionType, payload) {
    const queue = this.getQueue();
    const actionItem = {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      type: actionType,
      payload: payload,
      timestamp: Date.now(),
      retryCount: 0
    };
    queue.push(actionItem);
    this.saveQueue(queue);
    console.log(`[NetworkMonitor] Action queued [${actionType}]:`, actionItem.id);

    // If online, attempt immediate sync
    if (this.isOnline()) {
      this.processQueue();
    }
    return actionItem.id;
  }

  getQueue() {
    try {
      const raw = localStorage.getItem(this.queueKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('[NetworkMonitor] Failed to read queue from localStorage', e);
      return [];
    }
  }

  saveQueue(queue) {
    try {
      localStorage.setItem(this.queueKey, JSON.stringify(queue));
    } catch (e) {
      console.error('[NetworkMonitor] Failed to save queue to localStorage', e);
    }
  }

  async executeWithOfflineSupport(actionType, payload, asyncOperationFn) {
    if (!this.isOnline()) {
      this.enqueueAction(actionType, payload);
      return { status: 'queued', message: 'Action queued for auto-sync when online' };
    }

    try {
      const result = await asyncOperationFn();
      return { status: 'success', result };
    } catch (error) {
      console.warn(`[NetworkMonitor] Operation [${actionType}] failed, queueing for retry:`, error);
      this.enqueueAction(actionType, payload);
      return { status: 'queued', error: error.message };
    }
  }

  async processQueue() {
    if (this.isSyncingQueue) return;
    const queue = this.getQueue();
    if (queue.length === 0) return;

    this.isSyncingQueue = true;
    console.log(`[NetworkMonitor] Processing ${queue.length} pending offline actions...`);

    const remainingQueue = [];

    for (const item of queue) {
      const handler = this.actionHandlers.get(item.type);
      if (!handler) {
        console.warn(`[NetworkMonitor] No handler registered for action type: ${item.type}`);
        // Keep item if it hasn't exceeded 10 retries
        if (item.retryCount < 10) {
          item.retryCount++;
          remainingQueue.push(item);
        }
        continue;
      }

      try {
        await handler(item.payload);
        console.log(`[NetworkMonitor] Successfully synced action [${item.type}]: ${item.id}`);
      } catch (err) {
        console.error(`[NetworkMonitor] Error processing action [${item.type}]:`, err);
        item.retryCount++;
        if (item.retryCount < 5) {
          remainingQueue.push(item);
        } else {
          console.error(`[NetworkMonitor] Dropping action ${item.id} after 5 failed retries.`);
        }
      }
    }

    this.saveQueue(remainingQueue);
    this.isSyncingQueue = false;

    if (remainingQueue.length > 0 && this.isOnline()) {
      // Schedule follow-up retry for remaining items
      setTimeout(() => this.processQueue(), 5000);
    }
  }
}

export const networkMonitor = new NetworkMonitor();
