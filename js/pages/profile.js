// Profile page — Instagram-style with cover photo, tabs, hidden settings menu
import { db, doc, getDoc, getDocs, collection, query, where, orderBy, addDoc, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, updateDoc, deleteDoc } from '../firebase-config.js';
import { showToast, sanitizeHTML, timeAgo, formatNumber } from '../utils.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { createNotification } from '../notifications.js';

// Track active badge listener for cleanup
let unsubBadges = null;

export async function renderProfile(container, data = null) {
  const viewingOther = data?.userId && data.userId !== authManager.currentUser?.uid;
  let user;

  if (viewingOther) {
    try {
      const snap = await getDoc(doc(db, 'users', data.userId));
      user = snap.exists() ? { id: snap.id, ...snap.data() } : {};
    } catch (e) { user = {}; }
  } else {
    user = authManager.userData || {};
  }

  // Load user's posts & tagged posts
  let userPosts = [];
  let taggedPosts = [];
  let totalLikes = 0;
  let totalComments = 0;
  let friendCount = 0;
  const uid = viewingOther ? data.userId : authManager.currentUser?.uid;

  try {
    if (uid) {
      const postSnap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', uid), orderBy('createdAt', 'desc')));
      postSnap.forEach(d => {
        const p = d.data();
        userPosts.push({ id: d.id, ...p });
        totalLikes += (p.likes?.length || 0);
        totalComments += (p.commentCount || 0);
      });
    }
  } catch (e) { }

  // Get tagged posts
  try {
    if (uid) {
      const tagSnap = await getDocs(query(collection(db, 'posts'), where('taggedFriends', 'array-contains', uid), orderBy('createdAt', 'desc')));
      tagSnap.forEach(d => taggedPosts.push({ id: d.id, ...d.data() }));
    }
  } catch (e) { }

  // Count friends (all other users)
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    friendCount = Math.max(0, usersSnap.size - 1);
  } catch (e) { }

  // Dynamic badges
  const badges = [];
  if (userPosts.length >= 1) badges.push({ icon: '📸', name: 'Memory Maker' });
  if (userPosts.length >= 10) badges.push({ icon: '🌟', name: 'Prolific' });
  if (totalLikes >= 10) badges.push({ icon: '❤️', name: 'Beloved' });
  if (totalLikes >= 50) badges.push({ icon: '⭐', name: 'Star' });

  // Memory highlights — most liked posts
  const highlights = [...userPosts].sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0)).slice(0, 6);

  // Birthday check
  const isBirthday = (() => {
    if (!user.dateOfBirth) return false;
    const today = new Date();
    const dob = new Date(user.dateOfBirth);
    return dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate();
  })();

  container.innerHTML = `
    ${viewingOther ? `
      <button id="back-profile-btn" class="profile-back-btn">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
      </button>
    ` : ''}

    <!-- Profile Header: Avatar LEFT + Info RIGHT -->
    <div class="px-5 pt-6 pb-2">
      <div class="flex items-start gap-5">
        <!-- Avatar (clean, no + button) -->
        <div class="relative flex-shrink-0">
          <div class="profile-avatar-container ${isBirthday ? 'birthday-ring' : ''}" id="profile-pic-view">
            ${user.profilePic
              ? `<img src="${user.profilePic}" class="w-full h-full object-cover" alt="${sanitizeHTML(user.fullName || '')}" id="profile-pic-img"/>`
              : `<div class="w-full h-full flex items-center justify-center text-white text-4xl font-bold">${(user.fullName || '?')[0]}</div>`}
          </div>
          <div class="absolute bottom-1 right-1 w-5 h-5 rounded-full ${user.online ? 'bg-green-400' : 'bg-gray-300'} border-3 border-white"></div>
          ${isBirthday ? '<div class="absolute -top-1 -right-1"><span class="birthday-badge">🎂</span></div>' : ''}
        </div>

        <!-- Name + Stats -->
        <div class="flex-1 pt-1">
          <h2 class="text-xl font-bold text-navy-800 leading-tight">${sanitizeHTML(user.fullName || 'Your Name')}</h2>
          ${user.nickname ? `<p class="font-handwriting text-base text-navy-400 italic mt-0.5">"${sanitizeHTML(user.nickname)}"</p>` : ''}

          <!-- Stats Row — Clickable, properly spaced -->
          <div class="profile-stats-row mt-3">
            <button class="profile-stat-btn" data-stat="posts">
              <span class="profile-stat-value">${userPosts.length}</span>
              <span class="profile-stat-label">Posts</span>
            </button>
            <div class="profile-stat-divider"></div>
            <button class="profile-stat-btn" data-stat="likes">
              <span class="profile-stat-value">${formatNumber(totalLikes)}</span>
              <span class="profile-stat-label">Likes</span>
            </button>
            <div class="profile-stat-divider"></div>
            <button class="profile-stat-btn" data-stat="comments">
              <span class="profile-stat-value">${formatNumber(totalComments)}</span>
              <span class="profile-stat-label">Comments</span>
            </button>
            <div class="profile-stat-divider"></div>
            <button class="profile-stat-btn" data-stat="friends">
              <span class="profile-stat-value">${friendCount}</span>
              <span class="profile-stat-label">Friends</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Bio -->
      <div class="mt-4">
        ${user.bio ? `<p class="text-sm text-gray-600 leading-relaxed">${sanitizeHTML(user.bio)}</p>` : ''}
      </div>

      <!-- Action buttons -->
      <div class="flex items-center gap-3 mt-4">
        ${viewingOther ? `
          <button class="flex-1 py-2.5 bg-navy-500 text-white rounded-xl text-sm font-semibold hover:bg-navy-600 transition-colors active:scale-[0.98]" id="dm-from-profile" data-uid="${data.userId}" data-name="${sanitizeHTML(user.fullName || '')}">Message 💬</button>
        ` : `
          <button class="flex-1 py-2.5 bg-navy-500 text-white rounded-xl text-sm font-semibold hover:bg-navy-600 transition-colors active:scale-[0.98]" id="edit-profile-quick">Edit Profile</button>
        `}
      </div>

      <!-- Badges -->
      <div class="flex flex-wrap gap-2 mt-4 justify-center" id="profile-badges">
        ${badges.map(b => `<span class="badge-chip">${b.icon} ${b.name}</span>`).join('')}
        ${user.endYear ? `<span class="badge-chip">🎓 Batch of ${sanitizeHTML(user.endYear)}</span>` : ''}
      </div>

      <!-- Friend Suggested Badges -->
      <div id="suggested-badges-area" class="mt-3"></div>

      <!-- Suggest badge button (other profiles) -->
      ${viewingOther ? `
        <button id="suggest-badge-btn" class="mt-3 w-full py-2 text-xs font-semibold text-navy-500 border border-navy-200 rounded-xl hover:bg-navy-50 transition-colors">🏷 Suggest a Badge</button>
      ` : ''}

      <!-- Admin Controls (only visible to admin, completely hidden for normal users) -->
      ${authManager.isAdmin && viewingOther ? `
        <div class="admin-controls-panel" id="admin-controls">
          <div class="admin-controls-header">
            <span class="admin-controls-tag">🔒 Admin</span>
          </div>
          <div class="admin-controls-grid">
            <div class="admin-field">
              <span class="admin-field-label">Roll Number</span>
              <span class="admin-field-value" id="admin-roll">${sanitizeHTML(user.rollNumber || 'Not Set')}</span>
              <button class="admin-edit-btn" data-field="rollNumber" data-uid="${uid}">Edit</button>
            </div>
            <div class="admin-field">
              <span class="admin-field-label">Date of Birth</span>
              <span class="admin-field-value" id="admin-dob">${user.dateOfBirth || 'Not Set'}</span>
              <button class="admin-edit-btn" data-field="dateOfBirth" data-uid="${uid}">Edit</button>
            </div>
          </div>
        </div>
      ` : ''}
    </div>

    <!-- Tabs -->
    <div class="profile-tabs-bar mt-2" id="profile-tabs">
      <button class="profile-tab active" data-tab="posts">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>
        <span>Posts</span>
      </button>
      <button class="profile-tab" data-tab="tagged">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z"/></svg>
        <span>Tagged</span>
      </button>
      <button class="profile-tab" data-tab="slambook">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/></svg>
        <span>Slam Book</span>
      </button>
      <button class="profile-tab" data-tab="memories">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>
        <span>Highlights</span>
      </button>
    </div>

    <!-- Tab Content -->
    <div id="tab-content" class="pb-8"></div>

    <!-- Settings Menu (own profile only) -->
    ${!viewingOther ? `
      <button id="settings-menu-btn" class="profile-settings-btn">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/></svg>
      </button>
      <div id="settings-overlay" class="settings-overlay hidden">
        <div class="settings-backdrop" id="settings-backdrop"></div>
        <div class="settings-sheet" id="settings-sheet">
          <div class="settings-handle"></div>
          <div class="p-5 pb-8">
            <!-- User Header -->
            <div class="flex items-center gap-3 mb-5 pb-4" style="border-bottom: 1px solid rgba(30,58,95,0.06);">
              ${user.profilePic
                ? `<img src="${user.profilePic}" class="w-14 h-14 rounded-full object-cover border-2 border-cream-200 shadow-sm" alt=""/>`
                : `<div class="w-14 h-14 rounded-full bg-gradient-to-br from-navy-500 to-navy-300 flex items-center justify-center text-white text-xl font-bold shadow-sm">${(user.fullName || '?')[0]}</div>`}
              <div class="flex-1">
                <p class="font-bold text-navy-800 text-base">${sanitizeHTML(user.fullName || 'Your Name')}</p>
                <p class="text-xs text-gray-400">${user.email || ''}</p>
              </div>
            </div>

            <!-- Account Section -->
            <p class="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2 px-2">Account</p>
            <div class="space-y-0.5 mb-4">
              <button class="settings-item" data-action="edit-profile">
                <div class="settings-item-icon bg-blue-50 text-blue-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/></svg>
                </div>
                <span>Edit Profile</span>
                <svg class="w-4 h-4 text-gray-300 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </button>
              <button class="settings-item" data-action="change-password">
                <div class="settings-item-icon bg-purple-50 text-purple-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
                </div>
                <span>Change Password</span>
                <svg class="w-4 h-4 text-gray-300 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </button>
            </div>

            <!-- App Section -->
            <p class="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2 px-2">App</p>
            <div class="space-y-0.5 mb-4">
              <button class="settings-item" data-action="saved-memories">
                <div class="settings-item-icon bg-amber-50 text-amber-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/></svg>
                </div>
                <span>Saved Memories</span>
                <span class="text-xs text-gray-400 ml-auto mr-2">${(user.savedPosts?.length || 0)}</span>
                <svg class="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </button>
              <button class="settings-item" data-action="leaderboard">
                <div class="settings-item-icon bg-yellow-50 text-yellow-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-5.54 0"/></svg>
                </div>
                <span>Leaderboard</span>
                <svg class="w-4 h-4 text-gray-300 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </button>
              <button class="settings-item" data-action="close-friends">
                <div class="settings-item-icon bg-pink-50 text-pink-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg>
                </div>
                <span>Close Friends</span>
                <svg class="w-4 h-4 text-gray-300 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </button>
            </div>

            <!-- Preferences Section -->
            <p class="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-2 px-2">Preferences</p>
            <div class="space-y-0.5 mb-4">
              <button class="settings-item" data-action="notification-settings">
                <div class="settings-item-icon bg-green-50 text-green-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg>
                </div>
                <span>Notification Settings</span>
                <svg class="w-4 h-4 text-gray-300 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </button>
              <button class="settings-item" data-action="privacy-settings">
                <div class="settings-item-icon bg-indigo-50 text-indigo-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>
                </div>
                <span>Privacy Settings</span>
                <svg class="w-4 h-4 text-gray-300 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </button>
            </div>

            <!-- Logout -->
            <div class="pt-2" style="border-top: 1px solid rgba(30,58,95,0.06);">
              <button class="settings-item text-red-500" data-action="logout">
                <div class="settings-item-icon bg-red-50 text-red-500">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>
                </div>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // === TAB SYSTEM ===
  let activeTab = 'posts';
  const tabContent = container.querySelector('#tab-content');

  function renderTabContent(tab) {
    activeTab = tab;
    container.querySelectorAll('.profile-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    switch (tab) {
      case 'posts': renderPostsTab(tabContent, userPosts, viewingOther, user); break;
      case 'tagged': renderTaggedTab(tabContent, taggedPosts); break;
      case 'slambook': renderSlamBookTab(tabContent, user, viewingOther); break;
      case 'memories': renderHighlightsTab(tabContent, highlights); break;
    }
  }

  container.querySelectorAll('.profile-tab').forEach(btn => {
    btn.addEventListener('click', () => renderTabContent(btn.dataset.tab));
  });

  renderTabContent('posts');

  // === SETTINGS MENU ===
  const settingsBtn = container.querySelector('#settings-menu-btn');
  const settingsOverlay = container.querySelector('#settings-overlay');
  const settingsBackdrop = container.querySelector('#settings-backdrop');
  const settingsSheet = container.querySelector('#settings-sheet');

  function openSettings() {
    settingsOverlay?.classList.remove('hidden');
    requestAnimationFrame(() => {
      settingsOverlay?.classList.add('settings-active');
    });
  }

  function closeSettings() {
    settingsOverlay?.classList.remove('settings-active');
    setTimeout(() => settingsOverlay?.classList.add('hidden'), 350);
  }

  settingsBtn?.addEventListener('click', openSettings);
  settingsBackdrop?.addEventListener('click', closeSettings);

  // Touch drag to dismiss
  let startY = 0;
  settingsSheet?.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
  });
  settingsSheet?.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      settingsSheet.style.transform = `translateY(${dy}px)`;
    }
  });
  settingsSheet?.addEventListener('touchend', (e) => {
    const dy = (e.changedTouches?.[0]?.clientY || 0) - startY;
    settingsSheet.style.transform = '';
    if (dy > 80) closeSettings();
  });

  // Settings actions
  container.querySelectorAll('.settings-item').forEach(item => {
    item.addEventListener('click', () => {
      closeSettings();
      const action = item.dataset.action;
      setTimeout(() => {
        switch (action) {
          case 'edit-profile': showEditProfileModal(); break;
          case 'change-password': showChangePasswordModal(); break;
          case 'saved-memories': showSavedPosts(); break;
          case 'leaderboard': router.navigate('leaderboard'); break;
          case 'notification-settings': showNotificationSettings(); break;
          case 'privacy-settings': showPrivacySettings(); break;
          case 'close-friends': showCloseFriendsModal(); break;
          case 'logout': showLogoutConfirmation(); break;
        }
      }, 200);
    });
  });

  // Back button for other profiles
  container.querySelector('#back-profile-btn')?.addEventListener('click', () => router.navigateBack());

  // DM from profile — open chat with specific user
  container.querySelector('#dm-from-profile')?.addEventListener('click', (e) => {
    const targetUid = e.currentTarget.dataset.uid;
    const targetName = e.currentTarget.dataset.name;
    router.navigate('chat', { userId: targetUid, userName: targetName });
  });

  // Edit Profile quick button
  container.querySelector('#edit-profile-quick')?.addEventListener('click', () => {
    showEditProfileModal();
  });

  // Profile picture tap-to-view fullscreen
  container.querySelector('#profile-pic-view')?.addEventListener('click', () => {
    if (!user.profilePic) return;
    const overlay = document.createElement('div');
    overlay.className = 'profile-pic-fullscreen';
    overlay.innerHTML = `
      <div class="profile-pic-fullscreen-backdrop"></div>
      <div class="profile-pic-fullscreen-content">
        <img src="${user.profilePic}" alt="${sanitizeHTML(user.fullName || '')}" class="profile-pic-fullscreen-img"/>
        <p class="text-white text-center font-semibold mt-4 text-lg">${sanitizeHTML(user.fullName || '')}</p>
      </div>
      <button class="profile-pic-fullscreen-close">✕</button>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));
    const close = () => { overlay.classList.remove('active'); setTimeout(() => overlay.remove(), 300); };
    overlay.querySelector('.profile-pic-fullscreen-backdrop').addEventListener('click', close);
    overlay.querySelector('.profile-pic-fullscreen-close').addEventListener('click', close);
  });

  // Clickable stat buttons
  container.querySelectorAll('.profile-stat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const stat = btn.dataset.stat;
      switch (stat) {
        case 'posts': showStatDetailModal('posts', userPosts, uid); break;
        case 'likes': showStatDetailModal('likes', userPosts, uid); break;
        case 'comments': showStatDetailModal('comments', userPosts, uid); break;
        case 'friends': showFriendsListModal(uid); break;
      }
    });
  });

  // Badge suggestion system
  container.querySelector('#suggest-badge-btn')?.addEventListener('click', () => {
    showSuggestBadgeModal(uid, user.fullName || 'Friend');
  });

  // Load suggested badges with real-time listener
  if (unsubBadges) { unsubBadges(); unsubBadges = null; }
  loadSuggestedBadgesRealtime(container.querySelector('#suggested-badges-area'), uid, viewingOther);

  // === ADMIN CONTROLS ===
  if (authManager.isAdmin && viewingOther) {
    container.querySelectorAll('.admin-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const field = btn.dataset.field;
        const targetUid = btn.dataset.uid;
        const currentValue = field === 'rollNumber' ? (user.rollNumber || '') : (user.dateOfBirth || '');
        showAdminEditModal(field, targetUid, currentValue, user.fullName || 'User');
      });
    });
  }

}

// ===== ADMIN EDIT MODAL =====
function showAdminEditModal(field, targetUid, currentValue, userName) {
  const fieldLabels = { rollNumber: 'Roll Number', dateOfBirth: 'Date of Birth' };
  const fieldTypes = { rollNumber: 'text', dateOfBirth: 'date' };

  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  overlay.innerHTML = `
    <div class="admin-modal-backdrop"></div>
    <div class="admin-modal-card">
      <div class="admin-modal-header">
        <span class="admin-controls-tag">🔒 Admin Edit</span>
        <button class="admin-modal-close">✕</button>
      </div>
      <p class="text-sm text-gray-300 mb-4">Editing <strong class="text-white">${fieldLabels[field]}</strong> for <strong class="text-white">${sanitizeHTML(userName)}</strong></p>
      <div class="admin-input-group">
        <label class="admin-input-label">${fieldLabels[field]}</label>
        <input type="${fieldTypes[field]}" id="admin-field-input" value="${currentValue}" class="admin-input" placeholder="Enter ${fieldLabels[field].toLowerCase()}"/>
      </div>
      <div class="flex gap-3 mt-5">
        <button class="admin-cancel-btn flex-1">Cancel</button>
        <button class="admin-save-btn flex-1" id="admin-save">💾 Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('active'));

  const close = () => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('.admin-modal-backdrop').addEventListener('click', close);
  overlay.querySelector('.admin-modal-close').addEventListener('click', close);
  overlay.querySelector('.admin-cancel-btn').addEventListener('click', close);

  overlay.querySelector('#admin-save').addEventListener('click', async () => {
    const btn = overlay.querySelector('#admin-save');
    const newValue = overlay.querySelector('#admin-field-input').value.trim();
    if (!newValue) { showToast('Value cannot be empty', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '⏳ Saving...';
    try {
      await authManager.adminUpdateUser(targetUid, { [field]: newValue });
      showToast(`${fieldLabels[field]} updated! ✅`, 'success');

      // Update the display on current page
      if (field === 'rollNumber') {
        const el = document.querySelector('#admin-roll');
        if (el) el.textContent = newValue;
      } else if (field === 'dateOfBirth') {
        const el = document.querySelector('#admin-dob');
        if (el) el.textContent = newValue;
      }
      close();
    } catch (err) {
      console.error('Admin update error:', err);
      showToast('Update failed', 'error');
      btn.disabled = false;
      btn.innerHTML = '💾 Save';
    }
  });
}

// Badge suggestion system
const PRESET_BADGES = [
  { icon: '📖', name: 'Storyteller' },
  { icon: '🎓', name: 'Alumni' },
  { icon: '🏆', name: 'Topper' },
  { icon: '🤫', name: 'Silent Killer' },
  { icon: '🤡', name: 'Class Clown' },
  { icon: '📋', name: 'Attendance King' },
  { icon: '😂', name: 'Meme Creator' },
  { icon: '🎵', name: 'Music Star' },
  { icon: '⚡', name: 'Energizer' },
  { icon: '💤', name: 'Biggest Sleeper' },
  { icon: '📚', name: 'Bookworm' },
  { icon: '🎨', name: 'Artist' }
];

function showSuggestBadgeModal(targetUserId, targetName) {
  const modal = router.openModal('', { title: '🏷 Suggest a Badge' });
  modal.body.innerHTML = `
    <div class="p-4">
      <p class="text-sm text-gray-500 mb-4">Suggest a title for <strong>${sanitizeHTML(targetName)}</strong></p>
      <div class="grid grid-cols-2 gap-2 mb-4">
        ${PRESET_BADGES.map(b => `
          <button class="badge-suggest-option text-left px-3 py-2.5 rounded-xl border border-gray-100 hover:border-navy-300 hover:bg-navy-50 transition-all text-sm" data-badge="${b.name}" data-icon="${b.icon}">
            ${b.icon} ${b.name}
          </button>
        `).join('')}
      </div>
      <div class="flex gap-2">
        <input type="text" id="custom-badge-input" placeholder="Or type custom badge..." maxlength="20" class="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-navy-400"/>
        <button id="send-custom-badge" class="px-4 py-2 bg-navy-500 text-white rounded-xl text-sm font-semibold">Send</button>
      </div>
    </div>
  `;

  // Preset badge click
  modal.body.querySelectorAll('.badge-suggest-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      await submitBadgeSuggestion(targetUserId, btn.dataset.badge, btn.dataset.icon);
      modal.close();
    });
  });

  // Custom badge
  modal.body.querySelector('#send-custom-badge')?.addEventListener('click', async () => {
    const text = modal.body.querySelector('#custom-badge-input')?.value.trim();
    if (!text) { showToast('Enter a badge name', 'warning'); return; }
    await submitBadgeSuggestion(targetUserId, text, '🏷');
    modal.close();
  });
}

async function submitBadgeSuggestion(targetUserId, badgeName, icon) {
  try {
    await addDoc(collection(db, 'badges'), {
      targetUserId,
      badgeName,
      icon,
      suggestedBy: authManager.currentUser.uid,
      suggestedByName: authManager.userData?.fullName || 'A classmate',
      status: 'pending',
      pinned: false,
      createdAt: serverTimestamp()
    });
    // Send notification to the target user
    await createNotification('badge_suggestion', targetUserId, {
      title: `🏷 ${authManager.userData?.fullName || 'Someone'} suggested a new title for you`,
      message: `${icon} ${badgeName}`,
      badgeName,
      badgeIcon: icon
    });
    showToast('Badge suggested! 🏷', 'success');
  } catch (e) {
    console.error('Badge suggestion error:', e);
    showToast('Could not suggest badge', 'error');
  }
}

function loadSuggestedBadgesRealtime(container, targetUserId, viewingOther) {
  if (!container) return;
  try {
    const q = query(collection(db, 'badges'), where('targetUserId', '==', targetUserId));
    unsubBadges = onSnapshot(q, (snap) => {
      if (snap.empty) { container.innerHTML = ''; return; }

      const myUid = authManager.currentUser?.uid;
      const isOwner = targetUserId === myUid;
      const badges = [];
      snap.forEach(d => badges.push({ id: d.id, ...d.data() }));

      // Sort: pinned first, then accepted, then pending
      badges.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.status === 'accepted' ? -1 : 1));

      // Filter: show accepted badges to everyone. Pending only to owner.
      const visibleBadges = badges.filter(b => b.status === 'accepted' || (isOwner && b.status === 'pending'));

      if (visibleBadges.length === 0) { container.innerHTML = ''; return; }

      container.innerHTML = `
        <div class="suggested-badges-grid">
          ${visibleBadges.map(b => {
            const showSuggestor = (b.suggestedBy === myUid || isOwner);
            const isPending = b.status === 'pending';
            return `
              <div class="suggested-badge-card ${b.pinned ? 'pinned' : ''} ${isPending ? 'pending' : ''}" data-badge-id="${b.id}">
                <div class="badge-icon-glow">${b.icon}</div>
                <span class="badge-label">${sanitizeHTML(b.badgeName)}</span>
                ${showSuggestor ? `<span class="badge-suggestor">Suggested by ${sanitizeHTML(b.suggestedByName)}</span>` : ''}
                ${isOwner && isPending ? `
                  <div class="badge-actions">
                    <button class="badge-accept-btn" data-id="${b.id}" title="Accept">✓</button>
                    <button class="badge-reject-btn" data-id="${b.id}" title="Reject">✕</button>
                  </div>
                ` : ''}
                ${isOwner && b.status === 'accepted' ? `
                  <button class="badge-pin-btn ${b.pinned ? 'active' : ''}" data-id="${b.id}" data-pinned="${b.pinned}">${b.pinned ? '⭐ Pinned' : '☆ Pin'}</button>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Accept/reject/pin handlers (real-time updates auto-refresh via onSnapshot)
      container.querySelectorAll('.badge-accept-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await updateDoc(doc(db, 'badges', btn.dataset.id), { status: 'accepted' });
          showToast('Badge accepted! 🏷', 'success');
        });
      });
      container.querySelectorAll('.badge-reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'badges', btn.dataset.id));
          showToast('Badge rejected', 'info');
        });
      });
      container.querySelectorAll('.badge-pin-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const isPinned = btn.dataset.pinned === 'true';
          await updateDoc(doc(db, 'badges', btn.dataset.id), { pinned: !isPinned });
          showToast(isPinned ? 'Unpinned' : 'Pinned! ⭐', 'info');
        });
      });
    });
  } catch (e) {
    console.error('Load badges error:', e);
  }
}

// ===== LOGOUT CONFIRMATION =====
function showLogoutConfirmation() {
  const overlay = document.createElement('div');
  overlay.className = 'logout-confirm-overlay';
  overlay.innerHTML = `
    <div class="logout-confirm-backdrop"></div>
    <div class="logout-confirm-card">
      <div class="text-4xl mb-3">👋</div>
      <h3 class="text-lg font-bold text-navy-800 mb-1">Leaving so soon?</h3>
      <p class="text-sm text-gray-400 mb-5">Are you sure you want to logout?</p>
      <div class="flex gap-3 w-full">
        <button class="logout-cancel-btn flex-1">Cancel</button>
        <button class="logout-confirm-btn flex-1">Logout</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('active'));

  const close = () => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('.logout-confirm-backdrop').addEventListener('click', close);
  overlay.querySelector('.logout-cancel-btn').addEventListener('click', close);
  overlay.querySelector('.logout-confirm-btn').addEventListener('click', async () => {
    close();
    await authManager.logout();
    showToast('See you soon! 👋', 'info');
  });
}

// ===== STAT DETAIL MODALS =====
async function showStatDetailModal(type, userPosts, uid) {
  const titles = { posts: '📸 Posts', likes: '❤️ Likes Received', comments: '💬 Comments Received' };
  const modal = router.openModal('', { title: titles[type] || type });

  if (type === 'posts') {
    if (userPosts.length === 0) {
      modal.body.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">No posts yet</div>';
      return;
    }
    modal.body.innerHTML = `
      <div class="p-4">
        <div class="profile-posts-grid">
          ${userPosts.map(p => `
            <div class="profile-post-thumb" data-post-id="${p.id}">
              ${p.imageUrl
                ? `<img src="${p.imageUrl}" alt="" class="w-full h-full object-cover"/>`
                : `<div class="w-full h-full bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center text-xs text-navy-500 p-2 text-center leading-tight">${sanitizeHTML((p.content || '').slice(0, 60))}</div>`}
              <div class="profile-post-overlay">
                <span>❤️ ${p.likes?.length || 0}</span>
                <span>💬 ${p.commentCount || 0}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    modal.body.querySelectorAll('.profile-post-thumb').forEach(el => {
      el.addEventListener('click', () => {
        modal.close();
        router.navigate('feed', { scrollTo: el.dataset.postId });
      });
    });
  } else if (type === 'likes') {
    modal.body.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">Loading likes...</div>';
    const likeItems = [];
    for (const post of userPosts) {
      if (post.likes?.length > 0) {
        for (const likerUid of post.likes.slice(0, 10)) {
          try {
            const snap = await getDoc(doc(db, 'users', likerUid));
            const name = snap.exists() ? snap.data().fullName || 'Unknown' : 'Unknown';
            likeItems.push({ name, postContent: post.content?.slice(0, 40) || 'a memory', postId: post.id, pic: snap.exists() ? snap.data().profilePic : '' });
          } catch { likeItems.push({ name: 'Unknown', postContent: 'a memory', postId: post.id, pic: '' }); }
        }
      }
    }
    if (likeItems.length === 0) {
      modal.body.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">No likes yet. Share more memories!</div>';
      return;
    }
    modal.body.innerHTML = `
      <div class="p-4 space-y-2">
        ${likeItems.map(l => `
          <div class="stat-detail-item">
            ${l.pic ? `<img src="${l.pic}" class="stat-detail-avatar"/>` : `<div class="stat-detail-avatar-placeholder">${l.name[0]}</div>`}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(l.name)}</p>
              <p class="text-[11px] text-gray-400 truncate">liked "${sanitizeHTML(l.postContent)}..." ❤️</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (type === 'comments') {
    modal.body.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">Loading comments...</div>';
    const commentItems = [];
    for (const post of userPosts) {
      try {
        const commentsSnap = await getDocs(query(collection(db, 'posts', post.id, 'comments'), orderBy('createdAt', 'desc')));
        commentsSnap.forEach(cDoc => {
          const c = cDoc.data();
          commentItems.push({ authorName: c.authorName || 'Unknown', text: c.text?.slice(0, 50) || '', postContent: post.content?.slice(0, 30) || 'a memory', postId: post.id, time: c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : '' });
        });
      } catch { /* skip */ }
    }
    if (commentItems.length === 0) {
      modal.body.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">No comments yet</div>';
      return;
    }
    modal.body.innerHTML = `
      <div class="p-4 space-y-2">
        ${commentItems.slice(0, 30).map(c => `
          <div class="stat-detail-item">
            <div class="stat-detail-avatar-placeholder">${(c.authorName || '?')[0]}</div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-navy-800"><span class="font-semibold">${sanitizeHTML(c.authorName)}</span> <span class="text-gray-400">on</span> "${sanitizeHTML(c.postContent)}..."</p>
              <p class="text-[11px] text-gray-400 truncate">"${sanitizeHTML(c.text)}" · ${c.time}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
}

// ===== FRIENDS LIST MODAL =====
async function showFriendsListModal(uid) {
  const modal = router.openModal('', { title: '👥 Friends' });
  modal.body.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">Loading friends...</div>';

  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    const friends = [];
    usersSnap.forEach(d => {
      if (d.id !== uid) {
        const u = d.data();
        friends.push({ id: d.id, ...u });
      }
    });
    friends.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (a.fullName || '').localeCompare(b.fullName || ''));

    modal.body.innerHTML = `
      <div class="p-4 space-y-2">
        ${friends.map(f => `
          <div class="friend-list-item" data-uid="${f.id}">
            <div class="relative">
              ${f.profilePic
                ? `<img src="${f.profilePic}" class="friend-list-avatar"/>`
                : `<div class="friend-list-avatar-placeholder">${(f.fullName || '?')[0]}</div>`}
              <div class="friend-online-dot ${f.online ? 'online' : ''}"></div>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(f.fullName || 'Unknown')}</p>
              <p class="text-[11px] text-gray-400">${f.rollNumber || ''} · ${f.online ? '🟢 Online' : 'Offline'}</p>
            </div>
            <button class="friend-msg-btn" data-uid="${f.id}" data-name="${sanitizeHTML(f.fullName || '')}">💬</button>
          </div>
        `).join('')}
      </div>
    `;

    // Click friend row → navigate to profile
    modal.body.querySelectorAll('.friend-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.friend-msg-btn')) return;
        modal.close();
        router.navigate('profile', { userId: el.dataset.uid });
      });
    });

    // Message button → open chat
    modal.body.querySelectorAll('.friend-msg-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        modal.close();
        router.navigate('chat', { userId: btn.dataset.uid, userName: btn.dataset.name });
      });
    });
  } catch (e) {
    console.error('Friends list error:', e);
    modal.body.innerHTML = '<div class="p-6 text-center text-red-400 text-sm">Could not load friends</div>';
  }
}

// ===== CLOSE FRIENDS MODAL =====
async function showCloseFriendsModal() {
  const modal = router.openModal('', { title: '👥 Close Friends' });
  modal.body.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">Loading...</div>';

  try {
    const myData = authManager.userData || {};
    const closeFriends = myData.closeFriends || [];

    const usersSnap = await getDocs(collection(db, 'users'));
    const allUsers = [];
    usersSnap.forEach(d => {
      if (d.id !== authManager.currentUser?.uid) {
        allUsers.push({ id: d.id, ...d.data() });
      }
    });
    allUsers.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

    modal.body.innerHTML = `
      <div class="p-4">
        <p class="text-xs text-gray-400 mb-4">Select close friends to share private memories and diary entries.</p>
        <div class="space-y-2" id="close-friends-list">
          ${allUsers.map(u => {
            const isClose = closeFriends.includes(u.id);
            return `
              <label class="close-friend-item ${isClose ? 'selected' : ''}" data-uid="${u.id}">
                ${u.profilePic
                  ? `<img src="${u.profilePic}" class="close-friend-avatar"/>`
                  : `<div class="close-friend-avatar-placeholder">${(u.fullName || '?')[0]}</div>`}
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(u.fullName || 'Unknown')}</p>
                  <p class="text-[10px] text-gray-400">${u.nickname ? `"${sanitizeHTML(u.nickname)}"` : u.rollNumber || ''}</p>
                </div>
                <div class="close-friend-check ${isClose ? 'active' : ''}">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                </div>
              </label>
            `;
          }).join('')}
        </div>
        <button id="save-close-friends" class="btn-primary btn-shimmer mt-4">💚 Save Close Friends</button>
      </div>
    `;

    // Toggle selection
    modal.body.querySelectorAll('.close-friend-item').forEach(item => {
      item.addEventListener('click', () => {
        item.classList.toggle('selected');
        item.querySelector('.close-friend-check').classList.toggle('active');
      });
    });

    // Save
    modal.body.querySelector('#save-close-friends')?.addEventListener('click', async () => {
      const btn = modal.body.querySelector('#save-close-friends');
      btn.disabled = true;
      btn.innerHTML = '⏳ Saving...';
      const selected = [];
      modal.body.querySelectorAll('.close-friend-item.selected').forEach(el => {
        selected.push(el.dataset.uid);
      });
      try {
        await authManager.updateProfile({ closeFriends: selected });
        showToast(`${selected.length} close friend${selected.length !== 1 ? 's' : ''} saved! 💚`, 'success');
        modal.close();
      } catch (e) {
        console.error('Save close friends error:', e);
        showToast('Failed to save', 'error');
        btn.disabled = false;
        btn.innerHTML = '💚 Save Close Friends';
      }
    });
  } catch (e) {
    console.error('Close friends error:', e);
    modal.body.innerHTML = '<div class="p-6 text-center text-red-400 text-sm">Could not load friends</div>';
  }
}

// ===== TAB RENDERERS =====

function renderPostsTab(el, posts, viewingOther, user) {
  if (posts.length === 0) {
    el.innerHTML = `
      <div class="px-4 py-12 text-center">
        <div class="text-4xl mb-3">📷</div>
        <h3 class="font-semibold text-navy-700 mb-1">${viewingOther ? 'No memories yet' : 'Share your first memory'}</h3>
        <p class="text-sm text-gray-400">${viewingOther ? 'When they post, it will appear here.' : 'Your school memories will appear here.'}</p>
      </div>`;
    return;
  }

  const recentPosts = posts.slice(0, 10);
  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  el.innerHTML = `
    <!-- Recent Posts — Horizontal Scroll -->
    <div class="px-4 pt-4 pb-2">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-navy-800">Recent Posts</h3>
        ${posts.length > 4 ? '<button class="text-xs text-navy-500 font-semibold" id="view-all-posts">View all</button>' : ''}
      </div>
      <div class="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory" style="-webkit-overflow-scrolling: touch; scrollbar-width: none;">
        ${recentPosts.map(p => `
          <div class="flex-shrink-0 snap-start" style="width: 44%;">
            <div class="rounded-2xl overflow-hidden bg-white shadow-sm border border-gray-50">
              <div class="aspect-[4/3] overflow-hidden bg-cream-100">
                ${p.imageUrl
                  ? `<img src="${p.imageUrl}" class="w-full h-full object-cover" alt="" loading="lazy"/>`
                  : `<div class="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-cream-200 to-cream-300 p-3">
                      <span class="text-2xl mb-1">📝</span>
                      <p class="text-[10px] text-gray-500 font-handwriting text-center">${sanitizeHTML((p.caption || '').slice(0, 40))}</p>
                    </div>`}
              </div>
              <div class="p-2.5">
                <p class="text-xs font-semibold text-navy-800 truncate">${sanitizeHTML((p.caption || 'Untitled').slice(0, 30))}</p>
                <div class="flex items-center justify-between mt-1.5">
                  <p class="text-[10px] text-gray-400">${formatDate(p.createdAt)}</p>
                  <span class="flex items-center gap-0.5 text-[10px] text-gray-400">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>
                    ${p.likes?.length || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- All Posts Grid -->
    ${posts.length > 4 ? `
      <div class="px-4 pt-2 hidden" id="all-posts-grid">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-navy-800">All Posts</h3>
          <button class="text-xs text-navy-500 font-semibold" id="hide-all-posts">Show less</button>
        </div>
        <div class="profile-posts-grid">
          ${posts.map(p => `
            <div class="profile-post-cell">
              ${p.imageUrl
                ? `<img src="${p.imageUrl}" class="w-full h-full object-cover" alt="" loading="lazy"/>`
                : `<div class="w-full h-full bg-gradient-to-br from-cream-200 to-cream-300 flex flex-col items-center justify-center p-2">
                    <span class="text-2xl mb-1">📝</span>
                    <p class="text-[10px] text-gray-500 text-center font-handwriting line-clamp-2">${sanitizeHTML((p.caption || '').slice(0, 40))}</p>
                  </div>`}
              ${p.mediaType === 'video' ? '<div class="absolute top-1.5 right-1.5 text-white drop-shadow"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>' : ''}
              <div class="profile-post-overlay">
                <span class="flex items-center gap-1 text-white text-xs font-semibold"><svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg> ${p.likes?.length || 0}</span>
                <span class="flex items-center gap-1 text-white text-xs font-semibold"><svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"/></svg> ${p.commentCount || 0}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;

  // View all / hide toggle
  el.querySelector('#view-all-posts')?.addEventListener('click', () => {
    const grid = el.querySelector('#all-posts-grid');
    if (grid) grid.classList.remove('hidden');
  });
  el.querySelector('#hide-all-posts')?.addEventListener('click', () => {
    const grid = el.querySelector('#all-posts-grid');
    if (grid) grid.classList.add('hidden');
  });
}

function renderTaggedTab(el, posts) {
  if (posts.length === 0) {
    el.innerHTML = `
      <div class="px-4 py-12 text-center">
        <div class="text-4xl mb-3">🏷️</div>
        <h3 class="font-semibold text-navy-700 mb-1">No tagged memories</h3>
        <p class="text-sm text-gray-400">When you are tagged in a memory, it will appear here.</p>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="profile-posts-grid">
      ${posts.map(p => `
        <div class="profile-post-cell">
          ${p.imageUrl
            ? `<img src="${p.imageUrl}" class="w-full h-full object-cover" alt="" loading="lazy"/>`
            : `<div class="w-full h-full bg-cream-200 flex items-center justify-center"><span class="text-2xl">📝</span></div>`}
          <div class="profile-post-overlay">
            <span class="text-white text-[10px] font-medium">${sanitizeHTML(p.authorName || '')}</span>
          </div>
        </div>
      `).join('')}
    </div>`;
}

async function renderSlamBookTab(el, user, viewingOther) {
  const sb = user.slamBook || {};
  const uid = viewingOther ? user.id : authManager.currentUser?.uid;

  // Self-fill questions (profile owner answers about themselves)
  const selfQuestions = [
    { key: 'favoriteMemory', label: 'Favorite school memory?', icon: '💭' },
    { key: 'firstImpression', label: 'First impression of school?', icon: '🏫' },
    { key: 'funniestMoment', label: 'Funniest classroom moment?', icon: '😂' },
    { key: 'bestFriend', label: 'Best friend in class?', icon: '👫' },
    { key: 'favoriteTeacher', label: 'Favorite teacher?', icon: '👨‍🏫' },
    { key: 'worstSubject', label: 'Most dreaded subject?', icon: '📚' },
    { key: 'secretCrush', label: 'School crush? 🙈', icon: '💝' },
    { key: 'afterSchoolDream', label: 'Dream after school?', icon: '🌟' }
  ];

  // Friend questions (friends answer about this person)
  const friendQuestions = [
    { key: 'whatYouLike', label: 'What do you like about this person?', icon: '❤️' },
    { key: 'favoriteMemoryTogether', label: 'Favorite school memory together?', icon: '📸' },
    { key: 'funniestMoment', label: 'Funniest moment together?', icon: '🤣' },
    { key: 'nickname', label: 'Nickname for them?', icon: '🏷️' },
    { key: 'firstImpression', label: 'First impression?', icon: '👀' },
    { key: 'bestClassroomMemory', label: 'Best classroom memory?', icon: '🏫' },
    { key: 'oneWord', label: 'Describe them in one word?', icon: '✍️' },
    { key: 'message', label: 'A message for them?', icon: '💌' }
  ];

  el.innerHTML = `
    <div class="px-4 py-4">
      <!-- Self answers section -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-3">
          <p class="text-xs font-semibold text-navy-600 uppercase tracking-wider">
            ${viewingOther ? sanitizeHTML(user.fullName || 'Their') + "'s Answers" : 'Your Answers'}
          </p>
          ${!viewingOther ? '<button id="edit-slambook-tab-btn" class="text-xs text-navy-500 font-semibold px-3 py-1.5 rounded-full bg-navy-50 hover:bg-navy-100 transition-colors">✏️ Edit</button>' : ''}
        </div>
        <div class="slam-book-container">
          ${selfQuestions.map((q, i) => `
            <div class="slam-question-card animate-fadeIn" style="animation-delay: ${i * 0.03}s">
              <div class="flex items-center gap-2 mb-1">
                <span>${q.icon}</span>
                <p class="text-[11px] text-navy-400 uppercase tracking-wider font-semibold">${q.label}</p>
              </div>
              <p class="font-handwriting text-lg text-gray-600 leading-relaxed pl-6">${sanitizeHTML(sb[q.key] || 'Not answered yet...')}</p>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Friend entries section -->
      <div class="mt-6 pt-4 border-t border-gray-100">
        <div class="flex items-center justify-between mb-3">
          <p class="text-xs font-semibold text-navy-600 uppercase tracking-wider">
            📖 Friend Slam Entries
          </p>
          ${viewingOther && uid !== authManager.currentUser?.uid ? `
            <button id="write-slambook-btn" class="text-xs text-white font-semibold px-3 py-1.5 rounded-full bg-navy-500 hover:bg-navy-600 transition-colors">
              ✍️ Write in Slam Book
            </button>
          ` : ''}
        </div>
        <div id="friend-slam-entries" class="space-y-3">
          <div class="text-center py-6 text-gray-400 text-sm">Loading entries...</div>
        </div>
      </div>
    </div>
  `;

  el.querySelector('#edit-slambook-tab-btn')?.addEventListener('click', () => showEditSlamBookModal());

  // Write slam book for other user
  el.querySelector('#write-slambook-btn')?.addEventListener('click', () => {
    showWriteSlamBookModal(uid, user.fullName || 'Friend', friendQuestions);
  });

  // Load friend slam entries from Firestore
  loadFriendSlamEntries(el.querySelector('#friend-slam-entries'), uid, friendQuestions);
}

async function loadFriendSlamEntries(container, targetUserId, friendQuestions) {
  try {
    const q = query(
      collection(db, 'slambook', targetUserId, 'entries'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="text-center py-8">
          <div class="text-3xl mb-2">📖</div>
          <p class="text-sm text-gray-400">No friend entries yet</p>
          <p class="text-xs text-gray-300 mt-1">Be the first to write something!</p>
        </div>`;
      return;
    }

    container.innerHTML = '';
    snap.forEach(d => {
      const entry = { id: d.id, ...d.data() };
      const card = createSlamEntryCard(entry, targetUserId, friendQuestions);
      container.appendChild(card);
    });
  } catch (e) {
    console.error('Load slam entries error:', e);
    container.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">Could not load entries</p>';
  }
}

function createSlamEntryCard(entry, targetUserId, friendQuestions) {
  const card = document.createElement('div');
  card.className = 'slam-question-card animate-fadeIn';

  const answeredQs = friendQuestions.filter(q => entry.answers?.[q.key]);
  const reactions = entry.reactions || {};
  const myUid = authManager.currentUser?.uid;
  const myReaction = Object.entries(reactions).find(([emoji, users]) => users?.includes(myUid));

  card.innerHTML = `
    <div class="flex items-center gap-2 mb-3">
      <div class="w-7 h-7 rounded-full bg-gradient-to-br from-navy-400 to-navy-600 flex items-center justify-center text-white text-xs font-bold">
        ${(entry.authorName || '?')[0]}
      </div>
      <div class="flex-1">
        <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(entry.authorName || 'A classmate')}</p>
        <p class="text-[10px] text-gray-400">${entry.createdAt?.toDate ? timeAgo(entry.createdAt.toDate()) : ''}</p>
      </div>
    </div>
    ${answeredQs.map(q => `
      <div class="mb-2 last:mb-0">
        <p class="text-[10px] text-navy-400 uppercase tracking-wider font-semibold flex items-center gap-1">${q.icon} ${q.label}</p>
        <p class="font-handwriting text-base text-gray-600 pl-4 mt-0.5">${sanitizeHTML(entry.answers[q.key])}</p>
      </div>
    `).join('')}
    <div class="flex items-center gap-2 mt-3 pt-2 border-t border-gray-50">
      ${['❤️','😂','🥺','🔥','👏'].map(emoji => {
        const count = (reactions[emoji] || []).length;
        const isActive = (reactions[emoji] || []).includes(myUid);
        return `<button class="slam-react-btn text-sm px-2 py-1 rounded-full transition-all ${isActive ? 'bg-navy-100' : 'hover:bg-cream-100'}" data-emoji="${emoji}" data-entry="${entry.id}">${emoji}${count > 0 ? ` <span class="text-[10px] text-gray-500">${count}</span>` : ''}</button>`;
      }).join('')}
    </div>
  `;

  // Reaction handlers
  card.querySelectorAll('.slam-react-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!myUid) return;
      const emoji = btn.dataset.emoji;
      const entryId = btn.dataset.entry;
      try {
        const ref = doc(db, 'slambook', targetUserId, 'entries', entryId);
        const isActive = (reactions[emoji] || []).includes(myUid);
        if (isActive) {
          await updateDoc(ref, { [`reactions.${emoji}`]: arrayRemove(myUid) });
        } else {
          await updateDoc(ref, { [`reactions.${emoji}`]: arrayUnion(myUid) });
        }
        showToast(isActive ? 'Reaction removed' : `${emoji} reacted!`, 'info');
      } catch (e) {
        showToast('Could not react', 'error');
      }
    });
  });

  return card;
}

function showWriteSlamBookModal(targetUserId, targetName, friendQuestions) {
  const modal = router.openModal('', { title: '📖 Write in Slam Book' });
  modal.body.innerHTML = `
    <div class="p-4">
      <p class="text-sm text-gray-500 mb-4">Write something about <strong>${sanitizeHTML(targetName)}</strong></p>
      <div class="space-y-4">
        ${friendQuestions.map(q => `
          <div class="slam-question-card">
            <label class="flex items-center gap-2 mb-2">
              <span>${q.icon}</span>
              <span class="text-xs font-semibold text-navy-600">${q.label}</span>
            </label>
            <input type="text" class="slam-input w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-handwriting text-gray-700 placeholder:text-gray-300 focus:outline-none focus:border-navy-400" data-key="${q.key}" placeholder="Your answer..." maxlength="200"/>
          </div>
        `).join('')}
      </div>
      <button id="submit-slam-entry" class="btn-primary mt-4">✨ Submit Slam Entry</button>
      <p class="text-[10px] text-gray-400 text-center mt-2">Answer at least 2 questions</p>
    </div>
  `;

  modal.body.querySelector('#submit-slam-entry')?.addEventListener('click', async () => {
    const answers = {};
    modal.body.querySelectorAll('.slam-input').forEach(input => {
      if (input.value.trim()) answers[input.dataset.key] = input.value.trim();
    });

    if (Object.keys(answers).length < 2) {
      showToast('Answer at least 2 questions', 'warning');
      return;
    }

    try {
      await addDoc(collection(db, 'slambook', targetUserId, 'entries'), {
        authorId: authManager.currentUser.uid,
        authorName: authManager.userData?.fullName || 'A classmate',
        authorPhoto: authManager.userData?.profilePic || '',
        answers,
        reactions: {},
        createdAt: serverTimestamp()
      });
      showToast('Slam book entry added! 📖', 'success');
      modal.close();
    } catch (e) {
      console.error('Slam entry error:', e);
      showToast('Could not save entry', 'error');
    }
  });
}

function renderHighlightsTab(el, highlights) {
  if (highlights.length === 0) {
    el.innerHTML = `
      <div class="px-4 py-12 text-center">
        <div class="text-4xl mb-3">✨</div>
        <h3 class="font-semibold text-navy-700 mb-1">No highlights yet</h3>
        <p class="text-sm text-gray-400">Your most loved memories will appear here.</p>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="px-4 py-4">
      <p class="text-xs text-gray-400 text-center mb-4">Your most cherished moments ✨</p>
      <div class="grid grid-cols-2 gap-3">
        ${highlights.map(p => `
          <div class="highlight-card">
            ${p.imageUrl
              ? `<img src="${p.imageUrl}" class="w-full aspect-square object-cover rounded-xl" alt="" loading="lazy"/>`
              : `<div class="w-full aspect-square bg-gradient-to-br from-warm-100 to-cream-300 rounded-xl flex items-center justify-center text-4xl">📷</div>`}
            <div class="mt-2">
              <p class="text-xs text-navy-800 font-medium truncate">${sanitizeHTML(p.caption || 'A memory')}</p>
              <p class="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>
                ${p.likes?.length || 0} likes
              </p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ===== MODALS =====

function showEditProfileModal() {
  const user = authManager.userData || {};
  const modal = router.openModal('', { title: '✏️ Edit Profile' });
  const themeColors = [
    { name: 'Navy', value: '#1e3a5f' },
    { name: 'Ocean', value: '#0077b6' },
    { name: 'Emerald', value: '#065f46' },
    { name: 'Sunset', value: '#c2410c' },
    { name: 'Plum', value: '#7c3aed' },
    { name: 'Rose', value: '#be185d' },
    { name: 'Slate', value: '#475569' },
    { name: 'Gold', value: '#b45309' }
  ];
  modal.body.innerHTML = `
    <div class="p-4 space-y-5">
      <!-- Cover Photo -->
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-2 block">Cover Photo</label>
        <div class="relative rounded-2xl overflow-hidden h-28 bg-gradient-to-r from-navy-400 to-navy-600 cursor-pointer" id="cover-preview-area">
          ${user.coverPhoto ? `<img src="${user.coverPhoto}" class="w-full h-full object-cover" id="edit-cover-preview" alt=""/>` : `<div class="w-full h-full flex items-center justify-center text-white/60" id="edit-cover-preview"><svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg></div>`}
          <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <span class="text-white text-xs font-semibold bg-black/40 px-3 py-1.5 rounded-full">📷 Change Cover</span>
          </div>
          <input type="file" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer z-10" id="cover-file-input"/>
        </div>
      </div>

      <!-- Profile Pic -->
      <div class="flex items-center gap-4">
        <div class="relative">
          ${user.profilePic
            ? `<img src="${user.profilePic}" class="w-20 h-20 rounded-full object-cover border-3 border-cream-300 shadow-md" alt="" id="edit-pic-preview"/>`
            : `<div class="w-20 h-20 rounded-full bg-gradient-to-br from-navy-500 to-navy-300 text-white flex items-center justify-center text-2xl font-bold shadow-md" id="edit-pic-preview">${(user.fullName || '?')[0]}</div>`}
          <label class="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-navy-500 text-white flex items-center justify-center cursor-pointer shadow-lg border-2 border-white">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/></svg>
            <input type="file" accept="image/*" class="hidden" id="pic-file-input"/>
          </label>
        </div>
        <div class="flex-1">
          <p class="text-sm font-semibold text-navy-800">${sanitizeHTML(user.fullName || 'Your Name')}</p>
          <p class="text-xs text-gray-400">Tap camera icon to change photo</p>
          <p class="text-[10px] text-green-500 hidden mt-1" id="pic-upload-status">✓ Photo updated!</p>
        </div>
      </div>

      <!-- Editable Info Section -->
      <div class="pt-2">
        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-3">✏️ Editable Info</p>
        <div class="space-y-3">
          <div>
            <label class="text-xs font-semibold text-navy-600 mb-1 block">Full Name</label>
            <input type="text" id="edit-name" value="${sanitizeHTML(user.fullName || '')}" placeholder="Your full name" maxlength="50" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-400 focus:ring-1 focus:ring-navy-100 bg-white transition-all"/>
          </div>
          <div>
            <label class="text-xs font-semibold text-navy-600 mb-1 block">Nickname</label>
            <input type="text" id="edit-nickname" value="${sanitizeHTML(user.nickname || '')}" placeholder="Class nickname" maxlength="30" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-400 bg-white"/>
          </div>
          <div>
            <label class="text-xs font-semibold text-navy-600 mb-1 block">Bio <span class="text-gray-300 font-normal">(<span id="bio-count">${(user.bio || '').length}</span>/150)</span></label>
            <textarea id="edit-bio" rows="2" maxlength="150" placeholder="Tell something about yourself..." class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-400 bg-white resize-none">${sanitizeHTML(user.bio || '')}</textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-semibold text-navy-600 mb-1 block">Joined School Year</label>
              <input type="text" id="edit-joined" value="${sanitizeHTML(user.joinedYear || '')}" placeholder="2019" maxlength="4" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-400 bg-white"/>
            </div>
            <div>
              <label class="text-xs font-semibold text-navy-600 mb-1 block">End School Year</label>
              <input type="text" id="edit-end" value="${sanitizeHTML(user.endYear || '')}" placeholder="2024" maxlength="4" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-400 bg-white"/>
            </div>
          </div>
        </div>
      </div>

      <!-- Theme Color (optional) -->
      <div class="pt-2">
        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-3">🎨 Theme Color</p>
        <div class="flex flex-wrap gap-3" id="theme-color-picker">
          ${themeColors.map(c => `
            <button class="theme-color-dot ${user.themeColor === c.value ? 'active' : ''}" data-color="${c.value}" style="background: ${c.value}" title="${c.name}"></button>
          `).join('')}
        </div>
        <input type="hidden" id="edit-theme-color" value="${user.themeColor || ''}" />
      </div>

      <!-- Admin-only fields (read-only) -->
      <div class="pt-2">
        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-3">🔒 Admin-Only Info</p>
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-semibold text-gray-400 mb-1 block">🔒 Roll Number</label>
              <input type="text" value="${sanitizeHTML(user.rollNumber || 'Set by Admin')}" disabled class="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm text-gray-400 bg-gray-50 cursor-not-allowed"/>
            </div>
            <div>
              <label class="text-xs font-semibold text-gray-400 mb-1 block">🔒 Date of Birth</label>
              <input type="text" value="${user.dateOfBirth || 'Set by Admin'}" disabled class="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm text-gray-400 bg-gray-50 cursor-not-allowed"/>
            </div>
          </div>
          <p class="text-[10px] text-gray-300 text-center">Roll Number & Date of Birth can only be changed by admin</p>
        </div>
      </div>

      <button id="save-profile" class="btn-primary btn-shimmer">✨ SAVE CHANGES</button>
    </div>
  `;

  // Bio character counter
  const bioInput = modal.body.querySelector('#edit-bio');
  const bioCount = modal.body.querySelector('#bio-count');
  bioInput?.addEventListener('input', () => {
    if (bioCount) bioCount.textContent = bioInput.value.length;
  });

  // Profile picture upload
  modal.body.querySelector('#pic-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showToast('Uploading photo...', 'info');
      const url = await authManager.updateProfilePic(file);
      showToast('Photo updated! 📸', 'success');
      const preview = modal.body.querySelector('#edit-pic-preview');
      if (preview?.tagName === 'IMG') {
        preview.src = url;
      } else if (preview) {
        preview.outerHTML = `<img src="${url}" class="w-20 h-20 rounded-full object-cover border-3 border-cream-300 shadow-md" alt="" id="edit-pic-preview"/>`;
      }
      const status = modal.body.querySelector('#pic-upload-status');
      if (status) status.classList.remove('hidden');
    } catch (err) { showToast('Upload failed', 'error'); }
  });

  // Cover photo upload
  modal.body.querySelector('#cover-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showToast('Uploading cover...', 'info');
      const { storageRef, uploadBytes, getDownloadURL, storage } = await import('../firebase-config.js');
      const path = `coverPhotos/${authManager.currentUser.uid}_${Date.now()}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      await authManager.updateProfile({ coverPhoto: url });
      showToast('Cover updated! 🖼️', 'success');
      const preview = modal.body.querySelector('#edit-cover-preview');
      if (preview?.tagName === 'IMG') {
        preview.src = url;
      } else {
        const area = modal.body.querySelector('#cover-preview-area');
        if (area) {
          const old = area.querySelector('#edit-cover-preview');
          if (old) old.outerHTML = `<img src="${url}" class="w-full h-full object-cover" id="edit-cover-preview" alt=""/>`;
        }
      }
    } catch (err) {
      console.error('Cover upload error:', err);
      showToast('Cover upload failed', 'error');
    }
  });

  // Theme color picker
  modal.body.querySelectorAll('.theme-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      modal.body.querySelectorAll('.theme-color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      modal.body.querySelector('#edit-theme-color').value = dot.dataset.color;
    });
  });

  // Save profile — only save user-editable fields
  modal.body.querySelector('#save-profile')?.addEventListener('click', async () => {
    const btn = modal.body.querySelector('#save-profile');
    btn.disabled = true;
    btn.innerHTML = '⏳ Saving...';
    try {
      const updates = {
        fullName: modal.body.querySelector('#edit-name')?.value.trim() || user.fullName,
        nickname: modal.body.querySelector('#edit-nickname')?.value.trim(),
        bio: modal.body.querySelector('#edit-bio')?.value.trim(),
        joinedYear: modal.body.querySelector('#edit-joined')?.value.trim(),
        endYear: modal.body.querySelector('#edit-end')?.value.trim()
      };
      const selectedTheme = modal.body.querySelector('#edit-theme-color')?.value;
      if (selectedTheme) updates.themeColor = selectedTheme;
      await authManager.updateProfile(updates);
      showToast('Profile updated! ✅', 'success');
      modal.close();
      router.navigate('profile', null);
    } catch (err) {
      console.error('Profile save error:', err);
      showToast('Failed to update', 'error');
      btn.disabled = false;
      btn.innerHTML = '✨ SAVE CHANGES';
    }
  });
}

function showEditSlamBookModal() {
  const user = authManager.userData || {};
  const sb = user.slamBook || {};
  const modal = router.openModal('', { title: '📖 Edit Slam Book' });
  const questions = [
    { key: 'favoriteMemory', label: 'Favorite school memory?', icon: '💭' },
    { key: 'firstImpression', label: 'First impression of school?', icon: '🏫' },
    { key: 'funniestMoment', label: 'Funniest classroom moment?', icon: '😂' },
    { key: 'bestFriend', label: 'Best friend in class?', icon: '👫' },
    { key: 'favoriteTeacher', label: 'Favorite teacher?', icon: '👨‍🏫' },
    { key: 'worstSubject', label: 'Most dreaded subject?', icon: '📚' },
    { key: 'secretCrush', label: 'School crush? 🙈', icon: '💝' },
    { key: 'afterSchoolDream', label: 'Dream after school?', icon: '🌟' }
  ];

  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      ${questions.map(q => `
        <div>
          <label class="text-xs font-semibold text-navy-600 mb-1 flex items-center gap-1">${q.icon} ${q.label}</label>
          <textarea id="sb-${q.key}" rows="2" placeholder="Your answer..." class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white resize-none font-handwriting text-base">${sanitizeHTML(sb[q.key] || '')}</textarea>
        </div>
      `).join('')}
      <button id="save-slambook" class="btn-primary">SAVE SLAM BOOK 📖</button>
    </div>
  `;

  modal.body.querySelector('#save-slambook')?.addEventListener('click', async () => {
    const data = {};
    questions.forEach(q => {
      data[q.key] = modal.body.querySelector(`#sb-${q.key}`)?.value.trim() || '';
    });
    try {
      await authManager.updateSlamBook(data);
      showToast('Slam book saved! 📖', 'success');
      modal.close();
    } catch (err) { showToast('Failed to save', 'error'); }
  });
}

function showChangePasswordModal() {
  const modal = router.openModal('', { title: '🔐 Change Password' });
  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1 block">Current Password</label>
        <input type="password" id="current-pass" placeholder="Enter current password" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white"/>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1 block">New Password</label>
        <input type="password" id="new-pass" placeholder="Enter new password (min 6 chars)" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white"/>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-1 block">Confirm New Password</label>
        <input type="password" id="confirm-pass" placeholder="Re-enter new password" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white"/>
      </div>
      <div id="pass-error" class="hidden text-xs text-red-500 bg-red-50 p-2 rounded-xl"></div>
      <button id="save-password" class="btn-primary">CHANGE PASSWORD 🔐</button>
    </div>
  `;

  modal.body.querySelector('#save-password')?.addEventListener('click', async () => {
    const current = modal.body.querySelector('#current-pass')?.value;
    const newPass = modal.body.querySelector('#new-pass')?.value;
    const confirm = modal.body.querySelector('#confirm-pass')?.value;
    const errEl = modal.body.querySelector('#pass-error');

    if (!current || !newPass || !confirm) { errEl.textContent = 'All fields are required'; errEl.classList.remove('hidden'); return; }
    if (newPass.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; errEl.classList.remove('hidden'); return; }
    if (newPass !== confirm) { errEl.textContent = 'Passwords do not match'; errEl.classList.remove('hidden'); return; }

    try {
      await authManager.changePassword(current, newPass);
      showToast('Password changed! 🔐', 'success');
      modal.close();
    } catch (err) {
      let msg = 'Failed to change password';
      if (err.code === 'auth/wrong-password') msg = 'Current password is incorrect';
      else if (err.code === 'auth/weak-password') msg = 'New password is too weak';
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  });
}

function showNotificationSettings() {
  const modal = router.openModal('', { title: '🔔 Notification Settings' });
  const prefs = authManager.userData?.notificationPrefs || {};
  modal.body.innerHTML = `
    <div class="p-4 space-y-3">
      ${[
        { key: 'likes', label: 'Likes on your posts', icon: '❤️', default: true },
        { key: 'comments', label: 'Comments on your posts', icon: '💬', default: true },
        { key: 'messages', label: 'New messages', icon: '✉️', default: true },
        { key: 'birthdays', label: 'Birthday reminders', icon: '🎂', default: true },
        { key: 'timeCapsules', label: 'Time capsule unlocks', icon: '🔓', default: true },
        { key: 'polls', label: 'New polls', icon: '📊', default: true },
        { key: 'diary', label: 'Diary entries', icon: '📖', default: false },
        { key: 'games', label: 'Game challenges', icon: '🎮', default: true }
      ].map(n => `
        <label class="flex items-center justify-between p-3 rounded-xl hover:bg-cream-50 cursor-pointer transition-colors">
          <div class="flex items-center gap-3">
            <span class="text-lg">${n.icon}</span>
            <span class="text-sm text-navy-800">${n.label}</span>
          </div>
          <input type="checkbox" class="toggle-switch notif-toggle" data-key="${n.key}" ${(prefs[n.key] !== undefined ? prefs[n.key] : n.default) ? 'checked' : ''}/>
        </label>
      `).join('')}
      <button id="save-notif-prefs" class="btn-primary mt-4">SAVE PREFERENCES</button>
    </div>
  `;

  modal.body.querySelector('#save-notif-prefs')?.addEventListener('click', async () => {
    const data = {};
    modal.body.querySelectorAll('.notif-toggle').forEach(cb => { data[cb.dataset.key] = cb.checked; });
    try {
      await authManager.updateProfile({ notificationPrefs: data });
      showToast('Notification preferences saved! 🔔', 'success');
      modal.close();
    } catch (e) { showToast('Failed to save', 'error'); }
  });
}

function showPrivacySettings() {
  const modal = router.openModal('', { title: '🛡️ Privacy Settings' });
  const priv = authManager.userData?.privacySettings || {};
  modal.body.innerHTML = `
    <div class="p-4 space-y-4">
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-2 block">Profile Visibility</label>
        <select id="priv-profile" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white">
          <option value="all" ${priv.profile === 'all' ? 'selected' : ''}>🌍 All Friends</option>
          <option value="close" ${priv.profile === 'close' ? 'selected' : ''}>👥 Close Friends Only</option>
        </select>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-2 block">Online Status</label>
        <label class="flex items-center justify-between p-3 rounded-xl bg-cream-50 cursor-pointer">
          <span class="text-sm text-navy-800">Show when I'm online</span>
          <input type="checkbox" class="toggle-switch" id="priv-online" ${priv.showOnline !== false ? 'checked' : ''}/>
        </label>
      </div>
      <div>
        <label class="text-xs font-semibold text-navy-600 mb-2 block">Slam Book Visibility</label>
        <select id="priv-slambook" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-500 bg-white">
          <option value="all" ${priv.slamBook === 'all' ? 'selected' : ''}>🌍 All Friends</option>
          <option value="close" ${priv.slamBook === 'close' ? 'selected' : ''}>👥 Close Friends Only</option>
          <option value="private" ${priv.slamBook === 'private' ? 'selected' : ''}>🔒 Only Me</option>
        </select>
      </div>
      <button id="save-privacy" class="btn-primary">SAVE PRIVACY SETTINGS</button>
    </div>
  `;

  modal.body.querySelector('#save-privacy')?.addEventListener('click', async () => {
    try {
      await authManager.updateProfile({
        privacySettings: {
          profile: modal.body.querySelector('#priv-profile')?.value || 'all',
          showOnline: modal.body.querySelector('#priv-online')?.checked ?? true,
          slamBook: modal.body.querySelector('#priv-slambook')?.value || 'all'
        }
      });
      showToast('Privacy settings saved! 🛡️', 'success');
      modal.close();
    } catch (e) { showToast('Failed to save', 'error'); }
  });
}

async function showSavedPosts() {
  const savedIds = authManager.userData?.savedPosts || [];
  if (savedIds.length === 0) {
    showToast('No saved posts yet', 'info');
    return;
  }

  const modal = router.openModal('', { title: '🔖 Saved Memories', fullscreen: true });
  modal.body.innerHTML = '<div class="p-4 text-center"><div class="skeleton w-full h-40"></div></div>';

  try {
    const posts = [];
    for (const id of savedIds.slice(0, 20)) {
      const snap = await getDoc(doc(db, 'posts', id));
      if (snap.exists()) posts.push({ id: snap.id, ...snap.data() });
    }

    if (posts.length === 0) {
      modal.body.innerHTML = '<div class="p-8 text-center"><div class="text-3xl mb-2">🔖</div><p class="text-sm text-gray-400">No saved posts found</p></div>';
      return;
    }

    modal.body.innerHTML = `
      <div class="profile-posts-grid p-2">
        ${posts.map(p => `
          <div class="profile-post-cell">
            ${p.imageUrl ? `<img src="${p.imageUrl}" class="w-full h-full object-cover" alt="" loading="lazy"/>` : `
              <div class="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-cream-200">
                <p class="text-xs text-gray-600 font-handwriting">${sanitizeHTML((p.caption || '').slice(0, 60))}</p>
                <p class="text-[10px] text-gray-400 mt-1">${sanitizeHTML(p.authorName || '')}</p>
              </div>
            `}
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    modal.body.innerHTML = '<div class="p-8 text-center text-sm text-gray-400">Failed to load saved posts</div>';
  }
}
