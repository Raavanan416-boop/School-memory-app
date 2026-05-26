// Festival Themes - Auto-detect and apply themed overlays for special events
// Supports: Birthday, Friendship Day, New Year, Christmas, Diwali

import { authManager } from './auth.js';
import { showToast } from './utils.js';

const FESTIVAL_GREETING_KEY = 'festival_greeting_';

// Diwali dates (changes yearly)
const DIWALI_DATES = {
  2025: { month: 10, day: 20 },  // Oct 20, 2025
  2026: { month: 11, day: 8 },   // Nov 8, 2026
  2027: { month: 10, day: 29 },  // Oct 29, 2027
};

// Festival definitions
const FESTIVALS = {
  birthday: {
    name: 'Birthday',
    emoji: '🎂',
    cssClass: 'festival-birthday',
    greeting: 'Happy Birthday! 🎂',
    subtitle: 'May your memories be as sweet as today!',
    particleType: 'confetti',
    detect: () => {
      const dob = authManager.userData?.dateOfBirth;
      if (!dob) return false;
      const today = new Date();
      const d = new Date(dob);
      return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    }
  },
  friendship: {
    name: 'Friendship Day',
    emoji: '🤝',
    cssClass: 'festival-friendship',
    greeting: 'Happy Friendship Day! 💕',
    subtitle: 'Celebrate the bonds that last forever',
    particleType: 'hearts',
    detect: () => {
      const today = new Date();
      return today.getMonth() === 7 && (today.getDate() >= 3 && today.getDate() <= 4); // Aug 3-4
    }
  },
  newyear: {
    name: 'New Year',
    emoji: '🎉',
    cssClass: 'festival-newyear',
    greeting: 'Happy New Year! 🎆',
    subtitle: 'New year, same beautiful memories',
    particleType: 'fireworks',
    detect: () => {
      const today = new Date();
      return (today.getMonth() === 11 && today.getDate() === 31) || // Dec 31
             (today.getMonth() === 0 && today.getDate() <= 2);       // Jan 1-2
    }
  },
  christmas: {
    name: 'Christmas',
    emoji: '🎄',
    cssClass: 'festival-christmas',
    greeting: 'Merry Christmas! 🎄',
    subtitle: 'Wishing warmth and joy from our class family',
    particleType: 'snow',
    detect: () => {
      const today = new Date();
      return today.getMonth() === 11 && today.getDate() >= 24 && today.getDate() <= 26;
    }
  },
  diwali: {
    name: 'Diwali',
    emoji: '🪔',
    cssClass: 'festival-diwali',
    greeting: 'Happy Diwali! 🪔✨',
    subtitle: 'May our memories shine as bright as diyas',
    particleType: 'diyas',
    detect: () => {
      const today = new Date();
      const year = today.getFullYear();
      const diwali = DIWALI_DATES[year];
      if (!diwali) return false;
      const month = today.getMonth() + 1; // JS months 0-indexed
      const day = today.getDate();
      return month === diwali.month && day >= diwali.day - 1 && day <= diwali.day + 1;
    }
  }
};

class FestivalManager {
  constructor() {
    this.activeFestival = null;
    this.particleCanvas = null;
    this.particleCtx = null;
    this.particles = [];
    this.animFrameId = null;
    this.isVisible = true;
  }

  init() {
    // Detect active festival
    this.activeFestival = this.detectActiveFestival();

    if (this.activeFestival) {
      const festival = FESTIVALS[this.activeFestival];
      console.log(`[Festival] Active: ${festival.name}`);

      // Apply theme CSS class
      this.applyTheme(festival);

      // Set up particle canvas
      this.setupCanvas();

      // Start particles
      this.startParticles(festival.particleType);

      // Show greeting (once per session per festival)
      this.showGreeting(festival);

      // Pause particles when tab is hidden
      document.addEventListener('visibilitychange', () => {
        this.isVisible = !document.hidden;
        if (this.isVisible && this.activeFestival) {
          this.startParticleLoop();
        }
      });
    }
  }

  detectActiveFestival() {
    // Priority: birthday > diwali > christmas > newyear > friendship
    const priority = ['birthday', 'diwali', 'christmas', 'newyear', 'friendship'];
    for (const key of priority) {
      if (FESTIVALS[key].detect()) return key;
    }
    return null;
  }

  applyTheme(festival) {
    // Remove any existing festival classes
    document.body.classList.forEach(cls => {
      if (cls.startsWith('festival-')) document.body.classList.remove(cls);
    });
    document.body.classList.add(festival.cssClass);
  }

  removeTheme() {
    document.body.classList.forEach(cls => {
      if (cls.startsWith('festival-')) document.body.classList.remove(cls);
    });
    this.stopParticles();
  }

  setupCanvas() {
    let canvas = document.getElementById('festival-particles');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'festival-particles';
      canvas.className = 'festival-canvas';
      document.body.appendChild(canvas);
    }
    this.particleCanvas = canvas;
    this.particleCtx = canvas.getContext('2d');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    if (!this.particleCanvas) return;
    this.particleCanvas.width = window.innerWidth;
    this.particleCanvas.height = window.innerHeight;
  }

  startParticles(type) {
    this.particles = [];
    const count = type === 'snow' ? 40 : type === 'fireworks' ? 20 : 30;
    for (let i = 0; i < count; i++) {
      this.particles.push(this.createParticle(type, i));
    }
    this.startParticleLoop();
  }

  createParticle(type, index) {
    const W = this.particleCanvas?.width || window.innerWidth;
    const H = this.particleCanvas?.height || window.innerHeight;

    switch (type) {
      case 'confetti':
        return {
          type, x: Math.random() * W, y: -20 - Math.random() * H,
          vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2.5,
          size: 4 + Math.random() * 6, rotation: Math.random() * 360,
          rotSpeed: (Math.random() - 0.5) * 8,
          color: ['#ffd700', '#ff6b6b', '#48dbfb', '#ff9ff3', '#54a0ff', '#ff8c00', '#00d2d3'][Math.floor(Math.random() * 7)],
          shape: Math.random() > 0.5 ? 'rect' : 'circle',
          opacity: 0.7 + Math.random() * 0.3
        };

      case 'hearts':
        return {
          type, x: Math.random() * W, y: H + 20 + Math.random() * 100,
          vx: (Math.random() - 0.5) * 1, vy: -(0.5 + Math.random() * 1.5),
          size: 8 + Math.random() * 12, rotation: 0,
          color: ['#ff6b6b', '#ff9ff3', '#e11d48', '#f472b6', '#fda4af'][Math.floor(Math.random() * 5)],
          opacity: 0.3 + Math.random() * 0.5,
          wobblePhase: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.02 + Math.random() * 0.03
        };

      case 'fireworks':
        return {
          type, x: Math.random() * W, y: Math.random() * H * 0.6,
          vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
          size: 2 + Math.random() * 3, life: 60 + Math.random() * 60,
          maxLife: 120,
          color: ['#ffd700', '#ff6b6b', '#48dbfb', '#ff9ff3', '#8b5cf6', '#00d2d3'][Math.floor(Math.random() * 6)],
          opacity: 1, trail: []
        };

      case 'snow':
        return {
          type, x: Math.random() * W, y: -10 - Math.random() * H * 0.5,
          vx: (Math.random() - 0.5) * 0.5, vy: 0.3 + Math.random() * 1.2,
          size: 2 + Math.random() * 5,
          opacity: 0.3 + Math.random() * 0.5,
          wobblePhase: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.01 + Math.random() * 0.02
        };

      case 'diyas':
        return {
          type, x: Math.random() * W, y: H + 10 + Math.random() * 50,
          vx: (Math.random() - 0.5) * 0.3, vy: -(0.3 + Math.random() * 0.8),
          size: 4 + Math.random() * 6,
          color: ['#fbbf24', '#f59e0b', '#d97706', '#ff8c00', '#fcd34d'][Math.floor(Math.random() * 5)],
          opacity: 0.4 + Math.random() * 0.5,
          glowPhase: Math.random() * Math.PI * 2,
          glowSpeed: 0.03 + Math.random() * 0.04
        };

      default:
        return { type: 'confetti', x: 0, y: 0, vx: 0, vy: 1, size: 4, opacity: 0, color: '#fff' };
    }
  }

  startParticleLoop() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    const loop = () => {
      if (!this.isVisible || !this.particleCtx) return;
      this.updateAndDrawParticles();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  updateAndDrawParticles() {
    const ctx = this.particleCtx;
    const W = this.particleCanvas.width;
    const H = this.particleCanvas.height;
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Type-specific updates
      if (p.type === 'confetti') {
        p.rotation += p.rotSpeed;
        if (p.y > H + 20) {
          Object.assign(p, this.createParticle('confetti', i));
          p.y = -20;
        }
      } else if (p.type === 'hearts') {
        p.wobblePhase += p.wobbleSpeed;
        p.x += Math.sin(p.wobblePhase) * 0.5;
        if (p.y < -30) {
          Object.assign(p, this.createParticle('hearts', i));
        }
      } else if (p.type === 'fireworks') {
        p.life--;
        p.opacity = Math.max(0, p.life / p.maxLife);
        p.vy += 0.02; // gravity
        if (p.life <= 0) {
          Object.assign(p, this.createParticle('fireworks', i));
        }
      } else if (p.type === 'snow') {
        p.wobblePhase += p.wobbleSpeed;
        p.x += Math.sin(p.wobblePhase) * 0.3;
        if (p.y > H + 10) {
          Object.assign(p, this.createParticle('snow', i));
          p.y = -10;
        }
      } else if (p.type === 'diyas') {
        p.glowPhase += p.glowSpeed;
        p.opacity = 0.4 + Math.sin(p.glowPhase) * 0.2;
        if (p.y < -20) {
          Object.assign(p, this.createParticle('diyas', i));
        }
      }

      // Draw
      ctx.save();
      ctx.globalAlpha = p.opacity;

      if (p.type === 'confetti') {
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (p.type === 'hearts') {
        this.drawHeart(ctx, p.x, p.y, p.size, p.color);
      } else if (p.type === 'fireworks') {
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'snow') {
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'diyas') {
        // Glow circle
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 12;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Inner bright core
        ctx.globalAlpha = p.opacity + 0.2;
        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  drawHeart(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const s = size / 2;
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y - s * 0.3, x - s, y - s * 0.3, x - s, y + s * 0.1);
    ctx.bezierCurveTo(x - s, y + s * 0.6, x, y + s, x, y + s);
    ctx.bezierCurveTo(x, y + s, x + s, y + s * 0.6, x + s, y + s * 0.1);
    ctx.bezierCurveTo(x + s, y - s * 0.3, x, y - s * 0.3, x, y + s * 0.3);
    ctx.fill();
  }

  stopParticles() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.particleCtx && this.particleCanvas) {
      this.particleCtx.clearRect(0, 0, this.particleCanvas.width, this.particleCanvas.height);
    }
    this.particles = [];
  }

  showGreeting(festival) {
    const greetingKey = FESTIVAL_GREETING_KEY + this.activeFestival + '_' + new Date().toDateString();
    if (sessionStorage.getItem(greetingKey)) return;
    sessionStorage.setItem(greetingKey, '1');

    // Wait for app to load, then show greeting banner
    setTimeout(() => {
      const banner = document.createElement('div');
      banner.className = 'festival-greeting-banner';
      banner.innerHTML = `
        <div class="festival-greeting-content">
          <span class="festival-greeting-emoji">${festival.emoji}</span>
          <div class="festival-greeting-text">
            <h3 class="festival-greeting-title">${festival.greeting}</h3>
            <p class="festival-greeting-subtitle">${festival.subtitle}</p>
          </div>
          <button class="festival-greeting-close" id="festival-greeting-close">✕</button>
        </div>
      `;
      document.body.appendChild(banner);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          banner.classList.add('visible');
        });
      });

      const dismiss = () => {
        banner.classList.remove('visible');
        setTimeout(() => banner.remove(), 400);
      };

      banner.querySelector('#festival-greeting-close')?.addEventListener('click', dismiss);
      // Auto-dismiss after 6 seconds
      setTimeout(dismiss, 6000);
    }, 2000);
  }

  destroy() {
    this.removeTheme();
    if (this.particleCanvas) {
      this.particleCanvas.remove();
      this.particleCanvas = null;
    }
  }
}

export const festivalManager = new FestivalManager();
