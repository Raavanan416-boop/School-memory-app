// Profile page — Instagram-style with cover photo, tabs, hidden settings menu
import { db, doc, getDoc, getDocs, collection, query, where, orderBy, addDoc, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, updateDoc, deleteDoc, rtdb, ref, onValue } from '../firebase-config.js';
import { uploadMedia } from '../services/cloudinary.js';
import { sanitizeHTML, formatNumber, timeAgo, showToast, EMOTIONAL_QUOTES, isDobPassword } from '../utils.js';
import { userCache } from '../services/userCache.js';
import { authManager } from '../auth.js';
import { router } from '../router.js';
import { createPostCard } from './home.js';
import { createNotification } from '../notifications.js';
import { presenceManager } from '../presence.js';

// Track active badge listener and presence listeners for cleanup
let unsubBadges = null;
let friendPresenceUnsubs = [];
let profilePresenceUnsub = null;
let unsubTagged = null;
let unsubSaved = null;
let unsubUserPosts = null;

function cleanupFriendPresence() {
  friendPresenceUnsubs.forEach(u => u());
  friendPresenceUnsubs = [];
}

export function destroyProfile() {
  if (unsubBadges) {
    unsubBadges();
    unsubBadges = null;
  }
  cleanupFriendPresence();
  if (profilePresenceUnsub) {
    profilePresenceUnsub();
    profilePresenceUnsub = null;
  }
  if (unsubUserPosts) {
    unsubUserPosts();
    unsubUserPosts = null;
  }
  
  // Also run tab cleanup on full destroy
  if (unsubTagged) { unsubTagged(); unsubTagged = null; }
  if (unsubSaved) { unsubSaved(); unsubSaved = null; }
  import('./slambook.js').then(m => m.destroySlamBook()).catch(() => {});
}

export async function renderProfile(container, data = null) {
  router.registerDestroy('profile', destroyProfile);
  destroyProfile();
  const viewingOther = data?.userId && data.userId !== authManager.currentUser?.uid;
  let user;

  if (viewingOther) {
    const cachedUser = userCache.getUser(data.userId);
    user = { id: data.userId, ...cachedUser };
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



  // Set up Realtime Sync for Profile Stats & Posts
  if (uid) {
    const qPosts = query(collection(db, 'posts'), where('authorId', '==', uid));
    unsubUserPosts = onSnapshot(qPosts, (snap) => {
      userPosts = [];
      totalLikes = 0;
      totalComments = 0;
      
      snap.forEach(d => {
        const p = d.data();
        if (p.isHidden && !authManager.isOwner) return;
        userPosts.push({ id: d.id, ...p });
        totalLikes += (p.likes?.length || 0);
        totalComments += (p.commentCount || 0);
      });
      
      userPosts.sort((a, b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now()) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now()));

      console.log(`Profile Posts Count: ${userPosts.length}`);
      console.log(`Profile Likes Count: ${totalLikes}`);
      console.log(`Profile Comments Count: ${totalComments}`);

      const postsEl = container.querySelector('#profile-stat-posts');
      if (postsEl) {
        postsEl.textContent = userPosts.length;
        container.querySelector('#profile-stat-likes').textContent = formatNumber(totalLikes);
        container.querySelector('#profile-stat-comments').textContent = formatNumber(totalComments);
        
        // Update badges
        const badges = [];
        if (userPosts.length >= 1) badges.push({ icon: '📸', name: 'Memory Maker' });
        if (userPosts.length >= 10) badges.push({ icon: '🌟', name: 'Prolific' });
        if (totalLikes >= 10) badges.push({ icon: '❤️', name: 'Beloved' });
        if (totalLikes >= 50) badges.push({ icon: '⭐', name: 'Star' });
        const badgesEl = container.querySelector('#profile-badges');
        if (badgesEl) {
          badgesEl.innerHTML = badges.map(b => `<span class="badge-chip">${b.icon} ${b.name}</span>`).join('') + 
            (user.endYear ? `<span class="badge-chip">🎓 Batch of ${sanitizeHTML(user.endYear)}</span>` : '');
        }

        // Re-render active tab if it relies on userPosts
        const activeTab = container.querySelector('.profile-tab.active')?.dataset.tab;
        const tabContent = container.querySelector('#tab-content');
        if (activeTab === 'posts') {
          renderPostsTab(tabContent, userPosts, viewingOther, user);
        }
      }
    }, (error) => {
      console.error('Realtime Stats Error:', error.message);
    });
  }

  // Count friends (all other users)
  friendCount = Math.max(0, userCache.users.size - 1);

  // Birthday check
  const isBirthday = (() => {
    if (!user.dateOfBirth) return false;
    const today = new Date();
    const dob = new Date(user.dateOfBirth);
    return dob.getMonth() === today.getMonth() && dob.getDate() === today.getDate();
  })();

  container.innerHTML = `
    <div class="min-h-screen overflow-y-auto overflow-x-hidden relative" style="background:var(--bg, #f5f0ea);">
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
      ? `<img src="${user.profilePic}" class="w-full h-full object-cover" alt="${sanitizeHTML(user.fullName || '')}" id="profile-pic-img" data-user-pic="${user.id}"/>`
      : `<div class="w-full h-full flex items-center justify-center text-white text-4xl font-bold" data-user-pic="${user.id}">${(user.fullName || '?')[0]}</div>`}
          </div>
          ${viewingOther ? `<div class="absolute bottom-1 right-1 w-5 h-5 rounded-full ${user.online ? 'bg-green-400' : 'bg-gray-300'} border-3 border-white" id="profile-online-dot"></div>` : ''}
          ${isBirthday ? '<div class="absolute -top-1 -right-1"><span class="birthday-badge">🎂</span></div>' : ''}
        </div>

        <!-- Name + Stats -->
        <div class="flex-1 pt-1">
          <h2 class="text-xl font-bold text-navy-800 leading-tight" data-user-name="${user.id}">${sanitizeHTML(user.fullName || 'Your Name')}</h2>
          ${user.nickname ? `<p class="font-handwriting text-base text-navy-400 italic mt-0.5">"${sanitizeHTML(user.nickname)}"</p>` : ''}

          <!-- Stats Row — Clickable, properly spaced -->
          <div class="profile-stats-row mt-3">
            <button class="profile-stat-btn" data-stat="posts">
              <span class="profile-stat-value" id="profile-stat-posts">${userPosts.length}</span>
              <span class="profile-stat-label">Posts</span>
            </button>
            <div class="profile-stat-divider"></div>
            <button class="profile-stat-btn" data-stat="likes">
              <span class="profile-stat-value" id="profile-stat-likes">${formatNumber(totalLikes)}</span>
              <span class="profile-stat-label">Likes</span>
            </button>
            <div class="profile-stat-divider"></div>
            <button class="profile-stat-btn" data-stat="comments">
              <span class="profile-stat-value" id="profile-stat-comments">${formatNumber(totalComments)}</span>
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
          <button class="miss-you-btn" id="miss-you-btn" data-uid="${data.userId}" data-name="${sanitizeHTML(user.fullName || '')}">
            <span class="miss-you-icon">❤️</span> Miss You
          </button>
        ` : `
          <button class="flex-1 py-2.5 bg-navy-500 text-white rounded-xl text-sm font-semibold hover:bg-navy-600 transition-colors active:scale-[0.98]" id="edit-profile-quick">Edit Profile</button>
        `}
      </div>

      <!-- Badges -->
      <div class="flex flex-wrap gap-2 mt-4 justify-center" id="profile-badges">
        ${userPosts.length >= 1 ? `<span class="badge-chip">📸 Memory Maker</span>` : ''}
        ${userPosts.length >= 10 ? `<span class="badge-chip">🌟 Prolific</span>` : ''}
        ${totalLikes >= 10 ? `<span class="badge-chip">❤️ Beloved</span>` : ''}
        ${totalLikes >= 50 ? `<span class="badge-chip">⭐ Star</span>` : ''}
        ${user.endYear ? `<span class="badge-chip">🎓 Batch of ${sanitizeHTML(user.endYear)}</span>` : ''}
      </div>

      <!-- Friend Suggested Badges -->
      <div id="suggested-badges-area" class="mt-3"></div>

      <!-- Suggest badge button (other profiles) -->
      ${viewingOther ? `
        <button id="suggest-badge-btn" class="mt-3 w-full py-2 text-xs font-semibold text-navy-500 border border-navy-200 rounded-xl hover:bg-navy-50 transition-colors">🏷 Suggest a Badge</button>
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

      ${!viewingOther ? `
      <button class="profile-tab" data-tab="saved">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/></svg>
        <span>Saved</span>
      </button>
      ` : ''}
    </div>

    <!-- Tab Content -->
    <div id="tab-content" class="pb-8"></div>

    <!-- Settings Menu (own profile only) -->
    ${!viewingOther ? `
      <button id="settings-menu-btn" class="profile-settings-btn" aria-label="Open settings">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/></svg>
      </button>
      <div id="settings-overlay" class="settings-overlay">
        <div class="settings-backdrop" id="settings-backdrop"></div>
        <div class="settings-drawer" id="settings-drawer">
          <div class="menu-page">
            <!-- Menu Header -->
            <div class="menu-header">
              <button id="settings-close-btn" class="menu-back-btn" aria-label="Close menu">
                <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
              </button>
              <h2 class="menu-header-title">Settings</h2>
              <div class="menu-header-spacer"></div>
            </div>

            <!-- Scrollable Menu Content -->
            <div class="menu-scroll-container">

              <!-- Profile Card -->
              <div class="menu-profile-card" id="menu-go-profile">
                <div class="menu-profile-avatar-wrap">
                  ${user.profilePic
        ? `<img src="${user.profilePic}" class="menu-profile-avatar" alt=""/>`
        : `<div class="menu-profile-avatar menu-profile-avatar-placeholder">${(user.fullName || '?')[0]}</div>`}
                  <span class="menu-profile-online-dot"></span>
                </div>
                <div class="menu-profile-info">
                  <p class="menu-profile-name">${sanitizeHTML(user.fullName || 'Your Name')}</p>
                  <p class="menu-profile-email">${user.email || ''}</p>
                </div>
                <svg class="menu-profile-arrow" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
              </div>

              <!-- 👤 Account Section -->
              <div class="menu-section">
                <div class="menu-section-label">👤 Account</div>
                <div class="menu-items-group">
                  <button class="menu-item" data-action="edit-profile">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#dbeafe,#eff6ff);">✏️</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Edit Profile</div>
                      <div class="menu-item-subtitle">Update your photo, name, bio</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                  <button class="menu-item" data-action="change-password">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#ede9fe,#f3e8ff);">🔒</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Change Password</div>
                      <div class="menu-item-subtitle">Update your login credentials</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                  <button class="menu-item" data-action="privacy-settings">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#c7d2fe,#e0e7ff);">🛡️</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Privacy</div>
                      <div class="menu-item-subtitle">Control who sees your content</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                  <button class="menu-item" data-action="close-friends">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#fce7f3,#fdf2f8);">💕</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Close Friends</div>
                      <div class="menu-item-subtitle">Manage your inner circle</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                  <button class="menu-item" data-action="saved-memories">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#fef3c7,#fef9c3);">🔖</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Saved Memories</div>
                      <div class="menu-item-subtitle">${(user.savedPosts?.length || 0)} saved items</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                </div>
              </div>

              <!-- 🎨 Appearance Section -->
              <div class="menu-section">
                <div class="menu-section-label">🎨 Appearance</div>
                <div class="menu-items-group">
                  <button class="menu-item" data-action="theme-settings">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#f3e8ff,#fce7f3);">🎨</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Theme Settings</div>
                      <div class="menu-item-subtitle">Dark mode, colors & style</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                </div>
              </div>

              <!-- 🔔 Notifications Section -->
              <div class="menu-section">
                <div class="menu-section-label">🔔 Notifications</div>
                <div class="menu-items-group">
                  <button class="menu-item" data-action="notification-settings">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#dcfce7,#bbf7d0);">🔔</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Push Notifications</div>
                      <div class="menu-item-subtitle">Manage alerts, sounds & badges</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                </div>
              </div>

              <!-- 🏆 Activity Section -->
              <div class="menu-section">
                <div class="menu-section-label">🏆 Activity</div>
                <div class="menu-items-group">
                  <button class="menu-item" data-action="leaderboard">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#fef9c3,#fde68a);">🏆</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Leaderboard</div>
                      <div class="menu-item-subtitle">See class rankings</div>
                    </div>
                    <svg class="menu-item-arrow" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                  </button>
                </div>
              </div>

              <!-- ⚙ App Section -->
              <div class="menu-section">
                <div class="menu-section-label">⚙ App</div>
                <div class="menu-items-group">
                  <button class="menu-item menu-danger" data-action="logout">
                    <div class="menu-item-icon" style="background:linear-gradient(135deg,#fee2e2,#fecaca);">🚪</div>
                    <div class="menu-item-text">
                      <div class="menu-item-title">Logout</div>
                      <div class="menu-item-subtitle">Sign out of your account</div>
                    </div>
                  </button>
                </div>
              </div>

              <!-- Footer -->
              <div class="menu-footer">
                <p class="menu-footer-text">ClassMemories v2.0</p>
                <p class="menu-footer-subtext">Made with ❤️ for our batch</p>
              </div>

            </div>
          </div>
        </div>
      </div>
    ` : ''}
    </div>
  `;

  // === TAB SYSTEM ===
  let activeTab = 'posts';
  const tabContent = container.querySelector('#tab-content');

  function cleanupTabListeners() {
    if (unsubTagged) { unsubTagged(); unsubTagged = null; }
    if (unsubSaved) { unsubSaved(); unsubSaved = null; }
    import('./slambook.js').then(m => m.destroySlamBook()).catch(() => {});
  }

  function renderTabContent(tab) {
    if (activeTab !== tab) {
      cleanupTabListeners();
    }
    activeTab = tab;
    container.querySelectorAll('.profile-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    // Smooth transition for tab content
    tabContent.classList.remove('animate-fadeIn');
    void tabContent.offsetWidth; // Trigger reflow
    tabContent.classList.add('animate-fadeIn');

    switch (tab) {
      case 'posts': renderPostsTab(tabContent, userPosts, viewingOther, user); break;
      case 'tagged': renderTaggedTab(tabContent, uid); break;
      case 'slambook': renderSlamBookTab(tabContent, user, viewingOther); break;

      case 'saved': renderSavedTab(tabContent, uid); break;
    }
  }

  container.querySelectorAll('.profile-tab').forEach(btn => {
    btn.addEventListener('click', () => renderTabContent(btn.dataset.tab));
  });

  renderTabContent('posts');

  // === SETTINGS DRAWER ===
  const settingsBtn = container.querySelector('#settings-menu-btn');
  const settingsOverlay = container.querySelector('#settings-overlay');
  const settingsBackdrop = container.querySelector('#settings-backdrop');
  const settingsDrawer = container.querySelector('#settings-drawer');
  const settingsCloseBtn = container.querySelector('#settings-close-btn');

  function openSettings() {
    // Use only CSS class for transitions - no 'hidden' class conflict
    requestAnimationFrame(() => {
      settingsOverlay?.classList.add('settings-active');
    });
    // Prevent body scroll while menu is open
    document.body.style.overflow = 'hidden';
  }

  function closeSettings() {
    settingsOverlay?.classList.remove('settings-active');
    document.body.style.overflow = '';
  }

  settingsBtn?.addEventListener('click', openSettings);
  settingsBackdrop?.addEventListener('click', closeSettings);
  settingsCloseBtn?.addEventListener('click', closeSettings);

  // Horizontal swipe-to-close gesture (swipe RIGHT to dismiss)
  let startX = 0;
  let isDragging = false;
  settingsDrawer?.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    isDragging = true;
    settingsDrawer.style.transition = 'none'; // disable CSS transition during drag
  }, { passive: true });

  settingsDrawer?.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const dx = e.touches[0].clientX - startX;
    if (dx > 0) {
      // Only allow dragging to the right (closing direction)
      settingsDrawer.style.transform = `translateX(${dx}px)`;
    }
  }, { passive: true });

  settingsDrawer?.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    isDragging = false;
    settingsDrawer.style.transition = ''; // restore CSS transition
    const dx = (e.changedTouches?.[0]?.clientX || 0) - startX;
    if (dx > 60) {
      // Swiped far enough — close
      closeSettings();
    }
    settingsDrawer.style.transform = '';
  });

  // Settings actions — works with both .settings-item and .menu-item
  container.querySelectorAll('.menu-item, .settings-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (!action) return;

      // Don't auto-close settings for logout if they are long-pressing it (we'll handle it)
      if (action !== 'logout') closeSettings();
      else if (!item.hasAttribute('data-long-pressing') && !item.hasAttribute('data-long-pressed')) closeSettings();

      setTimeout(() => {
        switch (action) {
          case 'edit-profile': showEditProfileModal(); break;
          case 'birthday-history': showBirthdayHistoryModal(uid); break;
          case 'change-password': showChangePasswordModal(); break;
          case 'saved-memories': showSavedPosts(); break;
          case 'leaderboard': router.navigate('leaderboard'); break;
          case 'notification-settings': showNotificationSettings(); break;
          case 'privacy-settings': showPrivacySettings(); break;
          case 'close-friends': showCloseFriendsModal(); break;
          case 'theme-settings': showThemePickerModal(); break;
          case 'logout':
            if (!item.hasAttribute('data-long-pressing') && !item.hasAttribute('data-long-pressed')) showLogoutConfirmation();
            setTimeout(() => item.removeAttribute('data-long-pressed'), 500);
            break;
        }
      }, 200);
    });
  });

  // ===== HIDDEN OWNER CONTROL TRIGGER =====
  const OWNER_EMAIL = 'kaviraj@school.com';
  const checkOwner = () => {
    return authManager.currentUser?.email === OWNER_EMAIL || authManager.isOwner;
  };

  // 3-second long press on Logout button opens secret code prompt
  const logoutBtn = container.querySelector('[data-action="logout"]');
  if (logoutBtn) {
    let pressTimer = null;
    const startPress = (e) => {
      if (!checkOwner()) return;
      console.log('Long Press Started');
      logoutBtn.setAttribute('data-long-pressing', 'true');
      pressTimer = setTimeout(() => {
        console.log('Long Press Success');
        console.log('Owner Validation Passed');
        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        logoutBtn.setAttribute('data-long-pressed', 'true');
        closeSettings();
        console.log('Popup Opened');
        showSecretCodePrompt();
      }, 3000);
    };
    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
        console.log('Long Press Cancelled');
      }
      setTimeout(() => logoutBtn.removeAttribute('data-long-pressing'), 100);
    };
    logoutBtn.addEventListener('mousedown', startPress);
    logoutBtn.addEventListener('mouseup', cancelPress);
    logoutBtn.addEventListener('mouseleave', cancelPress);
    logoutBtn.addEventListener('touchstart', startPress, { passive: true });
    logoutBtn.addEventListener('touchend', cancelPress);
    logoutBtn.addEventListener('touchcancel', cancelPress);
  }

  // Menu profile card → go to profile
  container.querySelector('#menu-go-profile')?.addEventListener('click', () => {
    closeSettings();
  });

  // Back button for other profiles
  container.querySelector('#back-profile-btn')?.addEventListener('click', () => router.navigateBack());

  // DM from profile — open chat with specific user
  container.querySelector('#dm-from-profile')?.addEventListener('click', (e) => {
    const targetUid = e.currentTarget.dataset.uid;
    const targetName = e.currentTarget.dataset.name;
    router.navigate('chat', { userId: targetUid, userName: targetName, fromProfile: true });
  });

  // Edit Profile quick button
  container.querySelector('#edit-profile-quick')?.addEventListener('click', () => {
    showEditProfileModal();
  });

  // Profile picture tap-to-view fullscreen OR Fallback trigger
  let profilePicTapCount = 0;
  let profilePicTapTimer = null;

  container.querySelector('#profile-pic-view')?.addEventListener('click', () => {
    // Fallback secret code logic
    if (checkOwner()) {
      profilePicTapCount++;
      if (profilePicTapCount >= 5) {
        console.log('Fallback Owner Validation Passed');
        profilePicTapCount = 0;
        document.querySelector('.profile-pic-fullscreen')?.remove(); // close if open
        console.log('Popup Opened via Fallback');
        showSecretCodePrompt();
        return;
      }
      clearTimeout(profilePicTapTimer);
      profilePicTapTimer = setTimeout(() => { profilePicTapCount = 0; }, 2000);
    }

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

  // Real-time presence watcher for other user profiles
  if (viewingOther && data?.userId) {
    if (profilePresenceUnsub) { profilePresenceUnsub(); profilePresenceUnsub = null; }
    presenceManager.watchUser(data.userId, (status) => {
      const dot = container.querySelector('#profile-online-dot');
      if (dot) {
        const isOnline = status.online || false;
        dot.className = `absolute bottom-1 right-1 w-5 h-5 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-300'} border-3 border-white`;
      }
    });
    profilePresenceUnsub = () => presenceManager.unwatchUser(data.userId);
  }

  // ===== MISS YOU BUTTON =====
  const missYouBtn = container.querySelector('#miss-you-btn');
  if (missYouBtn) {
    const targetUidMY = missYouBtn.dataset.uid;
    const targetNameMY = missYouBtn.dataset.name;

    missYouBtn.addEventListener('click', async () => {
      if (!authManager.currentUser) return;

      // Vibration feedback
      if (navigator.vibrate) navigator.vibrate(200);

      // Heart burst animation
      const burstContainer = document.createElement('div');
      burstContainer.className = 'miss-you-heart-burst';
      missYouBtn.appendChild(burstContainer);
      const hearts = ['❤️', '💕', '💗', '💖', '🥺', '💘', '✨', '💝'];
      for (let i = 0; i < 8; i++) {
        const heart = document.createElement('span');
        heart.className = 'miss-you-heart';
        heart.textContent = hearts[i % hearts.length];
        const angle = (i / 8) * Math.PI * 2;
        const dist = 40 + Math.random() * 40;
        heart.style.setProperty('--hx', `${Math.cos(angle) * dist}px`);
        heart.style.setProperty('--hy', `${Math.sin(angle) * dist - 30}px`);
        heart.style.setProperty('--hr', `${Math.random() * 360}deg`);
        heart.style.left = '50%';
        heart.style.top = '50%';
        burstContainer.appendChild(heart);
      }
      setTimeout(() => burstContainer.remove(), 1500);

      // Button pulse
      missYouBtn.classList.add('sending');
      setTimeout(() => missYouBtn.classList.remove('sending'), 600);

      // Send notification
      try {
        await createNotification('miss_you', targetUidMY, {
          message: `${authManager.userData?.fullName || 'Someone'} misses you ❤️`
        });

        showToast(`Miss you sent to ${targetNameMY} ❤️`, 'success');
      } catch (e) {
        console.error('Miss you error:', e);
        showToast('Could not send miss you', 'error');
      }
    });
  }
}

function showSecretCodePrompt() {
  const modal = router.openModal('', { title: 'System Verification' });
  modal.body.innerHTML = `
    <div class="p-6">
      <div class="text-center mb-6">
        <div class="w-16 h-16 mx-auto bg-gray-900 rounded-full flex items-center justify-center mb-3 border-2 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
          <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
        </div>
        <h3 class="text-lg font-bold text-gray-900">Owner Authorization</h3>
        <p class="text-xs text-gray-500 mt-1">Enter security code to proceed</p>
      </div>
      <div class="space-y-4">
        <input type="password" id="secret-code-input" class="w-full px-4 py-3 bg-gray-100 border border-gray-300 rounded-xl text-center tracking-[0.25em] text-gray-900 font-mono font-bold focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 transition-all" placeholder="••••••••" autocomplete="off"/>
        <button id="verify-secret-btn" class="w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-colors">VERIFY</button>
      </div>
    </div>
  `;

  const verifyBtn = modal.body.querySelector('#verify-secret-btn');
  const input = modal.body.querySelector('#secret-code-input');

  const verify = () => {
    const code = input.value.trim();
    if (code === 'K2FRIENDS') {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      showToast('Owner Verified. Initiating protocol...', 'success');
      modal.close();
      setTimeout(() => {
        router.navigate('owner');
      }, 500);
    } else {
      if (navigator.vibrate) navigator.vibrate(200);
      showToast('Access Denied', 'error');
      input.value = '';
      input.classList.add('border-red-500', 'bg-red-50');
      setTimeout(() => input.classList.remove('border-red-500', 'bg-red-50'), 500);
    }
  };

  verifyBtn.addEventListener('click', verify);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });
  setTimeout(() => input.focus(), 100);
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
    sessionStorage.removeItem("birthdayIntroShownThisLogin");
    sessionStorage.removeItem("playlistStartedThisLogin");
    localStorage.removeItem("birthdayIntroLastShown");
    if (window.animateLogout) {
      await window.animateLogout();
    }
    await authManager.logout();
    showToast('See you soon! 👋', 'info');
    
    // Remove the blur from app container in case user logs in again
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.style.filter = '';
      appContainer.style.opacity = '1';
    }
  });
}

// ===== STAT DETAIL MODALS =====
async function showStatDetailModal(type, userPosts, uid) {
  const titles = { posts: '📸 Posts', likes: '❤️ Likes Received', comments: '💬 Comments Received' };
  let modalUnsubs = [];
  const modal = router.openModal('', { 
    title: titles[type] || type,
    onClose: () => modalUnsubs.forEach(u => u())
  });

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
        ? `<img src="${p.imageUrl}" class="w-full h-full object-cover" alt="" />`
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
            const cachedUser = userCache.getUser(likerUid);
            const userObj = { id: likerUid, ...cachedUser };
            likeItems.push({ 
              name: userObj.fullName || 'Unknown', 
              postContent: post.content?.slice(0, 40) || 'a memory', 
              postId: post.id, 
              pic: userObj.profilePic || '' 
            });
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
    
    // We maintain a map of post ID to its comments to handle real-time updates smoothly
    const commentsMap = new Map();
    
    const renderComments = () => {
      let allComments = [];
      commentsMap.forEach(comments => {
        allComments.push(...comments);
      });
      // Sort by time descending
      allComments.sort((a, b) => b.timestamp - a.timestamp);
      
      if (allComments.length === 0) {
        modal.body.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">No comments yet</div>';
        return;
      }
      
      modal.body.innerHTML = `
        <div class="p-4 space-y-2">
          ${allComments.slice(0, 30).map(c => `
            <div class="stat-detail-item">
              <div class="stat-detail-avatar-placeholder" data-user-pic="${c.authorId}">${(c.authorName || '?')[0]}</div>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-navy-800"><span class="font-semibold" data-user-name="${c.authorId}">${sanitizeHTML(c.authorName)}</span> <span class="text-gray-400">on</span> "${sanitizeHTML(c.postContent)}..."</p>
                <p class="text-[11px] text-gray-400 truncate">"${sanitizeHTML(c.text)}" · ${c.time}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };

    for (const post of userPosts) {
      try {
        const q = query(collection(db, 'posts', post.id, 'comments'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
          const postComments = [];
          snap.forEach(cDoc => {
            const c = cDoc.data();
            postComments.push({ 
              authorName: c.authorName || 'Unknown', 
              authorId: c.authorId, 
              text: c.text?.slice(0, 50) || '', 
              postContent: post.content?.slice(0, 30) || 'a memory', 
              postId: post.id, 
              time: c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : '',
              timestamp: c.createdAt?.toMillis ? c.createdAt.toMillis() : Date.now()
            });
          });
          commentsMap.set(post.id, postComments);
          renderComments();
        });
        modalUnsubs.push(unsub);
      } catch { /* skip */ }
    }
  }
}

// ===== FRIENDS LIST MODAL =====
async function showFriendsListModal(uid) {
  const modal = router.openModal('', { title: '👥 Friends' });
  modal.body.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">Loading friends...</div>';

  try {
    const allUsers = userCache.getAllUsers();
    const friends = [];
    allUsers.forEach(u => {
      if (u.id !== uid) {
        friends.push(u);
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
              <div class="friend-online-dot ${f.online ? 'online' : ''}" id="friend-dot-${f.id}"></div>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-navy-800 truncate">${sanitizeHTML(f.fullName || 'Unknown')}</p>
              <p class="text-[11px] text-gray-400" id="friend-status-${f.id}">${f.rollNumber || ''} · ${f.online ? '🟢 Online' : 'Offline'}</p>
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

    // Real-time presence watchers for each friend
    cleanupFriendPresence();
    friends.forEach(f => {
      presenceManager.watchUser(f.id, (status) => {
        const dot = modal.body.querySelector(`#friend-dot-${f.id}`);
        const statusEl = modal.body.querySelector(`#friend-status-${f.id}`);
        if (dot) dot.classList.toggle('online', status.online);
        if (statusEl) {
          statusEl.textContent = `${f.rollNumber || ''} · ${status.online ? '🟢 Online' : presenceManager.getLastSeenText(status)}`;
        }
      });
      friendPresenceUnsubs.push(() => presenceManager.unwatchUser(f.id));
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

    const allUsers = userCache.getAllUsers();
    allUsers.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

    modal.body.innerHTML = `
      <div class="p-4">
        <p class="text-xs text-gray-400 mb-4">Select close friends to share private memories and diary entries.</p>
        <div class="space-y-2" id="close-friends-list">
          ${allUsers.filter(u => u.id !== authManager.currentUser.uid).map(u => {
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
          <div class="flex-shrink-0 snap-start cursor-pointer profile-post-clickable" data-post-id="${p.id}" style="width: 44%;">
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
            <div class="profile-post-cell cursor-pointer profile-post-clickable" data-post-id="${p.id}">
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

  // Post click handler
  el.querySelectorAll('.profile-post-clickable').forEach(item => {
    item.addEventListener('click', () => {
      const pid = item.dataset.postId;
      const post = posts.find(p => p.id === pid);
      if (post) showPostModal(post);
    });
  });
}

export function showPostModal(post) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[100] modal-sheet-container modal-sheet-overlay flex flex-col justify-end';
  overlay.innerHTML = `
    <div class="modal-backdrop absolute inset-0 cursor-pointer bg-black/40 backdrop-blur-sm"></div>
    <div class="bg-white w-full max-w-lg mx-auto rounded-t-3xl shadow-2xl relative flex flex-col" style="height: 90vh;">
      <div class="sheet-handle mt-3 mx-auto"></div>
      <div class="flex-1 overflow-y-auto pb-6 pt-2" id="modal-post-container">
        <!-- Post injected here -->
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  router.modalStack.push(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-active'));

  const close = () => {
    overlay.classList.remove('modal-active');
    overlay.classList.add('modal-closing');
    setTimeout(() => overlay.remove(), 300);
    router.modalStack = router.modalStack.filter(m => m !== overlay);
  };
  overlay.querySelector('.modal-backdrop').addEventListener('click', close);
  
  const container = overlay.querySelector('#modal-post-container');
  // Re-use home feed post card
  container.appendChild(createPostCard(post));
}

function renderTaggedTab(el, targetUid) {
  if (!targetUid) {
    el.innerHTML = '<div class="px-4 py-12 text-center text-gray-500">User not found</div>';
    return;
  }

  if (unsubTagged) {
    unsubTagged();
    unsubTagged = null;
  }

  el.innerHTML = `
    <div class="px-4 py-12 text-center" id="tagged-loading">
      <div class="w-8 h-8 border-4 border-navy-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-sm text-gray-400">Loading tagged memories...</p>
    </div>
  `;

  const q = query(
    collection(db, 'users', targetUid, 'taggedPosts'),
    orderBy('taggedAt', 'desc')
  );

  let innerUnsubs = [];
  const mainUnsub = onSnapshot(q, (snap) => {
    // Clean up old post listeners
    innerUnsubs.forEach(u => u());
    innerUnsubs = [];

    if (snap.empty) {
      el.innerHTML = `
        <div class="px-4 py-12 text-center">
          <div class="text-4xl mb-3">🏷️</div>
          <h3 class="font-semibold text-navy-700 mb-1">No tagged memories</h3>
          <p class="text-sm text-gray-400">When accepted, tagged memories will appear here.</p>
        </div>`;
      return;
    }

    const postsMap = new Map();
    
    const renderPosts = () => {
      const posts = Array.from(postsMap.values()).filter(p => p !== null);
      // Sort to preserve order from the outer snapshot
      posts.sort((a, b) => {
        const indexA = snap.docs.findIndex(d => d.id === a.id);
        const indexB = snap.docs.findIndex(d => d.id === b.id);
        return indexA - indexB;
      });

      if (posts.length === 0 && postsMap.size === snap.docs.length) {
        el.innerHTML = `
          <div class="px-4 py-12 text-center">
            <div class="text-4xl mb-3">🏷️</div>
            <h3 class="font-semibold text-navy-700 mb-1">No tagged memories</h3>
            <p class="text-sm text-gray-400">When accepted, tagged memories will appear here.</p>
          </div>`;
        return;
      }

      el.innerHTML = `
        <div class="px-4 pt-4 pb-20">
          <div class="grid grid-cols-2 gap-3">
            ${posts.map(p => `
              <div class="profile-post-clickable cursor-pointer flex flex-col bg-white rounded-2xl border border-gray-50 shadow-sm overflow-hidden" data-post-id="${p.id}">
                <div class="aspect-[4/3] bg-cream-100 relative shrink-0">
                  ${(p.imageUrls && p.imageUrls.length > 0) || p.imageUrl
            ? `<img src="${(p.imageUrls && p.imageUrls.length > 0) ? p.imageUrls[0] : p.imageUrl}" class="w-full h-full object-cover" alt="" loading="lazy"/>`
            : `<div class="w-full h-full bg-gradient-to-br from-cream-200 to-cream-300 flex flex-col items-center justify-center p-2"><span class="text-2xl mb-1">📝</span></div>`}
                </div>
                <div class="p-2.5 flex flex-col flex-grow">
                  <p class="text-xs font-semibold text-navy-800 line-clamp-2 mb-auto">${sanitizeHTML(p.caption || 'Untitled')}</p>
                  <div class="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50">
                    <p class="text-[10px] text-gray-400">${(p.createdAt?.toDate ? p.createdAt.toDate() : new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    <span class="flex items-center gap-0.5 text-[10px] text-gray-400">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>
                      ${p.likes?.length || 0}
                    </span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;

      // Add click handlers
      el.querySelectorAll('.profile-post-clickable').forEach(item => {
        item.addEventListener('click', () => {
          const pid = item.dataset.postId;
          const post = posts.find(p => p.id === pid);
          if (post) showPostModal(post);
        });
      });
    };

    snap.docs.forEach(d => {
      const postId = d.id;
      const u = onSnapshot(doc(db, 'posts', postId), (postSnap) => {
        if (postSnap.exists()) {
          const p = postSnap.data();
          if (p.isHidden && !authManager.isOwner) {
            postsMap.set(postId, null);
          } else {
            postsMap.set(postId, { id: postSnap.id, ...p });
          }
        } else {
          postsMap.set(postId, null);
        }
        renderPosts();
      });
      innerUnsubs.push(u);
    });
  }, (err) => {
    console.error('Tagged posts error:', err);
    el.innerHTML = '<div class="px-4 py-12 text-center text-red-500 text-sm">Failed to load tagged memories</div>';
  });

  unsubTagged = () => {
    mainUnsub();
    innerUnsubs.forEach(u => u());
  };
}

function renderSavedTab(el, targetUid) {
  if (!targetUid) return;
  
  el.innerHTML = `
    <div class="px-4 py-12 text-center" id="saved-loading">
      <div class="w-8 h-8 border-4 border-navy-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-sm text-gray-400">Loading saved memories...</p>
    </div>
  `;

  if (unsubSaved) {
    unsubSaved();
    unsubSaved = null;
  }

  const q = query(
    collection(db, 'users', targetUid, 'savedPosts'),
    orderBy('savedAt', 'desc')
  );

  let innerUnsubs = [];
  const mainUnsub = onSnapshot(q, (snap) => {
    innerUnsubs.forEach(u => u());
    innerUnsubs = [];

    if (snap.empty) {
      el.innerHTML = `
        <div class="px-4 py-12 text-center">
          <div class="text-4xl mb-3">🔖</div>
          <h3 class="font-semibold text-navy-700 mb-1">No saved memories</h3>
          <p class="text-sm text-gray-400">Posts you save will appear here.</p>
        </div>`;
      return;
    }

    // Sort locally by savedAt desc
    const sortedDocs = snap.docs.sort((a, b) => {
      const aTime = a.data().savedAt?.toMillis() || 0;
      const bTime = b.data().savedAt?.toMillis() || 0;
      return bTime - aTime;
    });

    const postsMap = new Map();

    const renderPosts = () => {
      const posts = Array.from(postsMap.values()).filter(p => p !== null);
      // Keep sorted by original array
      posts.sort((a, b) => {
        const indexA = sortedDocs.findIndex(d => (d.data().postId || d.id) === a.id);
        const indexB = sortedDocs.findIndex(d => (d.data().postId || d.id) === b.id);
        return indexA - indexB;
      });

      if (posts.length === 0 && postsMap.size === sortedDocs.length) {
        el.innerHTML = `
          <div class="px-4 py-12 text-center">
            <div class="text-4xl mb-3">🔖</div>
            <h3 class="font-semibold text-navy-700 mb-1">No saved memories</h3>
            <p class="text-sm text-gray-400">Posts you save will appear here.</p>
          </div>`;
        return;
      }

      el.innerHTML = `
        <div class="px-4 pt-4 pb-20">
          <div class="grid grid-cols-2 gap-3">
            ${posts.map(p => `
              <div class="profile-post-clickable cursor-pointer flex flex-col bg-white rounded-2xl border border-gray-50 shadow-sm overflow-hidden" data-post-id="${p.id}">
                <div class="aspect-[4/3] bg-cream-100 relative shrink-0">
                  ${(p.imageUrls && p.imageUrls.length > 0) || p.imageUrl
            ? `<img src="${(p.imageUrls && p.imageUrls.length > 0) ? p.imageUrls[0] : p.imageUrl}" class="w-full h-full object-cover" alt="" loading="lazy"/>`
            : `<div class="w-full h-full bg-gradient-to-br from-cream-200 to-cream-300 flex flex-col items-center justify-center p-2"><span class="text-2xl mb-1">📝</span></div>`}
                </div>
                <div class="p-2.5 flex flex-col flex-grow">
                  <p class="text-xs font-semibold text-navy-800 line-clamp-2 mb-auto">${sanitizeHTML(p.caption || 'Untitled')}</p>
                  <div class="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50">
                    <p class="text-[10px] text-gray-400">${(p.createdAt?.toDate ? p.createdAt.toDate() : new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    <span class="flex items-center gap-0.5 text-[10px] text-gray-400">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>
                      ${p.likes?.length || 0}
                    </span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;

      // Add click handlers
      el.querySelectorAll('.profile-post-clickable').forEach(item => {
        item.addEventListener('click', () => {
          const pid = item.dataset.postId;
          const post = posts.find(p => p.id === pid);
          if (post) showPostModal(post);
        });
      });
    };

    sortedDocs.forEach(d => {
      const postId = d.data().postId || d.id;
      const u = onSnapshot(doc(db, 'posts', postId), (postSnap) => {
        if (postSnap.exists()) {
          const p = postSnap.data();
          if (p.isHidden && !authManager.isOwner) {
            postsMap.set(postId, null);
          } else {
            postsMap.set(postId, { id: postSnap.id, ...p });
          }
        } else {
          postsMap.set(postId, null);
        }
        renderPosts();
      });
      innerUnsubs.push(u);
    });
  }, (err) => {
    console.error('Saved posts error:', err);
    el.innerHTML = '<div class="px-4 py-12 text-center text-red-500 text-sm">Failed to load saved memories</div>';
  });

  unsubSaved = () => {
    mainUnsub();
    innerUnsubs.forEach(u => u());
  };
}

async function renderSlamBookTab(el, user, viewingOther) {
  const { renderSlamBookTab: newRenderSlamBookTab } = await import('./slambook.js');
  await newRenderSlamBookTab(el, user, viewingOther);
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

      <!-- Date of Birth — Set Once, Then Locked -->
      <div class="pt-2">
        <p class="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mb-3">🎂 Date of Birth</p>
        <div class="space-y-2">
          ${user.dateOfBirth ? `
            <div class="flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
              <span class="text-lg">🔒</span>
              <div class="flex-1">
                <p class="text-sm font-semibold text-navy-800">${user.dateOfBirth}</p>
                <p class="text-[10px] text-gray-400">Date of Birth is permanently set</p>
              </div>
            </div>
          ` : `
            <div>
              <label class="text-xs font-semibold text-navy-600 mb-1 block">Set your Date of Birth (one-time only)</label>
              <input type="date" id="edit-dob" class="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-navy-800 focus:outline-none focus:border-navy-400 bg-white"/>
              <p class="text-[10px] text-amber-500 mt-1">⚠️ This cannot be changed once saved</p>
            </div>
          `}
        </div>
      </div>

      <!-- Roll Number (read-only for users) -->
      <div class="pt-2">
        <div class="space-y-3">
          <div>
            <label class="text-xs font-semibold text-gray-400 mb-1 block">Roll Number</label>
            <input type="text" value="${sanitizeHTML(user.rollNumber || 'Not set')}" disabled class="w-full px-4 py-2.5 border border-gray-100 rounded-xl text-sm text-gray-400 bg-gray-50 cursor-not-allowed"/>
          </div>
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

  // Profile picture upload with Cropper.js
  modal.body.querySelector('#pic-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Read file as Data URL for the cropper
    const reader = new FileReader();
    reader.onload = (event) => {
      const imgDataUrl = event.target.result;
      
      const cropperModal = router.openModal('', { title: 'Crop Profile Photo' });
      cropperModal.body.innerHTML = `
        <div class="p-4 flex flex-col items-center">
          <div class="w-full max-w-sm h-64 bg-gray-100 rounded-xl overflow-hidden mb-4 relative">
            <img id="cropper-image" src="${imgDataUrl}" class="max-w-full block" />
          </div>
          <div class="flex gap-3 mb-4 w-full">
            <button id="crop-zoom-in" class="flex-1 py-2 bg-cream-100 text-navy-800 rounded-xl font-bold hover:bg-cream-200">🔍+</button>
            <button id="crop-zoom-out" class="flex-1 py-2 bg-cream-100 text-navy-800 rounded-xl font-bold hover:bg-cream-200">🔍-</button>
            <button id="crop-rotate-left" class="flex-1 py-2 bg-cream-100 text-navy-800 rounded-xl font-bold hover:bg-cream-200">↺</button>
            <button id="crop-rotate-right" class="flex-1 py-2 bg-cream-100 text-navy-800 rounded-xl font-bold hover:bg-cream-200">↻</button>
          </div>
          <button id="crop-confirm" class="w-full py-3 bg-navy-500 text-white rounded-xl font-bold hover:bg-navy-600 transition-colors">Confirm & Upload</button>
        </div>
      `;

      const image = cropperModal.body.querySelector('#cropper-image');
      const cropper = new Cropper(image, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        restore: false,
        guides: false,
        center: false,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
      });

      cropperModal.body.querySelector('#crop-zoom-in').addEventListener('click', () => cropper.zoom(0.1));
      cropperModal.body.querySelector('#crop-zoom-out').addEventListener('click', () => cropper.zoom(-0.1));
      cropperModal.body.querySelector('#crop-rotate-left').addEventListener('click', () => cropper.rotate(-90));
      cropperModal.body.querySelector('#crop-rotate-right').addEventListener('click', () => cropper.rotate(90));

      cropperModal.body.querySelector('#crop-confirm').addEventListener('click', () => {
        const confirmBtn = cropperModal.body.querySelector('#crop-confirm');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Uploading...';

        cropper.getCroppedCanvas({
          width: 500,
          height: 500,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
        }).toBlob(async (blob) => {
          if (!blob) {
            showToast('Failed to crop image', 'error');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm & Upload';
            return;
          }
          try {
            showToast('Uploading photo...', 'info');
            // Create a File object from the blob so uploadMedia/updateProfilePic accepts it natively if it needs a name
            const croppedFile = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
            const url = await authManager.updateProfilePic(croppedFile);
            showToast('Photo updated! 📸', 'success');
            
            const preview = modal.body.querySelector('#edit-pic-preview');
            if (preview?.tagName === 'IMG') {
              preview.src = url;
            } else if (preview) {
              preview.outerHTML = `<img src="${url}" class="w-20 h-20 rounded-full object-cover border-3 border-cream-300 shadow-md" alt="" id="edit-pic-preview"/>`;
            }
            const status = modal.body.querySelector('#pic-upload-status');
            if (status) status.classList.remove('hidden');
            cropperModal.close();
          } catch (err) {
            console.error('Cropper upload error', err);
            showToast('Upload failed', 'error');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm & Upload';
          }
        }, 'image/jpeg', 0.8); // 0.8 compression quality
      });
    };
    reader.readAsDataURL(file);
    // Reset input so selecting the same file again triggers change event
    e.target.value = '';
  });

  // Cover photo upload
  modal.body.querySelector('#cover-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showToast('Uploading cover...', 'info');
      const res = await uploadMedia(file, 'image');
      const url = res.url;
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
      // DOB: only save if not already set and user entered one
      const dobInput = modal.body.querySelector('#edit-dob');
      if (dobInput && dobInput.value && !user.dateOfBirth) {
        updates.dateOfBirth = dobInput.value;
      }
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

    const dob = authManager.userData?.dateOfBirth;
    if (dob && isDobPassword(newPass, dob)) {
      errEl.textContent = '❌ Your password cannot be your Date of Birth. Please choose a stronger password.';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      await authManager.changePassword(current, newPass);
      showToast('Password changed! 🔐', 'success');
      modal.close();
    } catch (err) {
      let msg = err.message || 'Failed to change password';
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

  let modalUnsubs = [];
  const modal = router.openModal('', { 
    title: '🔖 Saved Memories', 
    fullscreen: true,
    onClose: () => modalUnsubs.forEach(u => u())
  });
  
  modal.body.innerHTML = '<div class="p-4 text-center"><div class="skeleton w-full h-40"></div></div>';

  try {
    const postsMap = new Map();
    
    const renderPosts = () => {
      const posts = Array.from(postsMap.values()).filter(p => p !== null);
      // Sort by the order in savedIds
      posts.sort((a, b) => savedIds.indexOf(a.id) - savedIds.indexOf(b.id));
      
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
                  <p class="text-[10px] text-gray-400 mt-1" data-user-name="${p.authorId}">${sanitizeHTML(p.authorName || '')}</p>
                </div>
              `}
            </div>
          `).join('')}
        </div>
      `;
    };

    for (const id of savedIds.slice(0, 20)) {
      const u = onSnapshot(doc(db, 'posts', id), (snap) => {
        if (snap.exists()) {
          postsMap.set(id, { id: snap.id, ...snap.data() });
        } else {
          postsMap.set(id, null);
        }
        renderPosts();
      });
      modalUnsubs.push(u);
    }
  } catch (e) {
    modal.body.innerHTML = '<div class="p-8 text-center text-sm text-gray-400">Failed to load saved posts</div>';
  }
}

// ===== THEME PICKER MODAL =====
function showThemePickerModal() {
  const THEMES = [
    { id: 'theme-cream', name: 'Classic Cream', icon: '☀️', colors: ['#fdf6e3', '#1e3a5f', '#d4a574'], desc: 'Default warm nostalgic' },
    { id: 'theme-dark', name: 'Dark Mode', icon: '🌙', colors: ['#0f172a', '#e2e8f0', '#3b82f6'], desc: 'Easy on the eyes' },
    { id: 'theme-ocean', name: 'Ocean Blue', icon: '🌊', colors: ['#0c4a6e', '#e0f2fe', '#38bdf8'], desc: 'Deep sea vibes' },
    { id: 'theme-rose', name: 'Rose Gold', icon: '🌹', colors: ['#fdf2f8', '#831843', '#f472b6'], desc: 'Elegant and warm' },
    { id: 'theme-forest', name: 'Forest Green', icon: '🌲', colors: ['#f0fdf4', '#14532d', '#4ade80'], desc: 'Nature inspired' },
    { id: 'theme-midnight', name: 'Midnight Purple', icon: '🔮', colors: ['#1e1b4b', '#e0e7ff', '#a78bfa'], desc: 'Mystical night' }
  ];

  const currentTheme = localStorage.getItem('app_theme') || 'theme-cream';
  const modal = router.openModal('', { title: '🎨 Choose Theme' });
  modal.body.innerHTML = `
    <div class="p-4 space-y-3">
      <p class="text-xs text-gray-400 text-center mb-2">Theme applies instantly across the entire app</p>
      ${THEMES.map(t => `
        <button class="theme-option-card ${currentTheme === t.id ? 'theme-option-active' : ''}" data-theme="${t.id}">
          <div class="flex items-center gap-3 w-full">
            <div class="flex gap-1">
              ${t.colors.map(c => `<div class="w-5 h-5 rounded-full border border-white/30" style="background:${c}"></div>`).join('')}
            </div>
            <div class="flex-1 text-left">
              <p class="text-sm font-semibold">${t.icon} ${t.name}</p>
              <p class="text-[10px] text-gray-400">${t.desc}</p>
            </div>
            ${currentTheme === t.id ? '<span class="text-green-500 text-xs font-bold">✓ Active</span>' : ''}
          </div>
        </button>
      `).join('')}
    </div>
  `;

  modal.body.querySelectorAll('.theme-option-card').forEach(card => {
    card.addEventListener('click', () => {
      const themeId = card.dataset.theme;
      // Apply theme instantly
      document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
      if (themeId !== 'theme-cream') {
        document.body.classList.add(themeId);
      }
      localStorage.setItem('app_theme', themeId);

      // Update active state in modal
      modal.body.querySelectorAll('.theme-option-card').forEach(c => c.classList.remove('theme-option-active'));
      card.classList.add('theme-option-active');

      showToast(`${THEMES.find(t => t.id === themeId)?.name} theme applied! 🎨`, 'success');

      // Save to Firebase (optional, for cross-device sync)
      try {
        authManager.updateProfile({ theme: themeId });
      } catch (e) { /* non-critical */ }
    });
  });
}

// ===== BIRTHDAY WISH HISTORY =====
function showBirthdayHistoryModal(userId) {
  let modalUnsubs = [];
  const modal = router.openModal('', { 
    title: '🎂 Birthday Wish History',
    onClose: () => modalUnsubs.forEach(u => u())
  });
  
  modal.body.innerHTML = `
    <div class="p-4 bg-gray-50 min-h-[50vh]">
      <div class="text-center mb-6">
        <div class="text-4xl mb-2">🕰️</div>
        <h3 class="text-lg font-bold text-navy-800">Past Birthdays</h3>
        <p class="text-sm text-gray-500">Archived birthday conversations</p>
      </div>
      
      <div id="history-list-container" class="space-y-4">
        <div class="flex justify-center py-8">
          <div class="w-6 h-6 border-2 border-navy-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    </div>
  `;
  
  const listContainer = modal.body.querySelector('#history-list-container');
  const uid = userId || authManager.currentUser?.uid;
  
  // Fetch history records
  const q = query(collection(db, 'birthdayWishHistory'), where('userId', '==', uid));
  const unsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listContainer.innerHTML = `
        <div class="text-center py-8">
          <div class="text-3xl mb-2">📭</div>
          <p class="text-sm font-medium text-navy-700">No Birthday Wish History Yet.</p>
          <p class="text-xs text-gray-400 mt-1">Archived birthdays will appear here.</p>
        </div>
      `;
      return;
    }
    
    const records = [];
    snap.forEach(d => records.push({ id: d.id, ...d.data() }));
    
    // Sort descending by year
    records.sort((a, b) => (b.year || 0) - (a.year || 0));
    
    listContainer.innerHTML = records.map((rec, i) => `
      <div class="card p-5 bg-white border border-pink-100 hover:border-pink-200 transition-all shadow-sm" style="animation: fadeUp 0.3s ease-out ${i * 0.1}s both;">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-bold text-navy-800 text-lg">🎂 ${rec.year} Birthday</h4>
          <span class="text-[10px] text-gray-400 font-semibold uppercase bg-gray-100 px-2 py-0.5 rounded-full">Archive</span>
        </div>
        
        <div class="flex items-center gap-4 mb-4 text-sm font-medium text-navy-700">
          <div class="flex items-center gap-1">
            <span class="text-pink-500">💌</span>
            <span>${rec.wishesCount || 0} Wishes</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-blue-500">💬</span>
            <span>${rec.repliesCount || 0} Replies</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-red-500">❤️</span>
            <span>${rec.reactionsCount || 0} Reactions</span>
          </div>
        </div>
        
        <button class="w-full py-2 bg-pink-50 text-pink-600 rounded-xl text-sm font-bold hover:bg-pink-100 transition-colors view-history-btn" data-year="${rec.year}">
          View Conversation
        </button>
      </div>
    `).join('');
    
    listContainer.querySelectorAll('.view-history-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const year = btn.dataset.year;
        modal.close();
        try {
          const birthdayModule = await import('./birthday.js');
          const userName = document.querySelector('[data-user-name]')?.textContent || 'User';
          if (birthdayModule.showViewWishesModal) {
            birthdayModule.showViewWishesModal(uid, userName, true, year);
          } else {
            showToast('Unable to open history viewer', 'error');
          }
        } catch (e) {
          console.error(e);
          showToast('Failed to load viewer', 'error');
        }
      });
    });
    
  }, (err) => {
    console.error('Fetch history error:', err);
    listContainer.innerHTML = `<div class="text-center py-6 text-red-400 text-sm">Failed to load history</div>`;
  });
  modalUnsubs.push(unsub);
}
