// Notifications page — Premium notification center with grouping, delete, and deep links
import { db, collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, deleteDoc } from '../firebase-config.js';
import { timeAgo, sanitizeHTML } from '../utils.js';
import { authManager } from '../auth.js';
import { notificationManager } from '../notifications.js';
import { router } from '../router.js';

let unsubNotifs = null;

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
    <section class="px-4 pt-4 pb-6">
      <div class="flex items-center gap-3 mb-5">
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
              <button id="delete-all-notifs" class="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
                Delete All
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Unread count banner -->
      <div id="unread-banner" class="hidden mb-4 px-4 py-2.5 rounded-xl bg-gradient-to-r from-navy-500/10 to-navy-500/5 border border-navy-200/30">
        <p class="text-sm font-semibold text-navy-700"><span id="unread-count-text">0</span> unread notifications</p>
      </div>

      <div id="notifs-container" class="space-y-1"></div>
    </section>
  `;

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

  loadNotifications(container);
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
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', authManager.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(100)
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

      // Group notifications by date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const groups = { today: [], yesterday: [], older: [] };
      let unreadCount = 0;

      snap.forEach(d => {
        const notif = { id: d.id, ...d.data() };
        if (!notif.read) unreadCount++;

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

      // Update unread banner
      if (unreadCount > 0) {
        if (unreadBanner) unreadBanner.classList.remove('hidden');
        if (unreadCountText) unreadCountText.textContent = unreadCount;
      } else {
        if (unreadBanner) unreadBanner.classList.add('hidden');
      }

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
    });
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

function createNotifCard(notif) {
  const typeConfig = {
    like: { icon: '❤️', color: 'bg-red-50 border-red-100' },
    comment: { icon: '💬', color: 'bg-blue-50 border-blue-100' },
    chat_message: { icon: '✉️', color: 'bg-green-50 border-green-100' },
    birthday: { icon: '🎂', color: 'bg-yellow-50 border-yellow-100' },
    birthday_wish: { icon: '🎂', color: 'bg-yellow-50 border-yellow-100' },
    birthday_bonus: { icon: '🎂', color: 'bg-yellow-50 border-yellow-100' },
    friend_bonus: { icon: '🎁', color: 'bg-pink-50 border-pink-100' },
    time_capsule_unlock: { icon: '📦', color: 'bg-purple-50 border-purple-100' },
    poll_created: { icon: '📊', color: 'bg-indigo-50 border-indigo-100' },
    announcement: { icon: '📢', color: 'bg-orange-50 border-orange-100' },
    diary_entry: { icon: '📖', color: 'bg-warm-50 border-warm-100' },
    call_incoming: { icon: '📞', color: 'bg-green-50 border-green-100' },
    voice_call_incoming: { icon: '📞', color: 'bg-green-50 border-green-100' },
    video_call_incoming: { icon: '📹', color: 'bg-green-50 border-green-100' },
    missed_voice_call: { icon: '📵', color: 'bg-red-50 border-red-100' },
    missed_video_call: { icon: '📵', color: 'bg-red-50 border-red-100' },
    game_challenge: { icon: '🎮', color: 'bg-orange-50 border-orange-100' },
    tag: { icon: '📸', color: 'bg-blue-50 border-blue-100' },
    badge_suggestion: { icon: '🏅', color: 'bg-amber-50 border-amber-100' },
    miss_you: { icon: '❤️', color: 'bg-pink-50 border-pink-100' },
  };

  const config = typeConfig[notif.type] || { icon: '🔔', color: 'bg-gray-50 border-gray-100' };
  const time = notif.createdAt?.toDate ? timeAgo(notif.createdAt.toDate()) : '';
  const title = notif.title || getDefaultTitle(notif.type);
  const body = notif.body || getDefaultBody(notif);

  const card = document.createElement('div');
  card.className = `group relative flex items-start gap-3 p-3.5 rounded-2xl transition-all duration-200 cursor-pointer mb-1 ${
    notif.read
      ? 'bg-white hover:bg-gray-50'
      : 'bg-gradient-to-r from-cream-50 to-cream-100/50 border border-cream-200 shadow-sm'
  }`;

  card.innerHTML = `
    <div class="w-11 h-11 rounded-full ${config.color} border flex items-center justify-center text-xl flex-shrink-0 mt-0.5">
      ${config.icon}
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-[13px] ${notif.read ? 'text-gray-600' : 'text-navy-800 font-semibold'} leading-snug">
        ${sanitizeHTML(title)}
      </p>
      <p class="text-[12px] ${notif.read ? 'text-gray-400' : 'text-navy-600'} mt-0.5 leading-snug truncate">
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

  // Click handler — navigate to target
  card.addEventListener('click', async (e) => {
    if (e.target.closest('.notif-delete-btn')) return; // Don't navigate on delete

    if (!notif.read) {
      await notificationManager.markRead(notif.id);
    }
    notificationManager.navigateToNotification(notif);
  });

  // Delete button handler
  card.querySelector('.notif-delete-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    card.style.transform = 'translateX(100%)';
    card.style.opacity = '0';
    card.style.transition = 'all 0.3s ease';
    setTimeout(async () => {
      await notificationManager.deleteNotification(notif.id);
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
        await notificationManager.deleteNotification(notif.id);
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
    friend_bonus: '🎁 Birthday Gift',
    time_capsule_unlock: '📦 Time Capsule Opened',
    poll_created: '📊 New Poll',
    announcement: '📢 School Announcement',
    diary_entry: '📖 New Diary Entry',
    call_incoming: '📞 Incoming Call',
    voice_call_incoming: '📞 Incoming Voice Call',
    video_call_incoming: '📹 Incoming Video Call',
    missed_voice_call: '📵 Missed Voice Call',
    missed_video_call: '📵 Missed Video Call',
    game_challenge: '🎮 Game Challenge',
    tag: '📸 Tagged',
    badge_suggestion: '🏅 New Badge',
    miss_you: '❤️ Someone Misses You',
  };
  return titles[type] || '🔔 Notification';
}

function getDefaultBody(notif) {
  const name = notif.fromName || 'Someone';
  const bodies = {
    like: `${name} liked your memory.`,
    comment: `${name} commented on your memory.`,
    chat_message: `${name} sent you a message.`,
    birthday: `It's ${name}'s birthday today! 🎉`,
    birthday_wish: `${name} sent you a birthday wish.`,
    birthday_bonus: 'You received birthday bonus points! 🎂✨',
    friend_bonus: `${name} gifted you points.`,
    time_capsule_unlock: 'Your memory capsule is ready.',
    poll_created: 'Vote in the latest class poll.',
    announcement: 'New announcement available.',
    diary_entry: `${name} wrote in the diary.`,
    call_incoming: `Incoming call from ${name}.`,
    voice_call_incoming: `Incoming voice call from ${name}.`,
    video_call_incoming: `Incoming video call from ${name}.`,
    missed_voice_call: `Missed voice call from ${name}.`,
    missed_video_call: `Missed video call from ${name}.`,
    game_challenge: `${name} challenged you!`,
    tag: `${name} tagged you in a memory.`,
    badge_suggestion: `${name} suggested a new title for you.`,
    miss_you: `${name} misses you ❤️🥺`,
  };
  return bodies[notif.type] || notif.message || 'New notification';
}

export function destroyNotifications() {
  if (unsubNotifs) {
    unsubNotifs();
    unsubNotifs = null;
  }
}
