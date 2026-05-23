// Home page — Full-featured feed with comments, share, save, throwback, double-tap like
import { db, collection, query, orderBy, limit, onSnapshot, doc, updateDoc, addDoc,
  arrayUnion, arrayRemove, serverTimestamp, getDocs, where, startAfter, increment, deleteDoc } from '../firebase-config.js';
import { getTimeSinceSchool, EMOTIONAL_QUOTES, timeAgo, sanitizeHTML, isBirthdayToday, formatNumber } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';
import { showDeleteConfirmation, deleteDocFull } from '../delete-confirm.js';

let timerInterval = null;
let quoteInterval = null;
let unsubFeed = null;
let lastDoc = null;
let loadingMore = false;
let allPostsLoaded = false;
const deletedPostIds = new Set(); // Track locally deleted post IDs

export function destroyHome() {
  if (timerInterval) clearInterval(timerInterval);
  if (quoteInterval) clearInterval(quoteInterval);
  if (unsubFeed) unsubFeed();
  timerInterval = null; quoteInterval = null; unsubFeed = null;
  lastDoc = null; loadingMore = false; allPostsLoaded = false;
}

export async function renderHome(container) {
  destroyHome();

  // Check for birthdays today
  let birthdayUsers = [];
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    usersSnap.forEach(d => {
      const u = d.data();
      if (isBirthdayToday(u.dateOfBirth)) {
        birthdayUsers.push({ id: d.id, ...u });
      }
    });
  } catch (e) { }

  container.innerHTML = `
    ${birthdayUsers.length > 0 ? `
      <section class="px-4 pt-4">
        <div class="birthday-banner">
          <div class="confetti-container" id="confetti-box"></div>
          <div class="relative z-10 text-center">
            <div class="text-3xl mb-2">🎂🎉</div>
            <h3 class="font-bold text-navy-800 text-lg">Happy Birthday!</h3>
            <p class="text-sm text-navy-600">${birthdayUsers.map(u => u.fullName).join(', ')}</p>
            <button class="mt-3 px-4 py-2 bg-navy-500 text-white rounded-full text-xs font-semibold" id="wish-birthday-btn">
              Send Wishes 🎈
            </button>
          </div>
        </div>
      </section>
    ` : ''}

    <!-- Timer Section -->
    <section class="px-4 pt-4 pb-3">
      <div class="card p-4">
        <p class="text-center text-xs text-gray-400 uppercase tracking-widest mb-3">⏳ Time since school ended</p>
        <div id="live-timer" class="flex items-center justify-center gap-2 flex-wrap"></div>
        <p id="emotion-quote" class="text-center font-handwriting text-navy-400 text-base mt-3 transition-opacity duration-500">"${EMOTIONAL_QUOTES[0]}"</p>
      </div>
    </section>

    <!-- Throwback Section -->
    <section class="px-4 pb-3" id="throwback-section" style="display:none;">
      <div class="card p-4 border-2 border-warm-300 bg-warm-50">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-lg">📸</span>
          <h3 class="font-bold text-navy-800 text-sm">On This Day</h3>
          <span class="text-xs text-gray-400">Throwback Memories</span>
        </div>
        <div id="throwback-container" class="space-y-3"></div>
      </div>
    </section>

    <!-- Quick Actions -->
    <section class="px-4 pb-3">
      <div class="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        <button class="quick-action-chip" data-action="timecapsule">🔒 Time Capsule</button>
        <button class="quick-action-chip" data-action="diary">📖 Diary</button>
        <button class="quick-action-chip" data-action="birthday">🎂 Birthdays</button>
        <button class="quick-action-chip" data-action="polls">📊 Polls</button>
        <button class="quick-action-chip" data-action="leaderboard">🏆 Leaderboard</button>
        <button class="quick-action-chip" data-action="games">🎮 Games</button>
      </div>
    </section>

    <!-- Feed -->
    <section class="px-4 pb-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-bold text-navy-800">Memories</h2>
        <button id="refresh-feed" class="text-xs text-navy-500 font-semibold hover:underline">Refresh</button>
      </div>
      <div id="feed-container" class="space-y-4">
        <div class="card p-6 text-center">
          <div class="w-14 h-14 mx-auto skeleton rounded-full mb-3"></div>
          <div class="w-40 h-3 mx-auto skeleton mb-2"></div>
          <div class="w-28 h-3 mx-auto skeleton"></div>
        </div>
      </div>
      <div id="load-more-container" class="hidden text-center py-6">
        <button id="load-more-btn" class="px-6 py-2 text-sm text-navy-500 font-semibold bg-cream-100 rounded-full hover:bg-cream-200 transition-colors">
          Load More Memories
        </button>
      </div>
    </section>
  `;

  // Timer
  renderTimer();
  timerInterval = setInterval(renderTimer, 1000);

  // Rotating quotes
  let qi = 0;
  quoteInterval = setInterval(() => {
    qi = (qi + 1) % EMOTIONAL_QUOTES.length;
    const el = container.querySelector('#emotion-quote');
    if (el) { el.style.opacity = '0'; setTimeout(() => { el.textContent = `"${EMOTIONAL_QUOTES[qi]}"`; el.style.opacity = '1'; }, 400); }
  }, 5000);

  // Quick action chips
  container.querySelectorAll('.quick-action-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      router.navigate(action);
    });
  });

  // Birthday wish
  container.querySelector('#wish-birthday-btn')?.addEventListener('click', () => {
    router.navigate('birthday');
  });

  // Refresh
  container.querySelector('#refresh-feed')?.addEventListener('click', () => {
    lastDoc = null;
    allPostsLoaded = false;
    loadFeed(container);
  });

  // Load more
  container.querySelector('#load-more-btn')?.addEventListener('click', () => {
    loadMorePosts(container);
  });

  // Throwback
  loadThrowback(container);

  // Load feed
  loadFeed(container);

  // Confetti animation
  if (birthdayUsers.length > 0) {
    spawnConfetti(container.querySelector('#confetti-box'));
  }
}

function renderTimer() {
  const el = document.getElementById('live-timer');
  if (!el) return;
  const t = getTimeSinceSchool();
  const parts = [
    { v: t.years, l: 'Yrs' }, { v: t.months, l: 'Mon' }, { v: t.days, l: 'Days' },
    { v: t.hours, l: 'Hrs' }, { v: t.minutes, l: 'Min' }, { v: t.seconds, l: 'Sec' }
  ];
  el.innerHTML = parts.map(p => `
    <div class="timer-box">
      <div class="value">${String(p.v).padStart(2, '0')}</div>
      <div class="label">${p.l}</div>
    </div>
  `).join('');
}

async function loadThrowback(container) {
  try {
    const today = new Date();
    const postsSnap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(100)));
    const throwbacks = [];
    postsSnap.forEach(d => {
      const post = d.data();
      if (post.createdAt?.toDate) {
        const postDate = post.createdAt.toDate();
        if (postDate.getMonth() === today.getMonth() && postDate.getDate() === today.getDate() &&
            postDate.getFullYear() < today.getFullYear()) {
          throwbacks.push({ id: d.id, ...post });
        }
      }
    });

    if (throwbacks.length > 0) {
      const section = container.querySelector('#throwback-section');
      const tbContainer = container.querySelector('#throwback-container');
      if (section) section.style.display = 'block';
      if (tbContainer) {
        tbContainer.innerHTML = throwbacks.map(post => `
          <div class="flex items-center gap-3 p-2 rounded-xl bg-white/60">
            ${post.imageUrl ? `<img src="${post.imageUrl}" class="w-14 h-14 rounded-lg object-cover" alt=""/>` : '<div class="w-14 h-14 rounded-lg bg-cream-200 flex items-center justify-center text-2xl">📷</div>'}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(post.caption || 'A memory')}</p>
              <p class="text-xs text-gray-400">${post.authorName || 'Classmate'} · ${post.createdAt?.toDate ? post.createdAt.toDate().getFullYear() : ''}</p>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (e) { }
}

function loadFeed(container) {
  const feedEl = container.querySelector('#feed-container');
  try {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(10));
    unsubFeed = onSnapshot(q, (snap) => {
      if (snap.empty) {
        feedEl.innerHTML = `
          <div class="card p-8 text-center">
            <div class="text-4xl mb-3">📷</div>
            <h3 class="font-semibold text-navy-700 mb-1">No memories yet</h3>
            <p class="text-sm text-gray-400">Be the first to share a memory!</p>
          </div>`;
        return;
      }
      feedEl.innerHTML = '';
      snap.forEach(d => {
        // Skip locally deleted posts (optimistic filter)
        if (deletedPostIds.has(d.id)) return;
        feedEl.appendChild(createPostCard({ id: d.id, ...d.data() }));
        lastDoc = d;
      });

      if (snap.size >= 10) {
        container.querySelector('#load-more-container')?.classList.remove('hidden');
      }
    }, () => {
      feedEl.innerHTML = `
        <div class="card p-8 text-center">
          <div class="text-4xl mb-3">📡</div>
          <p class="text-sm text-gray-400">Connect Firebase to see memories</p>
          <p class="text-xs text-gray-300 mt-1">Update firebase-config.js with your credentials</p>
        </div>`;
    });
  } catch (e) {
    feedEl.innerHTML = `<div class="card p-6 text-center text-sm text-gray-400">Set up Firebase to get started</div>`;
  }
}

async function loadMorePosts(container) {
  if (loadingMore || allPostsLoaded || !lastDoc) return;
  loadingMore = true;
  const feedEl = container.querySelector('#feed-container');
  const btn = container.querySelector('#load-more-btn');
  if (btn) btn.textContent = 'Loading...';

  try {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(10));
    const snap = await getDocs(q);
    if (snap.empty) {
      allPostsLoaded = true;
      container.querySelector('#load-more-container')?.classList.add('hidden');
    } else {
      snap.forEach(d => {
        feedEl.appendChild(createPostCard({ id: d.id, ...d.data() }));
        lastDoc = d;
      });
      if (snap.size < 10) {
        allPostsLoaded = true;
        container.querySelector('#load-more-container')?.classList.add('hidden');
      }
    }
  } catch (e) { console.error(e); }
  loadingMore = false;
  if (btn) btn.textContent = 'Load More Memories';
}

function createPostCard(post) {
  const user = post.authorName || 'Classmate';
  const avatar = post.authorPhoto;
  const time = post.createdAt?.toDate ? timeAgo(post.createdAt.toDate()) : '';
  const likes = post.likes?.length || 0;
  const commentCount = post.commentCount || 0;
  const liked = post.likes?.includes(authManager.currentUser?.uid);
  const saved = authManager.userData?.savedPosts?.includes(post.id);
  const location = post.category ? `📍 ${post.category}` : '';
  const isVideo = post.mediaType === 'video';

  const card = document.createElement('article');
  card.className = 'post-card animate-fadeIn';
  card.innerHTML = `
    <!-- Header -->
    <div class="p-3 flex items-center gap-3">
      ${avatar
        ? `<img src="${avatar}" class="avatar" alt="${sanitizeHTML(user)}"/>`
        : `<div class="avatar avatar-placeholder">${user[0]}</div>`}
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm text-navy-800 post-author-name" data-uid="${post.authorId}">${sanitizeHTML(user)}</p>
        <p class="text-xs text-gray-400">${location || time}</p>
      </div>
      ${post.category ? `<span class="text-[10px] px-2 py-1 rounded-full bg-cream-100 text-navy-500 font-medium">${sanitizeHTML(post.category)}</span>` : ''}
      ${post.authorId === authManager.currentUser?.uid ? `
        <button class="post-delete-btn p-1.5 rounded-full hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" data-post-id="${post.id}" title="Delete post">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
        </button>
      ` : ''}
    </div>

    <!-- Media -->
    ${post.imageUrl ? `
      <div class="post-image-frame relative" data-post-id="${post.id}">
        ${isVideo ? `
          <video src="${post.imageUrl}" class="w-full aspect-[4/3] object-cover" preload="metadata" playsinline></video>
          <button class="play-overlay">
            <svg class="w-12 h-12 text-white drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
        ` : `
          <img src="${post.imageUrl}" class="w-full aspect-[4/3] object-cover" alt="Memory" loading="lazy"/>
        `}
        <div class="double-tap-heart hidden">
          <svg class="w-20 h-20 text-red-500 drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
          </svg>
        </div>
      </div>
    ` : ''}

    <!-- Actions -->
    <div class="px-4 pt-3 pb-2">
      <div class="flex items-center gap-5 mb-2">
        <button class="like-btn flex items-center gap-1 transition-all ${liked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}" data-id="${post.id}">
          <svg class="w-5 h-5 ${liked ? 'like-bounce' : ''}" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
          </svg>
          <span class="text-xs font-medium">${formatNumber(likes)}</span>
        </button>
        <button class="comment-toggle-btn flex items-center gap-1 text-gray-400 hover:text-navy-500 transition-colors" data-id="${post.id}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"/>
          </svg>
          <span class="text-xs font-medium">${commentCount > 0 ? formatNumber(commentCount) : ''}</span>
        </button>
        <button class="share-btn flex items-center gap-1 text-gray-400 hover:text-navy-500 transition-colors" data-id="${post.id}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
          </svg>
        </button>
        <button class="save-btn ml-auto transition-colors ${saved ? 'text-navy-500' : 'text-gray-400 hover:text-navy-500'}" data-id="${post.id}">
          <svg class="w-5 h-5" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/>
          </svg>
        </button>
      </div>
      ${post.caption ? `
        <p class="text-sm text-navy-800 mb-1"><span class="font-semibold">${sanitizeHTML(user)}</span> ${sanitizeHTML(post.caption)}</p>
      ` : ''}
      ${commentCount > 0 ? `<button class="comment-toggle-btn text-xs text-gray-400 hover:text-navy-500" data-id="${post.id}">View all ${commentCount} comments</button>` : ''}
    </div>

    <!-- Comments Section (hidden by default) -->
    <div class="comments-section hidden border-t border-gray-50" data-post-id="${post.id}">
      <div class="comments-list px-4 py-2 space-y-2 max-h-60 overflow-y-auto"></div>
      <div class="flex items-center gap-2 px-4 py-2 border-t border-gray-50">
        <input type="text" class="comment-input flex-1 text-sm py-2 px-3 rounded-full bg-cream-50 border border-gray-100 text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-300" placeholder="Add a comment..." data-post-id="${post.id}"/>
        <button class="comment-submit-btn text-navy-500 font-semibold text-sm px-2" data-post-id="${post.id}">Post</button>
      </div>
    </div>
  `;

  // Like handler
  const likeBtn = card.querySelector('.like-btn');
  likeBtn?.addEventListener('click', async () => {
    if (!authManager.currentUser) return;
    const uid = authManager.currentUser.uid;
    try {
      const postRef = doc(db, 'posts', post.id);
      const svg = likeBtn.querySelector('svg');
      if (liked) {
        await updateDoc(postRef, { likes: arrayRemove(uid) });
      } else {
        await updateDoc(postRef, { likes: arrayUnion(uid) });
        svg?.classList.add('like-bounce');
        // Send notification
        if (post.authorId !== uid) {
          createNotification('like', post.authorId, { postId: post.id });
        }
      }
    } catch (e) { console.error('Like error:', e); }
  });

  // Double-tap to like on image
  let lastTap = 0;
  const imageFrame = card.querySelector('.post-image-frame');
  imageFrame?.addEventListener('click', async (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      // Double tap!
      if (!authManager.currentUser) return;
      const heart = imageFrame.querySelector('.double-tap-heart');
      if (heart) {
        heart.classList.remove('hidden');
        heart.classList.add('heart-animate');
        setTimeout(() => { heart.classList.add('hidden'); heart.classList.remove('heart-animate'); }, 1000);
      }
      if (!liked) {
        try {
          await updateDoc(doc(db, 'posts', post.id), { likes: arrayUnion(authManager.currentUser.uid) });
          if (post.authorId !== authManager.currentUser.uid) {
            createNotification('like', post.authorId, { postId: post.id });
          }
        } catch (e) { }
      }
    }
    lastTap = now;
  });

  // Video play
  const playBtn = card.querySelector('.play-overlay');
  playBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const video = card.querySelector('video');
    if (video) {
      video.play();
      playBtn.classList.add('hidden');
      video.addEventListener('ended', () => playBtn.classList.remove('hidden'));
      video.addEventListener('click', () => { video.paused ? video.play() : video.pause(); });
    }
  });

  // Comment toggle
  card.querySelectorAll('.comment-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = card.querySelector('.comments-section');
      if (section) {
        section.classList.toggle('hidden');
        if (!section.classList.contains('hidden')) {
          loadComments(card, post.id);
        }
      }
    });
  });

  // Comment submit
  const commentInput = card.querySelector('.comment-input');
  const commentSubmitBtn = card.querySelector('.comment-submit-btn');

  const submitComment = async () => {
    if (!commentInput || !authManager.currentUser) return;
    const text = commentInput.value.trim();
    if (!text) return;
    commentInput.value = '';
    try {
      await addDoc(collection(db, 'posts', post.id, 'comments'), {
        text,
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'Unknown',
        authorPhoto: authManager.userData?.profilePic || '',
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'posts', post.id), { commentCount: increment(1) });
      if (post.authorId !== authManager.currentUser.uid) {
        createNotification('comment', post.authorId, { postId: post.id, commentText: text });
      }
    } catch (e) { console.error('Comment error:', e); }
  };

  commentSubmitBtn?.addEventListener('click', submitComment);
  commentInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitComment(); });

  // Share
  card.querySelector('.share-btn')?.addEventListener('click', () => {
    const url = `${window.location.origin}?post=${post.id}`;
    if (navigator.share) {
      navigator.share({ title: 'Class Memory', text: post.caption || 'Check out this memory!', url })
        .catch(() => { });
    } else {
      navigator.clipboard.writeText(url).then(() => {
        const { showToast } = require('../utils.js') || {};
        import('../utils.js').then(m => m.showToast('Link copied! 📋', 'success'));
      });
    }
  });

  // Save
  card.querySelector('.save-btn')?.addEventListener('click', async () => {
    if (!authManager.currentUser) return;
    try {
      if (saved) {
        await authManager.unsavePost(post.id);
        import('../utils.js').then(m => m.showToast('Removed from saved', 'info'));
      } else {
        await authManager.savePost(post.id);
        import('../utils.js').then(m => m.showToast('Saved! 🔖', 'success'));
      }
    } catch (e) { console.error('Save error:', e); }
  });

  // View author profile
  card.querySelector('.post-author-name')?.addEventListener('click', () => {
    router.navigate('profile', { userId: post.authorId });
  });

  // Delete post (with storage cleanup + instant UI removal)
  card.querySelector('.post-delete-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirmation('this post', async () => {
      deletedPostIds.add(post.id); // Prevent reappearing via onSnapshot
      await deleteDocFull('posts', post.id, ['comments'], [post.imageUrl]);
    }, { element: card });
  });

  return card;
}

function loadComments(card, postId) {
  const list = card.querySelector('.comments-list');
  if (!list) return;

  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(20));
  onSnapshot(q, (snap) => {
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<p class="text-xs text-gray-400 text-center py-2">No comments yet. Be the first!</p>';
      return;
    }
    snap.forEach(d => {
      const c = d.data();
      const time = c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : '';
      const div = document.createElement('div');
      div.className = 'flex items-start gap-2 animate-fadeIn';
      div.innerHTML = `
        ${c.authorPhoto
          ? `<img src="${c.authorPhoto}" class="w-7 h-7 rounded-full object-cover flex-shrink-0" alt=""/>`
          : `<div class="w-7 h-7 rounded-full bg-navy-500 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">${(c.authorName || '?')[0]}</div>`}
        <div class="flex-1 min-w-0">
          <p class="text-xs"><span class="font-semibold text-navy-800">${sanitizeHTML(c.authorName || 'Unknown')}</span> <span class="text-gray-600">${sanitizeHTML(c.text)}</span></p>
          <p class="text-[10px] text-gray-400 mt-0.5">${time}</p>
        </div>
        ${c.authorId === authManager.currentUser?.uid ? `<button class="delete-comment-btn text-gray-300 hover:text-red-400 text-xs" data-comment-id="${d.id}" data-post-id="${postId}">✕</button>` : ''}
      `;
      // Delete comment handler
      div.querySelector('.delete-comment-btn')?.addEventListener('click', async () => {
        try {
          const { deleteDoc } = await import('../firebase-config.js');
          await deleteDoc(doc(db, 'posts', postId, 'comments', d.id));
          await updateDoc(doc(db, 'posts', postId), { commentCount: increment(-1) });
        } catch (e) { console.error(e); }
      });
      list.appendChild(div);
    });
  });
}

function spawnConfetti(container) {
  if (!container) return;
  const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd'];
  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.cssText = `
      left: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-delay: ${Math.random() * 2}s;
      animation-duration: ${2 + Math.random() * 2}s;
    `;
    container.appendChild(piece);
  }
}
