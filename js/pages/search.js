// Search page — Empty initial state, live search with results only after typing
import { db, collection, getDocs, query, where, orderBy, limit, doc, onSnapshot, rtdb, ref, onValue } from '../firebase-config.js';
import { sanitizeHTML, debounce } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { presenceManager } from '../presence.js';
import { userCache } from '../services/userCache.js';

let allUsers = [];
let allPosts = [];
let dataLoaded = false;
let searchPresenceUnsubs = [];

function cleanupSearchPresence() {
  searchPresenceUnsubs.forEach(u => u());
  searchPresenceUnsubs = [];
}

export async function renderSearch(container) {
  container.innerHTML = `
    <section class="px-4 pt-4">
      <h2 class="text-xl font-bold text-navy-800 mb-4">Search</h2>

      <div class="relative mb-5">
        <svg class="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
        <input type="text" id="search-input" placeholder="Search people, memories, categories..."
          class="w-full pl-11 pr-10 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 bg-white"/>
        <button id="clear-search-btn" class="hidden absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-navy-500 transition-colors rounded-full">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <!-- Search Tabs -->
      <div class="flex gap-2 mb-4" id="search-tabs-bar">
        <button class="search-tab active" data-tab="people">👥 People</button>
        <button class="search-tab" data-tab="memories">📸 Memories</button>
      </div>

      <!-- Search Results (hidden initially) -->
      <div id="search-results" class="space-y-1 hidden"></div>

      <!-- Empty Initial State -->
      <div id="search-empty-state" class="text-center py-16">
        <div class="text-5xl mb-4">🔍</div>
        <h3 class="text-base font-semibold text-navy-800 mb-2">Discover ClassMemories</h3>
        <p class="text-sm text-gray-400 max-w-xs mx-auto">Search for classmates, memories, photos, and more. Start typing to explore!</p>
        <div class="flex flex-wrap justify-center gap-2 mt-6" id="search-suggestions">
          <button class="search-suggest-chip" data-q="photos">📸 Photos</button>
          <button class="search-suggest-chip" data-q="funny">😂 Funny</button>
          <button class="search-suggest-chip" data-q="farewell">🎓 Farewell</button>
        </div>
      </div>

      <!-- Recent Searches -->
      <div id="recent-searches" class="hidden mt-2">
        <div class="flex items-center justify-between mb-3">
          <h3 class="section-title">Recent Searches</h3>
          <button id="clear-recent-btn" class="text-xs text-gray-400 hover:text-red-400 transition-colors">Clear all</button>
        </div>
        <div id="recent-list" class="space-y-1"></div>
      </div>

      <!-- Loading Skeleton -->
      <div id="search-loading" class="hidden space-y-3">
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      </div>
    </section>
  `;

  let activeTab = 'people';
  const searchInput = container.querySelector('#search-input');
  const clearBtn = container.querySelector('#clear-search-btn');
  const emptyState = container.querySelector('#search-empty-state');
  const resultsEl = container.querySelector('#search-results');
  const recentEl = container.querySelector('#recent-searches');
  const loadingEl = container.querySelector('#search-loading');

  // Load recent searches from localStorage
  loadRecentSearches(container);

  // Show recent searches when input is focused but empty
  searchInput?.addEventListener('focus', () => {
    const recents = JSON.parse(localStorage.getItem('search_recents') || '[]');
    if (!searchInput.value.trim() && recents.length > 0) {
      recentEl.classList.remove('hidden');
    }
  });

  // Tabs
  container.querySelectorAll('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      const q = searchInput?.value || '';
      if (q.trim()) performSearch(container, q, activeTab);
    });
  });

  // Suggestion chips
  container.querySelectorAll('.search-suggest-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q;
      searchInput.value = q;
      clearBtn.classList.remove('hidden');
      performSearch(container, q, activeTab);
    });
  });

  // Clear button
  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    emptyState.classList.remove('hidden');
    recentEl.classList.add('hidden');
    cleanupSearchPresence();
  });

  // Clear recent searches
  container.querySelector('#clear-recent-btn')?.addEventListener('click', () => {
    localStorage.removeItem('search_recents');
    recentEl.classList.add('hidden');
  });

  // Lazy-load data on first search
  async function ensureDataLoaded() {
    if (dataLoaded) return;
    try {
      const postsSnap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50)));
      allUsers = userCache.getAllUsers();
      allPosts = [];
      postsSnap.forEach(d => allPosts.push({ id: d.id, ...d.data() }));
      dataLoaded = true;
    } catch (e) {
      console.error('Search data load error:', e);
    }
  }

  // Live search (Instant, no debounce)
  searchInput?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    clearBtn.classList.toggle('hidden', !q);
    
    if (!q) {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      emptyState.classList.remove('hidden');
      const recents = JSON.parse(localStorage.getItem('search_recents') || '[]');
      if (recents.length > 0) recentEl.classList.remove('hidden');
      return;
    }

    // Hide empty state
    emptyState.classList.add('hidden');
    recentEl.classList.add('hidden');
    
    // Instantly update users from cache for real-time people search
    allUsers = userCache.getAllUsers();
    
    if (activeTab === 'people') {
      performSearch(container, q, activeTab);
      // Still trigger ensureDataLoaded in background so we don't break subsequent posts search
      ensureDataLoaded();
    } else {
      loadingEl.classList.remove('hidden');
      resultsEl.classList.add('hidden');
      await ensureDataLoaded();
      loadingEl.classList.add('hidden');
      performSearch(container, q, activeTab);
    }

    // Save to recent searches
    saveRecentSearch(q);
    loadRecentSearches(container);
  });
}

function performSearch(container, searchQuery, tab) {
  const q = searchQuery.toLowerCase().trim();
  const results = container.querySelector('#search-results');
  const emptyState = container.querySelector('#search-empty-state');

  if (!q) {
    results.classList.add('hidden');
    results.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  results.classList.remove('hidden');

  if (tab === 'people') {
    const filtered = allUsers.filter(u => {
      const dName = (u.displayName || '').toLowerCase();
      const uName = (u.username || '').toLowerCase();
      const rNum = (u.rollNumber || '').toLowerCase();
      return dName.includes(q) || uName.includes(q) || rNum.includes(q);
    });

    console.log(`[Search Debug] Search Query: "${searchQuery}"`);
    console.log(`[Search Debug] User Count: ${filtered.length}`);

    results.innerHTML = filtered.length
      ? filtered.map(u => {
          console.log(`[Search Debug] Fetched Name: ${u.displayName}, Fetched UID: ${u.id}`);
          return userCard(u);
        }).join('')
      : '<div class="text-center py-10"><div class="text-3xl mb-2">🤷</div><p class="text-sm text-gray-400">No users found</p></div>';
  } else {
    const filtered = allPosts.filter(p =>
      p.caption?.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      p.authorName?.toLowerCase().includes(q) ||
      p.location?.toLowerCase().includes(q)
    );
    results.innerHTML = filtered.length
      ? filtered.map(p => postSearchCard(p)).join('')
      : '<div class="text-center py-10"><div class="text-3xl mb-2">📭</div><p class="text-sm text-gray-400">No memories found for "' + sanitizeHTML(searchQuery) + '"</p></div>';
  }

  bindUserCardEvents(results);

  // Real-time presence watchers for people search results
  if (tab === 'people') {
    cleanupSearchPresence();
    const filtered = allUsers.filter(u => {
      const dName = (u.displayName || '').toLowerCase();
      const uName = (u.username || '').toLowerCase();
      const rNum = (u.rollNumber || '').toLowerCase();
      return dName.includes(q) || uName.includes(q) || rNum.includes(q);
    });
    filtered.forEach(u => {
      if (!rtdb) return;
      const unsub = onValue(ref(rtdb, `presence/${u.id}`), (snap) => {
        const dot = results.querySelector(`#search-presence-${u.id}`);
        if (dot && snap.exists()) {
          dot.classList.toggle('online', snap.val().online || false);
        }
      });
      searchPresenceUnsubs.push(unsub);
    });
  }
}

function userCard(u) {
  const cached = userCache.getUser(u.id) || u;
  const displayName = cached.displayName || 'User';
  const pic = cached.photoURL || '';
  const rollNumber = cached.rollNumber || '—';
  const username = cached.username || '';

  const avatar = pic
    ? `<img src="${pic}" class="avatar" alt="${sanitizeHTML(displayName)}" data-user-pic="${u.id}"/>`
    : `<div class="avatar avatar-placeholder text-sm" data-user-pic="${u.id}">${displayName[0]?.toUpperCase() || '?'}</div>`;

  return `
    <div class="chat-item user-search-card" data-uid="${u.id}" data-name="${sanitizeHTML(displayName)}">
      <div class="relative">
        ${avatar}
        <div class="presence-dot-mini ${u.online ? 'online' : ''}" id="search-presence-${u.id}"></div>
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm text-navy-800" data-user-name="${u.id}">${sanitizeHTML(displayName)}</p>
        <p class="text-xs text-gray-400">${username ? `"${sanitizeHTML(username)}" · ` : ''}Roll #${sanitizeHTML(rollNumber)}</p>
      </div>
      <div class="flex items-center gap-1">
        <button class="dm-btn p-1.5 rounded-full hover:bg-cream-100 text-gray-400 hover:text-navy-500 transition-colors" data-uid="${u.id}" data-name="${sanitizeHTML(displayName)}" title="Message">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 016 21c-1.052 0-2.062-.18-3-.512v-.003c0-1.113.285-2.16.786-3.07C2.859 16.023 2 14.104 2 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>
        </button>
      </div>
    </div>`;
}

function postSearchCard(p) {
  const cached = userCache.getUser(p.authorId);
  const authorName = cached.fullName || p.authorName || '';

  return `
    <div class="card p-3 flex items-center gap-3 post-search-card cursor-pointer hover:bg-cream-100 transition-colors" data-post-id="${p.id}">
      ${p.imageUrl ? `<img src="${p.imageUrl}" class="w-14 h-14 rounded-lg object-cover flex-shrink-0" alt="" loading="lazy"/>` : `<div class="w-14 h-14 rounded-lg bg-cream-200 flex items-center justify-center text-2xl flex-shrink-0">📝</div>`}
      <div class="flex-1 min-w-0">
        <p class="text-sm text-navy-800 truncate">${sanitizeHTML(p.caption || 'Memory')}</p>
        <p class="text-xs text-gray-400"><span data-user-name="${p.authorId}">${sanitizeHTML(authorName)}</span> ${p.category ? `· ${sanitizeHTML(p.category)}` : ''}</p>
      </div>
    </div>`;
}

function bindUserCardEvents(container) {
  container.querySelectorAll('.user-search-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.dm-btn')) return;
      const uid = card.dataset.uid;
      router.navigate('profile', { userId: uid });
    });
  });

  container.querySelectorAll('.dm-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      router.navigate('chat', { userId: btn.dataset.uid, userName: btn.dataset.name });
    });
  });

  container.querySelectorAll('.post-search-card').forEach(card => {
    card.addEventListener('click', () => {
      const postId = card.dataset.postId;
      router.navigate('home', { postId: postId });
    });
  });
}

function saveRecentSearch(q) {
  const key = 'search_recents';
  let recents = JSON.parse(localStorage.getItem(key) || '[]');
  recents = recents.filter(r => r !== q);
  recents.unshift(q);
  if (recents.length > 8) recents = recents.slice(0, 8);
  localStorage.setItem(key, JSON.stringify(recents));
}

function loadRecentSearches(container) {
  const recentEl = container.querySelector('#recent-searches');
  const recentList = container.querySelector('#recent-list');
  const recents = JSON.parse(localStorage.getItem('search_recents') || '[]');
  
  if (recents.length === 0) {
    recentEl?.classList.add('hidden');
    return;
  }

  if (recentList) {
    recentList.innerHTML = recents.map(r => `
      <div class="recent-search-item flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-cream-100 cursor-pointer transition-colors" data-q="${sanitizeHTML(r)}">
        <svg class="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <span class="text-sm text-navy-800 flex-1">${sanitizeHTML(r)}</span>
        <svg class="w-3 h-3 text-gray-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"/></svg>
      </div>
    `).join('');

    recentList.querySelectorAll('.recent-search-item').forEach(item => {
      item.addEventListener('click', () => {
        const q = item.dataset.q;
        const input = container.querySelector('#search-input');
        if (input) {
          input.value = q;
          input.dispatchEvent(new Event('input'));
        }
      });
    });
  }
}
