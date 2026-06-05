import { db, collection, query, where, onSnapshot, updateDoc, doc, getDocs } from './firebase-config.js';
import { authManager } from './auth.js';
import { createNotification } from './notifications.js';
import { sanitizeHTML } from './utils.js';

class TimeCapsuleManager {
  constructor() {
    this.unsubscribe = null;
    this.intervalId = null;
    this.knownLockedCapsules = new Map();
    this.hasInitialized = false;
  }

  start() {
    if (this.unsubscribe || this.intervalId) return;

    // Realtime listener for locked capsules
    const q = query(collection(db, 'timeCapsules'), where('isUnlocked', '==', false));
    
    this.unsubscribe = onSnapshot(q, (snap) => {
      // Find capsules that were previously locked but are now missing from this snapshot
      // (Meaning they just got unlocked!)
      if (this.hasInitialized) {
        const currentIds = new Set();
        snap.forEach(d => currentIds.add(d.id));
        
        for (const [id, capsuleData] of this.knownLockedCapsules.entries()) {
          if (!currentIds.has(id)) {
            // It was unlocked!
            this.showCelebrationModal(capsuleData);
          }
        }
      }

      // Update our known locked capsules list
      this.knownLockedCapsules.clear();
      snap.forEach(d => {
        this.knownLockedCapsules.set(d.id, { id: d.id, ...d.data() });
      });

      this.hasInitialized = true;
      this.checkExpirations(); // Check immediately on load
    });

    // Background interval check every 1 second (1000ms) for instant unlock
    this.intervalId = setInterval(() => {
      this.checkExpirations();
    }, 1000);
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.knownLockedCapsules.clear();
    this.hasInitialized = false;
  }

  async checkExpirations() {
    if (!authManager.currentUser) return;
    
    const now = new Date();
    
    for (const [id, capsule] of this.knownLockedCapsules.entries()) {
      const unlockMillis = capsule.unlockDate?.toMillis ? capsule.unlockDate.toMillis() : (capsule.unlockDate ? new Date(capsule.unlockDate).getTime() : null);
      
      if (unlockMillis) {
        // Debug logs as requested
        const diff = unlockMillis - now.getTime();
        // Only log when it's very close to unlock to avoid spamming the console every second
        if (diff > -5000 && diff < 5000) {
          console.log("Unlock Time:", unlockMillis);
          console.log("Current Time:", now.getTime());
          console.log("Difference:", diff);
        }
      }
      
      if (unlockMillis && now.getTime() >= unlockMillis) {
        // Expiry reached!
        
        // 1. Update Firestore immediately. 
        // We let any active client trigger the unlock to ensure it unlocks globally instantly.
        try {
          await updateDoc(doc(db, 'timeCapsules', id), { isUnlocked: true });
        } catch (e) {
          console.warn("Failed to unlock capsule, maybe another client already did it", e);
        }

        // 2. Notifications - Only the author creates the notification to avoid duplicates
        // if 30 clients are online at the same time.
        if (capsule.authorId === authManager.currentUser.uid || capsule.createdBy === authManager.currentUser.uid) {
          try {
            await createNotification('time_capsule_unlock', capsule.authorId || capsule.createdBy, {
              capsuleId: id,
              message: `🔓 Time Capsule Opened: Your capsule "${capsule.caption || 'Memory'}" is now available.`
            });
          } catch(e) {}
        }
      }
    }
  }

  showCelebrationModal(capsule) {
    const isMine = (capsule.authorId === authManager.currentUser?.uid || capsule.createdBy === authManager.currentUser?.uid);
    const title = isMine ? "🎉 Your Time Capsule Opened!" : "🎉 Time Capsule Opened!";
    const body = isMine 
      ? "Your memory capsule is ready to unlock."
      : `${sanitizeHTML(capsule.authorName || 'A classmate')}'s memory capsule is ready to unlock.`;

    const modalHtml = `
      <div id="capsule-celebration-${capsule.id}" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn p-4">
        <div class="bg-[#1e293b] border-2 border-yellow-400 rounded-3xl p-8 max-w-sm w-full text-center shadow-[0_0_40px_rgba(250,204,21,0.3)] relative overflow-hidden transform scale-95 transition-transform duration-500 hover:scale-100">
          
          <!-- Animated Background Glow -->
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-yellow-400/20 blur-[50px] rounded-full animate-pulse"></div>

          <div class="text-6xl mb-4 animate-bounce relative z-10">🔓</div>
          <h2 class="text-2xl font-bold text-white mb-2 relative z-10">${title}</h2>
          <p class="text-gray-300 text-sm mb-8 relative z-10">${body}</p>
          
          <div class="flex gap-3 relative z-10">
            <button class="close-celebration-btn flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors">Dismiss</button>
            <button class="open-capsule-btn flex-1 py-3 px-4 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-white font-bold rounded-xl shadow-lg transition-colors">Open Capsule</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Spawn some confetti globally
    if (window.spawnConfettiGlobally) {
      window.spawnConfettiGlobally();
    }

    const modalEl = document.getElementById(`capsule-celebration-${capsule.id}`);
    
    modalEl.querySelector('.close-celebration-btn').addEventListener('click', () => {
      modalEl.classList.remove('animate-fadeIn');
      modalEl.classList.add('animate-fadeOut');
      setTimeout(() => modalEl.remove(), 300);
    });

    modalEl.querySelector('.open-capsule-btn').addEventListener('click', () => {
      console.log('Opening Capsule:', capsule.id);
      modalEl.remove();
      // Use dynamic import for router to avoid circular dependencies if any
      import('./router.js').then(m => {
        m.router.navigate('timecapsule', { capsuleId: capsule.id });
      });
    });
  }
}

export const timeCapsuleManager = new TimeCapsuleManager();

// Helper for global confetti
window.spawnConfettiGlobally = function() {
  const colors = ['#facc15', '#f87171', '#60a5fa', '#34d399', '#c084fc'];
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.style.cssText = `
      position: fixed;
      top: -10px;
      left: ${Math.random() * 100}vw;
      width: ${8 + Math.random() * 6}px;
      height: ${8 + Math.random() * 6}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      z-index: 10000;
      border-radius: 50%;
      pointer-events: none;
      animation: global-confetti-fall ${1.5 + Math.random() * 2}s linear forwards;
      transform: rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
};
