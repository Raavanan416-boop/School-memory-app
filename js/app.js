// Main App Entry — Resilient app shell with lazy page loading + auto-login
import { authManager } from './auth.js';
import { router } from './router.js';
import { showToast, sanitizeHTML, isDobPassword } from './utils.js';
import { presenceManager } from './presence.js';
import { userCache } from './services/userCache.js';
import { db, collection, getDocs, doc, writeBatch, query, where, onSnapshot } from './firebase-config.js';
// removed unused import
import { usageTracker } from './services/usageTracker.js';
import { loginTracker } from './services/loginTracker.js';
import { launchManager } from './services/launchManager.js';
import { friendshipIntroManager } from './services/friendshipIntroManager.js';

window.syncAllLeaderboardPoints = async () => {
  console.log("Starting Emergency Sync...");
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    const batch = writeBatch(db);
    let count = 0;
    usersSnap.forEach(snap => {
      const data = snap.data();
      const pts = typeof data.points === 'number' ? data.points : 0;
      console.log(`Syncing user ${snap.id}: ${pts} points`);
      batch.update(snap.ref, { points: pts });
      count++;
    });
    await batch.commit();
    console.log(`Emergency Sync Complete. Updated ${count} users.`);
    showToast(`Emergency Sync Complete. Updated ${count} users.`, 'success');
  } catch (e) {
    console.error("Emergency Sync Failed:", e);
    showToast("Emergency Sync Failed", 'error');
  }
};

// ===== MUSIC PLAYER =====
const MusicPlayer = {
  bgAudio: null,
  songs: [
    'schoolbell.mp3',
    'firstsong.mp3',
    'secondsong.mp3',
    'thridsong.mp3',
    'fourthsong.mp3',
    'applastsong.mp3'
  ],
  playlist: [],
  currentIndex: 0,
  isStopped: false,
  hasStarted: false,

  saveState() {
    sessionStorage.setItem('musicCurrentIndex', this.currentIndex);
    sessionStorage.setItem('musicIsStopped', this.isStopped ? 'true' : 'false');
    sessionStorage.setItem('musicHasStarted', this.hasStarted ? 'true' : 'false');
    if (this.bgAudio) {
      sessionStorage.setItem('musicCurrentTime', this.bgAudio.currentTime);
    }
  },

  loadState() {
    const idx = sessionStorage.getItem('musicCurrentIndex');
    const stopped = sessionStorage.getItem('musicIsStopped');
    const started = sessionStorage.getItem('musicHasStarted');
    
    if (idx !== null) this.currentIndex = parseInt(idx, 10);
    if (stopped !== null) this.isStopped = (stopped === 'true');
    if (started !== null) this.hasStarted = (started === 'true');
  },

  start(restore = false) {
    this.playlist = [...this.songs];
    this.loadState();
    if (this.isStopped) {
      this.hideStopButton();
      return;
    }
    if (this.hasStarted && !restore) return;
    this.hasStarted = true;
    this.saveState();

    this.showStopButton();
    
    // Ensure no overlapping audio
    if (this.bgAudio) {
      this.bgAudio.pause();
    }

    // Start playing the playlist directly
    this.playNextSong(restore);
  },

  playNextSong(restore = false) {
    if (this.isStopped) return;
    if (this.currentIndex >= this.playlist.length) {
      this.stopAll();
      return;
    }

    if (this.bgAudio) {
      this.bgAudio.pause();
      this.bgAudio.src = '';
    }

    this.bgAudio = new Audio(this.playlist[this.currentIndex]);
    this.bgAudio.volume = 0.5;

    if (restore) {
      const savedTime = sessionStorage.getItem('musicCurrentTime');
      if (savedTime !== null) {
        this.bgAudio.currentTime = parseFloat(savedTime);
      }
    }

    this.bgAudio.play().catch(e => console.log('BGAudio play failed:', e));
    this.saveState();

    this.bgAudio.ontimeupdate = () => {
      this.saveState();
    };

    this.bgAudio.onended = () => {
      if (this.isStopped) return;
      this.currentIndex++;
      this.playNextSong();
    };
  },

  stopAll() {
    this.isStopped = true;
    if (this.bgAudio) {
      this.bgAudio.pause();
      this.bgAudio.src = '';
    }
    this.playlist = [];
    this.saveState();
    this.hideStopButton();
  },

  showStopButton() {
    let btn = document.getElementById('global-music-stop');
    if (!btn && !this.isStopped) {
      btn = document.createElement('button');
      btn.id = 'global-music-stop';
      btn.innerHTML = `
        <span class="relative z-10 flex items-center gap-2">
          <span class="animate-pulse text-lg">🎵</span> Stop Music
        </span>
        <div class="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
      `;
      btn.className = 'fixed bottom-24 right-4 z-[100] bg-gradient-to-br from-rose-500 via-red-500 to-red-600 text-white font-extrabold px-6 py-3 rounded-full shadow-[0_8px_30px_rgba(225,29,72,0.6)] border border-white/20 hover:shadow-[0_12px_40px_rgba(225,29,72,0.8)] hover:-translate-y-1 transition-all duration-300 transform active:scale-95 flex items-center gap-2 overflow-hidden group tracking-wide text-sm';
      btn.onclick = () => this.stopAll();
      document.body.appendChild(btn);
    }
  },

  hideStopButton() {
    const btn = document.getElementById('global-music-stop');
    if (btn) {
      btn.style.opacity = '0';
      btn.style.transform = 'scale(0.8)';
      setTimeout(() => btn.remove(), 300);
    }
  }
};

// Expose router globally for notification click routing
window.__appRouter = { router };

// Lazy-load modules to prevent one broken module from killing the whole app
let notificationManager = null;
let callManager = null;
let unsubChatBadge = null; // Firestore listener for chat unread badge

async function loadCoreModules() {
  try {
    const nm = await import('./notifications.js');
    notificationManager = nm.notificationManager;
  } catch (e) { console.error('Notifications module failed:', e); }

  try {
    const cm = await import('./calls.js');
    callManager = cm.callManager;
  } catch (e) { console.error('Calls module failed:', e); }
}

// Lazy page loader — wraps each page import so failures are isolated
function lazyPage(pagePath, exportName) {
  return async (container, data) => {
    try {
      const mod = await import(pagePath);
      await mod[exportName](container, data);
    } catch (e) {
      console.error(`Page ${pagePath} failed:`, e);
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center">
          <div class="text-4xl mb-3">⚠️</div>
          <h3 class="text-lg font-bold text-navy-800 mb-2">Page Error</h3>
          <p class="text-sm text-gray-400 mb-4">${e.message || 'Could not load this page'}</p>
          <button onclick="location.reload()" class="px-4 py-2 bg-navy-500 text-white rounded-full text-sm font-semibold">Reload App</button>
        </div>`;
    }
  };
}

const $ = (sel) => document.querySelector(sel);

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>` },
  { id: 'search', label: 'Search', icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>` },
  { id: 'upload', label: 'Post', icon: `<svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 8v8m-4-4h8"/></svg>` },
  { id: 'chat', label: 'Chat', icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg>` },
  { id: 'profile', label: 'Me', icon: `<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"/></svg>` }
];

// ===== AUTO LOGIN CREDENTIALS =====
const AUTO_LOGIN_EMAIL = 'admin37@classmemories.com';
const AUTO_LOGIN_PASSWORD = 'school123';

// ===== SPLASH =====
function animateSplash() {
  return new Promise(resolve => {
    const leftGate = $('#welcome-gate-left');
    const rightGate = $('#welcome-gate-right');
    const campusBg = $('.welcome-campus-bg');
    const content = $('#welcome-content');
    
    // Create particles
    const particlesContainer = $('#welcome-particles');
    if (particlesContainer && particlesContainer.children.length === 0) {
      for (let i = 0; i < 50; i++) {
        const p = document.createElement('div');
        p.className = 'magical-particle';
        const size = Math.random() * 8 + 4;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.left = Math.random() * 100 + '%';
        p.style.top = Math.random() * 100 + '%';
        p.style.animationDelay = (Math.random() * 2) + 's';
        p.style.animationDuration = (Math.random() * 3 + 3) + 's';
        particlesContainer.appendChild(p);
      }
    }

    // Sequence timeline
    setTimeout(() => {
      // Open gates
      if (leftGate) leftGate.classList.add('welcome-gate-left-open');
      if (rightGate) rightGate.classList.add('welcome-gate-right-open');
    }, 500);

    setTimeout(() => {
      // Zoom campus
      if (campusBg) campusBg.classList.add('welcome-campus-zoom');
    }, 1500);

    setTimeout(() => {
      // Show content
      if (content) content.classList.add('welcome-content-show');
    }, 2500);

    // Resolve after full animation ends (4 seconds total)
    setTimeout(resolve, 4000);
  });
}
function hideSplash() {
  const el = $('#splash-screen');
  if (el) { 
    el.style.opacity = '0'; 
    setTimeout(() => {
      el.classList.add('hidden');
    }, 1000); 
  }
}

// ===== LOGOUT ANIMATION =====
window.animateLogout = function() {
  return new Promise(resolve => {
    // Hide the app container with a blur
    const appContainer = $('#app');
    if (appContainer) {
      appContainer.style.transition = 'all 1s ease';
      appContainer.style.opacity = '0';
      appContainer.style.filter = 'blur(10px)';
    }

    const splash = $('#splash-screen');
    const leftGate = $('#welcome-gate-left');
    const rightGate = $('#welcome-gate-right');
    const campusBg = $('.welcome-campus-bg');
    const content = $('#welcome-content');

    if (!splash) return resolve();

    // Reset splash text to emotional message
    if (content) {
      content.innerHTML = `
        <p class="font-caveat text-4xl text-[#FFDF00] drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] text-center px-6 leading-relaxed font-semibold">
          "School may end,<br/>memories never will."
        </p>
      `;
    }

    // Show splash with gates already open
    splash.classList.remove('hidden');
    splash.style.opacity = '1';

    // Wait a brief moment for the user to see the open gates and message
    setTimeout(() => {
      // Close the gates
      if (leftGate) leftGate.classList.remove('welcome-gate-left-open');
      if (rightGate) rightGate.classList.remove('welcome-gate-right-open');
      if (campusBg) campusBg.classList.remove('welcome-campus-zoom');
      if (content) content.classList.remove('welcome-content-show');
      
      // Wait for gates to fully close, then resolve
      setTimeout(() => {
        resolve();
      }, 3000);
    }, 2000);
  });
};

// ===== LOGIN PAGE =====
function showLogin() {
  const lp = $('#login-page');
  lp.className = 'fixed inset-0 z-[90] bg-gradient-to-br from-cream-100 to-amber-50/80 overflow-y-auto transition-opacity duration-1000';
  lp.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-screen px-6 py-10 relative z-10">
      
      <!-- School Logo -->
      <div class="relative flex flex-col items-center mb-10 animate-fadeIn" style="animation-delay: 0.1s; opacity: 0;">
        <div class="absolute w-40 h-40 bg-gradient-radial from-[#D4AF37]/20 to-transparent rounded-full blur-xl animate-pulse"></div>
        <div class="w-32 h-32 bg-white rounded-full flex items-center justify-center overflow-hidden shadow-md border-2 border-[#D4AF37]/30 relative z-10 drop-shadow-[0_8px_20px_rgba(30,58,95,0.15)]">
          <img src="/assets/class-memories-logo.png" alt="Class Memories" class="w-full h-full object-cover" />
        </div>
      </div>

      <!-- Welcome text -->
      <h1 class="text-4xl font-playfair font-bold text-[#1E3A5F] mb-2 animate-fadeIn relative z-10 drop-shadow-sm tracking-wide" style="animation-delay: 0.2s; opacity: 0;">Welcome Back</h1>
      <p class="text-lg text-[#D4AF37] mb-10 animate-fadeIn relative z-10 font-caveat tracking-wide drop-shadow-sm" style="animation-delay: 0.3s; opacity: 0;">Relive the golden days.</p>

      <!-- Clean Glassmorphism Login Form -->
      <div class="w-full max-w-sm animate-slideUp relative z-10 bg-white/70 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-[0_20px_40px_rgba(30,58,95,0.08)] border border-white/50" style="animation-delay:0.4s;opacity:0">
        <form id="login-form" class="space-y-6" autocomplete="off">
          <!-- Username -->
          <div class="group">
            <label class="text-[10px] font-bold text-[#1E3A5F]/70 mb-2 block uppercase tracking-widest transition-colors group-focus-within:text-[#1E3A5F]">Email Address</label>
            <div class="relative flex items-center transition-transform duration-300 group-focus-within:-translate-y-1">
              <svg class="absolute left-4 w-5 h-5 text-gray-400 group-focus-within:text-[#D4AF37] transition-colors z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0"/></svg>
              <input type="email" id="login-email" placeholder="yourname@school.com" class="w-full bg-white/60 border border-gray-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm text-[#1E3A5F] placeholder-gray-400 font-medium focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-transparent focus:bg-white transition-all shadow-sm" required/>
            </div>
          </div>

          <!-- Password -->
          <div class="group">
            <label class="text-[10px] font-bold text-[#1E3A5F]/70 mb-2 block uppercase tracking-widest transition-colors group-focus-within:text-[#1E3A5F]">Password</label>
            <div class="relative flex items-center transition-transform duration-300 group-focus-within:-translate-y-1">
              <svg class="absolute left-4 w-5 h-5 text-gray-400 group-focus-within:text-[#D4AF37] transition-colors z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
              <input type="password" id="login-password" placeholder="DOB(32062007)" class="w-full bg-white/60 border border-gray-200 rounded-2xl py-3.5 pl-12 pr-12 text-sm text-[#1E3A5F] placeholder-gray-400 font-medium focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-transparent focus:bg-white transition-all shadow-sm" required/>
              <button type="button" id="toggle-password-btn" class="absolute right-2 w-10 h-10 flex items-center justify-center rounded-full hover:bg-cream-100 transition-all focus:outline-none z-10" aria-label="Toggle password visibility">
                <span class="text-xl leading-none transform transition-transform duration-300 inline-block" id="diary-icon">📘</span>
              </button>
            </div>
          </div>

          <button type="submit" id="login-submit" class="w-full bg-gradient-to-r from-[#1E3A5F] to-[#2A4D7C] text-white font-bold py-4 rounded-2xl shadow-[0_4px_15px_rgba(30,58,95,0.3)] hover:shadow-[0_8px_25px_rgba(30,58,95,0.4)] hover:-translate-y-1 transition-all duration-300 mt-6 tracking-wider relative overflow-hidden group">
            <span class="relative z-10">ENTER THE MEMORY LANE</span>
            <div class="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
          </button>

          <div id="login-error" class="hidden text-center text-red-500 text-xs mt-4 p-3 bg-red-50/80 backdrop-blur-sm rounded-xl border border-red-100 font-medium shadow-inner"></div>
        </form>

        <p class="text-center text-[#1E3A5F]/50 text-[10px] font-medium mt-8 flex items-center justify-center gap-2 uppercase tracking-wider">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          Restricted to authorized alumni
        </p>
      </div>
    </div>
  `;

  // Password visibility toggle logic
  const toggleBtn = lp.querySelector('#toggle-password-btn');
  const passInput = lp.querySelector('#login-password');
  const diaryIcon = lp.querySelector('#diary-icon');

  if (toggleBtn && passInput) {
    toggleBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';

      // Diary open/close animation
      diaryIcon.style.transform = 'scale(0.8)';
      setTimeout(() => {
        diaryIcon.textContent = isPass ? '📖' : '📘';
        diaryIcon.style.transform = 'scale(1.1)';
      }, 150);
      setTimeout(() => diaryIcon.style.transform = 'scale(1)', 300);
    });
  }

  // Login submit
  lp.querySelector('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = lp.querySelector('#login-email').value.trim();
    const pass = lp.querySelector('#login-password').value;
    await doLogin(email, pass, true);
  });
}

async function doLogin(email, password, isManual = false) {
  const lp = $('#login-page');
  const errEl = lp?.querySelector('#login-error');
  const btn = lp?.querySelector('#login-submit');

  if (btn) { btn.disabled = true; btn.textContent = 'ENTERING...'; }
  if (errEl) errEl.classList.add('hidden');

  try {
    await authManager.login(email, password, isManual);
    if (authManager.userData && authManager.userData.passwordChanged) {
      showToast('Welcome back! 🎓', 'success');
    }
  } catch (err) {
    console.error('Login error:', err);
    let msg = 'Login failed. Please try again.';
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      msg = 'Invalid credentials. Only class members can login.';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Too many attempts. Please wait a moment.';
    } else if (err.code === 'auth/network-request-failed') {
      msg = 'Network error. Check your internet connection.';
    }
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    if (btn) { btn.disabled = false; btn.textContent = 'ENTER THE MEMORY LANE'; }
  }
}

function hideLogin() {
  const el = $('#login-page');
  if (el) el.classList.add('hidden');
}

// ===== APP SHELL =====
function buildAppShell() {
  const app = $('#app');
  app.classList.remove('hidden');
  app.innerHTML = `
    <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div class="flex items-center justify-between px-4 py-3">
        <div class="header-brand-group">
          <img src="/assets/class-memories-logo.png" alt="Class Memories" class="header-logo-img" />
          <h1>ClassMemories</h1>
        </div>
        <div class="flex items-center gap-1">
          <button id="btn-notifications" class="relative p-2 rounded-full hover:bg-cream-100 transition-colors">
            <svg class="w-5 h-5 text-navy-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg>
            <span id="notif-badge" class="hidden absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"></span>
          </button>
        </div>
      </div>
    </header>
    <main id="page-container" class="relative min-h-[calc(100vh-120px)]"></main>
  `;

  // Build nav (5 tabs) — chat icon gets a wrapper for the unread badge
  const navEl = $('#nav-buttons');
  navEl.innerHTML = NAV_ITEMS.map(n => {
    // Wrap the chat icon in a relative container with an unread badge
    const iconHTML = n.id === 'chat'
      ? `<div class="nav-icon-wrap">${n.icon}<span id="chat-unread-badge" class="chat-nav-badge hidden"></span></div>`
      : n.icon;
    return `
      <button data-page="${n.id}" class="nav-btn ${n.id === 'home' ? 'active' : ''} flex flex-col items-center py-1.5 px-3 transition-all ${n.id === 'upload' ? 'nav-btn-center' : ''}" id="nav-${n.id}">
        ${iconHTML}
        <span class="text-[10px] mt-0.5 font-medium">${n.label}</span>
      </button>
    `;
  }).join('');

  $('#bottom-nav').classList.remove('hidden');

  // Router — register all pages with lazy loading
  router.setContainer($('#page-container'));
  router.register('home', lazyPage('./pages/home.js', 'renderHome'));
  router.register('upload', lazyPage('./pages/upload.js', 'renderUpload'));
  router.register('search', lazyPage('./pages/search.js', 'renderSearch'));
  router.register('chat', lazyPage('./pages/chat.js', 'renderChat'));
  router.register('games', lazyPage('./pages/games.js', 'renderGames'));
  router.register('profile', lazyPage('./pages/profile.js', 'renderProfile'));
  router.register('notifications', lazyPage('./pages/notifications.js', 'renderNotifications'));
  router.register('diary', lazyPage('./pages/diary.js', 'renderDiary'));
  router.register('birthday', lazyPage('./pages/birthday.js', 'renderBirthday'));
  router.register('leaderboard', lazyPage('./pages/leaderboard.js', 'renderLeaderboard'));
  router.register('polls', lazyPage('./pages/polls.js', 'renderPolls'));
  router.register('feedback', lazyPage('./pages/feedback.js', 'renderFeedback'));

  navEl.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) router.navigate(page);
    });
  });

  // Notifications button
  $('#btn-notifications')?.addEventListener('click', () => router.navigate('notifications'));

  // Set up notification badge + FCM
  // IMPORTANT: Initialize FCM FIRST (registers unified SW + gets token),
  // THEN start Firestore listener. This ensures the push token is ready
  // before any notifications could arrive.
  if (notificationManager) {
    const badge = $('#notif-badge');
    notificationManager.setBadgeElement(badge);

    // 1. Initialize FCM (registers firebase-messaging-sw.js as unified SW)
    notificationManager.initFCM().then(() => {
      console.log('[App] FCM initialized, requesting push permission...');
      // Request push permission immediately — don't delay
      if ('Notification' in window && Notification.permission !== 'denied') {
        notificationManager.requestPushPermission();
      }
    }).catch(e => console.log('[App] FCM init:', e.message));

    // 2. Start Firestore notification listener (works independently of FCM)
    notificationManager.startListening();

    // Unlock audio on first user touch/click (required by mobile browsers)
    const unlockAudio = () => {
      if (notificationManager) notificationManager.unlockAudio();
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
  }

  // Start listening for incoming calls
  if (callManager) {
    callManager.listenForIncomingCalls();
    callManager.onIncomingCall = (call) => showIncomingCallUI(call);
  }

  // Start real-time chat unread badge listener
  startChatBadgeListener();

  // Start presence tracking (online/offline status)
  presenceManager.startPresenceTracking();

  router.navigate('home');

  // ===== HIDDEN OWNER CONTROL SYSTEM =====
  // Fully isolated from normal flow. Only loads if owner navigates to it via secret trigger.
  router.register('owner', async (container) => {
    if (!authManager.isOwner) {
      container.innerHTML = '<div class="flex items-center justify-center min-h-[50vh]"><p class="text-gray-400">Page not found</p></div>';
      return;
    }
    // Lazy load the sensitive owner panel code
    try {
      const ownerMod = await import('./pages/owner.js');
      await ownerMod.renderOwnerPanel(container);
    } catch (e) {
      console.error('Owner panel failed:', e);
      container.innerHTML = `<div class="p-8 bg-[#0f172a] text-red-500 min-h-screen">
        <h2 class="font-bold text-2xl mb-4">Module Import Error</h2>
        <pre class="bg-gray-900 p-4 rounded text-xs overflow-auto text-red-400">${e.message}\n\n${e.stack}</pre>
      </div>`;
    }
  });

  // Initialize festival theme system (non-blocking)
  import('./festival-themes.js').then(({ festivalManager }) => {
    festivalManager.init();
  }).catch(e => console.log('Festival themes init:', e));

  // Apply saved theme from localStorage (instant) and sync from Firestore
    // Debug script
    import('./firebase-config.js').then(({ db, getDocs, collection }) => {
      getDocs(collection(db, 'users')).then(snap => {
        let debugUsers = [];
        snap.forEach(d => debugUsers.push(d.data()));
        console.log('DEBUG USERS:', debugUsers.map(u => ({ name: u.fullName, photoURL: u.photoURL, profilePic: u.profilePic })));
      });
    });

    const savedTheme = localStorage.getItem('app_theme');
  if (savedTheme && savedTheme !== 'theme-cream') {
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
    document.body.classList.add(savedTheme);
  }
  // Sync theme from Firestore (in case user changed on another device)
  try {
    const userTheme = authManager.userData?.theme;
    if (userTheme && userTheme !== savedTheme) {
      localStorage.setItem('app_theme', userTheme);
      document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
      if (userTheme !== 'theme-cream') document.body.classList.add(userTheme);
    }
  } catch (e) { /* non-critical */ }

  // Page cleanup on navigation
  router.onNavigate = async (page) => {
    try {
      // Lazy cleanup for pages that support it
      if (page !== 'diary') {
        const { destroyDiary } = await import('./pages/diary.js').catch(() => ({}));
        if (destroyDiary) destroyDiary();
      }
      if (page !== 'polls') {
        const { destroyPolls } = await import('./pages/polls.js').catch(() => ({}));
        if (destroyPolls) destroyPolls();
      }
      if (page !== 'timecapsule') {
        const { destroyTimecapsule } = await import('./pages/timecapsule.js').catch(() => ({}));
        if (destroyTimecapsule) destroyTimecapsule();
      }
      if (page !== 'chat') {
        const { destroyChat } = await import('./pages/chat.js').catch(() => ({}));
        if (destroyChat) destroyChat();
      }
      if (page !== 'birthday') {
        const { destroyBirthday } = await import('./pages/birthday.js').catch(() => ({}));
        if (destroyBirthday) destroyBirthday();
      }
    } catch (e) { /* non-critical cleanup */ }
  };

  // PWA Install prompt
  setupPWAInstall();

  // Throwback Thursday check
  checkThrowbackThursday();

  // ===== Android Back Button & Hardware Back Button Logic =====
  let lastBackPress = 0;
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', (e) => {
    // Re-push state so we can catch it again
    history.pushState(null, '', location.href);
    
    // 1. Close any open modals first
    if (router.modalStack && router.modalStack.length > 0) {
      router.closeModal();
      return;
    }
    
    // 2. If on Home, handle double back exit
    if (router.currentPage === 'home') {
      const now = Date.now();
      if (now - lastBackPress < 2000) {
        if (navigator.app && navigator.app.exitApp) {
          navigator.app.exitApp();
        } else {
          window.close(); // Fallback for browsers if applicable
        }
      } else {
        showToast('Press again to exit');
        lastBackPress = now;
      }
    } else {
      // 3. From any other page, go to Home
      router.navigate('home');
    }
  });

  // Pending Tag Requests check
  checkPendingTags();
}

// ===== PENDING TAG REQUESTS MODAL =====
async function checkPendingTags() {
  if (!authManager.currentUser) return;
  
  // Only show once per session so it's not annoying
  if (sessionStorage.getItem('tag_checked')) return;
  sessionStorage.setItem('tag_checked', '1');

  try {
    const { getDocs, getDoc, collection, query, where } = await import('./firebase-config.js');
    const myUid = authManager.currentUser.uid;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', myUid),
      where('type', '==', 'tag_request'),
      where('handled', '==', false)
    );
    
    const snap = await getDocs(q);
    if (snap.empty) return;
    
    // Get the first unhandled tag request
    const notifDoc = snap.docs[0];
    const notif = notifDoc.data();
    
    // Fetch post details for the preview
    const postSnap = await getDoc(doc(db, 'posts', notif.postId));
    if (!postSnap.exists()) return;
    const post = postSnap.data();

    // Show Instagram/Facebook style popup card
    showTagRequestModal(notifDoc.id, notif, post);
  } catch (err) {
    console.error('Pending tags check failed:', err);
  }
}

function showTagRequestModal(notifId, notif, post) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-navy-900/40 backdrop-blur-md opacity-0 transition-opacity duration-300';
  
  const taggerName = sanitizeHTML(notif.title.replace('📸 ', '')); // Usually "Kaviraj tagged you..."
  const captionPreview = sanitizeHTML(post.caption || '');
  const imageUrl = post.imageUrls?.[0] || post.imageUrl || '';
  
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl transform scale-95 transition-transform duration-300">
      
      <!-- Top graphic/image -->
      ${imageUrl ? `
        <div class="h-48 w-full relative">
          <img src="${imageUrl}" class="w-full h-full object-cover" alt="Memory" />
          <div class="absolute inset-0 bg-gradient-to-t from-navy-900/80 to-transparent"></div>
          <div class="absolute bottom-3 left-4 right-4 text-white">
            <p class="text-xs font-semibold uppercase tracking-wider mb-1 text-cream-200">Pending Tag</p>
            <p class="text-sm line-clamp-2">${captionPreview}</p>
          </div>
        </div>
      ` : `
        <div class="h-32 w-full bg-gradient-to-br from-navy-500 to-navy-700 flex items-center justify-center text-white">
          <svg class="w-12 h-12 opacity-50" fill="none" stroke="currentColor" stroke-width="1" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0"/></svg>
        </div>
      `}
      
      <!-- Content -->
      <div class="p-6 text-center -mt-8 relative z-10">
        <div class="w-16 h-16 rounded-full border-4 border-white bg-cream-100 mx-auto shadow-md overflow-hidden mb-3">
          ${notif.icon ? `<img src="${notif.icon}" class="w-full h-full object-cover" />` : `<div class="w-full h-full flex items-center justify-center text-xl">👤</div>`}
        </div>
        <h3 class="font-bold text-navy-800 text-lg leading-tight mb-1">${taggerName}</h3>
        <p class="text-sm text-gray-500 mb-6">tagged you in a memory. Do you want to add this to your profile?</p>
        
        <div class="flex gap-3">
          <button id="tag-accept-popup" class="flex-1 py-3 bg-navy-500 text-white rounded-xl font-bold hover:bg-navy-600 transition-colors shadow-sm shadow-navy-500/30 flex items-center justify-center gap-2">
            ✅ Accept
          </button>
          <button id="tag-reject-popup" class="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors flex items-center justify-center gap-2">
            ❌ Reject
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.remove('opacity-0');
    overlay.querySelector('div').classList.remove('scale-95');
  });

  const close = () => {
    overlay.classList.add('opacity-0');
    overlay.querySelector('div').classList.add('scale-95');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('#tag-accept-popup').addEventListener('click', async () => {
    close();
    try {
      const { updateDoc, doc, setDoc, serverTimestamp } = await import('./firebase-config.js');
      const myUid = authManager.currentUser.uid;
      const postId = notif.postId;
      const postRef = doc(db, 'posts', postId);
      
      await updateDoc(postRef, {
        pendingTags: (await import('./firebase-config.js')).arrayRemove(myUid),
        taggedFriends: (await import('./firebase-config.js')).arrayUnion(myUid)
      });
      await setDoc(doc(db, 'users', myUid, 'taggedPosts', postId), { taggedAt: serverTimestamp() });
      await setDoc(doc(db, 'posts', postId, 'acceptedTags', myUid), { acceptedAt: serverTimestamp() });
      await updateDoc(doc(db, 'notifications', notifId), { handled: true, body: 'You accepted the tag request.', read: true });
      showToast('Added to your tagged memories!', 'success');
    } catch (e) { console.error(e); }
  });

  overlay.querySelector('#tag-reject-popup').addEventListener('click', async () => {
    close();
    try {
      const { updateDoc, doc } = await import('./firebase-config.js');
      const myUid = authManager.currentUser.uid;
      await updateDoc(doc(db, 'posts', notif.postId), {
        pendingTags: (await import('./firebase-config.js')).arrayRemove(myUid)
      });
      await updateDoc(doc(db, 'notifications', notifId), { handled: true, body: 'You rejected the tag request.', read: true });
    } catch (e) { console.error(e); }
  });
}

// ===== FORCED PASSWORD CHANGE MODAL =====
function showForcedPasswordModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center p-4 bg-navy-900/95 backdrop-blur-md transition-opacity duration-300';
    overlay.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center">
        <div class="text-4xl mb-2">🔒</div>
        <h2 class="text-2xl font-playfair font-bold text-navy-800 mb-2">Security Update Required</h2>
        <p class="text-xs text-gray-600 mb-6 leading-relaxed">
          For your account safety,<br/>
          your password cannot be your Date of Birth.<br/><br/>
          Please create a new secure password.
        </p>
        
        <form id="force-password-form" class="space-y-4 text-left">
          <div>
            <label class="text-xs font-bold text-navy-700 uppercase tracking-wider mb-1 block">Current Password</label>
            <input type="password" id="current-pass" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-navy-500 outline-none" placeholder="Current Password" required>
          </div>
          <div>
            <label class="text-xs font-bold text-navy-700 uppercase tracking-wider mb-1 block">New Password</label>
            <input type="password" id="new-pass" minlength="6" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-navy-500 outline-none" placeholder="New Password" required>
          </div>
          <div>
            <label class="text-xs font-bold text-navy-700 uppercase tracking-wider mb-1 block">Confirm Password</label>
            <input type="password" id="confirm-pass" minlength="6" class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-navy-500 outline-none" placeholder="Confirm Password" required>
          </div>
          <div id="pwd-error" class="text-red-500 text-xs hidden font-medium p-2 bg-red-50 rounded-xl text-center"></div>
          <button type="submit" id="pwd-submit" class="w-full bg-navy-600 text-white font-bold py-3.5 rounded-xl shadow-md hover:bg-navy-700 transition-colors mt-2">
            Update Password
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('#force-password-form');
    const errEl = overlay.querySelector('#pwd-error');
    const btn = overlay.querySelector('#pwd-submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const current = overlay.querySelector('#current-pass').value;
      const newPass = overlay.querySelector('#new-pass').value;
      const confirmPass = overlay.querySelector('#confirm-pass').value;
      const dob = authManager.userData?.dateOfBirth;

      if (newPass !== confirmPass) {
        errEl.textContent = 'New passwords do not match.';
        errEl.classList.remove('hidden');
        return;
      }
      if (newPass.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.';
        errEl.classList.remove('hidden');
        return;
      }
      if (dob && isDobPassword(newPass, dob)) {
        errEl.textContent = '❌ Your password cannot be your Date of Birth. Please choose a stronger password.';
        errEl.classList.remove('hidden');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Updating...';

      try {
        await authManager.changePassword(current, newPass);
        console.log("Password Updated");

        const dobVal = authManager.userData?.dateOfBirth;
        if (!isDobPassword(newPass, dobVal)) {
          console.log("DOB Check Passed");

          if (authManager.userData) {
            authManager.userData.passwordChanged = true;
            authManager.userData.forcePasswordChange = false;
            authManager.userData.mustChangePassword = false;
          }
          console.log("Force Password Flag Cleared");

          console.log("Refreshing User Session");
          if (authManager.currentUser) {
            await authManager._loadUserData(authManager.currentUser.uid);
          }

          overlay.remove();

          console.log("Navigating Home");
          router.navigate('home');

          await new Promise(r => setTimeout(r, 300));
          console.log("Home Loaded");

          console.log("Starting Playlist");
          startPlaylist();

          showToast('Password updated successfully! 🎓', 'success');
          resolve();
        } else {
          btn.disabled = false;
          btn.textContent = 'Update Password';
          errEl.textContent = '❌ Your password cannot be your Date of Birth. Please choose a stronger password.';
          errEl.classList.remove('hidden');
        }
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = 'Update Password';
        errEl.textContent = err.message || 'Failed to update password. Check your current password.';
        errEl.classList.remove('hidden');
      }
    });
  });
}

// ===== NEW PREMIUM CINEMATIC BIRTHDAY EXPERIENCE =====
let _birthdayAudioEngine = null;
window.hasPlayedBirthdayIntro = false;

window.showBirthdayIntro = function(startPlaylistAfter = false) {
  if (!authManager.currentUser) return false;

  if (!authManager.userData?.dateOfBirth) return false;

  const todayObj = new Date();
  const dob = new Date(authManager.userData.dateOfBirth);
  if (dob.getMonth() !== todayObj.getMonth() || dob.getDate() !== todayObj.getDate()) return false;

  // Format today's date in YYYY-MM-DD format
  const year = todayObj.getFullYear();
  const month = String(todayObj.getMonth() + 1).padStart(2, '0');
  const day = String(todayObj.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  // Check if the Birthday Intro was already shown today
  if (localStorage.getItem("birthdayIntroLastShown") === todayStr) {
    return false;
  }

  const completed = sessionStorage.getItem("birthdayIntroCompleted") === "true";
  if (completed) return false;
  if (window.hasPlayedBirthdayIntro) return false;

  // Record that the Birthday Intro is successfully shown today
  localStorage.setItem("birthdayIntroLastShown", todayStr);

  window.hasPlayedBirthdayIntro = true;
  const name = authManager.userData.fullName || 'Friend';

  // Ensure no other music is playing during Birthday Intro
  if (typeof MusicPlayer !== 'undefined' && MusicPlayer.bgAudio) {
    MusicPlayer.bgAudio.pause();
  }

  // ── Web Audio API Synthesizer ──
  class BirthdayAudioEngine {
    constructor() {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.setValueAtTime(0.12, this.ctx.currentTime); // Soft background start
      this.playing = false;
      this.tempo = 145; // BPM
      this.noteIndex = 0;
      this.nextNoteTime = 0;

      // Happy Birthday Melody
      this.melody = [
        { note: 'C4', dur: 0.75 }, { note: 'C4', dur: 0.25 }, { note: 'D4', dur: 1 }, { note: 'C4', dur: 1 }, { note: 'F4', dur: 1 }, { note: 'E4', dur: 2 },
        { note: 'C4', dur: 0.75 }, { note: 'C4', dur: 0.25 }, { note: 'D4', dur: 1 }, { note: 'C4', dur: 1 }, { note: 'G4', dur: 1 }, { note: 'F4', dur: 2 },
        { note: 'C4', dur: 0.75 }, { note: 'C4', dur: 0.25 }, { note: 'C5', dur: 1 }, { note: 'A4', dur: 1 }, { note: 'F4', dur: 1 }, { note: 'E4', dur: 1 }, { note: 'D4', dur: 2 },
        { note: 'Bb4', dur: 0.75 }, { note: 'Bb4', dur: 0.25 }, { note: 'A4', dur: 1 }, { note: 'F4', dur: 1 }, { note: 'G4', dur: 1 }, { note: 'F4', dur: 2 }
      ];

      this.freqs = {
        'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'Bb4': 466.16, 'C5': 523.25
      };
    }

    start() {
      if (this.playing) return;
      this.playing = true;
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.scheduler();
    }

    scheduler() {
      if (!this.playing) return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
        this.playMelodyNote(this.melody[this.noteIndex], this.nextNoteTime);
        const secondsPerBeat = 60.0 / this.tempo;
        this.nextNoteTime += this.melody[this.noteIndex].dur * secondsPerBeat;
        this.noteIndex = (this.noteIndex + 1) % this.melody.length;
      }
      this.timerId = setTimeout(() => this.scheduler(), 25);
    }

    playMelodyNote(noteData, time) {
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();

      osc.type = 'triangle';
      osc2.type = 'sine';

      const freq = this.freqs[noteData.note];
      osc.frequency.setValueAtTime(freq, time);
      osc2.frequency.setValueAtTime(freq * 2, time); // Octave chime

      noteGain.gain.setValueAtTime(0, time);
      noteGain.gain.linearRampToValueAtTime(0.3, time + 0.03);
      const duration = noteData.dur * (60.0 / this.tempo);
      noteGain.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.02);

      osc.connect(noteGain);
      osc2.connect(noteGain);
      noteGain.connect(this.masterGain);

      osc.start(time);
      osc2.start(time);
      osc.stop(time + duration);
      osc2.stop(time + duration);
    }

    setVolume(vol, fadeTime = 0) {
      if (fadeTime > 0) {
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime);
        this.masterGain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + fadeTime);
      } else {
        this.masterGain.gain.setValueAtTime(vol, this.ctx.currentTime);
      }
    }

    playCutSound() {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.5);

      gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.5);
    }

    playExplosionSound() {
      const bufferSize = this.ctx.sampleRate * 1.5;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 1.2);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.8, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noise.start();
      noise.stop(this.ctx.currentTime + 1.2);
    }

    stop() {
      this.playing = false;
      clearTimeout(this.timerId);
      this.setVolume(0, 1.0);
      setTimeout(() => {
        this.ctx.close();
      }, 1100);
    }
  }

  // Initialize Audio
  _birthdayAudioEngine = new BirthdayAudioEngine();

  // ── Build HTML Structure ──
  const overlay = document.createElement('div');
  overlay.className = 'cinematic-birthday-overlay';

  const vignette = document.createElement('div');
  vignette.className = 'cb-vignette';
  overlay.appendChild(vignette);

  const grain = document.createElement('div');
  grain.className = 'cb-grain';
  overlay.appendChild(grain);

  const flash = document.createElement('div');
  flash.className = 'cb-flash';
  overlay.appendChild(flash);

  const viewport = document.createElement('div');
  viewport.className = 'cb-viewport';
  overlay.appendChild(viewport);

  // Decorative Flags with attached bulbs (Layer 9)
  const flagsContainer = document.createElement('div');
  flagsContainer.className = 'cb-flags';
  for (let i = 0; i < 16; i++) {
    const f = document.createElement('div');
    f.className = 'cb-flag';
    
    // Bulb attachment
    const bulb = document.createElement('div');
    bulb.className = 'cb-bulb';
    f.appendChild(bulb);

    flagsContainer.appendChild(f);
  }
  viewport.appendChild(flagsContainer);

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'cb-canvas';
  viewport.appendChild(canvas);

  // ── SCREEN 1 — PERSONAL GREETING ──
  const screen1 = document.createElement('div');
  screen1.className = 'cb-screen-1';
  viewport.appendChild(screen1);

  const s1TitleContainer = document.createElement('div');
  s1TitleContainer.className = 'cb-s1-title-container';
  screen1.appendChild(s1TitleContainer);

  const s1Title = document.createElement('h1');
  s1Title.className = 'cb-s1-title';
  s1TitleContainer.appendChild(s1Title);

  const s1Ribbon = document.createElement('div');
  s1Ribbon.className = 'cb-s1-ribbon';
  s1Ribbon.textContent = 'Today is Your Birthday 🎂🎉';
  screen1.appendChild(s1Ribbon);

  const s1Btn = document.createElement('button');
  s1Btn.className = 'cb-s1-btn';
  s1Btn.textContent = '🎁 Continue Celebration';
  screen1.appendChild(s1Btn);

  // ── SCREEN 2 — GRAND CELEBRATION ──
  const screen2 = document.createElement('div');
  screen2.className = 'cb-screen-2';
  viewport.appendChild(screen2);

  const s2Header = document.createElement('div');
  s2Header.className = 'cb-s2-header';
  screen2.appendChild(s2Header);

  const s2TitleMain = document.createElement('h1');
  s2TitleMain.className = 'cb-s2-title-main';
  s2TitleMain.innerHTML = '🎉 HAPPY BIRTHDAY';
  s2Header.appendChild(s2TitleMain);

  const s2Name = document.createElement('h1');
  s2Name.className = 'cb-s2-name';
  s2Name.textContent = name;
  s2Header.appendChild(s2Name);

  const s2Quote = document.createElement('p');
  s2Quote.className = 'cb-s2-quote';
  s2Quote.innerHTML = '🎂Wishing you a Very Happy Birthday! Stay Blessed Always,<br>💐May Your Life Be Filled With Happiness and Success,<br>💖Keep Smiling and Creating Beautiful Memories,<br>💫May Every Dream and Wish Come True';
  s2Header.appendChild(s2Quote);

  // Enter Button
  const enterBtn = document.createElement('button');
  enterBtn.className = 'cb-enter-btn';
  enterBtn.textContent = '✨ Enter Class Memories';
  screen2.appendChild(enterBtn);

  // 3D Cake Scene
  const cakeScene = document.createElement('div');
  cakeScene.className = 'cb-cake-container';
  
  cakeScene.innerHTML = `
    <div class="cb-cake-shadow"></div>
    <div class="cb-plate"><div class="cb-plate-reflection"></div></div>
  `;

  // Draw 3 tiers
  const tiersConfig = [
    { cls: 'cb-tier-3', w: 140, h: 60 },
    { cls: 'cb-tier-2', w: 190, h: 68 },
    { cls: 'cb-tier-1', w: 240, h: 75 }
  ];

  tiersConfig.forEach(cfg => {
    const t = document.createElement('div');
    t.className = `cb-cake-tier ${cfg.cls}`;
    t.innerHTML = `
      <div class="cb-cake-drips"></div>
      <div class="cb-strawberries">
        <div class="cb-strawberry"></div>
        <div class="cb-strawberry"></div>
        <div class="cb-strawberry"></div>
      </div>
      <div class="cb-gold-star" style="left: 15%; top: 40%;"></div>
      <div class="cb-gold-star" style="right: 20%; top: 30%;"></div>
      <div class="cb-tier-sponge-left"></div>
    `;
    cakeScene.appendChild(t);
  });

  // Candles row
  const candlesRow = document.createElement('div');
  candlesRow.className = 'cb-cake-candles';
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('div');
    c.className = 'cb-cake-candle';
    c.innerHTML = '<div class="cb-cake-candle-flame"></div>';
    candlesRow.appendChild(c);
  }
  cakeScene.appendChild(candlesRow);

  const glow = document.createElement('div');
  glow.className = 'cb-candle-glow';
  cakeScene.appendChild(glow);

  // Slice
  const sliceReveal = document.createElement('div');
  sliceReveal.className = 'cb-slice-reveal';
  sliceReveal.innerHTML = `
    <div class="cb-slice-body">
      <div class="cb-slice-frosting"></div>
    </div>
  `;
  cakeScene.appendChild(sliceReveal);

  // Interactive Knife
  const knife = document.createElement('div');
  knife.className = 'cb-cutting-knife';
  knife.innerHTML = `
    <div class="cb-cutting-knife-blade"></div>
    <div class="cb-cutting-knife-handle"></div>
  `;
  cakeScene.appendChild(knife);

  // Tap hint
  const tapHint = document.createElement('div');
  tapHint.className = 'cb-tap-hint';
  tapHint.style.opacity = '0';
  tapHint.style.transition = 'opacity 0.6s';
  tapHint.textContent = '👇 Tap the Cake';
  cakeScene.appendChild(tapHint);

  // Animated Hand Pointer
  const handPointer = document.createElement('div');
  handPointer.className = 'cb-hand-pointer';
  handPointer.textContent = '👇';
  cakeScene.appendChild(handPointer);

  screen2.appendChild(cakeScene);
  document.body.appendChild(overlay);

  // ── Canvas Particle Engine ──
  const ctx = canvas.getContext('2d');
  let animationFrameId = null;
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;
  
  // Layer variables
  let rayAngle = 0;
  let bokehCircles = [];
  let dustParticles = [];
  let sparkleStars = [];
  let particles = [];

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const R = Math.random;
  const colors = ['#ffd700', '#ffffff', '#ff69b4', '#8a2be2', '#1e90ff'];

  // Layer 2 & 5: Large Ambient Glowing Bokeh Circles
  class BokehCircle {
    constructor() {
      this.reset();
      this.y = R() * height;
    }
    reset() {
      this.x = R() * width;
      this.y = height + 100;
      this.size = 80 + R() * 160;
      this.color = ['#ffd700', '#f48fb1', '#8a2be2', '#1e90ff'][Math.floor(R() * 4)];
      this.vx = (R() - 0.5) * 0.22;
      this.vy = -0.15 - R() * 0.3;
      this.alpha = 0.05 + R() * 0.08;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.y < -this.size) this.reset();
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
      grad.addColorStop(0, this.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Layer 4 & 6: Glowing Particles & Golden Dust
  class DustParticle {
    constructor() {
      this.reset();
      this.y = R() * height;
    }
    reset() {
      this.x = R() * width;
      this.y = height + 10;
      this.size = R() < 0.4 ? (0.6 + R() * 0.6) : (1.4 + R() * 2.0); // tiny dust or tiny particles
      this.color = R() < 0.7 ? '#ffd700' : ['#ffffff', '#f48fb1', '#1e90ff'][Math.floor(R() * 3)];
      this.vx = (R() - 0.5) * 0.18;
      this.vy = -0.18 - R() * 0.4;
      this.alpha = 0.15 + R() * 0.6;
      this.angleVal = R() * Math.PI * 2;
      this.twinkleSpeed = 0.02 + R() * 0.04;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.angleVal += this.twinkleSpeed;
      if (this.y < -10) this.reset();
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha * (0.45 + Math.sin(this.angleVal) * 0.35); // twinkling
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Layer 10: Twinkling Sparkle Stars
  class SparkleStar {
    constructor() {
      this.reset();
    }
    reset() {
      this.x = R() * width;
      this.y = R() * height * 0.85;
      this.size = 3.5 + R() * 4.5;
      this.color = R() < 0.8 ? '#ffd700' : '#ffffff';
      this.alpha = 0;
      this.maxAlpha = 0.25 + R() * 0.55;
      this.phase = 'grow';
      this.speed = 0.007 + R() * 0.012;
    }
    update() {
      if (this.phase === 'grow') {
        this.alpha += this.speed;
        if (this.alpha >= this.maxAlpha) this.phase = 'shrink';
      } else {
        this.alpha -= this.speed;
        if (this.alpha <= 0) this.reset();
      }
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - this.size);
      ctx.lineTo(this.x + this.size * 0.3, this.y);
      ctx.lineTo(this.x, this.y + this.size);
      ctx.lineTo(this.x - this.size * 0.3, this.y);
      ctx.closePath();
      ctx.shadowBlur = 10;
      ctx.shadowColor = this.color;
      ctx.fill();
      ctx.restore();
    }
  }

  // Active Confetti & Explosions Particles
  class DynamicParticle {
    constructor(x, y, type, color, angle, speed, decay, size, emoji = '') {
      this.x = x;
      this.y = y;
      this.type = type;
      this.color = color;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.gravity = (type === 'fountain' || type === 'spark' || type === 'crumb') ? 0.18 : 0;
      this.alpha = 1;
      this.decay = decay || 0.015;
      this.size = size || 3;
      this.emoji = emoji;
      this.angleVal = R() * Math.PI * 2;
      this.spinSpeed = (R() - 0.5) * 0.1;
      this.trail = [];
    }

    update() {
      if (this.type === 'fountain' || this.type === 'spark') {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 5) this.trail.shift();
      }
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.alpha -= this.decay;
      this.angleVal += this.spinSpeed;
    }

    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      
      if (this.emoji) {
        ctx.font = `${this.size * 2.2}px Arial`;
        ctx.fillText(this.emoji, this.x, this.y);
      } else if (this.type === 'fountain' || this.type === 'spark') {
        if (this.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(this.trail[0].x, this.trail[0].y);
          for (let i = 1; i < this.trail.length; i++) {
            ctx.lineTo(this.trail[i].x, this.trail[i].y);
          }
          ctx.strokeStyle = this.color;
          ctx.lineWidth = this.size;
          ctx.stroke();
        }
      } else if (this.type === 'balloon') {
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, this.size, this.size * 1.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(this.x, this.y + this.size * 1.3);
        ctx.lineTo(this.x + Math.sin(this.angleVal) * 5, this.y + this.size * 1.3 + 12);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (this.type === 'confetti') {
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angleVal);
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size, -this.size / 2, this.size * 2, this.size);
      } else if (this.type === 'smoke') {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,200,200,0.15)';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Populate ambient arrays
  for (let i = 0; i < 8; i++) bokehCircles.push(new BokehCircle());
  for (let i = 0; i < 70; i++) dustParticles.push(new DustParticle());
  for (let i = 0; i < 20; i++) sparkleStars.push(new SparkleStar());

  function loop() {
    ctx.clearRect(0, 0, width, height);

    // ── Layer 3: Rotating spotlights ──
    rayAngle += 0.0012;
    
    // Left beam
    ctx.save();
    ctx.translate(0, 0);
    ctx.globalAlpha = 0.055;
    let gradL = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(width, height));
    gradL.addColorStop(0, 'rgba(212,175,55,0.3)');
    gradL.addColorStop(0.5, 'rgba(138,43,226,0.08)');
    gradL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradL;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const angleL = Math.PI / 4 + Math.sin(rayAngle) * 0.12;
    ctx.lineTo(Math.cos(angleL - 0.12) * Math.max(width, height), Math.sin(angleL - 0.12) * Math.max(width, height));
    ctx.lineTo(Math.cos(angleL + 0.12) * Math.max(width, height), Math.sin(angleL + 0.12) * Math.max(width, height));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Right beam
    ctx.save();
    ctx.translate(width, 0);
    ctx.globalAlpha = 0.055;
    let gradR = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(width, height));
    gradR.addColorStop(0, 'rgba(30,144,255,0.3)');
    gradR.addColorStop(0.5, 'rgba(244,143,177,0.08)');
    gradR.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradR;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const angleR = 3 * Math.PI / 4 - Math.sin(rayAngle * 1.1) * 0.12;
    ctx.lineTo(Math.cos(angleR - 0.12) * Math.max(width, height), Math.sin(angleR - 0.12) * Math.max(width, height));
    ctx.lineTo(Math.cos(angleR + 0.12) * Math.max(width, height), Math.sin(angleR + 0.12) * Math.max(width, height));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ── Update & Draw Layer 2 & 5 (Bokeh Ambient Circles) ──
    bokehCircles.forEach(c => {
      c.update();
      c.draw();
    });

    // ── Update & Draw Layer 4 & 6 (Dust & Tiny Particles) ──
    dustParticles.forEach(d => {
      d.update();
      d.draw();
    });

    // ── Update & Draw Layer 10 (Sparkles Stars) ──
    sparkleStars.forEach(s => {
      s.update();
      s.draw();
    });

    // ── Update & Draw Active celebration particles ──
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update();
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      } else {
        p.draw();
      }
    }

    animationFrameId = requestAnimationFrame(loop);
  }
  loop();

  // Ambient celebration elements triggers
  let ambientSparklesInterval = null;
  let ambientConfettiInterval = null;
  let ambientBalloonsInterval = null;

  function startAmbientEffects() {
    // Drifting sparkles
    ambientSparklesInterval = setInterval(() => {
      if (particles.length < 150) {
        particles.push(new DynamicParticle(
          R() * width, R() * height * 0.8, 'sparkle',
          '#ffd700', R() * Math.PI * 2, 0.2 + R() * 0.5,
          0.01, 1.5 + R() * 2
        ));
      }
    }, 120);

    // Continuous confetti falling
    ambientConfettiInterval = setInterval(() => {
      if (particles.length < 250) {
        particles.push(new DynamicParticle(
          R() * width, -10, 'confetti',
          colors[Math.floor(R() * colors.length)],
          Math.PI / 2 + (R() - 0.5) * 0.3,
          1.8 + R() * 2.5,
          0.008,
          4 + R() * 5
        ));
      }
    }, 60);

    // Continuous rising balloons
    ambientBalloonsInterval = setInterval(() => {
      if (particles.length < 40) {
        particles.push(new DynamicParticle(
          R() * width, height + 40, 'balloon',
          colors[Math.floor(R() * colors.length)],
          -Math.PI / 2 + (R() - 0.5) * 0.2,
          1.2 + R() * 2.0,
          0.004,
          13 + R() * 8
        ));
      }
    }, 1200);
  }

  function triggerExplosion(x, y, count) {
    _birthdayAudioEngine.playExplosionSound();
    for (let i = 0; i < count; i++) {
      const angle = R() * Math.PI * 2;
      const speed = 4 + R() * 11;
      particles.push(new DynamicParticle(
        x, y, 'spark',
        colors[Math.floor(R() * colors.length)],
        angle, speed,
        0.014 + R() * 0.01,
        2 + R() * 3
      ));
    }
  }

  // Left bottom -> shoot diagonally to TOP RIGHT
  // Right bottom -> shoot diagonally to TOP LEFT
  function triggerDiagonalFireworks() {
    _birthdayAudioEngine.playExplosionSound();
    // Left bottom diagonal shooter
    for (let i = 0; i < 45; i++) {
      particles.push(new DynamicParticle(
        0, height, 'fountain', 
        colors[Math.floor(R() * colors.length)], 
        -Math.PI / 4 + (R() - 0.5) * 0.2, 
        12 + R() * 9, 
        0.012, 
        2.5 + R() * 3
      ));
    }
    // Right bottom diagonal shooter
    for (let i = 0; i < 45; i++) {
      particles.push(new DynamicParticle(
        width, height, 'fountain', 
        colors[Math.floor(R() * colors.length)], 
        -3 * Math.PI / 4 + (R() - 0.5) * 0.2, 
        12 + R() * 9, 
        0.012, 
        2.5 + R() * 3
      ));
    }
  }

  // LEFT TOP -> firework shoots to RIGHT
  // RIGHT TOP -> firework shoots to LEFT
  function triggerHorizontalFireworks() {
    _birthdayAudioEngine.playExplosionSound();
    // Left top shooter heading right
    for (let i = 0; i < 50; i++) {
      particles.push(new DynamicParticle(
        0, height * 0.15, 'fountain',
        colors[Math.floor(R() * colors.length)],
        (R() - 0.5) * 0.35,
        14 + R() * 10,
        0.012,
        2.5 + R() * 3
      ));
    }
    // Right top shooter heading left
    for (let i = 0; i < 50; i++) {
      particles.push(new DynamicParticle(
        width, height * 0.15, 'fountain',
        colors[Math.floor(R() * colors.length)],
        Math.PI + (R() - 0.5) * 0.35,
        14 + R() * 10,
        0.012,
        2.5 + R() * 3
      ));
    }
  }

  function triggerCelebrationSparksAndHearts(cutX, bottomY) {
    const gifts = ['🎁', '💝', '⭐', '❤️', '💖'];
    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        particles.push(new DynamicParticle(
          cutX + (R() - 0.5) * 70,
          bottomY - 40,
          'gift', '#ffd700',
          -Math.PI / 2 + (R() - 0.5) * 1.2,
          5 + R() * 8,
          0.015 + R() * 0.01,
          12 + R() * 12,
          gifts[Math.floor(R() * gifts.length)]
        ));
      }, i * 60);
    }
  }

  // ── Async Timeline Sequencer ──
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Character-by-character typist
  const typeText = async (element, text, speed = 80) => {
    element.innerHTML = '';
    for (let char of text) {
      if (char === '\n') {
        element.innerHTML += '<br>';
      } else {
        element.innerHTML += char;
      }
      await delay(speed);
    }
  };

  // Stage 1: 👋 Hello, Name (2 seconds)
  const showHello = async () => {
    console.log("Stage 1 Started");
    try {
      s1Title.classList.add('visible');
      await typeText(s1Title, `👋 Hello...Ready To 🎂 Birthday 🥳 Celebration ? ,\n${name}`, 95);
      await delay(1200); 
      console.log("Stage 1 Completed");
    } catch (e) {
      console.error("Stage 1 Failed:", e);
      throw e;
    }
  };

  // Stage 2: Ribbon Today is your Birthday (2 seconds)
  const showTodayBirthday = async () => {
    console.log("Stage 2 Started");
    try {
      s1Title.classList.remove('visible');
      await delay(600);
      s1Ribbon.classList.add('visible');
      
      // Spark explosion behind the ribbon
      for (let i = 0; i < 15; i++) {
        particles.push(new DynamicParticle(
          width / 2 + (R() - 0.5) * 100,
          height * 0.4 + (R() - 0.5) * 50,
          'spark', '#ffd700',
          R() * Math.PI * 2,
          1.5 + R() * 3,
          0.02,
          2
        ));
      }

      await delay(2000);
      s1Ribbon.classList.remove('visible');
      await delay(600);
      console.log("Stage 2 Completed");
    } catch (e) {
      console.error("Stage 2 Failed:", e);
      throw e;
    }
  };

  // Stage 3: Continue button for transition to Screen 2
  const showContinueButton = async () => {
    console.log("Stage 3 Started");
    try {
      s1Btn.classList.add('visible');
      
      // Wait for Continue button click
      await new Promise(resolve => {
        const onS1BtnClick = (e) => {
          e.stopPropagation();
          s1Btn.removeEventListener('click', onS1BtnClick);
          resolve();
        };
        s1Btn.addEventListener('click', onS1BtnClick);
      });

      // Transition to Screen 2
      console.log("Transition to Screen 2 Triggered");
      flash.classList.add('trigger');
      viewport.classList.add('zoom-blur');
      _birthdayAudioEngine.playExplosionSound();

      // Confetti burst on flash
      for (let i = 0; i < 60; i++) {
        particles.push(new DynamicParticle(
          width / 2 + (R() - 0.5) * 300,
          height * 0.4 + (R() - 0.5) * 150,
          'confetti', colors[Math.floor(R() * colors.length)],
          R() * Math.PI * 2,
          3 + R() * 6,
          0.01,
          5
        ));
      }

      await delay(250);
      screen1.classList.add('hidden');
      screen2.classList.add('active');

      await delay(350);
      viewport.classList.remove('zoom-blur');
      
      console.log("Stage 3 Completed");
    } catch (e) {
      console.error("Stage 3 Failed:", e);
      throw e;
    }
  };

  // Stage 4: Screen 2 Happy Birthday & music start (5 seconds)
  const showHappyBirthday = async () => {
    console.log("Stage 4 Started");
    try {
      // Audio engine starts at the exact transition to Screen 2 celebration
      _birthdayAudioEngine.start();
      _birthdayAudioEngine.setVolume(0.38, 2.0);

      startAmbientEffects();
      
      // Launch diagonal fireworks from bottom corners
      triggerDiagonalFireworks();

      await delay(5000);
      console.log("Stage 4 Completed");
    } catch (e) {
      console.error("Stage 4 Failed:", e);
      throw e;
    }
  };

  // Stage 5: Cake Rises (2 seconds)
  const showCake = async () => {
    console.log("Cake Stage Started");
    try {
      cakeScene.classList.add('active');
      await delay(2000);
      console.log("Cake Displayed");
    } catch (e) {
      console.error("Cake Stage Failed:", e);
      throw e;
    }
  };

  // Stage 6 & 7: Tap cake and slice
  const waitForCakeClick = async () => {
    console.log("Waiting for Cake Click Started");
    try {
      tapHint.style.opacity = '1';
      handPointer.style.opacity = '1';
      let cakeTapped = false;
      await new Promise((resolve, reject) => {
        const onCakeClick = (e) => {
          try {
            if (cakeTapped) return;
            cakeTapped = true;
            console.log("Cake Clicked");
            e.stopPropagation();
            cakeScene.removeEventListener('click', onCakeClick);
            
            tapHint.style.opacity = '0';
            handPointer.style.opacity = '0';

            // Execute cut animation
            cakeScene.classList.add('cutting');
            _birthdayAudioEngine.playCutSound();
            
            setTimeout(() => {
              try {
                cakeScene.classList.remove('cutting');
                cakeScene.classList.add('cut');

                // Split cake halves
                cakeScene.querySelectorAll('.cb-cake-tier').forEach(tier => {
                  const shell = tier.querySelector('.cb-cake-drips');
                  if (!shell) return;
                  const rightShell = shell.cloneNode(true);
                  rightShell.className = 'cb-cake-drips right-half';
                  shell.className = 'cb-cake-drips left-half';
                  tier.appendChild(rightShell);
                });

                // Extinguish flames
                cakeScene.querySelectorAll('.cb-cake-candle-flame').forEach((flame, idx) => {
                  setTimeout(() => flame.classList.add('out'), idx * 80);
                });
                const glowEl = cakeScene.querySelector('.cb-candle-glow');
                if (glowEl) glowEl.style.opacity = '0';

                // Screen shake
                overlay.classList.add('shake');
                setTimeout(() => overlay.classList.remove('shake'), 500);

                // Crumbs, smoke
                const sr = cakeScene.getBoundingClientRect();
                const cutX = sr.left + sr.width / 2;
                const bottomY = sr.top + sr.height - 80;

                // Crumbs
                for (let i = 0; i < 45; i++) {
                  particles.push(new DynamicParticle(
                    cutX + (R() - 0.5) * 12,
                    bottomY - R() * 120,
                    'crumb', '#d4af37',
                    -Math.PI/2 + (R() - 0.5) * 1.5,
                    2 + R() * 5,
                    0.02 + R() * 0.02,
                    1.5 + R() * 3
                  ));
                }

                // Smoke
                for (let i = 0; i < 18; i++) {
                  particles.push(new DynamicParticle(
                    cutX, bottomY - R() * 140,
                    'smoke', '#cccccc',
                    -Math.PI/2 + (R() - 0.5) * 0.4,
                    0.8 + R() * 1.2,
                    0.015,
                    10 + R() * 15
                  ));
                }

                resolve();
              } catch (innerErr) {
                reject(innerErr);
              }
            }, 1500);
          } catch (clickErr) {
            reject(clickErr);
          }
        };
        cakeScene.addEventListener('click', onCakeClick);
      });
      console.log("Cake Slicing Completed");
    } catch (e) {
      console.error("Waiting for Cake Click / Slicing Failed:", e);
      throw e;
    }
  };

  // Stage 8: Horizontal top shooting fireworks and celebration explosion
  const playCelebration = async () => {
    console.log("Celebration Started");
    try {
      triggerHorizontalFireworks();

      const sr = cakeScene.getBoundingClientRect();
      const cutX = sr.left + sr.width / 2;
      const bottomY = sr.top + sr.height - 80;
      triggerCelebrationSparksAndHearts(cutX, bottomY);

      // Explosions
      triggerExplosion(width * 0.5, height * 0.25, 90);
      triggerExplosion(width * 0.2, height * 0.35, 75);
      triggerExplosion(width * 0.8, height * 0.35, 75);

      // Wave 2
      setTimeout(() => {
        triggerExplosion(width * 0.35, height * 0.45, 60);
        triggerExplosion(width * 0.65, height * 0.45, 60);
      }, 1500);

      // Floating balloons
      for (let i = 0; i < 20; i++) {
        setTimeout(() => {
          particles.push(new DynamicParticle(
            R() * width, height + 40, 'balloon',
            colors[Math.floor(R() * colors.length)],
            -Math.PI / 2 + (R() - 0.5) * 0.2,
            1.5 + R() * 2.5,
            0.004,
            14 + R() * 10
          ));
        }, i * 150);
      }

      await delay(5000);
      console.log("Celebration Completed");
    } catch (e) {
      console.error("Celebration Failed:", e);
      throw e;
    }
  };

  // Stage 9: Show final dismiss button
  const showEnterButton = async () => {
    console.log("Showing Enter Button");
    try {
      s2Header.style.opacity = '0';
      s2Header.style.transition = 'opacity 0.6s';
      await delay(600);
      
      s2TitleMain.innerHTML = '🎉Celebrate <br> Every Beautiful Moment❤️';
      s2Name.innerHTML = name;
      s2Quote.innerHTML = '';
      
      enterBtn.classList.add('visible');
      s2Header.style.opacity = '1';
      console.log("Enter Button Displayed");
    } catch (e) {
      console.error("Showing Enter Button Failed:", e);
      throw e;
    }
  };

  async function runTimeline() {
    try {
      console.log("Timeline Init: overlay active");
      overlay.classList.add('active');
      await delay(100);

      await showHello();
      await showTodayBirthday();
      await showContinueButton();
      await showHappyBirthday();
      await showCake();
      await waitForCakeClick();
      await playCelebration();
      await showEnterButton();
    } catch (err) {
      console.error("Timeline Execution Halted due to Error:", err);
    }
  }

  // Run Sequencer Timeline
  runTimeline();
  


  // ── Enter App ──
  enterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // Fade out and Stop Audio Engine
    if (_birthdayAudioEngine) {
      _birthdayAudioEngine.stop();
      _birthdayAudioEngine = null;
    }

    sessionStorage.setItem("birthdayIntroCompleted", "true");

    clearInterval(ambientSparklesInterval);
    clearInterval(ambientConfettiInterval);
    clearInterval(ambientBalloonsInterval);
    cancelAnimationFrame(animationFrameId);

    overlay.style.transition = 'opacity 1.0s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      router.navigate('home');
      
      if (typeof window._onBirthdayIntroComplete === 'function') {
        window._onBirthdayIntroComplete();
        window._onBirthdayIntroComplete = null;
      }
    }, 1100); // Wait 1.1s to ensure audio engine is fully destroyed
  });

  return true;
}

// ===== THROWBACK THURSDAY =====
async function checkThrowbackThursday() {
  const today = new Date();
  if (today.getDay() !== 4) return; // 4 = Thursday

  const tbtKey = 'tbt_shown_' + today.toDateString();
  if (sessionStorage.getItem(tbtKey)) return;

  if (!authManager.currentUser) return;

  try {
    const { db, collection, query, where, orderBy, limit, getDocs } = await import('./firebase-config.js');
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const q = query(
      collection(db, 'posts'),
      where('authorId', '==', authManager.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const snap = await getDocs(q);
    const oldPosts = [];
    snap.forEach(d => {
      const post = { id: d.id, ...d.data() };
      if (post.createdAt?.toDate && post.createdAt.toDate() < oneWeekAgo && post.imageUrl) {
        oldPosts.push(post);
      }
    });

    if (oldPosts.length === 0) return;

    sessionStorage.setItem(tbtKey, '1');
    showThrowbackPopup(oldPosts.slice(0, 5));
  } catch (e) {
    console.error('TBT check failed:', e);
  }
}

function showThrowbackPopup(posts) {
  let currentSlide = 0;
  const overlay = document.createElement('div');
  overlay.className = 'tbt-overlay';
  overlay.innerHTML = `
    <div class="tbt-card">
      <div class="p-4 text-center border-b border-gray-100">
        <p class="text-xs text-gray-400 uppercase tracking-wider font-semibold">Throwback Thursday</p>
        <h3 class="text-lg font-bold text-navy-800 mt-1">Memories from the past...</h3>
      </div>
      <div class="tbt-slideshow">
        ${posts.map((p, i) => `
          <div class="tbt-slide ${i === 0 ? 'active' : ''}" data-idx="${i}">
            <img src="${p.imageUrl}" alt="" loading="lazy"/>
          </div>
        `).join('')}
      </div>
      <div class="tbt-dots">
        ${posts.map((_, i) => `<div class="tbt-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></div>`).join('')}
      </div>
      <div class="p-4">
        <p class="font-handwriting text-base text-navy-700 text-center" id="tbt-caption">${posts[0]?.caption || 'A beautiful memory...'}</p>
        <p class="text-[10px] text-gray-400 text-center mt-1" id="tbt-date">${posts[0]?.createdAt?.toDate ? posts[0].createdAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</p>
      </div>
      <div class="flex gap-2 px-4 pb-4">
        <button id="tbt-dismiss" class="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500">Dismiss</button>
        <button id="tbt-share" class="flex-1 py-2.5 rounded-xl bg-navy-500 text-white text-sm font-semibold">Share Again</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Auto slideshow
  const slides = overlay.querySelectorAll('.tbt-slide');
  const dots = overlay.querySelectorAll('.tbt-dot');
  const caption = overlay.querySelector('#tbt-caption');
  const dateEl = overlay.querySelector('#tbt-date');

  const slideInterval = setInterval(() => {
    slides[currentSlide]?.classList.remove('active');
    dots[currentSlide]?.classList.remove('active');
    currentSlide = (currentSlide + 1) % posts.length;
    slides[currentSlide]?.classList.add('active');
    dots[currentSlide]?.classList.add('active');
    if (caption) caption.textContent = posts[currentSlide]?.caption || 'A beautiful memory...';
    if (dateEl && posts[currentSlide]?.createdAt?.toDate) {
      dateEl.textContent = posts[currentSlide].createdAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }, 3000);

  const dismiss = () => {
    clearInterval(slideInterval);
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s';
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('#tbt-dismiss')?.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });

  overlay.querySelector('#tbt-share')?.addEventListener('click', () => {
    dismiss();
    router.navigate('upload');
    showToast('Share this throwback memory! 📸', 'info');
  });
}

// ===== CHAT UNREAD BADGE (Real-time Firestore listener) =====
let _lastChatBadgeCount = 0;

function startChatBadgeListener() {
  stopChatBadgeListener(); // Clean up any existing listener
  if (!authManager.currentUser) return;

  const uid = authManager.currentUser.uid;

  try {
    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', uid)
    );

    unsubChatBadge = onSnapshot(q, (snap) => {
      let unreadConversations = 0;

      snap.forEach(d => {
        const data = d.data();
        const unread = data.unreadCount?.[uid] || 0;
        if (unread > 0) {
          unreadConversations++;
        }
      });

      updateChatBadge(unreadConversations);
    }, (err) => {
      console.warn('[ChatBadge] Listener error:', err);
    });
  } catch (e) {
    console.warn('[ChatBadge] Could not start listener:', e);
  }
}

function stopChatBadgeListener() {
  if (unsubChatBadge) {
    unsubChatBadge();
    unsubChatBadge = null;
  }
  _lastChatBadgeCount = 0;
}

function updateChatBadge(count) {
  const badge = document.getElementById('chat-unread-badge');
  if (!badge) return;

  const prevCount = _lastChatBadgeCount;
  _lastChatBadgeCount = count;

  if (count <= 0) {
    // Hide badge smoothly
    badge.classList.add('hidden');
    badge.textContent = '';
    return;
  }

  // Format count text
  badge.textContent = count > 99 ? '99+' : String(count);

  // Show badge
  badge.classList.remove('hidden');

  // Trigger bounce animation only when count changes (not on initial load from 0)
  if (prevCount !== count && prevCount >= 0) {
    badge.classList.remove('badge-bounce');
    // Force reflow to restart animation
    void badge.offsetWidth;
    badge.classList.add('badge-bounce');
    // Remove animation class after it completes
    setTimeout(() => badge.classList.remove('badge-bounce'), 400);
  }

  // Update PWA app badge if supported
  if ('setAppBadge' in navigator) {
    navigator.setAppBadge(count).catch(() => {});
  }
}

// ===== INCOMING CALL UI =====
function showIncomingCallUI(call) {
  const callOverlay = document.getElementById('call-overlay');
  if (!callOverlay) return;

  // If auto-accept (from push notification action), handle immediately
  if (call.autoAccept) {
    handleAcceptCall(call);
    return;
  }

  // Start ringtone + vibration
  if (notificationManager) {
    notificationManager.playIncomingRingtone();
    // Close the push notification for this call (we're handling it in-app)
    notificationManager.closeCallNotification(call.id);
  }

  // Set callManager state to incoming
  if (callManager) {
    callManager.callStatus = 'incoming';
  }

  const callTypeLabel = call.type === 'video' ? 'Video' : 'Voice';
  const callTypeIcon = call.type === 'video' ? '📹' : '📞';

  callOverlay.classList.remove('hidden');
  callOverlay.innerHTML = `
    <div class="call-screen">
      <div class="call-info">
        <div class="call-avatar-ring">
          ${call.callerPhoto
      ? `<img src="${call.callerPhoto}" class="w-20 h-20 rounded-full object-cover" alt="" />`
      : `<div class="avatar avatar-placeholder text-2xl w-20 h-20">${(call.callerName || '?')[0]}</div>`
    }
        </div>
        <h3 class="text-lg font-bold text-white mt-4">${sanitizeHTML(call.callerName || 'Unknown')}</h3>
        <p class="text-sm text-white/70 mt-1">${callTypeIcon} Incoming ${callTypeLabel} Call...</p>
      </div>
      <div class="call-controls">
        <button class="call-control-btn call-end-btn" id="reject-call" style="background:#ef4444">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          <span class="text-[10px] mt-1 text-white">Reject</span>
        </button>
        <button class="call-control-btn" id="accept-call" style="background:#22c55e;box-shadow:0 4px 20px rgba(34,197,94,0.4)">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>
          <span class="text-[10px] mt-1 text-white">Accept</span>
        </button>
      </div>
    </div>
  `;

  // Accept handler
  callOverlay.querySelector('#accept-call')?.addEventListener('click', () => {
    handleAcceptCall(call);
  });

  // Reject handler
  callOverlay.querySelector('#reject-call')?.addEventListener('click', () => {
    // Stop ringtone
    if (notificationManager) notificationManager.stopIncomingRingtone();
    callManager.rejectCall(call.id);
    callOverlay.classList.add('hidden');
    callOverlay.innerHTML = '';
  });

  // Auto-dismiss after 35s (matches caller's timeout)
  const autoDismissTimer = setTimeout(() => {
    if (callOverlay.querySelector('#accept-call')) {
      if (notificationManager) notificationManager.stopIncomingRingtone();
      callOverlay.classList.add('hidden');
      callOverlay.innerHTML = '';
      if (callManager) callManager._resetCallState('no_answer');
    }
  }, 35000);

  // Store timer reference so we can clear it on accept/reject
  callOverlay._autoDismissTimer = autoDismissTimer;
}

async function handleAcceptCall(call) {
  const callOverlay = document.getElementById('call-overlay');
  if (!callOverlay) return;

  // Stop ringtone immediately
  if (notificationManager) {
    notificationManager.stopIncomingRingtone();
    notificationManager.closeCallNotification(call.id);
  }

  // Clear auto-dismiss timer
  if (callOverlay._autoDismissTimer) {
    clearTimeout(callOverlay._autoDismissTimer);
    callOverlay._autoDismissTimer = null;
  }

  try {
    // CRITICAL FIX: Import the UI module and render the full call UI BEFORE
    // calling answerCall(). This ensures onCallStateChange/onRemoteStream
    // callbacks are wired before ICE events fire.
    const { showAnsweredCallUI } = await import('./pages/chat.js');

    // showAnsweredCallUI wires callbacks + renders controls + then we call answerCall
    showAnsweredCallUI(call.callerId || call.id, call.callerName, call.type, call.id);
  } catch (e) {
    console.error('Accept call error:', e);
    callOverlay.classList.add('hidden');
    callOverlay.innerHTML = '';
    showToast('Could not accept call', 'error');
  }
}

// ===== PWA Install =====
let deferredPrompt = null;

function setupPWAInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });
}

function showInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (!banner || !deferredPrompt) return;

  banner.classList.remove('hidden');
  banner.innerHTML = `
    <div class="card p-4 mx-4 mb-4 flex items-center gap-3 border-2 border-navy-200 bg-navy-50/30 shadow-lg">
      <span class="text-2xl">📲</span>
      <div class="flex-1">
        <p class="text-sm font-semibold text-navy-800">Install ClassMemories</p>
        <p class="text-xs text-gray-400">Add to home screen for the full experience</p>
      </div>
      <button id="install-btn" class="px-3 py-1.5 bg-navy-500 text-white text-xs font-semibold rounded-full">Install</button>
      <button id="dismiss-install" class="p-1 text-gray-400 hover:text-gray-600">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  `;

  banner.querySelector('#install-btn')?.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') showToast('App installed! 🎉', 'success');
      deferredPrompt = null;
      banner.classList.add('hidden');
    }
  });

  banner.querySelector('#dismiss-install')?.addEventListener('click', () => {
    banner.classList.add('hidden');
  });
}

// ===== INIT =====
async function init() {
  console.log('[ClassMemories] Starting...');
  
  // 1. Silent Auth Initialization (to detect Owner)
  try {
    await authManager.init();
    userCache.init();
    console.log('[ClassMemories] Auth initialized');
  } catch (e) {
    console.error('[ClassMemories] Auth init failed:', e);
  }

  // 2. Check Premium Launch Blocker
  await launchManager.startBlocker();
  // Play cinematic intro on first visit (lazy loaded for resilience)
  let introPlayed = false;
  try {
    const { playCinematicIntro } = await import('./cinematic-intro.js');
    introPlayed = await playCinematicIntro();
  } catch (e) {
    console.warn('[ClassMemories] Cinematic intro failed:', e);
  }

  // Load core modules in parallel with splash (skip splash if intro played)
  if (introPlayed) {
    // Intro replaces splash — remove splash immediately
    const splashEl = document.getElementById('splash-screen');
    if (splashEl) splashEl.remove();
    await loadCoreModules();
  } else {
    const [_] = await Promise.all([
      animateSplash(),
      loadCoreModules()
    ]);
  }

  console.log('[ClassMemories] Splash done, initializing auth...');

  function stopPlaylist() {
    if (typeof MusicPlayer !== 'undefined') {
      MusicPlayer.isStopped = true;
      MusicPlayer.hasStarted = false;
      MusicPlayer.currentIndex = 0;
      if (MusicPlayer.bgAudio) {
        MusicPlayer.bgAudio.pause();
        MusicPlayer.bgAudio.src = '';
      }
      sessionStorage.removeItem("musicCurrentIndex");
      sessionStorage.removeItem("musicIsStopped");
      sessionStorage.removeItem("musicHasStarted");
      sessionStorage.removeItem("musicCurrentTime");
      if (typeof MusicPlayer.hideStopButton === 'function') {
        MusicPlayer.hideStopButton();
      }
    }
  }

  function startPlaylist() {
    if (typeof MusicPlayer !== 'undefined' && MusicPlayer.start) {
      MusicPlayer.isStopped = false;
      MusicPlayer.hasStarted = false;
      MusicPlayer.currentIndex = 0;
      MusicPlayer.start();
      sessionStorage.setItem("musicStarted", "true");
      sessionStorage.setItem("homeMusicStarted", "true");
      sessionStorage.setItem("playlistStartedThisLogin", "true");
    }
  }

  function shouldShowBirthdayIntro() {
    if (!authManager.currentUser) return false;
    if (!authManager.userData?.dateOfBirth) return false;

    const todayObj = new Date();
    const dob = new Date(authManager.userData.dateOfBirth);
    if (dob.getMonth() !== todayObj.getMonth() || dob.getDate() !== todayObj.getDate()) return false;

    const year = todayObj.getFullYear();
    const month = String(todayObj.getMonth() + 1).padStart(2, '0');
    const day = String(todayObj.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    if (localStorage.getItem("birthdayIntroLastShown") === todayStr) return false;
    if (sessionStorage.getItem("birthdayIntroCompleted") === "true") return false;
    if (window.hasPlayedBirthdayIntro) return false;

    return true;
  }

  function playBirthdayIntro() {
    return new Promise((resolve) => {
      window._onBirthdayIntroComplete = () => {
        window._onBirthdayIntroComplete = null;
        resolve();
      };
      let played = false;
      if (window.showBirthdayIntro) {
        played = window.showBirthdayIntro(false);
      }
      if (!played) {
        window._onBirthdayIntroComplete = null;
        resolve();
      }
    });
  }

  async function shouldShowFriendshipIntro() {
    const settings = await friendshipIntroManager.fetchSettings();
    const enabled = Boolean(settings?.enabled);
    const rawActivationDate = settings?.selectedDate || settings?.date || settings?.activationDate || '';
    const activationDate = friendshipIntroManager.formatToYYYYMMDD(rawActivationDate);
    const today = friendshipIntroManager.getTodayDateString();

    const dateFormatMatch = Boolean(activationDate && activationDate === today);
    const introAlreadyShown = (sessionStorage.getItem('friendshipIntroShownThisLogin') === 'true');

    return Boolean(enabled && dateFormatMatch && !introAlreadyShown);
  }

  async function playFriendshipIntro() {
    await friendshipIntroManager.playFriendshipIntro(false);
  }

  async function startAppMusicFlow() {
    console.log("Login Success");

    console.log("Checking Birthday Intro...");
    const birthdayReq = shouldShowBirthdayIntro();

    console.log("Checking Friendship Intro...");
    const friendshipReq = await shouldShowFriendshipIntro();

    const introRequired = birthdayReq || friendshipReq;
    console.log("Intro Required:", introRequired ? "YES" : "NO");

    if (birthdayReq) {
      console.log("Stopping Playlist");
      stopPlaylist();

      console.log("Playing Intro");
      await playBirthdayIntro();

      console.log("Intro Finished");
      await new Promise(r => setTimeout(r, 300));

      console.log("Starting Playlist");
      startPlaylist();
      return;
    }

    if (friendshipReq) {
      console.log("Stopping Playlist");
      stopPlaylist();

      console.log("Playing Intro");
      await playFriendshipIntro();

      console.log("Intro Finished");
      await new Promise(r => setTimeout(r, 300));

      console.log("Starting Playlist");
      startPlaylist();
      return;
    }

    console.log("Starting Playlist");
    startPlaylist();
  }

  let appShellBuilt = false;

  authManager.onChange(async (user) => {
    if (user) {
      console.log('[ClassMemories] User logged in:', user.email);
      hideLogin();
      
      const initApp = async () => {
        if (!appShellBuilt) {
          buildAppShell();
          appShellBuilt = true;

          const isExplicitLogin = sessionStorage.getItem("isExplicitLoginEvent") === "true";
          const loginSession = sessionStorage.getItem("loginSession") === "true";

          if (isExplicitLogin) {
            // Explicit login success event
            sessionStorage.removeItem("isExplicitLoginEvent");
            sessionStorage.removeItem("isFreshLogin");

            // Clear temporary login flags & reset Friendship Intro session
            sessionStorage.removeItem("birthdayIntroShownThisLogin");
            sessionStorage.removeItem("playlistStartedThisLogin");
            friendshipIntroManager.resetSessionSeen();

            // Reset birthday intro state to allow replay on re-login
            window.hasPlayedBirthdayIntro = false;
            sessionStorage.removeItem("birthdayIntroCompleted");

            await startAppMusicFlow();
          } else {
            // Page reload / Auto-login
            try {
              const friendshipReq = await shouldShowFriendshipIntro();
              if (friendshipReq) {
                stopPlaylist();
                await playFriendshipIntro();
              } else {
                if (shouldShowBirthdayIntro()) {
                  stopPlaylist();
                  await playBirthdayIntro();
                }
              }
            } catch (e) {
              console.error("[ClassMemories] Intro check on auto-login error:", e);
            }
          }
        }
      };

      await initApp();
      usageTracker.startSession();
      loginTracker.startSession();

      const lastPass = authManager.lastEnteredPassword || sessionStorage.getItem("lastEnteredPassword");
      const dob = authManager.userData?.dateOfBirth;
      const isDob = isDobPassword(lastPass, dob);
      const isDefaultFlag = authManager.userData?.passwordChanged !== true;

      if (authManager.userData && (isDob || isDefaultFlag)) {
        await showForcedPasswordModal();
        showToast('Password security update complete! 🎓', 'success');
      }
    } else {
      console.log('[ClassMemories] No user, showing login...');
      sessionStorage.removeItem("friendshipIntroShownThisLogin");
      appShellBuilt = false;
      usageTracker.endSession();
      loginTracker.endSession();
      $('#app')?.classList.add('hidden');
      $('#bottom-nav')?.classList.add('hidden');
      if (notificationManager) {
        notificationManager.removeFCMToken();
        notificationManager.stopListening();
      }
      if (callManager) callManager.stopListeningForCalls();
      stopChatBadgeListener();
      showLogin();
    }
  });


  // Trigger initial UI setup since we attached onChange *after* init()
  authManager._notify();


  hideSplash();

  // AUTO-LOGIN: If not logged in, try auto-login
  if (!authManager.isLoggedIn()) {
    console.log('[ClassMemories] Auto-login attempt...');
    showLogin();
    // Small delay to show login page, then auto-login
    setTimeout(async () => {
      try {
        await doLogin(AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);
        console.log('[ClassMemories] Auto-login success!');
      } catch (e) {
        console.log('[ClassMemories] Auto-login failed, manual login needed:', e.message);
      }
    }, 500);
  }

  // Handle back button/gesture
  window.addEventListener('popstate', () => {
    router.navigateBack();
  });
}

init().catch(err => {
  console.error('[ClassMemories] Fatal error:', err);
  // Force hide splash on error
  const splash = document.getElementById('splash-screen');
  if (splash) { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 500); }
  // Show error to user
  document.body.innerHTML += `
    <div style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#f5e8d0;padding:20px;">
      <div style="text-align:center;max-width:300px;">
        <div style="font-size:48px;margin-bottom:12px;">⚠️</div>
        <h2 style="font-size:18px;font-weight:bold;color:#1e3a5f;margin-bottom:8px;">App Error</h2>
        <p style="font-size:13px;color:#666;margin-bottom:16px;">${err.message}</p>
        <button onclick="location.reload()" style="padding:10px 24px;background:#1e3a5f;color:#fff;border:none;border-radius:12px;font-size:14px;cursor:pointer;">Reload</button>
      </div>
    </div>`;
});
