// Home page — Full-featured feed with comments, share, save, throwback, double-tap like
import { db, collection, query, orderBy, limit, onSnapshot, doc, updateDoc, addDoc,
  arrayUnion, arrayRemove, serverTimestamp, getDocs, where, startAfter, increment, deleteDoc } from '../firebase-config.js';
import { getTimeSinceSchool, EMOTIONAL_QUOTES, timeAgo, sanitizeHTML, isBirthdayToday, formatNumber, optimizeCloudinaryUrl, showToast } from '../utils.js';
import { userCache } from '../services/userCache.js';
import { authManager, awardPoints } from '../auth.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';
import { showDeleteConfirmation, deleteDocFull } from '../delete-confirm.js';

let timerInterval = null;
let quoteInterval = null;
let unsubFeed = null;
let lastDoc = null;
let loadingMore = false;
let allPostsLoaded = false;
let feedObserver = null;
const deletedPostIds = new Set(); // Track locally deleted post IDs

// Post Music state and observer
let currentPostAudio = null;
let currentPostAudioBtn = null;
const postMusicObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) {
      const btn = entry.target.querySelector('.post-music-toggle-btn');
      if (btn && currentPostAudioBtn === btn && currentPostAudio) {
        currentPostAudio.pause();
        btn.querySelector('.mute-icon').classList.remove('hidden');
        btn.querySelector('.play-icon').classList.add('hidden');
        btn.classList.remove('animate-pulse', 'bg-red-500/80');
        btn.classList.add('bg-black/50', 'backdrop-blur-md');
      }
    }
  });
}, { threshold: 0.05 });

export function destroyHome() {
  if (timerInterval) clearInterval(timerInterval);
  if (quoteInterval) clearInterval(quoteInterval);
  if (unsubFeed) unsubFeed();
  if (feedObserver) { feedObserver.disconnect(); feedObserver = null; }
  timerInterval = null; quoteInterval = null; unsubFeed = null;
  lastDoc = null; loadingMore = false; allPostsLoaded = false;
  isFirstLoad = true;
}

export async function renderHome(container) {
  router.registerDestroy('home', destroyHome);
  destroyHome();

  container.innerHTML = `
    <!-- Birthday placeholder -->
    <div id="birthday-section"></div>

    <!-- Timer Section -->
    <section class="px-4 pt-4 pb-3">
      <div class="card p-4">
        <p class="text-center text-xs text-gray-400 uppercase tracking-widest mb-3">⏳Time keeps moving forward, while our hearts keep visiting the past⏳✨</p>
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
        <button class="quick-action-chip" data-action="polls">📊 Polls</button>
        <button class="quick-action-chip" data-action="leaderboard">🏆 Leaderboard</button>
        <button class="quick-action-chip" data-action="birthday">🎂 Birthdays</button>
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
        <div class="card p-4">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 skeleton skeleton-avatar flex-shrink-0"></div>
            <div class="flex-1">
              <div class="w-32 h-3 skeleton mb-2"></div>
              <div class="w-20 h-2.5 skeleton"></div>
            </div>
          </div>
          <div class="w-full h-4 skeleton mb-2"></div>
          <div class="w-3/4 h-4 skeleton mb-4"></div>
          <div class="w-full skeleton-image mb-4"></div>
          <div class="flex gap-4">
            <div class="w-16 h-6 skeleton rounded-full"></div>
            <div class="w-16 h-6 skeleton rounded-full"></div>
            <div class="w-8 h-6 skeleton rounded-full ml-auto"></div>
          </div>
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

  // Load feed IMMEDIATELY
  loadFeed(container);

  // Refresh
  container.querySelector('#refresh-feed')?.addEventListener('click', () => {
    lastDoc = null;
    allPostsLoaded = false;
    if (unsubFeed) unsubFeed();
    isFirstLoad = true;
    const feedEl = container.querySelector('#feed-container');
    if (feedEl) {
      feedEl.innerHTML = `
        <div class="card p-4">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 skeleton skeleton-avatar flex-shrink-0"></div>
            <div class="flex-1">
              <div class="w-32 h-3 skeleton mb-2"></div>
              <div class="w-20 h-2.5 skeleton"></div>
            </div>
          </div>
          <div class="w-full h-4 skeleton mb-2"></div>
          <div class="w-3/4 h-4 skeleton mb-4"></div>
          <div class="w-full skeleton-image mb-4"></div>
        </div>
      `;
    }
    loadFeed(container);
  });

  // Load more (manual fallback)
  const loadMoreBtn = container.querySelector('#load-more-btn');
  loadMoreBtn?.addEventListener('click', () => {
    loadMorePosts(container);
  });

  // Infinite Scroll
  if (loadMoreBtn && 'IntersectionObserver' in window) {
    feedObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loadingMore && !allPostsLoaded) {
        loadMorePosts(container);
      }
    }, { rootMargin: '600px' });
    feedObserver.observe(loadMoreBtn);
  }

  // Lazy load Throwback later
  setTimeout(() => loadThrowback(container), 2000);

  // Check for birthdays today lazily
  setTimeout(async () => {
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      let birthdayUsers = [];
      usersSnap.forEach(d => {
        const u = d.data();
        if (isBirthdayToday(u.dateOfBirth)) {
          birthdayUsers.push({ id: d.id, ...u });
        }
      });
      if (birthdayUsers.length > 0) {
        const bSection = container.querySelector('#birthday-section');
        if (bSection) {
          bSection.innerHTML = `
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
          `;
          bSection.querySelector('#wish-birthday-btn')?.addEventListener('click', () => {
            router.navigate('birthday');
          });
          if (window.spawnConfetti) {
            window.spawnConfetti(bSection.querySelector('#confetti-box'));
          }
        }
      }
    } catch (e) { }
  }, 1000);

  // Check for pending tag requests on app load
  setTimeout(() => checkPendingTags(), 3000);
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
    const postsSnap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)));
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
              <p class="text-xs text-gray-400"><span data-user-name="${post.authorId}">${post.authorName || 'Classmate'}</span> · ${post.createdAt?.toDate ? post.createdAt.toDate().getFullYear() : ''}</p>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (e) { }
}

let isFirstLoad = true;
function loadFeed(container) {
  const feedEl = container.querySelector('#feed-container');
  try {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(10));
    unsubFeed = onSnapshot(q, (snap) => {
      console.log('Home Feed Posts Loaded:', snap.docs.length);
      
      if (isFirstLoad) {
        feedEl.innerHTML = ''; // clear initial skeletons instantly
        isFirstLoad = false;
      }

      if (snap.empty && feedEl.children.length === 0) {
        feedEl.innerHTML = `
          <div class="card p-8 text-center">
            <div class="text-4xl mb-3">📷</div>
            <h3 class="font-semibold text-navy-700 mb-1">No memories yet</h3>
            <p class="text-sm text-gray-400">Be the first to share a memory!</p>
          </div>`;
        return;
      }

      snap.docChanges().forEach(change => {
        const d = change.doc;
        if (deletedPostIds.has(d.id)) return;
        const postData = d.data();
        if (postData.isHidden && !authManager.isOwner) return;
        
        // Privacy filter
        if (postData.privacy === 'private' && postData.authorId !== authManager.currentUser?.uid) return;
        if (postData.privacy === 'close_friends' && postData.authorId !== authManager.currentUser?.uid) {
          const isCloseFriend = postData.closeFriends && postData.closeFriends.includes(authManager.currentUser?.uid);
          if (!isCloseFriend) return;
        }

        const postObj = { id: d.id, ...postData };
        const existingCard = document.getElementById(`post-${d.id}`);

        if (change.type === 'added') {
          if (!existingCard) {
            const card = createPostCard(postObj);
            // Prepend if it's a completely new post (index 0) and not initial feed load
            if (change.newIndex === 0 && feedEl.children.length > 0) {
              feedEl.insertBefore(card, feedEl.firstChild);
            } else {
              feedEl.appendChild(card);
            }
          }
        } else if (change.type === 'modified') {
          if (existingCard) {
            // Smart update: only update likes/comments to prevent video/scroll flicker
            const likeSpan = existingCard.querySelector('.like-count-btn');
            if (likeSpan) likeSpan.textContent = formatNumber(postObj.likes?.length || 0);
            
            const commentSpan = existingCard.querySelector('.comment-toggle-btn span');
            if (commentSpan) commentSpan.textContent = postObj.commentCount > 0 ? formatNumber(postObj.commentCount) : '';
            
            // Re-eval like icon state (in case updated by someone else)
            const likeBtn = existingCard.querySelector('.like-btn');
            const svg = likeBtn?.querySelector('svg');
            const isLiked = postObj.likes?.includes(authManager.currentUser?.uid);
            if (likeBtn && svg) {
              if (isLiked) {
                likeBtn.classList.add('text-red-500');
                likeBtn.classList.remove('text-gray-400');
                svg.setAttribute('fill', 'currentColor');
              } else {
                likeBtn.classList.add('text-gray-400');
                likeBtn.classList.remove('text-red-500');
                svg.setAttribute('fill', 'none');
              }
            }
            
            // Update caption safely
            const captionEl = existingCard.querySelector('.post-caption');
            if (captionEl && postObj.caption) {
               captionEl.innerHTML = `<span class="font-semibold" data-user-name="${postObj.authorId}">${userCache.getUser(postObj.authorId).fullName || postObj.authorName || 'Classmate'}</span> ${sanitizeHTML(postObj.caption)}`;
            }
          }
        } else if (change.type === 'removed') {
          if (existingCard) existingCard.remove();
        }
      });
      
      if (snap.docs.length > 0) {
        lastDoc = snap.docs[snap.docs.length - 1];
      }

      if (snap.size >= 10 && feedEl.children.length >= 10) {
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
        const postData = d.data();
        if (postData.isHidden && !authManager.isOwner) return;

        // Privacy filter
        if (postData.privacy === 'private' && postData.authorId !== authManager.currentUser?.uid) return;

        feedEl.appendChild(createPostCard({ id: d.id, ...postData }));
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

export function createPostCard(post) {
  const user = userCache.getUser(post.authorId);
  const userName = user.fullName || post.authorName || 'Classmate';
  const avatar = user.profilePic || post.authorPhoto;
  const time = post.createdAt?.toDate ? timeAgo(post.createdAt.toDate()) : '';
  const likes = post.likes?.length || 0;
  const commentCount = post.commentCount || 0;
  const liked = post.likes?.includes(authManager.currentUser?.uid);
  const saved = authManager.userData?.savedPosts?.includes(post.id);
  const location = post.category ? `📍 ${post.category}` : '';
  const isVideo = post.mediaType === 'video';

  const imageUrls = post.imageUrls && post.imageUrls.length > 0 ? post.imageUrls : (post.imageUrl ? [post.imageUrl] : []);
  const mediaTypes = post.mediaTypes && post.mediaTypes.length > 0 ? post.mediaTypes : (post.mediaType ? [post.mediaType] : []);
  
  const generateMentionsHtml = (mentions) => {
    if (!mentions || !mentions.length) return '';
    return `<p class="text-xs text-blue-500 mb-1">${mentions.map(m => `@${sanitizeHTML(m.name)}`).join(' ')}</p>`;
  };

  const mentionsHtml = generateMentionsHtml(post.mentions || []);

  const card = document.createElement('div');
  card.id = `post-${post.id}`;
  card.className = 'card overflow-hidden animate-fadeIn';
  card.innerHTML = `
    <!-- Header -->
    <div class="p-3 flex items-center gap-3">
      ${avatar
        ? `<img src="${avatar}" class="avatar" alt="${sanitizeHTML(userName)}" data-user-pic="${post.authorId}"/>`
        : `<div class="avatar avatar-placeholder" data-user-pic="${post.authorId}">${userName[0]}</div>`}
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm text-navy-800 post-author-name" data-uid="${post.authorId}" data-user-name="${post.authorId}">${sanitizeHTML(userName)}</p>
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
    ${imageUrls.length > 0 ? `
      <div class="post-image-frame relative" data-post-id="${post.id}">
        <div class="swipeable-gallery w-full aspect-[4/3] relative">
          ${imageUrls.map((url, i) => `
            <div class="swipeable-item w-full h-full relative">
              ${mediaTypes[i] === 'video' ? `
                <video src="${url}" class="w-full h-full object-cover" preload="metadata" playsinline></video>
                <button class="play-overlay">
                  <svg class="w-12 h-12 text-white drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
              ` : `
                <img src="${optimizeCloudinaryUrl(url, 600)}" class="w-full h-full object-cover" alt="Memory" loading="lazy" decoding="async" />
              `}
            </div>
          `).join('')}
        </div>
        ${imageUrls.length > 1 ? `
          <div class="gallery-dots">
            ${imageUrls.map((_, i) => `<div class="gallery-dot ${i===0 ? 'active':''}"></div>`).join('')}
          </div>
        ` : ''}
        <div class="double-tap-heart hidden">
          <svg class="w-20 h-20 text-red-500 drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
          </svg>
        </div>
        ${post.musicUrl ? `
          <button class="post-music-toggle-btn absolute bottom-3 right-3 z-20 w-8 h-8 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white shadow-lg border border-white/20 transition-all hover:scale-110 active:scale-95" data-audio-url="${post.musicUrl}">
            <svg class="w-4 h-4 mute-icon" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            <svg class="w-4 h-4 play-icon hidden" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
        ` : ''}
      </div>
    ` : (post.musicUrl ? `
      <div class="px-4 mt-2">
        <div class="relative p-4 bg-gradient-to-br from-navy-50 to-cream-50 rounded-xl flex items-center justify-between border border-navy-100/50">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-navy-500 text-white flex items-center justify-center shadow-md">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
            </div>
            <div>
              <p class="text-sm font-bold text-navy-800">Attached Music</p>
              <p class="text-xs text-gray-500">Tap speaker to listen</p>
            </div>
          </div>
          <button class="post-music-toggle-btn w-10 h-10 rounded-full bg-navy-800 text-white flex items-center justify-center shadow-lg transition-all active:scale-95 border border-white/10" data-audio-url="${post.musicUrl}">
              <svg class="w-5 h-5 mute-icon" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
              <svg class="w-5 h-5 play-icon hidden" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
        </div>
      </div>
    ` : '')}

    <!-- Actions -->
      <div class="px-4 pt-3 pb-2">
        <div class="flex items-center gap-5 mb-2">
          <div class="flex items-center gap-1">
            <button class="like-btn transition-all ${liked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}" data-id="${post.id}">
              <svg class="w-5 h-5 ${liked ? 'like-bounce' : ''}" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
              </svg>
            </button>
            <span class="like-count-btn cursor-pointer text-xs font-medium text-gray-500 hover:text-navy-600 transition-colors">${formatNumber(likes)}</span>
          </div>
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
          <button class="save-btn ml-auto transition-colors ${saved ? 'text-navy-800' : 'text-gray-400 hover:text-navy-800'}" data-id="${post.id}">
            <svg class="w-6 h-6" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/>
            </svg>
          </button>
        </div>
        ${post.caption ? `
          <p class="post-caption text-sm text-navy-800 mb-1"><span class="font-semibold" data-user-name="${post.authorId}">${sanitizeHTML(userName)}</span> ${sanitizeHTML(post.caption)}</p>
        ` : ''}
        ${mentionsHtml}
        ${commentCount > 0 ? `<button class="comment-toggle-btn text-xs text-gray-400 hover:text-navy-500" data-id="${post.id}">View all ${commentCount} comments</button>` : ''}
      </div>
  `;

  // Like handler
  const likeBtn = card.querySelector('.like-btn');
  const likeSpan = card.querySelector('.like-count-btn');
  
  likeBtn?.addEventListener('click', async () => {
    if (!authManager.currentUser) return;
    const uid = authManager.currentUser.uid;
    const svg = likeBtn.querySelector('svg');
    const isLiked = post.likes?.includes(uid);
    
    // 1. OPTIMISTIC UI UPDATE
    if (isLiked) {
      post.likes = post.likes.filter(id => id !== uid);
      likeBtn.classList.remove('text-red-500');
      likeBtn.classList.add('text-gray-400');
      svg.setAttribute('fill', 'none');
      svg.classList.remove('like-bounce');
      likeSpan.textContent = formatNumber(post.likes.length);
    } else {
      if (!post.likes) post.likes = [];
      post.likes.push(uid);
      likeBtn.classList.add('text-red-500');
      likeBtn.classList.remove('text-gray-400');
      svg.setAttribute('fill', 'currentColor');
      svg.classList.add('like-bounce');
      likeSpan.textContent = formatNumber(post.likes.length);
    }
    
    // 2. BACKGROUND FIREBASE UPDATE
    try {
      const { arrayUnion, arrayRemove } = await import('../firebase-config.js');
      const postRef = doc(db, 'posts', post.id);
      if (isLiked) {
        updateDoc(postRef, { likes: arrayRemove(uid) }).catch(e => console.error(e));
        if (post.authorId !== uid) awardPoints(post.authorId, -10, 'Like Removed').catch(e => console.error(e));
      } else {
        updateDoc(postRef, { likes: arrayUnion(uid) }).catch(e => console.error(e));
        if (post.authorId !== uid) {
          awardPoints(post.authorId, 10, 'Post Liked').catch(e => console.error(e));
          createNotification('like', post.authorId, { postId: post.id });
        }
      }
    } catch (e) { console.error('Like error:', e); }
  });

  // Likes List handler
  likeSpan?.addEventListener('click', () => {
    if (post.likes && post.likes.length > 0) {
      showLikesModal(post.likes);
    }
  });

  // Double-tap to like on image
  let lastTap = 0;
  const imageFrame = card.querySelector('.post-image-frame');
  imageFrame?.addEventListener('click', async (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      // Double tap!
      if (!authManager.currentUser) return;
      const uid = authManager.currentUser.uid;
      const isLiked = post.likes?.includes(uid);
      
      const heart = imageFrame.querySelector('.double-tap-heart');
      if (heart) {
        heart.classList.remove('hidden');
        heart.classList.add('heart-animate');
        setTimeout(() => { heart.classList.add('hidden'); heart.classList.remove('heart-animate'); }, 1000);
      }
      
      if (!isLiked) {
        // 1. OPTIMISTIC UI
        if (!post.likes) post.likes = [];
        post.likes.push(uid);
        if (likeBtn) {
          const svg = likeBtn.querySelector('svg');
          likeBtn.classList.add('text-red-500');
          likeBtn.classList.remove('text-gray-400');
          svg?.setAttribute('fill', 'currentColor');
          svg?.classList.add('like-bounce');
          if (likeSpan) likeSpan.textContent = formatNumber(post.likes.length);
        }

        // 2. BACKGROUND UPDATE
        try {
          const { arrayUnion } = await import('../firebase-config.js');
          updateDoc(doc(db, 'posts', post.id), { likes: arrayUnion(uid) }).catch(e => console.error(e));
          if (post.authorId !== uid) {
            awardPoints(post.authorId, 10, 'Post Liked (Double Tap)').catch(e => console.error(e));
            createNotification('like', post.authorId, { postId: post.id });
          }
        } catch (e) { }
      }
    }
    lastTap = now;
  });

  // Video play (for all videos in gallery)
  const playBtns = card.querySelectorAll('.play-overlay');
  playBtns.forEach(playBtn => {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const video = playBtn.previousElementSibling;
      if (video && video.tagName === 'VIDEO') {
        video.play();
        playBtn.classList.add('hidden');
        video.addEventListener('ended', () => playBtn.classList.remove('hidden'));
        video.addEventListener('click', () => { video.paused ? video.play() : video.pause(); });
      }
    });
  });

  // Audio play (new speaker icon logic)
  const musicBtn = card.querySelector('.post-music-toggle-btn');
  if (musicBtn) {
    postMusicObserver.observe(card); // observe for auto-pause on scroll
    
    musicBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const audioUrl = musicBtn.getAttribute('data-audio-url');
      const muteIcon = musicBtn.querySelector('.mute-icon');
      const playIcon = musicBtn.querySelector('.play-icon');
      
      const isCurrentlyPlaying = (currentPostAudioBtn === musicBtn && currentPostAudio && !currentPostAudio.paused);

      if (isCurrentlyPlaying) {
        // Pause it
        currentPostAudio.pause();
        muteIcon.classList.remove('hidden');
        playIcon.classList.add('hidden');
        musicBtn.classList.remove('animate-pulse', 'bg-red-500/80');
        musicBtn.classList.add('bg-black/50', 'backdrop-blur-md');
      } else {
        // Pause any previously playing music
        if (currentPostAudio && currentPostAudioBtn !== musicBtn) {
          currentPostAudio.pause();
          if (currentPostAudioBtn) {
            currentPostAudioBtn.querySelector('.mute-icon').classList.remove('hidden');
            currentPostAudioBtn.querySelector('.play-icon').classList.add('hidden');
            currentPostAudioBtn.classList.remove('animate-pulse', 'bg-red-500/80');
            currentPostAudioBtn.classList.add('bg-black/50', 'backdrop-blur-md');
          }
        }
        
        // Start this music
        if (!musicBtn.audioObj) {
          musicBtn.audioObj = new Audio(audioUrl);
          musicBtn.audioObj.loop = true;
          musicBtn.audioObj.preload = 'none';
        }
        
        currentPostAudio = musicBtn.audioObj;
        currentPostAudioBtn = musicBtn;
        
        // Fade in volume
        currentPostAudio.volume = 0;
        currentPostAudio.play().catch(e => console.error(e));
        
        let vol = 0;
        const fadeInterval = setInterval(() => {
          if (vol < 0.9) {
            vol += 0.1;
            currentPostAudio.volume = vol;
          } else {
            currentPostAudio.volume = 1;
            clearInterval(fadeInterval);
          }
        }, 50);

        muteIcon.classList.add('hidden');
        playIcon.classList.remove('hidden');
        musicBtn.classList.remove('bg-black/50', 'backdrop-blur-md');
        musicBtn.classList.add('bg-red-500/80', 'animate-pulse');
      }
    });
  }

  // Swipeable Gallery dots sync
  const gallery = card.querySelector('.swipeable-gallery');
  const dots = card.querySelectorAll('.gallery-dot');
  if (gallery && dots.length > 0) {
    gallery.addEventListener('scroll', () => {
      const scrollPos = gallery.scrollLeft;
      const itemWidth = gallery.clientWidth;
      const activeIdx = Math.round(scrollPos / itemWidth);
      dots.forEach((d, i) => d.classList.toggle('active', i === activeIdx));
    });
  }

  // Comment toggle
  card.querySelectorAll('.comment-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showCommentsModal(post);
    });
  });

  // Share
  card.querySelector('.share-btn')?.addEventListener('click', () => {
    showShareModal(post);
  });

  // Save
  card.querySelector('.save-btn')?.addEventListener('click', async () => {
    if (!authManager.currentUser) return;
    const btn = card.querySelector('.save-btn');
    const svg = btn.querySelector('svg');
    const isCurrentlySaved = btn.classList.contains('text-navy-800');
    
    // Optimistic UI update
    svg.classList.remove('bookmark-bounce-anim');
    void svg.offsetWidth; // trigger reflow
    
    if (isCurrentlySaved) {
      btn.classList.remove('text-navy-800');
      btn.classList.add('text-gray-400');
      svg.setAttribute('fill', 'none');
    } else {
      btn.classList.remove('text-gray-400');
      btn.classList.add('text-navy-800');
      svg.setAttribute('fill', 'currentColor');
      svg.classList.add('bookmark-bounce-anim');
    }

    try {
      if (isCurrentlySaved) {
        authManager.unsavePost(post.id).catch(e => console.error(e));
        showToast('Removed from saved', 'info');
      } else {
        authManager.savePost(post.id).catch(e => console.error(e));
        showToast('Saved to your profile', 'success');
      }
    } catch (e) {
      console.error('Save error:', e);
      // Revert if failed
      if (isCurrentlySaved) {
        btn.classList.add('text-navy-800');
        btn.classList.remove('text-gray-400');
        svg.setAttribute('fill', 'currentColor');
      } else {
        btn.classList.add('text-gray-400');
        btn.classList.remove('text-navy-800');
        svg.setAttribute('fill', 'none');
      }
    }
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
      await awardPoints(post.authorId, -20, 'Post Deleted');
      
      const filesToDelete = post.cloudinaryPublicIds ? [...post.cloudinaryPublicIds] : [];
      if (post.musicPublicId) filesToDelete.push(post.musicPublicId);
      
      await deleteDocFull('posts', post.id, ['comments'], filesToDelete);
    }, { element: card });
  });

  return card;
}

// ==========================================
// 1. COMMENTS MODAL (INSTAGRAM STYLE)
// ==========================================
function showCommentsModal(post) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[100] modal-sheet-container modal-sheet-overlay flex flex-col justify-end';
  overlay.innerHTML = `
    <div class="modal-backdrop absolute inset-0 cursor-pointer"></div>
    <div class="modal-sheet-content flex flex-col bg-white w-full max-w-lg mx-auto rounded-t-3xl shadow-2xl relative h-[90vh]">
      <!-- Handle for swipe -->
      <div class="sheet-handle"></div>
      
      <!-- Header -->
      <div class="flex items-center justify-between px-4 pb-3 border-b border-gray-100 shrink-0">
        <div class="w-8"></div>
        <h3 class="font-bold text-navy-800 text-base">Comments <span class="text-gray-400 text-xs font-normal" id="comment-count-display">(${post.commentCount || 0})</span></h3>
        <button class="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-navy-800 modal-close-btn rounded-full bg-gray-50">✕</button>
      </div>

      <!-- Comments List -->
      <div class="flex-1 overflow-y-auto px-4 py-2 space-y-4" id="modal-comments-list">
        <div class="flex justify-center py-8"><div class="w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full animate-spin"></div></div>
      </div>

      <!-- Add Comment Section (Bottom Pinned) -->
      <div class="p-3 border-t border-gray-50 bg-white flex items-center gap-3 shrink-0 pb-safe">
        ${authManager.userData?.profilePic 
          ? `<img src="${authManager.userData.profilePic}" class="w-8 h-8 rounded-full object-cover flex-shrink-0" />`
          : `<div class="w-8 h-8 rounded-full bg-navy-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${(authManager.userData?.fullName || '?')[0]}</div>`
        }
        <input type="text" id="modal-comment-input" class="flex-1 bg-gray-50 border-none rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-navy-500/20 text-sm text-navy-800 placeholder-gray-400 transition-all" placeholder="Add a comment... (use @name to mention)"/>
        <button id="modal-comment-submit" class="text-navy-500 font-bold text-sm px-2 disabled:opacity-50 transition-opacity">Post</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  
  // Enter animation
  requestAnimationFrame(() => overlay.classList.add('modal-active'));

  const close = () => {
    overlay.classList.remove('modal-active');
    overlay.classList.add('modal-closing');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('.modal-backdrop').addEventListener('click', close);
  overlay.querySelector('.modal-close-btn').addEventListener('click', close);

  // Swipe down to close logic
  let startY = 0;
  const content = overlay.querySelector('.modal-sheet-content');
  content.addEventListener('touchstart', e => startY = e.touches[0].clientY);
  content.addEventListener('touchmove', e => {
    const y = e.touches[0].clientY;
    if (y > startY + 50) close();
  });

  // Load comments
  const list = overlay.querySelector('#modal-comments-list');
  const countDisplay = overlay.querySelector('#comment-count-display');
  
  const q = query(collection(db, 'posts', post.id, 'comments'), orderBy('createdAt', 'desc'), limit(50));
  const unsub = onSnapshot(q, (snap) => {
    list.innerHTML = '';
    countDisplay.textContent = `(${snap.size})`;
    if (snap.empty) {
      list.innerHTML = `
        <div class="flex flex-col items-center justify-center h-40 text-center">
          <div class="text-4xl mb-2">💭</div>
          <p class="text-sm font-semibold text-navy-800">No comments yet</p>
          <p class="text-xs text-gray-400">Start the conversation.</p>
        </div>
      `;
      return;
    }
    snap.forEach(d => {
      const c = d.data();
      const time = c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : 'just now';
      const isMyComment = c.authorId === authManager.currentUser?.uid;
      const isLiked = c.likes?.includes(authManager.currentUser?.uid);
      
      // Parse mentions
      let textHtml = sanitizeHTML(c.text);
      textHtml = textHtml.replace(/@(\w+)/g, '<span class="text-navy-500 font-semibold">@$1</span>');

      const cachedCommenter = userCache.getUser(c.authorId);
      const commenterName = cachedCommenter.fullName || c.authorName || 'Unknown';
      const commenterPic = cachedCommenter.profilePic || c.authorPhoto;

      const div = document.createElement('div');
      div.className = 'flex items-start gap-3 animate-fadeIn group';
      div.innerHTML = `
        ${commenterPic
          ? `<img src="${commenterPic}" class="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-gray-100" data-user-pic="${c.authorId}"/>`
          : `<div class="w-8 h-8 rounded-full bg-navy-100 text-navy-800 flex items-center justify-center text-xs font-bold flex-shrink-0" data-user-pic="${c.authorId}">${commenterName[0]}</div>`
        }
        <div class="flex-1 min-w-0">
          <p class="text-sm"><span class="font-bold text-navy-800 mr-1" data-user-name="${c.authorId}">${sanitizeHTML(commenterName)}</span> <span class="text-gray-700">${textHtml}</span></p>
          <div class="flex items-center gap-3 mt-1">
            <span class="text-[11px] text-gray-400">${time}</span>
            <button class="text-[11px] font-semibold text-gray-400 hover:text-navy-500">Reply</button>
            ${isMyComment ? `<button class="delete-comment-btn text-[11px] font-semibold text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>` : ''}
          </div>
        </div>
        <div class="flex flex-col items-center ml-2">
          <button class="comment-like-btn p-1 ${isLiked ? 'liked' : 'text-gray-300 hover:text-red-400'} comment-like-icon" data-id="${d.id}">
            <svg class="w-4 h-4" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>
          </button>
          <span class="text-[10px] text-gray-400 font-medium">${c.likes?.length || 0 > 0 ? c.likes.length : ''}</span>
        </div>
      `;

      // Like comment logic
      const likeBtn = div.querySelector('.comment-like-btn');
      likeBtn.addEventListener('click', async () => {
        if (!authManager.currentUser) return;
        const uid = authManager.currentUser.uid;
        const commentRef = doc(db, 'posts', post.id, 'comments', d.id);
        if (c.likes?.includes(uid)) {
          await updateDoc(commentRef, { likes: arrayRemove(uid) });
        } else {
          await updateDoc(commentRef, { likes: arrayUnion(uid) });
          likeBtn.classList.add('heart-pop-anim');
        }
      });

      // Delete logic
      div.querySelector('.delete-comment-btn')?.addEventListener('click', () => {
        showDeleteConfirmation('this comment', async () => {
          try {
            const commentAuthorId = d.data().authorId;
            await deleteDoc(doc(db, 'posts', post.id, 'comments', d.id));
            await updateDoc(doc(db, 'posts', post.id), { commentCount: increment(-1) });
            if (commentAuthorId) {
              await awardPoints(commentAuthorId, -5, 'Comment Deleted');
            }
          } catch (e) { console.error(e); }
        }, { element: div });
      });

      list.appendChild(div);
    });
  });

  // Cleanup on close
  overlay.querySelector('.modal-close-btn').addEventListener('click', () => unsub());
  overlay.querySelector('.modal-backdrop').addEventListener('click', () => unsub());

  // Post comment
  const input = overlay.querySelector('#modal-comment-input');
  const submitBtn = overlay.querySelector('#modal-comment-submit');

  const submitComment = () => {
    const text = input.value.trim();
    if (!text || !authManager.currentUser) return;
    
    // OPTIMISTIC UI: Clear input instantly, don't await network
    input.value = '';
    
    // Add to Firebase in background
    // (onSnapshot will trigger instantly due to latency compensation)
    addDoc(collection(db, 'posts', post.id, 'comments'), {
      text,
      authorId: authManager.currentUser.uid,
      authorName: authManager.userData?.fullName || 'Unknown',
      authorPhoto: authManager.userData?.profilePic || '',
      createdAt: serverTimestamp(),
      likes: []
    }).catch(e => console.error('Comment Error:', e));

    updateDoc(doc(db, 'posts', post.id), { commentCount: increment(1) }).catch(e => {});
    
    if (post.authorId !== authManager.currentUser.uid) {
      createNotification('comment', post.authorId, { postId: post.id, commentText: text });
    }
    awardPoints(authManager.currentUser.uid, 5, 'Comment Created').catch(e => {});
  };

  submitBtn.addEventListener('click', submitComment);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submitComment(); });
}

// ==========================================
// 2. INTERNAL SHARE MODAL
// ==========================================
async function showShareModal(post) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[100] modal-sheet-container modal-sheet-overlay';
  overlay.innerHTML = `
    <div class="modal-backdrop absolute inset-0 cursor-pointer"></div>
    <div class="modal-sheet-content flex flex-col bg-white w-full max-w-lg mx-auto rounded-t-3xl shadow-2xl relative" style="height: 80vh;">
      <div class="sheet-handle"></div>
      
      <!-- Header -->
      <div class="px-4 pb-2 border-b border-gray-100 flex items-center justify-between">
        <h3 class="font-bold text-navy-800 text-lg">Send to</h3>
        <button class="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-navy-800 rounded-full bg-gray-50 modal-close-btn">✕</button>
      </div>
      
      <!-- Search & Chips -->
      <div class="p-3 border-b border-gray-50">
        <div id="share-chips-container" class="flex flex-wrap gap-2 mb-2 empty:hidden"></div>
        <input type="text" id="share-search-input" class="w-full bg-cream-50 border border-gray-100 rounded-xl px-4 py-2 text-sm text-navy-800 focus:outline-none focus:border-navy-300" placeholder="Search friends..."/>
      </div>

      <!-- Friend List -->
      <div class="flex-1 overflow-y-auto px-2 py-2" id="share-friend-list">
        <div class="flex justify-center py-8"><div class="w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full animate-spin"></div></div>
      </div>

      <!-- Footer Action -->
      <div class="p-4 border-t border-gray-100 bg-white">
        <button id="share-send-btn" class="w-full py-3 bg-navy-500 text-white rounded-xl font-bold disabled:opacity-50 disabled:bg-gray-300 transition-colors" disabled>
          Send
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-active'));

  const close = () => {
    overlay.classList.remove('modal-active');
    overlay.classList.add('modal-closing');
    setTimeout(() => overlay.remove(), 300);
  };
  overlay.querySelector('.modal-backdrop').addEventListener('click', close);
  overlay.querySelector('.modal-close-btn').addEventListener('click', close);

  // Load Friends
  const friendListEl = overlay.querySelector('#share-friend-list');
  const searchInput = overlay.querySelector('#share-search-input');
  const chipsContainer = overlay.querySelector('#share-chips-container');
  const sendBtn = overlay.querySelector('#share-send-btn');
  
  let friends = [];
  const selectedFriends = new Map(); // uid -> friendData

  try {
    const snap = await getDocs(collection(db, 'users'));
    friends = snap.docs
      .filter(d => d.id !== authManager.currentUser?.uid)
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => a.fullName.localeCompare(b.fullName));
    renderFriends(friends);
  } catch (e) {
    friendListEl.innerHTML = '<p class="text-center text-sm text-red-500 py-4">Error loading friends.</p>';
  }

  function renderFriends(list) {
    friendListEl.innerHTML = '';
    if (list.length === 0) {
      friendListEl.innerHTML = '<p class="text-center text-sm text-gray-400 py-4">No friends found.</p>';
      return;
    }
    
    list.forEach(f => {
      const isSelected = selectedFriends.has(f.id);
      const isOnline = f.online;
      
      const div = document.createElement('div');
      div.className = `flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${isSelected ? 'bg-navy-50' : 'hover:bg-cream-50'}`;
      div.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="relative">
            ${f.profilePic 
              ? `<img src="${f.profilePic}" class="w-10 h-10 rounded-full object-cover"/>`
              : `<div class="w-10 h-10 rounded-full bg-cream-200 text-navy-800 flex items-center justify-center font-bold">${f.fullName[0]}</div>`
            }
            ${isOnline ? `<div class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>` : ''}
          </div>
          <div>
            <p class="font-semibold text-navy-800 text-sm">${sanitizeHTML(f.fullName)}</p>
            <p class="text-xs text-gray-400">${f.nickname || '@'+f.fullName.split(' ')[0].toLowerCase()}</p>
          </div>
        </div>
        <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-navy-500 border-navy-500 text-white' : 'border-gray-300'}">
          ${isSelected ? `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>` : ''}
        </div>
      `;
      
      div.addEventListener('click', () => {
        if (isSelected) selectedFriends.delete(f.id);
        else selectedFriends.set(f.id, f);
        renderFriends(list);
        updateChips();
      });
      friendListEl.appendChild(div);
    });
  }

  function updateChips() {
    chipsContainer.innerHTML = '';
    selectedFriends.forEach((f, id) => {
      const chip = document.createElement('div');
      chip.className = 'share-chip flex items-center gap-1 bg-navy-100 text-navy-800 px-3 py-1.5 rounded-full text-xs font-semibold';
      chip.innerHTML = `
        ${f.fullName.split(' ')[0]}
        <button class="ml-1 text-navy-400 hover:text-navy-800">✕</button>
      `;
      chip.querySelector('button').addEventListener('click', () => {
        selectedFriends.delete(id);
        renderFriends(friends); // Resync list
        updateChips();
      });
      chipsContainer.appendChild(chip);
    });
    
    sendBtn.disabled = selectedFriends.size === 0;
    sendBtn.textContent = selectedFriends.size > 0 ? `Send (${selectedFriends.size})` : 'Send';
  }

  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = friends.filter(f => f.fullName.toLowerCase().includes(term) || (f.nickname && f.nickname.toLowerCase().includes(term)));
    renderFriends(filtered);
  });

  // Handle Send
  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    
    try {
      const myId = authManager.currentUser.uid;
      const myName = authManager.userData?.fullName || 'Someone';

      // Pre-fetch existing chats to prevent duplicates
      const q1 = query(collection(db, 'chats'), where('participants', 'array-contains', myId));
      const snap = await getDocs(q1);
      const existingChats = {};
      snap.forEach(d => {
        const data = d.data();
        if (data.type === 'dm' || data.type === 'direct') {
          const otherId = data.participants.find(p => p !== myId);
          // Keep the newest chat if multiple exist
          if (otherId) existingChats[otherId] = d.id; 
        }
      });

      for (const [friendId, friendData] of selectedFriends.entries()) {
        const chatId = existingChats[friendId] || (myId < friendId ? `${myId}_${friendId}` : `${friendId}_${myId}`);
        
        // 1. Create or update chat document
        await updateDoc(doc(db, 'chats', chatId), {
          participants: [myId, friendId],
          lastMessage: `Shared a post by ${post.authorName || 'someone'}`,
          lastMessageTime: serverTimestamp(),
          [`unread_${friendId}`]: increment(1)
        }).catch(async () => {
          // If doc doesn't exist, create it
          const { setDoc } = await import('../firebase-config.js');
          await setDoc(doc(db, 'chats', chatId), {
            type: 'direct',
            participants: [myId, friendId],
            lastMessage: `Shared a post by ${post.authorName || 'someone'}`,
            lastMessageTime: serverTimestamp(),
            [`unread_${myId}`]: 0,
            [`unread_${friendId}`]: 1
          });
        });

        // 2. Add message to messages subcollection
        await addDoc(collection(db, 'chats', chatId, 'messages'), {
          type: 'shared_post',
          senderId: myId,
          text: `Shared a post by ${post.authorName || 'someone'}`,
          createdAt: serverTimestamp(),
          status: 'sent',
          sharedPost: {
            id: post.id,
            authorName: post.authorName || 'Classmate',
            imageUrl: (post.imageUrls && post.imageUrls.length > 0) ? post.imageUrls[0] : (post.imageUrl || null),
            caption: post.caption || ''
          }
        });

        // 3. Send notification
        createNotification('share', friendId, { postId: post.id, senderName: myName });
      }
      
      const { showToast } = await import('../utils.js');
      showToast('Post shared successfully! 🚀', 'success');
      close();
    } catch (e) {
      console.error('Error sharing post:', e);
      sendBtn.disabled = false;
      sendBtn.textContent = 'Retry';
    }
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

// ==========================================
// 3. TAG REQUEST MODAL (APP OPEN)
// ==========================================
async function checkPendingTags() {
  if (!authManager.currentUser) return;
  const myUid = authManager.currentUser.uid;

  try {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', myUid),
      where('type', '==', 'tag_request')
    );
    const snap = await getDocs(q);
    
    // Sort locally by createdAt desc
    const sortedDocs = snap.docs.sort((a, b) => {
      const aTime = a.data().createdAt?.toMillis() || 0;
      const bTime = b.data().createdAt?.toMillis() || 0;
      return bTime - aTime;
    });
    
    // Find first unhandled tag request
    let pendingTag = null;
    sortedDocs.forEach(d => {
      const data = d.data();
      if (!data.handled && !pendingTag) {
        pendingTag = { id: d.id, ...data };
      }
    });

    if (pendingTag) {
      showTagRequestModal(pendingTag);
    }
  } catch (err) {
    console.error('Error checking pending tags:', err);
  }
}

async function showTagRequestModal(notif) {
  // Fetch post details to show preview
  const { getDoc } = await import('../firebase-config.js');
  let postImage = '';
  let postCaption = '';

  if (notif.postId) {
    const postSnap = await getDoc(doc(db, 'posts', notif.postId));
    if (postSnap.exists()) {
      const pData = postSnap.data();
      postImage = (pData.imageUrls && pData.imageUrls.length > 0) ? pData.imageUrls[0] : (pData.imageUrl || '');
      postCaption = pData.caption || '';
    } else {
      // Post deleted, mark as handled silently
      await updateDoc(doc(db, 'notifications', notif.id), { handled: true });
      return;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4 bg-navy-900/40 backdrop-blur-sm opacity-0 transition-opacity duration-300';
  
  overlay.innerHTML = `
    <div class="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl transform scale-95 transition-transform duration-300">
      ${postImage ? `
        <div class="h-48 w-full relative">
          <img src="${postImage}" class="w-full h-full object-cover" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
        </div>
      ` : ''}
      <div class="p-6 relative text-center">
        ${!postImage ? '<div class="h-10"></div>' : ''}
        <div class="absolute -top-10 left-1/2 -translate-x-1/2">
          ${notif.fromPhoto 
            ? `<img src="${notif.fromPhoto}" class="w-20 h-20 rounded-full border-4 border-white object-cover shadow-md" />`
            : `<div class="w-20 h-20 rounded-full border-4 border-white bg-navy-500 text-white flex items-center justify-center text-2xl font-bold shadow-md">${(notif.fromName || '?')[0]}</div>`
          }
        </div>
        
        <h3 class="text-xl font-bold text-navy-800 mt-8">${sanitizeHTML(notif.fromName)}</h3>
        <p class="text-sm text-gray-500 mt-1">tagged you in a memory</p>
        
        ${postCaption ? `<p class="mt-4 text-sm italic text-gray-700 bg-gray-50 p-3 rounded-xl">"${sanitizeHTML(postCaption)}"</p>` : ''}
        
        <div class="flex gap-3 mt-6">
          <button id="tag-reject-btn" class="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-red-50 hover:text-red-500 transition-colors">
            ❌ Reject
          </button>
          <button id="tag-accept-btn" class="flex-1 py-3 bg-navy-500 text-white rounded-xl font-bold hover:bg-navy-600 transition-colors shadow-lg shadow-navy-500/30">
            ✅ Accept
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  
  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.remove('opacity-0');
    overlay.querySelector('.transform').classList.remove('scale-95');
  });

  const close = () => {
    overlay.classList.add('opacity-0');
    overlay.querySelector('.transform').classList.add('scale-95');
    setTimeout(() => overlay.remove(), 300);
  };

  const acceptBtn = overlay.querySelector('#tag-accept-btn');
  const rejectBtn = overlay.querySelector('#tag-reject-btn');
  const myUid = authManager.currentUser.uid;

  acceptBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true;
    acceptBtn.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>';
    try {
      const postRef = doc(db, 'posts', notif.postId);
      const { setDoc } = await import('../firebase-config.js');
      const { notificationManager } = await import('../notifications.js');

      await updateDoc(postRef, {
        pendingTags: arrayRemove(myUid),
        taggedFriends: arrayUnion(myUid)
      });
      
      await setDoc(doc(db, 'users', myUid, 'taggedPosts', notif.postId), { taggedAt: serverTimestamp() });
      await setDoc(doc(db, 'posts', notif.postId, 'acceptedTags', myUid), { acceptedAt: serverTimestamp() });
      
      const postSnap = await getDoc(postRef);
      if (postSnap.exists() && postSnap.data().authorId !== myUid) {
        notificationManager.constructor.create('tag_accepted', postSnap.data().authorId, { 
          postId: notif.postId, 
          messagePreview: 'accepted your tag'
        });
      }

      await updateDoc(doc(db, 'notifications', notif.id), { handled: true, body: 'You accepted the tag request.', read: true });
      import('../utils.js').then(m => m.showToast('Added to your profile!', 'success'));
      close();
    } catch (err) {
      console.error(err);
      acceptBtn.disabled = false;
      acceptBtn.textContent = 'Retry';
    }
  });

  rejectBtn.addEventListener('click', async () => {
    rejectBtn.disabled = true;
    rejectBtn.innerHTML = '<div class="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mx-auto"></div>';
    try {
      const postRef = doc(db, 'posts', notif.postId);
      const { notificationManager } = await import('../notifications.js');
      
      await updateDoc(postRef, { pendingTags: arrayRemove(myUid) });
      
      const postSnap = await getDoc(postRef);
      if (postSnap.exists() && postSnap.data().authorId !== myUid) {
        notificationManager.constructor.create('tag_declined', postSnap.data().authorId, { 
          postId: notif.postId, 
          messagePreview: 'declined your tag'
        });
      }

      await updateDoc(doc(db, 'notifications', notif.id), { handled: true, body: 'You rejected the tag request.', read: true });
      close();
    } catch (err) {
      console.error(err);
      rejectBtn.disabled = false;
      rejectBtn.textContent = 'Retry';
    }
  });
}

// ==========================================
// LIKES MODAL
// ==========================================
async function showLikesModal(likesArray) {
  const { router } = await import('../router.js');
  const modal = router.openModal('', { title: 'Likes', className: 'likes-modal' });
  
  modal.body.innerHTML = `
    <div class="p-4 space-y-4" id="likes-list-container">
      ${Array(Math.min(likesArray.length, 3)).fill('<div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full skeleton skeleton-avatar"></div><div class="flex-1"><div class="w-24 h-3 skeleton mb-2"></div><div class="w-16 h-2 skeleton"></div></div></div>').join('')}
    </div>
  `;

  try {
    const { getDoc, doc, db } = await import('../firebase-config.js');
    const { sanitizeHTML } = await import('../utils.js');
    
    // Fetch users in parallel
    const users = [];
    const promises = likesArray.map(async (uid) => {
      try {
        const uSnap = await getDoc(doc(db, 'users', uid));
        if (uSnap.exists()) {
          users.push({ id: uSnap.id, ...uSnap.data() });
        }
      } catch(e) { console.error('Failed user fetch', uid); }
    });
    
    await Promise.all(promises);
    
    const container = modal.body.querySelector('#likes-list-container');
    container.innerHTML = '';
    
    if (users.length === 0) {
      container.innerHTML = '<p class="text-center text-gray-500 text-sm py-4">No data available</p>';
      return;
    }

    users.forEach(u => {
      const div = document.createElement('div');
      div.className = 'flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded-xl transition-colors';
      div.innerHTML = `
        ${u.profilePic 
          ? `<img src="${u.profilePic}" class="w-10 h-10 rounded-full object-cover"/>`
          : `<div class="w-10 h-10 rounded-full bg-cream-200 text-navy-800 flex items-center justify-center font-bold">${sanitizeHTML(u.fullName || '?')[0]}</div>`
        }
        <div>
          <p class="font-semibold text-sm text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</p>
          ${u.nickname ? `<p class="text-[10px] text-gray-400">"${sanitizeHTML(u.nickname)}"</p>` : ''}
        </div>
      `;
      div.addEventListener('click', () => {
        modal.close();
        router.navigate('profile', { userId: u.id });
      });
      container.appendChild(div);
    });

  } catch (e) {
    console.error(e);
    modal.body.innerHTML = '<p class="text-center text-red-500 text-sm py-4">Failed to load likes</p>';
  }
}
