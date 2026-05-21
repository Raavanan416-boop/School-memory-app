// Leaderboard page — Engagement rankings with badges
import { db, collection, getDocs, query, orderBy, where, limit } from '../firebase-config.js';
import { sanitizeHTML, formatNumber } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';

export async function renderLeaderboard(container) {
  let users = [];
  let posts = [];
  let gameScores = [];

  try {
    const [usersSnap, postsSnap, scoresSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'posts')),
      getDocs(query(collection(db, 'games'), where('type', '==', 'score')))
    ]);

    usersSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
    postsSnap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    scoresSnap.forEach(d => gameScores.push(d.data()));
  } catch (e) {
    console.error('Leaderboard load error:', e);
  }

  // Calculate scores
  const scores = users.map(user => {
    const userPosts = posts.filter(p => p.authorId === user.id);
    const totalLikes = userPosts.reduce((sum, p) => sum + (p.likes?.length || 0), 0);
    const userGameWins = gameScores.filter(s => s.userId === user.id).reduce((sum, s) => sum + (s.score || 0), 0);

    const postPoints = userPosts.length * 5;
    const likePoints = totalLikes * 1;
    const gamePoints = userGameWins * 3;
    const total = postPoints + likePoints + gamePoints;

    // Badges
    const badges = [];
    if (userPosts.length >= 10) badges.push({ icon: '📸', name: 'Memory Maker' });
    if (userPosts.length >= 1) badges.push({ icon: '🎓', name: 'Alumni' });
    if (totalLikes >= 20) badges.push({ icon: '❤️', name: 'Beloved' });
    if (totalLikes >= 50) badges.push({ icon: '⭐', name: 'Star' });
    if (userGameWins >= 10) badges.push({ icon: '🎮', name: 'Gamer' });
    if (user.slamBook && Object.keys(user.slamBook).length >= 3) badges.push({ icon: '📖', name: 'Storyteller' });

    return {
      ...user,
      postCount: userPosts.length,
      totalLikes,
      gamePoints: userGameWins,
      total,
      badges
    };
  }).sort((a, b) => b.total - a.total);

  const top3 = scores.slice(0, 3);
  const rest = scores.slice(3);
  const myRank = scores.findIndex(s => s.id === authManager.currentUser?.uid) + 1;
  const myScore = scores.find(s => s.id === authManager.currentUser?.uid);

  container.innerHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-5">
        <button id="lb-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">🏆 Leaderboard</h2>
      </div>

      <!-- Podium -->
      <div class="card p-6 mb-6">
        <div class="flex items-end justify-center gap-3 mb-4" style="min-height:180px;">
          ${top3.length >= 2 ? `
            <!-- 2nd Place -->
            <div class="flex flex-col items-center flex-1 animate-slideUp" style="animation-delay:0.2s">
              <div class="relative mb-2">
                ${top3[1].profilePic
                  ? `<img src="${top3[1].profilePic}" class="w-14 h-14 rounded-full object-cover border-2 border-gray-300" alt=""/>`
                  : `<div class="w-14 h-14 rounded-full bg-gray-300 text-white flex items-center justify-center text-lg font-bold">${(top3[1].fullName || '?')[0]}</div>`}
                <div class="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gray-300 text-white flex items-center justify-center text-xs font-bold">2</div>
              </div>
              <p class="text-xs font-semibold text-navy-800 text-center truncate max-w-[80px]">${sanitizeHTML(top3[1].fullName || 'Unknown')}</p>
              <p class="text-[10px] text-gray-400">${formatNumber(top3[1].total)} pts</p>
              <div class="w-full h-20 bg-gray-100 rounded-t-xl mt-2"></div>
            </div>
          ` : ''}

          ${top3.length >= 1 ? `
            <!-- 1st Place -->
            <div class="flex flex-col items-center flex-1 animate-slideUp">
              <div class="text-2xl mb-1">👑</div>
              <div class="relative mb-2">
                ${top3[0].profilePic
                  ? `<img src="${top3[0].profilePic}" class="w-16 h-16 rounded-full object-cover border-3 border-yellow-400 shadow-lg" alt=""/>`
                  : `<div class="w-16 h-16 rounded-full bg-yellow-400 text-white flex items-center justify-center text-xl font-bold shadow-lg">${(top3[0].fullName || '?')[0]}</div>`}
                <div class="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-yellow-400 text-white flex items-center justify-center text-xs font-bold">1</div>
              </div>
              <p class="text-sm font-bold text-navy-800 text-center truncate max-w-[90px]">${sanitizeHTML(top3[0].fullName || 'Unknown')}</p>
              <p class="text-xs text-navy-500 font-semibold">${formatNumber(top3[0].total)} pts</p>
              <div class="w-full h-28 bg-yellow-50 border border-yellow-200 rounded-t-xl mt-2"></div>
            </div>
          ` : ''}

          ${top3.length >= 3 ? `
            <!-- 3rd Place -->
            <div class="flex flex-col items-center flex-1 animate-slideUp" style="animation-delay:0.4s">
              <div class="relative mb-2">
                ${top3[2].profilePic
                  ? `<img src="${top3[2].profilePic}" class="w-12 h-12 rounded-full object-cover border-2 border-orange-300" alt=""/>`
                  : `<div class="w-12 h-12 rounded-full bg-orange-300 text-white flex items-center justify-center text-sm font-bold">${(top3[2].fullName || '?')[0]}</div>`}
                <div class="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-orange-300 text-white flex items-center justify-center text-xs font-bold">3</div>
              </div>
              <p class="text-xs font-semibold text-navy-800 text-center truncate max-w-[80px]">${sanitizeHTML(top3[2].fullName || 'Unknown')}</p>
              <p class="text-[10px] text-gray-400">${formatNumber(top3[2].total)} pts</p>
              <div class="w-full h-14 bg-orange-50 rounded-t-xl mt-2"></div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- My Rank -->
      ${myScore ? `
        <div class="card p-4 mb-6 border-2 border-navy-200 bg-navy-50/30">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-navy-500">#${myRank}</span>
            ${myScore.profilePic
              ? `<img src="${myScore.profilePic}" class="w-10 h-10 rounded-full object-cover" alt=""/>`
              : `<div class="w-10 h-10 rounded-full bg-navy-500 text-white flex items-center justify-center text-sm font-bold">${(myScore.fullName || '?')[0]}</div>`}
            <div class="flex-1">
              <p class="text-sm font-semibold text-navy-800">You</p>
              <p class="text-xs text-gray-400">${myScore.postCount} posts · ${myScore.totalLikes} likes</p>
            </div>
            <span class="text-sm font-bold text-navy-500">${formatNumber(myScore.total)} pts</span>
          </div>
          <div class="flex flex-wrap gap-1 mt-2 pl-9">
            ${myScore.badges.map(b => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-navy-100 text-navy-600">${b.icon} ${b.name}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Full Rankings -->
      <h3 class="section-title mb-3">All Rankings</h3>
      <div class="space-y-2 mb-8">
        ${scores.map((s, i) => `
          <div class="card p-3 flex items-center gap-3 ${s.id === authManager.currentUser?.uid ? 'border border-navy-200' : ''}">
            <span class="text-sm font-bold text-gray-400 w-6 text-center">${i + 1}</span>
            ${s.profilePic
              ? `<img src="${s.profilePic}" class="w-9 h-9 rounded-full object-cover" alt=""/>`
              : `<div class="w-9 h-9 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs font-bold">${(s.fullName || '?')[0]}</div>`}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(s.fullName || 'Unknown')}</p>
              <p class="text-[10px] text-gray-400">${s.postCount} posts · ${s.totalLikes} likes · ${s.gamePoints} game pts</p>
            </div>
            <span class="text-xs font-bold text-navy-500">${formatNumber(s.total)}</span>
          </div>
        `).join('')}
      </div>

      <!-- Scoring Info -->
      <div class="card p-4 mb-6">
        <h3 class="section-title mb-2">How Scoring Works</h3>
        <div class="space-y-1 text-xs text-gray-500">
          <p>📸 Post a memory: <span class="font-semibold text-navy-600">+5 pts</span></p>
          <p>❤️ Each like received: <span class="font-semibold text-navy-600">+1 pt</span></p>
          <p>🎮 Game score points: <span class="font-semibold text-navy-600">+3 pts each</span></p>
        </div>
      </div>
    </section>
  `;

  container.querySelector('#lb-back-btn')?.addEventListener('click', () => router.navigateBack());
}
