// Main App Entry — Resilient app shell with lazy page loading + auto-login
import { authManager } from './auth.js';
import { router } from './router.js';
import { showToast } from './utils.js';

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
  lp.classList.remove('hidden');
  lp.innerHTML = `
    <div class="flex flex-col items-center justify-center min-h-screen px-6 py-10">
      <!-- School Crest -->
      <div class="school-crest mb-6 animate-scaleIn">
        <span class="text-4xl mb-1">📖</span>
        <span class="text-[11px] font-bold text-navy-500 tracking-wide">ClassMemories</span>
        <div class="ribbon">EST. 2024</div>
      </div>

      <!-- Welcome text -->
      <h1 class="text-2xl font-bold text-navy-800 mb-1 animate-fadeIn">Welcome Back, Class!</h1>
      <p class="text-sm text-gray-400 mb-8 animate-fadeIn">Only 37 spots. Login below.</p>

      <!-- Login Form -->
      <div class="w-full max-w-xs animate-slideUp" style="animation-delay:0.2s;opacity:0">
        <form id="login-form" class="space-y-4" autocomplete="off">
          <!-- Username -->
          <div>
            <label class="text-xs font-semibold text-navy-600 mb-1.5 block">Email</label>
            <div class="relative">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0"/></svg>
              <input type="email" id="login-email" placeholder="admin37@classmemories.com" class="input-field" required/>
            </div>
          </div>

          <!-- Password -->
          <div>
            <label class="text-xs font-semibold text-navy-600 mb-1.5 block">Password</label>
            <div class="relative">
              <svg class="input-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
              <input type="password" id="login-password" placeholder="school123" class="input-field" required/>
            </div>
          </div>

          <button type="submit" id="login-submit" class="btn-primary mt-2">
            ENTER THE MEMORY LANE
          </button>

          <div id="login-error" class="hidden text-center text-red-500 text-xs mt-2 p-2.5 bg-red-50 rounded-xl border border-red-100"></div>
        </form>

        <p class="text-center text-gray-400 text-[11px] mt-6">
          Login access restricted to authorized alumni.
        </p>
      </div>
    </div>
  `;

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

  // Set up notification badge
  if (notificationManager) {
    const badge = $('#notif-badge');
    notificationManager.setBadgeElement(badge);
    notificationManager.startListening();
  }

  // Start listening for incoming calls
  if (callManager) {
    callManager.listenForIncomingCalls();
    callManager.onIncomingCall = (call) => showIncomingCallUI(call);
  }

  router.navigate('home');

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
  const colors = ['#ffd700','#ff6b6b','#48dbfb','#ff9ff3','#54a0ff','#5f27cd','#ff8c00','#00d2d3'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'birthday-confetti-piece';
    piece.style.cssText = `left:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};animation-duration:${2+Math.random()*3}s;animation-delay:${Math.random()*2}s;width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;border-radius:${Math.random()>0.5?'50%':'2px'};`;
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
        <p class="text-[10px] text-gray-400 text-center mt-1" id="tbt-date">${posts[0]?.createdAt?.toDate ? posts[0].createdAt.toDate().toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : ''}</p>
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
      dateEl.textContent = posts[currentSlide].createdAt.toDate().toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'});
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

  callOverlay.classList.remove('hidden');
  callOverlay.innerHTML = `
    <div class="incoming-call-screen">
      <div class="call-avatar-ring">
        <div class="avatar avatar-placeholder text-3xl w-24 h-24">${(call.callerName || '?')[0]}</div>
      </div>
      <h3 class="text-xl font-bold text-white mt-6">${call.callerName || 'Unknown'}</h3>
      <p class="text-sm text-white/70 mt-1">Incoming ${call.type} call...</p>
      <div class="flex items-center gap-8 mt-10">
        <button class="call-action-btn call-reject" id="reject-call">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <button class="call-action-btn call-accept" id="accept-call">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>
        </button>
      </div>
    </div>
  `;

  callOverlay.querySelector('#accept-call')?.addEventListener('click', async () => {
    callOverlay.innerHTML = '';
    const { startCallUI } = await import('./pages/chat.js');
    callOverlay.classList.add('hidden');
    await callManager.answerCall(call.id);
    startCallUI(call.callerId, call.callerName, call.type);
  });

  callOverlay.querySelector('#reject-call')?.addEventListener('click', () => {
    callManager.rejectCall(call.id);
    callOverlay.classList.add('hidden');
    callOverlay.innerHTML = '';
  });

  setTimeout(() => {
    if (callOverlay.querySelector('#accept-call')) {
      callOverlay.classList.add('hidden');
      callOverlay.innerHTML = '';
    }
  }, 30000);
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

  // Load core modules in parallel with splash
  const [_] = await Promise.all([
    animateSplash(),
    loadCoreModules()
  ]);

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
      if (notificationManager) notificationManager.stopListening();
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
