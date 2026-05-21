// Search page — Enhanced with DM start, profile view, real-time presence
import { db, collection, getDocs, query, where, orderBy, limit } from '../firebase-config.js';
import { sanitizeHTML, debounce } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';

let allUsers = [];
let allPosts = [];

export async function renderSearch(container) {
  container.innerHTML = `
    <section class="px-4 pt-4">
      <h2 class="text-xl font-bold text-navy-800 mb-4">Search</h2>

      <div class="relative mb-5">
        <svg class="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
        <input type="text" id="search-input" placeholder="Search people, memories, categories..."
          class="w-full pl-11 pr-4 py-3 border border-gray-200 rounded-2xl text-sm text-navy-800 placeholder:text-gray-400 focus:outline-none focus:border-navy-500 bg-white"/>
      </div>

      <!-- Search Tabs -->
      <div class="flex gap-2 mb-4">
        <button class="search-tab active" data-tab="people">👥 People</button>
        <button class="search-tab" data-tab="memories">📸 Memories</button>
      </div>

      <div id="search-results" class="space-y-1"></div>

      <div id="all-classmates" class="mt-4">
        <h3 class="section-title mb-3">All Classmates</h3>
        <div id="classmates-grid" class="space-y-1"></div>
      </div>
    </section>
  `;

  let activeTab = 'people';

  // Tabs
  container.querySelectorAll('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      performSearch(container, container.querySelector('#search-input')?.value || '', activeTab);
    });
  });

  try {
    const [usersSnap, postsSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50)))
    ]);
    allUsers = [];
    allPosts = [];
    usersSnap.forEach(d => allUsers.push({ id: d.id, ...d.data() }));
    postsSnap.forEach(d => allPosts.push({ id: d.id, ...d.data() }));
    renderAllClassmates(container);
  } catch (e) {
    container.querySelector('#classmates-grid').innerHTML = `<div class="card p-6 text-center text-sm text-gray-400">Connect Firebase to see classmates</div>`;
  }

  container.querySelector('#search-input').addEventListener('input', debounce((e) => {
    performSearch(container, e.target.value, activeTab);
  }, 300));
}

function performSearch(container, searchQuery, tab) {
  const q = searchQuery.toLowerCase().trim();
  const results = container.querySelector('#search-results');
  const allSection = container.querySelector('#all-classmates');

  if (!q) {
    results.innerHTML = '';
    allSection.classList.remove('hidden');
    return;
  }
  allSection.classList.add('hidden');

  if (tab === 'people') {
    const filtered = allUsers.filter(u =>
      u.fullName?.toLowerCase().includes(q) ||
      u.rollNumber?.toLowerCase().includes(q) ||
      u.nickname?.toLowerCase().includes(q)
    );
    results.innerHTML = filtered.length
      ? filtered.map(u => userCard(u)).join('')
      : '<p class="text-center text-gray-400 py-8 text-sm">No classmates found</p>';
  } else {
    const filtered = allPosts.filter(p =>
      p.caption?.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      p.authorName?.toLowerCase().includes(q) ||
      p.location?.toLowerCase().includes(q)
    );
    results.innerHTML = filtered.length
      ? filtered.map(p => postSearchCard(p)).join('')
      : '<p class="text-center text-gray-400 py-8 text-sm">No memories found</p>';
  }

  // Bind events
  bindUserCardEvents(results);
}

function renderAllClassmates(container) {
  const grid = container.querySelector('#classmates-grid');
  grid.innerHTML = allUsers.length
    ? allUsers.map(u => userCard(u)).join('')
    : '<p class="text-center text-gray-400 py-4 text-sm">No users loaded</p>';
  bindUserCardEvents(grid);
}

function userCard(u) {
  const avatar = u.profilePic
    ? `<img src="${u.profilePic}" class="avatar" alt="${sanitizeHTML(u.fullName || '')}"/>`
    : `<div class="avatar avatar-placeholder text-sm">${(u.fullName || '?')[0]}</div>`;

  return `
    <div class="chat-item user-search-card" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}">
      <div class="relative">
        ${avatar}
        <div class="presence-dot-mini ${u.online ? 'presence-online' : 'presence-offline'}"></div>
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm text-navy-800">${sanitizeHTML(u.fullName || 'Unknown')}</p>
        <p class="text-xs text-gray-400">${u.nickname ? `"${sanitizeHTML(u.nickname)}" · ` : ''}Roll #${sanitizeHTML(u.rollNumber || '—')}</p>
      </div>
      <div class="flex items-center gap-1">
        <button class="dm-btn p-1.5 rounded-full hover:bg-cream-100 text-gray-400 hover:text-navy-500 transition-colors" data-uid="${u.id}" data-name="${sanitizeHTML(u.fullName || '')}" title="Message">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 016 21c-1.052 0-2.062-.18-3-.512v-.003c0-1.113.285-2.16.786-3.07C2.859 16.023 2 14.104 2 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg>
        </button>
      </div>
    </div>`;
}

function postSearchCard(p) {
  return `
    <div class="card p-3 flex items-center gap-3">
      ${p.imageUrl ? `<img src="${p.imageUrl}" class="w-14 h-14 rounded-lg object-cover flex-shrink-0" alt="" loading="lazy"/>` : `<div class="w-14 h-14 rounded-lg bg-cream-200 flex items-center justify-center text-2xl flex-shrink-0">📝</div>`}
      <div class="flex-1 min-w-0">
        <p class="text-sm text-navy-800 truncate">${sanitizeHTML(p.caption || 'Memory')}</p>
        <p class="text-xs text-gray-400">${sanitizeHTML(p.authorName || '')} ${p.category ? `· ${sanitizeHTML(p.category)}` : ''}</p>
      </div>
    </div>`;
}

function bindUserCardEvents(container) {
  container.querySelectorAll('.user-search-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't navigate if clicking DM button
      if (e.target.closest('.dm-btn')) return;
      const uid = card.dataset.uid;
      router.navigate('profile', { userId: uid });
    });
  });

  container.querySelectorAll('.dm-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      router.navigate('chat');
    });
  });
}
