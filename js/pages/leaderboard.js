// Leaderboard page — Social activity rankings with birthday points
import { db, collection, getDocs, query, orderBy, where, limit, onSnapshot } from '../firebase-config.js';
import { sanitizeHTML, formatNumber } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';

export async function renderLeaderboard(container) {
  let users = [];
  let posts = [];
  let polls = [];
  let diaries = [];
  let capsules = [];
  let birthdayPointsDocs = []; // Declared OUTSIDE try block to fix "not defined" error

  // Show loading
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
      </div>
    </section>`;
  container.querySelector('#lb-back-btn')?.addEventListener('click', () => router.navigateBack());

  try {
    const [usersSnap, postsSnap, pollsSnap, diariesSnap, capsulesSnap, bdayPointsSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'posts')),
      getDocs(collection(db, 'polls')).catch(() => ({ forEach: () => {} })),
      getDocs(collection(db, 'diary')).catch(() => ({ forEach: () => {} })),
      getDocs(collection(db, 'timecapsules')).catch(() => ({ forEach: () => {} })),
      getDocs(collection(db, 'birthdayPoints')).catch(() => ({ forEach: () => {} }))
    ]);

    usersSnap.forEach(d => users.push({ id: d.id, ...d.data() }));
    postsSnap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    pollsSnap.forEach(d => polls.push({ id: d.id, ...d.data() }));
    diariesSnap.forEach(d => diaries.push({ id: d.id, ...d.data() }));
    capsulesSnap.forEach(d => capsules.push({ id: d.id, ...d.data() }));
    bdayPointsSnap.forEach(d => birthdayPointsDocs.push({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Leaderboard load error:', e);
  }

  // Calculate scores — fixed point system
  const scores = users.map(user => {
    const userPosts = posts.filter(p => p.authorId === user.id);
    const totalLikes = userPosts.reduce((sum, p) => sum + (p.likes?.length || 0), 0);
    
    // Count comments made BY this user across all posts
    let totalComments = 0;
    posts.forEach(p => {
      if (p.comments && Array.isArray(p.comments)) {
        totalComments += p.comments.filter(c => c.userId === user.id || c.authorId === user.id).length;
      }
    });

    // Count polls, diary entries, time capsules created by this user
    const userPolls = polls.filter(p => p.authorId === user.id || p.createdBy === user.id);
    const userDiaries = diaries.filter(d => d.authorId === user.id || d.userId === user.id);
    const userCapsules = capsules.filter(c => c.authorId === user.id || c.createdBy === user.id);

    // Points calculation — fixed flat rates
    const postPoints = userPosts.length * 20;      // Each post = +20
    const likePoints = totalLikes * 10;             // Each like = +10
    const commentPoints = totalComments * 5;        // Each comment = +5
    const pollPoints = userPolls.length * 1;        // Each poll = +1
    const diaryPoints = userDiaries.length * 1;     // Each diary = +1
    const capsulePoints = userCapsules.length * 1;  // Each capsule = +1

    // Birthday points from birthdayPoints collection (safe — variable always exists)
    const userBdayPointsReceived = birthdayPointsDocs
      .filter(bp => bp.targetUserId === user.id)
      .reduce((sum, bp) => sum + (bp.points || 0), 0);

    const total = postPoints + likePoints + commentPoints + pollPoints + diaryPoints + capsulePoints + userBdayPointsReceived;

    // Activity badges
    const badges = [];
    if (userPosts.length >= 10) badges.push({ icon: '📸', name: 'Memory Maker' });
    if (userPosts.length >= 1) badges.push({ icon: '🎓', name: 'Alumni' });
    if (totalLikes >= 20) badges.push({ icon: '❤️', name: 'Beloved' });
    if (totalLikes >= 50) badges.push({ icon: '⭐', name: 'Superstar' });
    if (totalComments >= 10) badges.push({ icon: '💬', name: 'Chatterbox' });
    if (userPolls.length >= 3) badges.push({ icon: '📊', name: 'Pollster' });
    if (userDiaries.length >= 5) badges.push({ icon: '📖', name: 'Storyteller' });
    if (userBdayPointsReceived > 0) badges.push({ icon: '🎂', name: 'Birthday Star' });

    return {
      ...user,
      postCount: userPosts.length,
      totalLikes,
      totalComments,
      pollCount: userPolls.length,
      diaryCount: userDiaries.length,
      capsuleCount: userCapsules.length,
      birthdayPoints: userBdayPointsReceived,
      total,
      badges
    };
  }).sort((a, b) => b.total - a.total);

  // Only show users with points
  const scoredUsers = scores.filter(s => s.total > 0);
  const top3 = scoredUsers.slice(0, 3);
  const myScore = scores.find(s => s.id === authManager.currentUser?.uid);
  const myRank = scoredUsers.findIndex(s => s.id === authManager.currentUser?.uid) + 1;
  const hasActiveRankings = scoredUsers.length > 0;

  container.innerHTML = `
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

      <!-- My Rank (only if user has points) -->
      ${myScore && myScore.total > 0 ? `
        <div class="card p-4 mb-6 border-2 border-navy-200 bg-navy-50/30">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-navy-500">#${myRank}</span>
            ${myScore.profilePic
              ? `<img src="${myScore.profilePic}" class="w-10 h-10 rounded-full object-cover" alt=""/>`
              : `<div class="w-10 h-10 rounded-full bg-navy-500 text-white flex items-center justify-center text-sm font-bold">${(myScore.fullName || '?')[0]}</div>`}
            <div class="flex-1">
              <p class="text-sm font-semibold text-navy-800">You</p>
              <p class="text-xs text-gray-400">${myScore.postCount} posts · ${myScore.totalLikes} likes · ${myScore.totalComments} comments</p>
            </div>
            <span class="text-sm font-bold text-navy-500">${formatNumber(myScore.total)} pts</span>
          </div>
          <div class="flex flex-wrap gap-1 mt-2 pl-9">
            ${myScore.badges.map(b => `<span class="text-[10px] px-2 py-0.5 rounded-full bg-navy-100 text-navy-600">${b.icon} ${b.name}</span>`).join('')}
          </div>
        </div>
      ` : ''}
      ` : `
      <!-- Empty State — No Active Rankings -->
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
          <div class="card p-3 flex items-center gap-3 ${s.id === authManager.currentUser?.uid ? 'border border-navy-200' : ''} ${s.total === 0 ? 'opacity-60' : ''}" style="animation: msgSlideIn 0.3s ease-out ${i * 0.05}s both;">
            <span class="text-sm font-bold text-gray-400 w-6 text-center">${s.total > 0 ? (scoredUsers.indexOf(s) + 1) : '—'}</span>
            ${s.profilePic
              ? `<img src="${s.profilePic}" class="w-9 h-9 rounded-full object-cover" alt=""/>`
              : `<div class="w-9 h-9 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs font-bold">${(s.fullName || '?')[0]}</div>`}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(s.fullName || 'Unknown')}</p>
              <p class="text-[10px] text-gray-400">${s.postCount} posts · ${s.totalLikes} likes · ${s.totalComments} comments</p>
            </div>
            <span class="text-xs font-bold text-navy-500">${formatNumber(s.total)}</span>
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
          <p>📊 Create a poll: <span class="font-semibold text-navy-600">+1 pts</span></p>
          <p>📖 Diary entry: <span class="font-semibold text-navy-600">+1 pts</span></p>
          <p>⏳ Time capsule: <span class="font-semibold text-navy-600">+1 pts</span></p>
          <p>🎂 Birthday gift claim: <span class="font-semibold text-navy-600">+10 pts</span></p>
          <p>🎁 Birthday gift transfer: <span class="font-semibold text-navy-600">+5 pts to receiver</span></p>
        </div>
      </div>
    </section>
  `;

  container.querySelector('#lb-back-btn')?.addEventListener('click', () => router.navigateBack());
}
