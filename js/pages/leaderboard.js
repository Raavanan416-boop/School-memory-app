// Leaderboard page — Social activity rankings with real-time sync
import { db, collection, query, onSnapshot, orderBy, getDocs, limit, doc, writeBatch } from '../firebase-config.js';
import { sanitizeHTML, formatNumber } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';

import { userCache } from '../services/userCache.js';

let cacheListener = null;

export function destroyLeaderboard() {
  if (cacheListener) {
    // We should implement removeListener in userCache, but for now we can just rebuild the listeners array
    userCache.listeners = userCache.listeners.filter(l => l !== cacheListener);
    cacheListener = null;
  }
}

function updateUI(container, scores) {
  // Sort descending by points locally
  scores.sort((a, b) => (b.points || 0) - (a.points || 0));

  const scoredUsers = scores.filter(s => s.points > 0);
  const top3 = scoredUsers.slice(0, 3);
  const myScore = scores.find(s => s.id === authManager.currentUser?.uid);
  const myRank = scoredUsers.findIndex(s => s.id === authManager.currentUser?.uid) + 1;
  const hasActiveRankings = scoredUsers.length > 0;

  const contentHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-5">
        <button id="lb-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">🏆 Leaderboard</h2>
      </div>

      ${hasActiveRankings ? `
      <!-- Podium -->
      <div class="card p-6 mb-6">
        <div class="flex items-end justify-center gap-3 mb-4" style="min-height:180px;">
          ${top3.length >= 2 ? `
            <div class="flex flex-col items-center flex-1 animate-slideUp" style="animation-delay:0.2s">
              <div class="relative mb-2">
                ${top3[1].profilePic
                  ? `<img src="${top3[1].profilePic}" class="w-14 h-14 rounded-full object-cover border-2 border-gray-300" alt="" data-user-pic="${top3[1].id}"/>`
                  : `<div class="w-14 h-14 rounded-full bg-gray-300 text-white flex items-center justify-center text-lg font-bold" data-user-pic="${top3[1].id}">${(top3[1].fullName || '?')[0]}</div>`}
                <div class="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gray-300 text-white flex items-center justify-center text-xs font-bold">2</div>
              </div>
              <p class="text-xs font-semibold text-navy-800 text-center truncate max-w-[80px]" data-user-name="${top3[1].id}">${sanitizeHTML(top3[1].fullName || 'Unknown')}</p>
              <p class="text-[10px] text-gray-400">${formatNumber(top3[1].points)} pts</p>
              <div class="w-full h-20 bg-gray-100 rounded-t-xl mt-2"></div>
            </div>
          ` : ''}

          ${top3.length >= 1 ? `
            <div class="flex flex-col items-center flex-1 animate-slideUp">
              <div class="text-2xl mb-1">👑</div>
              <div class="relative mb-2">
                ${top3[0].profilePic
                  ? `<img src="${top3[0].profilePic}" class="w-16 h-16 rounded-full object-cover border-3 border-yellow-400 shadow-lg" alt="" data-user-pic="${top3[0].id}"/>`
                  : `<div class="w-16 h-16 rounded-full bg-yellow-400 text-white flex items-center justify-center text-xl font-bold shadow-lg" data-user-pic="${top3[0].id}">${(top3[0].fullName || '?')[0]}</div>`}
                <div class="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-yellow-400 text-white flex items-center justify-center text-xs font-bold">1</div>
              </div>
              <p class="text-sm font-bold text-navy-800 text-center truncate max-w-[90px]" data-user-name="${top3[0].id}">${sanitizeHTML(top3[0].fullName || 'Unknown')}</p>
              <p class="text-xs text-navy-500 font-semibold">${formatNumber(top3[0].points)} pts</p>
              <div class="w-full h-28 bg-yellow-50 border border-yellow-200 rounded-t-xl mt-2"></div>
            </div>
          ` : ''}

          ${top3.length >= 3 ? `
            <div class="flex flex-col items-center flex-1 animate-slideUp" style="animation-delay:0.4s">
              <div class="relative mb-2">
                ${top3[2].profilePic
                  ? `<img src="${top3[2].profilePic}" class="w-12 h-12 rounded-full object-cover border-2 border-orange-300" alt="" data-user-pic="${top3[2].id}"/>`
                  : `<div class="w-12 h-12 rounded-full bg-orange-300 text-white flex items-center justify-center text-sm font-bold" data-user-pic="${top3[2].id}">${(top3[2].fullName || '?')[0]}</div>`}
                <div class="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-orange-300 text-white flex items-center justify-center text-xs font-bold">3</div>
              </div>
              <p class="text-xs font-semibold text-navy-800 text-center truncate max-w-[80px]" data-user-name="${top3[2].id}">${sanitizeHTML(top3[2].fullName || 'Unknown')}</p>
              <p class="text-[10px] text-gray-400">${formatNumber(top3[2].points)} pts</p>
              <div class="w-full h-14 bg-orange-50 rounded-t-xl mt-2"></div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- My Rank -->
      ${myScore ? `
        <div class="card p-4 mb-6 border-2 border-navy-200 bg-navy-50/30">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-navy-500">#${myRank > 0 ? myRank : '—'}</span>
            ${myScore.profilePic
              ? `<img src="${myScore.profilePic}" class="w-10 h-10 rounded-full object-cover" alt="" data-user-pic="${myScore.id}"/>`
              : `<div class="w-10 h-10 rounded-full bg-navy-500 text-white flex items-center justify-center text-sm font-bold" data-user-pic="${myScore.id}">${(myScore.fullName || '?')[0]}</div>`}
            <div class="flex-1">
              <p class="text-sm font-semibold text-navy-800">You</p>
            </div>
            <span class="text-sm font-bold text-navy-500">${formatNumber(myScore.points)} pts</span>
          </div>
        </div>
      ` : ''}
      ` : `
      <!-- Empty State -->
      <div class="card p-8 mb-6 text-center">
        <div class="text-5xl mb-4">🏅</div>
        <h3 class="text-lg font-bold text-navy-800 mb-2">No active rankings yet</h3>
        <p class="text-sm text-gray-400 mb-1">Start posting memories, earning likes, and commenting to climb the leaderboard!</p>
        <div class="flex flex-wrap justify-center gap-2 mt-4">
          <span class="text-[11px] px-3 py-1 rounded-full bg-navy-50 text-navy-600">📸 Post = +20 pts</span>
          <span class="text-[11px] px-3 py-1 rounded-full bg-navy-50 text-navy-600">❤️ Like = +10 pts</span>
          <span class="text-[11px] px-3 py-1 rounded-full bg-navy-50 text-navy-600">💬 Comment = +5 pts</span>
        </div>
      </div>
      `}

      <!-- Full Rankings -->
      <h3 class="section-title mb-3">All Rankings</h3>
      <div class="space-y-2 mb-8">
        ${scores.map((s, i) => `
          <div class="card p-3 flex items-center gap-3 ${s.id === authManager.currentUser?.uid ? 'border border-navy-200' : ''} ${s.points === 0 ? 'opacity-60' : ''}" style="animation: msgSlideIn 0.3s ease-out ${i * 0.05}s both;">
            <span class="text-sm font-bold text-gray-400 w-6 text-center">${s.points > 0 ? (scoredUsers.indexOf(s) + 1) : '—'}</span>
            ${s.profilePic
              ? `<img src="${s.profilePic}" class="w-9 h-9 rounded-full object-cover" alt="" data-user-pic="${s.id}"/>`
              : `<div class="w-9 h-9 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs font-bold" data-user-pic="${s.id}">${(s.fullName || '?')[0]}</div>`}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate" data-user-name="${s.id}">${sanitizeHTML(s.fullName || 'Unknown')}</p>
            </div>
            <span class="text-xs font-bold text-navy-500">${formatNumber(s.points)} pts</span>
          </div>
        `).join('')}
      </div>

      <!-- Scoring Info -->
      <div class="card p-4 mb-6">
        <h3 class="section-title mb-2">How Scoring Works</h3>
        <div class="space-y-1.5 text-xs text-gray-500">
          <p>📸 Post a memory: <span class="font-semibold text-navy-600">+20 pts</span></p>
          <p>❤️ Each like received: <span class="font-semibold text-navy-600">+10 pts</span></p>
          <p>💬 Each comment: <span class="font-semibold text-navy-600">+5 pts</span></p>
          <p>📚 Create a Slam Book: <span class="font-semibold text-navy-600">+6 pts</span></p>
          <p>📝 Answer a Slam Book: <span class="font-semibold text-navy-600">+3 pts</span></p>
          <p>📊 Create a poll: <span class="font-semibold text-navy-600">+2 pts</span></p>
          <p>📖 Diary entry: <span class="font-semibold text-navy-600">+4 pts</span></p>
          <p>⏳ Time capsule: <span class="font-semibold text-navy-600">+5 pts</span></p>
          <p>🎂 Birthday gift claim: <span class="font-semibold text-navy-600">+10 pts</span></p>
          <p>🎁 Birthday gift transfer: <span class="font-semibold text-navy-600">+5 pts to receiver</span></p>
        </div>
      </div>
    </section>
  `;

  container.innerHTML = contentHTML;
  container.querySelector('#lb-back-btn')?.addEventListener('click', () => router.navigateBack());
}

async function setupRealtimeSync(container) {
  console.log(`[Leaderboard] Syncing directly from userCache...`);
  
  const refreshUI = () => {
    if (router.currentPage !== 'leaderboard') return;
    const scores = userCache.getAllUsers();
    updateUI(container, scores);
  };

  cacheListener = refreshUI;
  userCache.onChange(cacheListener);
  
  // Initial render
  refreshUI();
}

export function renderLeaderboard(container) {
  router.registerDestroy('leaderboard', destroyLeaderboard);
  destroyLeaderboard();

  // Show loading skeleton initially
  container.innerHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-5">
        <button id="lb-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">🏆 Leaderboard</h2>
      </div>
      <div class="space-y-3">
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>
    </section>`;
  
  container.querySelector('#lb-back-btn')?.addEventListener('click', () => router.navigateBack());

  setupRealtimeSync(container);
}
