// Notifications page — View all notifications
import { db, collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc } from '../firebase-config.js';
import { timeAgo, sanitizeHTML } from '../utils.js';
import { authManager } from '../auth.js';
import { notificationManager } from '../notifications.js';
import { router } from '../router.js';

let unsubNotifs = null;

export async function renderNotifications(container) {
  if (unsubNotifs) unsubNotifs();

  container.innerHTML = `
    <section class="px-4 pt-4">
      <div class="flex items-center gap-3 mb-5">
        <button id="notif-back-btn" class="inner-back-btn">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
        </button>
        <h2 class="text-xl font-bold text-navy-800 flex-1">Notifications</h2>
        <button id="mark-all-read" class="text-xs text-navy-500 font-semibold hover:underline">Mark all read</button>
      </div>
      <div id="notifs-container" class="space-y-2"></div>
    </section>
  `;

  container.querySelector('#mark-all-read')?.addEventListener('click', async () => {
    await notificationManager.markAllRead();
  });
  container.querySelector('#notif-back-btn')?.addEventListener('click', () => router.navigateBack());

  loadNotifications(container);
}

function loadNotifications(container) {
  const notifsEl = container.querySelector('#notifs-container');
  if (!authManager.currentUser) {
    notifsEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Login to see notifications</p>';
    return;
  }

  try {
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', authManager.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    unsubNotifs = onSnapshot(q, (snap) => {
      if (snap.empty) {
        notifsEl.innerHTML = `
          <div class="card p-8 text-center">
            <div class="text-4xl mb-3">🔔</div>
            <h3 class="font-semibold text-navy-700 mb-1">No notifications</h3>
            <p class="text-sm text-gray-400">You're all caught up!</p>
          </div>`;
        return;
      }
      notifsEl.innerHTML = '';
      snap.forEach(d => {
        const notif = { id: d.id, ...d.data() };
        notifsEl.appendChild(createNotifCard(notif));
      });
    });
  } catch (e) {
    notifsEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">Configure Firebase</p>';
  }
}

function createNotifCard(notif) {
  const typeConfig = {
    like: { icon: '❤️', text: 'liked your memory', color: 'bg-red-50' },
    comment: { icon: '💬', text: 'commented on your post', color: 'bg-blue-50' },
    chat_message: { icon: '✉️', text: 'sent you a message', color: 'bg-green-50' },
    birthday: { icon: '🎂', text: 'has a birthday today!', color: 'bg-yellow-50' },
    time_capsule_unlock: { icon: '🔓', text: 'A time capsule was unlocked!', color: 'bg-purple-50' },
    poll_created: { icon: '📊', text: 'created a new poll', color: 'bg-indigo-50' },
    diary_entry: { icon: '📖', text: 'wrote in the diary', color: 'bg-warm-50' },
    call_incoming: { icon: '📞', text: 'is calling you', color: 'bg-green-50' },
    game_challenge: { icon: '🎮', text: 'challenged you', color: 'bg-orange-50' },
    tag: { icon: '🏷️', text: 'tagged you in a memory', color: 'bg-blue-50' }
  };

  const config = typeConfig[notif.type] || { icon: '🔔', text: 'notification', color: 'bg-gray-50' };
  const time = notif.createdAt?.toDate ? timeAgo(notif.createdAt.toDate()) : '';

  const card = document.createElement('div');
  card.className = `flex items-center gap-3 p-3 rounded-xl transition-colors cursor-pointer ${notif.read ? 'bg-white' : 'bg-cream-50 border border-cream-200'}`;
  card.innerHTML = `
    <div class="w-10 h-10 rounded-full ${config.color} flex items-center justify-center text-lg flex-shrink-0">${config.icon}</div>
    <div class="flex-1 min-w-0">
      <p class="text-sm text-navy-800 ${notif.read ? '' : 'font-semibold'}">
        <span class="font-semibold">${sanitizeHTML(notif.fromName || 'Someone')}</span> ${config.text}
      </p>
      <p class="text-[10px] text-gray-400 mt-0.5">${time}</p>
    </div>
    ${!notif.read ? '<div class="w-2 h-2 rounded-full bg-navy-500 flex-shrink-0"></div>' : ''}
  `;

  card.addEventListener('click', async () => {
    if (!notif.read) {
      await notificationManager.markRead(notif.id);
    }
    // Navigate to relevant page based on type
    if (notif.type === 'chat_message') router.navigate('chat');
    else if (notif.type === 'birthday') router.navigate('birthday');
    else if (notif.type === 'poll_created') router.navigate('polls');
    else if (notif.type === 'diary_entry') router.navigate('diary');
    else if (notif.type === 'time_capsule_unlock') router.navigate('timecapsule');
    else if (notif.type === 'game_challenge') router.navigate('games');
  });

  return card;
}
