import { db, doc, getDoc, setDoc, serverTimestamp } from '../firebase-config.js';

class FriendshipIntroManager {
  constructor() {
    this.settingsRef = doc(db, 'systemSettings', 'friendshipIntro');
    this.audioCtx = null;
    this.bgMusicTimer = null;
    this.isPlaying = false;
    this.activeOverlay = null;
    this.cachedSettings = { enabled: false, selectedDate: '2026-08-02' };
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

  // ===== AUDIO SYNTHESIS & SOUND EFFECTS =====
  initAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  playSchoolBell() {
    try {
      const bellAudio = new Audio('/schoolbell.mp3');
      bellAudio.volume = 0.6;
      bellAudio.play().catch(() => {
        this.initAudioContext();
        if (!this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        [830, 1245, 1660].forEach(freq => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now);
          osc.stop(now + 1.9);
        });
      });
    } catch (e) {}
  }

  playBirdChirp() {
    try {
      this.initAudioContext();
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      [0, 0.25, 0.5].forEach((delay, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        const startFreq = 2200 + idx * 300;
        osc.frequency.setValueAtTime(startFreq, now + delay);
        osc.frequency.exponentialRampToValueAtTime(3200, now + delay + 0.08);
        gain.gain.setValueAtTime(0.06, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.13);
      });
    } catch (e) {}
  }

  startEmotionalMusic() {
    try {
      this.initAudioContext();
      if (!this.audioCtx) return;

      const notes = [
        [261.63, 329.63, 392.00],
        [196.00, 246.94, 293.66],
        [220.00, 261.63, 329.63],
        [174.61, 220.00, 261.63]
      ];
      let step = 0;

      const playChord = () => {
        if (!this.isPlaying || !this.audioCtx) return;
        const currentChord = notes[step % notes.length];
        const now = this.audioCtx.currentTime;

        currentChord.forEach((freq, i) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.15);

          gain.gain.setValueAtTime(0, now + i * 0.15);
          gain.gain.linearRampToValueAtTime(0.05, now + i * 0.15 + 0.4);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 2.2);

          osc.connect(gain);
          gain.connect(this.audioCtx.destination);

          osc.start(now + i * 0.15);
          osc.stop(now + i * 0.15 + 2.3);
        });

        step++;
      };

      playChord();
      this.bgMusicTimer = setInterval(playChord, 2200);
    } catch (e) {}
  }

  stopIntroMusic() {
    this.isPlaying = false;
    if (this.bgMusicTimer) {
      clearInterval(this.bgMusicTimer);
      this.bgMusicTimer = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close().catch(() => {});
      } catch (e) {}
      this.audioCtx = null;
    }
  }

  // ===== CINEMATIC INTRO CONTROLLER =====
  playFriendshipIntro(isPreview = false) {
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

          <!-- Screen 2: School Gate Sunrise -->
          <div class="fi-screen" id="fi-s2">
            <div class="fi-gate-wrapper" id="fi-gate">
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

          <!-- Screen 4: Polaroids & Paper Airplanes -->
          <div class="fi-screen" id="fi-s4">
            <div class="fi-paper-plane">✈️</div>
            <div class="fi-polaroids-grid" id="fi-polaroids">
              <div class="fi-polaroid fi-polaroid-1">
                <img src="/assets/KA8_6114.JPG" alt="Memory 1" onError="console.error('Image failed: KA8_6114.JPG. Reason: 404/Invalid path:', this.src); this.src='/assets/class-memories-logo.png';"/>
                <div class="fi-polaroid-caption">Classroom Fun 📸</div>
              </div>
              <div class="fi-polaroid fi-polaroid-2">
                <img src="/assets/KA8_6118.JPG" alt="Memory 2" onError="console.error('Image failed: KA8_6118.JPG. Reason: 404/Invalid path:', this.src); this.src='/assets/class-memories-logo.png';"/>
                <div class="fi-polaroid-caption">Lunch Breaks 🥪</div>
              </div>
              <div class="fi-polaroid fi-polaroid-3">
                <img src="/assets/school.jpg" alt="Memory 3" onError="console.error('Image failed: school.jpg. Reason: 404/Invalid path:', this.src); this.src='/assets/class-memories-logo.png';"/>
                <div class="fi-polaroid-caption">Bench Partners ✏️</div>
              </div>
            </div>
          </div>

          <!-- Screen 5: Group Silhouettes & Balloons -->
          <div class="fi-screen" id="fi-s5">
            <div class="fi-scrapbook-stage">
              <div class="fi-balloons-container" id="fi-balloons"></div>
              <div class="fi-silhouette" style="background-image: url('/assets/KA8_6103.JPG');"></div>
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

      const particlesContainer = overlay.querySelector('#fi-particles');
      this.spawnParticles(particlesContainer, 20);

      this.playSchoolBell();
      this.startEmotionalMusic();

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
        this.playBirdChirp();
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
      }, 6500);

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
      }, 10500);

      setTimeout(() => {
        if (isFinished) return;
        s4.classList.remove('active');
        s4.classList.add('exit');
        s5.classList.add('active');
        const balloonContainer = overlay.querySelector('#fi-balloons');
        this.spawnBalloons(balloonContainer, 8);
        this.startConfetti(overlay.querySelector('#fi-confetti-canvas'));
      }, 14500);

      setTimeout(() => {
        if (isFinished) return;
        s5.classList.remove('active');
        s5.classList.add('exit');
        s6.classList.add('active');
      }, 18500);
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
