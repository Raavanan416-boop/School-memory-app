import { db, doc, onSnapshot, getDoc } from '../firebase-config.js';
import { authManager } from '../auth.js';

class LaunchManager {
  constructor() {
    this.overlay = null;
    this.timer = null;
    this.unsub = null;
    this.isBlocked = false;
    this.launchTime = 0;
    this.resolveInit = null;
    this.settingsRef = doc(db, 'systemSettings', 'appLaunch');
    this.isPreview = false;
  }

  // Returns a promise that resolves when the app is allowed to start
  async startBlocker() {
    return new Promise(async (resolve) => {
      this.resolveInit = resolve;
      
      // We check authManager silently. The user is either logged in or null.
      if (authManager.isOwner) {
        console.log('[LaunchManager] Owner bypassed countdown.');
        resolve();
        // Still setup listener so owner can preview
        this._setupListener();
        return;
      }

      // Initial fetch to decide whether to block immediately
      try {
        const snap = await getDoc(this.settingsRef);
        if (snap.exists()) {
          const data = snap.data();
          this._handleStateChange(data);
        } else {
          resolve();
        }
      } catch (e) {
        console.error('[LaunchManager] Failed to fetch launch settings', e);
        resolve();
      }

      this._setupListener();
    });
  }

  _setupListener() {
    if (this.unsub) return;
    this.unsub = onSnapshot(this.settingsRef, (snap) => {
      if (snap.exists()) {
        this._handleStateChange(snap.data());
      } else {
        this._unblock();
      }
    });
  }

  _handleStateChange(data) {
    if (!data.enabled) {
      this._unblock();
      return;
    }

    if (!data.launchTime) {
      this._unblock();
      return;
    }

    this.launchTime = data.launchTime.toMillis ? data.launchTime.toMillis() : data.launchTime;

    if (Date.now() >= this.launchTime) {
      this._unblock();
      return;
    }

    this._block();
  }

  _unblock() {
    this.isBlocked = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      setTimeout(() => {
        if (this.overlay) {
          this.overlay.remove();
          this.overlay = null;
        }
      }, 1000);
    }

    if (this.resolveInit) {
      this.resolveInit();
      this.resolveInit = null;
    }
  }

  _block() {
    // If owner, we don't block their access, but we might show a preview if requested
    if (authManager.isOwner && !this.isPreview) {
      this.isBlocked = false;
      return;
    }

    this.isBlocked = true;

    if (!this.overlay) {
      this._createOverlay();
    }
    
    if (this.timer) clearInterval(this.timer);
    this._updateTimer();
    this.timer = setInterval(() => this._updateTimer(), 1000);
  }

  _createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'premium-launch-overlay';
    
    // Inject Custom Styles for Premium Animations
    const style = document.createElement('style');
    style.innerHTML = `
      #premium-launch-overlay {
        position: fixed; inset: 0; z-index: 9999999;
        background: radial-gradient(circle at center, #0f172a 0%, #020617 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        overflow: hidden; font-family: 'Playfair Display', sans-serif;
        color: white; transition: opacity 1s ease-in-out;
      }
      .stars-bg {
        position: absolute; width: 200vw; height: 200vh; top: -50%; left: -50%;
        background: transparent url('data:image/svg+xml;utf8,<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="1.5" fill="%23ffffff33"/><circle cx="200" cy="150" r="1" fill="%23ffffff22"/><circle cx="350" cy="250" r="2" fill="%23ffffff44"/></svg>') repeat;
        animation: rotateStars 150s linear infinite; opacity: 0.6; pointer-events: none;
      }
      .glowing-orb {
        position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.4; pointer-events: none;
        animation: floatOrb 10s ease-in-out infinite alternate;
      }
      .orb-1 { width: 40vw; height: 40vw; background: #3b82f6; top: -10%; left: -10%; }
      .orb-2 { width: 30vw; height: 30vw; background: #d4af37; bottom: -5%; right: -5%; animation-delay: -5s; }
      
      .glass-card {
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
        border-radius: 24px; padding: 2rem; position: relative; z-index: 10;
        display: flex; flex-direction: column; align-items: center;
      }
      
      .shimmer-text {
        background: linear-gradient(90deg, #d4af37 0%, #ffeaa7 50%, #d4af37 100%);
        background-size: 200% auto;
        color: transparent; -webkit-background-clip: text; background-clip: text;
        animation: shimmer 3s linear infinite; font-weight: 800;
      }
      
      .cd-box {
        background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(212, 175, 55, 0.3);
        border-radius: 16px; width: 80px; height: 90px; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), inset 0 0 15px rgba(212,175,55,0.1);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      .cd-box:hover {
        transform: translateY(-5px); box-shadow: 0 15px 35px -5px rgba(212,175,55,0.3), inset 0 0 20px rgba(212,175,55,0.2);
      }
      .cd-val { font-size: 2.5rem; font-weight: bold; color: white; font-family: 'JetBrains Mono', monospace; text-shadow: 0 0 15px rgba(255,255,255,0.5); }
      .cd-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px; color: #94a3b8; margin-top: 8px; font-family: sans-serif;}
      
      @keyframes rotateStars { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes floatOrb { 0% { transform: translate(0, 0) scale(1); } 100% { transform: translate(30px, 30px) scale(1.1); } }
      @keyframes shimmer { to { background-position: 200% center; } }
      @keyframes pulseLogo { 0% { filter: drop-shadow(0 0 10px rgba(255,255,255,0.2)); transform: scale(1); } 50% { filter: drop-shadow(0 0 25px rgba(212,175,55,0.6)); transform: scale(1.05); } 100% { filter: drop-shadow(0 0 10px rgba(255,255,255,0.2)); transform: scale(1); } }
      
      .floating-particle {
        position: absolute; background: white; border-radius: 50%; pointer-events: none; opacity: 0;
        animation: floatUp 8s linear infinite;
      }
      @keyframes floatUp { 0% { transform: translateY(100vh) scale(0); opacity: 0; } 10% { opacity: 0.8; } 90% { opacity: 0.8; } 100% { transform: translateY(-20vh) scale(1.5); opacity: 0; } }
    `;
    this.overlay.appendChild(style);

    const bg = document.createElement('div');
    bg.className = 'stars-bg';
    this.overlay.appendChild(bg);
    
    const orb1 = document.createElement('div'); orb1.className = 'glowing-orb orb-1'; this.overlay.appendChild(orb1);
    const orb2 = document.createElement('div'); orb2.className = 'glowing-orb orb-2'; this.overlay.appendChild(orb2);

    // Particles
    for(let i=0; i<30; i++) {
      const p = document.createElement('div');
      p.className = 'floating-particle';
      const size = Math.random() * 4 + 1;
      p.style.width = size + 'px'; p.style.height = size + 'px';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.animationDelay = (Math.random() * 8) + 's';
      p.style.animationDuration = (Math.random() * 5 + 5) + 's';
      if (Math.random() > 0.5) p.style.background = '#d4af37';
      this.overlay.appendChild(p);
    }

    const content = document.createElement('div');
    content.className = 'glass-card';
    content.innerHTML = `
      <div class="w-32 h-32 mb-6" style="animation: pulseLogo 4s infinite ease-in-out;">
        <img src="/assets/class-memories-logo.png" alt="ClassMemories" class="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
      </div>
      <h1 class="text-4xl md:text-6xl tracking-wider mb-2 font-black text-white text-center">CLASS MEMORIES</h1>
      <p class="text-xl md:text-2xl mb-12 uppercase tracking-[0.4em] shimmer-text text-center">✨ Coming Soon ✨</p>
      
      <div class="flex gap-4 md:gap-6 mb-10 text-center">
        <div class="flex flex-col items-center">
          <div class="cd-box"><span class="cd-val" id="pm-days">00</span></div>
          <span class="cd-label">Days</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="cd-box"><span class="cd-val" id="pm-hours">00</span></div>
          <span class="cd-label">Hours</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="cd-box"><span class="cd-val" id="pm-mins">00</span></div>
          <span class="cd-label">Minutes</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="cd-box" style="border-color: rgba(212,175,55,0.8)"><span class="cd-val" style="color: #d4af37" id="pm-secs">00</span></div>
          <span class="cd-label" style="color: #d4af37">Seconds</span>
        </div>
      </div>
      
      <div class="px-6 py-3 rounded-full flex items-center justify-center text-center" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px);">
        <p class="text-sm md:text-base text-gray-300 font-sans tracking-wide">Launching on <span class="text-white font-bold" id="pm-date">--</span> at <span class="text-white font-bold" id="pm-time">--</span></p>
      </div>
    `;
    
    this.overlay.appendChild(content);
    document.body.appendChild(this.overlay);

    // Confetti logic
    setInterval(() => {
      if(this.isBlocked && document.visibilityState === 'visible') {
         import('https://cdn.skypack.dev/canvas-confetti').then((confetti) => {
            confetti.default({
              particleCount: 20, spread: 60, origin: { y: 1 },
              colors: ['#d4af37', '#ffffff', '#3b82f6'], disableForReducedMotion: true, zIndex: 99999999
            });
         });
      }
    }, 4000);
  }

  _updateTimer() {
    if (!this.overlay) return;
    const diff = this.launchTime - Date.now();
    
    if (diff <= 0) {
      this._unblock();
      return;
    }

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / 1000 / 60) % 60);
    const s = Math.floor((diff / 1000) % 60);

    const dEl = document.getElementById('pm-days');
    const hEl = document.getElementById('pm-hours');
    const mEl = document.getElementById('pm-mins');
    const sEl = document.getElementById('pm-secs');
    
    if (dEl) dEl.textContent = d.toString().padStart(2, '0');
    if (hEl) hEl.textContent = h.toString().padStart(2, '0');
    if (mEl) mEl.textContent = m.toString().padStart(2, '0');
    if (sEl) sEl.textContent = s.toString().padStart(2, '0');

    // Update the bottom text
    const dateEl = document.getElementById('pm-date');
    const timeEl = document.getElementById('pm-time');
    if (dateEl && timeEl) {
      const lDate = new Date(this.launchTime);
      dateEl.textContent = lDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      timeEl.textContent = lDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
  }

  previewScreen() {
    this.isPreview = true;
    this._block();
    if (this.overlay) {
       const closeBtn = document.createElement('button');
       closeBtn.className = 'absolute top-6 right-6 z-[99999999] text-white rounded-full p-2 transition-colors';
       closeBtn.style.background = 'rgba(255,255,255,0.1)';
       closeBtn.style.backdropFilter = 'blur(10px)';
       closeBtn.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
       closeBtn.onclick = () => {
         this.isPreview = false;
         this._unblock();
       };
       this.overlay.appendChild(closeBtn);
    }
  }
}

export const launchManager = new LaunchManager();
