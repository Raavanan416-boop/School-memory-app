// Cinematic Intro - Premium school gate opening animation
// Phase 1: Gate opens -> Phase 2: Campus revealed -> Phase 3: Bell + Welcome -> Phase 4: Fade to app

const INTRO_SEEN_KEY = 'cinematic_intro_seen';

function hasSeenIntro() {
  return localStorage.getItem(INTRO_SEEN_KEY) === '1';
}

function markIntroSeen() {
  localStorage.setItem(INTRO_SEEN_KEY, '1');
}

// School bell sound using Web Audio API
function playSchoolBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // Classic school bell — metallic ring with harmonics
    const bellNotes = [
      { freq: 830, start: 0, dur: 1.2, gain: 0.18 },
      { freq: 1245, start: 0, dur: 0.9, gain: 0.12 },
      { freq: 1660, start: 0, dur: 0.7, gain: 0.06 },
      // Second strike
      { freq: 830, start: 0.6, dur: 1.2, gain: 0.15 },
      { freq: 1245, start: 0.6, dur: 0.9, gain: 0.10 },
      { freq: 1660, start: 0.6, dur: 0.7, gain: 0.05 },
    ];

    bellNotes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(n.gain, now + n.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.1);
    });

    setTimeout(() => ctx.close().catch(() => {}), 2500);
  } catch (e) { /* Web Audio not supported */ }
}

// Spawn golden light particles
function spawnLightParticles(container, count = 25) {
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = 'intro-light-particle';
    const size = 3 + Math.random() * 6;
    const x = 20 + Math.random() * 60;
    const y = 20 + Math.random() * 60;
    const delay = Math.random() * 2;
    const duration = 2 + Math.random() * 3;
    particle.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${x}%; top: ${y}%;
      animation-delay: ${delay}s;
      animation-duration: ${duration}s;
      opacity: 0;
    `;
    container.appendChild(particle);
  }
}

// Spawn bokeh circles
function spawnBokeh(container, count = 12) {
  for (let i = 0; i < count; i++) {
    const bokeh = document.createElement('div');
    bokeh.className = 'intro-bokeh';
    const size = 20 + Math.random() * 60;
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const delay = Math.random() * 3;
    const duration = 4 + Math.random() * 4;
    bokeh.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${x}%; top: ${y}%;
      animation-delay: ${delay}s;
      animation-duration: ${duration}s;
    `;
    container.appendChild(bokeh);
  }
}

// Spawn floating dust motes
function spawnDust(container, count = 15) {
  for (let i = 0; i < count; i++) {
    const dust = document.createElement('div');
    dust.className = 'intro-dust';
    const size = 2 + Math.random() * 3;
    const x = Math.random() * 100;
    const delay = Math.random() * 4;
    const duration = 5 + Math.random() * 5;
    dust.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${x}%; bottom: -10px;
      animation-delay: ${delay}s;
      animation-duration: ${duration}s;
    `;
    container.appendChild(dust);
  }
}

export function playCinematicIntro() {
  return new Promise((resolve) => {
    // Skip if already seen
    if (hasSeenIntro()) {
      resolve(false);
      return;
    }

    // Create the full-screen cinematic overlay
    const overlay = document.createElement('div');
    overlay.id = 'cinematic-intro';
    overlay.className = 'cinematic-overlay';
    overlay.innerHTML = `
      <!-- Golden ambient glow behind gate -->
      <div class="intro-ambient-glow"></div>

      <!-- Bokeh/particle layers -->
      <div class="intro-particles-layer" id="intro-particles"></div>

      <!-- Gate Scene -->
      <div class="intro-gate-scene">
        <!-- Left Gate Door -->
        <div class="intro-gate-left" id="gate-left">
          <div class="intro-gate-panel">
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-ornament">📖</div>
          </div>
        </div>
        <!-- Right Gate Door -->
        <div class="intro-gate-right" id="gate-right">
          <div class="intro-gate-panel">
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-bar"></div>
            <div class="intro-gate-ornament">🎓</div>
          </div>
        </div>
        <!-- Gate arch text -->
        <div class="intro-gate-arch">
          <span class="intro-arch-text">Our School</span>
        </div>
        <!-- Gate pillars -->
        <div class="intro-gate-pillar intro-gate-pillar-left"></div>
        <div class="intro-gate-pillar intro-gate-pillar-right"></div>
      </div>

      <!-- Campus Scene (behind gates, revealed when they open) -->
      <div class="intro-campus-scene" id="intro-campus">
        <div class="intro-campus-sky"></div>
        <div class="intro-campus-ground"></div>
        <div class="intro-campus-building"></div>
        <div class="intro-campus-tree intro-tree-left"></div>
        <div class="intro-campus-tree intro-tree-right"></div>
        <div class="intro-campus-path"></div>
      </div>

      <!-- Welcome text overlay -->
      <div class="intro-welcome-text" id="intro-welcome">
        <div class="intro-bell-icon" id="intro-bell">🔔</div>
        <h1 class="intro-title">ClassMemories</h1>
        <p class="intro-subtitle">Where every moment lives forever</p>
      </div>

      <!-- Skip button -->
      <button class="intro-skip-btn" id="intro-skip">
        Skip <svg class="w-4 h-4 inline-block ml-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
      </button>
    `;

    document.body.appendChild(overlay);

    // Spawn particles
    const particlesLayer = overlay.querySelector('#intro-particles');
    spawnLightParticles(particlesLayer, 25);
    spawnBokeh(particlesLayer, 12);

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      markIntroSeen();
      overlay.classList.add('intro-fade-out');
      setTimeout(() => {
        overlay.remove();
        resolve(true);
      }, 800);
    };

    // Skip button
    overlay.querySelector('#intro-skip')?.addEventListener('click', finish);

    // Show skip button after 1.5s
    setTimeout(() => {
      const skipBtn = overlay.querySelector('#intro-skip');
      if (skipBtn) skipBtn.classList.add('visible');
    }, 1500);

    // Start animation sequence
    requestAnimationFrame(() => {
      overlay.classList.add('intro-active');

      // Phase 1 (0-2s): Gate starts opening
      setTimeout(() => {
        overlay.classList.add('intro-phase-gate-open');
      }, 800);

      // Phase 2 (2-4s): Campus revealed, dust particles
      setTimeout(() => {
        overlay.classList.add('intro-phase-campus');
        spawnDust(particlesLayer, 15);
      }, 2200);

      // Phase 3 (4-5.5s): Bell sound + welcome text
      setTimeout(() => {
        playSchoolBell();
        overlay.classList.add('intro-phase-welcome');
      }, 3800);

      // Phase 4 (6.5s): Auto-finish
      setTimeout(finish, 6500);
    });
  });
}
