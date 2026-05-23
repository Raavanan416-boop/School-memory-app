// Games page — FINAL: 3 fixed games with predefined links, premium nostalgic design
// No user-editable links. Click = instant open.

import { router } from '../router.js';

// ===== FIXED GAME DEFINITIONS =====
const GAMES = [
  {
    id: 'spin-the-bottle',
    icon: '🍾',
    name: 'Spin The Bottle',
    desc: 'Let fate decide who\'s next! A classic party game for your class.',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    glow: 'rgba(102,126,234,0.3)',
    url: 'https://raavanan416-boop.github.io/Truth-or-Dare-Game/'
  },
  {
    id: 'guess-the-memory',
    icon: '🧠',
    name: 'Guess The Memory',
    desc: 'How well do you remember school? Guess photos, events & classroom moments!',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    glow: 'rgba(240,147,251,0.3)',
    url: 'https://friends-understand.onrender.com'
  },
  {
    id: 'one-year-complete',
    icon: '🌐',
    name: 'One Year Complete Web',
    desc: 'Celebrate your school anniversary with a beautiful timeline & emotional recap.',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    glow: 'rgba(79,172,254,0.3)',
    url: 'https://raavanan416-boop.github.io/One-year-complete-/'
  }
];

export async function renderGames(container) {
  container.innerHTML = `
    <section class="games-page">
      <!-- Header -->
      <div class="games-header">
        <button id="games-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <div class="flex-1">
          <h2 class="games-title">Games</h2>
          <p class="games-subtitle">A nostalgic fun zone 🎮</p>
        </div>
      </div>

      <!-- Games List -->
      <div class="games-list">
        ${GAMES.map((g, i) => `
          <button class="game-card-premium" data-game-id="${g.id}" data-url="${g.url}" style="--game-gradient: ${g.gradient}; --game-glow: ${g.glow}; animation-delay: ${i * 0.1}s">
            <div class="game-card-icon-wrap" style="background: ${g.gradient}">
              <span class="game-card-icon">${g.icon}</span>
            </div>
            <div class="game-card-info">
              <h3 class="game-card-name">${g.name}</h3>
              <p class="game-card-desc">${g.desc}</p>
            </div>
            <div class="game-card-arrow">
              <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
            </div>
          </button>
        `).join('')}
      </div>

      <!-- Footer Quote -->
      <div class="games-footer">
        <p class="games-footer-text">"The best memories are made with friends" ✨</p>
      </div>
    </section>
  `;

  // Back button
  container.querySelector('#games-back-btn')?.addEventListener('click', () => router.navigateBack());

  // Game card click → open fixed URL instantly
  container.querySelectorAll('.game-card-premium').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.dataset.url;
      if (url) {
        // Ripple effect
        card.classList.add('game-card-pressed');
        setTimeout(() => {
          window.open(url, '_blank', 'noopener,noreferrer');
          card.classList.remove('game-card-pressed');
        }, 200);
      }
    });
  });
}
