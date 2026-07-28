import { db, doc, getDoc, setDoc, serverTimestamp } from '../firebase-config.js';

export const FRIENDSHIP_INTRO_MUSIC = '/assets/96slowbgm.mp3';

export const friendshipImages = [
  '/assets/school.jpg',
  '/assets/KA8_6114.JPG',
  '/assets/KA8_6118.JPG',
  '/assets/KA8_5940.JPG',
  '/assets/KA8_6103.JPG',
  '/assets/KA8_6092.JPG',
  '/assets/KA8_5966.JPG',
  '/assets/KA8_5988.JPG',
  '/assets/KA8_6026.JPG',
  '/assets/school.jpg',
  '/assets/KA8_6043.JPG',
  '/assets/KA8_6048.JPG'
];

const FRIENDSHIP_CAPTIONS = [
  'Classroom Fun 📸',
  'Lunch Breaks 🥪',
  'Bench Partners ✏️',
  'Golden Days 🎓',
  'Sports Day 🏆',
  'Assembly Time 🔔',
  'Farewell 💖',
  'Best Friends 🌟',
  'School Gate 🏫',
  'Magic Memories ✨',
  'Laughter & Smiles 😁',
  'Forever Together ❤️'
];

class FriendshipIntroManager {
  constructor() {
    this.settingsRef = doc(db, 'systemSettings', 'friendshipIntro');
    this.customAudio = null;
    this.isPlaying = false;
    this.activeOverlay = null;
    this.cachedSettings = { enabled: false, selectedDate: '2026-08-02' };
  }

  preloadImages(images) {
    return Promise.all(images.map(src => {
      return new Promise(resolve => {
        const img = new Image();
        img.loading = 'eager';
        img.decoding = 'sync';
        img.onload = () => {
          if (img.decode) {
            img.decode().then(() => resolve(src)).catch(() => resolve(src));
          } else {
            resolve(src);
          }
        };
        img.onerror = () => resolve(src);
        img.src = src;
      });
    }));
  }

  // Convert any date value (String, Date, Timestamp) to strict YYYY-MM-DD format
  formatToYYYYMMDD(val) {
    if (!val) return '';
    if (typeof val === 'string') {
      const trimmed = val.trim();
      // 1. Check YYYY-MM-DD or YYYY/MM/DD
      let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed);
      if (match) {
        const y = match[1];
        const m = String(match[2]).padStart(2, '0');
        const d = String(match[3]).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      // 2. Check DD-MM-YYYY or DD/MM/YYYY (e.g. 26-07-2026)
      match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(trimmed);
      if (match) {
        const d = String(match[1]).padStart(2, '0');
        const m = String(match[2]).padStart(2, '0');
        const y = match[3];
        return `${y}-${m}-${d}`;
      }
      // 3. Fallback Date parsing
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } else if (val instanceof Date) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    } else if (val && typeof val.toDate === 'function') {
      const d = val.toDate();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return String(val);
  }

  // Get current date string formatted as YYYY-MM-DD in local time
  getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Fetch Firestore settings
  async fetchSettings() {
    try {
      const snap = await getDoc(this.settingsRef);
      if (snap.exists()) {
        const d = snap.data();
        this.cachedSettings = {
          enabled: d.enabled === true || d.enabled === 'true',
          selectedDate: this.formatToYYYYMMDD(d.selectedDate || d.date || d.activationDate || '2026-08-02'),
          ...d
        };
      }
    } catch (e) {
      console.warn('[FriendshipIntroManager] Failed to fetch settings, using cache:', e);
    }
    return this.cachedSettings;
  }

  // Save Firestore settings (Owner panel)
  async saveSettings(enabled, selectedDate) {
    const formattedDate = this.formatToYYYYMMDD(selectedDate) || '2026-08-02';
    const data = {
      enabled: Boolean(enabled),
      selectedDate: formattedDate,
      date: formattedDate,
      activationDate: formattedDate,
      updatedAt: serverTimestamp()
    };
    await setDoc(this.settingsRef, data, { merge: true });
    this.cachedSettings = { ...this.cachedSettings, ...data };
    return true;
  }

  // Session storage check
  hasSeenIntroInSession() {
    return sessionStorage.getItem('friendshipIntroShownThisLogin') === 'true';
  }

  markIntroSeenInSession() {
    sessionStorage.setItem('friendshipIntroShownThisLogin', 'true');
  }

  resetSessionSeen() {
    sessionStorage.removeItem('friendshipIntroShownThisLogin');
  }

  // Alias for playing Friendship Intro
  showFriendshipIntro(isPreview = false) {
    return this.playFriendshipIntro(isPreview);
  }

  // Determine whether intro should trigger today and log debugging info
  async checkAndRunIntro() {
    // 1. Verify Auth & user status
    const currentUser = authManager.currentUser ? (authManager.currentUser.email || authManager.currentUser.uid) : null;
    const isLoggedIn = Boolean(authManager.currentUser);

    // 2. Fetch Owner settings from Firestore
    const settings = await this.fetchSettings();
    const enabled = Boolean(settings?.enabled);
    const rawActivationDate = settings?.selectedDate || settings?.date || settings?.activationDate || '';
    const activationDate = this.formatToYYYYMMDD(rawActivationDate);
    const today = this.getTodayDateString();

    const dateFormatMatch = Boolean(activationDate && activationDate === today);
    const introAlreadyShown = (sessionStorage.getItem('friendshipIntroShownThisLogin') === 'true');
    const shouldShowIntro = Boolean(isLoggedIn && enabled && dateFormatMatch && !introAlreadyShown);

    // 3. Exact REQUIRED Console Logs
    console.log("Current User:", currentUser);
    console.log("Is Logged In:", isLoggedIn);
    console.log("Friendship Intro Enabled:", enabled);
    console.log("Activation Date (Firestore):", activationDate);
    console.log("Today's Date:", today);
    console.log("Date Format Match:", dateFormatMatch);
    console.log("Intro Already Shown:", introAlreadyShown);
    console.log("Should Show Intro:", shouldShowIntro);

    // 4. Trigger Intro or log exact reason why not called
    if (shouldShowIntro) {
      console.log("[FriendshipIntro] Immediately calling showFriendshipIntro()...");
      sessionStorage.setItem('friendshipIntroShownThisLogin', 'true');
      await this.showFriendshipIntro(false);
    } else {
      const reasons = [];
      if (!isLoggedIn) reasons.push("User is not logged in");
      if (!enabled) reasons.push("Friendship Intro is not enabled in Firestore");
      if (!dateFormatMatch) reasons.push(`Activation date (${activationDate}) does not match today's date (${today})`);
      if (introAlreadyShown) reasons.push("Intro has already been shown in this login session (friendshipIntroShownThisLogin === true)");

      console.log("Reason showFriendshipIntro() was not called:", reasons.join(" | "));
    }

    return shouldShowIntro;
  }

  // ===== AUDIO CONTROL =====
  stopAllAppAudio() {
    try {
      document.querySelectorAll('audio').forEach(a => {
        try {
          a.pause();
          a.currentTime = 0;
        } catch (e) {}
      });
    } catch (e) {}

    if (typeof window !== 'undefined' && window.bgAudio) {
      try {
        window.bgAudio.pause();
        window.bgAudio.currentTime = 0;
      } catch (e) {}
    }
  }

  playCustomMusic() {
    this.stopIntroMusic();
    const primaryPath = FRIENDSHIP_INTRO_MUSIC || '/assets/96slowbgm.mp3';
    const candidatePaths = Array.from(new Set([
      primaryPath,
      '/assets/96slowbgm.mp3',
      '/audio/96slowbgm.mp3',
      '/96slowbgm.mp3',
      '/audio/friendship-intro.mp3',
      '/assets/friendship-intro.mp3'
    ].filter(Boolean)));

    const tryPlayIndex = (idx) => {
      if (idx >= candidatePaths.length) return;
      const src = candidatePaths[idx];
      const audio = new Audio(src);
      audio.volume = 1.0;

      audio.play().then(() => {
        this.customAudio = audio;
      }).catch((err) => {
        console.warn(`[FriendshipIntro] Audio candidate failed (${src}), trying next candidate...`, err);
        tryPlayIndex(idx + 1);
      });
    };

    tryPlayIndex(0);
  }

  stopIntroMusic() {
    this.isPlaying = false;
    if (this.customAudio) {
      try {
        this.customAudio.pause();
        this.customAudio.currentTime = 0;
      } catch (e) {}
      this.customAudio = null;
    }
  }

  // ===== CINEMATIC INTRO CONTROLLER =====
  async playFriendshipIntro(isPreview = false) {
    await this.preloadImages(friendshipImages);

    return new Promise((resolve) => {
      this.isPlaying = true;
      if (!isPreview) {
        this.markIntroSeenInSession();
      }

      const overlay = document.createElement('div');
      overlay.id = 'friendship-intro-overlay';
      this.activeOverlay = overlay;

      overlay.innerHTML = `
        <div class="fi-bg-glow" id="fi-bg-glow"></div>
        <div class="fi-bg-sunrise" id="fi-bg-sunrise"></div>
        <div class="fi-particles-container" id="fi-particles"></div>
        <canvas id="fi-confetti-canvas"></canvas>

        <button class="fi-skip-btn" id="fi-skip-btn">Skip ✕</button>

        <div class="fi-screen-stage">
          <!-- Screen 1: Dark Intro Text -->
          <div class="fi-screen" id="fi-s1">
            <h2 class="fi-text-s1">"Some friendships<br/>never grow old..."</h2>
          </div>

          <!-- Screen 2: School Gate Sunrise & Memory Collage -->
          <div class="fi-screen" id="fi-s2">
            <div class="fi-gate-wrapper" id="fi-gate">
              <div class="fi-gate-backdrop" id="fi-gate-backdrop">
                <div class="fi-collage-grid" id="fi-gate-collage"></div>
              </div>
              <div class="fi-gate-door fi-gate-left">
                <div class="fi-gate-bar"></div>
                <div class="fi-gate-emblem">🏫</div>
                <div class="fi-gate-bar"></div>
              </div>
              <div class="fi-gate-door fi-gate-right">
                <div class="fi-gate-bar"></div>
                <div class="fi-gate-emblem">❤️</div>
                <div class="fi-gate-bar"></div>
              </div>
            </div>
            <p class="text-sm font-semibold tracking-widest uppercase text-amber-200/80">Class Memories Gates Open</p>
          </div>

          <!-- Screen 3: Classroom Blackboard -->
          <div class="fi-screen" id="fi-s3">
            <div class="fi-blackboard">
              <div class="fi-chalk-text">
                <div class="fi-chalk-line1" id="fi-chalk-1">"Once classmates..."</div>
                <div class="fi-chalk-line2" id="fi-chalk-2">"...Forever Friends ❤️"</div>
              </div>
            </div>
          </div>

          <!-- Screen 4: Masonry Polaroids & Paper Airplanes -->
          <div class="fi-screen" id="fi-s4">
            <div class="fi-paper-plane">✈️</div>
            <div class="fi-polaroids-grid" id="fi-polaroids"></div>
          </div>

          <!-- Screen 5: Premium Photo Frame & Balloons -->
          <div class="fi-screen" id="fi-s5">
            <div class="fi-scrapbook-stage">
              <div class="fi-balloons-container" id="fi-balloons"></div>
              <div class="fi-polaroid-frame-wrapper" id="fi-unforgettable-frame">
                <div class="fi-premium-polaroid-frame">
                  <div class="fi-frame-photo-container">
                    <img src="${friendshipImages[0] || '/assets/school.jpg'}" class="fi-frame-photo" loading="eager" decoding="sync" alt="Unforgettable Days" onError="this.src='/assets/class-memories-logo.png';"/>
                  </div>
                </div>
              </div>
              <p class="font-caveat text-2xl text-amber-300 font-bold mt-4">Unforgettable Days 🎓</p>
            </div>
          </div>

          <!-- Final Screen -->
          <div class="fi-screen" id="fi-s6">
            <div class="fi-final-card">
              <h1 class="fi-final-title">Happy Friendship Day</h1>
              <p class="fi-final-subtext">
                "No matter where life takes us,<br/>
                our memories will always keep us together."
              </p>
              <button class="fi-enter-btn" id="fi-enter-btn">
                Enter Class Memories ❤️
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Render Gate Memory Collage (9 images)
      const gateCollage = overlay.querySelector('#fi-gate-collage');
      if (gateCollage) {
        const collageImgs = friendshipImages.slice(0, 9);
        gateCollage.innerHTML = collageImgs.map((src, i) => `
          <img src="${src}" loading="eager" decoding="sync" style="object-fit: cover; image-rendering: auto;" alt="Memories ${i+1}" onError="this.src='/assets/class-memories-logo.png';"/>
        `).join('');
      }

      // Render Non-overlapping Polaroid Grid (9 images)
      const polaroidGrid = overlay.querySelector('#fi-polaroids');
      if (polaroidGrid) {
        const polaroidImgs = friendshipImages.slice(0, 9);
        const rotations = [-6, 5, -4, 7, -3, 6, -5, 4, -7];
        polaroidGrid.innerHTML = polaroidImgs.map((src, i) => {
          const rot = rotations[i % rotations.length];
          const delay = (i * 0.15).toFixed(2);
          const animDelay = (Math.random() * 1.5).toFixed(2);
          const caption = FRIENDSHIP_CAPTIONS[i % FRIENDSHIP_CAPTIONS.length];
          return `
            <div class="fi-polaroid" style="--rot: ${rot}deg; transition-delay: ${delay}s; animation-delay: ${animDelay}s;">
              <img src="${src}" loading="eager" decoding="sync" style="object-fit: cover; image-rendering: auto;" alt="${caption}" onError="this.src='/assets/class-memories-logo.png';"/>
              <div class="fi-polaroid-caption">${caption}</div>
            </div>
          `;
        }).join('');
      }

      const particlesContainer = overlay.querySelector('#fi-particles');
      this.spawnParticles(particlesContainer, 20);

      // Stop every other audio & play custom intro music ONLY
      this.stopAllAppAudio();
      this.playCustomMusic();

      let isFinished = false;
      const finishIntro = () => {
        if (isFinished) return;
        isFinished = true;
        this.stopIntroMusic();

        if (!isPreview) {
          this.markIntroSeenInSession();
        }

        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          this.activeOverlay = null;
          resolve();
        }, 800);
      };

      overlay.querySelector('#fi-enter-btn').addEventListener('click', finishIntro);
      overlay.querySelector('#fi-skip-btn').addEventListener('click', finishIntro);

      const s1 = overlay.querySelector('#fi-s1');
      const s2 = overlay.querySelector('#fi-s2');
      const s3 = overlay.querySelector('#fi-s3');
      const s4 = overlay.querySelector('#fi-s4');
      const s5 = overlay.querySelector('#fi-s5');
      const s6 = overlay.querySelector('#fi-s6');

      s1.classList.add('active');

      setTimeout(() => {
        if (isFinished) return;
        s1.classList.remove('active');
        s1.classList.add('exit');
        s2.classList.add('active');
        overlay.querySelector('#fi-bg-sunrise').style.opacity = '1';
        setTimeout(() => {
          overlay.querySelector('#fi-gate').classList.add('open');
        }, 300);
      }, 3000);

      setTimeout(() => {
        if (isFinished) return;
        s2.classList.remove('active');
        s2.classList.add('exit');
        s3.classList.add('active');
        setTimeout(() => overlay.querySelector('#fi-chalk-1')?.classList.add('show'), 400);
        setTimeout(() => overlay.querySelector('#fi-chalk-2')?.classList.add('show'), 1400);
      }, 9700);

      setTimeout(() => {
        if (isFinished) return;
        s3.classList.remove('active');
        s3.classList.add('exit');
        s4.classList.add('active');
        overlay.querySelector('#fi-polaroids')?.classList.add('show');

        const imgs = overlay.querySelectorAll('#fi-polaroids img');
        imgs.forEach((img, index) => {
          console.log(`Image Element ${index + 1}:`, img);
          console.log(`Current src:`, img.src);
          console.log(`Natural Width:`, img.naturalWidth);
          console.log(`Natural Height:`, img.naturalHeight);
          console.log(`Loaded:`, img.complete && img.naturalWidth > 0);
          console.log(`Complete:`, img.complete);
        });
      }, 13700);

      setTimeout(() => {
        if (isFinished) return;
        s4.classList.remove('active');
        s4.classList.add('exit');
        s5.classList.add('active');
        const balloonContainer = overlay.querySelector('#fi-balloons');
        this.spawnBalloons(balloonContainer, 8);
        this.startConfetti(overlay.querySelector('#fi-confetti-canvas'));
      }, 17700);

      setTimeout(() => {
        if (isFinished) return;
        s5.classList.remove('active');
        s5.classList.add('exit');
        s6.classList.add('active');
      }, 21700);
    });
  }

  spawnParticles(container, count = 20) {
    if (!container) return;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'fi-particle';
      const size = Math.random() * 6 + 3;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.animationDuration = `${Math.random() * 4 + 4}s`;
      p.style.animationDelay = `${Math.random() * 3}s`;
      container.appendChild(p);
    }
  }

  spawnBalloons(container, count = 8) {
    if (!container) return;
    const colors = ['#ff7675', '#74b9ff', '#ffeaa7', '#55efc4', '#a29bfe'];
    for (let i = 0; i < count; i++) {
      const b = document.createElement('div');
      b.className = 'fi-balloon';
      b.style.background = colors[i % colors.length];
      b.style.left = `${10 + Math.random() * 80}%`;
      b.style.animationDuration = `${Math.random() * 3 + 5}s`;
      b.style.animationDelay = `${i * 0.4}s`;
      container.appendChild(b);
    }
  }

  startConfetti(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#ffd700', '#ff4500', '#00bfff', '#ff69b4', '#32cd32'];

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        r: Math.random() * 6 + 4,
        d: Math.random() * 60,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleIncremental: Math.random() * 0.07 + 0.05,
        tiltAngle: 0
      });
    }

    const draw = () => {
      if (!this.isPlaying) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p, i) => {
        p.tiltAngle += p.tiltAngleIncremental;
        p.y += (Math.cos(p.d) + 1 + p.r / 2) / 2;
        p.tilt = Math.sin(p.tiltAngle) * 15;

        if (p.y > canvas.height) {
          particles[i] = {
            x: Math.random() * canvas.width,
            y: -20,
            r: p.r,
            d: p.d,
            color: p.color,
            tilt: p.tilt,
            tiltAngleIncremental: p.tiltAngleIncremental,
            tiltAngle: p.tiltAngle
          };
        }

        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
        ctx.stroke();
      });
      requestAnimationFrame(draw);
    };

    draw();
  }
}

export const friendshipIntroManager = new FriendshipIntroManager();

if (typeof window !== 'undefined') {
  window.showFriendshipIntro = (isPreview = false) => friendshipIntroManager.showFriendshipIntro(isPreview);
}
