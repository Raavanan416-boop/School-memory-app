// Notifications page — Premium notification center with grouping, delete, and deep links
// Enhanced: All/Unread tabs, sender profile pics, notification grouping
import { db, collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, deleteDoc, arrayUnion, arrayRemove, setDoc, serverTimestamp, getDoc, addDoc } from '../firebase-config.js';
import { timeAgo, sanitizeHTML } from '../utils.js';
import { authManager } from '../auth.js';
import { notificationManager } from '../notifications.js';
import { router } from '../router.js';
import { userCache } from '../services/userCache.js';

let unsubNotifs = null;
let currentFilter = 'all'; // 'all' or 'unread'

export function destroyNotifications() {
  if (unsubNotifs) {
    unsubNotifs();
    unsubNotifs = null;
  }
}

export async function renderNotifications(container) {
  router.registerDestroy('notifications', destroyNotifications);
  destroyNotifications();
  if (unsubNotifs) unsubNotifs();

  container.innerHTML = `
    <section class="px-4 pt-4 pb-32 min-h-screen overflow-y-auto">
      <div class="flex items-center gap-3 mb-4">
        <button id="notif-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">Notifications</h2>
        <div class="flex items-center gap-2">
          <button id="mark-all-read" class="text-xs text-navy-500 font-semibold hover:underline px-2 py-1 rounded-lg hover:bg-cream-100 transition-colors">Mark all read</button>
          <div class="relative">
            <button id="notif-menu-btn" class="p-1.5 rounded-full hover:bg-cream-100 transition-colors">
              <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
            </button>
            <div id="notif-menu-dropdown" class="hidden absolute right-0 top-9 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[160px] z-20">
              <button id="open-diagnostics" class="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-navy-600 hover:bg-navy-50 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.054-2.066.01M15.84 10.34c.06-.688.054-1.386-.01-2.066m0 0l-1.586-1.586a1.5 1.5 0 00-2.121 0l-4.243 4.243a1.5 1.5 0 000 2.121l1.586 1.586m4.243-4.243l4.243 4.243a1.5 1.5 0 010 2.121l-1.586 1.586a1.5 1.5 0 01-2.121 0l-4.243-4.243"/></svg>
                Push Diagnostics
              </button>
              <button id="delete-all-notifs" class="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
                Delete All
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- All / Unread Filter Tabs -->
      <div class="notif-tab-bar mb-4">
        <button class="notif-tab active" data-filter="all">All</button>
        <button class="notif-tab" data-filter="unread">Unread</button>
      </div>

      <!-- Unread count banner -->
      <div id="unread-banner" class="hidden mb-4 px-4 py-2.5 rounded-xl bg-gradient-to-r from-navy-500/10 to-navy-500/5 border border-navy-200/30">
        <p class="text-sm font-semibold text-navy-700"><span id="unread-count-text">0</span> unread notifications</p>
      </div>

      <div id="notifs-container" class="space-y-1"></div>
    </section>

    <!-- Diagnostics Modal -->
    <div id="diagnostics-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div class="p-4 border-b border-gray-100 flex justify-between items-center">
          <h3 class="font-bold text-navy-800 flex items-center gap-2">
            <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.054-2.066.01M15.84 10.34c.06-.688.054-1.386-.01-2.066m0 0l-1.586-1.586a1.5 1.5 0 00-2.121 0l-4.243 4.243a1.5 1.5 0 000 2.121l1.586 1.586m4.243-4.243l4.243 4.243a1.5 1.5 0 010 2.121l-1.586 1.586a1.5 1.5 0 01-2.121 0l-4.243-4.243"/></svg>
            Push Diagnostics
          </h3>
          <button id="close-diagnostics" class="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
        </div>
        <div class="p-5 space-y-4">
          <div class="flex justify-between items-center">
            <span class="text-sm font-semibold text-gray-600">Permission:</span>
            <span id="diag-permission" class="text-xs font-mono bg-gray-100 px-2 py-1 rounded">Checking...</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-sm font-semibold text-gray-600">Service Worker:</span>
            <span id="diag-sw" class="text-xs font-mono bg-gray-100 px-2 py-1 rounded">Checking...</span>
          </div>
          <div class="space-y-1">
            <span class="text-sm font-semibold text-gray-600 flex justify-between">FCM Token: <button id="diag-copy-token" class="text-blue-500 text-xs hover:underline hidden">Copy</button></span>
            <div id="diag-token" class="text-[10px] font-mono bg-gray-50 text-gray-500 p-2 rounded border border-gray-100 break-all h-16 overflow-y-auto">Checking...</div>
          </div>
          <button id="diag-test-push-btn" class="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors mt-2">
            Trigger Test Push
          </button>
          <p class="text-[10px] text-gray-400 text-center leading-tight">Note: Pushes while app is completely closed require Firebase Blaze plan.</p>
        </div>
      </div>
    </div>
  `;

  // Tab filter logic
  container.querySelectorAll('.notif-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      // Re-render with current filter
      loadNotifications(container);
    });
  });

  // Event listeners
  container.querySelector('#mark-all-read')?.addEventListener('click', async () => {
    await notificationManager.markAllRead();
  });

  container.querySelector('#notif-back-btn')?.addEventListener('click', () => router.navigateBack());

  // Menu dropdown toggle
  const menuBtn = container.querySelector('#notif-menu-btn');
  const menuDropdown = container.querySelector('#notif-menu-dropdown');
  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => menuDropdown?.classList.add('hidden'), { once: false });

  // Delete all
  container.querySelector('#delete-all-notifs')?.addEventListener('click', async () => {
    menuDropdown?.classList.add('hidden');
    if (confirm('Delete all notifications? This cannot be undone.')) {
      await notificationManager.deleteAllNotifications();
    }
  });

  // Diagnostics Modal Logic
  const diagModal = container.querySelector('#diagnostics-modal');
  let currentToken = '';

  container.querySelector('#open-diagnostics')?.addEventListener('click', async () => {
    menuDropdown?.classList.add('hidden');
    diagModal?.classList.remove('hidden');
    
    const permEl = document.getElementById('diag-permission');
    const swEl = document.getElementById('diag-sw');
    const tokenEl = document.getElementById('diag-token');
    const copyBtn = document.getElementById('diag-copy-token');
    
    // Check permission
    const perm = Notification.permission;
    permEl.textContent = perm;
    permEl.className = `text-xs font-mono px-2 py-1 rounded ${perm === 'granted' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`;
    
    // Check Service Worker
    try {
      const swReg = await navigator.serviceWorker.getRegistration('/');
      swEl.textContent = swReg ? 'Registered' : 'Missing';
      swEl.className = `text-xs font-mono px-2 py-1 rounded ${swReg ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`;
    } catch (e) {
      swEl.textContent = 'Error';
    }
    
    // Fetch FCM Token from User DB
    if (authManager.currentUser) {
      const userDoc = await getDoc(doc(db, 'users', authManager.currentUser.uid));
      if (userDoc.exists() && userDoc.data().fcmToken) {
        currentToken = userDoc.data().fcmToken;
        tokenEl.textContent = currentToken;
        copyBtn.classList.remove('hidden');
      } else {
        tokenEl.textContent = 'No token found. Try reloading or allowing permissions.';
        copyBtn.classList.add('hidden');
      }
    }
  });

  container.querySelector('#close-diagnostics')?.addEventListener('click', () => {
    diagModal?.classList.add('hidden');
  });
  
  container.querySelector('#diag-copy-token')?.addEventListener('click', () => {
    navigator.clipboard.writeText(currentToken);
    import('../utils.js').then(m => m.showToast('Token copied!', 'success'));
  });

  container.querySelector('#diag-test-push-btn')?.addEventListener('click', async () => {
    if (!authManager.currentUser) return;
    const uid = authManager.currentUser.uid;
    
    try {
      await addDoc(collection(db, 'notifications'), {
        userId: uid,
        fromId: uid,
        fromName: authManager.userData?.fullName || 'Admin',
        type: 'general',
        title: '🧪 Test Push Delivered',
        body: 'If you see this, notifications are working perfectly!',
        targetUrl: '/?page=notifications',
        createdAt: serverTimestamp(),
        read: false
      });
      import('../utils.js').then(m => m.showToast('Test push triggered!', 'success'));
    } catch (err) {
      console.error('Failed to trigger test push:', err);
    }
  });

  loadNotifications(container);
}

// ===== NOTIFICATION GROUPING =====
// Groups notifications of the same type + target (e.g. multiple likes on same post)
function groupNotifications(notifications) {
  const groupable = ['like', 'comment', 'poll_vote'];
  const groups = new Map(); // key => { primary, count, names, ids }
  const result = [];

  for (const notif of notifications) {
    // Only group unread notifications of groupable types
    const targetKey = notif.postId || notif.pollId || notif.capsuleId || '';
    if (groupable.includes(notif.type) && targetKey && !notif.read) {
      const groupKey = `${notif.type}_${targetKey}`;
      if (groups.has(groupKey)) {
        const g = groups.get(groupKey);
        g.count++;
        if (g.names.length < 3) {
          g.names.push(notif.fromName || 'Someone');
        }
        g.ids.push(notif.id);
      } else {
        groups.set(groupKey, {
          primary: notif,
          count: 1,
          names: [notif.fromName || 'Someone'],
          ids: [notif.id]
        });
        result.push({ __groupKey: groupKey });
      }
    } else {
      result.push(notif);
    }
  }

  // Replace group placeholders with enriched notifications
  return result.map(item => {
    if (item.__groupKey) {
      const g = groups.get(item.__groupKey);
      return {
        ...g.primary,
        _grouped: true,
        _groupedCount: g.count,
        _groupedNames: g.names,
        _groupedIds: g.ids,
      };
    }
    return item;
  });
}

function loadNotifications(container) {
  const notifsEl = container.querySelector('#notifs-container');
  const unreadBanner = container.querySelector('#unread-banner');
  const unreadCountText = container.querySelector('#unread-count-text');

  if (!authManager.currentUser) {
    notifsEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Login to see notifications</p>';
    return;
  }

  try {
    let notifLimit = 20;
    let notifObserver = null;

    const setupNotifListener = () => {
      if (unsubNotifs) unsubNotifs();
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', authManager.currentUser.uid)
      );

      unsubNotifs = onSnapshot(q, (snap) => {
      if (snap.empty) {
        notifsEl.innerHTML = `
          <div class="flex flex-col items-center justify-center py-16 px-6">
            <div class="w-20 h-20 rounded-full bg-cream-100 flex items-center justify-center mb-4">
              <svg class="w-10 h-10 text-cream-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg>
            </div>
            <h3 class="font-bold text-navy-700 text-lg mb-1">No notifications</h3>
            <p class="text-sm text-gray-400 text-center">You're all caught up! 🎉</p>
          </div>`;
        if (unreadBanner) unreadBanner.classList.add('hidden');
        return;
      }
      
      // Sort locally
      let allDocs = [];
      snap.forEach(d => allDocs.push(d));
      allDocs.sort((a, b) => {
        const aTime = a.data().createdAt?.toMillis() || 0;
        const bTime = b.data().createdAt?.toMillis() || 0;
        return bTime - aTime;
      });

      // Build notification list
      let allNotifs = allDocs.map(d => ({ id: d.id, ...d.data() }));

      // Apply filter
      let filteredNotifs = currentFilter === 'unread'
        ? allNotifs.filter(n => !n.read)
        : allNotifs;
      
      // Apply pagination limit locally
      const pageDocs = filteredNotifs.slice(0, notifLimit);

      // Count total unread (always from full list)
      let unreadCount = allNotifs.filter(n => !n.read).length;

      // Update unread banner
      if (unreadCount > 0) {
        if (unreadBanner) unreadBanner.classList.remove('hidden');
        if (unreadCountText) unreadCountText.textContent = unreadCount;
      } else {
        if (unreadBanner) unreadBanner.classList.add('hidden');
      }

      // Update tab badge count
      const unreadTab = container.querySelector('.notif-tab[data-filter="unread"]');
      if (unreadTab) {
        unreadTab.textContent = unreadCount > 0 ? `Unread (${unreadCount})` : 'Unread';
      }

      // Show empty state for filtered view
      if (pageDocs.length === 0) {
        notifsEl.innerHTML = `
          <div class="flex flex-col items-center justify-center py-16 px-6">
            <div class="w-20 h-20 rounded-full bg-cream-100 flex items-center justify-center mb-4">
              <svg class="w-10 h-10 text-cream-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg>
            </div>
            <h3 class="font-bold text-navy-700 text-lg mb-1">${currentFilter === 'unread' ? 'No unread notifications' : 'No notifications'}</h3>
            <p class="text-sm text-gray-400 text-center">${currentFilter === 'unread' ? 'All caught up! 🎉' : "We'll let you know when something happens!"}</p>
          </div>`;
        return;
      }

      // Group notifications (e.g. "Bose and 2 others liked your post")
      const groupedNotifs = groupNotifications(pageDocs);

      // Group notifications by date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const groups = { today: [], yesterday: [], older: [] };

      groupedNotifs.forEach(notif => {
        const notifDate = notif.createdAt?.toDate ? notif.createdAt.toDate() : new Date();
        const notifDay = new Date(notifDate);
        notifDay.setHours(0, 0, 0, 0);

        if (notifDay.getTime() === today.getTime()) {
          groups.today.push(notif);
        } else if (notifDay.getTime() === yesterday.getTime()) {
          groups.yesterday.push(notif);
        } else {
          groups.older.push(notif);
        }
      });

      // Render grouped notifications
      notifsEl.innerHTML = '';

      if (groups.today.length > 0) {
        notifsEl.appendChild(createGroupHeader('Today'));
        groups.today.forEach(n => notifsEl.appendChild(createNotifCard(n)));
      }

      if (groups.yesterday.length > 0) {
        notifsEl.appendChild(createGroupHeader('Yesterday'));
        groups.yesterday.forEach(n => notifsEl.appendChild(createNotifCard(n)));
      }

      if (groups.older.length > 0) {
        notifsEl.appendChild(createGroupHeader('Older'));
        groups.older.forEach(n => notifsEl.appendChild(createNotifCard(n)));
      }

      // Add pagination observer target if we reached the limit
      if (filteredNotifs.length >= notifLimit) {
        const topEl = document.createElement('div');
        topEl.id = 'notif-bottom-observer';
        topEl.className = 'py-4 text-center text-[10px] text-navy-300 font-semibold uppercase tracking-wider';
        topEl.textContent = 'Loading older notifications...';
        notifsEl.appendChild(topEl);

        if (notifObserver) { notifObserver.disconnect(); }
        if ('IntersectionObserver' in window) {
          notifObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
              notifLimit += 20;
              setupNotifListener();
            }
          });
          notifObserver.observe(topEl);
        }
      }
    });
    };

    setupNotifListener();
  } catch (e) {
    notifsEl.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 px-6">
        <div class="w-20 h-20 rounded-full bg-cream-100 flex items-center justify-center mb-4">
          <svg class="w-10 h-10 text-cream-400" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/></svg>
        </div>
        <h3 class="font-bold text-navy-700 text-lg mb-1">No notifications yet</h3>
        <p class="text-sm text-gray-400 text-center">We'll let you know when something happens!</p>
      </div>`;
  }
}

function createGroupHeader(label) {
  const header = document.createElement('div');
  header.className = 'flex items-center gap-3 py-3 px-1';
  header.innerHTML = `
    <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">${label}</span>
    <div class="flex-1 h-px bg-gray-100"></div>
  `;
  return header;
}

// ===== TYPE CONFIG for icons/colors =====
const typeConfig = {
  like: { icon: '❤️', color: 'bg-red-50 border-red-100' },
  comment: { icon: '💬', color: 'bg-blue-50 border-blue-100' },
  chat_message: { icon: '✉️', color: 'bg-green-50 border-green-100' },
  birthday: { icon: '🎂', color: 'bg-yellow-50 border-yellow-100' },
  birthday_wish: { icon: '🎂', color: 'bg-yellow-50 border-yellow-100' },
  birthday_bonus: { icon: '🎂', color: 'bg-yellow-50 border-yellow-100' },
  birthday_reply: { icon: '❤️', color: 'bg-yellow-50 border-yellow-100' },
  birthday_reaction: { icon: '❤️', color: 'bg-yellow-50 border-yellow-100' },
  friend_bonus: { icon: '🎁', color: 'bg-pink-50 border-pink-100' },
  time_capsule_unlock: { icon: '⏳', color: 'bg-purple-50 border-purple-100' },
  capsule_unlock: { icon: '⏳', color: 'bg-purple-50 border-purple-100' },
  capsule_message: { icon: '💬', color: 'bg-purple-50 border-purple-100' },
  poll_created: { icon: '📊', color: 'bg-indigo-50 border-indigo-100' },
  announcement: { icon: '📢', color: 'bg-orange-50 border-orange-100' },
  admin_announcement: { icon: '📢', color: 'bg-orange-50 border-orange-100' },
  diary_entry: { icon: '📖', color: 'bg-warm-50 border-warm-100' },
  new_memory: { icon: '📸', color: 'bg-blue-50 border-blue-100' },
  call_incoming: { icon: '📞', color: 'bg-green-50 border-green-100' },
  voice_call_incoming: { icon: '📞', color: 'bg-green-50 border-green-100' },
  video_call_incoming: { icon: '📹', color: 'bg-green-50 border-green-100' },
  missed_voice_call: { icon: '📵', color: 'bg-red-50 border-red-100' },
  missed_video_call: { icon: '📵', color: 'bg-red-50 border-red-100' },
  game_challenge: { icon: '🎮', color: 'bg-orange-50 border-orange-100' },
  tag: { icon: '🏷️', color: 'bg-blue-50 border-blue-100' },
  tag_request: { icon: '🏷️', color: 'bg-blue-50 border-blue-100' },
  tag_accepted: { icon: '✅', color: 'bg-green-50 border-green-100' },
  tag_declined: { icon: '❌', color: 'bg-red-50 border-red-100' },
  badge_suggestion: { icon: '🏅', color: 'bg-amber-50 border-amber-100' },
  miss_you: { icon: '❤️', color: 'bg-pink-50 border-pink-100' },
  friend_request: { icon: '👋', color: 'bg-blue-50 border-blue-100' },
  friend_accepted: { icon: '✅', color: 'bg-green-50 border-green-100' },
  group_message: { icon: '👥', color: 'bg-indigo-50 border-indigo-100' },
  poll_vote: { icon: '📊', color: 'bg-purple-50 border-purple-100' },
  slambook_share: { icon: '📖', color: 'bg-teal-50 border-teal-100' },
  slambook_response: { icon: '✍️', color: 'bg-teal-50 border-teal-100' },
  slambook_pinned: { icon: '📌', color: 'bg-teal-50 border-teal-100' },
  screenshot_alert: { icon: '📸', color: 'bg-red-50 border-red-100' },
  share: { icon: '🚀', color: 'bg-indigo-50 border-indigo-100' },
};

function createNotifCard(notif) {
  const config = typeConfig[notif.type] || { icon: '🔔', color: 'bg-gray-50 border-gray-100' };
  const time = notif.createdAt?.toDate ? timeAgo(notif.createdAt.toDate()) : '';
  const title = notif.title || getDefaultTitle(notif.type);
  let body = notif.body || getDefaultBody(notif);

  // Handle grouped notifications
  if (notif._grouped && notif._groupedCount > 1) {
    const othersCount = notif._groupedCount - 1;
    const firstName = notif._groupedNames[0] || 'Someone';
    const typeVerb = {
      like: 'liked your memory',
      comment: 'commented on your memory',
      poll_vote: 'voted in your poll',
    };
    body = `${firstName} and ${othersCount} ${othersCount === 1 ? 'other' : 'others'} ${typeVerb[notif.type] || 'interacted'}.`;
  }

  // Resolve sender profile picture
  let senderPhoto = notif.fromPhoto || '';
  if (!senderPhoto && notif.fromId) {
    try {
      const u = userCache.getUser(notif.fromId);
      if (u && u.profilePic) senderPhoto = u.profilePic;
    } catch (e) {}
  }

  const card = document.createElement('div');
  card.className = `notif-card group relative flex items-start gap-3 p-3.5 rounded-2xl transition-all duration-200 cursor-pointer mb-1 ${
    notif.read
      ? 'bg-white hover:bg-gray-50'
      : 'notif-card-unread bg-gradient-to-r from-cream-50 to-cream-100/50 border border-cream-200 shadow-sm'
  }`;

  // Build avatar HTML — profile pic with type emoji overlay badge
  const avatarHTML = senderPhoto
    ? `<div class="notif-avatar-wrap">
        <img src="${sanitizeHTML(senderPhoto)}" alt="" class="notif-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
        <div class="notif-avatar-fallback" style="display:none">${(notif.fromName || '?')[0].toUpperCase()}</div>
        <span class="notif-type-badge">${config.icon}</span>
      </div>`
    : `<div class="notif-avatar-wrap">
        <div class="notif-avatar-fallback">${(notif.fromName || '?')[0].toUpperCase()}</div>
        <span class="notif-type-badge">${config.icon}</span>
      </div>`;

  card.innerHTML = `
    ${avatarHTML}
    <div class="flex-1 min-w-0">
      <p class="text-[13px] ${notif.read ? 'text-gray-600' : 'text-navy-800 font-semibold'} leading-snug">
        ${sanitizeHTML(body)}
      </p>
      <p class="text-[10px] text-gray-400 mt-1">${time}</p>
    </div>
    <div class="flex items-center gap-1.5 flex-shrink-0">
      ${!notif.read ? '<div class="w-2.5 h-2.5 rounded-full bg-navy-500 animate-pulse"></div>' : ''}
      <button class="notif-delete-btn opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-red-50 transition-all" title="Delete">
        <svg class="w-4 h-4 text-gray-400 hover:text-red-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  `;

  // Action buttons for specific types
  if (notif.type === 'tag_request' && notif.postId && !notif.handled) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'mt-2 flex gap-2 notif-actions';
    actionsDiv.innerHTML = `
      <button class="bg-navy-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-navy-700 tag-accept-btn" data-post-id="${notif.postId}">Accept</button>
      <button class="bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-200 tag-reject-btn" data-post-id="${notif.postId}">Reject</button>
    `;
    card.querySelector('.flex-1').appendChild(actionsDiv);
  }

  // Click handler — navigate to target
  card.addEventListener('click', async (e) => {
    if (e.target.closest('.notif-delete-btn')) return; // Don't navigate on delete

    // Mark as read instantly to update badge and UI
    if (!notif.read) {
      notif.read = true;
      // Update UI classes immediately
      card.classList.remove('notif-card-unread', 'bg-gradient-to-r', 'from-cream-50', 'to-cream-100/50', 'border-cream-200', 'shadow-sm');
      card.classList.add('bg-white', 'hover:bg-gray-50');
      const textEl = card.querySelector('.text-navy-800');
      if (textEl) { textEl.classList.remove('text-navy-800', 'font-semibold'); textEl.classList.add('text-gray-600'); }
      const dot = card.querySelector('.animate-pulse');
      if (dot) dot.remove();

      // Decrement unread count instantly
      if (notificationManager.unreadCount > 0) {
        notificationManager.unreadCount--;
        notificationManager._updateBadge();
        const unreadBanner = document.querySelector('#unread-banner');
        const unreadCountText = document.querySelector('#unread-count-text');
        if (unreadCountText) unreadCountText.textContent = notificationManager.unreadCount;
        if (notificationManager.unreadCount === 0 && unreadBanner) unreadBanner.classList.add('hidden');
      }

      // If grouped, mark all grouped notifications as read
      if (notif._grouped && notif._groupedIds) {
        notif._groupedIds.forEach(id => notificationManager.markRead(id).catch(console.error));
      } else {
        // Sync to Firebase
        notificationManager.markRead(notif.id).catch(console.error);
      }
    }
    
    notificationManager.navigateToNotification(notif);
  });

  // Action handlers
  const acceptBtn = card.querySelector('.tag-accept-btn');
  const rejectBtn = card.querySelector('.tag-reject-btn');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const postId = acceptBtn.dataset.postId;
        const postRef = doc(db, 'posts', postId);
        const myUid = authManager.currentUser.uid;
        
        await updateDoc(postRef, {
          pendingTags: arrayRemove(myUid),
          taggedFriends: arrayUnion(myUid)
        });

        // Add to subcollections
        await setDoc(doc(db, 'users', myUid, 'taggedPosts', postId), {
          taggedAt: serverTimestamp()
        });
        await setDoc(doc(db, 'posts', postId, 'acceptedTags', myUid), {
          acceptedAt: serverTimestamp()
        });

        // Send notification to post owner
        const postSnap = await getDoc(postRef);
        if (postSnap.exists()) {
          const authorId = postSnap.data().authorId;
          if (authorId && authorId !== myUid) {
            notificationManager.constructor.create('tag_accepted', authorId, { 
              postId, 
              messagePreview: 'accepted your tag'
            });
          }
        }

        await updateDoc(doc(db, 'notifications', notif.id), { handled: true, body: 'You accepted the tag request.', read: true });
        import('../utils.js').then(m => m.showToast('Added to your profile!', 'success'));
      } catch (err) { console.error(err); }
    });
  }
  if (rejectBtn) {
    rejectBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const postId = rejectBtn.dataset.postId;
        const postRef = doc(db, 'posts', postId);
        const myUid = authManager.currentUser.uid;

        await updateDoc(postRef, {
          pendingTags: arrayRemove(myUid)
        });

        // Send notification to post owner
        const postSnap = await getDoc(postRef);
        if (postSnap.exists()) {
          const authorId = postSnap.data().authorId;
          if (authorId && authorId !== myUid) {
            notificationManager.constructor.create('tag_declined', authorId, { 
              postId, 
              messagePreview: 'declined your tag'
            });
          }
        }

        await updateDoc(doc(db, 'notifications', notif.id), { handled: true, body: 'You rejected the tag request.', read: true });
      } catch (err) { console.error(err); }
    });
  }

  // Delete button handler
  card.querySelector('.notif-delete-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    card.style.transform = 'translateX(100%)';
    card.style.opacity = '0';
    card.style.transition = 'all 0.3s ease';
    setTimeout(async () => {
      if (notif._grouped && notif._groupedIds) {
        // Delete all grouped notifications
        await Promise.all(notif._groupedIds.map(id => notificationManager.deleteNotification(id)));
      } else {
        await notificationManager.deleteNotification(notif.id);
      }
    }, 300);
  });

  // Touch swipe to delete (mobile)
  let startX = 0;
  let currentX = 0;
  let swiping = false;

  card.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    swiping = true;
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (!swiping) return;
    currentX = e.touches[0].clientX;
    const dx = currentX - startX;
    if (dx < -20) {
      card.style.transform = `translateX(${Math.max(dx, -100)}px)`;
      card.style.transition = 'none';
    }
  }, { passive: true });

  card.addEventListener('touchend', async () => {
    if (!swiping) return;
    swiping = false;
    const dx = currentX - startX;
    if (dx < -80) {
      // Swipe delete
      card.style.transform = 'translateX(-100%)';
      card.style.opacity = '0';
      card.style.transition = 'all 0.3s ease';
      setTimeout(async () => {
        if (notif._grouped && notif._groupedIds) {
          await Promise.all(notif._groupedIds.map(id => notificationManager.deleteNotification(id)));
        } else {
          await notificationManager.deleteNotification(notif.id);
        }
      }, 300);
    } else {
      // Reset position
      card.style.transform = '';
      card.style.transition = 'transform 0.2s ease';
    }
    currentX = 0;
    startX = 0;
  });

  return card;
}

function getDefaultTitle(type) {
  const titles = {
    like: '❤️ New Like',
    comment: '💬 New Comment',
    chat_message: '💬 New Message',
    birthday: '🎂 Birthday',
    birthday_wish: '🎂 New Birthday Wish',
    birthday_bonus: '🎂 Birthday Bonus',
    birthday_reply: '❤️ Birthday Wish Reply',
    birthday_reaction: '❤️ Birthday Reaction',
    friend_bonus: '🎁 Birthday Gift',
    time_capsule_unlock: '⏳ Time Capsule Ready',
    capsule_unlock: '⏳ Time Capsule Ready',
    capsule_message: '💬 Capsule Comment',
    poll_created: '📊 New Poll',
    announcement: '📢 School Announcement',
    admin_announcement: '📢 Announcement',
    diary_entry: '📖 New Diary Entry',
    new_memory: '📸 New Memory',
    slambook_share: '📖 Slam Book Shared',
    slambook_response: '✍️ Slam Book Signed',
    slambook_pinned: '📌 Response Pinned',
    call_incoming: '📞 Incoming Call',
    voice_call_incoming: '📞 Incoming Voice Call',
    video_call_incoming: '📹 Incoming Video Call',
    missed_voice_call: '📵 Missed Voice Call',
    missed_video_call: '📵 Missed Video Call',
    game_challenge: '🎮 Game Challenge',
    tag: '🏷️ Tagged',
    tag_request: '🏷️ Tag Request',
    tag_accepted: '✅ Tag Accepted',
    tag_declined: '❌ Tag Declined',
    badge_suggestion: '🏅 New Badge',
    miss_you: '❤️ Someone Misses You',
    friend_request: '👋 Friend Request',
    friend_accepted: '✅ Request Accepted',
    group_message: '👥 Group Message',
    poll_vote: '📊 Poll Vote',
    share: '🚀 Memory Shared',
    screenshot_alert: '📸 Screenshot Alert',
  };
  return titles[type] || '🔔 Notification';
}

function getDefaultBody(notif) {
  let name = notif.fromName || 'Someone';
  try {
    if (notif.fromId) {
      const u = userCache.getUser(notif.fromId);
      if (u && u.fullName) name = u.fullName;
    }
  } catch(e) {}

  const bodies = {
    like: `${name} liked your memory.`,
    comment: `${name} commented on your memory.`,
    chat_message: `${name} sent you a message.`,
    birthday: `It's ${name}'s birthday today! 🎉`,
    birthday_wish: `${name} sent you a birthday wish.`,
    birthday_bonus: 'You received birthday bonus points! 🎂✨',
    birthday_reply: `${name} replied to your birthday wish.`,
    birthday_reaction: `${name} reacted to your birthday wish.`,
    friend_bonus: `${name} gifted you points.`,
    time_capsule_unlock: 'Your Time Capsule is ready to open.',
    capsule_unlock: 'Your Time Capsule is ready to open.',
    capsule_message: `${name} commented on your Time Capsule.`,
    poll_created: `${name} created a new poll.`,
    announcement: 'New announcement available.',
    admin_announcement: 'New announcement from admin.',
    diary_entry: `${name} published a new diary entry.`,
    new_memory: `${name} added a new memory.`,
    slambook_share: `${name} shared a Slam Book with you!`,
    slambook_response: `${name} wrote in your Slam Book!`,
    slambook_pinned: `${name} pinned your Slam Book response!`,
    call_incoming: `Incoming call from ${name}.`,
    voice_call_incoming: `Incoming voice call from ${name}.`,
    video_call_incoming: `Incoming video call from ${name}.`,
    missed_voice_call: `Missed voice call from ${name}.`,
    missed_video_call: `Missed video call from ${name}.`,
    game_challenge: `${name} challenged you!`,
    tag: `${name} tagged you in a memory.`,
    tag_request: `${name} tagged you in a memory. Approve to add to your profile.`,
    tag_accepted: `${name} accepted your tag.`,
    tag_declined: `${name} declined your tag.`,
    badge_suggestion: `${name} suggested a new title for you.`,
    miss_you: `${name} misses you ❤️🥺`,
    friend_request: `${name} sent you a friend request.`,
    friend_accepted: `${name} accepted your friend request.`,
    group_message: `${name} sent a message to the group.`,
    poll_vote: `${name} voted in your poll.`,
    share: `${name} shared a memory with you!`,
    screenshot_alert: `${name} took a screenshot.`,
  };
  return bodies[notif.type] || notif.message || 'New notification';
}
