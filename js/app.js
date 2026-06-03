// Main App Entry — Resilient app shell with lazy page loading + auto-login
import { authManager } from './auth.js';
import { router } from './router.js';
import { showToast, sanitizeHTML } from './utils.js';
import { presenceManager } from './presence.js';

// ===== MUSIC PLAYER =====
const MusicPlayer = {
  bellAudio: null,
  bgAudio: null,
  playlist: [
    'firstsong.mp3',
    'secondsong.mp3',
    'thridsong.mp3',
    'fourthsong.mp3',
    'applastsong.mp3'
  ],
  currentIndex: 0,
  isStopped: false,
  hasStarted: false,

  start() {
    if (this.isStopped || this.hasStarted) return;
    this.hasStarted = true;

    // Play bell first
    this.bellAudio = new Audio('schoolbell.mp3');
    this.bellAudio.volume = 0.8;

    // Ensure no overlapping audio
    if (this.bgAudio) {
      this.bgAudio.pause();
    }

    const playPromise = this.bellAudio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        this.showStopButton();
      }).catch(e => {
        console.log('Audio autoplay blocked. Waiting for user interaction.', e);
        const unlockAudio = () => {
          if (!this.isStopped) {
            this.bellAudio.play().then(() => this.showStopButton()).catch(() => { });
          }
          document.removeEventListener('click', unlockAudio);
        };
        document.addEventListener('click', unlockAudio, { once: true });
      });
    }

    this.bellAudio.onended = () => {
      if (this.isStopped) return;
      this.playNextSong();
    };
  },

  playNextSong() {
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
    this.bgAudio.play().catch(e => console.log('BGAudio play failed:', e));

    this.bgAudio.onended = () => {
      if (this.isStopped) return;
      this.currentIndex++;
      this.playNextSong();
    };
  },

  stopAll() {
    this.isStopped = true;
    if (this.bellAudio) {
      this.bellAudio.pause();
      this.bellAudio.src = '';
    }
    if (this.bgAudio) {
      this.bgAudio.pause();
      this.bgAudio.src = '';
    }
    this.playlist = [];
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
    const bar = $('#splash-progress');
    let w = 0;
    const iv = setInterval(() => {
      w += Math.random() * 18 + 6;
      if (w >= 100) { w = 100; clearInterval(iv); setTimeout(resolve, 300); }
      if (bar) bar.style.width = w + '%';
    }, 180);
  });
}
function hideSplash() {
  const el = $('#splash-screen');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }
}

// ===== LOGIN PAGE =====
function showLogin() {
  const lp = $('#login-page');
  lp.className = 'fixed inset-0 z-[90] bg-gradient-to-br from-cream-100 to-amber-50/80 overflow-y-auto';
  lp.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-screen px-6 py-10 relative">
      <!-- Nostalgic floating particles / bokeh (CSS simulated) -->
      <div class="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
         <div class="absolute w-64 h-64 bg-amber-200/30 rounded-full blur-3xl -top-10 -left-10 animate-pulse" style="animation-duration: 8s"></div>
         <div class="absolute w-72 h-72 bg-orange-200/20 rounded-full blur-3xl bottom-10 right-10 animate-pulse" style="animation-duration: 10s"></div>
      </div>

      <!-- School Crest -->
      <div class="school-crest mb-8 animate-scaleIn relative z-10 shadow-xl shadow-amber-900/5 bg-white/60 backdrop-blur-sm border border-white/50 p-6 rounded-3xl transition-transform duration-500 hover:scale-105">
        <span class="text-5xl mb-2 drop-shadow-md">🏫</span>
        <span class="text-[12px] font-bold text-navy-800 tracking-widest uppercase">ClassMemories</span>
        <div class="ribbon shadow-sm">2024 & 2025</div>
      </div>

      <!-- Welcome text -->
      <h1 class="text-3xl font-display font-extrabold text-navy-900 mb-2 animate-fadeIn relative z-10 drop-shadow-sm tracking-tight">Welcome Back</h1>
      <p class="text-sm text-navy-600/80 mb-10 animate-fadeIn relative z-10 font-medium tracking-wide">Relive the golden days.</p>

      <!-- Login Form -->
      <div class="w-full max-w-sm animate-slideUp relative z-10 bg-white/70 backdrop-blur-md p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white" style="animation-delay:0.2s;opacity:0">
        <form id="login-form" class="space-y-6" autocomplete="off">
          <!-- Username -->
          <div class="group">
            <label class="text-[11px] font-bold text-navy-500 mb-2 block uppercase tracking-wider transition-colors group-focus-within:text-navy-900">Email Address</label>
            <div class="relative flex items-center transition-transform duration-300 group-focus-within:-translate-y-1">
              <svg class="absolute left-4 w-5 h-5 text-navy-400 group-focus-within:text-navy-700 transition-colors z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0"/></svg>
              <input type="email" id="login-email" placeholder="admin37@classmemories.com" class="w-full bg-white/60 border border-cream-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm text-navy-900 font-medium focus:outline-none focus:ring-2 focus:ring-navy-200 focus:border-transparent focus:bg-white transition-all shadow-sm" required/>
            </div>
          </div>

          <!-- Password -->
          <div class="group">
            <label class="text-[11px] font-bold text-navy-500 mb-2 block uppercase tracking-wider transition-colors group-focus-within:text-navy-900">Password</label>
            <div class="relative flex items-center transition-transform duration-300 group-focus-within:-translate-y-1">
              <svg class="absolute left-4 w-5 h-5 text-navy-400 group-focus-within:text-navy-700 transition-colors z-10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
              <input type="password" id="login-password" placeholder="school123" class="w-full bg-white/60 border border-cream-200 rounded-2xl py-3.5 pl-12 pr-12 text-sm text-navy-900 font-medium focus:outline-none focus:ring-2 focus:ring-navy-200 focus:border-transparent focus:bg-white transition-all shadow-sm" required/>
              <button type="button" id="toggle-password-btn" class="absolute right-2 w-10 h-10 flex items-center justify-center rounded-full hover:bg-cream-100 transition-all focus:outline-none z-10" aria-label="Toggle password visibility">
                <span class="text-xl leading-none transform transition-transform duration-300 inline-block" id="diary-icon">📘</span>
              </button>
            </div>
          </div>

          <button type="submit" id="login-submit" class="w-full bg-navy-800 text-white font-bold py-4 rounded-2xl shadow-[0_4px_14px_0_rgb(30,58,95,0.39)] hover:shadow-[0_6px_20px_rgba(30,58,95,0.23)] hover:-translate-y-0.5 transition-all duration-300 mt-4 tracking-wide relative overflow-hidden group">
            <span class="relative z-10">ENTER THE MEMORY LANE</span>
            <div class="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
          </button>

          <div id="login-error" class="hidden text-center text-red-500 text-xs mt-4 p-3 bg-red-50/80 backdrop-blur-sm rounded-xl border border-red-100 font-medium shadow-inner"></div>
        </form>

        <p class="text-center text-navy-400 text-[11px] font-medium mt-8 flex items-center justify-center gap-2">
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
    await doLogin(email, pass);
  });
}

async function doLogin(email, password) {
  const lp = $('#login-page');
  const errEl = lp?.querySelector('#login-error');
  const btn = lp?.querySelector('#login-submit');

  if (btn) { btn.disabled = true; btn.textContent = 'ENTERING...'; }
  if (errEl) errEl.classList.add('hidden');

  try {
    await authManager.login(email, password);
    showToast('Welcome back! 🎓', 'success');
    MusicPlayer.start();
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
        <h1 class="text-lg font-display font-bold text-navy-500">ClassMemories 📷</h1>
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

  // Build nav (5 tabs)
  const navEl = $('#nav-buttons');
  navEl.innerHTML = NAV_ITEMS.map(n => `
    <button data-page="${n.id}" class="nav-btn ${n.id === 'home' ? 'active' : ''} flex flex-col items-center py-1.5 px-3 transition-all ${n.id === 'upload' ? 'nav-btn-center' : ''}" id="nav-${n.id}">
      ${n.icon}
      <span class="text-[10px] mt-0.5 font-medium">${n.label}</span>
    </button>
  `).join('');

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
  router.register('timecapsule', lazyPage('./pages/timecapsule.js', 'renderTimeCapsule'));
  router.register('diary', lazyPage('./pages/diary.js', 'renderDiary'));
  router.register('birthday', lazyPage('./pages/birthday.js', 'renderBirthday'));
  router.register('leaderboard', lazyPage('./pages/leaderboard.js', 'renderLeaderboard'));
  router.register('polls', lazyPage('./pages/polls.js', 'renderPolls'));

  navEl.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) router.navigate(page);
    });
  });

  // Notifications button
  $('#btn-notifications')?.addEventListener('click', () => router.navigate('notifications'));

  // Set up notification badge + FCM
  if (notificationManager) {
    const badge = $('#notif-badge');
    notificationManager.setBadgeElement(badge);
    notificationManager.startListening();
    // Initialize FCM (registers firebase-messaging-sw.js + token)
    notificationManager.initFCM().then(() => {
      // Request push permission after FCM is ready
      if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => notificationManager.requestPushPermission(), 5000);
      }
    }).catch(e => console.log('[App] FCM init:', e.message));
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
        const { destroyTimeCapsule } = await import('./pages/timecapsule.js').catch(() => ({}));
        if (destroyTimeCapsule) destroyTimeCapsule();
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

  // Birthday check — show celebration if today is current user's birthday
  checkBirthdayCelebration();

  // Throwback Thursday check
  checkThrowbackThursday();
}

// ===== BIRTHDAY FULLSCREEN CELEBRATION =====
function checkBirthdayCelebration() {
  if (!authManager.userData?.dateOfBirth) return;
  const today = new Date();
  const dob = new Date(authManager.userData.dateOfBirth);
  if (dob.getMonth() !== today.getMonth() || dob.getDate() !== today.getDate()) return;

  // Check if already shown today
  const shownKey = 'bday_shown_' + today.toDateString();
  if (sessionStorage.getItem(shownKey)) return;
  sessionStorage.setItem(shownKey, '1');

  const name = authManager.userData.fullName || 'Friend';
  const quotes = [
    "One classroom. One family. Forever.",
    "Those school memories still smile because of you.",
    "May our friendship never graduate.",
    "Some bonds are beyond school bells.",
    "The best memories were made with you."
  ];
  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  const overlay = document.createElement('div');
  overlay.className = 'birthday-overlay';
  overlay.innerHTML = `
    <div class="birthday-confetti-box" id="bday-confetti"></div>
    <div class="birthday-emoji-float" style="top:10%;left:10%;animation-delay:0s">🎈</div>
    <div class="birthday-emoji-float" style="top:15%;right:15%;animation-delay:0.5s">🎉</div>
    <div class="birthday-emoji-float" style="bottom:20%;left:20%;animation-delay:1s">🎂</div>
    <div class="birthday-emoji-float" style="bottom:25%;right:10%;animation-delay:1.5s">🎁</div>
    <div class="birthday-emoji-float" style="top:40%;left:5%;animation-delay:0.8s">⭐</div>
    <div class="birthday-emoji-float" style="top:35%;right:8%;animation-delay:1.2s">💖</div>
    <div class="birthday-text-main">
      <div class="text-5xl mb-4">🎉</div>
      <h1 class="text-3xl font-display font-bold text-navy-800 mb-2">Happy Birthday</h1>
      <h2 class="text-2xl font-handwriting text-warm-600">${name} ❤️</h2>
    </div>
    <div class="birthday-quote mt-6 max-w-xs">
      <p class="font-handwriting text-xl text-navy-600 italic">"${quote}"</p>
    </div>
    <button class="birthday-dismiss-btn" id="bday-dismiss">Enter Memory Lane 🎓</button>
  `;
  document.body.appendChild(overlay);

  // Spawn confetti
  const confettiBox = overlay.querySelector('#bday-confetti');
  const colors = ['#ffd700', '#ff6b6b', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd', '#ff8c00', '#00d2d3'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'birthday-confetti-piece';
    piece.style.cssText = `left:${Math.random() * 100}%;background:${colors[Math.floor(Math.random() * colors.length)]};animation-duration:${2 + Math.random() * 3}s;animation-delay:${Math.random() * 2}s;width:${6 + Math.random() * 8}px;height:${6 + Math.random() * 8}px;border-radius:${Math.random() > 0.5 ? '50%' : '2px'};`;
    confettiBox.appendChild(piece);
  }

  overlay.querySelector('#bday-dismiss')?.addEventListener('click', () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.5s';
    setTimeout(() => overlay.remove(), 500);
  });

  // Auto-dismiss after 10 seconds
  setTimeout(() => {
    if (document.body.contains(overlay)) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.5s';
      setTimeout(() => overlay.remove(), 500);
    }
  }, 10000);
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

  // Show "Connecting..." state while answering
  callOverlay.classList.remove('hidden');
  callOverlay.innerHTML = `
    <div class="call-screen">
      <div class="call-info">
        <div class="call-avatar-ring">
          <div class="avatar avatar-placeholder text-2xl w-20 h-20">${(call.callerName || '?')[0]}</div>
        </div>
        <h3 class="text-lg font-bold text-white mt-4">${sanitizeHTML(call.callerName || 'Unknown')}</h3>
        <p class="text-sm text-white/70 mt-1">Connecting...</p>
      </div>
    </div>
  `;

  try {
    // Answer the call first (establishes WebRTC connection)
    await callManager.answerCall(call.id);

    // Then transition to the full call UI (with controls)
    const { showAnsweredCallUI } = await import('./pages/chat.js');
    showAnsweredCallUI(call.callerId, call.callerName, call.type);
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

  authManager.onChange((user) => {
    if (user) {
      console.log('[ClassMemories] User logged in:', user.email);
      hideLogin();
      buildAppShell();
    } else {
      console.log('[ClassMemories] No user, showing login...');
      $('#app')?.classList.add('hidden');
      $('#bottom-nav')?.classList.add('hidden');
      if (notificationManager) {
        notificationManager.removeFCMToken();
        notificationManager.stopListening();
      }
      if (callManager) callManager.stopListeningForCalls();
      showLogin();
    }
  });

  try {
    await authManager.init();
    console.log('[ClassMemories] Auth initialized');
  } catch (e) {
    console.error('[ClassMemories] Auth init failed:', e);
  }

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
